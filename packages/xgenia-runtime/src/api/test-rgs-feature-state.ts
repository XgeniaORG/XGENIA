/**
 * A graph can tell the RGS it is in a feature, or waiting for the player's choice. (2026-10-11)
 *
 * WHY: XRGS (_shared/maths-round.ts) reads `state.in_feature` (the next round is a free round of a
 * feature already paid for) and `state.awaiting_choice` (the next round is the player's answer, checked
 * against the options) off the TOP level of the state a component returns. A compiled graph keeps its
 * persisted variables under state.__vars, so no editor-built game could ever say either: its free
 * spins were charged in full and its pick index came straight from the client. A persisted variable
 * NAMED in_feature / awaiting_choice / feature_rounds_remaining is now lifted to the top level
 * (supabase-converter.ts liftedPlatformState).
 *
 * Runs the generated script in XRGS's real sandbox, as /rgs-fn runs it.
 * Usage: XRGS_SANDBOX=<XRGS>/supabase/functions/_shared/script-sandbox.ts npx tsx src/api/test-rgs-feature-state.ts
 */
import * as path from 'path';
import { CloudFunctionConverter } from './supabase-converter';

type AnyRec = Record<string, any>;
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(__dirname, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');

/** Component Inputs → Set Variable(name).value for each name; Variable2(name) read back to an output. */
function graph(names: string[]): AnyRec {
  const roots: AnyRec[] = [
    {
      id: 'ci', typename: 'Component Inputs', type: 'Component Inputs', x: 0, y: 0, parameters: {},
      ports: [
        { name: 'Spin', plug: 'output', type: { name: 'signal' } },
        { name: 'BetAmount', plug: 'output', type: { name: 'number' } },
        ...names.map((n) => ({ name: `in_${n}`, plug: 'output', type: { name: '*' } })),
      ],
      dynamicports: [], children: [],
    },
    {
      id: 'co', typename: 'Component Outputs', type: 'Component Outputs', x: 900, y: 0, parameters: {},
      ports: [{ name: 'winAmount', plug: 'input', type: { name: 'number' } }, ...names.map((n) => ({ name: `out_${n}`, plug: 'input', type: { name: '*' } }))],
      dynamicports: [], children: [],
    },
  ];
  const connections: AnyRec[] = [];
  for (const n of names) {
    roots.push({ id: `set_${n}`, typename: 'Set Variable', type: 'Set Variable', x: 300, y: 0, parameters: { name: n, setWith: '*' }, ports: [], dynamicports: [], children: [] });
    roots.push({ id: `var_${n}`, typename: 'Variable2', type: 'Variable2', x: 600, y: 0, parameters: { name: n, value: null }, ports: [], dynamicports: [], children: [] });
    connections.push({ fromId: 'ci', fromProperty: `in_${n}`, toId: `set_${n}`, toProperty: 'value' });
    connections.push({ fromId: `var_${n}`, fromProperty: 'value', toId: 'co', toProperty: `out_${n}` });
  }
  return { name: '/#__cloud__/FeatureStateProbe', graph: { roots, connections } };
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const sandbox: AnyRec = await import(XRGS_SANDBOX);
  const play = (script: string, config: AnyRec, state: AnyRec = {}) =>
    sandbox.compileScript(script)({ bet: 100, rng: Array(200).fill(0.5), state, config, round: 1, action: 'SPIN' }).state as AnyRec;

  // 1. A graph that names the keys lifts them.
  const lifted = new CloudFunctionConverter(graph(['in_feature', 'awaiting_choice', 'feature_rounds_remaining'])).generateRgsScript().script;
  const ask = { options: [0, 1, 2], name: 'pick', port: 'PickIndex', request: { isPick: true } };
  const s1 = play(lifted, { isSpin: true, BetAmount: 100, in_in_feature: 'free_spins', in_awaiting_choice: ask, in_feature_rounds_remaining: 7 });
  if (s1.in_feature !== 'free_spins') fail(`in_feature not lifted: ${JSON.stringify(s1)}`);
  if (JSON.stringify(s1.awaiting_choice) !== JSON.stringify(ask)) fail(`awaiting_choice not lifted: ${JSON.stringify(s1.awaiting_choice)}`);
  if (s1.feature_rounds_remaining !== 7) fail('feature_rounds_remaining not lifted');
  if (!s1.__vars || s1.__vars.in_feature !== 'free_spins') fail('the variable must still persist under __vars');

  // 2. Clearing the variable clears the key, even though the state spreads the previous round's.
  const s2 = play(lifted, { isSpin: true, BetAmount: 100, in_in_feature: '', in_awaiting_choice: null, in_feature_rounds_remaining: 0 }, s1);
  for (const k of ['in_feature', 'awaiting_choice', 'feature_rounds_remaining']) {
    if (JSON.parse(JSON.stringify(s2))[k] !== undefined) fail(`${k} survived being cleared: ${JSON.stringify(s2[k])}`);
  }

  // 3. A graph without those names compiles as before: nothing lifted, nothing overwritten.
  const plain = new CloudFunctionConverter(graph(['fsLeft'])).generateRgsScript().script;
  if (/in_feature|awaiting_choice/.test(plain)) fail('a graph that does not name the keys must not mention them');
  const s3 = play(plain, { isSpin: true, BetAmount: 100, in_fsLeft: 3 }, { in_feature: 'hand_set' });
  if (s3.in_feature !== 'hand_set') fail('a key set some other way must be left alone');

  // 4. A free spins award carries to the next request with currentFreeSpins left unwired — as the
  //    editor node carries it (calculate-free-spins-states.js). It was read fresh every request, so
  //    the award was lost and every "free" spin charged.
  const fsGraph: AnyRec = {
    name: '/#__cloud__/FreeSpinsCarry',
    graph: {
      roots: [
        { id: 'ci', typename: 'Component Inputs', type: 'Component Inputs', x: 0, y: 0, parameters: {},
          ports: [{ name: 'Spin', plug: 'output', type: { name: 'signal' } }, { name: 'BetAmount', plug: 'output', type: { name: 'number' } }, { name: 'Grid', plug: 'output', type: { name: '*' } }],
          dynamicports: [], children: [] },
        { id: 'fs', typename: 'Calculate Free Spins States', type: 'Calculate Free Spins States', x: 200, y: 0,
          parameters: { freeSpinsSymbol: 9, blockedReels: '', freeSpinsRewardFormula: 'x >= 3 ? 8 : 0' }, ports: [], dynamicports: [], children: [] },
        { id: 'co', typename: 'Component Outputs', type: 'Component Outputs', x: 400, y: 0, parameters: {},
          ports: [{ name: 'left', plug: 'input', type: { name: 'number' } }, { name: 'Done', plug: 'input', type: { name: 'signal' } }], dynamicports: [], children: [] },
      ],
      connections: [
        { fromId: 'ci', fromProperty: 'Spin', toId: 'fs', toProperty: 'Do' },
        { fromId: 'ci', fromProperty: 'Grid', toId: 'fs', toProperty: 'engineReels' },
        { fromId: 'ci', fromProperty: 'BetAmount', toId: 'fs', toProperty: 'betAmount' },
        { fromId: 'fs', fromProperty: 'currentFreeSpins', toId: 'co', toProperty: 'left' },
        { fromId: 'fs', fromProperty: 'Done', toId: 'co', toProperty: 'Done' },
      ],
    },
  };
  const fsScript = new CloudFunctionConverter(fsGraph).generateRgsScript().script;
  const scatter = [[1, 1, 1], [9, 1, 1], [9, 1, 1], [9, 1, 1], [1, 1, 1]]; // reels 1-3: "" blockedReels still means the default 0,4
  const blank = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
  const call = (grid: unknown, st: AnyRec) => sandbox.compileScript(fsScript)({ bet: 100, rng: Array(200).fill(0.5), state: st, config: { isSpin: true, BetAmount: 100, Grid: grid }, round: 1, action: 'SPIN' });
  const r1 = call(scatter, {});
  const r2 = call(blank, r1.state);
  const r3 = call(blank, r2.state);
  const left = [r1, r2, r3].map((r: AnyRec) => r.data.left);
  if (JSON.stringify(left) !== JSON.stringify([8, 7, 6])) fail(`free spins did not carry between requests: ${JSON.stringify(left)} (want [8,7,6])`);

  console.log('graph feature state reaches the RGS: in_feature, awaiting_choice and feature_rounds_remaining are lifted and cleared; free spins carry');
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
