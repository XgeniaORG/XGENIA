# Running a second dev instance

One machine runs one editor, and that is a problem when more than one person or agent works on
it: five AI test runs were lost in a single afternoon because another session restarted the
shared editor, switched its side panel, or cleared its chat mid-build.

Every port and the settings directory are read from the environment, defaulting to the values
they have always had, so an unset environment behaves exactly as before.

| Variable | Default | What it is |
| --- | --- | --- |
| `XGENIA_EDITOR_PORT` | 8080 | webpack dev server for the editor renderer and the viewer frame |
| `XGENIA_CDP_PORT` | 9223 | Chrome DevTools port the MCP harness attaches to |
| `XGENIA_AI_APP_PORT` | 3010 | the AI chat panel served from local source |
| `XGENIA_IMAGE_EDITOR_PORT` | 3002 | the image editor panel |
| `XGENIAPORT` | 8574 | the viewer/runtime web server |
| `XGENIA_CLOUD_FUNCTIONS_PORT` | 8577 | cloud functions sandbox |
| `MCP_PROXY_PORT` | 3001 | MCP proxy |
| `XGENIA_AI_SERVICE_PORT` | 3847 | AI service |
| `XGENIA_EDITOR_AUX_PORT` | 3051 | DeepSearch |
| `XGENIA_USER_DATA_DIR` | Electron default | settings, recents and session for this instance |

A second instance, from its own checkout:

```bash
XGENIA_EDITOR_PORT=8081 \
XGENIA_CDP_PORT=9224 \
XGENIA_AI_APP_PORT=3011 \
XGENIA_IMAGE_EDITOR_PORT=3003 \
XGENIAPORT=8575 \
XGENIA_CLOUD_FUNCTIONS_PORT=8578 \
MCP_PROXY_PORT=3021 \
XGENIA_AI_SERVICE_PORT=3848 \
XGENIA_EDITOR_AUX_PORT=3052 \
XGENIA_USER_DATA_DIR="$HOME/Library/Application Support/XGENIA-dev-b" \
npm run dev
```

Point the harness at it with the same `XGENIA_CDP_PORT`.

Two things this does **not** do:

- **It does not share state.** A second instance has its own settings file, so its model choice,
  its OpenRouter key and its recent projects are separate. Sign in once in each.
- **It does not isolate the project on disk.** Two instances opening the same project directory
  will fight over `project.json`. Give each its own project.

`killPort` now only frees the port the instance was configured with. The old unconditional
`killPort(3010)` is what made a second stack impossible: starting one took the first one's panel
server down.
