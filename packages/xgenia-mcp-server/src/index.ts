#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { health, probe, projectStatus } from './editor-state.js';
import { chatSend, chatRead, chatWaitIdle, openChatPanel } from './chat.js';
import { screenshot } from './screenshot.js';
import { openProject, newProject, closeProject } from './project.js';
import { launch, restart, quit } from './lifecycle.js';
import { debugExport, debugQuery, runtimeLogs } from './debug-export.js';
import { projectAudit } from './audit.js';
import { runScriptNode } from './scriptrun.js';
import { consoleTail } from './consoletail.js';
import { buildStatus } from './buildstatus.js';
import { inspectComponents } from './component.js';
import { freezeWatch } from './freezewatch.js';
import { previewText } from './previewtext.js';
import { previewClick } from './previewclick.js';
import { rawProbe, classifyProbe, probeHint } from './rawprobe.js';
import { discoverPort } from './connection.js';
import { portOwner } from './platform.js';
import { SELECTORS } from './selectors.js';

const server = new McpServer({ name: 'xgenia-mcp', version: '1.0.0' });

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
});

/**
 * Turn a thrown error into the same shape a handled failure returns.
 *
 * Every tool reports either a verified result or {error, tried, hint}; letting an
 * exception escape would break that contract for the caller.
 */
async function guard(tried: string, fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (e) {
    const err = e as Error & { code?: string };
    return text({
      error: err.code ?? 'page-unresponsive',
      tried,
      hint: err.message ?? String(e)
    });
  }
}

server.registerTool(
  'xgenia_health',
  {
    title: 'XGENIA health',
    description:
      'Liveness of the XGENIA editor: whether it is running, dev or packaged, which project is open, whether the AI chat panel is mounted and how long it has been generating. Call this first. ' +
      'busyForMs is NOT wall-clock time since generation began — it is measured from this harness process\'s first observation of the busy state, because the underlying tracker is in-memory and has no earlier signal. A panel that has been stuck generating for hours looks identical to one that just started: both can read a small busyForMs right after this server starts. Treat busyForMs as a lower bound on how long it has been busy, never as the true duration. ' +
      'authenticated reports whether the editor is past the login screen (window.ProjectModel is defined on the login screen too, so nothing else here implies anyone is signed in) — it is "unknown", not a confident true, whenever pageResponsive is false. ' +
      'Never throws just because the editor could not be reached: when connect fails, this returns {running: false, code, hint} instead — code is "not-running" when nothing is listening on the CDP port at all, or "editor-unresponsive" when something is listening but the connect never completed. IMPORTANT: "editor-unresponsive" is a statement about the connect, NOT a diagnosis of the renderer — the most common cause is a stalled Playwright connect in front of a completely healthy page. Run xgenia_editor_probe before concluding the editor is wedged, restarting it, or changing the project; it asks the page directly over raw CDP and returns connect-stalled (retry) vs editor-blocked (really wedged). Use that to decide whether xgenia_launch or xgenia_restart with force is the right next call.',
    inputSchema: {}
  },
  () => guard('connect + evaluate', health)
);

server.registerTool(
  'xgenia_probe',
  {
    title: 'Probe XGENIA selectors',
    description:
      'Report which DOM selectors the harness depends on currently resolve. Use when another tool returns selector-missing, to see what actually changed.',
    inputSchema: {}
  },
  () => guard('selector probe', probe)
);

server.registerTool(
  'xgenia_launch',
  {
    title: 'Launch XGENIA',
    description:
      'Attach to a running XGENIA, or start one. target "app" uses the installed build, "dev" runs npm run dev from a repo checkout, "auto" prefers whichever is available. ' +
      'Returns {error: "not-authenticated"} — not a false success — if the editor comes up (or was already up) sitting at the login screen instead of the projects/editor UI. This harness never types, stores or reads credentials: a human has to sign in once before this tool, or xgenia_open_project, can proceed.',
    inputSchema: { target: z.enum(['app', 'dev', 'auto']).optional() }
  },
  ({ target }) => guard('launch', () => launch({ target }))
);

