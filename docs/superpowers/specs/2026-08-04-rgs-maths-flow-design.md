# RGS maths flow — design

**Date:** 2026-08-04
**Branch:** `AICleanup_Fix_2`
**Status:** design, awaiting review

---

## 1. The flow being built

> User + AI author the maths correctly → choose the RNG source → AI *or* user deploys to a
> testing environment → the generated scripts come back.

Four steps, one home. Today the flow is spread across a sidebar panel, the Deploy popup, the
node graph and a document tab, and two of its steps are unreachable.

**Decisions already taken** (from the design conversation):

| Question | Decision |
|---|---|
| What does "deploy to a testing environment" create? | Run `upload → activate → stress-test` and **stop at `testing`**. Promotion to live is a separate, explicit act. |
| Where do the scripts come back to? | **Into the AI's context** — the deploy tool returns the script *and* the coverage report so the AI can verify what it shipped. |
| RNG source | Default **XGENIA online RNG**. Customers may point at **their own RNG via URL**. On success the AI offers to save that provider as a skill. |
| RNG architecture | **The RGS fills `ctx.rng` before the round opens.** The script never makes a network call. |
| Custom RNG interface | **We define it.** Customers implement our shape. |
| Open sandbox RNG | Yes — gated technically, not just by disclaimer. |

---

## 2. Scope

**In:** RNG source selection and the custom-RNG contract; the sandbox gate and provenance
stamp; the converter coverage report; the test → promote lifecycle; returning scripts to the
AI; the Maths RGS panel layout.

**Out (tracked in `docs/RGS-RESTORATION-PLAN.md`, not here):** Multiply's lost `auto` input;
the compiled-copy leak; the hardcoded publish org; the private-submodule hard dependency;
import-back of deployed maths into the editor.

**Size:** this is four subsystems that share one data contract. The design is kept whole
because splitting it would fragment `ctx.rng` and the panel; **implementation splits into four
phases (§10), each getting its own plan.**

---

## 3. What already exists

Grounding, so we build on the substrate rather than beside it:

- `ctx = { bet, rng: number[], state, config, round }` — the RGS **already** supplies
  server-side randomness to every deployed script
  (`packages/xgenia-runtime/src/api/supabase-converter.ts:1152`). The simulation engine
  consumes it identically (`utils/rgs/simulationEngine.ts:233`).
- `CloudFunctionConverter.generateRgsScript()` — node graph → `evaluate(ctx)` body. Intact.
- The lifecycle `upload → activate → stress-test → approve → deploy` exists server-side in
  `maths-deployer`; only its UI was removed.
- `gameModesForOperatorMode()` (`utils/rgs/rgsClient.ts:84`) — a **demo key can only create
  demo games**. This is the sandbox tier, already modelled.
- `canEditDeployedScript()` (`:104`) — the house pattern for a mode gate, and its docblock
  states the rule we follow throughout: *"This is the UI half of the rule only: the real gate
  is in the RGS `maths-deployer` handler."*
- `runBatchSimulation()` — local, script-in, statistics-out.

**Not in this repo:** the `maths-deployer` edge function, `script-sandbox.ts`, and the
`maths_configs` / `game_edge_functions` tables. Every server-side item below is a **contract
we specify here and implement in XRGS.**

---

## 4. RNG design

### 4.1 One source, filled before the round

The RGS populates `ctx.rng` *before* the round opens and passes it in. The script stays a pure
function of `(bet, rng, state)`.

This is the load-bearing property. It gives us:

- **Replay** — store the `rng` array with the round and any spin re-runs exactly, for a player
  dispute or a lab.
- **Honest failure timing** — a provider outage fails before the round opens, not mid-spin.
- **Testable maths** — fix the `rng` array, assert the win. This is what makes "the AI built
  it right" checkable rather than hopeful.

### 4.2 The setting is game-level

RNG source is a compliance property of the game, like declared RTP — **not** a node or
component preference. Every defect found in the archaeology came from settings that lived too
low and drifted silently; a per-node RNG selector is exactly how a game ends up with nine
nodes on the server and one not, with nothing to tell you.

> **Do not restore the old per-node `Mode: Local | XGENIA RGS` dropdown.** It made the node
> POST to `<rgs_url>/spin` — the RGS calling itself while executing the maths it deploys. Its
> removal (private `1ed493f`) was correct. This is recorded because the removal reads like
> vandalism in the git log and is not.

### 4.3 Values

`rngSource` on the game:

- `xgenia` *(default)* — RGS-generated.
- `custom` — fetched from the customer's endpoint, with `rngProviderUrl` + a shared secret.

The editor preview always uses a **local seeded** generator, regardless of `rngSource`, and
says so on screen (§8). Preview is for determinism and speed; it is never the live path.

### 4.4 The custom-RNG contract

We define the shape. A fixed shape is what lets the Test-connection button validate honestly
and keeps `ctx.rng` a plain array on our side.

**Request** — XGENIA RGS → customer endpoint, before the round opens:

