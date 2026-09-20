# XGENIA MCP limitations log — 2026-09-19

## L1 — health: false `editor-unresponsive` (transient)
- health() -> connect() -> Playwright connectOverCDP timed out at 10s ("ws connected" then nothing).
- Raw CDP at the same moment: Target.getTargets 46ms; Runtime.evaluate on the editor page 11ms; Page.enable/Runtime.enable/Network.enable/getFrameTree all <25ms.
- /json/list showed 3 page targets (editor + TWO cloudruntime pages) at failure time; 2 a minute later. Playwright inits every page target; one dying/hanging page stalls the whole connect.
- Second health call 90s later: connected fine. So the code is a *guess* ("renderer may be wedged") presented as a diagnosis.
- Fix idea: on connect failure, run a raw-CDP fallback probe (HTTP /json/list + attach to editor target + Runtime.evaluate) and report per-target liveness. Distinguish "editor page alive, Playwright init stalled on <target url>" from "editor page dead". Retry connect once before failing.

## L2 — new_project / open_project{dir}: tile never appears (FIXED in src/project.ts)
- Symptom: `selector-missing: .projects-item containing 'mcp-limits-0919' within 30000ms ... 59 tile(s) rendered`. Dir + project.json created, recents entry on disk.
- Cause: LocalProjectsModel.fetch() reads recently_opened_project.json only on lobby mount (useLobbyProjects effect); store() rewrites the file from memory. Harness appended then did page.mouse.move (doc claimed the lobby re-reads on mouse movement — false).
- Fix: save (if a project is open) → addRecentEntry → page.reload → wait tile. closeProject split into saveBeforeLeaving + reloadToLobby; openProject reuses them so append precedes the reload.
- Verified live: openProject({dir}) via dist → opened:true, chatReady:true, 9.2s.
- Note: the MCP server process this session talks to loaded the OLD dist; the fix is live only for fresh server processes.

## L3 — chat_read on an empty conversation returns panel chrome as a message (FIXED)
- Fresh project: `total:1, messageCount:0`, one role-unknown "message" = the "XGENIA recommends some new defaults" card + suggestion chips + model footer.
- Cause: readStructuredMessages falls back to a whole-body innerText parse when no `.message-container` exists, regardless of whether the panel reports zero messages.
- Fix: pass the panel's own messageCount; 0 containers + 0 messages = [] (empty). Fallback kept for "messages exist but no containers".

## L4 — screenshot drops contentSize / note (FIXED)
- screenshot() computes contentSize + padded/cropped note; index.ts serialised only region/cssSize/imageSize/scale/bytes. Tool description promised the dropped fields. The chat capture came back 731×1296 for a 585×1037 CSS region with `scale:1` and nothing saying the bottom 20% was padding.

## L5 — no text way to read the active model / cost / context (FIXED)
- Skill says "screenshot the footer to read the model". The footer is `.model-selector-trigger span`; cost is a bare `$x.xx` text node; context is `[aria-label="Context window usage"]`.
- Added model/cost/contextUsage to readChatState → surfaced as chatModel/chatCost/chatContextUsage in xgenia_health and model/cost/contextUsage in xgenia_chat_read.

## Panel-AI observations (not harness defects, for the record)
- create_logic_node got TRUNCATED_ARGS mid-stream on GLM 5.3 Flashx; the retry payload was corrupted ("Router\"/"); third attempt ok.
- Router auto-created inside the page component instead of /App; AI deleted and recreated.

## L6 — no first-hand read of the running game (FIXED: xgenia_preview_read / xgenia_preview_click)
- The only evidence about the game came from the panel AI's own reports (or runtime_logs). Skill says "ask for evidence, not reasoning" but the driver had no tool to get it itself.
- Added src/preview.ts: previewRead (body/selector/label text + every data-xgenia-node-label element with text/visibility), previewClick (click by label N times, report readLabel text before/after each).
- Verified live on the counter build: read → "3"; click ×2 with readLabel → before "3", after ["4","5"]. Matches the AI's report independently.

## Run 1 result (click counter, GLM 5.3 Flashx)
- Built + verified by the AI in ~7 min, 26 messages, 53 tool calls, 5 failures. Final answer table: 0/1/2/3 from live DOM. My own read agreed (3, then 4, 5 after my clicks).
- Cost badge $2.78 → export totalCost $3.62 with anthropic/claude-opus-5 $1.76 in the breakdown — check subAgents to see if opus ran here or it's lifetime.

## L1 follow-up (FIXED as honest reporting; root cause NOT proven)
- Hypothesis "second cloudruntime page stalls connectOverCDP" tested: with 2 cloudruntime pages present, 3 Playwright connects took 72/76/71 ms. Disproved as sufficient cause.
- Remaining candidates (unproven): renderer main thread pinned by the previous project's PixiReelController watchdog loop (renderer at 55% CPU, GPU helper 98% at the time); a target mid-navigation at connect time; 7 stale xgenia-mcp-server processes each holding a Playwright session.
- Shipped: probeRawCdp (HTTP /json/list + Runtime.evaluate on the editor page over a fresh websocket, 3s bound). New code `connect-stalled` when the editor page answers but Playwright doesn't; health returns rawCdp evidence; restart/quit refuse with connect-stalled and advise retry, not force.

## L7 — chat_read cannot tell a user turn (left as-is, deliberately)
- User message container's parent is `.custom-scrollbar` (direct child of the scroll area); assistant ones sit in `.assistant-group`. But a streaming assistant partial was previously observed as a direct child too (chat.test.ts), so 'custom-scrollbar' ⇒ user would be a guess. Role stays 'unknown'; documented in the tool description.

## Panel-AI / XGENIA tool observations from run 1 (for the panel team, not harness)
- TRUNCATED_ARGS ×2 on create_logic_node: the received args were `{"componentName":"Router","componentName":"Router",...}` repeated — a GLM repetition loop, not a cut-off (memory: "glm loop ≠ truncation", run 8). The error text still tells the model to "resend smaller", which is the wrong cure.
- set_router_config: `verificationSkipped: "Node not found: <uuid>"` + `verifiedSource: none` on both successful calls — the bridge re-read never ran, so "success" was unverified; the AI then read a stale inspect_node snapshot showing only {startPage}. Detached Router (created in /App without a parent) was the real blank-page cause.
- Sub-agents ran on anthropic/claude-opus-5 (script-judge, script-approver, vision): $1.76 of the $3.62 export total; main model glm-5.3-flashx $1.22. Cheap main model, expensive judges.

## Self-inflicted: project closed at ~16:00
- My connect-timing probe called `browser.close()` after connectOverCDP (×3). XGENIA closes the open project when a CDP client disconnects that way (memory: cdp-close-closes-project). Not another driver. The harness's own connect() never closes; scripts against it must not either. Reopened via openProject.