server.registerTool(
  'xgenia_restart',
  {
    title: 'Restart XGENIA',
    description:
      'Save, kill and relaunch XGENIA, then reopen the project that was open. Refuses while the AI chat is mid-generation unless force is set, because that turn would be lost. ' +
      'The result carries more than restarted/project: recoveryError explains why the project failed to reopen after relaunch (project is null in that case, but the failure reason survives instead of being swallowed), and declinedPorts lists dev ports the harness found still occupied but refused to free because their owner was not part of the process tree it just killed. Check both before assuming a clean restart. ' +
      'Even connecting to the editor is bounded now, not just the reads after it — connectOverCDP used to be able to take its full 30s default and then throw before force was ever consulted, making the kill path (which needs only a port and a process table, no page at all) unreachable on exactly the wedged editor it exists to rescue. Without force, a connect failure now returns a clean {error} — "not-running" if nothing is listening on the port at all, "editor-unresponsive" if something is listening but never responded — instead of hanging or throwing. With force, this skips straight to the kill (no connect, no reads) and reports the honest gaps that leaves: project: null, save reported unconfirmed with reason "unresponsive" (a confirmed "nothing was open" is reported only when the editor was actually read — never guessed just because nothing was read), inFlightTurnLost: "unknown". ' +
      'The target is preserved even on a forced restart of a wedged editor, where connect() cannot classify it by page URL: this instead reads the command line of the process that owns the CDP port — unambiguous, since the dev build always runs Electron with dev-main.js out of this repo and the packaged build always runs the installed app binary — and, if that comes up empty too, falls back to the target the last restart that DID know it wrote to the recovery snapshot. targetSource reports which of "connect"/"process"/"recovery"/"unknown" actually supplied it, and target reports the build that was actually relaunched — whatever launch()\'s own "auto" preference chose in the rare case targetSource is "unknown" — so a silent build switch is always visible instead of hidden. ' +
      'Every pre-kill read of the old editor is also bounded on its own, so a page that answers the connect but then wedges mid-read is handled the same way: without force it returns {error: "editor-unresponsive"} explaining that the pre-restart save and busy-check could not be performed; with force it skips the remaining reads and proceeds straight to the kill. ' +
      'Shutdown is graceful by default: SIGTERM is given a generous grace period to let the Electron renderer flush localStorage/IndexedDB before SIGKILL is even considered, and the process is polled so an editor that exits promptly is not slowed down. hardKilled reports whether that grace period actually expired and SIGKILL was needed — true is the case where losing unflushed state (e.g. an auth session) is plausible, so check it after any restart. ' +
      'This tool itself never throws — it always returns either the result or {error, tried, hint} — even if something unexpected fails after the kill (e.g. reconnecting post-relaunch).',
    inputSchema: { force: z.boolean().optional() }
  },
  ({ force }) => guard('restart', () => restart({ force }))
);

server.registerTool(
  'xgenia_quit',
  {
    title: 'Quit XGENIA',
    description:
      'Save, then kill XGENIA — the same safety sequence xgenia_restart uses (refuse while the AI chat is mid-generation unless force is set, confirm the save, kill the right process tree for the connected target, verify the port is actually free) — but do NOT relaunch it. ' +
      'Nothing will be running after this call succeeds: there is no editor to attach to, and no project is reopened automatically. xgenia_launch is how you bring XGENIA back; it will start with no project open unless you also call xgenia_open_project afterward. ' +
      'Shares xgenia_restart\'s bounded connect and pre-kill reads: even reaching the editor at all is bounded, so a wedged renderer cannot hang or crash this call — without force it fails closed with {error: "not-running"} (nothing listening on the port) or {error: "editor-unresponsive"} (something is listening but never responded), unless force is set, in which case it skips the connect/reads entirely and kills anyway, reporting project: null, save reported unconfirmed with reason "unresponsive" (never a false "nothing to save" — that requires an actual read this path explicitly skipped), and inFlightTurnLost: "unknown" rather than guessing. target is still reported as accurately as possible even here — the same process-command-line and recovery-snapshot fallbacks xgenia_restart uses when a wedged connect cannot classify by page URL — and targetSource says which of "connect"/"process"/"recovery"/"unknown" it came from. ' +
      'Also shares xgenia_restart\'s graceful-by-default shutdown: SIGTERM gets a generous grace period (polled, so a prompt exit is not slowed down) to let the Electron renderer flush localStorage/IndexedDB before SIGKILL is considered at all. hardKilled reports whether that grace period expired and a hard kill was actually needed — true is the case where losing unflushed state (e.g. an auth session) is plausible. ' +
      'This tool itself never throws — it always returns either the result or {error, tried, hint}.',
    inputSchema: { force: z.boolean().optional() }
  },
  ({ force }) => guard('quit', () => quit({ force }))
);

