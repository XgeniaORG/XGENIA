// (2026-11-11) XRGS bet replay for editor-published games. A replay link is the game's own published page with
// ?replay=true&event=<token>&token=<token>&rgs_url=…; whoever opens it must watch THAT round on the game's screen
// and nothing else: no session adopted or invented, no /rgs-fn call, no authenticated call, no bet. The replay is
// read from the game's own RGS (never a host the link names), and each frame's component_data reaches the
// Aggregator's outputs exactly as a live /rgs-fn answer would, in order.
//
// node test environment: a minimal window (location + the two storages) is all the runtime reads, as in
// rgs-play-context-launched-session.test.js; the Aggregator is driven the way test/nodes/aggregator-*.test.js does.

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const RGS = 'https://rgs.example.co/functions/v1';
const AGG_URL = RGS + '/rgs-fn/lucky-slot/SpinMaths';
// The replay is read pinned to the RGS database's region (rgs-region.js).
const REPLAY_URL = RGS + '/replay/' + TOKEN + '?forceFunctionRegion=eu-west-1';

function memoryStorage() {
  const m = new Map();
  const writes = [];
  return {
    writes,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      writes.push(k);
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
}

function frame(index, data, extra) {
  return Object.assign(
    {
      index,
      kind: index === 0 ? 'base' : 'feature',
      game_mode: index === 0 ? 'base' : 'free_spin',
      bet_amount: index === 0 ? 100 : 0,
      win_amount: 50 * index,
      matrix: null,
      win_lines: [],
      features: [],
      state: { spinsLeft: 3 - index },
      component_data: data
    },
    extra || {}
  );
}

function replayBody(overrides) {
  return Object.assign(
    {
      payoutMultiplier: 1.5,
      costMultiplier: 1,
      // Deliberately out of order: the runtime plays them by index.
      state: {
        frames: [
          frame(2, { reels: 'C', spinWinnings: 100, SpinDone: true }),
          frame(0, { reels: 'A', spinWinnings: 0, SpinDone: true }),
          frame(1, { reels: 'B', spinWinnings: 50, SpinDone: true })
        ]
      },
      replay_version: 1,
      game: { slug: 'lucky-slot', name: 'Lucky Slot', version: '3' },
      mode: 'base',
      currency: 'EUR',
      bet_amount: 100,
      cost_amount: 100,
      win_amount: 150,
      status: 'completed',
      path: 'component',
      verified: 're-executed'
    },
    overrides || {}
  );
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let calls;
let replay;
let ctxMod;
let AggregatorModule;

function openAt(search) {
  global.window = { location: { search }, sessionStorage: memoryStorage(), localStorage: memoryStorage() };
}

function stubFetch(answer) {
  calls = [];
  global.fetch = jest.fn(async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return typeof answer === 'function' ? answer(url, init) : answer;
  });
}

const okReplay = (body) => ({ ok: true, status: 200, json: async () => body || replayBody() });

function load() {
  jest.resetModules();
  replay = require('../src/nodes/std-library/data/rgs-replay');
  ctxMod = require('../src/nodes/std-library/data/rgs-play-context');
  AggregatorModule = require('../src/nodes/std-library/data/aggregatornode');
  replay._resetForTests();
}

function recordingView() {
  const states = [];
  let last = null;
  return {
    states,
    get last() {
      return last;
    },
    render(state, info) {
      states.push(state);
      last = { state, info };
    }
  };
}

/** The page's replay session with a recording view, made before any Aggregator attaches. */
function session(view) {
  return replay.replaySessionForPage({ view, fetch: (url, init) => global.fetch(url, init) });
}

function makeAggregator({ outputs, signalOutputs, url = AGG_URL, wired = ['out-replayPlay', 'out-replayEnded'] }) {
  const Node = AggregatorModule.node;
  const registered = new Set(['success', 'failure', ...wired]);
  const events = [];
  const ctx = {
    _internal: {},
    hasOutput: (name) => registered.has(name),
    registerOutput: (name) => registered.add(name),
    flagOutputDirty: (name) => events.push(['value', name]),
    sendSignalOnOutput: (name) => events.push(['signal', name]),
    scheduleAfterInputsHaveUpdated: (fn) => fn()
  };
  Node.initialize.call(ctx);
  for (const [k, f] of Object.entries(Node.methods)) ctx[k] = f.bind(ctx);
  Node.inputs.outputs.set.call(ctx, outputs);
  Node.inputs.signalOutputs.set.call(ctx, signalOutputs || '');
  Node.inputs.moneyScale.set.call(ctx, 100);
  Node.inputs.betField.set.call(ctx, 'BetAmount');
  Node.inputs.winField.set.call(ctx, 'spinWinnings');
  if (url) Node.inputs.url.set.call(ctx, url);
  return { ctx, events };
}

beforeEach(() => {
  openAt(
    '?replay=true&event=' +
      TOKEN +
      '&token=' +
      TOKEN +
      '&rgs_url=rgs.example.co/functions/v1/replay&game=lucky-slot&version=3&mode=base&session=casino-tok-1'
  );
  load();
});

afterEach(() => {
  replay._resetForTests();
  delete global.fetch;
  delete global.window;
});

describe('replay mode: no session, no /rgs-fn', () => {
  test('replay=true is detected and stays detected after the query string is dropped', () => {
    expect(replay.isReplayPage()).toBe(true);
    global.window.location.search = '';
    expect(replay.isReplayPage()).toBe(true);
  });

  test('no session is adopted (even with ?session= on the link) or invented, and nothing is stored', () => {
    expect(ctxMod.launchedSessionFromUrl()).toBe('');
    expect(ctxMod.getSessionId()).toBe('');
    expect(ctxMod.getClientId()).toBe('');
    ctxMod.setCurrentPlayerId('11111111-2222-3333-4444-555555555555');
    expect(ctxMod.getCurrentPlayerId()).toBe('');
    expect(ctxMod.getPlayContextFields()).toEqual({});
    expect(global.window.sessionStorage.writes).toEqual([]);
    expect(global.window.localStorage.writes).toEqual([]);
  });

  test('a whole replay makes exactly one request: the credential-free replay read', async () => {
    stubFetch(okReplay());
    session(recordingView());
    const { ctx } = makeAggregator({ outputs: 'reels, spinWinnings, SpinDone', signalOutputs: 'SpinDone' });
    await tick();
    replay.replaySessionForPage().play();
    for (let i = 0; i < 3; i++) {
      ctx.triggerSend('Spin');
      await tick();
    }
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(REPLAY_URL);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.credentials).toBe('omit');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).not.toHaveProperty('Authorization');
    expect(calls.some((c) => /rgs-fn|__balance|game-launch|\/session/.test(c.url))).toBe(false);
  });

  test('the ordinary page is untouched: no replay=true, no replay', () => {
    openAt('?session=casino-tok-1');
    load();
    expect(replay.isReplayPage()).toBe(false);
    expect(ctxMod.getSessionId()).toBe('casino-tok-1');
  });
});

