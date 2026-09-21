/**
 * xgenia_project_audit — structural checks on the open project's project.json.
 *
 * Every check here is a defect class that was found the slow way on a real build
 * (a 7x7 cascade slot, 2026-09-19/20): the editor's own audits either did not
 * cover it or their result was never read. Each finding says which node, which
 * port, and what it will do at runtime. None of this needs the panel, a paid
 * turn, or a running preview — it reads the file on disk.
 *
 * What the checks are and why they exist:
 *
 * - phantom-port: a connection whose fromProperty/toProperty is not a declared
 *   port on a Component Inputs/Outputs node or a component instance. The editor
 *   creates these without complaint and they silently never fire. Observed:
 *   `Button:click` (the real port is `onClick`); `Outputs['Row'+i]` assigned in a
 *   script, which does not declare a port.
 * - dangling: an endpoint id that is not a node in the component.
 * - duplicate-output-source: two wires into one Component Outputs port. Which
 *   value wins is evaluation-order dependent. Observed: a pre-cap and post-cap
 *   award both wired to `spinWinnings`, so the 243-ways cap could be bypassed.
 * - timer-in-maths: a Timer inside a /#__maths__/ component. Those compile to a
 *   synchronous evaluate(ctx) script for the RGS; a wall-clock beat is not
 *   reproducible from a seed and cannot run there.
 * - maths-instance-in-visual: a /#__maths__/ component instanced inside a
 *   non-maths component. INFORMATIONAL ONLY. This is a supported, working
 *   pattern — the editor offers maths components in Browser-runtime pages on
 *   purpose, and real projects ship it. An earlier version of this rule called
 *   it a renderer hazard on the strength of four connect timeouts that turned
 *   out to be a stalled Playwright connect in front of a healthy page (see
 *   rawprobe.ts). It is surfaced only because maths in a visual component is
 *   frontend-only and never compiles to the RGS, which is a deployment fact
 *   worth noticing — not a stability warning.
 * - self-instancing-component: a component that contains an instance of itself, directly
 *   or through a chain of other components. Expanding it never terminates, so the editor's
 *   renderer blocks hard the moment it tries. Observed: a builder asked to instance
 *   /#__maths__/GameMaths into /App passed the wrong componentPath and created TWO
 *   instances of GameMaths inside GameMaths; the renderer stopped answering a direct CDP
 *   evaluate within a minute and had to be force-restarted. It never reaches project.json
 *   (the editor blocks before saving), which is why this also checks the LIVE graph shape
 *   rather than trusting a clean file — and why "instancing a maths component hangs the
 *   renderer" looked true for so long. Instancing is fine. Instancing into itself is not.
 * - timer-self-restart: a Timer whose `restart` is fed, directly or through other nodes,
 *   by something its own `timerFinished` drives. That is an unbounded wall-clock loop: it
 *   re-arms itself every period forever unless an explicit `stop` happens to fire first.
 *   Observed doing real damage — a 250ms self-restarting Timer added to "break a signal
 *   cycle" left the editor's renderer unable to answer at all, and the loop is invisible on
 *   the canvas because each individual wire looks reasonable. Trading a synchronous cycle
 *   for a timed one does not remove the cycle, it just makes it harder to see.
 * - duplicate-input-source: two or more DATA wires into the same input port on one node.
 *   Only one value survives and which one depends on evaluation order, so the node reads a
 *   different input than its author intended — silently, and differently between runs.
 *   Observed cost: a per-round win calculator guarded on `roundEnded === true` had that
 *   input fed by both a round-end flag (true) and a per-pass pass-through (false). The
 *   pass-through won, the guard never passed, and the game charged the stake on 13
 *   consecutive spins while crediting nothing. Every node ran and completed; the script was
 *   correct in isolation and returned the right answer when tested headless. Nothing but
 *   this rule can see it.
 * - data-dependency-cycle: a cycle over DATA dependencies — both wires AND variables.
 *
 *   The variable half matters enormously and was missed at first. A `Set Variable` and a
 *   `Variable` sharing a NAME are linked by that name, not by any wire, so a
 *   read-modify-write routed through a variable forms a real dependency cycle that a
 *   wire-only walk reports as clean. That is not hypothetical: told to break wire cycles, a
 *   builder moved them onto variables and wrote "read-modify-write without any data wire
 *   returning into the Variable2, so no data dependency cycle". The audit agreed. The
 *   renderer then span a full core at 100% CPU and wedged ~17 seconds after every project
 *   open, with eight such cycles present and zero reported. This is the one
 *   that kills the renderer, and it is invisible until the component is instanced. The
 *   runtime resolves a node's value by walking its data dependencies
 *   (NodeContext.updateDirtyNodes -> Node.update -> Node._updateDependencies -> ...), and
 *   that walk has no cycle guard: a data loop recurses until the main thread dies.
 *
 *   Proven, not inferred. A hand-placed, audit-clean instance of a maths component in /App
 *   froze the editor 12 seconds after open, and a pre-armed CDP Debugger.pause caught the
 *   stack mid-recursion with Node.update / Node._updateDependencies repeating. The
 *   component held nine data cycles of the read-modify-write accumulator shape
 *   (MeterPass -> HeatMeter -> MeterPass).
 *
 *   These look entirely reasonable on the canvas and survive every offline script test,
 *   because nothing walks the dependency graph until the component actually runs. That is
 *   why this is an error even though a human reviewer would call the wiring sensible:
 *   accumulate inside ONE script node, or route the feedback through a variable that is
 *   read on a signal rather than wired as a data input.
 * - signal-cycle: a cycle over signal-typed connections. Signals propagate
 *   synchronously in the editor; an unbounded cycle blocks the main thread.
 * - unwired-text: Text nodes in a visual component with no incoming connection.
 *   Informational — a layout that looks finished on screen with 49/49 grid cells
 *   unbound looked identical to a finished one.
 * - undefined-outputs-ref: a script node reading `Outputs.X.…` without ever
 *   assigning `Outputs.X`. Node scripts do not share scope; this throws
 *   "Cannot read properties of undefined" on first run.
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
  ports?: { name?: string; plug?: string }[];
  dynamicports?: { name?: string }[];
  children?: Node[];
}
interface Conn {
  fromId?: string;
  fromProperty?: string;
  toId?: string;
  toProperty?: string;
}
interface Component {
  name: string;
  graph?: { roots?: Node[]; connections?: Conn[] };
}

export interface Finding {
  severity: 'error' | 'warning' | 'info';
  rule: string;
  component: string;
  node?: string;
  detail: string;
}

const MATHS_PREFIX = '/#__maths__/';
const SIGNAL_IN = new Set(['Do', 'do', 'run', 'eval', 'increase', 'reset', 'start', 'restart', 'stop', 'add', 'Spin', 'Init', 'set']);
const SIGNAL_OUT = new Set(['Done', 'done', 'ontrue', 'onfalse', 'timerFinished', 'isTrueEv', 'isFalseEv', 'filled', 'onClick', 'click']);

function flatten(nodes: Node[] | undefined, out: Node[] = []): Node[] {
  for (const n of nodes ?? []) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
}

function labelOf(n: Node): string {
  const p = n.parameters ?? {};
  return (p.label as string) || (p.nodeLabel as string) || n.type || n.id;
}

function isMathsName(name: string | undefined): boolean {
  return typeof name === 'string' && name.startsWith(MATHS_PREFIX);
}

/** Ports a node exposes. Instances expose their component's Inputs/Outputs ports. */
function declaredPorts(node: Node, comps: Map<string, Component>): Set<string> {
  const names = new Set<string>();
  for (const p of node.ports ?? []) if (p.name) names.add(p.name);
  for (const p of node.dynamicports ?? []) if (p.name) names.add(p.name);
  const t = node.type ?? '';
  if (t.startsWith('/') && comps.has(t)) {
    for (const n2 of flatten(comps.get(t)!.graph?.roots)) {
      if (n2.type === 'Component Inputs' || n2.type === 'Component Outputs') {
        for (const p of n2.ports ?? []) if (p.name) names.add(p.name);
        for (const p of n2.dynamicports ?? []) if (p.name) names.add(p.name);
      }
    }
  }
  return names;
}

