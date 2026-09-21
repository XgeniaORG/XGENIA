/**
 * xgenia_build_status — the supervisor's one-call answer to three questions:
 *
 *   1. Is it on track?        what exists in the project right now, and what is still hollow
 *   2. Did it stop?           busy / idle / stalled, judged by change over a sample window
 *   3. Did it build it?       a component inventory to compare against what was asked for
 *
 * These are the questions a human supervising a build actually asks, and none of them were
 * answerable in one call before. `xgenia_health` says the editor is alive. `xgenia_chat_read`
 * says the panel is busy. Neither distinguishes a panel working hard from one wedged
 * mid-turn, and neither says whether the thing the user asked for exists yet.
 *
 * Stall detection needs time, so this samples the panel twice around a short wait and
 * compares. `busy` with no growth in either message count or the last message's length over
 * the window is reported as `stalled` — the state that previously looked identical to
 * progress and cost a build 39 minutes.
 *
 * Everything about the project is read from project.json on disk: no panel turn, and it
 * works even when the renderer is too wedged to answer.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect, getChatFrame } from './connection.js';
import { readProject, readChatState, readChatVisibility, readTurnCompletion } from './editor-state.js';

type Json = Record<string, unknown>;

interface Node {
  id: string;
  type?: string;
  parameters?: Json;
  children?: Node[];
}
interface Component {
  name: string;
  graph?: { roots?: Node[]; connections?: { toId?: string; fromId?: string }[] };
}

function flatten(nodes: Node[] | undefined, out: Node[] = []): Node[] {
  for (const n of nodes ?? []) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

const MATHS_PREFIX = '/#__maths__/';

export interface ComponentSummary {
  name: string;
  kind: 'maths' | 'visual' | 'app';
  nodes: number;
  connections: number;
  nodeTypes: Record<string, number>;
  scriptChars: number;
  /** Text/visual nodes with no incoming wire — layout that is not yet fed. */
  unwiredDisplayNodes: number;
  /** Nothing wired at all: created but not built. */
  hollow: boolean;
}

export function summariseProject(json: Json): {
  components: ComponentSummary[];
  totals: Json;
  gaps: string[];
} {
  const comps = (json.components as Component[] | undefined) ?? [];
  const summaries: ComponentSummary[] = [];
  const gaps: string[] = [];

  for (const c of comps) {
    const nodes = flatten(c.graph?.roots);
    const conns = c.graph?.connections ?? [];
    const wired = new Set(conns.map((k) => k.toId));
    const types: Record<string, number> = {};
    let scriptChars = 0;
    let unwiredDisplay = 0;
    for (const n of nodes) {
      const t = n.type ?? '(untyped)';
      types[t] = (types[t] ?? 0) + 1;
      const src = n.parameters?.functionScript;
      if (typeof src === 'string') scriptChars += src.length;
      if ((t === 'Text' || t.startsWith('pixi.')) && !wired.has(n.id)) unwiredDisplay += 1;
    }
    const kind: ComponentSummary['kind'] = c.name.startsWith(MATHS_PREFIX)
      ? 'maths'
      : c.name === '/App'
        ? 'app'
        : 'visual';
    const hollow = nodes.length > 0 && conns.length === 0;
    summaries.push({
      name: c.name,
      kind,
      nodes: nodes.length,
      connections: conns.length,
      nodeTypes: types,
      scriptChars,
      unwiredDisplayNodes: unwiredDisplay,
      hollow
    });
    if (hollow) gaps.push(`${c.name}: ${nodes.length} nodes, no connections — created but not wired`);
    if (unwiredDisplay > 0) {
      gaps.push(`${c.name}: ${unwiredDisplay} display node(s) with no incoming wire — showing defaults, not data`);
    }
  }

  const app = summaries.find((s) => s.kind === 'app');
  if (app && app.connections === 0) {
    gaps.push('/App has no connections — nothing on screen is fed from anywhere');
  }
  if (!summaries.some((s) => s.kind === 'maths')) {
    gaps.push(`no ${MATHS_PREFIX} component exists — nothing here compiles to the RGS`);
  }

  return {
    components: summaries,
    totals: {
      components: summaries.length,
      maths: summaries.filter((s) => s.kind === 'maths').length,
      visual: summaries.filter((s) => s.kind === 'visual').length,
      nodes: summaries.reduce((a, s) => a + s.nodes, 0),
      connections: summaries.reduce((a, s) => a + s.connections, 0),
      scriptChars: summaries.reduce((a, s) => a + s.scriptChars, 0)
    },
    gaps
  };
}

