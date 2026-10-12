---
name: xgenia-mcp
description: |
  Drive the XGENIA editor over MCP: launch it, open or create a project, send prompts to its
  AI chat panel, watch the conversation, read and click the running game yourself, screenshot
  it, and restart it when it wedges.
  Use when: "use XGENIA", "drive XGENIA", "build a game in XGENIA", "test XGENIA",
  "open XGENIA", "XGENIA MCP", "send a prompt to the XGENIA chat", "restart XGENIA",
  "XGENIA is stuck", "build a slot", "screenshot the editor", or any task that needs the
  XGENIA desktop app driven from outside it.
  Covers the tool sequence, checking the model and cost before a long run, how to prompt the
  panel's AI without steering it wrong, getting first-hand evidence from the preview, sharing
  one editor with other agents, recovery, and the traps that make a call look like it failed
  when it did not.
---

# Driving XGENIA over MCP

The `xgenia` MCP server drives the **installed XGENIA desktop app** through the Chrome
DevTools Protocol on port 9223. Release builds open that port only when this server
launches them (`--xgenia-cdp`), so an XGENIA the user opened by hand cannot be attached:
quit it and call `xgenia_launch`. No repo checkout is needed.

Added by hand, not by the plugin: the package is **not on npm** (`npx -y xgenia-mcp` fails), and
a marketplace install of the `xgenia` plugin ships this skill without the server, so no tools
appear. Build `packages/xgenia-mcp-server` once and point `claude mcp add` at `dist/index.js`.

All 19 tools return `{ error, tried, hint }` on failure rather than throwing. `hint` says
what to do next — read it before deciding anything.

---

## Before you start: check the model and the cost

A long build costs real money, and the model is chosen inside XGENIA, not by you. **Check it
before any run that will take more than a couple of turns.**

- `xgenia_health` returns `chatModel` (the footer's active model name), `chatCost` (the running
  `$` figure) and `chatContextUsage`; `xgenia_chat_read` returns the same as `model`, `cost`,
  `contextUsage`. Read them as text. A `region: 'chat'` screenshot of the footer is the
  fallback when they come back `null` (a fresh conversation shows no cost yet).
- If the model is not the one the user expects, stop and ask. It is picked from the model
  menu in the chat panel's footer; do not edit XGENIA's settings files (they hold the user's
  API keys, and a running app overwrites them).
- Screenshot-reading and script-checking passes may run on a stronger model than the chat
  and add to the bill. The debug export's `tokenUsage.modelUsageBreakdown` and
  `section: 'subAgents'` show the split.
- The dev build and the installed app keep separate settings, so switching between them
  switches the model. Re-check after any switch.

---

## The tools

