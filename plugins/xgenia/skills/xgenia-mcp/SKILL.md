---
name: xgenia-mcp
description: |
  Drive the XGENIA editor over MCP: launch it, open or create a project, send prompts to its
  AI chat panel, watch the conversation, screenshot it, and restart it when it wedges.
  Use when: "use XGENIA", "drive XGENIA", "build a game in XGENIA", "test XGENIA",
  "open XGENIA", "XGENIA MCP", "send a prompt to the XGENIA chat", "restart XGENIA",
  "XGENIA is stuck", "build a slot", "screenshot the editor", or any task that needs the
  XGENIA desktop app driven from outside it.
  Covers the tool sequence, the cost rule, verifying a panel change actually reached the
  running editor, and the traps that make a call look like it failed when it did not.
---

# Driving XGENIA over MCP

The `xgenia` MCP server drives the **installed XGENIA desktop app** through the Chrome
DevTools Protocol on port 9223, which every build opens. No repo checkout is needed.

```
claude mcp add xgenia -- npx -y xgenia-mcp
```

All 14 tools return `{ error, tried, hint }` on failure rather than throwing. `hint` says
what to do next — read it before deciding anything.

---

## Before you touch anything: the cost rule

**Check the model before starting any run that will take more than a couple of turns.**

One slot build ran on `openai/gpt-6-astra` and cost **$94.63 across 29 messages**, exhausting
the OpenRouter account mid-session and blocking all further work. Nobody chose that model —
the profile had a malformed id stored, it did not resolve, and the request went out on
whatever the live list surfaced.

- The panel footer shows the active model (bottom-left of the chat). A screenshot reads it.
- The current default is `z-ai/glm-5.3-flash`. Never `openai/gpt-6-astra`.
- Only `visionModel` / `uiModel` may sit on `anthropic/claude-opus-5` — that is deliberate,
  they read screenshots and author screens.
- The chat panel's header shows a running **$ cost** for the conversation. Watch it.

The model lives per-profile in `editorSettings.json` under
`settings.aiProvider.providers.openrouter.model`:

| Build | Path |
| --- | --- |
| Packaged app | `~/Library/Application Support/XGENIA/editorSettings.json` |
| Dev build | `~/Library/Application Support/Electron/editorSettings.json` |

**Switching between the dev build and the packaged app switches profiles, and therefore the
model.** Re-check after any switch. That is exactly how the $94 build happened.

Two rules when reading that file:

- **It contains the user's OpenRouter API key.** Read the fields you need with a script that
  prints only those fields. Never `cat` it into the transcript.
- **XGENIA must be quit before editing it**, or the running app overwrites your change.
  `EditorSettings` is not exposed on `window`, so there is no in-page way to set it.

---

## The tools

| Tool | Use it for |
| --- | --- |
| `xgenia_health` | **Always call first.** Running or not, dev or packaged, project open, chat mounted, chat busy, signed in. Never throws. |
| `xgenia_launch` | Attach to a running editor, or start one (`app` / `dev` / `auto`). |
| `xgenia_project_status` | Which project is open; when none, the 25 most recent. |
| `xgenia_open_project` | Open by absolute `dir` or by `name`. Verifies it landed, and opens the chat panel if it is closed. |
| `xgenia_new_project` | Create a project. |
| `xgenia_close_project` | Back to the projects screen. |
| `xgenia_open_chat_panel` | Only when someone closed the panel by hand — the open/new tools already do this. |
| `xgenia_chat_send` | Type a prompt and send it. Refuses mid-generation unless `force`. |
| `xgenia_chat_read` | Read the transcript, paged with `since` / `limit`. |
| `xgenia_chat_wait_idle` | Block until generation stops. Returns `timedOut`, never throws. |
| `xgenia_screenshot` | Capture `full`, `chat`, or `canvas`. |
| `xgenia_probe` | Which DOM selectors still resolve. Run this on any `selector-missing`. |
| `xgenia_restart` | Save, kill, relaunch, reopen the project. |
| `xgenia_quit` | Save and kill, no relaunch. |

---

## The standard loop

```
xgenia_health                      → running? project open? chat mounted? busy?
xgenia_launch                      → only if not running
xgenia_open_project {dir|name}     → only if no project, or the wrong one
[check the model — see the cost rule]
xgenia_chat_send { text, waitIdle: true, timeoutMs: 300000 }
xgenia_chat_read { since: <last index> }
xgenia_screenshot { region: 'chat' }   → when the text is not enough
```

`waitIdle: true` blocks until the turn finishes and returns `{ idle, waitedMs, timedOut,
newMessages }`. Prefer it over polling. For a long build, send with `waitIdle: false` and
poll `xgenia_chat_read` so you can stop the run early if it goes astray.

Read incrementally: keep the last `total` and pass it as `since`. Long messages come back
truncated — if you need a full one, ask the panel's AI to restate the part you want rather
than fighting the truncation.

---

## Traps that make a working call look broken

### A send that "may not have been sent" usually was

