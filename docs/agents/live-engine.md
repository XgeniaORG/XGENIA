# Live engine

Engine, slot nodes and the RGS compiler reach installed apps without an app release.
Design: `docs/superpowers/specs/2026-10-03-live-engine-design.md`.

## How a change reaches users

1. Merge to `develop` (outer) or push to private `main` (pro/agent nodes).
2. The `Live Engine` workflow tests, builds, signs and publishes the engine to **beta**.
3. Apps on beta (`XGENIA_ENGINE_CHANNEL=beta`, or `<userData>/engine/settings.json` = `{"channel":"beta"}`)
   download it within 6 h (15 s after start) and run it from their next start.
4. Promote to **stable** (everyone): Actions → Live Engine → Run workflow → `action: promote`
   (empty version = current beta), or `node scripts/live-engine/promote.mjs [version]` with both keys set.

## Rollback

Promote the previous version: `action: promote`, `version: <old version>`. Apps install it (newer
issuedAt) and run it from their next start. An engine whose preview never comes up on a machine is
dropped there automatically on the next start.

## When an engine change needs an editor change

Bump `SHELL_API_VERSION` (`packages/xgenia-editor/src/main/src/live-engine/shell-api.js`) and
`minShell` (`packages/xgenia-viewer-react/engine-compat.json`) in the same PR. An engine runs only on
the shell it was built for: older apps keep their current engine and record `needsAppUpdate` until they
get an app build; the new app ignores engines built for the old shell and runs its own until CI
publishes one for the new shell.

## What a machine runs

`<userData>/engine/state.json` (the production main process silences `console.log`, so this is the record):
- `lastStart` — what this start chose (`version`, `source`, `reason`); `lastCheck` — the last update check.
- `active`, `previous` (always an engine that proved itself), `pending`, `trial`, `trialTimedOut`, `bad`,
  `needsAppUpdate`, `accepted` (replay floor per channel).
- Compiled RGS scripts: the statement `var __xgeniaCompiler = "<version>";` (`"bundled"` = the app's
  own compiler). It is a statement, not a comment, because the sandbox sanitiser strips comments.

## Switches

- `XGENIA_ENGINE=builtin` — run the app's own engine, never download.
- `XGENIA_LIVE_ENGINE=1` — let a development build use and download live engines.
- `XGENIA_ENGINE_CHANNEL=beta|stable` — channel override.

## Secrets and the `live-engine` environment

`ENGINE_SIGNING_KEY` and `SUPABASE_ENGINE_SERVICE_KEY` are used only by the `publish` and `promote` jobs,
which install no npm packages and run in the GitHub environment `live-engine`. Store both as
**environment secrets** of `live-engine` and restrict its deployment branches to `develop` (add a
required reviewer for promote if wanted); repo-level secrets would be readable from any branch.

## Signing key

Private key: the `ENGINE_SIGNING_KEY` environment secret only. Public key: `src/main/src/live-engine/public-key.js`.
Rotating means `node scripts/live-engine/keygen.mjs <out.pem>`, a new secret, and a new app build.

## Building a pack locally (no upload)

```bash
export XGENIA_ENGINE_VERSION="$(date -u +%Y%m%d.%H%M)-$(git rev-parse --short=8 HEAD)-$(git -C private rev-parse --short=8 HEAD)"
OUT=$(mktemp -d)
OUTPUT_PATH=$OUT/files npm run build -w @xgenia/xgenia-viewer-react
node scripts/live-engine/build-compiler.mjs $OUT/files/compiler/xgenia.rgs-compiler.js "$XGENIA_ENGINE_VERSION"
ENGINE_SIGNING_KEY="$(cat <key.pem>)" node scripts/live-engine/pack.mjs --files $OUT/files --out $OUT/upload --channel beta
node scripts/live-engine/smoke.mjs $OUT/upload beta
```