```http
POST <rngProviderUrl>
Content-Type: application/json
X-XGENIA-Signature: <hex HMAC-SHA256 of the raw body, shared secret>
X-XGENIA-Timestamp: <unix seconds>
```
```json
{
  "request_id": "3f2a…",
  "game_id": "…",
  "round_id": "…",
  "count": 64,
  "range": { "min": 0, "max": 4294967295 }
}
```

**Response** — HTTP 200, within the timeout:

```json
{
  "request_id": "3f2a…",
  "values": [1837465002, 92847361, "… exactly `count` integers …"],
  "certified": true,
  "provider": "acme-rng"
}
```

**Rules, all enforced server-side:**

| Rule | On violation |
|---|---|
| Responds within `RNG_TIMEOUT_MS` (2000) | `ERR_RNG_PROVIDER_TIMEOUT` |
| `request_id` echoes the request exactly | `ERR_RNG_PROVIDER_MISMATCH` |
| `values.length === count` | `ERR_RNG_PROVIDER_SHAPE` |
| every value an integer within `range` | `ERR_RNG_PROVIDER_RANGE` |
| HTTP 200 | `ERR_RNG_PROVIDER_UNAVAILABLE` |

**No retry inside a round.** A failure means the round does not open. Retrying mid-round is
how you get a half-played spin, which is the failure mode this whole design exists to avoid.

The timestamp header exists so customers can reject replayed requests; the signature so they
can verify the caller is us.

### 4.5 Saving a provider as a skill

When a custom provider validates, the AI offers once: *"Save this RNG provider for reuse?"*
Saved through the existing skills mechanism
(`private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/knowledge/skill-tool.ts`).

**The secret is never written into the skill** — the skill stores provider name, URL and the
validated contract shape; the secret stays in operator settings. A skill is reusable content
and must not become a credential leak.

---

## 5. The open sandbox RNG

Customers may run and test against XGENIA RNG for free. It must be **technically** unable to
serve production; the disclaimer is the last layer, not the only one.

### 5.1 Gates

1. **Demo key → demo games only.** Modelled already in `gameModesForOperatorMode`; the server
   half must enforce it in `maths-deployer`.
2. **Refuse live-mode games** at the RNG endpoint → `ERR_RNG_SANDBOX_NOT_FOR_LIVE`.
3. **Volume cap** per key per day → `ERR_RNG_SANDBOX_QUOTA`. A sandbox serving production
   volume *is* production, whatever it is called.
4. **Provenance stamp** (below).

### 5.2 The stamp is the real control

Every round records where its randomness came from:

```json
"rng_provenance": {
  "environment": "sandbox" | "production",
  "certified": false,
  "provider": "xgenia" | "custom:acme-rng",
  "provider_claimed_certified": true,
  "issued_at": "2026-08-04T12:00:00Z"
}
```

**`certified` is our verdict, not the provider's claim.** A custom endpoint returns
`"certified": true` in its own response (§4.4); we record that verbatim as
`provider_claimed_certified` and otherwise ignore it. The round's own `certified` is computed
by us and is **false whenever `environment` is `sandbox`**, whatever the provider asserted.
Two separate fields, because a customer's self-declaration must never be able to launder a
sandbox round into a certified one — and because keeping the claim on record is exactly what
makes a false claim provable later.

This stops us relying on anyone obeying text. If a sandbox key is used in production anyway,
they have not quietly defeated a control — **they have created a permanent per-round record
that they did**, queryable by us, a lab, or a regulator. It costs nothing: the round already
stores the `rng` array, so provenance rides along.

### 5.3 Disclaimer

Shown at the point of choosing the sandbox, not buried in terms: *"Sandbox RNG is for building
and testing only. It is not certified and must not be used for real-money play. Rounds played
with it are permanently marked as uncertified."*

---

## 6. Correctness: the coverage report

The converter currently **drops unknown node types silently** — a graph can publish green and
compute nothing down whole branches. This is the highest-value safety item in the flow.

`generateRgsScript()` gains a second return value:

```ts
coverage: {
  converted: string[];   // node id + type
  stubbed:   string[];   // matched a registry entry of kind 'stub' — emits a constant
  dropped:   string[];   // matched no registry — no code emitted at all
  betToWinPath: string[];// nodes reachable on the bet → win chain
}
```

The classification already exists at collection time; it simply is not returned.

**Rules:**

- `dropped ∩ betToWinPath ≠ ∅` → **hard-fail the deploy.** Money depends on that path.
- `stubbed ≠ ∅` → **warn before the confirm**, naming each node. `RTP Monitor` and
  `Volatility Monitor` are `kind: 'stub'` today
  (`packages/xgenia-runtime/src/api/rgs-extra-node-converter.ts:86-87`) — they emit constants,
  so a deployed game reads 0.00 RTP forever while the editor preview shows the right number.
- The report is shown **in the confirm dialog, before deploying.** Shown afterwards it is a
  post-mortem; shown before it is a save. *"3 nodes will do nothing on the server"* is the most
  valuable sentence this UI can say.

---

