/**
 * Maths COMPONENT parity — the editor runtime vs. the compiled RGS script, request by request. (2026-10-05)
 *
 * WHY: a published game's Aggregator calls the maths once per trigger (`{ BetAmount, isDo: true,
 * isSpin: false, … }`), and rgs-fn hands the script back the state the previous call returned. The
 * node-level parity tests (test-slot-game-parity.ts, test-slot-feature-parity.ts) held every NODE
 * equal, and the whole component still played a different game on the RGS: every node ran on every
 * request, the trigger keys did not match the payload, Done never fired, a second wire into an input
 * was dropped, the stateManager forgot its values, and a loop's back edge was read off the payload.
 * This test holds the COMPONENT equal.
 *
 * For each maths component (a synthetic one built below from public nodes, the two round-player
 * fixtures in private/test-fixtures/rgs-maths — users' game maths, so they live in the private repo —
 * plus, with --project, a component of a saved project) it plays the same request sequence twice:
 *   * the EDITOR: the real runtime (NodeContext + ComponentInstance and the node files the editor
 *     ships: runtime built-ins, viewer variables, pro maths and slot nodes, JavaScriptFunction
 *     scripts), the instance's data inputs set and its trigger input pulsed, run to quiescence;
 *   * the RGS: generateRgsScript() executed by XRGS compileScript exactly as rgs-fn runs it — the
 *     payload sanitised, ctx.bet from the bet port, the state the previous request returned,
 *     ctx.action set.
 * Both draw from ONE random stream per request: the editor's TRNG / ISAAC nodes are stubbed to take
 * floor(u * 1e12) from it (what they yield from crypto / ISAAC), the RGS script takes its ctx.rng
 * from it. Sequence: Do, Spin x200, BonusDeal, BonusCollect, Spin x50 (a trigger the component does
 * not have fires nothing on either side). Every Component Output is compared on every request: a
 * signal must be fired on both or neither, and is a boolean in the response; a value the editor
 * delivered must be in the response and equal; a value present without an editor delivery must equal
 * what the editor holds (a script does not re-send an unchanged value).
 *
 * Also checked, on the RGS side: a request that fires no trigger runs nothing (no RNG drawn, no value
 * returned, state unchanged), and no request-payload field can change a maths internal — the response
 * and the next state are identical with every node's port and parameter names injected into the
 * payload.
 *
 * One difference is the EDITOR's, and is reported rather than copied: see "the editor's input queues,
 * watched" below (a node acting on the older of two queued values). Outputs it can reach are excused
 * on the requests it happens on and compared on every other; --strict fails on them too.
 *
 * Usage: cd packages/xgenia-runtime && XRGS_SANDBOX=<XRGS>/supabase/functions/_shared/script-sandbox.ts \
 *          npx tsx src/api/test-maths-component-parity.ts [--spins 200] [--strict] [--project <project.json> <component name>]
 * PARITY_COMPILER=<path to a supabase-converter> compiles with another compiler (for a before/after).
 * Exit code 0 only when nothing diverges.
 */
import * as fs from 'fs';
import * as path from 'path';

type AnyRec = Record<string, any>;
const HERE = path.dirname(__filename);
const ROOT = path.resolve(HERE, '../../../..');
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(HERE, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');
const XRGS_SHARED = path.dirname(XRGS_SANDBOX);
const COMPILER = process.env.PARITY_COMPILER || path.join(HERE, 'supabase-converter');
const FIXTURE_DIR = path.join(ROOT, 'private/test-fixtures/rgs-maths');
const FIXTURES = ['round-player-leprechaun.json', 'round-player-parrot.json'];
const RT = path.join(ROOT, 'packages/xgenia-runtime/src');
const VR = path.join(ROOT, 'packages/xgenia-viewer-react/src/nodes/std-library');
const PRO = path.join(ROOT, 'private/xgenia-pro-nodes/src');
const BET = 2;
const BONUS_AWARD = 5;
/** PARITY_TRACE=<n>: print both sides' outputs for the first n requests of each component. */
const TRACE = Number(process.env.PARITY_TRACE || 0);

// The engine and its node scripts log on every run, some of it after an await; the test's own
// output goes through `say`.
const say = console.log.bind(console);
const engineErrors: Record<string, number> = {};
console.log = console.info = console.debug = console.warn = () => {};
console.error = (...a: any[]) => { const k = a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 160); engineErrors[k] = (engineErrors[k] || 0) + 1; };

const mapNode = (n: AnyRec): AnyRec => ({ ...n, typename: n.type || n.typename, dynamicports: n.dynamicports || n.ports || [], children: (n.children || []).map(mapNode) });

/** Canonical JSON (sorted keys) of a value as it would cross the wire. */
function canon(v: any): string {
  const norm = (x: any): any => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === 'object') { const o: AnyRec = {}; for (const k of Object.keys(x).sort()) o[k] = norm(x[k]); return o; }
    return x;
  };
  const wire = v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  return JSON.stringify(norm(wire));
}
const brief = (v: any) => { const s = canon(v); return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 160) + '…' : s; };
/** Where two values first differ, as a path and both leaves — what a mismatch line shows. */
function firstDiff(a: any, b: any, at = ''): string {
  if (canon(a) === canon(b)) return '';
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of Array.from(new Set([...Object.keys(a), ...Object.keys(b)]))) {
      const d = firstDiff(a[k], b[k], `${at}.${k}`);
      if (d) return d;
    }
  }
  return `${at || '(value)'}: ${brief(a)} vs ${brief(b)}`;
}

