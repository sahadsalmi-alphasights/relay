# GitHub Enterprise Hardening — Settings Checklist

The repo files (CODEOWNERS, SECURITY.md, templates, CodeQL/stale/PR-title workflows,
tightened Dependabot, LICENSE) are committed. The items below are **repository/org settings**
that must be toggled in the GitHub UI — they can't be set from code. Do these once.

Repo: `sahadsalmi-alphasights/relay`

---

## 1. Branch protection — `main` (Settings → Rules → Rulesets → New branch ruleset)

Target: `main`. Enable:

- [ ] **Require a pull request before merging**
  - [ ] Require **1+ approval** (2 once the team grows)
  - [ ] **Dismiss stale approvals** on new commits
  - [ ] **Require review from Code Owners** (activates CODEOWNERS)
  - [ ] Require approval of the **most recent push**
- [ ] **Require status checks to pass**, and mark these as required:
  - `Secret scanning (Gitleaks)`, `Dependency vulnerability scan (Trivy)`,
    `Static analysis (Semgrep)`, server build/test, web build,
    `Container image scan (Trivy)`, `Analyze (javascript-typescript)` (CodeQL), `PR title`
  - [ ] **Require branches to be up to date** before merging
- [ ] **Require conversation resolution** before merging
- [ ] **Require linear history** (pairs well with squash-only, below)
- [ ] **Require signed commits** (see §5)
- [ ] **Block force pushes** and **restrict deletions**
- [ ] Do **not** allow bypass (or restrict bypass to a break-glass admin only)

## 2. Merge settings (Settings → General → Pull Requests)

- [ ] Allow **squash merging** only (disable merge commits & rebase) — keeps history linear
- [ ] Default squash commit message = **PR title** (matches the Conventional-Commit lint)
- [ ] **Automatically delete head branches** after merge

## 3. GitHub Advanced Security (Settings → Code security and analysis)

- [ ] **Dependency graph** — on
- [ ] **Dependabot alerts** — on
- [ ] **Dependabot security updates** — on
- [ ] **Secret scanning** — on
- [ ] **Push protection** (blocks commits containing secrets) — on
- [ ] **Code scanning / CodeQL** — on (the committed `codeql.yml` provides the analysis;
      GHAS must be enabled on this private repo for results to appear)
- [ ] **Private vulnerability reporting** — on (SECURITY.md points at it)

> Note: on a **private** repo, CodeQL + secret scanning require GitHub Advanced Security
> (Enterprise plan or per-seat GHAS). If GHAS isn't available, the Trivy/Semgrep/Gitleaks
> jobs already in `pipeline.yml` remain the SAST/secret/dep gate.

## 4. Actions security (Settings → Actions → General)

- [ ] Allowed actions: **"Allow select actions"** — enable only GitHub-owned + explicitly
      trusted; consider **"Require actions to be pinned to a full-length commit SHA."**
- [ ] Workflow permissions: **read-only by default**; require explicit `permissions:` in
      workflows (already done in the committed workflows)
- [ ] Fork PRs: **require approval for all outside collaborators**

## 5. Signed commits (org or personal)

- [ ] Enable **commit signing** (SSH or GPG) locally and turn on "Require signed commits"
      in the ruleset. `git config --global commit.gpgsign true` + a configured signing key.

## 6. Protected deploy environment (Settings → Environments)

- [ ] Create an environment named **`production`**
  - [ ] **Required reviewers** — deploys wait for manual approval
  - [ ] **Deployment branches** — restrict to `main` only
  - [ ] Move deploy secrets (SSH key, host) into the environment (not repo-wide)
  - [ ] In `pipeline.yml`, add `environment: production` to the deploy job so approvals apply
- [ ] Longer term: switch VM/GHCR auth to **OIDC** (federated, short-lived tokens) instead of
      long-lived secrets where possible.

## 7. Tag / release protection

- [ ] Add a **tag ruleset** protecting `v*` tags (restrict who can create/delete)
- [ ] Adopt release tagging (`vMAJOR.MINOR.PATCH`) and GitHub Releases with auto-generated notes

## 8. Access & org hygiene

- [ ] Create a **GitHub team** (e.g. `@alphasights-eng/captracker`) and grant repo access via
      the team, not individuals; then update `.github/CODEOWNERS` to the team handle
- [ ] Enforce **2FA** at the org level
- [ ] Set repo visibility to **private/internal** (confirm) and review outside collaborators
- [ ] Add a repo **description, topics, and homepage** (captracker.alphasights.ae)

---

### What's already in the repo (no action needed)

CODEOWNERS · SECURITY.md · CODE_OF_CONDUCT.md · LICENSE · PR template · issue templates +
config · CodeQL / PR-title / stale workflows · tightened Dependabot (npm, docker,
github-actions, grouped, labelled) · `.editorconfig` · `.nvmrc` · the existing 7-job
security pipeline (Gitleaks, Trivy fs, Semgrep, build/test, container scan, GHCR push, deploy).
