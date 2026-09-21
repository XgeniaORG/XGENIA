/**
 * xgenia_component_inspect — what is inside a component, and what does it expose?
 *
 * This is the question a supervisor asks constantly and had no tool for. `build_status`
 * counts nodes; `project_audit` judges wiring; neither will tell you the one thing you
 * need before connecting two components: *which ports does each side actually have?*
 *
 * Without it, the same three ad-hoc scripts get rewritten every session — walk the node
 * tree, pull the Component Inputs/Outputs port names, diff them by hand. Worse, guessing
 * a port name is exactly how phantom wires get created: the editor accepts a wire to a
 * port that does not exist and it silently never fires.
 *
 * So this also answers the follow-up directly: given a producer and a consumer, which
 * port names line up, and which do not. On one real project that turned a slow manual
 * comparison into "12 of 15 match by name, here are the 3 that do not" — and the 3 that
 * do not are precisely where a human needs to make a semantic decision rather than a
 * naming one.
 */

import fs from 'node:fs';
import path from 'node:path';

type Json = Record<string, unknown>;

interface Port {
  name?: string;
  plug?: string;
  type?: unknown;
}
interface Node {
  id: string;
  type?: string;
  label?: string;
  parameters?: Json;
  ports?: Port[];
  dynamicports?: Port[];
  children?: Node[];
}
interface Connection {
  fromId?: string;
  toId?: string;
  fromProperty?: string;
  toProperty?: string;
}
interface Component {
  name: string;
  graph?: { roots?: Node[]; connections?: Connection[] };
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
  return String(n.label ?? (p as { label?: string }).label ?? n.type ?? '(node)');
}

/**
 * Port names on a Component Inputs / Component Outputs node.
 *
 * Both the static `ports` list and `dynamicports` count: the editor creates ports from
 * either, and a reader that checks only one will report a port as missing when it is
 * present.
 */
function portNames(n: Node): string[] {
  const s = new Set<string>();
  for (const p of n.ports ?? []) if (p.name) s.add(p.name);
  for (const p of n.dynamicports ?? []) if (p.name) s.add(p.name);
  return [...s].sort();
}

export interface ComponentDetail {
  name: string;
  kind: 'maths' | 'visual' | 'app';
  nodeCount: number;
  connectionCount: number;
  /** Ports the component exposes to whoever instances it. */
  inputs: string[];
  outputs: string[];
  /**
   * Who feeds each exposed output: `Label.port [NodeType]`, or `(unfed)` when the port is
   * declared and nothing wires into it.
   *
   * This is the question that decides whether a feature is REAL. A UI can be fully wired to
   * a component's outputs and still show nothing, because the output itself is fed by a
   * placeholder. One project exposed OrbitDawnGrid, OrbitDuskGrid and UnderlayerState — three
   * of its four boards — and all three were fed by `PaytableModifier.paytable`, a paytable
   * object wired into grid ports. Every structural check passed; the boards were empty.
   * The producer's type is included because that is how the mismatch shows.
   */
  outputSources: Record<string, string[]>;
  nodes: { id: string; type: string; label: string; scriptChars?: number }[];
  /** Other components instanced inside this one. */
  instances: string[];
}

const MATHS_PREFIX = '/#__maths__/';

function kindOf(name: string): ComponentDetail['kind'] {
  return name.startsWith(MATHS_PREFIX) ? 'maths' : name === '/App' ? 'app' : 'visual';
}

