import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishDestinationOf, setPublishDestination, stakePanel } from '../../src/editor/src/utils/stake/stakePanel';

const base = { connected: true, gameName: 'Sweet Swirl', components: [{ name: 'SweetSwirlMaths' }], componentsError: '', issues: [] };

test('the destination is the project\'s `target`: set once, Publish opens on it', () => {
  const meta: Record<string, unknown> = {};
  const project = { getMetaData: (k: string) => meta[k], setMetaData: (k: string, v: unknown) => { meta[k] = v; } };
  assert.equal(publishDestinationOf(project), 'xgenia');
  setPublishDestination(project, 'stake');
  assert.equal(meta.target, 'stake'); // the same key the AI's `stake readiness` reads
  assert.equal(publishDestinationOf(project), 'stake');
  setPublishDestination(project, 'xgenia');
  assert.equal(publishDestinationOf(project), 'xgenia');
  assert.equal(publishDestinationOf(null), 'xgenia');
});

// (2026-11-11 screenshot) The old tab said "Ready to export" in green above "has no deployed Math Component" in red.
test('never "ready" while the maths is not deployed', () => {
  const p = stakePanel({ ...base, components: [], componentsError: 'A nice game has no deployed Math Component yet.', issues: [{ code: 'NO_DISCLAIMER', level: 'warn', message: 'm', fix: 'f' }] });
  assert.equal(p.canBuild, false);
  assert.equal(p.tone, 'todo');
  assert.match(p.headline, /Deploy the maths/);
  assert.equal(p.checks[1].state, 'todo');
  assert.match(p.checks[1].detail, /no deployed Math Component/);
});

test('not connected: the first thing it says is connect', () => {
  const p = stakePanel({ ...base, connected: false, gameName: null, components: null });
  assert.equal(p.canBuild, false);
  assert.equal(p.headline, 'Connect to XGENIA RGS to build for Stake.');
  assert.equal(p.checks[1].state, 'todo'); // maths is not "looking…" while signed out
});

test('warnings do not block a build; errors do', () => {
  const warn = stakePanel({ ...base, issues: [{ code: 'SOCIAL_MODE_WORDS', level: 'warn', message: 'm', fix: 'f' }] });
  assert.equal(warn.canBuild, true);
  assert.equal(warn.tone, 'warn');
  assert.equal(warn.issues[0].title, 'Words Stake.US does not allow');
  const err = stakePanel({ ...base, issues: [{ code: 'NO_DISCLAIMER', level: 'warn', message: 'm', fix: 'f' }, { code: 'FREE_SPINS_NOT_DECLARED', level: 'error', message: 'm', fix: 'f' }] });
  assert.equal(err.canBuild, false);
  assert.equal(err.issues[0].code, 'FREE_SPINS_NOT_DECLARED'); // worst first
  assert.match(err.headline, /Fix the problems/);
});

test('all clear', () => {
  const p = stakePanel(base);
  assert.equal(p.canBuild, true);
  assert.equal(p.tone, 'ok');
  assert.equal(p.headline, 'Ready to build for Stake.');
  assert.deepEqual(p.checks.map((c) => c.state), ['ok', 'ok', 'ok']);
});