/**
 * Ports a JavaScriptFunction node actually exposes, derived from its body: `Inputs.X` reads
 * become `in-X`, `Outputs.X = …` and `Outputs.X()` become `out-X`. `out-Done` always exists.
 * Declared `ports` entries are honoured too when present.
 */
function scriptPorts(node: Node): { inputs: Set<string>; outputs: Set<string> } {
  // Built-in inputs of the JavaScriptFunction node, from the runtime definition
  // (std-library/simplejavascript.js `inputs:`): `run` is the trigger signal; the rest are
  // configuration. Everything else the node exposes is dynamic and prefixed. The static
  // `outputs` block is empty — every output, signals included, is registered as `out-<name>`.
  const inputs = new Set<string>(['run', 'functionScript', 'scriptInputs', 'scriptOutputs', 'isMath']);
  const outputs = new Set<string>(['out-Done']);
  for (const p of node.ports ?? []) {
    if (!p.name) continue;
    if (p.plug === 'output') outputs.add(p.name);
    else inputs.add(p.name);
  }
  // The DECLARED dynamic ports live in the node's `scriptInputs` / `scriptOutputs` proplists
  // as [{ id, label }]. These are what the editor creates ports from at load; a name the body
  // assigns but the proplist omits (e.g. Outputs['Row' + i]) is not connectable at load even
  // though the body regexes below would infer it. Treat the proplist as authoritative and the
  // body scan as a supplement.
  const prop = (key: 'scriptInputs' | 'scriptOutputs', prefix: 'in-' | 'out-', into: Set<string>) => {
    const list = node.parameters?.[key];
    if (!Array.isArray(list)) return;
    for (const e of list as { id?: string; label?: string }[]) {
      const name = e?.label ?? e?.id;
      if (name) into.add(`${prefix}${name}`);
    }
  };
  prop('scriptInputs', 'in-', inputs);
  prop('scriptOutputs', 'out-', outputs);
  const src = (node.parameters?.functionScript as string | undefined) ?? '';
  for (const m of src.matchAll(/Inputs\.([A-Za-z_$][\w$]*)/g)) inputs.add(`in-${m[1]!}`);
  for (const m of src.matchAll(/Inputs\[\s*['"]([^'"]+)['"]\s*\]/g)) inputs.add(`in-${m[1]!}`);
  for (const m of src.matchAll(/Outputs\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\()/g)) outputs.add(`out-${m[1]!}`);
  for (const m of src.matchAll(/Outputs\[\s*['"]([^'"]+)['"]\s*\]\s*=/g)) outputs.add(`out-${m[1]!}`);
  return { inputs, outputs };
}