describe('replay mode: every bet path is refused', () => {
  test('a trigger before Play is refused, not sent', async () => {
    stubFetch(okReplay());
    session(recordingView());
    const { ctx, events } = makeAggregator({ outputs: 'reels, spinWinnings' });
    await tick();
    ctx.setDataValue('BetAmount', 5);
    ctx.triggerSend('Spin');
    await tick();
    expect(events).toContainEqual(['signal', 'failure']);
    expect(events).not.toContainEqual(['signal', 'success']);
    expect(ctx.getOutputValue('error')).toMatch(/replay: betting is disabled/i);
    expect(calls).toHaveLength(1); // the replay read, nothing else
  });

  test('a trigger after the last frame is refused', async () => {
    stubFetch(okReplay());
    session(recordingView());
    const { ctx, events } = makeAggregator({ outputs: 'reels' });
    await tick();
    replay.replaySessionForPage().play();
    for (let i = 0; i < 3; i++) {
      ctx.triggerSend('Spin');
      await tick();
    }
    events.length = 0;
    ctx.triggerSend('Spin');
    await tick();
    expect(events).toEqual(expect.arrayContaining([['signal', 'failure']]));
    expect(ctx.getOutputValue('error')).toMatch(/round has ended/);
    expect(calls).toHaveLength(1);
  });

  test('the cashier, player and saved-session nodes cannot reach the RGS', () => {
    const { resolveSupabaseConfig } = require('../src/nodes/std-library/data/rgs-config');
    expect(() => resolveSupabaseConfig({})).toThrow(/replay/i);
  });

  test('the fetch guard refuses /rgs-fn, RPC and auth calls, and lets the replay read through', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ({}) });
    expect(replay.installReplayFetchGuard()).toBe(true);
    await expect(fetch(AGG_URL, { method: 'POST', body: '{}' })).rejects.toThrow(/replay/i);
    await expect(fetch(RGS + '/rgs-fn/lucky-slot/__jackpots')).rejects.toThrow(/replay/i);
    await expect(fetch('https://rgs.example.co/rest/v1/rpc/withdraw_balance', { method: 'POST' })).rejects.toThrow(
      /replay/i
    );
    await expect(fetch(RGS + '/game-launch', { method: 'POST' })).rejects.toThrow(/replay/i);
    await expect(fetch(RGS + '/replay/' + TOKEN, { method: 'POST' })).rejects.toThrow(/replay/i);
    await fetch(RGS + '/replay/' + TOKEN);
    await fetch(REPLAY_URL);
    await fetch('https://cdn.example.com/assets/reel.png');
    expect(calls.map((c) => c.url)).toEqual([RGS + '/replay/' + TOKEN, REPLAY_URL, 'https://cdn.example.com/assets/reel.png']);
  });

  test('the guest wallet is not read on a replay page', async () => {
    stubFetch(okReplay());
    session(recordingView());
    const { ctx } = makeAggregator({ outputs: 'spinWinnings' });
    await tick();
    expect(calls.map((c) => c.url)).toEqual([REPLAY_URL]);
    expect(ctx.getOutputValue('rgsBalance')).toBeUndefined();
  });
});

