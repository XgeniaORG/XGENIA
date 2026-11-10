// The release flow a studio sees in Publish, rendered for real and driven like a
// person would: Sign in with XGENIA, create the game, then certify it.
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
      rgsClient: await import('../../src/editor/src/utils/rgs/rgsClient'),
      rgsLoopback: await import('../../src/editor/src/utils/rgs/rgsLoopback')
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

/**
 * The main process's loopback, faked: the "browser" answers with `answer` as soon as the sign-in page is opened.
 * Records what was opened and whether the listener was closed.
 */
function fakeLoopback(answer: { code: string } | { error: string; message?: string } = { code: 'one-time-1' }) {
  const opened: string[] = [];
  const cancelled: string[] = [];
  let answered: ((a: any) => void) | null = null;
  const result = new Promise<any>((r) => { answered = r; });
  return {
    opened,
    cancelled,
    loopback: {
      listen: async () => ({ id: 'L1', redirectUri: 'http://127.0.0.1:53111/xgenia-rgs', installLabel: 'studio-mac' }),
      openBrowser: async (_id: string, url: string) => { opened.push(url); answered!(answer); },
      wait: async () => result,
      cancel: async (id: string) => { cancelled.push(id); answered!({ error: 'CANCELLED' }); }
    }
  };
}

/** A fake XGENIA RGS + Supabase Auth. `xgeniaAuth` answers xgenia-auth (Sign in with XGENIA). */
function installRgs(xgeniaAuth?: (body: any) => { status: number; body: any }) {
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
    if (url.endsWith('/xgenia-auth')) {
      if (xgeniaAuth) { const a = xgeniaAuth(body); return json(a.status, a.body); }
      if (body.action === 'start') return json(200, { authorize_url: 'https://rgs.xgenia.app/auth/xgenia?state=s1' });
      if (body.action === 'editor-redeem') {
        return body.code === 'one-time-1'
          ? json(200, { api_key: 'xrgs_test', operator_slug: 'studio-1', studio: { name: 'Acme Games', slug: 'acme' } })
          : json(400, { result: false, code: 'CODE_INVALID', error: 'This code has expired or was already used. Connect again.' });
      }
    }
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

test('a new studio signs in with XGENIA, creates its game with its own numbers, and certifies — no key, no Maths panel', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, RgsCertifyPanel, rgsClient, rgsLoopback } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs();
  const browser = fakeLoopback({ code: 'one-time-1' });
  rgsLoopback.setXgeniaRgsLoopback(browser.loopback);

  const host = document.getElementById('root')!;
  const root = createRoot(host);
  const App = () =>
    React.createElement('div', null, React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' }), React.createElement(RgsCertifyPanel));
  await act(async () => { root.render(React.createElement(App)); });

  // ── 1. Sign in ── nothing happens by itself: opening a browser takes a click.
  await act(async () => { await tick(20); });
  assert.equal(calls.length, 0, 'no request before the person asks');
  assert.equal(browser.opened.length, 0);
  assert.match(host.textContent || '', /Sign in to XGENIA RGS/);
  assert.match(host.textContent || '', /Sign in with email \(XGENIA staff\)/, 'the email sign-in is only a small link');
  assert.doesNotMatch(host.textContent || '', /API key|operator key/i, 'nobody is asked for a key');
  assert.equal(host.querySelectorAll('input').length, 0, 'nothing to type');

  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(); await tick(); await tick(); });
  const start = calls.find((c) => c.body.action === 'start')!;
  assert.equal(start.url, `${rgsClient.XRGS_URL}/xgenia-auth`, 'the main (production) RGS');
  assert.deepEqual(start.body, { action: 'start', purpose: 'editor', editor_redirect: 'http://127.0.0.1:53111/xgenia-rgs', install_label: 'studio-mac' });
  assert.deepEqual(browser.opened, ['https://rgs.xgenia.app/auth/xgenia?state=s1'], 'the sign-in page opens in the browser');
  assert.deepEqual(calls.find((c) => c.body.action === 'editor-redeem')!.body, { action: 'editor-redeem', code: 'one-time-1' });
  assert.ok(!calls.some((c) => c.url.endsWith('/rgs-connect')), 'no sandbox, no email code');
  assert.equal(rgsClient.getRgsSettings()?.apiKey, 'xrgs_test', 'the studio key is stored as the connection');
  assert.equal(rgsClient.rgsFunctionsUrl(), rgsClient.XRGS_URL);
  rgsLoopback.setXgeniaRgsLoopback(null);

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
  // Step 3 happens in XGENIA RGS: the box links straight to this game's Versions page.
  assert.equal(
    byText(host, 'a', 'Open Versions').getAttribute('href'),
    'https://rgs.xgenia.app/project/default/games/crash-space/versions'
  );

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
  await act(async () => { click(byText(host, 'div', 'Sign in with email (XGENIA staff)')); });
  await act(async () => { type(host.querySelector('input')!, 'stranger@example.com'); });
  await act(async () => { click(byText(host, 'button', 'Email me a code')); await tick(); });
  assert.match(host.textContent || '', /has not been invited to XGENIA RGS yet/);
  assert.doesNotMatch(host.textContent || '', /Database error/);
  await act(async () => { root.unmount(); });
});


