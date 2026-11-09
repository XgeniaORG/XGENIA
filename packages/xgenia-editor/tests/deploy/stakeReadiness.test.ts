import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAKE_BUILD_PLAYS_BOOKS, stakeFixRequest, stakeReadiness } from '../../src/editor/src/utils/stake/stakeReadiness';

// Synthetic projects shaped like project.json (components → graph.roots / graph.connections).
const n = (id: string, type: string, parameters: Record<string, any> = {}, label?: string) => ({ id, type, parameters, label, children: [] as any[] });
const c = (fromId: string, fromProperty: string, toId: string, toProperty: string) => ({ fromId, fromProperty, toId, toProperty });

function project(mathsNodes: any[], mathsConns: any[] = [], screenNodes?: any[], screenConns?: any[]) {
  const maths = { name: '/#__maths__/SlotMaths', graph: { roots: [n('in', 'Component Inputs'), ...mathsNodes], connections: mathsConns } };
  const screen = {
    name: '/App',
    graph: {
      roots: screenNodes ?? [n('btn', 'net.xgenia.controls.button'), n('m', '/#__maths__/SlotMaths'), n('rules', 'Text', { text: 'Malfunction voids all wins and plays. Please reload the game to finish any uncompleted rounds.' })],
      connections: screenConns ?? [c('btn', 'onClick', 'm', 'Spin')]
    }
  };
  return { components: [maths, screen] };
}
const codes = (r: any) => r.issues.map((i: any) => i.code);

test('a slot on the library free-spins node is ready', () => {
  const r = stakeReadiness(project([n('fs', 'Calculate Free Spins States')]));
  assert.equal(r.ready, true, JSON.stringify(r.issues.filter((i) => i.level === 'error')));
  assert.equal(r.summary.freeSpins, 'library');
});

test('free spins counted in an author variable are an error: the books would drop them', () => {
  const r = stakeReadiness(project([n('v', 'Variable2', { name: 'freeSpinsLeft' })]));
  assert.equal(r.ready, false);
  assert.ok(codes(r).includes('FREE_SPINS_NOT_DECLARED'));
  assert.equal(r.summary.freeSpins, 'suspected-undeclared');
  const i = r.issues.find((x) => x.code === 'FREE_SPINS_NOT_DECLARED')!;
  assert.match(i.ai, /Calculate Free Spins States|feature_rounds_remaining/);
});

test('a counter declared with the platform name is fine', () => {
  const r = stakeReadiness(project([n('v', 'Variable2', { name: 'feature_rounds_remaining' }), n('w', 'Variable2', { name: 'freeSpinsLeft' })]));
  assert.ok(!codes(r).includes('FREE_SPINS_NOT_DECLARED'));
});

test('a Bet Mode not fed from the inputs cannot buy: error', () => {
  const r = stakeReadiness(project([n('bm', 'Bet Mode')]));
  assert.ok(codes(r).includes('BET_MODE_NOT_AN_INPUT'));
  const ok = stakeReadiness(project([n('bm', 'Bet Mode')], [c('in', 'mode', 'bm', 'mode')]));
  assert.ok(!codes(ok).includes('BET_MODE_NOT_AN_INPUT'));
});

test('jackpot pools, gamble and uncompilable maths are errors', () => {
  const r = stakeReadiness(project([n('j', 'RGS Jackpot Pools'), n('g', 'JavaScriptFunction', {}, 'Gamble Step'), n('e', 'SlotMainEngine')]));
  for (const code of ['JACKPOT_POOL', 'GAMBLE_FEATURE', 'MATHS_NOT_COMPILABLE']) assert.ok(codes(r).includes(code), code);
});

test('no Math Component, or one nobody wires, is an error', () => {
  assert.ok(codes(stakeReadiness({ components: [{ name: '/App', graph: { roots: [] } }] })).includes('NO_MATHS_COMPONENT'));
  const unwired = stakeReadiness(project([], [], [n('m', '/#__maths__/SlotMaths')], []));
  assert.ok(codes(unwired).includes('MATHS_NOT_WIRED'));
  const unused = stakeReadiness(project([], [], [n('t', 'Text', { text: 'x' })], []));
  assert.ok(codes(unused).includes('MATHS_UNUSED'));
});

