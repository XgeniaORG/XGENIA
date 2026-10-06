# ASTRAFORGE run (2026-09-19) — every issue found in the three debug exports

Source: `~/Downloads/xgenia-debug-export-1789888860643 _ debug 1.json` (d1),
`…1789888852242 _ debug 2 .json` (d2), `…1789888840782 _ Debug 3.json` (d3).
Same project ("Astraforge: Eclipse Engine", 461 nodes / 549 wires / 12 components), three
conversations, 01:26Z → 13:53Z on 2026-09-19. Main model `z-ai/glm-5.3-flash`
(61.1M tokens, $4.92 in d3 alone), sub-agents `anthropic/claude-opus-5` (116k tokens).

Every claim below was checked against the export data and, where it says `file:line`,
against the source in this checkout. Nothing was patched. Companion doc with the
root-cause map: [2026-09-19-xgenia-ai-confusion-root-cause-map.md](2026-09-19-xgenia-ai-confusion-root-cause-map.md).

## Run shape

| | d1 | d2 | d3 |
|---|---|---|---|
| user turns | 9 | 3 (3rd is a re-send 1 s before the conversation died) | 2 |
| assistant messages | 167 | 15 | 29 |
| tool calls | 480 | 41 | 379 |
| tool results condensed to "KEY FACTS ONLY" | **203 (42.3 %) — 1.30 M chars gone** | 0 | 81 (21.4 %) — 1.08 M chars gone |
| verify-gate calls / blocked | 17 / 13 | – | 5 / 4 |
| `find_connections` calls | 32 | 4 | **199 (52 % of all calls)** |
| panel iframe replacements during the window | **21** | – | – |

Per-turn: the two longest d1 turns were the round-end reset (27 min, 43 assistant msgs) and
FreeSpins (16 min, 36 msgs). d3's board-binding turn ran 39 min / 24 msgs and ended by hitting
the 200-iteration absolute cap.

---

## A. Loops the harness did not stop

**A1. 174 consecutive identical `find_connections` calls, none blocked, none warned.**
d3 tool indices 164–337, input byte-identical:
`{componentPath:"/Components/AstraforgeUI", pattern:"BetUpButton|BetDownButton|LedgerRow0|…|LedgerRow4"}`.
Every one returned `count: 5` (the five LedgerRow wires; the two Bet buttons had no wires).
Raw API history: 170 assistant turns consisting of a single `tool_use` block — no text, no
thinking. The AI's own thinking at d3.th[21]: *"I need to stop this loop."*
Root cause (proven by repro, see map RC3): in
`private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/utils/tool-repetition-detector.ts`,
Strategy 6 (mutation starvation, ~L418–520) runs **before** Strategy 1 (consecutive-identical,
~L555) and every branch does `return this.emit(...)`, so once `consecutiveReadOnlyCalls ≥ 25`
the identical-call counter is never reached again. A fresh detector blocks the 7th identical
call; after 30 distinct reads it never blocks (`firstWarn=-1, firstBlock=-1`). Strategy 6 itself
was downgraded to warn-only because `classifyIntent(pinnedRequest)` returned
`{diagnostic:true, mutation:true}` — the "both" quadrant that by design never blocks.

**A2. Every volume guard is advisory.** Distinct warning texts seen: *"This is NOT being
blocked"*, *"No limit is enforced — this is awareness only"*, *"you decide how to proceed"*,
*"FYI: 255 structural mutations this turn (reference level ~25)"*. None changes control flow.

**A3. Warn-cooldown makes `check()` return `null`.** `emit('warn')` under cooldown returns
`null`; the caller (`shared-tool-execution.ts:2047`) reads `null` as "no repetition".

**A4. Auto-continuation drives the AI back into a gate it cannot pass.**
`InteractiveAgenticsSystem.ts:258 MAX_AUTO_CONTINUATIONS = 2`; console:
`[AutoContinuation] verify_completion returned canComplete:false … Forcing continuation`,
`🚨 DONE-AFTER-BLOCK`, then `[ProxyProvider] ABSOLUTE CAP HIT (200). This indicates smart
guards failed.` (`ProxyProvider.ts:92 MAX_ITERATIONS = 200`).

**A5. `_session_status` alternates between `"unchanged"` and a full object for identical
calls** (118× vs 14× among the 174) — identical work produces non-identical results, so any
result-hash dedup would also miss the loop.

**A6. Intent regex cannot see this request.** `MUTATION_INTENT_RE` (detector L200) has no
*bind / drive / feed / expose / route*; "Bind the three boards … Drive each cell's text" only
counted as mutation because "wire" appears in a conditional clause.