export async function buildStatus(opts: { dir?: string; sampleMs?: number } = {}) {
  const sampleMs = Math.min(Math.max(opts.sampleMs ?? 8_000, 0), 60_000);

  // ---- panel: busy / idle / stalled, judged by change across a window ----
  let panel: Json;
  let dir = opts.dir;
  /** What the editor actually has open, which is not necessarily what we were asked about. */
  let live: { name: string; dir: string | null } | null = null;
  let visibility: Awaited<ReturnType<typeof readChatVisibility>> | null = null;
  let completion: Awaited<ReturnType<typeof readTurnCompletion>> | null = null;
  try {
    const { page } = await connect();
    const frame = getChatFrame(page);
    const before = frame ? await readChatState(page) : null;
    visibility = await readChatVisibility(page);
    completion = frame ? await readTurnCompletion(page) : null;
    const project = await readProject(page);
    live = project ? { name: project.name, dir: project.dir } : null;
    if (!dir && project?.dir) dir = project.dir;
    if (before && sampleMs > 0) {
      await new Promise((r) => setTimeout(r, sampleMs));
    }
    const after = frame ? await readChatState(page) : null;
    if (!before || !after) {
      panel = { state: 'no-chat-panel', hint: 'No AI chat panel is mounted. Open a project, or open the panel.' };
    } else {
      const grew = after.messageCount > before.messageCount;
      // "quiet", not "stalled": the panel routinely spends longer than a short window inside a
      // single tool call, so no growth over 10s is normal and calling it stalled cries wolf.
      // Only a long quiet window is evidence of trouble, and even then the transcript decides.
      const state = !after.busy ? 'idle' : grew ? 'working' : sampleMs >= 30_000 ? 'quiet-long' : 'quiet';
      // A panel the user cannot see is the single most common "it crashed" report, and it
      // is indistinguishable from a healthy one from inside the frame. Say so explicitly.
      const hidden = visibility?.present === true && visibility.visible === false;
      // An idle panel has not necessarily finished. See readTurnCompletion.
      const stoppedShort = !after.busy && (completion?.checkpointPaused || completion?.unverified);
      panel = {
        state,
        ...(stoppedShort
          ? {
              turnIncomplete: true,
              ...(completion?.checkpointPaused ? { checkpointPaused: true } : {}),
              ...(completion?.unverified ? { unverified: true } : {}),
              ...(completion?.notice ? { notice: completion.notice } : {}),
              turnIncompleteHint:
                'This turn ENDED WITHOUT FINISHING: the platform paused it at a loop checkpoint and/or it never ran its own verification, so any "done" claim is unvalidated. Idle here does not mean complete. Verify the graph yourself, then send a message to resume — the next turn picks up where it stopped.'
            }
          : {}),
        ...(hidden
          ? {
              visible: false,
              hiddenBy: visibility?.hiddenBy ?? 'zero-sized container',
              hiddenHint:
                'The chat panel is loaded and readable but NOT on screen (its container is hidden — typically the editor is in Canvases/art mode). To the user this looks like a crash. xgenia_open_chat_panel restores it without touching the project.'
            }
          : { visible: true }),
        busy: after.busy,
        messageCount: after.messageCount,
        messagesAddedInWindow: after.messageCount - before.messageCount,
        sampledForMs: sampleMs,
        ...(state.startsWith('quiet')
          ? {
              hint:
                state === 'quiet'
                  ? `Busy, nothing new in ${Math.round(sampleMs / 1000)}s. Normal mid-tool-call — not evidence of a stall. Re-run with sampleMs 30000+ before concluding anything.`
                  : `Busy but nothing new in ${Math.round(sampleMs / 1000)}s. Read the last transcript entry before assuming it is thinking: a long tool call, a wedged renderer and a dead account all look like this. Check for an account/credit error, which reports sent: true and never runs.`
            }
          : {})
      };
    }
  } catch (e) {
    panel = { state: 'unreachable', error: (e as Error).message.slice(0, 200) };
  }

  // ---- project: what actually exists, read from disk ----
  if (!dir) {
    return {
      panel,
      error: 'project-dir-missing',
      hint: 'No project is open and no dir was given. Pass dir to inspect a project regardless of editor state.'
    };
  }
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) {
    return { panel, error: 'project-dir-missing', tried: file, hint: 'project.json not found there.' };
  }
  let json: Json;
  let mtimeMs: number;
  try {
    const st = fs.statSync(file);
    mtimeMs = st.mtimeMs;
    json = JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
  } catch (e) {
    return { panel, error: 'project-dir-missing', tried: file, hint: `unreadable: ${(e as Error).message}` };
  }

  const { components, totals, gaps } = summariseProject(json);
  // Auditing project.json for a project the editor does not have open is a silent way to
  // reach confident conclusions about the wrong thing — a supervisor once spent a stretch
  // reporting on a project that had been closed and replaced by another.
  const liveDir = live?.dir ?? null;
  const mismatch = liveDir !== null && path.resolve(liveDir) !== path.resolve(dir);
  if (mismatch) {
    gaps.unshift(
      `editor has a DIFFERENT project open (${live?.name ?? '?'} at ${liveDir}) than the one inspected here (${dir}) — this report describes files on disk that nobody is editing`
    );
  }
  if (!live) {
    gaps.unshift('no project is open in the editor — this report is from disk only');
  }
  return {
    panel,
    openInEditor: live ? { name: live.name, dir: liveDir, matchesInspected: !mismatch } : null,
    project: {
      file,
      lastSavedSecondsAgo: Math.round((Date.now() - mtimeMs) / 1000),
      totals,
      components
    },
    gaps
  };
}