server.registerTool(
  'xgenia_project_status',
  {
    title: 'XGENIA project status',
    description:
      'Which project is open, if any. When none is open, also returns the 25 most recent projects so you can pick one.',
    inputSchema: {}
  },
  () => guard('project status', projectStatus)
);

server.registerTool(
  'xgenia_open_project',
  {
    title: 'Open an XGENIA project',
    description:
      'Open a project by absolute directory or by name. A directory not in the recents list is added to it first. Verifies the editor actually landed on that project. ' +
      'Waits patiently for the projects screen to actually render tiles (this machine has been observed rendering 300+ recents entries right after a cold launch) before waiting for the specific one requested; a timeout reports which state the page was actually in — the login screen ({error: "not-authenticated"}), a projects screen with zero tiles, or an editor already holding a different project — instead of a bare selector-missing. ' +
      'Before returning, it also waits briefly for the AI chat panel to finish mounting (observed live to still be mounting for a few seconds right after the project verifiably opens). Every newly created project — and plenty of existing ones — opens with the panel hidden, so if it is still not present after that wait this now attempts to open it from the sidebar (the same click xgenia_open_chat_panel performs) before giving up; pass openChatIfClosed: false to skip that and leave a closed panel alone. Reports chatReady: true/false either way — false does not mean the open failed, only that the chat panel is not usable (still mounting, genuinely closed, entitlement-gated, or the open attempt itself failed); chatUnavailable/chatError carry the reason from the panel read, and chatOpenAttempt (present only when an attempt was actually made and did not succeed) carries what that attempt found, including every sidebar tooltip label it saw.',
    inputSchema: { dir: z.string().optional(), name: z.string().optional(), openChatIfClosed: z.boolean().optional() }
  },
  ({ dir, name, openChatIfClosed }) => guard('open project', () => openProject({ dir, name, openChatIfClosed }))
);

server.registerTool(
  'xgenia_new_project',
  {
    title: 'Create a new XGENIA project',
    description:
      'Create a project directory with a fresh, empty project.json (one root Group node, no components beyond /App) and open it. ' +
      'If dir is omitted, a sibling directory of the most recently opened project is used (or the home directory if there is no recents history yet). Refuses — rather than overwriting — when the resolved directory already exists and is non-empty. ' +
      'This reuses xgenia_open_project internally, so it inherits the same recents handling, verify-by-value check, and chatReady/chatUnavailable/chatError/chatOpenAttempt reporting for the AI chat panel — including that a brand-new project always opens with the panel hidden, so by default this attempts to open it from the sidebar before reporting chatReady; pass openChatIfClosed: false to leave a closed panel alone. The result carries everything xgenia_open_project returns plus createdDir.',
    inputSchema: { name: z.string(), dir: z.string().optional(), openChatIfClosed: z.boolean().optional() }
  },
  ({ name, dir, openChatIfClosed }) => guard('new project', () => newProject({ name, dir, openChatIfClosed }))
);

server.registerTool(
  'xgenia_close_project',
  {
    title: 'Close the current XGENIA project',
    description:
      'Save the open project and return to the projects screen. There is no clickable exit control in the editor UI for this harness to target, so it saves, reloads the page, and waits for a project tile to appear — which discards any unsaved work the save did not capture. ' +
      'Refuses when the save cannot be confirmed unless force is set. Reports whether a project was actually closed, or that none was open.',
    inputSchema: { force: z.boolean().optional() }
  },
  ({ force }) => guard('close project', () => closeProject({ force }))
);

