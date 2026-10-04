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
`minShell` (`packages/xgenia-viewer-react/engine-compat.json`) in the same PR. Older apps keep
their current engine and record `needsAppUpdate` until they get an app build.

## What a machine runs

- Main-process log line: `[live-engine] live <version> — …` or `[live-engine] builtin builtin — <reason>`.
- `<userData>/engine/state.json`: `active`, `previous`, `pending`, `trial`, `bad`, `needsAppUpdate`.
- Compiled RGS scripts: the statement `var __xgeniaCompiler = "<version>";` (`"bundled"` = the app's
  own compiler). It is a statement, not a comment, because the sandbox sanitiser strips comments.

## Switches

- `XGENIA_ENGINE=builtin` — run the app's own engine, never download.
- `XGENIA_LIVE_ENGINE=1` — let a development build use and download live engines.
- `XGENIA_ENGINE_CHANNEL=beta|stable` — channel override.

## Signing key

Private key: GitHub secret `ENGINE_SIGNING_KEY` only. Public key: `src/main/src/live-engine/public-key.js`.
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
