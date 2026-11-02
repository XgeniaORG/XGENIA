// The release flow a studio sees in Publish, rendered for real and driven like a
// person would: sign in with an email code, create the game, then certify it.
// XGENIA RGS is a fake fetch that answers exactly the contract the editor calls.
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx tsx --test --test-force-exit packages/xgenia-editor/tests/rgs/releaseSetupFlow.test.tsx
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import Module from 'node:module';

// The core-ui components import CSS modules and images, which node cannot load.
// Class names are irrelevant to what this test checks, so each stylesheet
// becomes an object that answers any class name with itself.
const extensions = (Module as any)._extensions;
for (const ext of ['.scss', '.css', '.svg', '.png', '.jpg', '.gif']) {
  extensions[ext] = (m: any) => {
    m.exports = new Proxy({}, { get: (_t, key) => (key === '__esModule' ? false : String(key)) });
  };
}

// core-ui's Icon builds its sprite map with webpack's require.context when the
// module loads; node's require has no such thing. An empty context means no
// icons, which this test does not look at. Set only while the components load.
async function loadComponents() {
  const fp = Function.prototype as any;
  fp.context = () => Object.assign(() => '', { keys: () => [] as string[] });
  try {
    return {
      ...(await import('../../src/editor/src/views/DeployPopup/ReleaseSetup/ReleaseSetup')),
      rgsClient: await import('../../src/editor/src/utils/rgs/rgsClient')
    };
  } finally {
    delete fp.context;
  }
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
const g = globalThis as any;
g.window = dom.window; g.document = dom.window.document; g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement; g.sessionStorage = dom.window.sessionStorage; g.localStorage = dom.window.localStorage;
g.Node = dom.window.Node; g.MutationObserver = dom.window.MutationObserver;
g.IS_REACT_ACT_ENVIRONMENT = true;
// core-ui's TextInput measures itself; jsdom has no layout, so nothing to observe.
g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
// jsdom's window has animation frames; core-ui calls the globals.
g.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
g.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
// The selected game is kept per open project (rgsClient.getActiveGame); the editor always has one open.
g.ProjectModel = { instance: { id: 'crash-project', name: 'Crash Space' } };

type Call = { url: string; body: any };

/** A fake XGENIA RGS + Supabase Auth. */
function installRgs() {
  const calls: Call[] = [];
  const games: any[] = [];
  let certifyPolls = 0;
  g.fetch = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    const json = (status: number, data: any) => ({
      ok: status < 300,
      status,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(data),
      json: async () => data
    });
    if (url.endsWith('/auth/v1/otp')) return json(200, {});
    if (url.endsWith('/auth/v1/verify')) return body.token === '123456' ? json(200, { access_token: 'jwt' }) : json(403, { msg: 'Token has expired or is invalid' });
    if (url.endsWith('/rgs-connect')) return json(200, { connected: true, operator_slug: 'studio-1', api_key: 'xrgs_test', message: 'New RGS connection created.' });
    if (url.endsWith('/maths-deployer')) {
      if (body.action === 'list-games') return json(200, { games });
      if (body.action === 'operator-info') return json(200, { operator: { operator_id: 'o1', operator_slug: 'studio-1', name: 'Studio', mode: 'demo', wallet_balance: 0, currency: 'EUR', supported_currencies: ['EUR'], max_bet: null, max_win: null } });
      if (body.action === 'create-game') {
        const game = { id: 'g1', slug: body.slug, name: body.name, min_bet: body.min_bet, max_bet: body.max_bet, rtp_declared: body.declared_rtp, max_win_multiplier: body.max_win_multiplier };
        games.push(game);
        return json(200, { game_id: 'g1', slug: body.slug, created: true, game });
      }
    }
    if (url.endsWith('/rtp-certify')) {
      if (body.action === 'certify-game') return json(200, { job_id: 'j1', status: 'queued', reused: false, message: 'Started.' });
      if (body.action === 'certify-status') {
        if (!body.job_id && certifyPolls === 0 && !calls.some((c) => c.body.action === 'certify-game')) return json(200, { status: 'none', message: '' });
        certifyPolls++;
        return json(200, { job_id: 'j1', status: 'passed', progress: 1, rounds_done: 100_000_000, rounds_total: 100_000_000, measured_rtp: 96.01, declared_rtp: 96, within_tolerance: true, certificate_id: 'c1' });
      }
    }
    return json(404, { error: `unexpected ${url} ${body.action || ''}` });
  };
  return { calls, games };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function byText(root: Element, tag: string, text: string | RegExp): HTMLElement {
  const el = [...root.querySelectorAll(tag)].find((e) => (typeof text === 'string' ? e.textContent?.trim() === text : text.test(e.textContent || ''))) as HTMLElement | undefined;
  assert.ok(el, `no <${tag}> with text ${text} — page says: ${root.textContent}`);
  return el!;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function click(el: HTMLElement) {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

test('a new studio signs in by email, creates its game with its own numbers, and certifies — no key, no Maths panel', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, RgsCertifyPanel, rgsClient } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs();

  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const App = () =>
    React.createElement('div', null, React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' }), React.createElement(RgsCertifyPanel));
  await act(async () => { root.render(React.createElement(App)); });

  // ── 1. Sign in ── (no XGENIA session here, so the automatic sandbox connect fails and the studio uses its invite)
  await act(async () => { await tick(20); });
  await act(async () => { click(byText(host, 'div', 'Use an invited RGS account instead')); });
  assert.match(host.textContent || '', /Sign in to XGENIA RGS/);
  assert.doesNotMatch(host.textContent || '', /API key|operator key/i, 'nobody is asked for a key');
  await act(async () => { type(host.querySelector('input')!, 'studio@example.com'); });
  await act(async () => { click(byText(host, 'button', 'Email me a code')); await tick(); });
  assert.match(host.textContent || '', /Enter the code sent to studio@example\.com/);

  // A wrong code is explained and changes nothing.
  await act(async () => { type(host.querySelector('input')!, '000000'); });
  await act(async () => { click(byText(host, 'button', 'Sign in')); await tick(); });
  assert.match(host.textContent || '', /That code is wrong or has expired/);
  assert.equal(rgsClient.isRgsConnected(), false);

  await act(async () => { type(host.querySelector('input')!, '123456'); });
  await act(async () => { click(byText(host, 'button', 'Sign in')); await tick(); await tick(); });
  assert.equal(rgsClient.getRgsSettings()?.apiKey, 'xrgs_test', 'the studio key is stored as the connection');

  // ── 2. Game: none yet, so the create form opens with the project name and defaults ──
  await act(async () => { await tick(); await tick(); });
  assert.match(host.textContent || '', /Which game is this\?/);
  const inputs = () => [...host.querySelectorAll('input')] as HTMLInputElement[];
  assert.equal(inputs()[0].value, 'Crash Space');
  // RTP, max win, min bet, max bet — in that order on screen.
  assert.deepEqual(inputs().map((i) => i.value), ['Crash Space', '96', '5000', '0.20', '100.00']);

  // An impossible RTP is refused in words before anything is sent.
  await act(async () => { type(inputs()[1], '100'); });
  await act(async () => { click(byText(host, 'button', 'Create game')); await tick(); });
  assert.match(host.textContent || '', /between 80 and 99\.99/);
  assert.equal(calls.filter((c) => c.body.action === 'create-game').length, 0);

  await act(async () => { type(inputs()[1], '96.5'); type(inputs()[3], '0.10'); });
  await act(async () => { click(byText(host, 'button', 'Create game')); await tick(); await tick(); });
  const created = calls.find((c) => c.body.action === 'create-game')!;
  assert.deepEqual(
    { rtp: created.body.declared_rtp, min: created.body.min_bet, max: created.body.max_bet, maxWin: created.body.max_win_multiplier, mode: created.body.mode },
    { rtp: 96.5, min: 10, max: 10000, maxWin: 5000, mode: 'demo' }
  );

  // ── Ready: one summary line, and the certify panel for this game ──
  await act(async () => { await tick(); await tick(); });
  assert.match(host.textContent || '', /Publishing Crash Space on XGENIA RGS/);
  assert.deepEqual(rgsClient.getActiveGame(), { id: 'g1', slug: 'crash-space', name: 'Crash Space' });

  // ── 4. Certify ──
  await act(async () => { await tick(); });
  assert.match(host.textContent || '', /RTP not verified yet/);
  await act(async () => { click(byText(host, 'button', 'Verify RTP')); await tick(); });
  assert.ok(calls.some((c) => c.body.action === 'certify-game' && c.body.game_id === 'g1' && c.body.quick === false));
  // Started → the panel polls by game until the run finishes.
  await act(async () => { await tick(5200); });
  assert.match(host.textContent || '', /RTP verified on XGENIA RGS \(not a lab certificate\): pays 96\.01% against a declared 96\.00%/);
  assert.doesNotMatch(host.textContent || '', /(^|[^-])\bCertified\b/, 'nothing on screen claims a certification');

  await act(async () => { root.unmount(); });
});

test('an address that is not invited is told what to do, not shown a database error', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsSignInForm } = await loadComponents();
  localStorage.clear();
  g.fetch = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ msg: 'Database error saving new user' }) });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsSignInForm)); });
  await act(async () => { await tick(20); });
  await act(async () => { click(byText(host, 'div', 'Use an invited RGS account instead')); });
  await act(async () => { type(host.querySelector('input')!, 'stranger@example.com'); });
  await act(async () => { click(byText(host, 'button', 'Email me a code')); await tick(); });
  assert.match(host.textContent || '', /has not been invited to XGENIA RGS yet/);
  assert.doesNotMatch(host.textContent || '', /Database error/);
  await act(async () => { root.unmount(); });
});


