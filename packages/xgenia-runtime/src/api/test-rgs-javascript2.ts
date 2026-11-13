/**
 * A Javascript2 node's code reaches the RGS. (2026-10-29)
 *
 * WHY: the converter compiled a Javascript2 node (Script.Inputs / Script.Outputs / Script.Signals) to
 * `return { <output>: true }`, treating it as signal plumbing. A maths whose engine was one deployed
 * with no maths: every round returned nothing and paid 0, and deploy and stress test both passed it.
 * Found when Stake Engine refused KenoMaths' all-zero lookup table (ERR_MATH_OUTSIDE_RANGE).
 * supabase-converter.ts generateJavascript2FunctionDefinition.
 *
 * Runs the generated script in XRGS's real sandbox, as /rgs-fn runs it.
 * Usage: XRGS_SANDBOX=<XRGS>/supabase/functions/_shared/script-sandbox.ts npx tsx src/api/test-rgs-javascript2.ts
 */
import * as path from 'path';
import { CloudFunctionConverter } from './supabase-converter';

type AnyRec = Record<string, any>;
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(__dirname, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');

// The shape KenoEngine is written in: state parked on globalThis, a crypto fallback guarded by typeof,
// OnInit seeding defaults, the round on a signal, a signal output fired by calling it.
const ENGINE = `
if (!globalThis.engineState) globalThis.engineState = { rounds: 0, picks: [] };
var S = globalThis.engineState;
function seedSource() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) return "crypto";
  return typeof rgsRandom === "function" ? "rgs" : "none";
}
function play() {
  S.rounds += 1;
  var mult = rgsRandom() < 0.5 ? 200 : 0;           // hundredths of the bet
  Script.Outputs.Payout = Math.floor(Script.Inputs.BetAmount * mult / 100);
  Script.Outputs.Rounds = S.rounds;
  Script.Outputs.Picks = S.picks.length;
  Script.Outputs.Seed = seedSource();
  Script.Outputs.Done();
}
Script.Signals.Bet = function () { play(); };
Script.OnInit = function () { if (!S.picks.length) S.picks = [3, 9, 12]; };
`;

function graph(code: string, betPortType?: string): AnyRec {
  return {
    name: '/#__maths__/Js2Probe',
    graph: {
      roots: [
        { id: 'ci', typename: 'Component Inputs', type: 'Component Inputs', x: 0, y: 0, parameters: {},
          ports: [{ name: 'Spin', plug: 'output', type: { name: 'signal' } }, { name: 'BetAmount', plug: 'output', type: { name: 'number' } }],
          dynamicports: [], children: [] },
        { id: 'eng', typename: 'Javascript2', type: 'Javascript2', label: 'Engine', x: 300, y: 0,
          parameters: { code, scriptInputs: [{ id: 'BetAmount' }], scriptOutputs: [{ id: 'Payout' }, { id: 'Rounds' }, { id: 'Picks' }, { id: 'Seed' }] },
          ports: [], dynamicports: [
            { name: 'Done', plug: 'output', type: { name: 'signal' } },
            ...(betPortType ? [{ name: 'Bet', plug: 'input', type: betPortType }] : []),
          ], children: [] },
        { id: 'co', typename: 'Component Outputs', type: 'Component Outputs', x: 600, y: 0, parameters: {},
          ports: ['winAmount', 'rounds', 'picks', 'seed'].map((name) => ({ name, plug: 'input', type: { name: '*' } })),
          dynamicports: [], children: [] },
      ],
      connections: [
        { fromId: 'ci', fromProperty: 'Spin', toId: 'eng', toProperty: 'Bet' },
        { fromId: 'ci', fromProperty: 'BetAmount', toId: 'eng', toProperty: 'BetAmount' },
        { fromId: 'eng', fromProperty: 'Payout', toId: 'co', toProperty: 'winAmount' },
        { fromId: 'eng', fromProperty: 'Rounds', toId: 'co', toProperty: 'rounds' },
        { fromId: 'eng', fromProperty: 'Picks', toId: 'co', toProperty: 'picks' },
        { fromId: 'eng', fromProperty: 'Seed', toId: 'co', toProperty: 'seed' },
      ],
    },
  };
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function main() {
  const sandbox: AnyRec = await import(XRGS_SANDBOX);
  const script = new CloudFunctionConverter(graph(ENGINE)).generateRgsScript().script;
  if (/\bglobalThis\b|\bcrypto\s*\./.test(script)) fail('host globals must be rewritten before the sandbox scans the text');
  const blocked = sandbox.findBlockedConstructs(script);
  if (blocked.length) fail(`the sandbox refuses the compiled script: ${JSON.stringify(blocked)}`);

  const evaluate = sandbox.compileScript(script);
  const call = (rng: number, st: AnyRec) =>
    evaluate({ bet: 100, rng: Array(200).fill(rng), state: st, config: { isSpin: true, BetAmount: 100 }, round: 1, action: 'SPIN' });

  // 1. The node's code ran: it paid, from rgsRandom, with OnInit's defaults in place.
  const r1 = call(0.1, {});
  if (r1.data.winAmount !== 200) fail(`a winning round must pay 2x the bet: ${JSON.stringify(r1.data)}`);
  if (r1.win !== 200) fail(`the win port must reach the RGS's win: ${r1.win}`);
  if (r1.data.picks !== 3) fail(`OnInit must run before the first signal: picks=${r1.data.picks}`);
  if (r1.data.seed !== 'rgs') fail(`crypto must read as absent, leaving rgsRandom: seed=${r1.data.seed}`);

  // 2. globalThis state carries to the next request, as a player session would carry it.
  const r2 = call(0.9, r1.state);
  if (r2.data.rounds !== 2) fail(`node state must carry between requests: rounds=${r2.data.rounds}`);
  if (r2.data.winAmount !== 0) fail(`a losing round pays 0: ${r2.data.winAmount}`);

  // 3. ...without mutating the state object the previous round returned (Stake books, replays).
  const before = JSON.stringify(r1.state);
  call(0.1, r1.state);
  if (JSON.stringify(r1.state) !== before) fail('a round mutated the previous round\'s state');

  // 4. The signal input is a signal because the code handles it, whatever its port says. MinesEngine's
  //    `Bet` read as type "*", was wired as data (`Bet: config.Bet`), and the engine never ran.
  const starred = new CloudFunctionConverter(graph(ENGINE, '*')).generateRgsScript().script;
  const r4 = sandbox.compileScript(starred)({ bet: 100, rng: Array(200).fill(0.1), state: {}, config: { isSpin: true, BetAmount: 100 }, round: 1, action: 'SPIN' });
  if (r4.data.winAmount !== 200) fail(`a Script.Signals input typed "*" must still fire: ${JSON.stringify(r4.data)}`);

  // 5. BigInt state survives the JSON the RGS saves between requests. MinesEngine keeps its balance as a
  //    BigInt; its second request threw "Do not know how to serialize a BigInt".
  const BIG = `
if (!globalThis.w) globalThis.w = { bal: 1000n };
Script.Signals.Bet = function () { globalThis.w.bal -= BigInt(Script.Inputs.BetAmount); Script.Outputs.Payout = Number(globalThis.w.bal); Script.Outputs.Rounds = globalThis.w.bal; Script.Outputs.Done(); };
`;
  const big = sandbox.compileScript(new CloudFunctionConverter(graph(BIG)).generateRgsScript().script);
  const b1 = big({ bet: 100, rng: Array(200).fill(0.5), state: {}, config: { isSpin: true, BetAmount: 100 }, round: 1, action: 'SPIN' });
  const saved = JSON.parse(JSON.stringify(b1.state)); // what the RGS writes and reads back
  const b2 = big({ bet: 100, rng: Array(200).fill(0.5), state: saved, config: { isSpin: true, BetAmount: 100 }, round: 2, action: 'SPIN' });
  if (b2.data.winAmount !== 800) fail(`a BigInt balance must carry between requests: ${JSON.stringify(b2.data)}`);
  if (JSON.stringify(b2.data.rounds) !== JSON.stringify({ $bigint: '800' })) fail(`a BigInt output must be JSON-safe: ${JSON.stringify(b2.data.rounds)}`);

  // 6. An empty node still compiles to nothing, not to a crash.
  const empty = new CloudFunctionConverter(graph('')).generateRgsScript().script;
  sandbox.compileScript(empty)({ bet: 100, rng: Array(200).fill(0.5), state: {}, config: { isSpin: true, BetAmount: 100 }, round: 1, action: 'SPIN' });

  console.log('javascript2 reaches the RGS: its code runs, pays, keeps its state per session and leaves past state alone');
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
