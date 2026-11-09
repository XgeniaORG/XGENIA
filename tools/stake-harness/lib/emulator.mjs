/**
 * A local Stake Engine RGS that behaves like the real one, serving a real maths package.
 *
 * ── WHY THIS EXISTS (2026-11-09) ──────────────────────────────────────────────────────────────────
 * scripts/mock-rgs-server.mjs returns random outcomes, one round per play, ends every round cleanly
 * and never resumes — so a game whose bonus is broken on Stake works locally. This server plays the
 * package you will upload, with the rules that make bonuses get stuck:
 *
 *   - /wallet/play draws a book by lookup-table weight and returns its events as round.state; it
 *     debits amount × mode cost; a second play while a round is active is refused (ERR_BE);
 *   - a winning round stays ACTIVE and its win is NOT credited until /wallet/end-round; a losing round
 *     closes by itself unless the mode has autoEndRoundDisabled;
 *   - end-round before jurisdiction.minimumRoundDuration is refused;
 *   - /bet/event stores a string with the active round; /wallet/authenticate returns the active round
 *     (or the last one) with that string, which is how a reloaded game resumes;
 *   - GET /bet/replay/{game}/{version}/{mode}/{event} serves a book with no session at all.
 *
 * Every call and every contract breach is written to a transcript the harness reads back
 * (/__harness/state). The breaches are the point: PLAY_WHILE_ACTIVE, END_ROUND_NO_ACTIVE,
 * EVENT_NO_ACTIVE, END_ROUND_TOO_EARLY, CALL_BEFORE_AUTH ... and, at the end of a test, a winning
 * round nobody ended (the "stuck bonus").
 *
 * Sources: StakeEngine docs api/*, math-sdk docs/rgs_docs/RGS.md, web-sdk rgs-fetcher schema.ts.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeBook } from './rounds.mjs';

export const API_MULTIPLIER = 1_000_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REFERENCE_GAME_DIR = path.resolve(HERE, '..', 'reference-game');

export function makeRng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_LEVELS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100].map((d) => Math.round(d * API_MULTIPLIER));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.atlas': 'text/plain',
  '.txt': 'text/plain',
};

function selfSignedCert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-emu-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

/**
 * @param {object} pkg  a loaded package (lib/package.mjs)
 * @param {object} [o]
 * @param {number} [o.seed]
 * @param {number} [o.balance]            starting balance, API units (default 1000.00)
 * @param {string} [o.currency]
 * @param {number[]} [o.betLevels]        API units
 * @param {number} [o.minRoundMs]         jurisdiction.minimumRoundDuration
 * @param {string[]} [o.autoEndRoundDisabled]  modes whose zero-win rounds stay open
 * @param {string} [o.gameDir]            static frontend to serve at /game/
 * @param {boolean} [o.tls]               serve https with a throwaway self-signed certificate
 * @param {object} [o.jurisdiction]       overrides
 */
