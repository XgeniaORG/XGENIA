# XGENIA, mapped for the question "why does the AI get stuck on basic things like spin?"

Companion to [2026-09-19-astraforge-run-issues.md](2026-09-19-astraforge-run-issues.md)
(issue IDs A1…H3 referenced below). Diagnosis only; nothing here has been changed.

## 1. The layers a single wire passes through

```
 user prompt ─▶ system prompt (supabase/functions/ai-chat/system-prompt.ts, ~1 400 lines of rules)
                  │
                  ▼
 AI panel (private/xgenia-ai/src/ChatPanel)
   ProxyProvider loop ── MAX_ITERATIONS 200, auto-continuation ×2
   shared-tool-execution ── gates: halt-retry, repetition detector, mutation budget, auto-audit
   ~100 tools ── create_connection / safe_connection_* / find_connections / get_connection_health
                 verify_logic_correctness (7 000+ lines of checks) / todo verify (completion gate)
                 memory checkpoint (conventionDetected) / ai_scratchpad (15 k chars)
   ContextCondenser ── KEY FACTS ONLY, whole-conversation condensation, arg truncation
                  │  iframe bridge (EditorProxy.component.switchTo, _cachedActiveComponent)
                  ▼
 Editor (packages/xgenia-editor) ── graph store = project.json; accepts any (from,port,to,port)
                  │
                  ▼
 Runtime (packages/xgenia-runtime) ── Node/port model; JavaScriptFunction ports are in-X / out-X
   NodeScope.addConnection: unknown port → console.warn + skip
   Node.connectInput: unknown output → throw "doesn't have a port named"
                  │
                  ▼
 RGS compiler ── everything under /#__maths__/ → one synchronous evaluate(ctx) on the server
```

Two facts about this stack explain most of the run:

1. **There are two truths about every wire.** The editor store says a wire exists; the
   runtime decides whether it does anything. Nothing reconciles them. Every AI read tool
   (`find_connections`, `get_connection_health`, `get_app_xml`, `inspect_node`) and the user's
   own check (reading project.json) read the store.
2. **Only the RGS compiler knows what `/#__maths__/` means.** The audit, the prompt's recipes,
   `simulate_signal`, and the memory tool all treat a maths component as an ordinary graph.

## 2. Root causes, deepest first

### RC1 — The store accepts wires the runtime silently drops
Issues: B1 B2 B3 B4 B5 B10 H1 H2.
`create-connection.ts:1668` returns `exists:true` for any port name on a JavaScriptFunction;
`get-connection-health.ts:640-700` does the same. The runtime then rejects the wire with a
`console.warn` that reaches nobody. Result in this run: the spin button, the 7×7 board, the
mask tier, the ledger and the underlayer were all "wired" and all dead, and neither the AI nor
the user could see it. The user's mental model ("verified in project.json, not by eye") is
exactly the model the tools taught them — and it is the wrong oracle.
*Why it is deep:* the body scanner that could enumerate JS ports (`detectJSFunctionPorts`,
`// scriptOutputs`) already exists in the same package; the fail-open is a policy choice from
before that scanner existed, and every later "phantom port" audit check is compensating for it
after the fact.

### RC2 — Three naming conventions plus an exposure ritual
Issues: B6 B7 B8 B9.
Component I/O ports are bare; JavaScriptFunction ports are `in-`/`out-`; Javascript2 is bare
again. Exposing one value from a sub-component needs three coordinated mutations on three
nodes with two different spellings of the same name. The AI does not "know" this; it discovers
it per session by 24 failed writes and reads it back from error text. `script-node-port-rules.ts`
already auto-corrects Javascript2 spellings — the same idea applied to JavaScriptFunction and
to instance exposure would remove the guessing game.

### RC3 — Guardrails that argue instead of stop
Issues: A1 A2 A3 A4 A5 A6.
The detector has a hard block; it is unreachable in the one situation it was built for, because
the starvation strategy sits in front of it and `return`s on every call after the 25th read
(`tool-repetition-detector.ts` ~L480–520 vs ~L555). Starvation itself never blocks when the
pinned request mentions both changing and checking — which every real build request does.
Everything else is a warning the model is free to ignore, and the model here (glm-5.3-flash)
ignored 174 of them while emitting bare `tool_use` blocks with no text. Auto-continuation then
pushes a turn that ended honestly back into a gate it cannot pass, until the 200-call cap
declares "smart guards failed".

### RC4 — Gates encode game-design and deployment assumptions the project contradicts
Issues: C1 C3 C4 C5 C6 C9 C10 G1 G2.
- `wild ≤ numberOfSymbols` is a *non-bypassable* economy error; this game's wild is 10 of 9.
- A signal cycle's sanctioned remedy is a Timer; in `/#__maths__/` a Timer is a server bug.
- Maths mutations require `simulate_signal matched:true`; an un-instanced maths component
  cannot receive a signal and instancing it wedges the editor. The prompt (`:410`) says so; the
  gate (`game-documentation.ts:3719`) does not know.