// (2026-11-10) A person in several studios is asked which one; the code is redeemed again with their choice.
// Nothing is guessed, and a Cancel leaves the editor signed out.
test('several studios: the person picks one, and the same code is redeemed with it', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsSignInForm, rgsClient, rgsLoopback } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs((body) => {
    if (body.action === 'start') return { status: 200, body: { authorize_url: 'https://rgs.xgenia.app/auth/xgenia' } };
    if (!body.studio_slug) return { status: 409, body: { result: false, code: 'CHOOSE_STUDIO', studios: [{ name: 'Alpha Slots', slug: 'alpha' }, { name: 'Beta Crash', slug: 'beta' }] } };
    return { status: 200, body: { api_key: `xrgs_${body.studio_slug}`, operator_slug: `op-${body.studio_slug}`, studio: { name: 'Beta Crash', slug: body.studio_slug } } };
  });
  rgsLoopback.setXgeniaRgsLoopback(fakeLoopback({ code: 'c-9' }).loopback);
  let signedIn = 0;
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsSignInForm, { onSignedIn: () => { signedIn++; } })); });
  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(); await tick(); await tick(); });

  assert.match(host.textContent || '', /more than one studio/);
  assert.equal(rgsClient.isRgsConnected(), false, 'not connected to any studio before the person picks');
  assert.equal(calls.filter((c) => c.body.action === 'editor-redeem').length, 1);

  await act(async () => { click(byText(host, 'button', 'Beta Crash')); await tick(); await tick(); });
  const redeems = calls.filter((c) => c.body.action === 'editor-redeem').map((c) => c.body);
  assert.deepEqual(redeems, [{ action: 'editor-redeem', code: 'c-9' }, { action: 'editor-redeem', code: 'c-9', studio_slug: 'beta' }]);
  assert.equal(rgsClient.getRgsSettings()?.apiKey, 'xrgs_beta');
  assert.equal(signedIn, 1);
  await act(async () => { root.unmount(); });
  rgsLoopback.setXgeniaRgsLoopback(null);
  localStorage.clear();
});

test('a person with no paid plan is told the RGS comes with every paid plan, with a link to upgrade', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsSignInForm, rgsClient, rgsLoopback } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs();
  rgsLoopback.setXgeniaRgsLoopback(fakeLoopback({ error: 'NO_PLAN', message: 'The play-money sandbox in the editor stays free.' }).loopback);
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsSignInForm)); });
  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(); await tick(); });
  assert.match(host.textContent || '', /XGENIA RGS comes with every paid XGENIA plan/);
  assert.doesNotMatch(host.textContent || '', /stays free/, 'never the stale "free sandbox" wording');
  assert.equal(byText(host, 'a', 'See XGENIA plans').getAttribute('href'), 'https://primora.xgenia.com/pricing');
  assert.equal(calls.filter((c) => c.body.action === 'editor-redeem').length, 0, 'nothing to redeem');
  assert.equal(rgsClient.isRgsConnected(), false);
  // Trying again is one click.
  assert.ok(byText(host, 'button', 'Sign in with XGENIA'));
  await act(async () => { root.unmount(); });
  rgsLoopback.setXgeniaRgsLoopback(null);
  localStorage.clear();
});

test('an RGS without Sign in with XGENIA yet says so and leads to the email sign-in; the loopback is closed', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsSignInForm, rgsLoopback } = await loadComponents();
  localStorage.clear();
  installRgs((body) => (body.action === 'start'
    ? { status: 503, body: { result: false, code: 'NOT_CONFIGURED', error: 'Sign in with XGENIA is not configured on this RGS yet.' } }
    : { status: 500, body: {} }));
  const browser = fakeLoopback();
  rgsLoopback.setXgeniaRgsLoopback(browser.loopback);
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsSignInForm)); });
  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(); await tick(); });
  assert.match(host.textContent || '', /Sign in with XGENIA is not available on this RGS yet/);
  assert.equal(browser.opened.length, 0, 'no browser for an RGS that cannot sign anyone in');
  assert.ok(browser.cancelled.includes('L1'), 'the loopback listener is closed');
  await act(async () => { click(byText(host, 'div', 'Sign in with email (XGENIA staff)')); });
  assert.match(host.textContent || '', /Email me a code/);
  await act(async () => { root.unmount(); });
  rgsLoopback.setXgeniaRgsLoopback(null);
  localStorage.clear();
});

