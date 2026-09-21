/**
 * xgenia_run_script_node — execute one JavaScriptFunction node's stored body offline.
 *
 * A script node's body is plain JavaScript over two objects, `Inputs` and `Outputs`.
 * Pulling it out of project.json and running it under
 * `new Function('Inputs', 'Outputs', body)` with stub inputs exercises the REAL stored
 * code with no editor, no panel turn and no renderer risk.
 *
 * Doing exactly this by hand on one build found: three call sites still carrying a
 * stale `Outputs.Meters.` prefix (would throw on first run); a `resetRoundMeters`
 * helper defined and never called (a documented reset that did nothing); a socket
 * progression that skipped revealed→lit (an RTP-budgeted subsystem that could never
 * pay); and an all-supernova sigil award of 35,000× where the spec says 1,000×.
 * None of those were visible in any graph audit or screenshot.
 *
 * This is a test harness, not the runtime: signal outputs — the four common ones and any
 * name the node declares for itself — are recorded as fired, not propagated anywhere. It cannot run nodes that reach outside
 * their body (require, fetch, DOM) — those fail with the thrown error reported back.
 */

import fs from 'node:fs';
import path from 'node:path';
import { connect } from './connection.js';
import { readProject } from './editor-state.js';

type Json = Record<string, unknown>;

interface Node {
  id: string;
  type?: string;
  parameters?: Json;
  children?: Node[];
}
interface Component {
  name: string;
  graph?: { roots?: Node[] };
}

function flatten(nodes: Node[] | undefined, out: Node[] = []): Node[] {
  for (const n of nodes ?? []) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function labelOf(n: Node): string {
  const p = n.parameters ?? {};
  return (p.label as string) || (p.nodeLabel as string) || '';
}

/** Make a value JSON-safe for the tool result; functions and cycles become markers. */
function safe(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof v === 'function') return '[Function]';
  if (typeof v === 'bigint') return v.toString();
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => safe(x, depth + 1));
  const out: Json = {};
  for (const [k, val] of Object.entries(v as Json).slice(0, 200)) out[k] = safe(val, depth + 1);
  return out;
}

export function runScriptBody(body: string, inputs: Json) {
  const fired: string[] = [];
  /** Outputs read but never assigned — what used to surface as a thrown TypeError. */
  const unassignedReads: string[] = [];
  const Outputs: Json = {};
  // Signal outputs are functions on the real node (Outputs.Done()). Provide them for the
  // common names, and record any call so the harness can report which signals fired.
  for (const sig of ['Done', 'Do', 'Success', 'Failure']) {
    Outputs[sig] = () => {
      fired.push(sig);
    };
  }
  // A node declares its OWN signal names, so the four above cover almost nothing: a gate
  // fires Outputs.ContinueCascade() / Outputs.PassLimitReached(). Those used to come back
  // as "Outputs.X is not a function", which made this harness useless for exactly the
  // control-flow nodes most worth testing — an unbounded cascade loop is a synchronous
  // renderer freeze, and the guard that prevents it is a gate node.
  //
  // So any unknown property returns a recording callable. Calling it records a fired
  // signal; reading a property off it records an unassigned-output read instead of
  // throwing, which keeps the `Outputs.X.y`-without-assignment defect visible (it is
  // reported rather than raised) while letting the rest of the body run to completion.
  const proxied = new Proxy(Outputs, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      const record = () => {
        fired.push(prop);
      };
      return new Proxy(record, {
        get(_t, sub: string) {
          if (sub === 'name' || sub === 'length' || sub === 'call' || sub === 'apply') {
            return (record as unknown as Json)[sub];
          }
          unassignedReads.push(`${prop}.${String(sub)}`);
          return undefined;
        }
      });
    }
  });
  const startedAt = Date.now();
  try {
    // eslint-disable-next-line no-new-func
    new Function('Inputs', 'Outputs', body)(inputs, proxied);
  } catch (e) {
    return {
      threw: true,
      error: (e as Error).message,
      stack: ((e as Error).stack ?? '').split('\n').slice(0, 6).join('\n'),
      firedSignals: fired,
      ...(unassignedReads.length ? { unassignedOutputReads: [...new Set(unassignedReads)] } : {}),
      outputs: safe(Object.fromEntries(Object.entries(Outputs).filter(([, v]) => typeof v !== 'function'))),
      elapsedMs: Date.now() - startedAt
    };
  }
  return {
    threw: false,
    firedSignals: fired,
    ...(unassignedReads.length ? { unassignedOutputReads: [...new Set(unassignedReads)] } : {}),
    outputs: safe(Object.fromEntries(Object.entries(Outputs).filter(([, v]) => typeof v !== 'function'))),
    elapsedMs: Date.now() - startedAt
  };
}

export async function runScriptNode(opts: {
  component: string;
  node: string;
  inputs?: Json;
  dir?: string;
}) {
  let dir = opts.dir;
  if (!dir) {
    const { page } = await connect();
    const project = await readProject(page);
    if (!project?.dir) {
      return {
        error: 'project-dir-missing',
        tried: 'readProject via the open editor',
        hint: 'No project is open. Open one with xgenia_open_project, or pass dir explicitly.'
      };
    }
    dir = project.dir;
  }
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) {
    return { error: 'project-dir-missing', tried: file, hint: 'project.json not found at that directory.' };
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { components?: Component[] };
  const comp = (json.components ?? []).find((c) => c.name === opts.component);
  if (!comp) {
    return {
      error: 'project-dir-missing',
      tried: opts.component,
      hint: `No component named ${opts.component}. Components: ${(json.components ?? []).map((c) => c.name).join(', ')}`
    };
  }
  const nodes = flatten(comp.graph?.roots).filter((n) => typeof n.parameters?.functionScript === 'string');
  const node = nodes.find((n) => labelOf(n) === opts.node || n.id === opts.node);
  if (!node) {
    return {
      error: 'selector-missing',
      tried: opts.node,
      hint: `No script node labelled ${opts.node} in ${opts.component}. Script nodes here: ${nodes.map(labelOf).filter(Boolean).join(', ') || '(none)'}`
    };
  }
  const body = node.parameters!.functionScript as string;
  const result = runScriptBody(body, opts.inputs ?? {});
  return { component: opts.component, node: labelOf(node) || node.id, bodyChars: body.length, ...result };
}
