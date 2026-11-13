import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAKE_SHELL_FILE, findSpinButtonIds, injectStakeShell, stakeShellData } from '../../src/editor/src/utils/stake/stakeShell';
import { STAKE_RULES } from '../../src/editor/src/utils/stake/stakeRules';
import { stakeReadiness } from '../../src/editor/src/utils/stake/stakeReadiness';

test('shell data: every mode with its price and the payout and top win measured on the uploaded books', () => {
  const d = stakeShellData({
    game: 'Sweet Swirl',
    modes: [{ name: 'base', label: 'Base game', cost: 1, rtp: 0.9641, maxWin: 330 }, { name: 'bonus', label: 'Bonus buy', cost: 100, rtp: 0.9622, maxWin: 5000 }],
    summary: { freeSpins: 'library', betModes: true, pickBonus: false },
    spinNodeIds: ['a', 'a', 'b']
  });
  assert.equal(d.disclaimer, STAKE_RULES.disclaimer);
  assert.deepEqual(d.spinNodeIds, ['a', 'b']);
  assert.equal(d.modes[1].cost, 100);
  assert.equal(d.confirmAbove, 2);
  assert.match(d.features.join(' '), /Free spins/);
  assert.match(d.features.join(' '), /bought bonus/);
  assert.equal(d.social.bet, 'play');
  assert.equal(d.social.cash, 'coins');
});

test('the Spin button: the one chosen on publish first, then buttons that say spin, play or bet; never maths', () => {
  const project = {
    components: [
      { name: '/Pages/Game', graph: { roots: [{ id: 'page', type: 'Page', children: [
        { id: 'spin', type: 'net.xgenia.controls.button', label: 'SpinButton', children: [] },
        { id: 'betBtn', type: 'net.xgenia.controls.button', label: 'net.xgenia.controls.button 2', parameters: { label: 'Bet' }, children: [] },
        { id: 'rules', type: 'net.xgenia.controls.button', label: 'RulesButton', children: [] }
      ] }] } },
      { name: '/#__maths__/M', graph: { roots: [{ id: 'mathsSpin', type: 'net.xgenia.controls.button', label: 'Spin', children: [] }] } }
    ]
  };
  assert.deepEqual(findSpinButtonIds(project, 'chosen'), ['chosen', 'spin', 'betBtn']);
  assert.deepEqual(findSpinButtonIds(project), ['spin', 'betBtn']);
});

test('index.html loads the shell first in <head>, once', () => {
  const html = '<!doctype html><html><head><title>x</title><script src="app.js"></script></head><body></body></html>';
  const once = injectStakeShell(html);
  assert.ok(once.indexOf(STAKE_SHELL_FILE) < once.indexOf('app.js'));
  assert.equal(injectStakeShell(once), once);
});

// (2026-11-11) What the build adds is information, not work: a warning sent the AI off building a rules popup.
test('readiness: the rules screen and social wording are the build\'s now, not warnings', () => {
  const project = { components: [{ name: '/Pages/Game', graph: { roots: [{ id: 't', type: 'Text', label: 'BetLabel', parameters: { text: 'BET' }, children: [] }], connections: [] } }] };
  const r = stakeReadiness(project);
  for (const code of ['NO_DISCLAIMER', 'SOCIAL_MODE_WORDS']) {
    const i = r.issues.find((x) => x.code === code);
    assert.ok(i, code);
    assert.equal(i!.level, 'info', code);
    assert.match(i!.ai, /^Do not/);
  }
});
