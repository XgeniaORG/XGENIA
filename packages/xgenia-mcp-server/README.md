# xgenia-mcp

An MCP server that drives the XGENIA editor: launch it, open a project, send
prompts to its AI chat panel, watch the conversation, screenshot it, and restart
it with recovery.

## Install

```
claude mcp add xgenia -- npx -y xgenia-mcp
```

XGENIA opens a Chrome DevTools Protocol port on 9223 in every build, so nothing
needs enabling.

## Tools

| Tool | What it does |
| --- | --- |
| `xgenia_health` | Liveness: running or not, dev or packaged, which project is open, whether the AI chat panel is mounted, how long it's been generating, and whether anyone is signed in (`authenticated`). Never throws on a dead or wedged editor — reports `{running: false, code, hint}` instead, with `code` distinguishing `not-running` from `editor-unresponsive`. Call this first. |
| `xgenia_probe` | Report which DOM selectors the harness depends on currently resolve. Use when another tool returns `selector-missing`. |
| `xgenia_launch` | Attach to a running XGENIA, or start one — the installed build, a repo checkout's `npm run dev`, or whichever is available. Reports `not-authenticated` rather than false success if it lands on the login screen. |
| `xgenia_restart` | Save, kill and relaunch XGENIA, then reopen the project that was open. Fails closed (`not-running` or `editor-unresponsive`) rather than hanging or throwing if the editor is dead or wedged, unless `force` is set — `force` reaches the kill even when connecting to the editor itself never succeeds. |
| `xgenia_quit` | Save, then kill XGENIA — `xgenia_restart`'s safety sequence without the relaunch. Same fail-closed connect/unresponsive-editor handling as `xgenia_restart`. |
| `xgenia_project_status` | Which project is open, if any; when none is, also returns the 25 most recent projects. |
| `xgenia_open_project` | Open a project by absolute directory or by name. Verifies the editor actually landed on it. Waits patiently for the projects screen to render tiles, and reports which state the page was actually in (login screen, empty projects screen, or a different project open) on timeout. |
| `xgenia_chat_send` | Type a prompt into the AI chat panel and send it. Returns only after confirming the input cleared and the transcript advanced. |
| `xgenia_chat_read` | Read the AI chat transcript, paged from an index. |
| `xgenia_chat_wait_idle` | Block until the AI chat panel stops generating; returns `timedOut` instead of throwing. |
| `xgenia_screenshot` | Capture the editor window, the chat panel, or the canvas. |

## Environment

| Variable | Purpose |
| --- | --- |
| `XGENIA_CDP_PORT` | Override the debugging port (default 9223) |
| `XGENIA_APP_PATH` | Path to an installed XGENIA binary |
| `XGENIA_REPO_DIR` | Path to a checkout, for `target: "dev"` |

## Notes

- **`busyForMs` is a lower bound, not a duration.** `xgenia_health` measures it
  from this harness process's first observation of the busy state, not from
  when generation actually began — the underlying tracker is in-memory and has
  no earlier signal. A panel that has been stuck generating for hours looks
  identical to one that just started right after this server launched: both
  can report a small `busyForMs`. Never read it as "how long has this been
  running."
- **`xgenia_chat_send` and `xgenia_restart` both refuse while the chat is
  generating, unless you pass `force`.** This is not a theoretical guard: the
  live panel has been observed sitting in a stuck generating state
  indefinitely, surviving app restarts. `force` is the documented escape
  hatch for exactly that stuck state — using it on a turn that is genuinely
  still in flight loses that turn.
- **`xgenia_restart` can report a restart that is not clean.** Besides
  `restarted`/`project`, the result carries `recoveryError` (why the project
  failed to reopen after relaunch — `project` is `null` in that case, but the
  reason survives instead of being swallowed) and `declinedPorts` (dev ports
  the harness found still occupied but refused to free, because their owner
  was outside the XGENIA process tree it just killed). Check both before
  assuming the restart actually worked.
- **This harness never handles credentials — it detects the login screen and
  stops.** `window.ProjectModel` is defined by XGENIA's router before the app
  decides whether anyone is signed in, so its presence does not mean the
  editor is usable — it's also there on the unauthenticated login screen,
  which used to make `xgenia_launch` report success while the editor sat in
  front of a login form indefinitely. `xgenia_launch`, `xgenia_open_project`,
  and `xgenia_health` (via its `authenticated` field) all surface this now.
  There is no tool, flag, or environment variable that types, stores, reads
  or transmits a password — signing in is a one-time action only a human can
  take.
