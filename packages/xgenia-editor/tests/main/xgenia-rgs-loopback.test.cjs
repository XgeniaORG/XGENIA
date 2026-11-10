// The loopback listener "Sign in with XGENIA" hands its one-time code back through (src/main/src/xgenia-rgs-loopback.js).
// Real sockets on 127.0.0.1, no Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  answerPage,
  isOpenableAuthorizeUrl,
  listenForXgeniaRgsAnswer,
  registerXgeniaRgsLoopbackHandlers
} = require('../../src/main/src/xgenia-rgs-loopback');

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
    assert.match(l.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/xgenia-rgs$/);
    assert.ok(l.port > 0);
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
  assert.equal((await get(l.port, '/xgenia-rgs')).status, 400);

  const ok = await get(l.port, '/xgenia-rgs?code=one-time-123');
  assert.equal(ok.status, 200);
  assert.match(ok.body, /You(&#39;|')re connected/);
  assert.match(ok.body, /close this tab and return to XGENIA/);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.deepEqual(await l.result, { code: 'one-time-123' });
});

test('a refusal is passed on with its code and message, and the page shows the message escaped', async () => {
  const l = await listenForXgeniaRgsAnswer();
  const msg = '<script>alert(1)</script> needs a plan';
  const res = await get(l.port, `/xgenia-rgs?error=NO_PLAN&message=${encodeURIComponent(msg)}`);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.body, /<script>alert/);
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt; needs a plan/);
  assert.deepEqual(await l.result, { error: 'NO_PLAN', message: msg });
});

test('a request naming another host (DNS rebinding) is refused and changes nothing', async () => {
  const l = await listenForXgeniaRgsAnswer();
  const res = await get(l.port, '/xgenia-rgs?code=attacker', `evil.example:${l.port}`);
  assert.equal(res.status, 403);
  const real = await get(l.port, '/xgenia-rgs?code=real');
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
  await get(port, '/xgenia-rgs?code=abc');
  assert.deepEqual(await waiting, { code: 'abc' });
});