// (2026-11-10) The play-money sandbox takes no new connections. A studio still holding a sandbox key sees that it is
// play money and moves to XGENIA RGS by signing in with XGENIA; nothing connects by itself after a Sign out.
test('a studio on its old sandbox moves to XGENIA RGS with Sign in with XGENIA, and Sign out does not reconnect by itself', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, rgsClient, rgsLoopback } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs();
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_sandbox', rgsUrl: rgsClient.XRGS_SANDBOX_URL });
  rgsClient.setActiveGame({ id: 'g1', slug: 'crash', name: 'Crash' });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' })); });
  assert.match(host.textContent || '', /play-money sandbox/, 'the connected line says it is play money');
  assert.match(host.textContent || '', /Sign in with XGENIA to move to XGENIA RGS/);

  await act(async () => { click(byText(host, 'span', 'Move to XGENIA RGS')); await tick(30); });
  assert.equal(rgsClient.getRgsSettings(), null, 'signed out');
  assert.equal(calls.length, 0, 'Sign out must not reconnect by itself');

  rgsLoopback.setXgeniaRgsLoopback(fakeLoopback().loopback);
  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(30); });
  assert.ok(calls.every((c) => c.url.startsWith(rgsClient.XRGS_URL)), 'every call goes to the main RGS');
  assert.ok(!calls.some((c) => c.body.action === 'xgenia-connect'), 'never the sandbox connection');
  assert.equal(rgsClient.isSandboxConnection(), false);
  assert.equal(rgsClient.getRgsSettings()?.apiKey, 'xrgs_test');
  await act(async () => { root.unmount(); });
  rgsLoopback.setXgeniaRgsLoopback(null);
  localStorage.clear();
});

// (2026-11-10) Sign out was reachable only under More → Real money once a game was chosen, so a studio could
// not see which account it was on or sign out to test signing in. It is now always in view in Publish.
test('Publish always shows the signed-in account with a Sign out button, and a Sign out stays signed out', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, rgsClient, rgsLoopback } = await loadComponents();
  localStorage.clear();
  const { calls } = installRgs();
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_main', rgsUrl: rgsClient.XRGS_URL });
  rgsClient.setActiveGame({ id: 'g1', slug: 'crash', name: 'Crash' });
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  // The Publish window's main view: quiet once a game is chosen — but the account and Sign out stay.
  await act(async () => { root.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space', isQuietWhenReady: true })); });
  assert.match(host.textContent || '', /Signed in to XGENIA RGS/, 'which account is in view');

  await act(async () => { click(byText(host, 'button', 'Sign out')); await tick(30); });
  assert.equal(rgsClient.getRgsSettings(), null, 'signed out');
  assert.ok(byText(host, 'button', 'Sign in with XGENIA'), 'the sign-in is offered');

  // Closing and reopening Publish must not reconnect by itself either.
  await act(async () => { root.unmount(); });
  const root2 = createRoot(host);
  await act(async () => { root2.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space', isQuietWhenReady: true })); await tick(30); });
  assert.equal(calls.length, 0, 'Sign out must not reconnect by itself, even in a new window');
  assert.equal(rgsClient.getRgsSettings(), null);

  rgsLoopback.setXgeniaRgsLoopback(fakeLoopback().loopback);
  await act(async () => { click(byText(host, 'button', 'Sign in with XGENIA')); await tick(30); });
  assert.equal(rgsClient.getRgsSettings()?.apiKey, 'xrgs_test', 'signed back in');
  assert.match(host.textContent || '', /Signed in to XGENIA RGS/);
  await act(async () => { root2.unmount(); });
  rgsLoopback.setXgeniaRgsLoopback(null);
  localStorage.clear();
});

// (2026-11-03, XRGS SYSTEM_MAP.md I-13) Moving from the sandbox to an invited real-money account means
// creating the game again on a different RGS. The studio used to retype everything it had declared, on a
// form that opened on defaults. The declaration is remembered per project across accounts.
test('a game declared on the sandbox opens the real-money account\'s game form with the same numbers', async () => {
  const React = (await import('react')).default;
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const { RgsReleaseSetup, rgsClient } = await loadComponents();
  localStorage.clear();

  // On the sandbox: create the game with the studio's own numbers.
  installRgs();
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_sandbox', rgsUrl: rgsClient.XRGS_SANDBOX_URL });
  const host = document.getElementById('root')!;
  let root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' })); });
  await act(async () => { await tick(30); });
  let inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
  await act(async () => { type(inputs[0], 'Gold Rush'); });
  await act(async () => { type(inputs[1], '95.5'); });
  await act(async () => { click(byText(host, 'button', 'Create game')); await tick(30); });
  assert.equal(rgsClient.getActiveGame()?.name, 'Gold Rush');
  await act(async () => { root.unmount(); });

  // Invited: a different RGS with no games yet.
  installRgs();
  rgsClient.clearRgsSettings();
  rgsClient.saveRgsSettings({ apiKey: 'xrgs_studio', rgsUrl: rgsClient.XRGS_URL });
  root = createRoot(host);
  await act(async () => { root.render(React.createElement(RgsReleaseSetup, { projectName: 'Crash Space' })); });
  await act(async () => { await tick(30); });
  inputs = [...host.querySelectorAll('input')] as HTMLInputElement[];
  assert.equal(inputs[0].value, 'Gold Rush', 'the name carried over');
  assert.equal(inputs[1].value, '95.5', 'the RTP carried over');
  assert.match(host.textContent || '', /Brought over from your play-money sandbox/);
  await act(async () => { root.unmount(); });
  localStorage.clear();
});
