// The loopback listener "Sign in with XGENIA" hands its one-time code back through (src/main/src/xgenia-rgs-loopback.js).
// Real sockets on 127.0.0.1, no Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  answerPage,
  stateMatches,
  isOpenableAuthorizeUrl,
  listenForXgeniaRgsAnswer,
  registerXgeniaRgsLoopbackHandlers
} = require('../../src/main/src/xgenia-rgs-loopback');

/** The state this listener put on its redirect. */
const stateOf = (l) => new URL(l.redirectUri).searchParams.get('state');
/** The answer path with this listener's state, plus `query`. */
const answer = (l, query) => `/xgenia-rgs?state=${encodeURIComponent(stateOf(l))}&${query}`;

/** GET a path on the listener, with an optional Host header of the caller's choosing. */
function get(port, path, host) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: host ? { Host: host } : {} },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

test('listens on 127.0.0.1 only, on a free port, at /xgenia-rgs', async () => {
  const l = await listenForXgeniaRgsAnswer();
  try {
    assert.match(l.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/xgenia-rgs\?state=[A-Za-z0-9_-]{22,}$/);
    assert.ok(l.port > 0);
    assert.ok(Buffer.from(stateOf(l), 'base64url').length >= 16, 'at least 128 bits of state');
  } finally {
    l.cancel();
  }
  assert.deepEqual(await l.result, { error: 'CANCELLED', message: '' });
});

test('a favicon or any other path changes nothing; the code on /xgenia-rgs resolves once', async () => {
  const l = await listenForXgeniaRgsAnswer();
  assert.equal((await get(l.port, '/favicon.ico')).status, 404);
  assert.equal((await get(l.port, '/other?code=evil')).status, 404);
  assert.equal((await get(l.port, '/xgenia-rgs/extra?code=evil')).status, 404);
  // Neither a code nor an error: not the RGS's answer, keep waiting.
  assert.equal((await get(l.port, `/xgenia-rgs?state=${stateOf(l)}`)).status, 400);

  const ok = await get(l.port, answer(l, 'code=one-time-123'));
  assert.equal(ok.status, 200);
  assert.match(ok.body, /You(&#39;|')re connected/);
  assert.match(ok.body, /close this tab and return to XGENIA/);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.deepEqual(await l.result, { code: 'one-time-123' });
});

test('a refusal is passed on with its code and message, and the page shows the message escaped', async () => {
  const l = await listenForXgeniaRgsAnswer();
  const msg = '<script>alert(1)</script> needs a plan';
  const res = await get(l.port, answer(l, `error=NO_PLAN&message=${encodeURIComponent(msg)}`));
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body, /<script>alert/);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; needs a plan/);
  assert.deepEqual(await l.result, { error: 'NO_PLAN', message: msg });
});

// A web page that finds the port must not be able to sign the editor in to an account of its choosing (a forged
// code), or show a fake refusal: only the answer carrying this listener's state counts.
test('a wrong state is refused without resolving; the right state then resolves', async () => {
  const l = await listenForXgeniaRgsAnswer();
  let resolved = false;
  l.result.then(() => { resolved = true; });
  const wrongState = 'A'.repeat(stateOf(l).length);
  const forged = await get(l.port, `/xgenia-rgs?state=${wrongState}&code=attacker-code`);
  assert.equal(forged.status, 400);
  assert.match(forged.body, /This sign-in did not come from this editor/);
  const forgedRefusal = await get(l.port, `/xgenia-rgs?state=nope&error=NO_PLAN&message=fake`);
  assert.equal(forgedRefusal.status, 400, 'a refusal needs the state too');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resolved, false, 'still waiting for the real answer');

  const real = await get(l.port, answer(l, 'code=real-code'));
  assert.equal(real.status, 200);
  assert.deepEqual(await l.result, { code: 'real-code' });
});