---

## B. Wires that exist in the store but not at runtime ("stuck on spin")

**B1. `@SpinButton:click → @Component Outputs:Spin`.** The real Button output is `onClick`.
The wire was created (in a conversation not exported), persisted in project.json, listed by
`find_connections`, counted as valid by `get_connection_health` (110/111), and only caught
hours later by `verify_logic_correctness` as `phantom_source_port`. Runtime console:
`[Node.connectInput] Source node "net.xgenia.controls.button" has no output "click"`. Fixed at
d3[363–364]. The spin button was dead for the whole UI phase.

**B2. Six JS-function INPUT wires without the `in-` prefix — dead at runtime.**
In `/Components/AstraforgeUI/Logic`: `@Component Inputs:CoreGrid → @ReadoutFormatter:CoreGrid`,
and likewise `MaskTier, MultiplierChain, UnderlayerState, WinLedger, BetValue` (bare), while
`HeatValue…RoundAward` correctly use `in-HeatValue`. Runtime:
`[NodeScope.addConnection] Skipped connection … Invalid connection, input doesn't exist` **×6**.
`packages/xgenia-runtime/src/nodes/std-library/simplejavascript.js:351-352` —
`inputPrefix: 'in-', outputPrefix: 'out-'`.
**Consequence: the 7×7 Core board, the mask-tier name, the ledger and the underlayer
indicators never receive data at runtime, although project.json shows every wire.** The
user's own check ("I verified this directly in project.json… the ledger rows are bound and
rendering") was fooled by the same store/runtime split.

**B3. Six JS-function OUTPUT wires without the `out-` prefix — dead at runtime.**
`@ReadoutFormatter:LedgerRow0..4Text → @Component Outputs:LedgerRowNText` and
`LedgerEmptyText` (bare), while the 79 cell wires correctly use `out-CoreCellNText`. Runtime:
`Source node "JavaScriptFunction" has no output "LedgerRow0Text"` ×5, `…"LedgerEmptyText"` ×1.

**B4. The validator fails open for JS-function ports.**
`tools/creation-tools/create-connection.ts:1668`: *"All other ports on JS functions are
assumed to be dynamic (defined in code)"* → `exists: true`. `get-connection-health.ts:640-700`
takes the same path. Yet the panel already has a body scanner (`detectJSFunctionPorts`,
`// scriptOutputs:` inference) that can enumerate these ports — the information exists and is
not used at wire-creation time.

**B5. Runtime rejection is console-only.** `NodeScope.addConnection` skips and warns; nothing
reaches the AI's tool results, the audit, or the user.

**B6. Three port-naming conventions.** Component Inputs/Outputs: bare. JavaScriptFunction:
`in-`/`out-`. Javascript2: bare (auto-corrected by `script-node-port-rules.ts`; JavaScriptFunction
is not). The AI tried `CoreCell0Text` (12 failures) and `out-CoreCell0Text` (12 failures) against
`ComponentInstance /Components/AstraforgeUI/Logic` — both wrong, because an instance exposes
only what the sub-component's *Component Outputs node* declares (d3.th[8-9]). 24 wasted
mutations plus the batch churn that followed.

**B7. Exposing a sub-component value is a three-step dance the AI learned by failing:**
(1) assign `Outputs.X` in the JS body, (2) add port `X` to the sub-component's Component
Outputs, (3) wire `@JS:out-X → @Component Outputs:X`; only then does `@Instance:X` exist.
No tool does this as one operation.

**B8. Static scanner cannot see `Outputs['CoreCell'+i+'Text']`.**
`[validateAndFixScript] CRITICAL: Dynamic output patterns detected but could not auto-infer
port names` → the AI rewrote the body as 79 explicit assignment lines (d3.th[11]).

**B9. `safe_connection_workflow` validate-half vs create-half disagree** — documented in the
header of `utils/script-node-port-rules.ts`; same defect class as B4.

**B10. Wrong-component writes.** d3[71] git message: *"the 6 wires I added were targets on
the WRONG Component Outputs node — AstraforgeCore has no such ports"*, caused by E1.

---

## C. Audit and completion-gate design

**C1. The audit's cycle remedy is a Timer, with no notion of the RGS.**
`tools/debugging/verify-logic-correctness.ts:6531` (`signal_cycle` fix text): *"If the loop is
MEANT to tick periodically, drive it through a Timer node…"*. System prompt
`private/supabase/functions/ai-chat/system-prompt.ts:182`: *"Then loop to step 2 (Timer beat
for the animation, or straight through)"*; `:154` sanctions the Timer-restart loop; `:820`
"Timer is EXEMPT from the redirect". Nothing says "never under `/#__maths__/`" even though
`:1451` says location decides deployment. The user had to remove the Timer twice (d1 chat[55],
then again after chat[142]).

