// RGS Leaderboard (slot feature 32): the __leaderboard fetch, truncation to limit, the
// failure path, and polling start/stop.
'use strict';
const { defineFeature, mount, useFakeClock } = require('./harness');
const Def = defineFeature('rgs-leaderboard.js');
useFakeClock();

const flush = async (h) => { for (let i = 0; i < 4; i++) { await new Promise((r) => setImmediate(r)); h.ctx.update(); } };
const board = (n) => ({ game_slug: 'g1', tournament: { id: 't1', name: 'Weekly', status: 'active', starts_at: 'a', ends_at: 'b', scoring_metric: 'total_win' }, leaderboard: Array.from({ length: n }, (_, i) => ({ rank: i + 1, display_name: 'pl••••', score: 1000 - i, prize_amount: 0 })), total_players: n });

describe('RGS Leaderboard', () => {
  afterEach(() => { delete global.fetch; });

  test('ports match the spec', () => {
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript').sort();
    expect(inputs).toEqual(['fetch', 'gameSlug', 'rgsUrl', 'tournamentId', 'pollMs', 'stopPolling', 'limit'].sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(['entries', 'tournament', 'totalPlayers', 'hasTournament', 'loaded', 'failed', 'error'].sort());
  });

  test('fetch loads the board, truncates to limit and fires loaded', async () => {
    const calls = [];
    global.fetch = jest.fn((url) => { calls.push(String(url)); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(board(15)) }); });
    const h = await mount(Def, { gameSlug: 'g1', rgsUrl: 'https://x.test/functions/v1', limit: 10, tournamentId: 't1' });
    h.fire('fetch');
    await flush(h);
    expect(calls[0]).toBe('https://x.test/functions/v1/rgs-fn/g1/__leaderboard?tournament_id=t1');
    expect(h.out('entries')).toHaveLength(10);
    expect(h.out('entries')[0]).toEqual({ rank: 1, display_name: 'pl••••', score: 1000, prize_amount: 0 });
    expect(h.out('totalPlayers')).toBe(15);
    expect(h.out('hasTournament')).toBe(true);
    expect(h.out('tournament').name).toBe('Weekly');
    expect(h.count('loaded')).toBe(1);
  });

  test('no tournament yet: empty board, hasTournament false, still loaded', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ game_slug: 'g1', tournament: null, leaderboard: [], total_players: 0 }) }));
    const h = await mount(Def, { gameSlug: 'g1' });
    h.fire('fetch');
    await flush(h);
    expect(h.out('entries')).toEqual([]);
    expect(h.out('hasTournament')).toBe(false);
    expect(h.out('tournament')).toBeNull();
    expect(h.count('loaded')).toBe(1);
  });

  test('a failed fetch fires failed with an error', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));
    const h = await mount(Def, { gameSlug: 'g1' });
    h.fire('fetch');
    await flush(h);
    expect(h.count('failed')).toBe(1);
    expect(h.out('error')).toContain('network down');
  });

  test('polling refetches on the interval until stopPolling', async () => {
    let n = 0;
    global.fetch = jest.fn(() => { n++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(board(3)) }); });
    const h = await mount(Def, { gameSlug: 'g1', pollMs: 1000 });
    h.fire('fetch');
    await flush(h);
    expect(n).toBe(1);
    h.advance(1000);
    await flush(h);
    expect(n).toBe(2);
    h.fire('stopPolling');
    h.advance(3000);
    await flush(h);
    expect(n).toBe(2);
  });
});