function isSignal(fromProp: string | undefined, toProp: string | undefined): boolean {
  if (!toProp || !SIGNAL_IN.has(toProp)) return false;
  if (!fromProp) return false;
  return SIGNAL_OUT.has(fromProp) || fromProp.startsWith('out-') || fromProp.endsWith('Done');
}

function findSignalCycles(nodes: Node[], conns: Conn[]): string[][] {
  const g = new Map<string, Set<string>>();
  for (const k of conns) {
    if (k.fromId && k.toId && isSignal(k.fromProperty, k.toProperty)) {
      if (!g.has(k.fromId)) g.set(k.fromId, new Set());
      g.get(k.fromId)!.add(k.toId);
    }
  }
  const lbl = new Map(nodes.map((n) => [n.id, labelOf(n)]));
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const dfs = (u: string, stack: string[]) => {
    color.set(u, 1);
    stack.push(u);
    for (const v of g.get(u) ?? []) {
      if (color.get(v) === 1) {
        const cyc = stack.slice(stack.indexOf(v)).concat(v).map((x) => lbl.get(x) ?? x);
        const key = [...cyc].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cyc);
        }
      } else if (!color.get(v)) dfs(v, stack);
    }
    stack.pop();
    color.set(u, 2);
  };
  for (const n of g.keys()) if (!color.get(n)) dfs(n, []);
  return cycles;
}