describe("replay mode: the RGS is the game's own", () => {
  test('an rgs_url naming another host is ignored', async () => {
    openAt('?replay=true&event=' + TOKEN + '&rgs_url=evil.example.net/functions/v1/replay');
    load();
    stubFetch(okReplay());
    const s = session(recordingView());
    makeAggregator({ outputs: 'reels' });
    await tick();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(REPLAY_URL);
    expect(s.ignoredRgsUrl).toBe('evil.example.net/functions/v1/replay');
  });

  test('an rgs_url on the same host is accepted, and the read still uses the configured base', () => {
    expect(replay.replayFetchUrl(RGS, TOKEN, 'rgs.example.co/functions/v1/replay')).toEqual({
      url: REPLAY_URL,
      ignoredRgsUrl: null
    });
    expect(replay.replayFetchUrl(RGS, TOKEN, 'https://rgs.example.co.evil.net')).toEqual({
      url: REPLAY_URL,
      ignoredRgsUrl: 'https://rgs.example.co.evil.net'
    });
  });

  test('a replay of another game is refused', async () => {
    stubFetch(okReplay(replayBody({ game: { slug: 'other-game', name: null, version: '1' } })));
    const view = recordingView();
    session(view);
    makeAggregator({ outputs: 'reels' });
    await tick();
    await tick();
    expect(view.last.state).toBe('ERROR');
    expect(view.last.info.error.code).toBe('REPLAY_WRONG_GAME');
  });
});

