/**
 * The compiled RGS script, called with no trigger named and no ctx.action (the XRGS stress and
 * simulation harnesses), plays every Component Inputs trigger in port order. An init/reset trigger
 * must play once per session there, as in the editor, where the game sends Init when it loads and
 * Spin after that. Played every request, it re-writes whatever it set up (reel strips, a progressive)
 * on every spin.
 *
 * The converter is TypeScript; it runs through tsx, like maths-component-parity.test.js.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RUNTIME = path.resolve(__dirname, '..');
const ROOT = path.resolve(RUNTIME, '../..');
const TSX = path.join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const run = fs.existsSync(TSX) ? test : test.skip;

const SCRIPT = `
import { CloudFunctionConverter } from './src/api/supabase-converter';
const sig = { name: 'signal' };
const js = (id, body, outs, ins = []) => ({
  id, typename: 'JavaScriptFunction', type: 'JavaScriptFunction', x: 0, y: 0,
  parameters: { functionScript: body, scriptInputs: ins.map((name) => ({ name })), scriptOutputs: outs.map((name) => ({ name })) },
  ports: [],
  dynamicports: [
    { name: 'run', plug: 'input', displayName: 'run', type: sig },
    ...ins.map((n) => ({ name: 'in-' + n, plug: 'input', displayName: n })),
    ...outs.map((n) => ({ name: 'out-' + n, plug: 'output', displayName: n })),
    { name: 'out-Done', plug: 'output', displayName: 'Done', type: sig },
  ],
  children: [],
});
const variable = (id, name, value) => ({ id, typename: 'Variable2', type: 'Variable2', x: 0, y: 0, parameters: { name, value }, ports: [], dynamicports: [], children: [] });
const setVar = (id, name) => ({ id, typename: 'Set Variable', type: 'Set Variable', x: 0, y: 0, parameters: { name, setWith: '*' }, ports: [], dynamicports: [], children: [] });
const w = (fromId, fromProperty, toId, toProperty) => ({ fromId, fromProperty, toId, toProperty });
const comp = {
  name: '/#__maths__/InitOnce',
  graph: {
    roots: [
      { id: 'ci', typename: 'Component Inputs', type: 'Component Inputs', x: 0, y: 0, parameters: {},
        ports: [{ name: 'DoInit', plug: 'output', type: sig }, { name: 'Spin', plug: 'output', type: sig }], dynamicports: [], children: [] },
      js('initJs', 'Outputs.strips = [1, 2, 3];\\nOutputs.Done();', ['strips']),
      variable('stripsVar', 'Strips', null), setVar('setStrips', 'Strips'),
      js('spinJs', 'Outputs.count = (Inputs.prev || 0) + 1;\\nOutputs.Done();', ['count'], ['prev']),
      variable('countVar', 'Count', 0), setVar('setCount', 'Count'),
      { id: 'co', typename: 'Component Outputs', type: 'Component Outputs', x: 0, y: 0, parameters: {},
        ports: [{ name: 'count', plug: 'input', type: { name: '*' } }], dynamicports: [], children: [] },
    ],
    connections: [
      w('ci', 'DoInit', 'initJs', 'run'), w('initJs', 'out-strips', 'setStrips', 'value'), w('initJs', 'out-Done', 'setStrips', 'do'),
      w('ci', 'Spin', 'spinJs', 'run'), w('countVar', 'value', 'spinJs', 'in-prev'),
      w('spinJs', 'out-count', 'setCount', 'value'), w('spinJs', 'out-Done', 'setCount', 'do'),
      w('countVar', 'value', 'co', 'count'),
    ],
  },
};
const { script } = new CloudFunctionConverter(comp as any).generateRgsScript();
const evaluate = new Function('ctx', 'var config = ctx.config || {}; var bet = ctx.bet;\\n' + script) as any;
const out: any[] = [];
const r1 = evaluate({ bet: 100, rng: [], state: {}, config: {}, round: 1 });
out.push(r1.state.__vars);
const r2 = evaluate({ bet: 100, rng: [], state: { ...r1.state, __vars: { ...r1.state.__vars, Strips: [9] } }, config: {}, round: 2 });
out.push(r2.state.__vars);
const r3 = evaluate({ bet: 100, rng: [], state: r2.state, config: { DoInit: true }, round: 3 });
out.push(r3.state.__vars);
const fresh = evaluate({ bet: 100, rng: [], state: {}, config: {}, round: 7 });
out.push(fresh.state.__vars);
console.log('RESULT ' + JSON.stringify(out));
`;

describe('compiled RGS script, harness call (no trigger named, no ctx.action)', () => {
  run('an init trigger plays once per session; Spin plays every request', () => {
    const r = spawnSync(process.execPath, [TSX, '-e', SCRIPT], { cwd: RUNTIME, encoding: 'utf8', timeout: 120000 });
    const text = `${r.stdout || ''}${r.stderr || ''}`;
    const line = text.split('\n').find((l) => l.startsWith('RESULT '));
    if (r.status !== 0 || !line) throw new Error(`tsx run failed (exit ${r.status}):\n${text}`);
    const [r1, r2, r3, fresh] = JSON.parse(line.slice('RESULT '.length));
    // Round 1: init and spin both play.
    expect(r1).toEqual({ Strips: [1, 2, 3], Count: 1 });
    // Round 2, same session: the spin plays, the init does not re-write Strips.
    expect(r2).toEqual({ Strips: [9], Count: 2 });
    // The caller names the init trigger: only it plays.
    expect(r3).toEqual({ Strips: [1, 2, 3], Count: 2 });
    // A new session (no state carried) initialises again, whatever round number it is given.
    expect(fresh).toEqual({ Strips: [1, 2, 3], Count: 1 });
  }, 150000);
});