// ─── a synthetic maths, public — every request-engine rule in one small graph ────────────────────
//
// The fixtures are users' maths (private repo). This one is built here so the rules hold without
// them: an init chain whose table later spins read through a Variable2; a spin script that reads the
// bank back from a stateManager it then updates (a back edge); a Condition that deals a bonus — whose
// trigger ALSO comes straight from Component Inputs.BonusDeal (two signal sources); a collect script
// that writes the same stateManager input as the spin (two value sources) and fires its update too;
// a script with `run` unwired that counts on `this` (runs at load and whenever the bank arrives); a
// win that is often the same as last time (a script does not re-send an unchanged value).
const sig = { name: 'signal' };
const jsPort = (plug: 'input' | 'output', name: string, signal = false) => ({ name: `${plug === 'input' ? 'in' : 'out'}-${name}`, displayName: name, plug, type: signal ? 'signal' : '*', group: plug === 'input' ? 'Inputs' : 'Outputs' });
const js = (id: string, script: string, ins: string[], outs: string[], signals: string[]) => ({
  id, type: 'JavaScriptFunction', label: id, parameters: { functionScript: script },
  ports: [...ins.map((n) => jsPort('input', n)), ...outs.map((n) => jsPort('output', n)), ...signals.map((n) => jsPort('output', n, true))]
});
const wire = (fromId: string, fromProperty: string, toId: string, toProperty: string) => ({ fromId, fromProperty, toId, toProperty });
const SYNTHETIC = {
  name: '/#__maths__/SyntheticEngine',
  id: 'synthetic',
  graph: {
    roots: [
      { id: 'ci', type: 'Component Inputs', label: 'Component Inputs', parameters: {}, ports: [
        { name: 'Do', plug: 'output', type: sig }, { name: 'Spin', plug: 'output', type: sig }, { name: 'BonusDeal', plug: 'output', type: sig },
        { name: 'BonusCollect', plug: 'output', type: sig }, { name: 'BetAmount', plug: 'output', type: { name: 'number' } }, { name: 'BonusAward', plug: 'output', type: { name: 'number' } }] },
      { id: 'co', type: 'Component Outputs', label: 'Component Outputs', parameters: {}, ports: [
        { name: 'Win', plug: 'input', type: { name: 'number' } }, { name: 'Bank', plug: 'input', type: { name: 'number' } }, { name: 'Prize', plug: 'input', type: { name: 'number' } },
        { name: 'Table', plug: 'input', type: { name: 'array' } }, { name: 'Rounds', plug: 'input', type: { name: 'number' } },
        { name: 'Dealt', plug: 'input', type: sig }, { name: 'SpinDone', plug: 'input', type: sig }] },
      { id: 'trngA', type: 'True Random Number Generator', label: 'trngA', parameters: {}, ports: [] },
      { id: 'isaacA', type: 'ISAAC Random Number Array Generator', label: 'isaacA', parameters: { size: 3 }, ports: [] },
      js('makeTable', 'const s = Inputs.Seeds || [];\nOutputs.Table = s.map(function (x) { return (Number(x) % 7) + 1; });\nOutputs.Done();', ['Seeds'], ['Table'], ['Done']),
      { id: 'setTable', type: 'Set Variable', label: 'setTable', parameters: { name: 'table', setWith: 'array' }, ports: [], dynamicports: [{ type: 'array', plug: 'input', name: 'value', displayName: 'Value' }] },
      { id: 'tableVar', type: 'Variable2', label: 'tableVar', parameters: { name: 'table' }, ports: [] },
      { id: 'trngS', type: 'True Random Number Generator', label: 'trngS', parameters: {}, ports: [] },
      { id: 'isaacS', type: 'ISAAC Random Number Array Generator', label: 'isaacS', parameters: { size: 2 }, ports: [] },
      js('play', [
        'const s = Inputs.Seeds || [];', 'const t = Inputs.Table || [];', 'const bet = Number(Inputs.Bet) || 0;',
        'const pick = t.length ? t[Number(s[0]) % t.length] : 0;', 'const win = (Number(s[1]) % 3 === 0) ? pick * bet : 0;',
        'Outputs.Win = win;', 'Outputs.Bank = (Number(Inputs.Bank) || 0) - bet + win;', 'Outputs.Lucky = Number(s[1]) % 4 === 1;', 'Outputs.Done();'
      ].join('\n'), ['Seeds', 'Table', 'Bank', 'Bet'], ['Win', 'Bank', 'Lucky'], ['Done']),
      { id: 'gate', type: 'Condition', label: 'gate', parameters: {}, ports: [] },
      { id: 'trngB', type: 'True Random Number Generator', label: 'trngB', parameters: {}, ports: [] },
      { id: 'isaacB', type: 'ISAAC Random Number Array Generator', label: 'isaacB', parameters: { size: 2 }, ports: [] },
      js('deal', 'Outputs.Prize = ((Number((Inputs.Seeds || [])[0]) % 5) + 1) * (Number(Inputs.Bet) || 0);\nOutputs.Done();', ['Seeds', 'Bet'], ['Prize'], ['Done']),
      js('collect', 'Outputs.Bank = (Number(Inputs.Bank) || 0) + (Number(Inputs.Award) || 0);\nOutputs.Done();', ['Bank', 'Award'], ['Bank'], ['Done']),
      { id: 'relay', type: 'Relay', label: 'relay', parameters: {}, ports: [] },
      { id: 'state', type: 'stateManager', label: 'state', parameters: { numInputs: 2, alias0: 'bank', alias1: 'rounds', initialValues: { bank: 100, rounds: 0 } }, ports: [], dynamicports: [
        { type: 'signal', plug: 'input', name: 'update' }, { type: 'signal', plug: 'input', name: 'reset' },
        { type: '*', plug: 'input', name: 'input0' }, { type: '*', plug: 'output', name: 'output0' },
        { type: '*', plug: 'input', name: 'input1' }, { type: '*', plug: 'output', name: 'output1' }] },
      js('count', 'this.n = (this.n || 0) + 1;\nOutputs.Rounds = this.n;', ['Bank'], ['Rounds'], []),
    ],
    connections: [
      wire('ci', 'Do', 'trngA', 'Do'), wire('trngA', 'value', 'isaacA', 'seed'), wire('trngA', 'Done', 'isaacA', 'Do'),
      wire('isaacA', 'array', 'makeTable', 'in-Seeds'), wire('isaacA', 'Done', 'makeTable', 'run'),
      wire('makeTable', 'out-Table', 'setTable', 'value'), wire('makeTable', 'out-Done', 'setTable', 'do'),
      wire('ci', 'Spin', 'trngS', 'Do'), wire('trngS', 'value', 'isaacS', 'seed'), wire('trngS', 'Done', 'isaacS', 'Do'),
      wire('isaacS', 'array', 'play', 'in-Seeds'), wire('isaacS', 'Done', 'play', 'run'), wire('tableVar', 'value', 'play', 'in-Table'),
      wire('state', 'output0', 'play', 'in-Bank'), wire('ci', 'BetAmount', 'play', 'in-Bet'),
      wire('play', 'out-Lucky', 'gate', 'condition'), wire('play', 'out-Done', 'gate', 'eval'),
      wire('gate', 'ontrue', 'trngB', 'Do'), wire('ci', 'BonusDeal', 'trngB', 'Do'),
      wire('trngB', 'value', 'isaacB', 'seed'), wire('trngB', 'Done', 'isaacB', 'Do'),
      wire('isaacB', 'array', 'deal', 'in-Seeds'), wire('isaacB', 'Done', 'deal', 'run'), wire('ci', 'BetAmount', 'deal', 'in-Bet'),
      wire('ci', 'BonusCollect', 'collect', 'run'), wire('state', 'output0', 'collect', 'in-Bank'), wire('ci', 'BonusAward', 'collect', 'in-Award'),
      wire('play', 'out-Done', 'relay', 'input'),
      wire('play', 'out-Bank', 'state', 'input0'), wire('collect', 'out-Bank', 'state', 'input0'), wire('count', 'out-Rounds', 'state', 'input1'),
      wire('relay', 'output', 'state', 'update'), wire('collect', 'out-Done', 'state', 'update'),
      wire('state', 'output0', 'count', 'in-Bank'),
      wire('play', 'out-Win', 'co', 'Win'), wire('state', 'output0', 'co', 'Bank'), wire('deal', 'out-Prize', 'co', 'Prize'),
      wire('tableVar', 'value', 'co', 'Table'), wire('state', 'output1', 'co', 'Rounds'),
      wire('deal', 'out-Done', 'co', 'Dealt'), wire('play', 'out-Done', 'co', 'SpinDone'),
    ],
  },
};