describe('replay mode: frames reach the outputs in order', () => {
  test('loader, Play, frame after frame through applyOutputs, then Play Again from the first frame', async () => {
    stubFetch(okReplay());
    const view = recordingView();
    session(view);
    const { ctx, events } = makeAggregator({ outputs: 'reels, spinWinnings, SpinDone', signalOutputs: 'SpinDone' });
    expect(view.states[0]).toBe('LOADING');
    await tick();
    expect(view.last.state).toBe('READY');
    expect(ctx.getOutputValue('replayMode')).toBe(true);
    expect(ctx.getOutputValue('replayBetText')).toBe('BET: €1.00');
    expect(ctx.getOutputValue('replayWinText')).toBe('WIN: €1.50');

    const seen = [];
    for (let round = 0; round < 2; round++) {
      events.length = 0;
      view.last.info.play(); // the Play button (then Play Again)
      expect(events).toContainEqual(['signal', 'out-replayPlay']);
      for (let i = 0; i < 3; i++) {
        ctx.triggerSend('Spin');
        await tick();
        seen.push([
          ctx.getOutputValue('reels'),
          ctx.getOutputValue('spinWinnings'),
          ctx.getOutputValue('replayFrameIndex'),
          ctx.getOutputValue('replayFrameState').spinsLeft
        ]);
      }
      expect(view.last.state).toBe('ENDED');
      expect(events).toContainEqual(['signal', 'out-replayEnded']);
      // the maths' own signal still fires per frame, after the data outputs, as live
      expect(events.filter((e) => e[1] === 'out-SpinDone')).toHaveLength(3);
      expect(events.filter((e) => e[1] === 'success')).toHaveLength(3);
    }
    const once = [
      ['A', 0, 0, 3],
      ['B', 50, 1, 2],
      ['C', 100, 2, 1]
    ];
    expect(seen).toEqual([...once, ...once]);
    // no balance: a replay knows nothing about anyone's wallet
    expect(ctx.getOutputValue('rgsBalance')).toBeUndefined();
    expect(ctx.getOutputValue('rgsWin')).toBe(100);
  });

  test('a game that did not wire replayPlay still gets its first frame after Play', async () => {
    stubFetch(okReplay());
    session(recordingView());
    const { ctx, events } = makeAggregator({ outputs: 'reels', wired: [] });
    await tick();
    replay.replaySessionForPage().play();
    await wait(450);
    expect(ctx.getOutputValue('reels')).toBe('A');
    expect(events).toContainEqual(['signal', 'success']);
  });

  test("frame money arrives as the live answer does: a converting script's win port in cents, back in the game money", async () => {
    stubFetch(
      okReplay(
        replayBody({
          state: { frames: [frame(0, { spinWinnings: 250, __moneyScale: 100 }, { win_amount: 250 })] },
          win_amount: 250
        })
      )
    );
    session(recordingView());
    const { ctx } = makeAggregator({ outputs: 'spinWinnings' });
    await tick();
    replay.replaySessionForPage().play();
    ctx.triggerSend('Spin');
    await tick();
    expect(ctx.getOutputValue('spinWinnings')).toBe(2.5);
    expect(ctx.getOutputValue('rgsWin')).toBe(2.5);
  });
});

