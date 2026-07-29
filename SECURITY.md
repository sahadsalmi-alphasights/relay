# Security Policy

CapTracker / Relay is an internal AlphaSights application. This document explains how to
report a vulnerability and what security controls the project relies on.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

- Preferred: use **GitHub → Security → "Report a vulnerability"** (Private Vulnerability
  Reporting) on this repository.
- Alternatively, contact the maintainer directly: **sahad.salmi@alphasights.com**, or the
  AlphaSights security/IT Engineering team.

Please include: affected area, reproduction steps, impact, and any logs (with secrets
redacted). We aim to acknowledge within **2 business days** and to trage/fix based on
severity.

Do **not** include secrets, access tokens, customer data, or personal data in a report —
describe them, don't paste them.

## Supported versions

Only the currently deployed `main` branch (live at captracker.alphasights.ae) is supported.
There are no long-term-support branches.

## Security controls (summary)

- **Access** — Cloudflare Access (OTP, @alphasights.com only) + OIDC/SSO with PKCE; signed,
  httpOnly, Secure session cookies. The API fails closed at boot if auth is misconfigured.
- **Authorization** — Owner ⊃ Manager ⊃ Member with a DB-backed permission matrix; every
  write route enforces its own permission server-side.
- **Network** — no inbound ports on the VM; traffic arrives via an outbound Cloudflare Tunnel.
- **Application** — parameterised SQL, exact-origin CORS with credentials, rate limiting,
  input validation, and an audit log of sensitive actions.
- **Supply chain** — every push/PR to `main` runs Gitleaks (secrets), Trivy (deps + images),
  Semgrep (SAST), npm audit and CodeQL. CRITICAL findings block; HIGH are tracked via
  Dependabot. GitHub Actions are pinned to commit SHAs.

Full detail lives in Confluence: **TECHOPS → CapTracker → "CapTracker — Security"**.

## Secrets

Secrets (OIDC client secret, `SESSION_SECRET`, VAPID keys, SSH deploy keys) live only in
`.env.production` on the VM and in GitHub Actions secrets. They must never be committed.
Gitleaks + push protection are the backstop; if a secret is ever committed, rotate it
immediately and notify the maintainer.