// ─── one random stream per request, shared by both sides ─────────────────────────────────────────

let Isaac: any;
const streamFor = (request: number, salt: string) => Isaac.fromHex((salt + ':' + request).split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').padEnd(64, '0'));
let editorStream: { random(): number } | null = null;

// ─── the editor side ─────────────────────────────────────────────────────────────────────────────

const MODULES = [
  RT + '/nodes/componentinputs', RT + '/nodes/componentoutputs', RT + '/nodes/std-library/condition',
  RT + '/nodes/std-library/signalpassthrough', RT + '/nodes/std-library/stateManager', RT + '/nodes/std-library/simplejavascript',
  RT + '/nodes/std-library/expression',
  VR + '/data/variablenode2', VR + '/data/setvariablenode',
  PRO + '/maths/trng.js', PRO + '/maths/isaac-rng-array.js',
  PRO + '/slot-games/generate-symbol-weights.js', PRO + '/slot-games/reel-strips-generator.js', PRO + '/slot-games/weighted-reels.js',
  PRO + '/slot-games/get-paytable.js', PRO + '/slot-games/check-wins.js', PRO + '/slot-games/calculate-winnings.js',
  PRO + '/slot-games/spin-calculate.js', PRO + '/slot-games/spin-result.js', PRO + '/slot-games/cascade-the-reels.js',
];

// ─── the editor's input queues, watched ─────────────────────────────────────────────────────────
//
// node.js queues every value that reaches an input and drains ONE value per port per pass, firing a
// signal's handler after the pass it is drained in. A node that is still waiting in the dirty list
// when two values of one input and then a trigger arrive therefore runs on the OLDER value — e.g.
// the round player's ScatterCheck counts the spin's first board, not the final one, and Spin Result
// reports the first pass's winning lines. That is the runtime's queue, not the maths, and the RGS
// cannot reproduce it without re-implementing the editor's dirty-list scheduler; it is reported, not
// copied. Each request records which nodes acted on an older value than the last one delivered
// before their trigger ("stale reads"); the outputs downstream of them are excused on that request
// (and still compared on every other one). --strict fails on them too. PARITY_EDITOR_LATEST=1 makes
// the editor's queue hand a trigger the latest value (the experiment that shows these are the only
// differences).
const READ_LATEST = process.env.PARITY_EDITOR_LATEST === '1';
let queueSeq = 0;
let staleNodes: Set<string> | null = null;
const signalInputsByType = new Map<string, Set<string>>();
function signalPortsOf(node: AnyRec): Set<string> {
  const t = node && node.model && node.model.type;
  return signalInputsByType.get(t) || new Set();
}
function instrumentEditorQueues() {
  const NodeProto = require(RT + '/node').prototype;
  if (NodeProto.__parityQueues) return;
  NodeProto.__parityQueues = true;
  const origQueue = NodeProto.queueInput;
  NodeProto.queueInput = function (name: string, value: any) {
    const seq = ++queueSeq;
    const sig = signalPortsOf(this);
    if (READ_LATEST && value === true && sig.has(name)) {
      for (const p of Object.keys(this._inputValuesQueue)) {
        const q = this._inputValuesQueue[p];
        if (sig.has(p) || q.length < 2) continue;
        q.splice(0, q.length - 1);
        if (this.__seq && this.__seq[p]) this.__seq[p].splice(0, this.__seq[p].length - 1);
      }
    }
    origQueue.call(this, name, value);
    const q = this._inputValuesQueue[name] || [];
    this.__seq = this.__seq || {};
    const sq = (this.__seq[name] = this.__seq[name] || []);
    sq.push(seq);
    while (sq.length > q.length) sq.shift();
  };
  const origSet = NodeProto.setInputValue;
  NodeProto.setInputValue = function (name: string, value: any) {
    const sq = this.__seq && this.__seq[name];
    let applied = 0;
    if (sq) { const q = this._inputValuesQueue[name] || []; while (sq.length > q.length) applied = sq.shift(); }
    const sig = signalPortsOf(this);
    if (staleNodes && applied && value === true && sig.has(name)) {
      for (const p of Object.keys(this.__seq)) {
        if (p === name || sig.has(p)) continue;
        if (this.__seq[p].some((x: number) => x < applied)) staleNodes.add(this.id);
      }
    }
    return origSet.call(this, name, value);
  };
}

let definitions: any[] | null = null;
function editorDefinitions(): any[] {
  if (definitions) return definitions;
  instrumentEditorQueues();
  definitions = MODULES.map((m) => {
    const mod = require(m);
    const def = mod.node || mod;
    // The draws, from the request's stream — the integers the real nodes yield (trng.js floors its
    // crypto draw; isaac-rng-array.js takes randomInt(0, 1e12)), `_effectiveSize` values for an ISAAC.
    if (def.name === 'True Random Number Generator') {
      def.methods.generateRandomValue = function () {
        this._internal.lastGeneratedValue = Math.floor(editorStream!.random() * 1e12);
        this.flagOutputDirty('value');
        this.sendSignalOnOutput('Done');
      };
    }
    if (def.name === 'ISAAC Random Number Array Generator') {
      def.methods._generateLocal = function () {
        const size = this._effectiveSize();
        const a: number[] = [];
        for (let i = 0; i < size; i++) a.push(Math.floor(editorStream!.random() * 1e12));
        this._internal.lastGeneratedArray = a;
        this.flagOutputDirty('array');
        this.sendSignalOnOutput('Done');
      };
    }
    signalInputsByType.set(def.name, new Set(Object.keys(def.inputs || {}).filter((k) => def.inputs[k] && def.inputs[k].valueChangedToTrue)));
    return def;
  });
  return definitions;
}

interface Delivered { fired: Set<string>; values: Map<string, any>; held: AnyRec; stale: Set<string> }

class EditorComponent {
  private ctx: any;
  private inst: any;
  private arrivals: Array<[string, any]> = [];
  private lastData: AnyRec = {};
  constructor(private readonly comp: AnyRec, readonly triggers: Set<string>, readonly dataInputs: Set<string>) {}

  async boot() {
    const NodeContext = require(RT + '/nodecontext');
    const NodeDefinition = require(RT + '/nodedefinition');
    const ComponentInstance = require(RT + '/nodes/componentinstance');
    const ComponentModel = require(RT + '/models/componentmodel');
    const Model = require(RT + '/model');
    // Variables live in ONE global model for the whole process; a fresh session starts it empty.
    const vars = Model.get('--ndl--global-variables');
    for (const k of Object.keys(vars.data || {})) delete vars.data[k];
    const ctx = new NodeContext();
    ctx.editorConnection = { isRunningLocally: () => false, sendWarning() {}, clearWarning() {}, clearWarnings() {}, isConnected: () => false, sendDynamicPorts() {} };
    ctx.isWarningTypeEnabled = () => false;
    ctx.platform = { getCurrentTime: () => performance.now(), requestUpdate() {} };
    for (const def of editorDefinitions()) ctx.nodeRegister.register(NodeDefinition.defineNode(def));
    const flat: AnyRec[] = [];
    (function walk(ns: AnyRec[]) { for (const n of ns || []) { flat.push(n); walk(n.children); } })(this.comp.graph.roots);
    const nodes = flat.map((n) => ({ id: n.id, type: n.type, label: n.label, parameters: n.parameters || {}, ports: [...(n.ports || []), ...(n.dynamicports || [])] }));
    const connections = (this.comp.graph.connections || []).map((c: AnyRec) => ({ sourceId: c.fromId, sourcePort: c.fromProperty, targetId: c.toId, targetPort: c.toProperty }));
    const ins = flat.find((n) => n.type === 'Component Inputs');
    const outs = flat.find((n) => n.type === 'Component Outputs');
    const ports = [
      ...((ins && ins.ports) || []).map((p: AnyRec) => ({ name: p.name, plug: 'input', type: p.type })),
      ...((outs && outs.ports) || []).map((p: AnyRec) => ({ name: p.name, plug: 'output', type: p.type })),
    ];
    const model = await ComponentModel.createFromExportData({ name: this.comp.name, id: this.comp.id || 'maths', nodes, connections, ports });
    const inst = new ComponentInstance(ctx);
    await inst.setComponentModel(model);
    // Published, every input of the maths is driven (the Aggregator sends each trigger). A node whose
    // `run` comes from a Component Inputs port counts as triggered only when that input is wired
    // (node.js isInputConnected), so the instance reports all of them wired.
    inst.isInputConnected = () => true;
    inst._internal.creatorCallbacks = { onOutputChanged: (name: string, value: any) => { this.arrivals.push([name, value]); } };
    this.ctx = ctx;
    this.inst = inst;
    await this.settle();
  }

  private frame() {
    const ctx = this.ctx;
    ctx.currentFrameTime = ctx.getCurrentTime();
    ctx.eventEmitter.emit('frameStart');
    ctx.update();
    ctx.eventEmitter.emit('frameEnd');
  }

  private async settle() {
    let idle = 0;
    for (let i = 0; i < 5000 && idle < 3; i++) {
      this.frame();
      await new Promise((r) => setImmediate(r));
      if (this.ctx._dirtyNodes.length === 0 && this.ctx.callbacksAfterUpdate.length === 0) idle++; else idle = 0;
    }
  }

  async request(trigger: string, data: AnyRec, stream: { random(): number }): Promise<Delivered> {
    this.arrivals = [];
    editorStream = stream;
    const stale = (staleNodes = new Set<string>());
    // A parent sets an input when its value changes.
    for (const [k, v] of Object.entries(data)) {
      if (this.dataInputs.has(k) && this.lastData[k] !== v) { this.inst.setInputValue(k, v); this.lastData[k] = v; }
    }
    if (this.triggers.has(trigger)) { this.inst.queueInput(trigger, true); this.inst.queueInput(trigger, false); }
    await this.settle();
    editorStream = null;
    staleNodes = null;
    const fired = new Set<string>();
    const values = new Map<string, any>();
    for (const [name, v] of this.arrivals) { if (v === true) fired.add(name); values.set(name, v); }
    return { fired, values, held: { ...this.inst._internal.componentOutputValues }, stale };
  }
}

// ─── the RGS side ────────────────────────────────────────────────────────────────────────────────

class RgsComponent {
  private state: AnyRec = {};
  constructor(private readonly evaluate: (ctx: AnyRec) => AnyRec, private readonly sanitise: (p: AnyRec) => { config: AnyRec }, private readonly betPort: string | null) {}

  private ctxFor(payload: AnyRec, stream: { random(): number }, state: AnyRec, counter?: { draws: number }) {
    const raw = this.betPort ? payload[this.betPort] : undefined;
    const bet = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    const round = (typeof state.round_count === 'number' ? state.round_count : 0) + 1;
    const draw = () => { if (counter) counter.draws++; return stream.random(); };
    const rng: number[] = [];
    if (!counter) for (let i = 0; i < 100; i++) rng.push(draw());
    return { bet, rng, state, config: this.sanitise(payload).config, round, action: 'SPIN', rngMore: (n: number) => Array.from({ length: n }, draw) };
  }

  /** One rgs-fn request: returns the response body and keeps the state for the next. */
  request(payload: AnyRec, stream: { random(): number }): AnyRec {
    const ctx = this.ctxFor(payload, stream, this.state);
    const r = this.evaluate(ctx);
    this.state = { ...(r.state && typeof r.state === 'object' ? r.state : {}), round_count: ctx.round };
    return JSON.parse(JSON.stringify(r.data ?? {}));
  }

  /** The same request against the CURRENT state, without keeping anything (probes). */
  probe(payload: AnyRec, stream: { random(): number }, counter?: { draws: number }): { data: AnyRec; state: AnyRec } {
    const ctx = this.ctxFor(payload, stream, JSON.parse(JSON.stringify(this.state)), counter);
    const r = this.evaluate(ctx);
    return { data: JSON.parse(JSON.stringify(r.data ?? {})), state: JSON.parse(JSON.stringify({ ...r.state, round_count: ctx.round })) };
  }

  get currentState() { return this.state; }
}

// ─── one component ───────────────────────────────────────────────────────────────────────────────

/**
 * The Component Outputs a stale read in `stale` can reach: through the values it computes, and —
 * for nodes that choose their signal from a value (Condition, Expression, a script) — through
 * everything that then runs or not. A native node's Done fires whatever it read, so a value it got
 * wrong does not change what runs after it.
 */
function reachedFrom(comp: AnyRec, stale: Set<string>): Set<string> {
  const roots: AnyRec[] = comp.graph.roots;
  const byId = new Map(roots.map((n) => [n.id, n] as [string, AnyRec]));
  const co = roots.find((n) => n.type === 'Component Outputs');
  const coSignal = new Set(portsOf(co).filter((p) => p.type === 'signal').map((p) => p.name));
  const CHOOSES = new Set(['Condition', 'Expression', 'JavaScriptFunction', 'If', 'Switch']);
  const isSig = (c: AnyRec) => {
    const t = byId.get(c.toId);
    if (!t) return false;
    if (t.type === 'Component Outputs') return coSignal.has(c.toProperty);
    return (signalInputsByType.get(t.type) || new Set()).has(c.toProperty);
  };
  const dataA = new Set(stale), runA = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const c of comp.graph.connections as AnyRec[]) {
      const from = c.fromId, to = c.toId;
      const affectsRun = isSig(c) && (runA.has(from) || (dataA.has(from) && CHOOSES.has(byId.get(from)?.type)));
      const affectsData = affectsRun || (!isSig(c) && (dataA.has(from) || runA.has(from)));
      if (affectsRun && !runA.has(to)) { runA.add(to); changed = true; }
      if (affectsData && !dataA.has(to)) { dataA.add(to); changed = true; }
    }
  }
  const out = new Set<string>();
  for (const c of comp.graph.connections as AnyRec[]) {
    if (!co || c.toId !== co.id) continue;
    const sig = isSig(c);
    if ((!sig && (dataA.has(c.fromId) || runA.has(c.fromId))) || (sig && (runA.has(c.fromId) || (dataA.has(c.fromId) && CHOOSES.has(byId.get(c.fromId)?.type))))) out.add(c.toProperty);
  }
  return out;
}

