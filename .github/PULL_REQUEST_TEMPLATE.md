<!--
PR title must follow Conventional Commits, e.g.:
  feat(delivery): add drag-to-reorder on My view
  fix(auth): reject empty SESSION_SECRET at boot
Types: feat, fix, chore, docs, refactor, perf, test, build, ci, revert
-->

## What & why

<!-- What does this change do, and why? Link the Jira issue, e.g. ITE-XXXXX. -->

Relates to: ITE-

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / tech debt
- [ ] Docs / chore
- [ ] Migration / schema change

## How was it tested?

<!-- Unit/integration tests, manual steps, screenshots for UI changes. -->

## Checklist

- [ ] `npx tsc` passes for both `server` and `web`
- [ ] Tests added/updated and passing in CI
- [ ] No secrets, keys, or credentials committed
- [ ] DB migration included if schema changed (and safe to run on startup)
- [ ] Breaking/behavioural changes called out above and communicated to affected users
- [ ] Linked the relevant Jira issue
