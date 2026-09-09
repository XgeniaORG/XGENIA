// RGS Jackpot Pools (slot feature 7): registry port parity plus the editor-only ports, mockPools
// client == core, the claim rules, the fetch path (GET {rgsUrl}/rgs-fn/{gameSlug}/__jackpots) with a
// stubbed global fetch, fetched pools taking precedence, and the fail-closed fetch errors.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'rgs-jackpot-pools.js';
const NAME = 'RGS Jackpot Pools';
const Def = defineFeature(FILE);
const OUTPUTS = ['pools', 'poolNames', 'poolCount', 'poolValues', 'poolValue', 'poolFound', 'claimable', 'claims', 'claimed', 'totalPoolValue'];
const CLIENT_ONLY_INPUTS = ['mockPools', 'fetch', 'gameSlug', 'rgsUrl'];
const DEFAULT_RGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';

const DEFAULTS = { poolName: '', shouldClaim: false, claimOnlyIfClaimable: true };

function registryPorts(nodeName) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/api/slot-feature-node-converter.ts'), 'utf8');
  const start = src.indexOf("'" + nodeName + "',");
  if (start < 0) throw new Error('registry has no entry for ' + nodeName);
  const list = (key) => {
    const m = src.slice(start).match(new RegExp('\\b' + key + ':\\s*(\\[[^\\]]*\\])'));
    if (!m) throw new Error('registry entry for ' + nodeName + ' has no ' + key);
    return JSON.parse(m[1].replace(/'/g, '"'));
  };
  return { inputs: list('inputs'), outputs: list('outputs') };
}

/** The server passes ctx.jackpots as `pools`; the client passes the fetched pools or mockPools. */
function coreArgs(pools, params) {
  const p = Object.assign({}, DEFAULTS, params);
  return { pools: pools, poolName: p.poolName, shouldClaim: p.shouldClaim, claimOnlyIfClaimable: p.claimOnlyIfClaimable };
}

const MOCK_POOLS = [
  { id: 'p-mini', name: 'Mini', pool_type: 'scatter', current_value: 12345, claimable: true },
  { id: 'p-major', name: 'Major', pool_type: 'progressive', current_value: 987654, claimable: false }
];
const LIVE_POOLS = [
  { id: 'live-1', name: 'Mega', pool_type: 'scatter', current_value: 5000000, claimable: true }
];

const flush = () => new Promise((resolve) => setImmediate(resolve));

const originalFetch = global.fetch;
let errorSpy;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
  global.fetch = originalFetch;
});