const portsOf = (n: AnyRec | undefined): Array<{ name: string; type: string }> =>
  ((n && (n.ports || n.dynamicports)) || []).map((p: AnyRec) => ({ name: p.name, type: String((p.type && typeof p.type === 'object' ? p.type.name : p.type) || '').toLowerCase() }));

let excusedTotal = 0;

async function runComponent(label: string, comp: AnyRec, spins: number, sandbox: AnyRec, sanitise: any, Converter: any, strict: boolean): Promise<number> {
  const roots: AnyRec[] = comp.graph.roots;
  const ci = roots.find((n) => n.type === 'Component Inputs');
  const co = roots.find((n) => n.type === 'Component Outputs');
  const ciPorts = portsOf(ci);
  const triggers = new Set(ciPorts.filter((p) => p.type === 'signal').map((p) => p.name));
  const dataInputs = new Set(ciPorts.filter((p) => p.type !== 'signal').map((p) => p.name));
  const coPorts = portsOf(co).filter((p) => (comp.graph.connections as AnyRec[]).some((c) => !!co && c.toId === co.id && c.toProperty === p.name));
  const betPort = Array.from(dataInputs).find((n) => /^betamount$/i.test(n)) || null;

  const mapped = { ...comp, graph: { roots: roots.map(mapNode), connections: comp.graph.connections } };
  const out = new Converter(mapped, { name: 'fixture', components: [mapped] }).generateRgsScript();
  if (out.unsupportedNodes.length) { say(`FAIL  ${label}: unsupported ${JSON.stringify(out.unsupportedNodes)}`); return 1; }
  const rgs = new RgsComponent(sandbox.compileScript(out.script), sanitise, betPort);
  const editor = new EditorComponent(comp, triggers, dataInputs);
  await editor.boot();

  const sequence: string[] = ['Do', ...Array(spins).fill('Spin'), 'BonusDeal', 'BonusCollect', ...Array(Math.max(1, Math.round(spins / 4))).fill('Spin')];
  const data: AnyRec = {};
  if (betPort) data[betPort] = BET;
  if (dataInputs.has('BonusAward')) data.BonusAward = BONUS_AWARD;

  const mismatch = new Map<string, { count: number; first: string }>();
  const excused = new Map<string, { count: number; first: string }>();
  const staleBy = new Map<string, number>();
  let excuse = new Set<string>();
  const miss = (port: string, msg: string) => {
    const into = excuse.has(port) ? excused : mismatch;
    const m = into.get(port) || { count: 0, first: msg };
    m.count++;
    into.set(port, m);
  };
  const firedCount = new Map<string, number>();
  // The probes run once the maths is warm (after the first wins), on a Spin.
  const probeAt = Math.max(1, Math.min(20, spins));
  let failures = 0;
  for (let i = 0; i < sequence.length; i++) {
    const trigger = sequence[i];
    const payload: AnyRec = { ...data };
    for (const t of triggers) payload['is' + t] = t === trigger;

    // The security probe, once the maths is warm (after the first wins): every name a node of this
    // maths uses, sent as a payload field, must not change the response or the state.
    if (i === probeAt) {
      const injected: AnyRec = { ...payload };
      const names = new Set<string>(['capital', 'Capital', 'TotalWinnings', 'totalBets', 'spinWinnings', 'state', 'round', '__engine', '__vars', 'bet', 'reelStrips', 'paytable', 'Seeds', 'seed']);
      for (const n of roots) {
        for (const k of Object.keys(n.parameters || {})) names.add(k);
        for (const v of Object.values(n.parameters || {})) if (typeof v === 'string' && /^[A-Za-z_]\w*$/.test(v)) names.add(v);
        for (const p of [...(n.ports || []), ...(n.dynamicports || [])]) { names.add(p.name); names.add(String(p.name).replace(/^(in|out)-/, '')); }
      }
      for (const c of comp.graph.connections as AnyRec[]) { names.add(c.toProperty); names.add(c.fromProperty); names.add(String(c.toProperty).replace(/^(in|out)-/, '')); }
      for (const n of names) {
        if (triggers.has(n) || dataInputs.has(n) || /^is[A-Z]/.test(n) || n === '_portManifest' || n.startsWith('__') && n !== '__engine' && n !== '__vars') continue;
        injected[n] = 987654321;
      }
      const clean = rgs.probe(payload, streamFor(i, 'probe'));
      const dirty = rgs.probe(injected, streamFor(i, 'probe'));
      if (canon(clean.data) !== canon(dirty.data) || canon(clean.state) !== canon(dirty.state)) {
        failures++;
        const k = Object.keys(clean.data).find((x) => canon(clean.data[x]) !== canon(dirty.data[x]));
        say(`FAIL  ${label}: a request-payload field changed the maths — ${k ? `${k}: ${brief(clean.data[k])} became ${brief(dirty.data[k])}` : 'the state differs'}`);
      } else {
        say(`ok    ${label}: ${Object.keys(injected).length - Object.keys(payload).length} injected payload fields change nothing (response and state identical)`);
      }
      // A request that fires nothing runs nothing: no draw, no value, state unchanged.
      const none: AnyRec = { ...data };
      for (const t of triggers) none['is' + t] = false;
      const counter = { draws: 0 };
      const idle = rgs.probe(none, streamFor(i, 'idle'), counter);
      const values = Object.keys(idle.data).filter((k) => idle.data[k] !== false);
      const kept = (st: AnyRec) => canon({ ...st, round: undefined, round_count: undefined });
      const before = kept(rgs.currentState);
      const after = kept(idle.state);
      if (counter.draws || values.length || before !== after) {
        failures++;
        say(`FAIL  ${label}: a request with no trigger true ran something — ${counter.draws} draws, values ${JSON.stringify(values)}, state ${before === after ? 'unchanged' : 'changed'}`);
      } else {
        say(`ok    ${label}: a request with every trigger false draws nothing, returns no value and leaves the state as it was`);
      }
    }

    const ed = await editor.request(trigger, data, streamFor(i, 'round'));
    const body = rgs.request(payload, streamFor(i, 'round'));
    for (const f of ed.fired) firedCount.set(f, (firedCount.get(f) || 0) + 1);
    excuse = ed.stale.size ? reachedFrom(comp, ed.stale) : new Set();
    for (const id of ed.stale) { const n = roots.find((x) => x.id === id); const k = (n && (n.label || n.type)) || id; staleBy.set(k, (staleBy.get(k) || 0) + 1); }
    if (i < TRACE) {
      say(`trace ${label} #${i} ${trigger}\n  arrivals: ${(editor as any).arrivals.map((a: any) => a[0] + "=" + (typeof a[1] === "boolean" ? a[1] : "v")).join(",")}\n  editor: ${Array.from(ed.values.entries()).map(([k, v]) => `${k}=${brief(v)}`).join(' | ')}\n  rgs:    ${Object.keys(body).map((k) => `${k}=${brief(body[k])}`).join(' | ')}`);
    }
    for (const p of coPorts) {
      const got = body[p.name];
      if (p.type === 'signal') {
        if (typeof got !== 'boolean') miss(p.name, `request ${i} (${trigger}): signal is ${brief(got)} in the response, not a boolean`);
        else if (got !== ed.fired.has(p.name)) miss(p.name, `request ${i} (${trigger}): editor ${ed.fired.has(p.name) ? 'fired' : 'did not fire'} it, the RGS returned ${got}`);
        continue;
      }
      const held = ed.held[p.name];
      if (ed.values.has(p.name)) {
        if (!(p.name in body)) miss(p.name, `request ${i} (${trigger}): editor sent ${brief(ed.values.get(p.name))}, the response has no ${p.name}`);
        else if (canon(got) !== canon(held)) miss(p.name, `request ${i} (${trigger}): editor ≠ RGS at ${firstDiff(held, got)}`);
      } else if (p.name in body && canon(got) !== canon(held)) {
        miss(p.name, `request ${i} (${trigger}): editor sent nothing (holds ${brief(held)}), the RGS returned ${brief(got)}`);
      }
    }
  }
  const stateBytes = JSON.stringify(rgs.currentState).length;
  for (const p of coPorts) {
    const m = mismatch.get(p.name);
    if (m) { failures++; say(`FAIL  ${label} ${p.name}: ${m.count}/${sequence.length} requests differ — first: ${m.first}`); }
    const x = excused.get(p.name);
    if (x) {
      if (strict) failures++;
      say(`${strict ? 'FAIL ' : 'note '} ${label} ${p.name}: ${x.count} request(s) differ only where the EDITOR's input queue handed a node an older value (stale reads: ${Array.from(staleBy.entries()).map(([k, v]) => `${k} ×${v}`).join(', ')}) — first: ${x.first}`);
    }
  }
  const excusedCount = Array.from(excused.values()).reduce((n, x) => n + x.count, 0);
  excusedTotal += excusedCount;
  if (!mismatch.size) say(`ok    ${label}: ${coPorts.length} outputs equal on all ${sequence.length} requests${excusedCount ? ` but ${excusedCount} excused editor stale read(s) above` : ''} (signals fired: ${Array.from(firedCount.entries()).map(([k, v]) => `${k} ×${v}`).join(', ') || 'none'}; state ${stateBytes} bytes)`);
  else say(`      ${label}: ${coPorts.length - mismatch.size}/${coPorts.length} outputs equal on all ${sequence.length} requests (state ${stateBytes} bytes)`);
  return failures;
}