server.registerTool(
  'xgenia_open_chat_panel',
  {
    title: 'Open the XGENIA AI chat panel',
    description:
      'Click the sidebar\'s "Chat" button to open the AI chat panel. Normally unnecessary — xgenia_open_project and xgenia_new_project already attempt this automatically whenever the panel is not showing after opening a project, which is every newly created project and plenty of existing ones. Use this directly only when the panel was closed by hand after that (a person toggled it shut), or a caller deliberately opened a project with openChatIfClosed: false and now wants the panel after all. ' +
      'Returns {opened: true, alreadyOpen: true, clicked: false} immediately, without hovering or clicking anything, if the panel is already showing. Otherwise it identifies the button by hovering every icon in the left sidebar rail and reading its tooltip for an exact (case-insensitive) match on "Chat" — the button carries no id, aria-label or data-testid, only that tooltip — clicks it, and waits for the panel to actually render before reporting {opened: true, clicked: true}. On failure it reports which of the two things went wrong (reason: "no-chat-button" or "clicked-but-not-rendered") plus every tooltip label it actually saw (labelsSeen) and a hint — exactly what a maintainer needs if XGENIA ever renames the button.',
    inputSchema: { timeoutMs: z.number().optional() }
  },
  ({ timeoutMs }) => guard('open chat panel', () => openChatPanel({ timeoutMs }))
);

server.registerTool(
  'xgenia_chat_send',
  {
    title: 'Send a prompt to the XGENIA AI chat',
    description:
      'Type a prompt into the AI chat panel and send it. Refuses while a turn is in flight unless force is set. Returns only after confirming the input cleared and the transcript advanced.',
    inputSchema: {
      text: z.string(),
      waitIdle: z.boolean().optional(),
      force: z.boolean().optional(),
      timeoutMs: z.number().optional()
    }
  },
  ({ text: prompt, waitIdle, force, timeoutMs }) =>
    guard('chat send', () => chatSend(prompt, { waitIdle, force, timeoutMs }))
);

server.registerTool(
  'xgenia_chat_read',
  {
    title: 'Read the XGENIA AI chat transcript',
    description:
      'Read the AI chat transcript, paged from an index. Indexes and total count the WHOLE conversation: when the panel collapses older messages behind "Load N older messages", total includes them, olderNotRendered says how many, and a since below that count returns skipped instead of shifting onto other messages. Messages are truncated at 2000 chars by default — pass maxChars (e.g. 20000) to read a long reply in full instead of asking the panel to restate it. The message count and busy flag come from the live panel.',
    inputSchema: {
      since: z.number().optional(),
      limit: z.number().optional(),
      maxChars: z.number().optional()
    }
  },
  ({ since, limit, maxChars }) => guard('chat read', () => chatRead({ since, limit, maxChars }))
);

server.registerTool(
  'xgenia_chat_wait_idle',
  {
    title: 'Wait for the XGENIA AI chat to finish',
    description:
      'Block until the AI chat panel stops generating. The busy flag drops in the gap between a turn\'s tool calls, so a bare wait can return mid-turn — pass stableMs (e.g. 30000) to require idle to hold that long first. On timeout it returns timedOut instead of throwing, so you can screenshot and decide.',
    inputSchema: { timeoutMs: z.number().optional(), stableMs: z.number().optional() }
  },
  ({ timeoutMs, stableMs }) =>
    guard('chat wait idle', () => chatWaitIdle(timeoutMs ?? 300_000, stableMs ?? 0))
);