**C2. Memory recorded the banned pattern as the project convention, and the top rule made
the AI obey it.** d1[347] `memory checkpoint`:
`conventionDetected: "…Timer-beat shape for cascade loops"`. System prompt `:110`
**0b-rule0 "CONFORM TO PROJECT CONVENTIONS over house defaults (THE OVERRIDING RULE)"**.
d1 chat[142]: *"Per the project's own recorded convention, I replaced it with @CascadeBeat
(250 ms Timer)."* `conventionDetected` is free text the AI writes about itself
(`tools/unified/unified-memory.ts:67`, `ai-checkpoint-tools.ts:205`).

**C3. Gate demands a runtime proof the directive forbids.**
`tools/app-state/game-documentation.ts:3719` "MATHS MUTATION WITHOUT RUNTIME VERIFICATION …
never called simulate_signal"; `:3751` "SIMULATE_SIGNAL NEVER MATCHED". `simulate_signal`
answers `NO_INSTANCE` / `SUBCOMPONENT_TARGET` for an un-instanced maths component, and the user
banned instancing (it wedges the editor). System prompt `:410` itself says *"Do NOT expect
simulate_signal to runtime-validate the maths at this stage"*. Prompt and gate contradict;
the AI built a scaffold instance in `/App` to satisfy the gate (d1 chat[125]) — the exact
wedge shape — deleted it, and the gate then failed on "impossible now" (chat[139]).

**C4. A game-design assumption is a NON-BYPASSABLE error.**
`special_symbol_outside_symbol_range` is in the non-bypassable list
(`verify-logic-correctness.ts:7290`), so wild = 10 / scatter = 11 with `numberOfSymbols = 9`
— correct for this game and specified by the user — could not be acknowledged. Forced
`ask_user` at d1[80-81]; both d1 `ask_user` calls were gate-caused.

**C5. Ack rule turns pre-existing findings into forced scope creep.** *"you CANNOT
acknowledge errorRefs on nodes you mutated this turn"* (`game-documentation.ts:1895`). Adding
79 ports to `Component Outputs` made four pre-existing dangling ports (BetValue, BetChanged,
SelectedLedgerIndex, LedgerRowSelected — the declared contract for a batch the user had
deferred) un-ackable → the AI deleted them (d3[374]). Same mechanism made it delete three
`AstraforgeCore/Logic` ports the user had asked to keep, and rename `LedgerEmpty →
LedgerEmptyDisplay` to dodge a "caption" heuristic.

**C6. HIGH-VOLUME ACK and FABRICATED-REF rules reject true statements.** Deleted wires are
not in "Actual created refs", so a claim that names a deletion is "FABRICATED CONNECTION
REFS" (d1.th[35], d3 gate blockers). The ref-string format (`"(deleted)"` suffix, `(in …)`
qualifier) has to be guessed.

**C7. Cached audit drops the findings.** `_cached / _noProgress / _doNotRetry`
(`verify-logic-correctness.ts:1195-1203`) returns errorRefs only; after condensation the AI
had *"only errorRefs … I need the actual finding details"* (d3.th[17-18]) and re-inspected
nodes one by one.

**C8. `@Logic` is three different nodes.** `/Components/AstraforgeUI/Logic`,
`/Components/AstraforgeCore/Logic`, and the instance labels in their parents are all `@Logic`.
The finding `ref` carries `(in <parent>)` (`verify-logic-correctness.ts:2436`) but errorRefs
and the condensed KEY FACTS show `@Logic:winAmount` bare. d3.th[15, 27, 28, 32] (~60 k chars
of thinking) are the AI trying to work out which `@Logic`.

**C9. Runtime-expectation gates block on the AI's guess, not the code.** d1 chat[125], [149]:
*"my expectations were wrong, not the chain"* — `RUNTIME EXPECTATION FAILED` ×2,
`RUNTIME PROOF FAILED` ×1 in the blocker tally were all wrong expectations.

**C10. Self-graded pass.** d1 chat[105]: *"the independent verifier was unavailable this turn,
so my own runtime evidence below is the proof."*

---

## D. Context economy destroying evidence

