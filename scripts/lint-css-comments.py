#!/usr/bin/env python3
"""Guard against premature CSS comment closes.

A `*/` inside a comment body (e.g. `/* ... --pl*/--dl* ... */`) terminates the
comment early; the browser then parses the leftover text as CSS and silently
corrupts the *next* rule — its declarations never apply. TypeScript and the
Vite build don't catch this (it's valid-enough CSS), so it can ship unnoticed.
This is what broke every `.btn-pl`/`.btn-dl` button in Aug 2026.

Detection: walk each stylesheet tracking comment/string state. A `*/` seen
while NOT inside an open comment is a stray close — the tell-tale sign that a
comment already closed too early upstream. Exits non-zero on any finding.
"""
import glob
import sys

# Hand-authored stylesheets only — never build output (web/dist) or vendored css.
PATTERNS = ["web/src/**/*.css"]


def scan(path: str) -> list[str]:
    src = open(path, encoding="utf-8", errors="replace").read()
    findings: list[str] = []
    i, n = 0, len(src)
    line = 1
    in_comment = False
    while i < n:
        ch = src[i]
        if ch == "\n":
            line += 1
            i += 1
            continue
        if in_comment:
            if src[i : i + 2] == "*/":
                in_comment = False
                i += 2
                continue
            i += 1
            continue
        # Not in a comment.
        if src[i : i + 2] == "/*":
            in_comment = True
            i += 2
            continue
        # A string — skip its contents so a literal "*/" inside url()/content
        # doesn't trip the check.
        if ch in "\"'":
            quote = ch
            i += 1
            while i < n and src[i] != quote:
                if src[i] == "\\":
                    i += 1
                elif src[i] == "\n":
                    line += 1
                i += 1
            i += 1
            continue
        # A stray close outside any comment == an earlier comment closed early.
        if src[i : i + 2] == "*/":
            findings.append(
                f"{path}:{line}: stray '*/' outside a comment — a block comment "
                f"almost certainly closed early (a '*/' hidden inside its text, "
                f"e.g. '--pl*/--dl*'). Reword the comment to remove the inner '*/'."
            )
            i += 2
            continue
        i += 1
    if in_comment:
        findings.append(f"{path}: unterminated block comment ('/*' with no closing '*/').")
    return findings


def main() -> int:
    files = sorted({f for pat in PATTERNS for f in glob.glob(pat, recursive=True)})
    if not files:
        print("lint-css-comments: no stylesheets matched — nothing to check.")
        return 0
    all_findings: list[str] = []
    for f in files:
        all_findings += scan(f)
    if all_findings:
        print("✖ Premature CSS comment close detected:\n")
        for msg in all_findings:
            print("  " + msg)
        print(f"\n{len(all_findings)} issue(s) across {len(files)} stylesheet(s).")
        return 1
    print(f"✓ lint-css-comments: {len(files)} stylesheet(s) clean.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