## 7. Test → promote lifecycle

Two verbs. Everything else is a menu item.

```
[ Test ]                       [ Promote to Live ]
   │                                    │
   ▼                                    ▼
compile → coverage gate            approve → deploy
  → upload → activate                    │
  → stress-test                          ▼
        │                             [ LIVE ]
        ▼
    [ TESTING ]  ← RTP, hit rate, max win, volatility, spin count
```

**Test** stops at `testing` and attaches the measured statistics. **Promote to Live** is a
separate deliberate act, disabled until a version has passed a test run.

Both are callable by the **user** (buttons) and by the **AI** (tools) against the same
handlers — no second code path, or the two drift.

---

## 8. UI

The Maths RGS panel becomes the single home for the maths lifecycle, ordered top-to-bottom to
match the workflow:

```
Maths RGS
├─ Connection            operator, mode, wallet
├─ Game                  target
├─ Maths Components      your graphs                    [restored 2026-08-04]
├─ RNG source            ( ) XGENIA  ( ) Custom URL     [new]
├─ [ Test ]  [ Promote to Live ]
├─ Test Results          RTP / hit / max win + coverage [new]
└─ Deployed Functions    server truth, read-only
```

**The governing principle: the UI shows server truth, not local intent.**

Nearly every defect in the archaeology was a screen asserting something the backend did not
agree with — a green publish over dropped nodes, an RTP monitor reading 0, "Components"
meaning two different things, a success toast naming a component it had not deployed. So:

- the RNG chip on a deployed function is **read back from the server**, not from local config;
- displayed RTP is the **measured** one; where the server does not know, the UI says
  "unknown" rather than showing a local hope;
- the editor preview carries a permanent chip — *"Preview RNG: local seeded (deterministic)"*
  — so preview behaviour is never mistaken for live.

Custom RNG needs a **Test connection** button that performs a real signed fetch and shows the
returned sample, latency, and a pass/fail per §4.4 rule. **Save stays disabled until it
passes.** Nobody should be able to save a URL that does not work.

---

## 9. Error handling

- RNG provider failures (§4.4) abort **before** the round opens; the player never sees a
  partial round.
- Coverage hard-fail aborts **before** upload; nothing reaches the RGS.
- Sandbox gate violations return a typed `ERR_` code, matching the existing compliance-gate
  style rather than inventing a parallel scheme.
- Every failure names the offending thing — the node, the rule, the URL. No
  `GENERIC_DEPLOY_ERROR`; `XgeniaDeployTab.tsx:48` currently reports every GitHub-stage failure
  as `'Project compilation error'`, which sends people to debug the wrong subsystem.

---

## 10. Implementation phases

Each phase is independently shippable and gets its own plan.

| Phase | Content | Depends on |
|---|---|---|
| **1 — Reachability** | Restore the trigger for `handleUploadTestDeploy` (`setShowTestConfigModal(true)` occurs **zero** times today, so the pipeline is dead code); wire Test / Promote as the two verbs; expose both as AI tools. | — |
| **2 — Truthfulness** | Coverage report, the confirm-dialog gate, the hard-fail rule, and returning script + coverage to the AI. | 1 |
| **3 — RNG source** | Game-level `rngSource`, the custom-provider contract, Test connection, save-as-skill, preview chip. | 1 |
| **4 — Sandbox** | Demo-key gates, quota, provenance stamp, disclaimer. Mostly XRGS-side. | 3 |

---

## 11. Testing

- **Guard tests** (source-level, in `private/xgenia-ai-app/tests/`, alongside the existing
  `maths-sheet-mount.test.ts`): an entry point exists for `handleUploadTestDeploy` — this is
  exactly the rot that produced Phase 1; the stub registry is explicitly enumerated so adding a
  stub is a deliberate reviewed act.
- **Converter coverage test:** a representative slot graph converts with zero `dropped`.
- **Contract tests** for the custom-RNG rules — one per row of the §4.4 table, each asserting
  the specific `ERR_` code.
- **Parity harness:** the same graph through the editor evaluator and the generated script,
  same seeded `rng`, asserting identical output over N spins. `generateISAACRNGLogic` is
  commented *"Simplified ISAAC implementation for Edge Functions"* — a reimplementation, so
  editor and server ISAAC may already diverge. For an RNG this is certification-grade and the
  harness is the only durable answer.
- **Determinism test:** fixed `rng` array in, identical result out, twice. This is the property
  the whole design rests on; it should fail loudly if it ever stops holding.

---

## 12. Open items

1. **XRGS repo access.** Phases 3 and 4 are mostly server-side. This design specifies the
   contracts; someone must implement them in `maths-deployer`.
2. **`list-edge-deployments` payload** — does a row carry `maths_config_id`? One field
   unblocks importing a deployed version back into the editor (out of scope here, tracked in
   the restoration plan).
3. **Quota numbers** — spins/day for the sandbox tier is a commercial decision.
4. **Existing games** — `rngSource` needs a default for games created before it existed.
   Recommend `xgenia`, since that is the behaviour they already have.
