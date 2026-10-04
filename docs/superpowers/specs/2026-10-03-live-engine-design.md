# Live engine — design

2026-10-03. Problem, measured that day: the AI side (Vercel panel, Railway agent server, Supabase
functions, XRGS) deploys within minutes, but everything inside the desktop app — the game engine
and slot nodes (`xgenia.viewer.js`, `xgenia.deploy.js`) and the RGS maths compiler — reaches users
only through an app build. There have been two GitHub releases (last V2.1.0, 2026-06-15); the in-app
updater reads GitHub releases and testers run 3.0.1-beta builds, so it offers nothing. `main` pins
`private/` 498 commits behind private `main`. PR #152 (RGS compiler: loops, Cascade The Reels,
Expression) merged on 2026-10-03 and still reaches nobody.

## Goal

Engine, slot-node and RGS-compiler changes reach installed apps within minutes of a green push to
outer `develop` or private `main` — no app release, no submodule pointer bump — and only if they are
signed by our CI.

## What changes

1. **Engine pack.** A CI job builds, from outer `develop` + private `main` (not the pin):
   - `viewer/` — today's `src/external/viewer` output (preview engine, all nodes)
   - `deploy/` — today's `src/external/deploy` output (exported/published games)
   - `compiler/xgenia.rgs-compiler.js` — the RGS compiler (`supabase-converter.ts`) as one CommonJS file

   Each file is gzipped and uploaded to the public Supabase Storage bucket `engine` under
   `<version>/files/`. A `manifest.json` lists every file's path, size and sha256, plus
   `version`, `channel`, `issuedAt`, `minShell`, `filesBase`. CI signs the manifest bytes with an
   ed25519 key (GitHub secret `ENGINE_SIGNING_KEY`); the app carries the public key.
2. **Channels.** Every green push publishes to `channels/beta/`. `channels/stable/` changes only by a
   one-click "promote" run, which re-signs a chosen version's manifest with a new `issuedAt`.
   Rollback = promote an older version. Apps follow `stable` unless `XGENIA_ENGINE_CHANNEL=beta` or
   `userData/engine/settings.json` says `{"channel":"beta"}`.
3. **App loader (main process).** At startup, before the window opens, the app picks the engine for
   this run: a downloaded engine whose signed manifest verifies and whose files all match their
   hashes, else the built-in one. The choice sets `XGENIA_ENGINE_ROOT`; the web server serves
   `viewer/` from it, export reads `deploy/` from it, the Maths panel loads the compiler from it.
   15 s after start and every 6 h it checks the channel, downloads a newer signed engine in the
   background, and activates it at the next start (never mid-session: preview, export and compiler
   must come from one version).
4. **Safety.**
   - Nothing unsigned runs; every file is hash-checked at download and again at startup.
   - A manifest older than the last accepted one is refused (replay), as is one for another channel.
   - Manifest paths are confined to `viewer/`, `deploy/`, `compiler/`.
   - A new engine runs on trial: if its preview does not report in within 90 s of the viewer bundle
     being served, or the app dies before it does, it is marked bad and the next start returns to the
     previous engine.
   - Development builds (`!app.isPackaged`) never download; `XGENIA_LIVE_ENGINE=1` opts in,
     `XGENIA_ENGINE=builtin` forces the built-in engine.
5. **Compatibility.** `SHELL_API_VERSION` (app) and `minShell` (pack, from
   `packages/xgenia-viewer-react/engine-compat.json`). An engine that needs a newer app is not
   installed; the app records `needsAppUpdate`. Bump both in the same PR when an engine change needs
   an editor change.
6. **Version stamps.** The pack's version is compiled into both bundles and the compiler. The preview
   reports it with its node library; every compiled RGS script carries `// Compiler: <version>`,
   and the Maths panel's `generateRgsScript` returns `compilerVersion`.

## Not in this step

- The cloud runtime (`src/external/cloudruntime`, needs Node) stays built-in.
- Games already published keep the engine they were exported with (what certification wants).
- The AI reading engine versions over the bridge, freezing the bridge, automatic app releases,
  loading the editor UI from the web — later plans.

## One-time cost

The loader itself ships in one more app build. After that, engine fixes need no release.
