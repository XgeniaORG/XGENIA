// Player Progress (slot feature 31): XP into levels from cumulative thresholds, level-up and
// unlock signals, the save object, load and reset.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('player-progress.js');
useFakeClock();

describe('Player Progress', () => {
  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['addXp', 'xp', 'levelThresholds', 'unlock', 'achievementId', 'load', 'stateIn', 'reset'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['level', 'totalXp', 'xpIntoLevel', 'xpToNext', 'progress', 'achievements', 'levelUp', 'unlocked', 'stateOut', 'changed'].sort());
    expect(Def.metadata.outputs.levelUp.type).toBe('signal');
  });

  test('xp accumulates, levels follow the thresholds, levelUp fires once per level', async () => {
    const h = await mount(Def, { levelThresholds: [100, 250], xp: 60 });
    expect(h.out('level')).toBe(1);
    expect(h.out('totalXp')).toBe(0);
    h.fire('addXp');
    expect(h.out('totalXp')).toBe(60);
    expect(h.out('level')).toBe(1);
    expect(h.out('xpIntoLevel')).toBe(60);
    expect(h.out('xpToNext')).toBe(40);
    expect(h.out('progress')).toBeCloseTo(0.6);
    expect(h.count('levelUp')).toBe(0);
    h.fire('addXp');
    expect(h.out('totalXp')).toBe(120);
    expect(h.out('level')).toBe(2);
    expect(h.count('levelUp')).toBe(1);
    expect(h.out('xpIntoLevel')).toBe(20);
    expect(h.out('xpToNext')).toBe(130);
    expect(h.count('changed')).toBeGreaterThanOrEqual(2);
  });

  test('achievements unlock once, and stateOut carries totals for SaveGameSession', async () => {
    const h = await mount(Def, { achievementId: 'first-win', xp: 10 });
    h.fire('unlock');
    expect(h.out('achievements')).toEqual(['first-win']);
    expect(h.count('unlocked')).toBe(1);
    h.fire('unlock'); // same id again: no duplicate, no second signal
    expect(h.out('achievements')).toEqual(['first-win']);
    expect(h.count('unlocked')).toBe(1);
    h.fire('addXp');
    expect(h.out('stateOut')).toEqual({ totalXp: 10, achievements: ['first-win'] });
  });

  test('load restores a saved object; reset clears everything', async () => {
    const h = await mount(Def, { levelThresholds: [100, 250, 500] });
    h.set('stateIn', { totalXp: 300, achievements: ['a', 'b'] });
    h.fire('load');
    expect(h.out('totalXp')).toBe(300);
    expect(h.out('level')).toBe(3);
    expect(h.out('achievements')).toEqual(['a', 'b']);
    h.fire('reset');
    expect(h.out('totalXp')).toBe(0);
    expect(h.out('level')).toBe(1);
    expect(h.out('achievements')).toEqual([]);
  });
});
