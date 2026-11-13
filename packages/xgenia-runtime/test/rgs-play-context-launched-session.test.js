// A casino opens a published game at /game-launch's `play_url`: the site with
// `?session=<token>`. Every /rgs-fn call of that tab must carry THAT session —
// it is what identifies the player, their limits and their wallet. Before
// 2026-11-02 the page sent a session id it made up, so /rgs-fn refused every
// real-money stake and an editor game could not be played for money at all.
//
// node test environment: a minimal window (location + the two storages) is
// all rgs-play-context reads.

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear()
  };
}

function openAt(search) {
  global.window.location = { search };
}

function load() {
  jest.resetModules();
  return require('../src/nodes/std-library/data/rgs-play-context');
}

beforeEach(() => {
  global.window = { location: { search: '' }, sessionStorage: memoryStorage(), localStorage: memoryStorage() };
});

afterAll(() => {
  delete global.window;
});

test('a launched page sends the launch session as __session', () => {
  openAt('?session=launch-tok-123&lang=eng');
  expect(load().getPlayContextFields().__session).toBe('launch-tok-123');
});

test('session_token is accepted too', () => {
  openAt('?session_token=tok-abc');
  expect(load().getSessionId()).toBe('tok-abc');
});

test('the launched session survives navigation that drops the query string', () => {
  openAt('?session=launch-tok-456');
  const ctx = load();
  expect(ctx.getSessionId()).toBe('launch-tok-456');
  openAt('');
  expect(ctx.getSessionId()).toBe('launch-tok-456');
});

test('a new launch in the same tab replaces the old session', () => {
  openAt('?session=first');
  const ctx = load();
  expect(ctx.getSessionId()).toBe('first');
  openAt('?session=second');
  expect(ctx.getSessionId()).toBe('second');
});

test('with no launch, a page still gets its own stable per-tab id (demo play)', () => {
  openAt('');
  const ctx = load();
  const a = ctx.getSessionId();
  expect(a).toBeTruthy();
  expect(ctx.getSessionId()).toBe(a);
});

test('junk in the URL is not taken as a session', () => {
  const ctx = load();
  openAt('?session=' + encodeURIComponent('has spaces in it'));
  expect(ctx.launchedSessionFromUrl()).toBe('');
  openAt('?session=' + 'x'.repeat(200));
  expect(ctx.launchedSessionFromUrl()).toBe('');
});