server.registerTool(
  'xgenia_project_audit',
  {
    title: 'Audit the open project.json for structural defects',
    description:
      'Read the open project\'s project.json from disk (no panel turn, no preview) and report defect classes the editor accepts silently: ' +
      'DATA DEPENDENCY CYCLES (the renderer-killer — the runtime walks data dependencies with no cycle guard, so a data loop recurses until the main thread dies; invisible until something instances the component), ' +
      'a component instanced inside itself directly or transitively (infinite expansion, same outcome), ' +
      'phantom ports (wires to undeclared ports that never fire), dangling wires, duplicate sources into one Component Output (evaluation-order dependent — a cap can be bypassed), ' +
      'a self-restarting Timer (an unbounded wall-clock loop), a Timer inside a /#__maths__/ component (cannot run in the synchronous server script), ' +
      'signal cycles, Text nodes with no incoming wire (a layout that looks finished but is unbound), and scripts reading Outputs.X.… they never assign (throws on first run). ' +
      'Each finding names component, node and runtime consequence. Pass dir to audit a project that is not open. ' +
      'Pass saveBaseline true to record the current findings, then compareBaseline true on a later run to get regressions (findings this turn introduced), fixed, and a verdict. Use it every turn: totals alone hide drift, because three fixed and three broken reads as no change — a builder can remove a fatal cycle, verify it, and rewire it two turns later while honestly reporting success.',
    inputSchema: { dir: z.string().optional(), saveBaseline: z.boolean().optional(), compareBaseline: z.boolean().optional() }
  },
  ({ dir, saveBaseline, compareBaseline }) => guard('project audit', () => projectAudit({ dir, saveBaseline, compareBaseline }))
);

server.registerTool(
  'xgenia_run_script_node',
  {
    title: 'Run a JavaScriptFunction node offline with stub inputs',
    description:
      'Execute one script node\'s STORED body under new Function(Inputs, Outputs) with the inputs you supply, and return its outputs, fired signals, and any thrown error. ' +
      'No editor turn, no preview, no renderer risk — it tests the real stored code. Use it to prove behaviour (a meter threshold, a paytable band, a cap truncation) instead of trusting a completion claim. ' +
      'Node is matched by label or id inside the named component. Signal outputs (Done, Do, …) are recorded, not propagated. Pass dir to target a project that is not open.',
    inputSchema: {
      component: z.string(),
      node: z.string(),
      inputs: z.record(z.unknown()).optional(),
      dir: z.string().optional()
    }
  },
  ({ component, node, inputs, dir }) =>
    guard('run script node', () => runScriptNode({ component, node, inputs: inputs as Record<string, unknown> | undefined, dir }))
);

server.registerTool(
  'xgenia_build_status',
  {
    title: 'Supervisor snapshot: on track, stopped, or built?',
    description:
      'One call answering the three questions a supervisor asks. (1) Did it stop — samples the panel twice around a window and reports working / idle / quiet. Quiet means busy with nothing new, which at short windows is normal mid-tool-call; use sampleMs 30000+ before treating it as a stall, then read the transcript. ' +
      '(2) Did it build what was asked — an inventory of every component with node counts, node types, script size and whether it is a maths or visual component, to compare against the request. ' +
      '(3) Is it on track — gaps: components created but never wired, display nodes with no incoming wire (showing defaults, not data), an /App with no connections, no maths component at all. ' +
      'The project side is read from project.json on disk, so it works even when the renderer is too wedged to answer. Pass dir to inspect a project that is not open; sampleMs (default 8000) sets the stall window.',
    inputSchema: { dir: z.string().optional(), sampleMs: z.number().optional() }
  },
  ({ dir, sampleMs }) => guard('build status', () => buildStatus({ dir, sampleMs }))
);

server.registerTool(
  'xgenia_component_inspect',
  {
    title: 'What is inside a component, and what ports does it expose?',
    description:
      'Read a project\'s components from project.json: node counts, connection counts, the Component Inputs / Component Outputs port names each one exposes, and which other components it instances. ' +
      'Call with no component to list them all; with component to get its full node list; with match ["/producer","/consumer"] to line up one component\'s outputs against another\'s inputs and get matched / consumerUnfed / producerUnused. ' +
      'Use this BEFORE wiring two components together: guessing a port name is how phantom wires get made, and the editor accepts a wire to a non-existent port and then silently never fires it. ' +
      'Matching names are a hint only — two ports can share a name and mean different quantities, so treat consumerUnfed as needing a human decision. Reads from disk, and reports how long ago the file was written so you can tell when unsaved editor state is missing.',
    inputSchema: {
      dir: z.string().optional(),
      component: z.string().optional(),
      nodes: z.boolean().optional(),
      match: z.array(z.string()).length(2).optional()
    }
  },
  ({ dir, component, nodes, match }) =>
    guard('component inspect', async () => {
      let d = dir;
      if (!d) {
        const st = await buildStatus({ sampleMs: 0 });
        d = (st as { project?: { file?: string } }).project?.file?.replace(/\/project\.json$/, '');
      }
      if (!d) return { error: 'project-dir-missing', hint: 'No project is open and no dir was given.' };
      return inspectComponents(d, {
        component,
        nodes,
        match: match as [string, string] | undefined
      });
    })
);

