// "Sign in with XGENIA" for XGENIA RGS: the loopback redirect (RFC 8252 §7.3).
//
// ── Why this exists ──────────────────────────────────────────────────────────
// Owner decision 2026-11-10: there are no free XGENIA accounts, so customers use ONE RGS (the
// production XGENIA RGS) with ONE login, their XGENIA account. The editor used to connect either to
// the play-money sandbox on the test RGS (rgs-connect `xgenia-connect`, which only that RGS has) or
// with an emailed 6-digit code. Now it signs in the way desktop apps do OAuth: the person signs in
// in their own browser, and the browser hands a one-time code back to the editor through a plain
// HTTP request to 127.0.0.1 (XRGS docs/XGENIA_RGS_CONTRACT.md §9).
//
// The renderer cannot be trusted to hold a listening socket across reloads, and Node's `http`
// belongs here with the editor's other local servers (oauth-callback-server.js). That server was
// not reused: it binds `localhost` from port 3000 upward (predictable, and possibly ::1 where the
// RGS redirect names 127.0.0.1), stays up for the whole session, and calls back for every request.
// This one:
//   - binds 127.0.0.1 ONLY, on a port the OS picks (port 0), so nothing on the network can reach it
//     and a web page cannot guess where it is ahead of time;
//   - accepts exactly one answer on exactly `/xgenia-rgs` (a favicon request or any other path is
//     a 404 and changes nothing), and refuses a Host header that is not this loopback address, so a
//     DNS-rebinding page cannot post a code of its own choosing;
//   - accepts that answer only when it carries the `state` this listener made (128 random bits, on
//     the redirect it gives the RGS; the RGS keeps a redirect's query when it adds `code`). Without
//     it, any web page that found the port could send the editor a code for an account of ITS
//     choosing (a forged sign-in), or a fake refusal. A wrong or missing state is a 400 and the
//     listener keeps waiting for the real answer;
//   - closes after that one answer, on cancel, or after 5 minutes, whichever comes first.
// Only the code crosses the browser; the renderer redeems it for the key over HTTPS
// (utils/rgs/rgsSignIn.ts redeemEditorCode), so the key never does.
//
// The renderer drives it over IPC (registerXgeniaRgsLoopbackHandlers, wired in main.js):
//   xgenia-rgs:listen        → { id, redirectUri (…/xgenia-rgs?state=…), installLabel }
//   xgenia-rgs:open-browser  (id, authorizeUrl) → opens the system browser (https only, or a local stack)
//   xgenia-rgs:wait          (id) → { code } | { error, message }   (never rejects)
//   xgenia-rgs:cancel        (id)
// Tested without Electron: tests/main/xgenia-rgs-loopback.test.cjs.

const http = require('http');
const os = require('os');
const crypto = require('crypto');