// (2026-11-02) Every XGENIA login is a play-money RGS sandbox: Publish connects with the XGENIA sign-in by itself —
// no email, no code, no invite — and every later RGS call of that connection goes to the test RGS.
test('a signed-in XGENIA user is connected to their play-money sandbox with nothing to type', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsSignInForm, rgsClient } = await loadComponents();
  localStorage.clear();
  // A persisted XGENIA session, as the editor keeps it.
  localStorage.setItem('sb-pcrghrjikkcmelflwiys-auth-token', JSON.stringify({
    access_token: 'xgenia-jwt', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'maker@example.com', aud: 'authenticated' }
  }));
  const calls: Array<{ url: string; body: any }> = [];
  g.fetch = async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {};
    calls.push({ url, body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ connected: true, sandbox: true, operator_slug: 'sandbox-1', api_key: 'xrgs_sandbox', message: 'Your play-money RGS sandbox is ready.' }) };
  };
  let signedIn = 0;
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsSignInForm, { onSignedIn: () => { signedIn++; } })); });
  await act(async () => { await tick(30); });

  assert.equal(signedIn, 1, 'connected with no input');
  const connect = calls.find((c) => c.url.endsWith('/rgs-connect'))!;
  assert.equal(connect.url, `${rgsClient.XRGS_SANDBOX_URL}/rgs-connect`, 'the test RGS, never the real-money one');
  assert.deepEqual(connect.body, { action: 'xgenia-connect', xgenia_token: 'xgenia-jwt' });
  assert.equal(rgsClient.rgsFunctionsUrl(), rgsClient.XRGS_SANDBOX_URL, 'later calls go to the test RGS');
  assert.equal(rgsClient.isSandboxConnection(), true);
  assert.equal(rgsClient.rgsHeaders('k').apikey, rgsClient.XRGS_SANDBOX_ANON_KEY);
  assert.doesNotMatch(host.textContent || '', /Email me a code/);
  await act(async () => { root.unmount(); });

  // An invited studio signing in by email afterwards is back on the real-money RGS.
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_studio', rgsUrl: rgsClient.XRGS_URL });
  assert.equal(rgsClient.rgsFunctionsUrl(), rgsClient.XRGS_URL);
  localStorage.clear();
});