| Tool | Use it for |
| --- | --- |
| `xgenia_health` | **Always call first.** Running or not, dev or packaged, project open, chat mounted, chat busy, signed in, active model, cost. Never throws. On a failed connect the `code` is `not-running`, `editor-unresponsive` or `connect-stalled`, with `rawCdp` evidence — see Recovery. |
| `xgenia_launch` | Attach to a running editor, or start one (`app` / `dev` / `auto`). |
| `xgenia_project_status` | Which project is open; when none, the 25 most recent. |
| `xgenia_open_project` | Open by absolute `dir` or by `name`. Saves whatever is open, appends the recents entry, reloads the lobby so it re-reads the file (the only moment it does), clicks the tile, verifies it landed, and opens the chat panel if it is closed. |
| `xgenia_new_project` | Create a project and open it the same way. |
| `xgenia_close_project` | Back to the projects screen. |
| `xgenia_open_chat_panel` | Only when someone closed the panel by hand — the open/new tools already do this. |
| `xgenia_chat_send` | Type a prompt and send it. Refuses mid-generation unless `force`. |
| `xgenia_chat_read` | Read the transcript, paged with `since` / `limit`, plus `model` / `cost` / `contextUsage`. The panel renders only the newest ~30 messages and collapses the rest behind "Load N older messages": `total` and every `index` count the WHOLE conversation, `olderNotRendered` says how many are collapsed, and a `since` inside that range returns `skipped`. An empty conversation is `total: 0`. On an older server `total` sticks at ~30 while the chat keeps growing — a driver polling `since: total` then sees nothing for hours. |
| `xgenia_chat_wait_idle` | Block until generation stops. Returns `timedOut`, never throws. |
| `xgenia_preview_read` | **Your own eyes on the game.** Visible text of the whole preview or one node (`label` = the editor node name, or a CSS `selector`), plus every rendered node with an editor label and its current text and visibility. Read straight from the preview DOM, not from the panel AI's account of it. |
| `xgenia_preview_click` | **Your own hands on the game.** Click a node by `label` (or `selector`) `times` times and get another node's text (`readLabel`) before and after each press. |
| `xgenia_screenshot` | Capture `full`, `chat`, or `canvas`. Returns `contentSize` and a `note` when the buffer is padded or cropped. |
| `xgenia_probe` | Which DOM selectors still resolve. Run this on any `selector-missing`. |
| `xgenia_debug_export` | Click Debug Export and return the **file path** (it writes `<project>/.xgenia/debug-exports/xgenia-debug-export-<ms>.json`; older panel builds also fired a browser download, which opened a native **Save As** sheet that no unattended driver can dismiss — if a call hangs, check for a sheet: `osascript -e 'tell application "System Events" to tell (first process whose name is "Electron") to get count of sheets of every window'`) plus a census of what the panel AI did — every tool call with its arguments and result, the thinking log, both consoles, the cost by model. Never returns the bundle (7.2MB / 640 calls in one build). |
| `xgenia_debug_query` | Grep one section of that export. `tool` + `failuresOnly` answers "which calls to X failed and why" without reading the file. `section: 'subAgents'` shows which model each judge/vision pass ran on. |
| `xgenia_runtime_logs` | The live preview's own log buffer — what the game is doing **now**, no export step. Resets on preview reload. |
| `xgenia_restart` | Save, kill, relaunch, reopen the project. |
| `xgenia_quit` | Save and kill, no relaunch. |

---

## Prompting the panel's AI: outcomes, not mechanisms

The panel's AI knows XGENIA's node library, ports and tools far better than a prompt written
from outside does. Telling it *how* to build something when you are not certain how XGENIA
works produces a worse graph than telling it *what you want to see*.

- **Describe the observable result** — what appears on screen, what a press does, what the
  label shows after three presses. Leave node types, ports and wiring to it unless you have
  verified the mechanism yourself in this editor.
- **Ask it to prove the result from the running game**, not from the graph: "press the button
  three times yourself and tell me what the label actually displays after each press, taken
  from the running game". It has tools to click and read the preview; make it use them.
- **Then check its claim yourself** with `xgenia_preview_read` / `xgenia_preview_click`. A
  confident report and a first-hand read that agree is evidence; the report alone is not.