`xgenia_chat_send` confirms by watching for the input to clear **and** the prompt to appear
in the transcript. Both signals lie in different directions:

- The input is `contenteditable`, so an **unsent** prompt is in the frame's body text too.
- `data-empty` has been observed false on a send that had already landed and was being
  answered.

Current behaviour reads the input's own text separately, so a match in the body while the
input no longer holds it proves the send. When it still returns unconfirmed, the `error` code
tells you which case you have:

| Code | Meaning | Do |
| --- | --- | --- |
| `render-lag` | Sent, not yet painted (usually a panel still booting) | `xgenia_chat_read`. **Do not resend** — that runs a second paid turn on the same request. |
| `not-submitted` | Still in the input, never submitted | Resend. Safe. |

**Never resend on a bare timeout without reading the transcript first.**

### Prompts naming nodes

XGENIA prompts refer to things as `@Paytable`, `@GameState`, `@SpinCalc`. The panel opens a
**mention autocomplete on `@`**. Typing character-by-character let it swallow the rest of the
prompt into a mention chip and eat the Enter — nothing was sent, twice, and only the input's
contents showed why. The harness now inserts the whole string as one input event and presses
Escape before Enter. On an older server build, avoid `@` in prompts or check the input after
sending.

### Screenshot coordinates

`imageSize` is the buffer; **`contentSize` is the page**. The editor runs at an Electron zoom
factor, so the capture surface is bigger than the painted area — with zoom 0.8 the last 20%
of the image is blank.

- Convert coordinates through `scale` from that same response.
- Treat anything beyond `contentSize` as empty space, not as editor UI that failed to render.
- If `note` says the capture is **cropped**, the editor is zoomed in past the surface and the
  right/bottom of the page is genuinely missing from the image.

`scale` was wrong before 2026-09-06 (reported 1.2503 where the truth was 1.0), so on an older
build measure against a known element rather than trusting it.

### `busyForMs` is a floor, not a duration

It is measured from this server process's first sight of the busy state, not from when
generation began. A panel stuck for hours looks identical to one that just started. Never
report it as "it has been running for N ms".

### Shipping while a turn is in flight kills the turn

Deploying the panel or its edge function mid-generation produces `Failed to fetch` /
`AI Communication Error` in the transcript. That is your deploy, not an XGENIA bug. Wait for
idle before shipping, or expect to re-send.

---

## Recovery

| Symptom | Call |
| --- | --- |
| `not-running` | `xgenia_launch` |
| `editor-unresponsive` (wedged renderer) | `xgenia_restart { force: true }` — skips the connect and every in-page read, goes straight to the kill |
| Chat stuck generating forever | `xgenia_restart` (or `xgenia_chat_send { force: true }` if the panel is otherwise fine) |
| `not-authenticated` | **Stop and tell the user.** A human signs in once, in the editor. There is no tool, flag or env var that types, stores or reads a password. |
| `selector-missing` | `xgenia_probe` — the chat panel deploys independently of XGENIA releases, so selectors move |

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

## Verifying a change actually reached the running editor

The chat panel is served from Vercel and iframed by the editor, so **editing local source
changes nothing you can see** until it is built, deployed and reloaded. Three checks, in order:

1. **Ship it.** `npm run ship` from `private/xgenia-ai-app` — only `ship` re-aliases the prod
   URL. It prints `SHIP COMPLETE` and an `ai-chat` probe with a `git_sha`; confirm that sha is
   your commit.
2. **Confirm the bundle reached the edge.** `curl -s https://xgenia-ai-app-xgenia.vercel.app/ |
   grep -o 'index-[A-Za-z0-9_-]*\.js'` and match it against the hash ship expected. A mismatch
   right after a deploy is usually CDN lag — re-check in 30–60s.
3. **Reload the panel.** `xgenia_restart`, then exercise the changed behaviour and read the
   result out of the transcript. The panel also shows an opt-in *"A new version of the AI panel
   is available — Reload"* banner; it does not hard-reload mid-use.

Skipping step 3 is how a "verified" fix turns out to have been tested against the old bundle.

**The MCP server itself is different:** it is a local process started when the session began.
Rebuilding it does **not** affect the running session — the client has to be restarted to pick
up a new build. If you just fixed the harness, say so rather than claiming the fix is active.

---

## Judgement while driving a build

- **Watch, do not just wait.** Poll `xgenia_chat_read` during long runs. Stop a run that is
  going astray rather than paying for it to finish.
- **Ask for evidence, not reasoning.** The panel's AI will state a confident mechanism it has
  not checked. Ask it to run `observe_timeline` / `get_execution_status` and report what
  executed. It retracts cleanly when shown runtime evidence — and a retraction under evidence
  is a signal the earlier claim was invented, not a signal to trust the next one more.
- **A fix is not verified by arithmetic.** If a tool reports a number before a change, do not
  accept a calculated number after it. Make the tool print the new figure.
- **Screenshot when the text is ambiguous.** `region: 'chat'` for the conversation and the
  model footer, `canvas` for the graph, `full` for the whole window.
