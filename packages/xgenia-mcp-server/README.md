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
| `xgenia_health` | Liveness: running or not, dev or packaged, which project is open, whether the AI chat panel is mounted, and how long it's been generating. Call this first. |
| `xgenia_probe` | Report which DOM selectors the harness depends on currently resolve. Use when another tool returns `selector-missing`. |
| `xgenia_launch` | Attach to a running XGENIA, or start one — the installed build, a repo checkout's `npm run dev`, or whichever is available. |
| `xgenia_restart` | Save, kill and relaunch XGENIA, then reopen the project that was open. |
| `xgenia_project_status` | Which project is open, if any; when none is, also returns the 25 most recent projects. |
| `xgenia_open_project` | Open a project by absolute directory or by name. Verifies the editor actually landed on it. |
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
  fixture. The chat and editor fixtures are sanitised before being written —
  every text node's content is replaced with a placeholder, structure and
  markup kept — because the live panel holds the user's real conversation;
  the projects-screen fixture is not sanitised, since it only ever holds
  project names.

## Development

```
npm run build     # compile to dist/
npm test          # unit + selector-contract tests
npm run smoke     # read-only checks against a running XGENIA
npm run smoke:full # adds chat send and a real restart
```