server.registerTool(
  'xgenia_preview_text',
  {
    title: 'Read what the running game actually shows on screen',
    description:
      'Return the visible text of the preview iframe — the running game, as a player sees it — addressed directly by its local http origin so the editor\'s own empty contexts cannot answer in its place. ' +
      'This is how you check a build ACTUALLY works rather than trusting a report that it does. A graph can be perfect and the screen still wrong: one project had a verified maths-driven spin, real RNG, real win, capital moving in the model, while every readout on screen sat at its default because the data wires to the UI were never made. ' +
      'Use it before and after an action and diff the two: read, spin, read again, and see whether the numbers moved. match is a regex that keeps only matching lines (e.g. "balance|win|heat") so a spin check is one call instead of a wall of text.',
    inputSchema: {
      match: z.string().optional(),
      ignoreCase: z.boolean().optional(),
      maxChars: z.number().optional()
    }
  },
  ({ match, ignoreCase, maxChars }) =>
    guard('preview text', () => previewText({ match, ignoreCase, maxChars }))
);

server.registerTool(
  'xgenia_preview_click',
  {
    title: 'Press a control in the running game',
    description:
      'Dispatch a real click on a control in the preview iframe, found by its visible text (case-insensitive, smallest matching element — so "SPIN" presses the button, not the panel around it). ' +
      'Pairs with xgenia_preview_text to close the verification loop WITHOUT asking the builder to do it: read the screen, click, read again, judge from the difference. ' +
      '"I clicked SPIN and the balance updated" is the claim that decides whether a build is finished and the one most likely to be reported optimistically — this is how you check it yourself. ' +
      'If no element matches, the result lists the text actually on screen so the miss is diagnosable. settleMs (default 1200) waits after the click before returning.',
    inputSchema: { text: z.string(), settleMs: z.number().optional() }
  },
  ({ text, settleMs }) => guard('preview click', () => previewClick({ text, settleMs }))
);

server.registerTool(
  'xgenia_freeze_watch',
  {
    title: 'Capture WHY the renderer froze — the blocking JS call stack',
    description:
      'Attach a debugger to the editor page while it is still healthy, watch for it to stop responding, then interrupt it and return the JavaScript call stack that is blocking it. ' +
      'START THIS BEFORE the risky action (instancing a component, opening a project), then perform that action with another call — a debugger attached AFTER a freeze cannot work, because Debugger.enable needs the very thread that is stuck. ' +
      'Verdicts: js-stack-captured (frames + repeatedFrames — repeated frames are the signature of a loop); not-blocked-in-javascript (a pre-armed pause never fired, so suspect a native/IPC wait or GC rather than a JS loop); no freeze within the window. ' +
      'This is the difference between "the editor froze" and "the editor froze in Node._updateDependencies, so the graph has a dependency cycle" — the second is actionable, the first cost one project most of a day. ' +
      'watchMs (default 120000) is how long to watch; pollMs (default 4000) how often to check.',
    inputSchema: {
      watchMs: z.number().optional(),
      pollMs: z.number().optional(),
      port: z.number().optional(),
      evaluateTimeoutMs: z.number().optional()
    }
  },
  ({ watchMs, pollMs, port, evaluateTimeoutMs }) =>
    guard('freeze watch', () => freezeWatch({ watchMs, pollMs, port, evaluateTimeoutMs }))
);