export function auditProjectFile(projectJson: Json): { findings: Finding[]; summary: Json } {
  const components = (projectJson.components as Component[] | undefined) ?? [];
  const comps = new Map(components.map((c) => [c.name, c]));
  const findings: Finding[] = [];
  const counts: Record<string, number> = {};
  const add = (f: Finding) => {
    findings.push(f);
    counts[f.rule] = (counts[f.rule] ?? 0) + 1;
  };

  for (const comp of components) {
    const nodes = flatten(comp.graph?.roots);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const conns = comp.graph?.connections ?? [];
    const maths = isMathsName(comp.name);

    // dangling + phantom + duplicate-output-source
    const outputSources = new Map<string, number>();
    for (const k of conns) {
      const f = k.fromId ? byId.get(k.fromId) : undefined;
      const t = k.toId ? byId.get(k.toId) : undefined;
      if (!f || !t) {
        add({ severity: 'error', rule: 'dangling', component: comp.name,
          detail: `connection ${k.fromProperty ?? '?'} -> ${k.toProperty ?? '?'} references a node that is not in this component` });
        continue;
      }
      for (const [node, prop, side] of [[f, k.fromProperty, 'from'], [t, k.toProperty, 'to']] as const) {
        const ty = node.type ?? '';
        if (ty === 'Component Inputs' || ty === 'Component Outputs' || ty.startsWith('/')) {
          const ports = declaredPorts(node, comps);
          if (ports.size && prop && !ports.has(prop)) {
            add({ severity: 'error', rule: 'phantom-port', component: comp.name, node: labelOf(node),
              detail: `'${prop}' is not a declared port on ${labelOf(node)} (${side} side). The editor accepts this wire and it silently never fires.` });
          }
        } else if (ty === 'JavaScriptFunction' && prop) {
          // A script node's ports are `in-<X>` for every `Inputs.X` the body reads and `out-<X>`
          // for every `Outputs.X` it assigns (signals like Done are `out-Done`). A wire using the
          // bare name is accepted by the editor and logged at load as
          //   "[NodeScope.addConnection] Skipped connection … input doesn't exist"
          // then never fires. Twelve such wires were hand-added to one build and looked correct
          // in every graph view; the console at load was the only place they showed.
          const jsPorts = scriptPorts(node);
          const ok = side === 'to' ? jsPorts.inputs.has(prop) : jsPorts.outputs.has(prop);
          if (!ok) {
            const want = side === 'to' ? 'in-<name>' : 'out-<name>';
            const bare = prop.replace(/^(in|out)-/, '');
            const known = side === 'to' ? jsPorts.inputs : jsPorts.outputs;
            const prefixed = prop.startsWith(side === 'to' ? 'in-' : 'out-');
            const src = (node.parameters?.functionScript as string | undefined) ?? '';
            const computed = side === 'from' && /Outputs\s*\[/.test(src);
            if (prefixed && computed) {
              // Verified at load: the runtime registers `out-<name>` for whatever the body
              // assigns (registerOutputIfNeeded), including names built at run time such as
              // Outputs['Row' + i]. A correctly prefixed wire to such an output connects fine —
              // a project with 85 of them loaded with zero connection warnings. The body scan
              // simply cannot see the name, so this is unverifiable statically, not a defect.
              add({ severity: 'warning', rule: 'unverifiable-computed-output', component: comp.name, node: labelOf(node),
                detail: `'${prop}' is not a literal Outputs.${bare} assignment, and the body assigns outputs through a computed key (Outputs[…]). Likely fine; confirm with xgenia_console_tail on open (look for "has no output").` });
            } else {
              const hint = known.has(`${side === 'to' ? 'in' : 'out'}-${bare}`)
                ? ` Did you mean '${side === 'to' ? 'in' : 'out'}-${bare}'?`
                : ` The script ${side === 'to' ? 'never reads Inputs.' : 'never assigns Outputs.'}${bare}.`;
              add({ severity: 'error', rule: 'phantom-port', component: comp.name, node: labelOf(node),
                detail: `'${prop}' is not a port on script node ${labelOf(node)} (${side} side; script ports are ${want}).${hint} The editor accepts this wire and it silently never fires.` });
            }
          }
        }
      }
      if (t.type === 'Component Outputs' && k.toProperty) {
        outputSources.set(k.toProperty, (outputSources.get(k.toProperty) ?? 0) + 1);
      }
    }
    for (const [port, n] of outputSources) {
      if (n <= 1) continue;
      // Several wires into a SIGNAL output (Done, ontrue, …) is ordinary fan-in: any path may
      // fire it. Several wires into a DATA output is the hazard — two different quantities
      // race for one value. Observed: an entry award and a running count both wired to
      // `spinsAwarded`; a state object and a number both wired to `finaleCycles`.
      const signalLike = SIGNAL_OUT.has(port) || port.endsWith('Done') || port.startsWith('on');
      add({
        severity: signalLike ? 'info' : 'error',
        rule: signalLike ? 'signal-fan-in' : 'duplicate-output-source',
        component: comp.name,
        node: 'Component Outputs',
        detail: signalLike
          ? `${n} wires fire signal '${port}' (fan-in; fine if intended).`
          : `${n} wires feed data output '${port}'. Which value survives depends on evaluation order — one of them is wrong.`
      });
    }

    // self-instancing-component: does this component contain itself, at any depth?
    //
    // Direct self-reference is the common accident. The transitive case (A instances B,
    // B instances A) is rarer but expands just as infinitely, so the containment walk
    // follows instance edges between components rather than stopping at depth one.
    for (const n of nodes) {
      if (!n.type?.startsWith('/')) continue;
      let cyclic = n.type === comp.name;
      if (!cyclic) {
        // Walk what the instanced component itself instances, looking for a way back here.
        const seen = new Set<string>([comp.name]);
        const queue = [n.type];
        while (queue.length) {
          const name = queue.shift();
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const target = comps.get(name);
          if (!target) continue;
          for (const inner of flatten(target.graph?.roots)) {
            if (!inner.type?.startsWith('/')) continue;
            if (inner.type === comp.name) { cyclic = true; break; }
            queue.push(inner.type);
          }
          if (cyclic) break;
        }
      }
      if (cyclic) {
        add({ severity: 'error', rule: 'self-instancing-component', component: comp.name, node: labelOf(n),
          detail: `${comp.name} contains an instance of ${n.type}, which leads back to itself. Expanding that never terminates and blocks the renderer outright. If this was meant to go somewhere else, the instance was created in the wrong component — check the componentPath it was created with.` });
      }
    }

    // timer-self-restart: does anything this Timer drives come back round to its restart?
    //
    // Reachability is walked forward from whatever `timerFinished` fires, over every
    // connection in the component, and then checked against the sources feeding `restart`.
    // A `stop` wire elsewhere does not clear the finding: stop only helps if that condition
    // actually fires, and "it will probably stop" is precisely the assumption that wedged a
    // renderer.
    for (const t of nodes) {
      if (t.type !== 'Timer') continue;
      const drives = conns.filter((k) => k.fromId === t.id && k.fromProperty === 'timerFinished').map((k) => k.toId);
      const restartSources = new Set(
        conns.filter((k) => k.toId === t.id && k.toProperty === 'restart').map((k) => k.fromId)
      );
      if (!drives.length || !restartSources.size) continue;
      const seen = new Set<string | undefined>();
      const queue = [...drives];
      let loop = false;
      while (queue.length) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (restartSources.has(id)) { loop = true; break; }
        for (const k of conns) if (k.fromId === id && !seen.has(k.toId)) queue.push(k.toId);
      }
      // The timer feeding its own restart directly is the degenerate case of the same thing.
      if (loop || restartSources.has(t.id)) {
        const period = (t.parameters as { duration?: unknown } | undefined)?.duration;
        const stops = conns.filter((k) => k.toId === t.id && k.toProperty === 'stop').length;
        add({ severity: 'error', rule: 'timer-self-restart', component: comp.name, node: labelOf(t),
          detail: `Timer '${labelOf(t)}'${typeof period === 'number' ? ` (${period}ms)` : ''} restarts itself: something it drives via timerFinished feeds its own restart. That is an unbounded wall-clock loop running in the renderer${stops ? `, and the ${stops} stop wire(s) only end it if those conditions actually fire` : ', with no stop wire at all'}. Drive the work with a bounded synchronous loop and an explicit maximum, rather than re-arming a timer.` });
      }
    }

    // timer-in-maths, maths-instance-in-visual
    for (const n of nodes) {
      if (maths && n.type === 'Timer') {
        add({ severity: 'error', rule: 'timer-in-maths', component: comp.name, node: labelOf(n),
          detail: 'Timer inside a /#__maths__/ component. This compiles to a synchronous server script; a wall-clock beat cannot run there and is not seed-reproducible.' });
      }
      if (!maths && isMathsName(n.type)) {
        add({ severity: 'info', rule: 'maths-instance-in-visual', component: comp.name, node: labelOf(n),
          detail: `${n.type} is instanced inside a non-maths component. That is supported and normal for driving a UI. Note only that deployment is decided by LOCATION: this instance runs frontend-only, and the maths still compiles to the RGS from its own /#__maths__/ component.` });
      }
      // undefined-outputs-ref
      const src = (n.parameters?.functionScript as string | undefined) ?? '';
      if (src) {
        const refs = new Set<string>();
        for (const m of src.matchAll(/Outputs\.([A-Za-z_$][\w$]*)\s*\./g)) refs.add(m[1]!);
        const assigned = new Set<string>();
        for (const m of src.matchAll(/Outputs\.([A-Za-z_$][\w$]*)\s*=/g)) assigned.add(m[1]!);
        for (const r of refs) {
          if (!assigned.has(r) && r !== 'Done') {
            add({ severity: 'error', rule: 'undefined-outputs-ref', component: comp.name, node: labelOf(n),
              detail: `script reads Outputs.${r}.… but never assigns Outputs.${r}. Node scripts do not share scope — this throws "Cannot read properties of undefined" on first run.` });
          }
        }
      }
    }

    // duplicate-input-source: two data wires racing for one input port.
    {
      const bySink = new Map<string, { from: string; fromProp: string }[]>();
      for (const k of conns) {
        if (!k.toId || !k.toProperty) continue;
        const prop = k.toProperty;
        // Signals are allowed to fan in — several things may legitimately trigger one node.
        // Data is not: only one value can survive, and which one is evaluation order.
        //
        // Script-node ports carry `in-`/`out-` prefixes, so the signal sets must be checked
        // against the STRIPPED name. Missing that reported four `out-Done` signal wires into
        // one Done port as competing data — a false positive on the most ordinary wiring in
        // the project, which is exactly how a rule earns the habit of being ignored.
        const bare = (n: string) => n.replace(/^(in|out)-/, '');
        const fromProp = bare(k.fromProperty ?? '');
        const toProp = bare(prop);
        if (
          SIGNAL_IN.has(toProp) ||
          SIGNAL_OUT.has(fromProp) ||
          fromProp.startsWith('on') ||
          fromProp.endsWith('Done')
        )
          continue;
        const key = `${k.toId}::${prop}`;
        const list = bySink.get(key) ?? [];
        list.push({ from: k.fromId ?? '?', fromProp: k.fromProperty ?? '' });
        bySink.set(key, list);
      }
      for (const [key, sources] of bySink) {
        if (sources.length < 2) continue;
        const [nodeId, prop] = key.split('::');
        const sink = byId.get(nodeId!);
        if (!sink) continue;
        const names = sources
          .map((s) => `${byId.get(s.from) ? labelOf(byId.get(s.from)!) : '?'}.${s.fromProp}`)
          .join(' and ');
        add({ severity: 'error', rule: 'duplicate-input-source', component: comp.name, node: labelOf(sink),
          detail: `Input '${prop}' on ${labelOf(sink)} is fed by ${sources.length} data wires: ${names}. Only one value survives and which one depends on evaluation order, so this node may read something its author never intended. Keep one source and route the other through explicit logic.` });
      }
    }

    // data-dependency-cycle — the renderer-killer. See the note at the top of this file.
    {
      const isSignal = (k: { fromProperty?: string; toProperty?: string }) => {
        const f = k.fromProperty ?? '';
        const t = k.toProperty ?? '';
        return (
          SIGNAL_OUT.has(f) || SIGNAL_IN.has(t) || f.endsWith('Done') || f.startsWith('on')
        );
      };
      const dataEdges = new Map<string, { to: string; from: string; toProp: string }[]>();
      const addEdge = (from: string, to: string, fromProp: string, toProp: string) => {
        const list = dataEdges.get(from) ?? [];
        list.push({ to, from: fromProp, toProp });
        dataEdges.set(from, list);
      };
      // Variables link by NAME, not by wire: every `Set Variable` feeds every `Variable`
      // that shares its name. Without these edges a loop through a variable is invisible.
      {
        const varName = (n: Node): string | undefined => {
          const p = (n.parameters ?? {}) as { name?: string; variableName?: string };
          return p.name ?? p.variableName;
        };
        const readersByName = new Map<string, string[]>();
        for (const n of nodes) {
          const t = n.type ?? '';
          if (t === 'Set Variable' || !t.includes('Variable')) continue;
          const nm = varName(n);
          if (!nm) continue;
          readersByName.set(nm, [...(readersByName.get(nm) ?? []), n.id]);
        }
        for (const n of nodes) {
          if (n.type !== 'Set Variable') continue;
          const nm = varName(n);
          if (!nm) continue;
          for (const reader of readersByName.get(nm) ?? []) {
            if (reader !== n.id) addEdge(n.id, reader, `variable:${nm}`, `variable:${nm}`);
          }
        }
      }
      for (const k of conns) {
        if (!k.fromId || !k.toId || isSignal(k)) continue;
        if (!byId.has(k.fromId) || !byId.has(k.toId)) continue;
        addEdge(k.fromId, k.toId, k.fromProperty ?? '', k.toProperty ?? '');
      }
      const state = new Map<string, 'open' | 'done'>();
      const path: string[] = [];
      const reported = new Set<string>();
      const walk = (id: string) => {
        state.set(id, 'open');
        path.push(id);
        for (const edge of dataEdges.get(id) ?? []) {
          if (state.get(edge.to) === 'open') {
            const cyc = path.slice(path.indexOf(edge.to)).concat(edge.to);
            // One finding per distinct node set, however many edges close it.
            const key = [...cyc].sort().join('|');
            if (!reported.has(key)) {
              reported.add(key);
              const viaVariable = cyc.some((id) => (byId.get(id)?.type ?? '').includes('Variable'));
              // `node` is the cycle path, so two different cycles in one component are two
              // findings to the baseline diff. Without it every cycle in a component shared one
              // key, and a turn that removed six of nine read as "no change since baseline".
              const cyclePath = cyc.map((n) => labelOf(byId.get(n)!)).join(' -> ');
              add({ severity: 'error', rule: 'data-dependency-cycle', component: comp.name, node: cyclePath,
                detail: `${cyc.map((n) => labelOf(byId.get(n)!)).join(' -> ')}.${viaVariable ? ' This loop runs through a VARIABLE: a Set Variable and a Variable sharing a name are linked by that name, so routing a read-modify-write through one does NOT break the dependency — it only hides it from a wire-level reading of the graph.' : ' These are DATA wires, not signals.'} The runtime resolves values by walking data dependencies with no cycle guard, so this recurses until the renderer dies — the component looks fine until something instances it, then the editor freezes seconds after open. Accumulate inside one script node, or feed the value back through a variable read on a signal instead of a data wire.` });
            }
          } else if (!state.has(edge.to)) {
            walk(edge.to);
          }
        }
        path.pop();
        state.set(id, 'done');
      };
      for (const n of nodes) if (!state.has(n.id)) walk(n.id);
    }

    // signal-cycle
    for (const cyc of findSignalCycles(nodes, conns)) {
      add({ severity: maths ? 'warning' : 'info', rule: 'signal-cycle', component: comp.name, node: cyc.join(' -> '),
        detail: `${cyc.join(' -> ')}. Signals propagate synchronously; make sure something bounds this loop.` });
    }

    // unwired-text (visual components only)
    if (!maths) {
      const wired = new Set(conns.map((k) => k.toId));
      const texts = nodes.filter((n) => n.type === 'Text');
      const unwired = texts.filter((n) => !wired.has(n.id));
      if (texts.length && unwired.length) {
        add({ severity: 'info', rule: 'unwired-text', component: comp.name,
          detail: `${unwired.length}/${texts.length} Text nodes have no incoming connection (showing their default text). e.g. ${unwired.slice(0, 5).map(labelOf).join(', ')}` });
      }
    }
  }

  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity] += 1;
  return { findings, summary: { components: components.length, ...bySeverity, byRule: counts } };
}