export function describeComponent(c: Component, opts: { nodes?: boolean } = {}): ComponentDetail {
  const all = flatten(c.graph?.roots);
  let inputs: string[] = [];
  let outputs: string[] = [];
  let outputsNode: Node | undefined;
  const instances: string[] = [];
  for (const n of all) {
    if (n.type === 'Component Inputs') inputs = portNames(n);
    else if (n.type === 'Component Outputs') {
      outputs = portNames(n);
      outputsNode = n;
    } else if (n.type?.startsWith('/')) instances.push(n.type);
  }
  const byId = new Map(all.map((n) => [n.id, n]));
  const outputSources: Record<string, string[]> = {};
  for (const port of outputs) outputSources[port] = [];
  if (outputsNode) {
    for (const k of c.graph?.connections ?? []) {
      if (k.toId !== outputsNode.id || !k.toProperty) continue;
      const from = k.fromId ? byId.get(k.fromId) : undefined;
      const desc = `${from ? labelOf(from) : '?'}.${k.fromProperty ?? '?'} [${from?.type ?? 'missing node'}]`;
      (outputSources[k.toProperty] ??= []).push(desc);
    }
  }
  for (const port of Object.keys(outputSources)) {
    if (outputSources[port]!.length === 0) outputSources[port] = ['(unfed)'];
  }
  return {
    name: c.name,
    kind: kindOf(c.name),
    nodeCount: all.length,
    connectionCount: c.graph?.connections?.length ?? 0,
    inputs,
    outputs,
    outputSources,
    instances,
    nodes: opts.nodes
      ? all.map((n) => {
          const src = (n.parameters as { functionScript?: unknown } | undefined)?.functionScript;
          return {
            id: String(n.id).slice(0, 8),
            type: n.type ?? '(untyped)',
            label: labelOf(n),
            ...(typeof src === 'string' ? { scriptChars: src.length } : {})
          };
        })
      : []
  };
}

/**
 * Line up one component's outputs against another's inputs.
 *
 * Name equality is the only thing claimed here. A matching name is a strong hint and
 * nothing more — two ports can share a name and mean different quantities — so the
 * mismatches are reported as work for a human, not as an error.
 */
export function matchPorts(
  producer: ComponentDetail,
  consumer: ComponentDetail
): { matched: string[]; consumerUnfed: string[]; producerUnused: string[] } {
  const outs = new Set(producer.outputs);
  const ins = new Set(consumer.inputs);
  return {
    matched: [...ins].filter((i) => outs.has(i)).sort(),
    consumerUnfed: [...ins].filter((i) => !outs.has(i)).sort(),
    producerUnused: [...outs].filter((o) => !ins.has(o)).sort()
  };
}

export function inspectComponents(
  dir: string,
  opts: { component?: string; nodes?: boolean; match?: [string, string] } = {}
) {
  const file = path.join(dir, 'project.json');
  if (!fs.existsSync(file)) {
    return { error: 'project-dir-missing', tried: file, hint: 'project.json not found there.' };
  }
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { components?: Component[] };
  const comps = json.components ?? [];
  const stale = Math.round((Date.now() - fs.statSync(file).mtimeMs) / 1000);

  // Read from disk, so be honest that unsaved editor state is not represented here.
  const freshness = {
    lastSavedSecondsAgo: stale,
    ...(stale > 120
      ? { note: 'project.json has not been written in over 2 minutes; edits made since are not reflected here' }
      : {})
  };

  if (opts.match) {
    const [a, b] = opts.match;
    const pa = comps.find((c) => c.name === a);
    const pb = comps.find((c) => c.name === b);
    if (!pa || !pb) {
      return {
        error: 'component-not-found',
        missing: [!pa ? a : null, !pb ? b : null].filter(Boolean),
        available: comps.map((c) => c.name)
      };
    }
    const da = describeComponent(pa);
    const db = describeComponent(pb);
    const m = matchPorts(da, db);
    return {
      freshness,
      producer: { name: da.name, outputs: da.outputs },
      consumer: { name: db.name, inputs: db.inputs },
      ...m,
      // A matched name whose producer output is itself unfed, or fed by a node whose type
      // does not plausibly produce that quantity, is wired to nothing real.
      matchedSources: Object.fromEntries(m.matched.map((port) => [port, da.outputSources[port] ?? ['(unfed)']])),
      hint: 'Matching names are a hint, not a guarantee that two ports mean the same quantity. Check matchedSources: a matched output fed by a placeholder (e.g. a paytable object into a grid port) or by nothing renders as empty on the consumer side even though every wire exists. Ports under consumerUnfed need a decision about which producer output (if any) is the right source.'
    };
  }

  if (opts.component) {
    const c = comps.find((x) => x.name === opts.component);
    if (!c) return { error: 'component-not-found', available: comps.map((x) => x.name) };
    return { freshness, component: describeComponent(c, { nodes: opts.nodes ?? true }) };
  }

  return {
    freshness,
    components: comps.map((c) => describeComponent(c, { nodes: false }))
  };
}