server.registerTool(
  'xgenia_editor_probe',
  {
    title: 'Is the editor really unresponsive? Ask it directly, without Playwright',
    description:
      'Reach the editor over raw CDP (HTTP + a single websocket evaluate) with nothing shared with the normal tool path, and classify what is actually wrong. ' +
      'Run this WHENEVER a tool reports editor-unresponsive or times out, BEFORE concluding anything about the renderer and before restarting anything. ' +
      'Verdicts: connect-stalled (the page answered — Playwright stalled, just retry the call, change nothing else); editor-blocked (CDP answers but the page will not evaluate — genuinely wedged, may recover on its own); editor-unresponsive (something owns the port but CDP is silent); not-running (nothing listening). ' +
      'This distinction is not academic: a stalled connect and a blocked renderer look identical through every other tool, and treating the first as the second has cost real builds hours of wrong diagnosis.',
    inputSchema: { port: z.number().optional(), timeoutMs: z.number().optional() }
  },
  ({ port, timeoutMs }) =>
    guard('probe', async () => {
      const p = port ?? discoverPort();
      const probe = await rawProbe(p, SELECTORS.editorPageUrlSuffix, { timeoutMs });
      // `listening` must be the PORT OWNER, not whether HTTP answered. Deriving it from
      // httpOk made a live, port-owning editor whose CDP had stopped answering report
      // "not-running" — the caller is then told there is nothing to wait for and nothing
      // to kill, which is exactly backwards, and is the same conflation this whole module
      // exists to remove.
      const owner = portOwner(p);
      // Nothing failed to prompt this call, so a responsive page means ok, not stalled.
      const verdict = classifyProbe({
        listening: owner !== null,
        httpOk: probe.httpOk,
        editorPageResponsive: probe.editorPageResponsive,
        connectFailed: false
      });
      return { port: p, verdict, hint: probeHint(verdict), portOwner: owner, probe };
    })
);

server.registerTool(
  'xgenia_console_tail',
  {
    title: 'Capture the renderer console for a window of time',
    description:
      'Attach to the editor page\'s console and uncaught-error stream for durationMs (default 30s, max 10min) and return what was logged, with relative timestamps and a responsiveAtEnd flag. ' +
      'Start this BEFORE a risky action (opening a project, instancing a component), perform the action with another call, then read the result — a renderer that hangs cannot export a debug bundle, so this is the only way to see what it logged in the seconds before it stopped. ' +
      'Silence after a burst of activity is the signature of a synchronous loop; a pageerror entry is a crash. Optional filter is a case-insensitive regex on the text.',
    inputSchema: {
      durationMs: z.number().optional(),
      filter: z.string().optional(),
      maxEntries: z.number().optional()
    }
  },
  ({ durationMs, filter, maxEntries }) =>
    guard('console tail', () => consoleTail({ durationMs, filter, maxEntries }))
);

server.registerTool(
  'xgenia_screenshot',
  {
    title: 'Screenshot XGENIA',
    description:
      'Capture the editor window, the chat panel, or the canvas. Returns base64 plus cssSize, imageSize, contentSize and scale. ' +
      'Convert any coordinate you read off the image through `scale` before using it with page.mouse or anything else expecting CSS pixels. ' +
      'IMAGE PIXELS ARE NOT ALL PAGE: `imageSize` is the whole buffer, `contentSize` is the part of it the editor is actually drawn in, anchored top-left. ' +
      'The editor runs at an Electron zoom factor, and the capture surface is allocated at the display backing scale rather than the zoomed one, so with zoom 0.8 the buffer comes back 25% wider than the page and the last 20% of it is blank. ' +
      'When `note` says the image is padded, treat anything beyond contentSize as empty space, not as editor UI with nothing in it. When `note` says it is cropped (zoomed in past the surface), the right and bottom of the page are missing from the image entirely.',
    inputSchema: {
      region: z.enum(['full', 'chat', 'canvas']).optional(),
      format: z.enum(['jpeg', 'png']).optional()
    }
  },
  async ({ region, format }) => {
    try {
      const result = await screenshot({ region, format });
      if ('error' in result) return text(result);
      return {
        content: [
          { type: 'image' as const, data: result.image, mimeType: result.mimeType },
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                region: result.region,
                cssSize: result.cssSize,
                imageSize: result.imageSize,
                scale: result.scale,
                bytes: result.bytes
              },
              null,
              2
            )
          }
        ]
      };
    } catch (e) {
      const err = e as Error & { code?: string };
      return text({ error: err.code ?? 'page-unresponsive', tried: 'screenshot', hint: err.message });
    }
  }
);

