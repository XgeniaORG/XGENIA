# XGENIA plugin for Claude Code

Installs two things together:

- the **`xgenia` MCP server** — 14 tools that drive the XGENIA desktop app over the Chrome
  DevTools Protocol (launch, open a project, send chat prompts, read the transcript,
  screenshot, restart)
- the **`xgenia-mcp` skill** — how to actually use them: the call sequence, the model-cost
  rule, how to verify a panel change reached the running editor, and the traps that make a
  working call look like it failed

## Install

From a checkout of this repo:

```
/plugin marketplace add /path/to/XGENIAOpen2
/plugin install xgenia@xgenia
```

Then restart Claude Code so the MCP server loads.

Check it worked with `/mcp` (the `xgenia` server should be listed) and by asking for
`/xgenia-mcp` (the skill should be offered).

## Requirements

- **XGENIA installed**, or a checkout to run `npm run dev` from. The editor opens a CDP port
  on 9223 in every build, so nothing needs enabling.
- **Someone signed in to XGENIA once.** The harness detects the login screen and stops; it
  has no tool, flag or environment variable that types, stores or reads a password.
- Node 18+.

## How the server is started

`.mcp.json` runs `bin/xgenia-mcp.mjs`, which launches
`packages/xgenia-mcp-server/dist/index.js` from this repo. That `dist/` is gitignored, so on a
fresh clone the launcher builds it once before starting — build output goes to stderr, because
stdout is the MCP protocol channel and a stray byte there corrupts the stream.

If the server is ever published to npm, `.mcp.json` can become:

```json
{ "xgenia": { "command": "npx", "args": ["-y", "xgenia-mcp"] } }
```

## Environment

| Variable | Purpose |
| --- | --- |
| `XGENIA_CDP_PORT` | Override the debugging port (default 9223) |
| `XGENIA_APP_PATH` | Path to an installed XGENIA binary |
| `XGENIA_REPO_DIR` | Path to a checkout, for `target: "dev"` |

Full tool reference, error codes and troubleshooting live in
[`packages/xgenia-mcp-server/README.md`](../../packages/xgenia-mcp-server/README.md).