const LOOPBACK_PATH = '/xgenia-rgs';
/** Bytes of randomness in the state (128 bits), sent as base64url. */
const STATE_BYTES = 16;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
/** A one-time code is short; anything longer than this is not one. */
const MAX_PARAM_LENGTH = 2048;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** The page the browser shows after it hands the editor its answer. Every value is escaped. */
function answerPage({ ok, title, message }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #15151a; color: #e8e8ec;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; box-sizing: border-box; }
  main { max-width: 480px; padding: 28px 32px; border-radius: 10px; background: #1f1f26; border: 1px solid rgba(255,255,255,0.10); }
  h1 { font-size: 20px; margin: 0 0 12px; color: ${ok ? '#67DE92' : '#ff7a7a'}; }
  p { font-size: 15px; line-height: 1.5; margin: 0; color: #c8c8d0; }
</style>
</head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body>
</html>`;
}

function hostIsThisLoopback(hostHeader, port) {
  const host = String(hostHeader || '').toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

function newState() {
  return crypto.randomBytes(STATE_BYTES).toString('base64url');
}

/** Constant-time: does `given` equal the state this listener made? Missing or another length is no. */
function stateMatches(expected, given) {
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanParam(value) {
  if (typeof value !== 'string') return '';
  const v = value.trim();
  return v.length > MAX_PARAM_LENGTH ? '' : v;
}

/**
 * Listen on http://127.0.0.1:<free port>/xgenia-rgs for ONE browser answer.
 * Resolves once listening, with `result`: a promise of { code } | { error, message } that never
 * rejects (TIMEOUT, CANCELLED and LOOPBACK_FAILED are errors too).
 */
function listenForXgeniaRgsAnswer({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolveListening, rejectListening) => {
    let settled = false;
    let settle;
    const result = new Promise((resolve) => { settle = resolve; });
    let timer = null;
    let port = 0;
    const state = newState();

    const sockets = new Set();
    const server = http.createServer((req, res) => {
      const send = (status, body, type = 'text/html; charset=utf-8') => {
        res.writeHead(status, {
          'Content-Type': type,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          Connection: 'close'
        });
        res.end(body);
      };

      let url;
      try {
        url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
      } catch {
        return send(400, 'Bad request', 'text/plain; charset=utf-8');
      }
      // A browser asks for /favicon.ico (and may probe other paths); none of them is the answer.
      if (req.method !== 'GET' || url.pathname !== LOOPBACK_PATH) return send(404, 'Not found', 'text/plain; charset=utf-8');
      if (!hostIsThisLoopback(req.headers.host, port)) return send(403, 'Forbidden', 'text/plain; charset=utf-8');
      if (settled) {
        return send(410, answerPage({ ok: false, title: 'Already used', message: 'This sign-in has already finished. Return to XGENIA.' }));
      }
      // Before anything else, codes and refusals alike: is this the answer to THIS editor's sign-in?
      if (!stateMatches(state, url.searchParams.get('state'))) {
        return send(400, answerPage({
          ok: false,
          title: 'Not your sign-in',
          message: 'This sign-in did not come from this editor. Return to XGENIA and press Sign in with XGENIA there.'
        }));
      }

      const code = cleanParam(url.searchParams.get('code'));
      const error = cleanParam(url.searchParams.get('error'));
      const message = cleanParam(url.searchParams.get('message'));
      if (error) {
        send(200, answerPage({
          ok: false,
          title: 'XGENIA RGS could not sign you in',
          message: message || `The sign-in was refused (${error}). Return to XGENIA for details.`
        }));
        finish({ error, message });
      } else if (code) {
        send(200, answerPage({
          ok: true,
          title: "You're connected",
          message: 'You can close this tab and return to XGENIA.'
        }));
        finish({ code });
      } else {
        // Neither: not the RGS's answer. Say so and keep waiting for the real one.
        send(400, answerPage({ ok: false, title: 'Nothing to sign in with', message: 'This page expected a sign-in code. Return to XGENIA and try again.' }));
      }
    });

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    function close() {
      if (timer) clearTimeout(timer);
      timer = null;
      server.close();
      // Let the answer page finish sending, then drop keep-alive sockets so the port is released.
      setTimeout(() => { for (const s of sockets) s.destroy(); }, 1000).unref?.();
    }

    function finish(outcome) {
      if (settled) return;
      settled = true;
      close();
      settle(outcome);
    }

    server.on('error', (err) => {
      if (!port) return rejectListening(err);
      finish({ error: 'LOOPBACK_FAILED', message: String(err && err.message ? err.message : err) });
    });

    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      timer = setTimeout(() => finish({ error: 'TIMEOUT', message: '' }), timeoutMs);
      timer.unref?.();
      resolveListening({
        port,
        redirectUri: `http://127.0.0.1:${port}${LOOPBACK_PATH}?state=${state}`,
        result,
        cancel: () => finish({ error: 'CANCELLED', message: '' })
      });
    });
  });
}

/** What the system browser may be sent to: the RGS over https, or a local stack over loopback http. */
function isOpenableAuthorizeUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
}

/**
 * The IPC the renderer uses (utils/rgs/rgsLoopback.ts). One sign-in at a time: a new listen cancels
 * the previous one, so a person pressing the button twice never has two ports open.
 */
function registerXgeniaRgsLoopbackHandlers(ipcMain, { shell, timeoutMs } = {}) {
  const pending = new Map();

  const cancelAll = () => {
    for (const p of pending.values()) p.cancel();
    pending.clear();
  };

  ipcMain.handle('xgenia-rgs:listen', async () => {
    cancelAll();
    const listener = await listenForXgeniaRgsAnswer({ timeoutMs });
    const id = crypto.randomUUID();
    pending.set(id, listener);
    listener.result.then(() => {
      // Kept until wait() has read it, then forgotten.
      setTimeout(() => { if (pending.get(id) === listener) pending.delete(id); }, 60_000).unref?.();
    });
    return { id, redirectUri: listener.redirectUri, installLabel: os.hostname() };
  });

  ipcMain.handle('xgenia-rgs:open-browser', async (_event, id, authorizeUrl) => {
    if (!pending.has(id)) throw new Error('This sign-in is no longer waiting. Start again.');
    if (!isOpenableAuthorizeUrl(authorizeUrl)) throw new Error('XGENIA RGS answered with a sign-in address the editor will not open.');
    await shell.openExternal(String(authorizeUrl));
  });

  ipcMain.handle('xgenia-rgs:wait', async (_event, id) => {
    const listener = pending.get(id);
    if (!listener) return { error: 'CANCELLED', message: '' };
    const outcome = await listener.result;
    if (pending.get(id) === listener) pending.delete(id);
    return outcome;
  });

  ipcMain.handle('xgenia-rgs:cancel', async (_event, id) => {
    const listener = pending.get(id);
    if (listener) listener.cancel();
  });

  return { cancelAll };
}

module.exports = {
  LOOPBACK_PATH,
  DEFAULT_TIMEOUT_MS,
  stateMatches,
  escapeHtml,
  answerPage,
  isOpenableAuthorizeUrl,
  listenForXgeniaRgsAnswer,
  registerXgeniaRgsLoopbackHandlers
};