describe('replay mode: errors and what the round cost', () => {
  test('a 404 (unknown, revoked or expired link) gives the error state, not a game', async () => {
    stubFetch({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error('no body');
      }
    });
    const view = recordingView();
    session(view);
    const { ctx, events } = makeAggregator({ outputs: 'reels' });
    await tick();
    expect(view.last.state).toBe('ERROR');
    expect(view.last.info.error.code).toBe('REPLAY_NOT_FOUND');
    expect(ctx.getOutputValue('replayState')).toBe('ERROR');
    expect(ctx.getOutputValue('error')).toMatch(/not available/);
    // Play does nothing, and the spin is still refused
    expect(replay.replaySessionForPage().play()).toBe(false);
    ctx.triggerSend('Spin');
    await tick();
    expect(events).toContainEqual(['signal', 'failure']);
    expect(calls).toHaveLength(1);
  });

  test('the RGS unreachable, and a link with no token, are errors too', async () => {
    stubFetch(() => {
      throw new Error('offline');
    });
    const view = recordingView();
    session(view);
    makeAggregator({ outputs: 'reels' });
    await tick();
    expect(view.last.info.error.code).toBe('REPLAY_UNAVAILABLE');

    openAt('?replay=true&event=short');
    load();
    stubFetch(okReplay());
    const v2 = recordingView();
    session(v2);
    makeAggregator({ outputs: 'reels' });
    await tick();
    expect(v2.last.info.error.code).toBe('REPLAY_MISSING_TOKEN');
    expect(calls).toHaveLength(0);
  });

  test('the bet is shown with its real cost when the mode costs more than one bet; social wording', () => {
    const data = replayBody({
      mode: 'bonus',
      costMultiplier: 250,
      bet_amount: 100,
      cost_amount: 25000,
      win_amount: 120000
    });
    expect(replay.replaySummary(data, { lang: 'en' }).text).toEqual({
      bet: 'BONUS: €1.00 / REAL COST: €250.00',
      win: 'WIN: €1,200.00'
    });
    expect(replay.replaySummary(replayBody(), { lang: 'en', social: true }).text).toEqual({
      bet: 'PLAY: €1.00',
      win: 'PRIZE: €1.50'
    });
    expect(
      replay.replaySummary(replayBody({ currency: 'JPY', bet_amount: 100, win_amount: 150 }), { lang: 'en' }).bet
    ).toBe(100);
  });

  test('the default view: loader, Play, Play Again and error, as DOM', () => {
    const doc = fakeDocument();
    const view = replay.createDomReplayView(doc);
    const info = {
      summary: replay.replaySummary(replayBody(), { lang: 'en' }),
      error: null,
      play: jest.fn(),
      playAgain: jest.fn()
    };
    view.render('LOADING', info);
    expect(doc.text()).toMatch(/Loading replay/);
    view.render('READY', info);
    doc.button('Play').click();
    expect(info.play).toHaveBeenCalled();
    expect(doc.text()).toMatch(/BET: €1\.00/);
    view.render('PLAYING', info);
    expect(doc.buttons()).toEqual([]);
    view.render('ENDED', info);
    doc.button('Play Again').click();
    expect(info.playAgain).toHaveBeenCalled();
    view.render('ERROR', { ...info, error: { code: 'REPLAY_NOT_FOUND', message: 'This replay is not available.' } });
    expect(doc.text()).toMatch(/not available/);
    expect(doc.buttons()).toEqual([]);
  });
});

// Just enough DOM for the view: elements with children, text, class and click listeners.
function fakeDocument() {
  function make(tag) {
    const e = {
      tagName: tag.toUpperCase(),
      children: [],
      attrs: {},
      listeners: {},
      textContent: '',
      className: '',
      get firstChild() {
        return this.children[0] || null;
      },
      appendChild(c) {
        this.children.push(c);
        return c;
      },
      removeChild(c) {
        this.children.splice(this.children.indexOf(c), 1);
      },
      setAttribute(k, v) {
        this.attrs[k] = v;
      },
      addEventListener(t, fn) {
        this.listeners[t] = fn;
      },
      click() {
        this.listeners.click && this.listeners.click();
      },
      focus() {}
    };
    return e;
  }
  const body = make('body');
  const head = make('head');
  const all = (e) => [e, ...e.children.flatMap(all)];
  return {
    head,
    body,
    createElement: make,
    text: () =>
      all(body)
        .map((e) => e.textContent)
        .join(' '),
    buttons: () =>
      all(body)
        .filter((e) => e.tagName === 'BUTTON')
        .map((e) => e.textContent),
    button: (t) => all(body).find((e) => e.tagName === 'BUTTON' && e.textContent === t)
  };
}