async function main() {
  const args = process.argv.slice(2);
  const spinsAt = args.indexOf('--spins');
  const spins = spinsAt >= 0 ? Number(args[spinsAt + 1]) : 200;
  const projAt = args.indexOf('--project');
  const sandbox: AnyRec = await import(XRGS_SANDBOX);
  ({ Isaac } = await import(path.join(XRGS_SHARED, 'isaac.ts')) as AnyRec);
  const { sanitiseComponentPayload } = (await import(path.join(XRGS_SHARED, 'component-entropy.ts'))) as AnyRec;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CloudFunctionConverter } = require(COMPILER);
  const comps: Array<[string, AnyRec]> = [['synthetic', SYNTHETIC]];
  // The fixtures are users' maths, in the private repo; without it the synthetic maths still runs.
  if (fs.existsSync(FIXTURE_DIR)) {
    for (const f of FIXTURES) comps.push([f, JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), 'utf8')).component]);
  } else {
    say(`skip  the round-player fixtures: ${FIXTURE_DIR} is missing (the private repo is not checked out)`);
  }
  if (projAt >= 0) {
    const proj = JSON.parse(fs.readFileSync(args[projAt + 1], 'utf8'));
    const name = args[projAt + 2];
    const c = proj.components.find((x: AnyRec) => x.name === name);
    if (!c) throw new Error(`no component ${name} in ${args[projAt + 1]}`);
    comps.push([`${path.basename(path.dirname(args[projAt + 1]))}:${name}`, c]);
  }
  let failures = 0;
  const strict = args.includes('--strict');
  if (READ_LATEST) say('(PARITY_EDITOR_LATEST=1: the editor\'s input queue hands each trigger the latest value delivered before it)');
  for (const [label, comp] of comps) failures += await runComponent(label, comp, spins, sandbox, sanitiseComponentPayload, CloudFunctionConverter, strict);
  // Spin Calculate's runaway-billing warning counts charges per wall-clock second; this harness plays
  // hundreds of spins a second, so that one is expected here and is not listed.
  const errs = Object.entries(engineErrors).filter(([k]) => !/bets charged in the last second/.test(k));
  if (errs.length) say(`(editor engine logged ${errs.length} distinct error(s):\n${errs.map(([k, v]) => `   ${k} ×${v}`).join('\n')})`);
  if (failures) { say(`\n${failures} check(s) failed`); process.exit(1); }
  say(`\n${comps.length}/${comps.length} maths components play the same game in the editor and on the RGS, request by request` +
    (excusedTotal ? ` — apart from ${excusedTotal} output(s) on requests where the editor's own input queue handed a node an older value (noted above)` : ''));
}

main().catch((e) => { console.error = (...a: any[]) => process.stderr.write(a.join(' ') + '\n'); process.stderr.write(String((e && e.stack) || e) + '\n'); process.exit(1); });