test('a missing state is refused without resolving', async () => {
  const l = await listenForXgeniaRgsAnswer();
  let resolved = false;
  l.result.then(() => { resolved = true; });
  for (const path of ['/xgenia-rgs?code=attacker-code', '/xgenia-rgs?state=&code=attacker-code', '/xgenia-rgs?error=CODE_INVALID']) {
    const res = await get(l.port, path);
    assert.equal(res.status, 400, path);
    assert.match(res.body, /This sign-in did not come from this editor/);
  }
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(resolved, false);
  l.cancel();
  assert.deepEqual(await l.result, { error: 'CANCELLED', message: '' });
});

test('the state check is exact', () => {
  assert.equal(stateMatches('abc123', 'abc123'), true);
  for (const bad of ['abc124', 'abc12', 'abc1234', '', null, undefined]) assert.equal(stateMatches('abc123', bad), false, String(bad));
});

test('a request naming another host (DNS rebinding) is refused and changes nothing', async () => {
  const l = await listenForXgeniaRgsAnswer();
  const res = await get(l.port, answer(l, 'code=attacker'), `evil.example:${l.port}`);
  assert.equal(res.status, 403);
  const real = await get(l.port, answer(l, 'code=real'));
  assert.equal(real.status, 200);
  assert.deepEqual(await l.result, { code: 'real' });
});

test('no answer within the timeout resolves TIMEOUT and the port is closed', async () => {
  const l = await listenForXgeniaRgsAnswer({ timeoutMs: 50 });
  assert.deepEqual(await l.result, { error: 'TIMEOUT', message: '' });
  await assert.rejects(get(l.port, '/xgenia-rgs?code=late'));
});

test('the answer page escapes every value', () => {
  const page = answerPage({ ok: false, title: '"><img src=x>', message: "it's & <b>" });
  assert.doesNotMatch(page, /<img src=x>|<b>/);
  assert.match(page, /it&#39;s &amp; &lt;b&gt;/);
});

test('only an https sign-in page (or a local stack) is opened in the browser', () => {
  assert.equal(isOpenableAuthorizeUrl('https://rgs.xgenia.app/auth/xgenia?x=1'), true);
  assert.equal(isOpenableAuthorizeUrl('http://127.0.0.1:54321/functions/v1/xgenia-auth'), true);
  for (const bad of ['file:///etc/passwd', 'http://example.com/', 'javascript:alert(1)', 'smb://host/share', 'not a url', '']) {
    assert.equal(isOpenableAuthorizeUrl(bad), false, bad);
  }
});

test('the IPC: listen → open the browser → wait gets the code; a second listen cancels the first', async () => {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
  const opened = [];
  registerXgeniaRgsLoopbackHandlers(ipcMain, { shell: { openExternal: async (u) => { opened.push(u); } } });
  assert.deepEqual(Object.keys(handlers).sort(), ['xgenia-rgs:cancel', 'xgenia-rgs:listen', 'xgenia-rgs:open-browser', 'xgenia-rgs:wait']);

  const first = await handlers['xgenia-rgs:listen']({});
  const second = await handlers['xgenia-rgs:listen']({});
  assert.deepEqual(await handlers['xgenia-rgs:wait']({}, first.id), { error: 'CANCELLED', message: '' });

  assert.equal(typeof second.installLabel, 'string');
  assert.ok(second.installLabel.length > 0, 'the computer name labels the key');
  await assert.rejects(handlers['xgenia-rgs:open-browser']({}, second.id, 'file:///etc/passwd'));
  await handlers['xgenia-rgs:open-browser']({}, second.id, 'https://rgs.xgenia.app/authorize');
  assert.deepEqual(opened, ['https://rgs.xgenia.app/authorize']);

  const port = Number(new URL(second.redirectUri).port);
  const waiting = handlers['xgenia-rgs:wait']({}, second.id);
  const st = new URL(second.redirectUri).searchParams.get('state');
  await get(port, `/xgenia-rgs?state=${st}&code=abc`);
  assert.deepEqual(await waiting, { code: 'abc' });
});