export function createEmulator(pkg, o = {}) {
  const rng = makeRng(o.seed ?? 1);
  const currency = o.currency || 'USD';
  const betLevels = (o.betLevels && o.betLevels.length ? o.betLevels : DEFAULT_LEVELS).slice().sort((a, b) => a - b);
  const startBalance = o.balance ?? 1000 * API_MULTIPLIER;
  const minRoundMs = o.minRoundMs ?? 0;
  const autoEndOff = new Set((o.autoEndRoundDisabled || []).map((s) => s.toLowerCase()));
  const jurisdiction = {
    socialCasino: false,
    disabledFullscreen: false,
    disabledTurbo: false,
    disabledSuperTurbo: false,
    disabledAutoplay: false,
    disabledSlamstop: false,
    disabledSpacebar: false,
    disabledBuyFeature: false,
    displayNetPosition: false,
    displayRTP: false,
    displaySessionTimer: false,
    minimumRoundDuration: minRoundMs,
    ...(o.jurisdiction || {}),
  };

  const sessions = new Map();
  const transcript = [];
  const violations = [];
  const forces = [];
  const t0 = Date.now();
  let betSeq = 1000;
  const classIndex = new Map();

  const now = () => Date.now() - t0;
  const violate = (sessionID, code, message) => violations.push({ t: now(), sessionID: sessionID ?? null, code, message });
  const log = (entry) => transcript.push({ t: now(), ...entry });

  function session(id) {
    let s = sessions.get(id);
    if (!s) {
      s = { id, balance: startBalance, authenticated: false, active: null, last: null, authCount: 0 };
      sessions.set(id, s);
    }
    return s;
  }

  /** Book line numbers of a mode, by kind, built once on first force. */
  function classes(mode) {
    let c = classIndex.get(mode.name);
    if (c) return c;
    c = { loss: [], win: [], single: [], feature: [], featureWin: [], maxwin: [] };
    let max = 0;
    for (const { i, text } of mode.lines()) {
      let b;
      try {
        b = JSON.parse(text);
      } catch {
        continue;
      }
      const d = describeBook(b);
      const pm = Number(b.payoutMultiplier) || 0;
      if (pm === 0) c.loss.push(i);
      else c.win.push(i);
      if (pm > 0 && !d.isFeature) c.single.push(i);
      if (d.isFeature) c.feature.push(i);
      if (d.isFeature && pm > 0) c.featureWin.push(i);
      if (pm > max) {
        max = pm;
        c.maxwin = [i];
      } else if (pm === max && pm > 0) c.maxwin.push(i);
    }
    classIndex.set(mode.name, c);
    return c;
  }

  /** Weighted draw of a LUT row, as the RGS does. */
  function drawRow(mode) {
    const total = mode.totalWeight;
    if (total <= 0n) return -1;
    const hi = BigInt(Math.floor(rng() * 2 ** 32));
    const lo = BigInt(Math.floor(rng() * 2 ** 32));
    const r = ((hi << 32n) | lo) % total;
    let a = 0;
    let b = mode.cumulative.length - 1;
    while (a < b) {
      const mid = (a + b) >> 1;
      if (mode.cumulative[mid] > r) b = mid;
      else a = mid + 1;
    }
    return a;
  }

  function pickBook(mode, sessionID) {
    const k = forces.findIndex((f) => (!f.mode || f.mode.toLowerCase() === mode.name.toLowerCase()) && (!f.sessionID || f.sessionID === sessionID));
    if (k >= 0) {
      const f = forces.splice(k, 1)[0];
      if (f.bookId !== undefined && f.bookId !== null) {
        const b = mode.bookById(f.bookId);
        if (b) return { book: b, forced: `id ${f.bookId}` };
      }
      if (f.kind) {
        const list = classes(mode)[f.kind] || [];
        if (list.length) return { book: mode.book(list[Math.floor(rng() * list.length)]), forced: f.kind };
        violate(sessionID, 'FORCE_UNAVAILABLE', `No "${f.kind}" book in mode ${mode.name}; drew by weight.`);
      }
    }
    const row = drawRow(mode);
    const id = mode.lut.rows[row]?.id;
    const b = id === undefined ? null : mode.bookById(id);
    return { book: b ?? mode.book(Math.min(row, mode.bookCount - 1)), forced: null };
  }

  const err = (status, code, message) => ({ status, body: { error: code, message } });

  function roundView(r) {
    return {
      betID: r.betID,
      amount: r.amount,
      payout: r.payout,
      payoutMultiplier: r.payoutMultiplier / 100,
      costMultiplier: r.cost,
      active: r.active,
      mode: r.mode,
      event: r.event,
      state: r.state,
    };
  }

  const handlers = {
    'POST /wallet/authenticate'(body) {
      if (!body.sessionID) return err(400, 'ERR_IS', 'sessionID required');
      const s = session(body.sessionID);
      s.authenticated = true;
      s.authCount++;
      const round = s.active ?? s.last;
      return {
        status: 200,
        body: {
          balance: { amount: s.balance, currency },
          config: {
            gameID: 'local-harness',
            minBet: betLevels[0],
            maxBet: betLevels[betLevels.length - 1],
            stepBet: 10_000,
            defaultBetLevel: betLevels.includes(API_MULTIPLIER) ? API_MULTIPLIER : betLevels[0],
            betLevels,
            betModes: {},
            jurisdiction,
          },
          round: round ? roundView(round) : null,
          meta: null,
        },
        note: s.active ? `resumable round ${s.active.betID} (event ${JSON.stringify(s.active.event)})` : undefined,
      };
    },
    'POST /wallet/balance'(body) {
      const s = sessions.get(body.sessionID);
      if (!s || !s.authenticated) {
        violate(body.sessionID, 'CALL_BEFORE_AUTH', '/wallet/balance before /wallet/authenticate');
        return err(400, 'ERR_IS', 'invalid session');
      }
      return { status: 200, body: { balance: { amount: s.balance, currency } } };
    },
    'POST /wallet/play'(body) {
      const s = sessions.get(body.sessionID);
      if (!s || !s.authenticated) {
        violate(body.sessionID, 'CALL_BEFORE_AUTH', '/wallet/play before /wallet/authenticate');
        return err(400, 'ERR_IS', 'invalid session');
      }
      if (s.active) {
        violate(s.id, 'PLAY_WHILE_ACTIVE', `play while round ${s.active.betID} is still active (it was never ended)`);
        return err(400, 'ERR_BE', 'Player already has an active bet');
      }
      const mode = pkg.mode(body.mode ?? 'base');
      if (!mode) {
        violate(s.id, 'UNKNOWN_MODE', `mode "${body.mode}" is not in index.json (${pkg.modes.map((m) => m.name).join(', ')})`);
        return err(400, 'ERR_VAL', `unknown mode ${body.mode}`);
      }
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount <= 0) {
        violate(s.id, 'BAD_BET', `amount ${body.amount} is not a positive integer in API units (×${API_MULTIPLIER})`);
        return err(400, 'ERR_VAL', 'invalid amount');
      }
      if (!betLevels.includes(amount)) {
        violate(s.id, 'BAD_BET', `amount ${amount} is not one of config.betLevels`);
        return err(400, 'ERR_VAL', 'amount not on bet levels');
      }
      const charge = Math.round(amount * mode.cost);
      if (charge > s.balance) return err(400, 'ERR_IPB', 'insufficient balance');
      const { book, forced } = pickBook(mode, s.id);
      if (!book || !Array.isArray(book.events) || book.events.length === 0) {
        violate(s.id, 'EMPTY_BOOK', `mode ${mode.name} served a book with no events`);
        return err(500, 'ERR_GEN', 'empty book');
      }
      s.balance -= charge;
      const pm = Number(book.payoutMultiplier) || 0;
      const payout = Math.round((amount * pm) / 100);
      const d = describeBook(book);
      const r = {
        betID: ++betSeq,
        amount,
        cost: mode.cost,
        payout,
        payoutMultiplier: pm,
        mode: mode.name,
        event: null,
        state: book.events,
        bookId: book.id,
        rounds: d.rounds,
        starts: d.starts,
        active: !(pm === 0 && !autoEndOff.has(mode.name.toLowerCase())),
        startedAt: now(),
        events: [],
        endedAt: null,
      };
      if (r.active) s.active = r;
      else {
        r.endedAt = now();
        s.last = r;
      }
      return {
        status: 200,
        body: { balance: { amount: s.balance, currency }, round: roundView(r) },
        note: `book ${book.id}${forced ? ` (forced ${forced})` : ''}, ${d.rounds} round(s), pays ${pm / 100}×, ${r.active ? 'active' : 'auto-closed'}`,
        round: r,
      };
    },
    'POST /wallet/end-round'(body) {
      const s = sessions.get(body.sessionID);
      if (!s || !s.authenticated) {
        violate(body.sessionID, 'CALL_BEFORE_AUTH', '/wallet/end-round before /wallet/authenticate');
        return err(400, 'ERR_IS', 'invalid session');
      }
      if (!s.active) {
        violate(s.id, 'END_ROUND_NO_ACTIVE', 'end-round with no active round');
        return err(400, 'ERR_VAL', 'no active round');
      }
      if (minRoundMs > 0 && now() - s.active.startedAt < minRoundMs) {
        violate(s.id, 'END_ROUND_TOO_EARLY', `end-round ${now() - s.active.startedAt}ms after play; minimumRoundDuration is ${minRoundMs}ms`);
        return err(400, 'ERR_VAL', 'round ended before the minimum round duration');
      }
      const r = s.active;
      s.balance += r.payout;
      r.active = false;
      r.endedAt = now();
      s.last = r;
      s.active = null;
      return { status: 200, body: { balance: { amount: s.balance, currency } }, note: `round ${r.betID} ended, credited ${r.payout}` };
    },
    'POST /bet/event'(body) {
      const s = sessions.get(body.sessionID);
      if (!s || !s.authenticated) {
        violate(body.sessionID, 'CALL_BEFORE_AUTH', '/bet/event before /wallet/authenticate');
        return err(400, 'ERR_IS', 'invalid session');
      }
      if (!s.active) {
        violate(s.id, 'EVENT_NO_ACTIVE', `/bet/event "${body.event}" with no active round (the round was already ended or auto-closed)`);
        return err(400, 'ERR_VAL', 'no active round');
      }
      const ev = String(body.event ?? '');
      const n = Number(ev);
      if (!/^\d+$/.test(ev) || n >= s.active.state.length) {
        violate(s.id, 'EVENT_NOT_INDEX', `/bet/event "${ev}" is not an event index of the active round (0..${s.active.state.length - 1}); resume slices by it`);
      } else if (s.active.event !== null && /^\d+$/.test(s.active.event) && n < Number(s.active.event)) {
        violate(s.id, 'EVENT_BACKWARDS', `/bet/event went back from ${s.active.event} to ${n}`);
      }
      s.active.event = ev;
      s.active.events.push(ev);
      return { status: 200, body: { event: ev } };
    },
  };

  function replay(parts) {
    const [, , , , , modeName, eventId] = parts; // ["", "bet", "replay", game, version, mode, event]
    const mode = pkg.mode(modeName);
    if (!mode) return err(404, 'ERR_VAL', `unknown mode ${modeName}`);
    const book = mode.bookById(Number(eventId));
    if (!book) return err(404, 'ERR_VAL', `no book ${eventId} in mode ${modeName}`);
    return { status: 200, body: { payoutMultiplier: (Number(book.payoutMultiplier) || 0) / 100, costMultiplier: mode.cost, state: book.events } };
  }

  function harnessState() {
    const open = [];
    for (const s of sessions.values()) {
      if (s.active) open.push({ sessionID: s.id, betID: s.active.betID, mode: s.active.mode, bookId: s.active.bookId, payout: s.active.payout, rounds: s.active.rounds, event: s.active.event, ageMs: now() - s.active.startedAt });
    }
    return {
      sessions: [...sessions.values()].map((s) => ({ sessionID: s.id, balance: s.balance, authCount: s.authCount, active: s.active ? s.active.betID : null })),
      transcript,
      violations,
      openRounds: open,
      forces,
    };
  }

  async function readBody(req) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { __invalid: text.slice(0, 200) };
    }
  }

  function send(res, status, body, type = 'application/json') {
    res.writeHead(status, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Cache-Control': 'no-store',
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  }

  function serveStatic(res, root, rel) {
    const file = path.resolve(root, '.' + decodeURIComponent(rel || '/'));
    if (!file.startsWith(path.resolve(root))) return send(res, 403, 'forbidden', 'text/plain');
    let f = file;
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, fs.readFileSync(f), MIME[path.extname(f).toLowerCase()] || 'application/octet-stream');
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method === 'OPTIONS') return send(res, 204, '');

    if (p.startsWith('/__harness/')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (p === '/__harness/state') return send(res, 200, harnessState());
      if (p === '/__harness/force') {
        forces.push({ mode: body.mode ?? null, kind: body.kind ?? null, bookId: body.bookId ?? null, sessionID: body.sessionID ?? null });
        return send(res, 200, { queued: forces.length });
      }
      if (p === '/__harness/reset') {
        sessions.clear();
        transcript.length = 0;
        violations.length = 0;
        forces.length = 0;
        return send(res, 200, { ok: true });
      }
      if (p === '/__harness/classes') {
        const mode = pkg.mode(url.searchParams.get('mode') || 'base');
        if (!mode) return send(res, 404, { error: 'unknown mode' });
        const c = classes(mode);
        return send(res, 200, Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.slice(0, 20).map((i) => mode.book(i).id)])));
      }
      return send(res, 404, { error: 'unknown harness call' });
    }

    if (req.method === 'GET' && p.startsWith('/bet/replay/')) {
      const out = replay(p.split('/'));
      log({ sessionID: null, call: 'GET /bet/replay', path: p, status: out.status });
      return send(res, out.status, out.body);
    }

    const key = `${req.method} ${p}`;
    if (handlers[key]) {
      const body = await readBody(req);
      const out = handlers[key](body);
      log({
        sessionID: body.sessionID ?? null,
        call: key.slice(5),
        req: { ...body, sessionID: undefined },
        status: out.status,
        error: out.status >= 400 ? out.body.error : undefined,
        note: out.note,
        round: out.round ? { betID: out.round.betID, mode: out.round.mode, bookId: out.round.bookId, rounds: out.round.rounds, starts: out.round.starts, payout: out.round.payout, active: out.round.active } : undefined,
      });
      return send(res, out.status, out.body);
    }

    if (req.method === 'GET' && p.startsWith('/reference/')) return serveStatic(res, REFERENCE_GAME_DIR, p.slice('/reference'.length));
    if (req.method === 'GET' && p.startsWith('/game/') && o.gameDir) return serveStatic(res, o.gameDir, p.slice('/game'.length));
    return send(res, 404, { error: 'ERR_VAL', message: `no route ${key}` });
  }

  const listener = (q, s) => handle(q, s).catch((e) => send(s, 500, { error: 'ERR_GEN', message: String(e) }));
  const server = o.tls ? https.createServer(selfSignedCert(), listener) : http.createServer(listener);
  // With TLS the game talks https (as every Stake build does); the harness's own Node clients
  // (bot, browser grader) use a plain-http twin of the same server, so nothing has to trust the
  // throwaway certificate.
  const control = o.tls ? http.createServer(listener) : null;

  return {
    server,
    tls: !!o.tls,
    state: harnessState,
    sessions,
    async listen(port = 0, host = '127.0.0.1') {
      await new Promise((r) => server.listen(port, host, r));
      const a = server.address();
      this.port = a.port;
      this.host = `${host}:${a.port}`;
      this.origin = `${o.tls ? 'https' : 'http'}://${this.host}`;
      this.controlOrigin = this.origin;
      if (control) {
        await new Promise((r) => control.listen(0, host, r));
        this.controlOrigin = `http://${host}:${control.address().port}`;
      }
      return this;
    },
    async close() {
      for (const srv of [server, control].filter(Boolean)) {
        srv.closeAllConnections?.();
        await new Promise((r) => srv.close(() => r()));
      }
    },
    /** The URL Stake would open the game at. `base` is the game's page URL. */
    launchUrl(base, params = {}) {
      const u = new URL(base);
      const q = { sessionID: 'harness', rgs_url: this.host, lang: 'en', currency, device: 'desktop', social: 'false', ...params };
      for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      return u.toString();
    },
  };
}