test('hand-wired Stake nodes, XRGS-only nodes, missing disclaimer and social words are flagged', () => {
  const r = stakeReadiness(project([], [], [n('m', '/#__maths__/SlotMaths'), n('p', 'stake.RGSPlay'), n('l', 'RGS Leaderboard'), n('t', 'Text', { text: 'BET' })], [c('x', 'y', 'm', 'Spin')]));
  for (const code of ['HAND_WIRED_STAKE_NODES', 'XRGS_ONLY_NODE', 'NO_DISCLAIMER', 'SOCIAL_MODE_WORDS']) assert.ok(codes(r).includes(code), code);
});

test('errors come first, and every issue says how to fix it, for the user and for the AI', () => {
  const r = stakeReadiness(project([n('v', 'Variable2', { name: 'fsLeft' }), n('s', 'Sticky Symbols')]));
  const levels = r.issues.map((i) => i.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => ['error', 'warn', 'info'].indexOf(a) - ['error', 'warn', 'info'].indexOf(b)));
  assert.ok(r.issues.every((i) => i.message && i.fix && i.ai));
});

test('no project is not "ready"', () => {
  assert.equal(stakeReadiness(null).ready, false);
});

test('the request handed to the AI lists the fixes it can act on, errors first, and asks it to re-check', () => {
  const r = stakeReadiness(project([n('v', 'Variable2', { name: 'fsLeft' }), n('s', 'Sticky Symbols')]));
  const text = stakeFixRequest(r);
  assert.match(text, /^Get this game ready for Stake Engine/);
  assert.match(text, /1\. \[FREE_SPINS_NOT_DECLARED\]/);
  assert.match(text, /stake\(\{action:"readiness"\}\)/);
  assert.ok(!text.includes('REVIEW_CHECKLIST'), 'reminders are not sent as fixes');
  const clean = stakeReadiness(project([n('fs', 'Calculate Free Spins States')]));
  assert.equal(stakeFixRequest({ ...clean, issues: clean.issues.filter((i) => i.code !== 'STAKE_BUILD_NOT_WIRED') }), '', 'nothing to fix: nothing is sent');
});

test('while the Stake build does not play books, a game with maths is told so (warning, not a silent pass)', () => {
  const r = stakeReadiness(project([n('fs', 'Calculate Free Spins States')]));
  assert.equal(codes(r).includes('STAKE_BUILD_NOT_WIRED'), !STAKE_BUILD_PLAYS_BOOKS);
});

test('a hand-wired Stake bench (stake.* nodes, no Math Component) is checked as such, not as a broken game', () => {
  const bench = {
    components: [{
      name: '/Start Page',
      graph: {
        roots: [n('a', 'stake.RGSAuthenticate'), n('p', 'stake.RGSPlay'), n('e', 'stake.RGSEvent', { protocol: 'http' }), n('end', 'stake.RGSEndRound'), n('b1', 'net.xgenia.controls.button'), n('b2', 'net.xgenia.controls.button')],
        connections: [c('b1', 'onClick', 'a', 'authenticate'), c('b2', 'onClick', 'p', 'play')]
      }
    }]
  };
  const r = stakeReadiness(bench);
  const cs = codes(r);
  assert.ok(!cs.includes('NO_MATHS_COMPONENT'));
  assert.ok(!cs.includes('HAND_WIRED_STAKE_NODES'), 'only a problem next to a Math Component (double play)');
  for (const code of ['STAKE_NODE_HTTP', 'MANUAL_NO_END_ROUND', 'MANUAL_STAKE_WIRING']) assert.ok(cs.includes(code), code);
  assert.ok(!cs.includes('MANUAL_NO_AUTHENTICATE'));
});
