# The OpenRouter key follows the account

## The report

> "I manually restarted the entire app again, and once again received a pop-up asking me to
> enter the OpenRouter API key. After restarting the app one more time, the pop-up disappeared
> and the app worked normally."

The key was on disk the whole time.

## What was wrong

The key lived in exactly one place — this machine's `editorSettings.json` — and the AI Chat
panel, which is an iframe, could only learn about it by asking the editor across a postMessage
bridge. Three things stacked up:

1. **The editor answered before it knew.** Under Electron, `editorSettings` is a *file*
   (`StorageNode`), so `EditorSettings.instance.get()` returned `undefined` until an async load
   completed. The bridge's `settings.get` handler answered with whatever it had at that instant.
2. **The panel asked too early.** `BridgeSettingsStore` fired its ~30-key pre-load from its
   constructor, which can run before the postMessage handshake. Commands sent to a host that is
   not listening yet are simply never answered, so they sat until their 30-second timeout.
3. **The panel decided on a timer.** `ChatPanel` judged "does the user have a key?" 500 ms after
   mount. Lose the race and it raised *XGENIA AI Setup Required* — the pop-up.

Restarting re-rolled the timing, which is why the third launch "worked normally".

And underneath all of that, the key was machine-local: a reinstall, a second machine, or a
cleared profile lost it for good.

## What it does now

The key belongs to the **Primora account**, in `public.user_ai_provider_keys` on the Supabase
project the editor already signs into (`pcrghrjikkcmelflwiys`).

```
  Primora DB ──pull on login──▶ EditorSettings.aiProvider ──push──▶ AI Chat panel (iframe)
       ▲                                    │                            │
       └──────────── push on change ────────┴────── settings.set ────────┘
```

* **`AiProviderKeyVault`** (editor) subscribes to the Supabase auth state. On login it pulls the
  account's key, reconciles it with whatever is stored locally, and writes the winner into
  `EditorSettings`. On every local change it uploads the new key. On sign-out it clears the local
  copy — but only when it knows the account is holding it, so an offline session that never got
  to upload never loses the user's only copy.
* **`AiProviderKeyReconcile`** (editor, pure) decides which side wins. Newest change wins, except
  that the `keyOwnerId` stamp is checked first: a key left behind by whoever last used this
  machine is never uploaded into the account of whoever signs in next.
* **`EditorBridge`** pushes `aiProvider` to the panel on handshake and on every change, instead of
  waiting to be asked, and `settings.get` now waits for the settings file to load before
  answering. `pushEvent` queues per setting, so a queued `fal.apiKey` cannot evict a queued
  `aiProvider`.
* **The panel** takes pushed settings straight into its cache, waits for the bridge handshake
  before pre-loading, and no longer judges the key on a 500 ms timer.

### Why the editor and not the panel

The panel is served from Vercel, so panel-side changes only reach users after a redeploy of
`private/xgenia-ai-app`, and it has no Supabase session of its own. The editor owns the session
and owns `EditorSettings`, which the panel already reads. **The account binding works from an
editor build alone**; the panel changes are hardening on top.

## The table

```sql
public.user_ai_provider_keys (
  user_id uuid, provider text, api_key text, verified bool,
  key_hint text, created_at timestamptz, updated_at timestamptz,
  primary key (user_id, provider)
)
```

Migration: `private/supabase/migrations/20260828120000_user_ai_provider_keys.sql`
(rollback alongside it).

* **RLS is own-row only, for `authenticated` alone.** Four separate policies rather than one
  `FOR ALL` — a permissive ALL-policy is exactly the shape that gave every authenticated user
  every command on `profiles`/`user_subscriptions` (fixed 2026-08-19), and this table holds
  secrets. `anon` has no grants at all, and `TRUNCATE` (which bypasses RLS) is revoked from
  `authenticated`.
* **There is no super-admin read policy.** Nobody but the owner needs the plaintext key;
  `key_hint` (last 4 characters) is there so support can identify a key without reading it.
  `service_role` has `BYPASSRLS` if a platform function ever needs it.
* **The key is not unique.** Several users legitimately share one OpenRouter key — each holds
  their own row, and revoking one user's copy leaves the others alone.

The key is stored as plaintext under own-row RLS. That is the same trust level as the local
settings file it replaces, and the client needs the raw value to call OpenRouter (and to
pre-fill the field). Encrypting at rest with a key the client must also hold would move the
problem, not solve it.

## Where things live

| Concern | File |
|---|---|
| Two-way sync, auth lifecycle | `packages/xgenia-editor/src/editor/src/services/AiProviderKeyVault.ts` |
| Who-wins rules (pure) | `packages/xgenia-editor/src/editor/src/services/AiProviderKeyReconcile.ts` |
| Settings load signal | `packages/xgenia-editor/src/editor/src/utils/editorsettings.ts` (`ready`) |
| Bridge push + `settings.get` wait | `.../views/panels/ChatPanelBridge/EditorBridge.ts` |
| Panel-side cache and pushes | `private/xgenia-ai/src/ChatPanel/utils/settings-bridge.ts` |
| Migration | `private/supabase/migrations/20260828120000_user_ai_provider_keys.sql` |
| Tests | `private/xgenia-ai-app/tests/openrouter-key-account-binding.test.ts`, `private/xgenia-ai/src/__tests__/regression-lock/openrouter-key-prompt.test.ts` |

## Gotchas

* `AIProviderSettingsManager` **cannot** be used to persist a key from the editor renderer. It
  writes through `SettingsBridge`, whose editor-side fallbacks are `window.EditorSettings` (never
  set) and `EditorProxy` (iframe only), so it resolves to an in-memory store and the write is
  gone on reload. `OAuthFlowManager` was doing exactly this, which is why connecting OpenRouter
  by OAuth appeared to work and then silently didn't. Write to `EditorSettings.instance` (or go
  through the vault).
* `EditorSettings.set` **replaces** the whole `aiProvider` object. Every write here is a
  read-modify-write, or the user's model choices go with it.
* `supabase-js` holds its auth lock for the duration of an `onAuthStateChange` callback and every
  PostgREST call queues behind it — the vault's handler only records state and defers the work.
* If the migration has not been applied to a project, the vault logs once and leaves the local
  key working. Nothing breaks; the binding is simply inactive.