// (2026-11-02) An invited studio already on its sandbox must be able to reach the real-money RGS. Sign out used to
// remount the sign-in, which reconnected to the sandbox by itself before the invited-account link could be clicked,
// and the connected line never said which RGS it was on.
test('a studio on its sandbox can switch to an invited real-money account, and Sign out does not reconnect by itself', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, rgsClient } = await loadComponents();
  localStorage.clear();
  localStorage.setItem('sb-pcrghrjikkcmelflwiys-auth-token', JSON.stringify({
    access_token: 'xgenia-jwt', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'maker@example.com', aud: 'authenticated' }
  }));
  const { calls } = installRgs();
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_sandbox', rgsUrl: rgsClient.XRGS_SANDBOX_URL });
  rgsClient.setActiveGame({ id: 'g1', slug: 'crash', name: 'Crash' });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' })); });
  assert.match(host.textContent || '', /play-money sandbox/, 'the connected line says it is play money');

  await act(async () => { click(byText(host, 'span', 'Sign out')); await tick(30); });
  assert.equal(rgsClient.getRgsSettings(), null, 'signed out');
  assert.equal(calls.filter((c) => c.url.endsWith('/rgs-connect')).length, 0, 'Sign out must not reconnect by itself');
  assert.match(host.textContent || '', /Connect with my XGENIA login/);

  await act(async () => { click(byText(host, 'div', 'Use an invited RGS account instead')); });
  await act(async () => { type(host.querySelector('input')!, 'studio@example.com'); });
  await act(async () => { click(byText(host, 'button', 'Email me a code')); await tick(); });
  await act(async () => { type(host.querySelector('input')!, '123456'); });
  await act(async () => { click(byText(host, 'button', 'Sign in')); await tick(30); });
  const connect = calls.find((c) => c.url.endsWith('/rgs-connect'))!;
  assert.equal(connect.url, `${rgsClient.XRGS_URL}/rgs-connect`, 'the invited account signs in on the real-money RGS');
  assert.equal(rgsClient.isSandboxConnection(), false);
  await act(async () => { root.unmount(); });
  localStorage.clear();
});