/**
 * A finding's identity, for comparing one audit against another.
 *
 * Deliberately excludes free text: detail strings carry counts and labels that shift
 * harmlessly between runs, and a diff that reports those as churn is a diff nobody reads.
 */
export function findingKey(f: Finding): string {
  return [f.rule, f.component ?? '', f.node ?? ''].join('|');
}

/**
 * Compare a fresh audit against a saved one.
 *
 * This exists because a builder can fix something, report success honestly, and undo it two
 * turns later without noticing — and the totals alone hide it: three findings fixed and
 * three introduced reads as "no change". That happened here. A component's data cycle was
 * removed, the fix was verified, and a later turn rewired the same outputs back as data
 * inputs and reported `canComplete: true`. The regression was only visible because someone
 * re-ran the audit and remembered the previous shape.
 *
 * `regressions` is the field that matters: findings that were absent in the baseline and
 * are present now. Those are things this turn broke.
 */
export function diffFindings(baseline: Finding[], current: Finding[]) {
  const before = new Map(baseline.map((f) => [findingKey(f), f]));
  const after = new Map(current.map((f) => [findingKey(f), f]));
  const regressions = [...after.values()].filter((f) => !before.has(findingKey(f)));
  const fixed = [...before.values()].filter((f) => !after.has(findingKey(f)));
  return {
    regressions,
    fixed,
    unchanged: [...after.values()].filter((f) => before.has(findingKey(f))).length,
    verdict: regressions.some((f) => f.severity === 'error')
      ? 'NEW ERRORS since baseline — this turn broke something'
      : regressions.length
        ? 'new non-error findings since baseline'
        : fixed.length
          ? 'strictly better than baseline'
          : 'no change since baseline'
  };
}