describe('RGS Jackpot Pools', () => {
  test('module shape, metadata, registry port parity plus the editor-only ports', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/rgs-jackpot-pools');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/jackpotClaims/);
    expect(mod.node.description).toMatch(/data\.jackpot_claims/);
    expect(mod.node.description).toMatch(/scatter-type pools are claimable/);
    expect(mod.node.description).toMatch(/guests are ineligible/);
    expect(mod.node.usesBackendServices).toBeUndefined(); // it compiles to the RGS; the fetch is preview only

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).concat(CLIENT_ONLY_INPUTS).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    ['Do', 'fetch'].forEach((name) => expect(Def.metadata.inputs[name].type.name).toBe('signal'));
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.poolValues.type).toBe('object');
    expect(Def.metadata.outputs.claims.type).toBe('array');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
    expect(Def.metadata.inputs.rgsUrl.default).toBe(DEFAULT_RGS_URL);
    expect(Def.metadata.inputs.mockPools.default).toEqual([]);
    expect(Def.metadata.inputs.gameSlug.default).toBe('');
  });

  test('Do with mockPools computes exactly what the core computes', async () => {
    const params = { mockPools: MOCK_POOLS, poolName: 'Major' };
    const h = await mount(Def, params);
    h.fire('Do');
    const expected = cores.resolveJackpotPools(coreArgs(MOCK_POOLS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('poolCount')).toBe(2);
    expect(h.out('poolNames')).toEqual(['Mini', 'Major']);
    expect(h.out('poolValues')).toEqual({ Mini: 12345, Major: 987654 });
    expect(h.out('totalPoolValue')).toBe(12345 + 987654);
    expect(h.out('poolFound')).toBe(true);
    expect(h.out('poolValue')).toBe(987654);
    expect(h.out('claimable')).toBe(false);
    expect(h.out('claims')).toEqual([]);
    expect(h.out('claimed')).toBe(false);
    expect(h.count('Done')).toBe(1);
    expect(h.node.getInspectInfo().value.poolsSource).toBe('mockPools');
  });

  test('claim rules: claimable pool claims, unclaimable pool claims only when claimOnlyIfClaimable is false', async () => {
    const h = await mount(Def, { mockPools: MOCK_POOLS, poolName: 'mini', shouldClaim: true }); // case-insensitive name
    h.fire('Do');
    let expected = cores.resolveJackpotPools(coreArgs(MOCK_POOLS, { poolName: 'mini', shouldClaim: true }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('claims')).toEqual(['Mini']);
    expect(h.out('claimed')).toBe(true);

    h.set('poolName', 'p-major'); // by id
    h.fire('Do');
    expected = cores.resolveJackpotPools(coreArgs(MOCK_POOLS, { poolName: 'p-major', shouldClaim: true }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('poolFound')).toBe(true);
    expect(h.out('claims')).toEqual([]);

    h.set('claimOnlyIfClaimable', false);
    h.fire('Do');
    expected = cores.resolveJackpotPools(coreArgs(MOCK_POOLS, { poolName: 'p-major', shouldClaim: true, claimOnlyIfClaimable: false }));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('claims')).toEqual(['Major']);
    expect(h.count('Done')).toBe(3);
  });

  test('fetch GETs {rgsUrl}/rgs-fn/{gameSlug}/__jackpots, evaluates with the live pools, and Do keeps using them', async () => {
    const calls = [];
    global.fetch = jest.fn((url, init) => {
      calls.push({ url: url, method: init && init.method });
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ game_slug: 'demo-slot', pools: LIVE_POOLS }) });
    });
    const params = { mockPools: MOCK_POOLS, poolName: 'Mega', shouldClaim: true, gameSlug: 'demo-slot', rgsUrl: 'https://example.test/functions/v1/' };
    const h = await mount(Def, params);
    h.fire('fetch');
    await flush();
    h.ctx.update();
    expect(calls).toEqual([{ url: 'https://example.test/functions/v1/rgs-fn/demo-slot/__jackpots', method: 'GET' }]);
    let expected = cores.resolveJackpotPools(coreArgs(LIVE_POOLS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('poolNames')).toEqual(['Mega']);
    expect(h.out('claims')).toEqual(['Mega']);
    expect(h.count('Done')).toBe(1);
    expect(h.node.getInspectInfo().value.poolsSource).toBe('fetched:demo-slot');
    expect(errorSpy).not.toHaveBeenCalled();

    // Do now evaluates the fetched pools, not mockPools
    h.fire('Do');
    expected = cores.resolveJackpotPools(coreArgs(LIVE_POOLS, params));
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
    expect(h.out('poolCount')).toBe(1);
    expect(h.count('Done')).toBe(2);
  });

  test('the default rgsUrl is the production functions URL and the slug is URL-encoded', async () => {
    const calls = [];
    global.fetch = jest.fn((url) => {
      calls.push(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ game_slug: 'x', pools: [] }) });
    });
    const h = await mount(Def, { gameSlug: 'my game/1' });
    h.fire('fetch');
    await flush();
    h.ctx.update();
    expect(calls).toEqual([DEFAULT_RGS_URL + '/rgs-fn/my%20game%2F1/__jackpots']);
    expect(h.out('poolCount')).toBe(0);
    expect(h.count('Done')).toBe(1);
  });

  test('fails closed without a fetch implementation: error, empty outputs, Done', async () => {
    global.fetch = undefined;
    const h = await mount(Def, { mockPools: MOCK_POOLS, gameSlug: 'demo-slot' });
    h.fire('fetch');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[RGS Jackpot Pools\] fetch is not available/);
    expect(h.node.getInspectInfo().value.error).toMatch(/fetch is not available/);
    OUTPUTS.forEach((name) => expect(h.out(name)).toEqual({ pools: [], poolNames: [], poolCount: 0, poolValues: {}, poolValue: 0, poolFound: false, claimable: false, claims: [], claimed: false, totalPoolValue: 0 }[name]));
    expect(h.count('Done')).toBe(1);
  });

  test('fails closed on an empty gameSlug and on an HTTP error', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }));
    const h = await mount(Def, { mockPools: MOCK_POOLS });
    h.fire('fetch'); // no slug
    expect(global.fetch).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0][0]).toMatch(/^\[RGS Jackpot Pools\] gameSlug is required/);
    expect(h.out('pools')).toEqual([]);
    expect(h.count('Done')).toBe(1);

    h.set('gameSlug', 'missing-game');
    h.fire('fetch');
    await flush();
    h.ctx.update();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[1][0]).toMatch(/^\[RGS Jackpot Pools\] GET .*\/rgs-fn\/missing-game\/__jackpots failed: HTTP 404/);
    expect(h.out('pools')).toEqual([]);
    expect(h.count('Done')).toBe(2);

    // mockPools still drive Do after a failed fetch (nothing was stored)
    h.fire('Do');
    expect(h.out('poolCount')).toBe(2);
    expect(h.count('Done')).toBe(3);
  });
});