- **If you must specify a mechanism**, say why and mark the uncertainty ("I believe X, check
  it") so the AI can push back with what it knows instead of following a wrong instruction.

---

## One editor, many drivers

There is **one** XGENIA per machine. Another agent's harness, or a person, can take the editor
from you at any moment.

Four run-killers, all silent from the driver's side:

| What happened | How it looks | Guard |
| --- | --- | --- |
| Another agent ran `quit` + `launch` for its own run | `chat-frame-missing`, then a different project open, no crash-log entry, no human input | Re-check `xgenia_health.project` before and during a run |
| Someone opened another side panel | chat iframe gone from the frame tree | Nothing to do but reopen the panel and resume |
| A script called `browser.close()` on a CDP connection | Project closed, lobby showing, no human input | Never close a CDP connection to XGENIA; disconnecting that way exits the project. The harness's own `connect()` never does |

Before taking the editor for a long run, make sure nobody else is using it: the same project
for a while, `chatBusy` false, and ask the user if in doubt. A restart mid-run is recoverable if
your driver reopens the
project and sends *"continue — the editor restarted mid-turn; pick up exactly where you left
off"*; the transcript survives a reload, so the AI can resume from its own last message.

---

## The standard loop

```
xgenia_health                      → running? project open? chat mounted? busy? chatModel? chatCost?
xgenia_launch                      → only if not running
xgenia_open_project {dir|name}     → only if no project, or the wrong one
[check chatModel — see "Before you start"]
xgenia_chat_send { text, waitIdle: false }
xgenia_chat_read { since: <last total> }   → poll; stop a run that goes astray
xgenia_chat_wait_idle                       → when it is close to done
xgenia_preview_read / xgenia_preview_click → check what the game actually does
xgenia_debug_export + xgenia_debug_query   → when a tool call failed or a claim smells wrong
xgenia_screenshot { region: 'chat' }        → when the text is not enough
```

`waitIdle: true` on `xgenia_chat_send` blocks until the turn finishes and returns `{ idle,
waitedMs, timedOut, newMessages }`. For a long build, send with `waitIdle: false` and poll
`xgenia_chat_read` so you can stop the run early if it goes astray.

Read incrementally: keep the last `total` and pass it as `since`. Long messages come back
truncated — if you need a full one, ask the panel's AI to restate the part you want rather
than fighting the truncation, or pull the debug export and grep `visibleChat`.

---

## Traps that make a working call look broken

### A send that "may not have been sent" usually was

`xgenia_chat_send` confirms by watching for the input to clear **and** the prompt to appear
in the transcript. When it returns unconfirmed, the `error` code tells you which case you have:

| Code | Meaning | Do |
| --- | --- | --- |
| `render-lag` | Sent, not yet painted (usually a panel still booting) | `xgenia_chat_read`. **Do not resend** — that runs a second paid turn on the same request. |
| `not-submitted` | Still in the input, never submitted | Resend. Safe. |

**Never resend on a bare timeout without reading the transcript first.**

### Prompts naming nodes

XGENIA prompts refer to things as `@Paytable`, `@GameState`, `@SpinCalc`. The panel opens a
**mention autocomplete on `@`**; the harness inserts the whole prompt at once and presses
Escape before Enter so the autocomplete cannot swallow it. On an older server build, avoid `@`
in prompts or check the input after sending.

### Screenshot coordinates

`imageSize` is the buffer; **`contentSize` is the page**. The editor runs at an Electron zoom
factor, so the capture surface is bigger than the painted area — with zoom 0.8 the last 20%
of the image is blank.

- Convert coordinates through `scale` from that same response.
- Treat anything beyond `contentSize` as empty space, not as editor UI that failed to render.
- If `note` says the capture is **cropped**, the editor is zoomed in past the surface and the
  right/bottom of the page is genuinely missing from the image.

### `busyForMs` is a floor, not a duration

It is measured from this server process's first sight of the busy state, not from when
generation began. A panel stuck for hours looks identical to one that just started. Never
report it as "it has been running for N ms".

### Transcript roles

`assistant` is the panel's replies. Everything else is `unknown`: the DOM marks no user turn,
and the reader will not guess one. Your own prompt is the `unknown` message whose text you sent.

### The panel AI's tool errors are not always what they say

`TRUNCATED_ARGS` from the panel's tools has been observed on a payload that was not cut off
but *repeated* — the model looped on one key (`"componentName":"Router","componentName":
"Router",…`). Its advice to "resend smaller" does not cure a repetition loop. When you see it,
read the received text in the debug export before believing the diagnosis.

---

## Reading the running game

`xgenia_preview_read` and `xgenia_preview_click` are the first-hand route: they address the
preview iframe by URL and read or press its DOM directly. The panel's own runtime tools are the
AI's route, and they have their own failure modes:

| Symptom in the panel's own tools | What it usually means |
| --- | --- |
| `simulate_signal` → `NOT_MOUNTED`, and the result mentions other connected viewer clients | Stale viewer clients from earlier project opens. `xgenia_restart` clears them. |
| `observe_timeline` → "the bridge returned NO response" right after a preview refresh | The viewer was still reloading. Retry once before believing it. |
| A read says "the preview is NOT running" while the game is visibly playing | A timed-out read, not a stopped preview. Retry; if it keeps timing out, the editor is saturated (below). |
| A tool reports `success` with `verificationSkipped` / `verifiedSource: none` | The write did not error, but its read-back never ran. Not verified. Read the state yourself. |
| Screenshot refused: "the XGENIA editor window is hidden/minimized" | Correct refusal — a hidden window keeps handing back the last painted frame. Bring the window on screen; do not trust a capture taken while hidden. |

**When everything feels slow:** a game with a tick loop keeps the editor busy, and the chat panel
shares that process. Check the editor's CPU (`ps -o %cpu=,rss= -p <renderer pid>`) before blaming
the panel. A page that reloads or an app that quits is not a crash; XGENIA's crash log only
records real crashes.

---

## Driving the art loop

- **Key art is the shape of the declared screen.** Declare the screen first (`screen({action:
  "set"})` in the panel); a key-art call refuses outright when nothing is declared, because every
  piece cut from it inherits that aspect.
- **A billing refusal from the image service is not a size or key problem.** Tell the user; don't
  let the AI rebuild its art plan around it.
- **Full-bleed art asks for the screen's aspect, not its pixels** — long edge capped at 1536.
- **An AI edit hands back the canvas it was given** (resampled if the endpoint changes it), so a
  piece still fits the box it was cut from.
- **A named slot only receives a piece whose name matches it.** A slot the splitter cannot match
  stays empty rather than taking the next layer in line.
- Image `create`/`edit` calls in one batch run in parallel; `save` and `split` stay sequential
  because they write the project's asset manifest.

---

## Recovery

| Symptom | Call |
| --- | --- |
| `not-running` | `xgenia_launch` |
| `connect-stalled` | The editor page answered a raw CDP probe; only Playwright's attach stalled (it initialises every page target, so a hung or churning non-editor target can block it). **Retry.** Do not force-restart on this alone — `rawCdp` in the report lists the targets and the editor page's answer time. |
| `editor-unresponsive` (the editor page did not answer raw CDP either — a wedged renderer) | `xgenia_restart { force: true }` — skips the connect and every in-page read, goes straight to the kill |
| Chat stuck generating forever | `xgenia_restart` (or `xgenia_chat_send { force: true }` if the panel is otherwise fine) |
| `not-authenticated` | **Stop and tell the user.** A human signs in once, in the editor. There is no tool, flag or env var that types, stores or reads a password. |
| `selector-missing` | `xgenia_probe` — the chat panel deploys independently of XGENIA releases, so selectors move |
| `preview-frame-missing` | No preview is mounted. Open a project; the preview mounts with it. The result lists the frames actually present. |

`xgenia_restart` and `xgenia_quit` return more than `restarted` / `project`. **Check these
before assuming a clean restart:**

- `recoveryError` — why the project failed to reopen (`project` is `null`, but the reason survives)
- `declinedPorts` — ports still occupied that the harness refused to free, because their owner
  was outside the process tree it killed
- `save.confirmed` / `save.reason` — with `force`, this is `unresponsive`, not a confident "nothing to save"
- `inFlightTurnLost` — `"unknown"` under `force`
- `hardKilled` — true means SIGTERM's grace period expired, so unflushed state (an auth
  session, say) may be gone

