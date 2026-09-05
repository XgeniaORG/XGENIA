#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { health, probe, projectStatus } from './editor-state.js';
import { chatSend, chatRead, chatWaitIdle } from './chat.js';
import { screenshot } from './screenshot.js';
import { openProject, newProject, closeProject } from './project.js';
import { launch, restart, quit } from './lifecycle.js';

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
      'authenticated reports whether the editor is past the login screen (window.ProjectModel is defined on the login screen too, so nothing else here implies anyone is signed in) — it is "unknown", not a confident true, whenever pageResponsive is false.',
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
      'Every pre-kill read of the old editor is bounded, so a wedged editor (pageResponsive:false in xgenia_health) cannot hang this call forever: without force it returns {error: "editor-unresponsive"} explaining that the pre-restart save and busy-check could not be performed; with force it skips those reads entirely and proceeds straight to the kill, reporting the honest gaps that leaves (project: null, save unconfirmed, inFlightTurnLost: "unknown"). ' +
      'Shutdown is graceful by default: SIGTERM is given a generous grace period to let the Electron renderer flush localStorage/IndexedDB before SIGKILL is even considered, and the process is polled so an editor that exits promptly is not slowed down. hardKilled reports whether that grace period actually expired and SIGKILL was needed — true is the case where losing unflushed state (e.g. an auth session) is plausible, so check it after any restart.',
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
      'Shares xgenia_restart\'s bounded pre-kill reads: on an unresponsive editor it fails closed with {error: "editor-unresponsive"} unless force is set, in which case it kills anyway and reports project: null, save unconfirmed, and inFlightTurnLost: "unknown" rather than guessing. ' +
      'Also shares xgenia_restart\'s graceful-by-default shutdown: SIGTERM gets a generous grace period (polled, so a prompt exit is not slowed down) to let the Electron renderer flush localStorage/IndexedDB before SIGKILL is considered at all. hardKilled reports whether that grace period expired and a hard kill was actually needed — true is the case where losing unflushed state (e.g. an auth session) is plausible.',
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
      'Before returning, it also waits briefly for the AI chat panel to finish mounting (observed live to still be mounting for a few seconds right after the project verifiably opens) and reports chatReady: true/false on success — false does not mean the open failed, only that the chat panel is not usable yet (e.g. still mounting, closed, or entitlement-gated); chatUnavailable/chatError carry the reason from the panel read when there is one.',
    inputSchema: { dir: z.string().optional(), name: z.string().optional() }
  },
  ({ dir, name }) => guard('open project', () => openProject({ dir, name }))
);

server.registerTool(
  'xgenia_new_project',
  {
    title: 'Create a new XGENIA project',
    description:
      'Create a project directory with a fresh, empty project.json (one root Group node, no components beyond /App) and open it. ' +
      'If dir is omitted, a sibling directory of the most recently opened project is used (or the home directory if there is no recents history yet). Refuses — rather than overwriting — when the resolved directory already exists and is non-empty. ' +
      'This reuses xgenia_open_project internally, so it inherits the same recents handling, verify-by-value check, and chatReady/chatUnavailable/chatError reporting for the AI chat panel; the result carries everything xgenia_open_project returns plus createdDir.',
    inputSchema: { name: z.string(), dir: z.string().optional() }
  },
  ({ name, dir }) => guard('new project', () => newProject({ name, dir }))
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
      'Read the AI chat transcript, paged from an index. Long messages are truncated; the message count and busy flag come from the live panel.',
    inputSchema: { since: z.number().optional(), limit: z.number().optional() }
  },
  ({ since, limit }) => guard('chat read', () => chatRead({ since, limit }))
);

server.registerTool(
  'xgenia_chat_wait_idle',
  {
    title: 'Wait for the XGENIA AI chat to finish',
    description:
      'Block until the AI chat panel stops generating. On timeout it returns timedOut instead of throwing, so you can screenshot and decide.',
    inputSchema: { timeoutMs: z.number().optional() }
  },
  ({ timeoutMs }) => guard('chat wait idle', () => chatWaitIdle(timeoutMs ?? 300_000))
);

server.registerTool(
  'xgenia_screenshot',
  {
    title: 'Screenshot XGENIA',
    description:
      'Capture the editor window, the chat panel, or the canvas. Returns base64 plus cssSize, imageSize and a measured scale factor. ' +
      'ALWAYS convert any coordinate you read off the returned image through that scale before using it (e.g. with page.mouse or another tool that expects CSS pixels) — imageSize is in physical pixels of the capture, cssSize is not. scale is measured per capture, not a constant: it is neither 1 nor a fixed 2, because the editor runs at an Electron zoom factor (live measurements have shown ~1.25, from zoom 0.8 on a 2x-density display), and it moves whenever the user changes zoom.',
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
