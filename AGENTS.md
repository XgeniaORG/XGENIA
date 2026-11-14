# XGENIA

## Agent skills

### Issue tracker

Issues live in GitHub Issues (XgeniaORG/XGENIA) via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical labels, strings equal names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Sizing, placing and scaling

Four layers (box, placement, scaler, content fit) and ONE scale-mode vocabulary shared by
Group's `uiScaleMode` and pixi.Stage's `fitMode`: `none, fit, fill, expand, matchWidth,
matchHeight, stretch`. Read `docs/ui-scaling.md` before touching Dimensions, Alignment or
UI Scaling ports, or before answering a "things move when I resize" report.

### Git workflow

`develop` and `main` are protected. Never commit or push to them directly,
no matter how trivial the change — always branch from `develop`, open a PR
back to `develop`, get it reviewed and approved, then squash-merge. `main`
only moves via a squash-merge from `develop` at release time. See
`docs/agents/git-workflow.md`.
