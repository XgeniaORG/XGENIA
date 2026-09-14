# XGENIA

## Agent skills

### Issue tracker

Issues live in GitHub Issues (XgeniaORG/XGENIA) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels, strings equal names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Git workflow

`develop` and `main` are protected. Never commit or push to them directly,
no matter how trivial the change — always branch from `develop`, open a PR
back to `develop`, get it reviewed and approved, then squash-merge. `main`
only moves via a squash-merge from `develop` at release time. See
`docs/agents/git-workflow.md`.