- **`xgenia_restart`/`xgenia_quit` fail closed, not silently forever, on a
  dead or wedged editor — including the connect itself.** `connect()` opens
  a fresh CDP session and waits for the browser's page targets to attach;
  the previous round bounded every pre-kill in-page read (the project, the
  chat panel state, the save confirmation) with a Node-side timeout, because
  a truly wedged renderer's main thread can never settle a `page.evaluate`
  promise or fire an in-page `setTimeout` — not eventually, never — but left
  `connect()` itself as an unbounded precondition. Reproduced live:
  `restart({force: true})` against a wedged editor *threw* instead of
  returning, from `connect()`, before `force` was ever consulted — the kill
  path (port → PID → process tree) needs no page at all, so a wedged editor
  couldn't reach the one operation that exists to rescue it. `connect()` is
  now bounded to `CONNECT_TIMEOUT_MS` (10s, well under the library's 30s
  default) and classified rather than thrown-and-forgotten: `not-running`
  when nothing is listening on the CDP port, `editor-unresponsive` when
  something is listening but never became usable. Without `force`, a failed
  connect now fails the call fast and closed with that code instead of
  hanging or throwing. With `force`, both tools skip the connect and every
  in-page read entirely and go straight to the kill, reporting the honest
  gaps that leaves: `project: null`, the save reported unconfirmed
  (`reason: "unresponsive"`), `inFlightTurnLost: "unknown"` rather than a
  confident `false`, and (for `restart`) a best-effort `"auto"` relaunch
  target when the connect never succeeded enough to learn whether it was a
  dev or packaged build. Both tools also now guarantee they never throw
  themselves — they always return the result or `{error, tried, hint}`,
  independent of the `guard()` safety net in `index.ts`.
- Screenshots return a **measured** `scale`. It is neither 1 nor a fixed 2 —
  live measurements have shown ~1.25, from an Electron zoom factor of 0.8 on a
  2x-density display — and it moves whenever the user changes zoom. Convert
  any coordinate you read off the image through the `scale` in that same
  response before using it.
- **`ELECTRON_RUN_AS_NODE` troubleshooting.** If your MCP client runs inside an
  Electron-based IDE (VS Code, Cursor, Antigravity, and similar), its terminal
  environment can export `ELECTRON_RUN_AS_NODE=1` for the IDE's own embedded
  Node use. This harness strips that variable (and `ELECTRON_NO_ATTACH_CONSOLE`)
  from processes it spawns, so `xgenia_launch` is unaffected. But if you launch
  XGENIA by hand from such a terminal, the `electron` binary runs as plain Node
  instead of Electron, and the app dies with
  `TypeError: Cannot read properties of undefined (reading 'getVersion')` in
  electron-updater. Unset `ELECTRON_RUN_AS_NODE` before launching by hand, or
  just let `xgenia_launch` start it.
- Selectors are contracts with code this package does not own, and the chat
  panel deploys independently of XGENIA releases. `xgenia_probe` is how you
  find out what moved. Refresh the test fixtures with
  `node scripts/capture-fixtures.mjs` — this needs a project open with the AI
  panel visible, and captures the chat/editor fixtures. `--projects` mode
  (`node scripts/capture-fixtures.mjs --projects`) instead needs the projects
  screen showing with no project open, and refreshes the projects-screen
  fixture. `--login` mode (`node scripts/capture-fixtures.mjs --login`) needs
  the (unauthenticated) login screen showing, and refreshes the login-screen
  fixture used to pin `isLoginScreen`'s selectors. The chat and editor
  fixtures are sanitised before being written — every text node's content is
  replaced with a placeholder, structure and markup kept — because the live
  panel holds the user's real conversation; the projects-screen and
  login-screen fixtures are not sanitised, since they only ever hold project
  names and the login form's own static copy respectively — never user data.

## Error codes

Every tool that fails returns `{ error, tried, hint }` instead of throwing.
`tried` names what was attempted; `hint` explains what to do next. These are
the codes in use:

| Code | Meaning |
| --- | --- |
| `not-running` | Nothing is listening on the CDP port at all — either `connect()` couldn't reach it, or (in the kill path) nothing owns it. |
| `no-editor-page` | Connected over CDP, but no page matched the editor's URL. |
| `not-authenticated` | The editor is up and reachable, but sitting at the login screen. This harness cannot and must not sign in for you — a human has to do it once, in the editor. Returned by `xgenia_launch` and `xgenia_open_project`; `xgenia_health`'s `authenticated` field surfaces the same state without failing the call. |
| `editor-unresponsive` | Something is listening on the CDP port, but the connection (or a page on it) never became usable — a wedged renderer never finishes what `connectOverCDP` waits for, or an already-connected page never answers an in-page read within its timeout. Distinguished from `not-running` by checking whether anything actually owns the port. Returned by `xgenia_health` (as `code`, without failing the call) and by `xgenia_restart`/`xgenia_quit` when `force` is not set; pass `force` to kill anyway. |
| `busy-refused` | An AI turn is in flight (or its state could not be determined), and `force` was not set. |
| `save-unconfirmed` | The pre-kill/pre-close save could not be confirmed, and `force` was not set. |
| `selector-missing` | A DOM selector the harness depends on did not resolve in time. Run `xgenia_probe`. |
| `project-dir-missing` | The requested project directory/name could not be resolved, or is invalid. |
| `project-mismatch` | A project tile was clicked, but the editor did not end up reporting that directory as open. |
| `chat-frame-missing` | The AI chat panel iframe isn't present. Open it in XGENIA. |
| `recovery-read-failed` | `xgenia_restart`'s pre-kill recovery snapshot could not be read back after relaunch. |
| `timeout` | A bounded wait (e.g. for the editor page to come up) elapsed. |
| `page-unresponsive` | Fallback code for an uncaught exception with no more specific `code` attached. |

## Development

```
npm run build     # compile to dist/
npm test          # unit + selector-contract tests
npm run smoke     # read-only checks against a running XGENIA
npm run smoke:full # adds chat send and a real restart
```