**D1. 42 % of d1 tool results reduced to KEY FACTS.** `ContextCondenser.ts:2407`; findings
capped at 12 with severity+check+ref only (`:1171`) — `fix` text and `(in …)` gone.
Truncated-by-tool in d1: `manage_component_ports` 32, `verify_logic_correctness` 22, `todo` 18,
`safe_js_function_workflow` 16, `safe_connection_batch` 15.

**D2. Whole-conversation condensation mid-task.** rawApiHistory `[CONTEXT CONDENSED — Prior
conversation summarized below]`; `[UnifiedAIService] 🚨 CRITICAL: Total tokens still too high!
Forcing emergency truncation`; d3.th[16]: *"I don't have it in context — context may have been
condensed."* → re-ran the audit → got the cached `_doNotRetry` stub (C7).

**D3. The model's own tool arguments get truncated and then executed.**
`[ProxyProvider] Failed to parse arguments for todo: {"action":"verify",…` — the verify
payload (5614 chars) arrived as `{_truncated:true,_size:5614,_head:…}`
(`dual-message-types.ts:392`; OpenRouterProvider `:377/:1867` `_preview` variant). The gate
call itself became unparseable.

**D4. Scratchpad eviction.** d1[435]: *"Older entries were dropped to stay under the
15000-char limit: duskways_audit_state"* — a note the AI relied on later.

**D5. Empty reasoning channel.** d3: 37 thinking entries for 379 tool calls; the 170 loop
turns carry no text at all.

---

## E. Editor / bridge

**E1. `switchTo` returns success but the active component has not changed.**
`private/xgenia-ai/src/ChatPanel/NodeGraphUtils.ts:1542` — twice in d3 (`still
'/Components/AstraforgeCore'`, `still '/#__maths__/DawnWays'`), plus `[get_component_xml] READ
SUCCEEDED BUT THE CURSOR DID NOT COME BACK`. Direct cause of B10.

**E2. Editor wedges on mutation bursts; iframe replaced 21 times in d1's window** (4–5 min
cadence at 01:35–01:48, 04:20–04:44, 08:01–08:25). d2 died mid-turn (user re-sent the prompt
at 04:02:00, last message 04:02:01). The user's workaround — "batches of ≤12, save after
each" — is a symptom.

**E3. Crash evidence is lost on every replacement.** `errorScope.panelReloaded`: all
in-memory buffers (errors, console, sub-agents, injected memory) reset; the 62 errors in every
export cover only 09:41Z onward. The wedge that matters is never in the export.

**E4. Stale runtime targets.** `[XgeniaRuntime] triggerSignal FAILED: No node with id … is
running. Nothing received the signal.`

**E5. Auto-running maths on mount.** d2 assistant: *"GameMaths has both a DoInit and a Timer"*
— a self-starting loop when instanced (cf. memory `project_cascade_export_1789727384756_runaway_loop`).
The final export has no Timer nodes anywhere, so this was eventually removed.

---

## F. Telemetry

**F1. Token usage all zeros in d1/d2** despite 1840 usage blocks received:
*"the tracker or the aggregation lost it"*; `modelName: null`. d3 did record
(`z-ai/glm-5.3-flash` 61.08 M tokens / $4.92; `anthropic/claude-opus-5` 116 k / $2.27).

**F2. `toolCallSummary` has no timestamps**, so tool cadence and per-turn cost cannot be
reconstructed without the visible chat.

---

## G. Test harness semantics

**G1. `test_node_script` deep-equality requires identical key sets.**
`tools/node-info/test-node-script.ts:26-36` — `if (ak.length !== bk.length) return false`.
A partial expectation object fails (d1 chat[38]: *"the 'fail' is only the deep-equality harness
rejecting my expectation object for omitting extra fields"*). 6× `HANDLED_FAILURE` in d1 were
this shape. Teaches the AI to distrust the harness.

**G2. `simulate_signal` `STALE_RUNTIME` false positives** flagged `isRealBug:false` by the tool
itself, yet still counted as failures by the gate (d1 chat[139]).

---

## H. Things the user was told that were wrong

**H1.** "49/49 Core cell Text wires confirmed" — true in the store (49/15/15 verified in the
export), false at runtime (B2: the grid never reaches the formatter).
**H2.** "the four meters, the money readouts, the mask tier name, the underlayer indicators and
the ledger rows are all bound and rendering" (user's own statement, d3[6]) — meters and money
yes; mask tier, underlayer and ledger no (B2, B3).
**H3.** d1 chat[62] "signal_cycle acknowledged exactly as you directed (not fixed with a
Timer)" followed by chat[142] re-adding the Timer.