A restart clears the chat transcript. Anything the panel's AI needs to know must go in the
next prompt.

---

## The MCP server is a local process

It starts with your session. Rebuilding it does **not** affect the running session: restart the
client to pick up a new build, and say so rather than claiming a fix is active. To test a
rebuilt server without restarting, `import` the functions from `dist/*.js` in a node script (it
shares the CDP port) — and never call `browser.close()` on the connection.

---

## Judgement while driving a build

- **Watch, do not just wait.** Poll `xgenia_chat_read` during long runs. Stop a run that is
  going astray rather than paying for it to finish.
- **Get evidence yourself.** The panel's AI will state a confident mechanism it has not
  checked. Read the label with `xgenia_preview_read`, press the button with
  `xgenia_preview_click`, and compare with what it told you. Or ask it to run
  `observe_timeline` / `get_execution_status` and report what executed. It retracts cleanly
  when shown runtime evidence — and a retraction under evidence is a signal the earlier claim
  was invented, not a signal to trust the next one more.
- **A fix is not verified by arithmetic.** If a tool reports a number before a change, do not
  accept a calculated number after it. Make the tool print the new figure, or read it off the
  preview.
- **Screenshot when the text is ambiguous.** `region: 'chat'` for the conversation and the
  model footer, `canvas` for the graph, `full` for the whole window.
- **A turn that ends with no answer is a bug, not a decision.** If a turn ends silently, read the
  panel console in the debug export before concluding the AI gave up.
- **Very large single calls are what time out.** Ask for a big screen in a few calls rather than
  one.
- **The approval card times out after 300 s.** Unattended, key art auto-approves and the whole
  build inherits it; the panel says so in its reply. Watch for that line if the look matters.