const BASELINE_FILE = '.xgenia/audit-baseline.json';

export async function projectAudit(opts: { dir?: string; saveBaseline?: boolean; compareBaseline?: boolean } = {}) {
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
  let json: Json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8')) as Json;
  } catch (e) {
    return { error: 'project-dir-missing', tried: file, hint: `project.json is not valid JSON: ${(e as Error).message}` };
  }
  const { findings, summary } = auditProjectFile(json);

  const baselinePath = path.join(dir, BASELINE_FILE);
  if (opts.saveBaseline) {
    try {
      fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
      fs.writeFileSync(baselinePath, JSON.stringify({ savedAt: new Date().toISOString(), findings }, null, 2));
      return { file, summary, findings, baselineSaved: baselinePath };
    } catch (e) {
      return { file, summary, findings, baselineError: (e as Error).message };
    }
  }

  if (opts.compareBaseline) {
    if (!fs.existsSync(baselinePath)) {
      return {
        file,
        summary,
        findings,
        comparison: { error: 'no-baseline', hint: 'Run once with saveBaseline true to record the current state, then compare after the next turn.' }
      };
    }
    try {
      const saved = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as { savedAt?: string; findings?: Finding[] };
      return {
        file,
        summary,
        findings,
        comparison: { baselineSavedAt: saved.savedAt, ...diffFindings(saved.findings ?? [], findings) }
      };
    } catch (e) {
      return { file, summary, findings, comparison: { error: 'baseline-unreadable', detail: (e as Error).message } };
    }
  }

  return { file, summary, findings };
}