- "Cannot ack a node you touched" makes adding a port to `Component Outputs` retroactively
  un-ack every pre-existing finding on it → the AI deletes deferred contract ports and renames
  nodes to satisfy the auditor.
- `test_node_script` deep-equal requires identical key sets, so a partial expectation "fails".
Each of these is individually defensible for a default slot; together, with non-bypassable +
auto-continue, they leave only three exits: ask the user, break scope, or grind.

### RC5 — Memory records the AI's own behaviour as "project convention", and convention outranks everything
Issues: C2 H3.
`conventionDetected` is free text the AI writes about what it built. It wrote "Timer-beat shape
for cascade loops" *after* the user had removed that Timer and explained why. Rule 0b-rule0
("CONFORM TO PROJECT CONVENTIONS … THE OVERRIDING RULE") then made the AI reinstall it. A user
"Stop —" ruling has no durable slot that outranks a convention; the pinned request is only the
current turn's text.

### RC6 — Context economy destroys the evidence the AI needs, then blames the AI for guessing
Issues: D1 D2 D3 D4 D5 C7 C8.
42 % of results become "KEY FACTS" (refs without parents, findings without fixes); the audit
returns cached stubs marked `_doNotRetry`; the scratchpad evicts; the AI's own 5.6 k-char gate
payload is truncated into an unparseable object. When the AI re-queries to recover what was
dropped, RC3 counts the re-queries as a loop; when it guesses instead, RC1 accepts the guess.
The `@Logic` ambiguity (C8) is the clearest case: the parent qualifier exists in the finding
and is stripped by the condenser, costing ~60 k chars of reasoning.

### RC7 — Editor fragility with no crash telemetry
Issues: E1 E2 E3 E4 E5.
21 iframe replacements in one window; the bridge reports a component switch that did not
happen and the next writes land in the wrong component; every replacement wipes the buffers
the debug export relies on, so the crash itself is never captured. The user's "≤12 wires then
save" discipline is a manual retry loop around this.

### RC8 — No layer above the compiler knows what `/#__maths__/` means
Issues: C1 C3 E5 and the two Timer interventions.
Location decides deployment (prompt `:1451`), but the audit's remedies, the prompt's loop
recipes, the memory tool and `simulate_signal` have no branch for "this compiles to synchronous
server code". The user supplied that knowledge by hand, twice, and it did not stick (RC5).

## 3. How the run's "basic stuff like spin" maps onto these

| Symptom the user saw | Root causes |
|---|---|
| Spin button wired for hours, never fires | RC1 (`click` accepted), RC6 (audit result condensed) |
| Boards / ledger / underlayer "bound" but blank | RC1 + RC2 (bare vs `in-`/`out-`) |
| 174-call loop on the Bet buttons | RC3, fed by RC6 (looking for a result it had lost) |
| Timer re-added after being banned | RC5 + RC8 + RC4 (cycle remedy) |
| Wild/scatter "non-bypassable" stand-off | RC4 |
| Scaffold instance created in `/App` (the wedge shape) | RC4 (gate) + RC8 |
| Ports deleted / node renamed the user did not ask for | RC4 (ack-on-touched) |
| Wrong-component writes, 6 phantom wires to AstraforgeCore | RC7 (switchTo race) |
| "I don't have it in context" → cached stub → re-inspect everything | RC6 |
| 21 editor restarts, no crash captured | RC7 |

## 4. Where a fix would have to land (offered, not done)

Ranked by how many issues each removes and how little it touches the model:

1. **Close the store/runtime gap at write time** (RC1, RC2). In `create-connection.ts`, replace
   the JS-function fail-open with the body scan the panel already has; auto-correct
   `X ↔ in-X/out-X` for JavaScriptFunction the way `script-node-port-rules.ts` does for
   Javascript2; surface `NodeScope.addConnection Skipped` into the panel as a first-class error.
   Removes B1–B5, B9, most of B6, H1, H2.
2. **Make the identical-call block unconditional and first** (RC3). Move Strategy 1 ahead of
   Strategy 6 in `check()`; block on the 3rd identical (tool,args) whose result hash also
   matches, regardless of intent quadrant. Stop auto-continuing into a gate that already said
   `canComplete:false` for the same blocker twice. Removes A1–A5.
3. **Teach the audit and the prompt one fact about `/#__maths__/`** (RC8, RC4-Timer): under
   that path a signal cycle's remedy is a bounded gate, never a Timer, and `simulate_signal` is
   not required. One branch in `verify-logic-correctness.ts:6531` and `game-documentation.ts:3719`.
4. **Give user rulings a slot that outranks `conventionDetected`** (RC5): a "standing directive"
   the memory checkpoint cannot overwrite, and stop letting the AI author "convention".
5. **Stop stripping the parent from refs; keep `fix` text in KEY FACTS; never truncate the
   model's own tool arguments** (RC6). Three small condenser changes remove C7, C8, D3.
6. **Persist error/console buffers across iframe replacement** (RC7) so the next export
   contains the wedge instead of its aftermath.

Items 1 and 2 are the two that would have turned this run from "kind of well but stuck on
spin" into a working game; both are in `private/xgenia-ai` and neither needs a model change.