async function main() {
  await server.connect(new StdioServerTransport());
  console.error('xgenia-mcp listening on stdio');
}

main().catch((e) => {
  console.error('xgenia-mcp failed to start:', e);
  process.exit(1);
});

server.registerTool(
  'xgenia_debug_export',
  {
    title: 'Pull the AI panel debug export',
    description:
      "Click the chat panel's Debug Export and return the FILE PATH plus a census of what the AI actually did. " +
      'The bundle is the only record of the panel AI\'s own run: every tool call with its arguments and result, the thinking log, the raw API history, both consoles, and the token spend. One slot build produced 7.2MB and 640 tool calls, so this never returns the bundle itself — it returns `file` for you to read or query, plus which tools failed with which codes, the top editor errors and the cost. ' +
      'Use xgenia_debug_query to search inside it without moving it through context. ' +
      'A result is only counted as a failure when its envelope says ok:false or result.success:false; prose and condenser-pruned results are reported separately as unparsedResults/prunedByCondenser, because counting those as failures inflated one real census from 77 to 382. ' +
      'Pass reuseExisting to summarise the newest export already on disk instead of producing a fresh one, and copyTo to keep a copy somewhere a Downloads clear-out will not reach.',
    inputSchema: {
      reuseExisting: z.boolean().optional(),
      timeoutMs: z.number().optional(),
      copyTo: z.string().optional()
    }
  },
  (args) => guard('click Debug Export and read the downloaded bundle', () => debugExport(args))
);

server.registerTool(
  'xgenia_debug_query',
  {
    title: 'Search the AI panel debug export',
    description:
      'Grep one section of a debug export and return only the matching entries, each clipped. ' +
      'Sections: toolCallSummary (default; each entry {tool, input, result}), thinkingLog, visibleChat, rawApiHistory, errors, errorsBeforeSession, consoleLogs.viewer, consoleLogs.editor, subAgents, taskTracking. ' +
      'Combine `tool` and `failuresOnly` to answer "which calls to X failed and why" without reading the file, or `grep` (a JS regular expression, case-insensitive by default) to search the serialised entry. ' +
      'Reads the newest export on disk unless you pass `file`. Returns `matched` alongside `returned` so a truncated answer is visible rather than silent.',
    inputSchema: {
      section: z
        .enum([
          'toolCallSummary',
          'thinkingLog',
          'visibleChat',
          'rawApiHistory',
          'errors',
          'errorsBeforeSession',
          'consoleLogs.viewer',
          'consoleLogs.editor',
          'subAgents',
          'taskTracking'
        ])
        .optional(),
      grep: z.string().optional(),
      ignoreCase: z.boolean().optional(),
      tool: z.string().optional(),
      failuresOnly: z.boolean().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      clip: z.number().optional(),
      file: z.string().optional()
    }
  },
  (args) => guard('grep the debug export', () => debugQuery(args))
);

server.registerTool(
  'xgenia_runtime_logs',
  {
    title: 'Grep the live engine log buffer',
    description:
      "Read the running preview's own log buffer (window.XgeniaRuntimeLogs) with NO export step. " +
      'This is what the game actually did, live: which JavaScript function nodes ran and with what body, reel-controller latches such as "stop signal arrived before spin", and every runtimeEval request the panel sent. It answers questions about the CURRENT state rather than about whenever someone last clicked export. ' +
      'It addresses the preview iframe directly by URL, so it cannot be answered by the empty external/cloudruntime page that also exists in the process — the surface that makes the panel\'s own runtime tools report a mounted game as not_mounted. ' +
      'The buffer resets when the preview reloads.',
    inputSchema: {
      grep: z.string().optional(),
      ignoreCase: z.boolean().optional(),
      tail: z.number().optional(),
      clip: z.number().optional()
    }
  },
  (args) => guard('read window.XgeniaRuntimeLogs in the preview frame', () => runtimeLogs(args))
);
