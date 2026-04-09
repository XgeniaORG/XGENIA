/**
 * Local mock of Stake Engine RGS endpoints used by the stake-engine TS client.
 *
 * Goals:
 * - Be "realistic enough" for frontend integration: bet validation, round lifecycle, random outcomes,
 *   minimum round duration, and a stable response shape.
 * - Stay compatible with the stake-engine TS client:
 *   - POST /wallet/authenticate
 *   - POST /wallet/play
 *   - POST /wallet/end-round
 *   - POST /wallet/balance
 *   - POST /bet/event
 *
 * Usage:
 *   node scripts/mock-rgs-server.mjs --port 5050
 *
 * Optional flags:
 *   --seed 123                 Deterministic RNG seed
 *   --currency USD             Balance currency
 *   --balance 100              Initial balance (decimal), converted to API amount
 *   --enforce-bet-levels true  Enforce config.betLevels on /wallet/play (default true)
 *   --min-round-ms 0           Minimum duration before EndRound is allowed (default 0)
 *
 * Local viewer URL:
 *   ?sessionID=test123&rgs_url=localhost:5050
 * and set node protocol to "http".
 */

import http from 'node:http';
import { URL } from 'node:url';

function parseArgs(argv) {
  const out = {
    port: 5050,
    seed: 1,
    currency: 'USD',
    balanceDecimal: 100,
    enforceBetLevels: true,
    minRoundMs: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[i + 1]);
    if (a === '--seed') out.seed = Number(argv[i + 1]);
    if (a === '--currency') out.currency = String(argv[i + 1] || 'USD');
    if (a === '--balance') out.balanceDecimal = Number(argv[i + 1]);
    if (a === '--enforce-bet-levels') out.enforceBetLevels = String(argv[i + 1]).toLowerCase() !== 'false';
    if (a === '--min-round-ms') out.minRoundMs = Number(argv[i + 1]);
  }
  if (!Number.isFinite(out.port) || out.port <= 0) out.port = 5050;
  if (!Number.isFinite(out.seed)) out.seed = 1;
  if (!Number.isFinite(out.balanceDecimal) || out.balanceDecimal < 0) out.balanceDecimal = 100;
  if (!Number.isFinite(out.minRoundMs) || out.minRoundMs < 0) out.minRoundMs = 0;
  return out;
}

const args = parseArgs(process.argv.slice(2));
const { port } = args;

const API_MULTIPLIER = 1_000_000;

function toApiAmount(decimal) {
  return Math.round(decimal * API_MULTIPLIER);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Simple deterministic PRNG (xorshift32)
function makeRng(seed) {
  let x = (seed >>> 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    // 0..1
    return ((x >>> 0) / 0xffffffff);
  };
}

function hashStringToSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** @type {Map<string, { balance: {amount:number,currency:string}, round: any | null, config: any, jurisdiction: any, settings: any }>} */
const sessions = new Map();

function getOrCreateSession(sessionID) {
  if (!sessions.has(sessionID)) {
    sessions.set(sessionID, {
      balance: { amount: toApiAmount(args.balanceDecimal), currency: args.currency }, // default $100.00
      round: null,
      config: {
        minBet: 100_000, // $0.10
        maxBet: 10_000_000, // $10.00
        stepBet: 100_000, // $0.10 increments
        defaultBetLevel: 1_000_000, // $1.00
        betLevels: [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000],
      },
      jurisdiction: {
        socialCasino: false,
        disabledFullscreen: false,
        disabledTurbo: false,
        disabledSuperTurbo: false,
        disabledAutoplay: false,
        disabledSlamstop: false,
        disabledSpacebar: false,
        disabledBuyFeature: false,
        displayNetPosition: true,
        displayRTP: true,
        displaySessionTimer: false,
        minimumRoundDuration: args.minRoundMs,
      },
      settings: {
        enforceBetLevels: args.enforceBetLevels,
      },
    });
  }
  return sessions.get(sessionID);
}

function json(res, status, body) {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    // CORS (dev-friendly)
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: 'Not found' });
}

function badRequest(res, message) {
  json(res, 400, { error: message || 'Bad request' });
}

function conflict(res, message, extra) {
  json(res, 409, { error: message || 'Conflict', ...(extra || {}) });
}

function paymentRequired(res, message) {
  json(res, 402, { error: message || 'Insufficient balance' });
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function nextBetId() {
  return Math.floor(Math.random() * 1_000_000_000);
}

function pickFromWeighted(rng, weighted) {
  const total = weighted.reduce((a, b) => a + b.weight, 0);
  const r = rng() * total;
  let acc = 0;
  for (const item of weighted) {
    acc += item.weight;
    if (r <= acc) return item.value;
  }
  return weighted[weighted.length - 1].value;
}

function computePayoutMultiplier(rng, mode) {
  // A more realistic-ish distribution:
  // - Many dead spins
  // - Some small wins
  // - Rare big wins
  const base = [
    { value: 0, weight: 72.0 },
    { value: 0.5, weight: 6.0 },
    { value: 1, weight: 12.0 },
    { value: 2, weight: 6.0 },
    { value: 5, weight: 2.5 },
    { value: 10, weight: 1.0 },
    { value: 25, weight: 0.4 },
    { value: 50, weight: 0.1 },
  ];

  const bonus = [
    { value: 0, weight: 55.0 },
    { value: 1, weight: 12.0 },
    { value: 2, weight: 12.0 },
    { value: 5, weight: 10.0 },
    { value: 10, weight: 6.0 },
    { value: 25, weight: 3.5 },
    { value: 50, weight: 1.2 },
    { value: 100, weight: 0.3 },
  ];

  const dist = mode === 'bonus' ? bonus : base;
  return pickFromWeighted(rng, dist);
}

function generateRoundState(rng, amount, payoutMultiplier) {
  // Keep a simple, consistent schema for your frontend animations/state machine.
  // This is NOT Stake's real event schema; it's just a plausible payload for UI testing.
  const reels = 5;
  const rows = 3;
  const stops = Array.from({ length: reels }, () => Math.floor(rng() * 10));
  const grid = Array.from({ length: reels }, (_r, r) =>
    Array.from({ length: rows }, (_c, c) => (stops[r] + c) % 10),
  );

  const wins =
    payoutMultiplier > 0
      ? [
          {
            kind: 'lineWin',
            line: 1,
            multiplier: payoutMultiplier,
            amount: Math.round(amount * payoutMultiplier),
            positions: [
              { reel: 0, row: 0 },
              { reel: 1, row: 1 },
              { reel: 2, row: 2 },
            ],
          },
        ]
      : [];

  const events = [
    { type: 'spinStart' },
    { type: 'reelsStop', stops },
    { type: 'symbols', grid },
    ...(wins.length ? [{ type: 'wins', wins }] : [{ type: 'noWin' }]),
    { type: 'roundReadyToEnd' },
  ];

  return {
    schema: 'mock-rgs/v2',
    reels,
    rows,
    stops,
    grid,
    wins,
    events,
  };
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // simple health check for dev
  if (req.method === 'GET' && path === '/health') {
    json(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'POST') return notFound(res);

  const body = await readJson(req);
  if (body === null) {
    badRequest(res, 'Invalid JSON body');
    return;
  }

  // Common: sessionID
  const sessionID = body.sessionID;
  if (!sessionID || typeof sessionID !== 'string') {
    badRequest(res, 'Missing sessionID');
    return;
  }

  const s = getOrCreateSession(sessionID);

  // --- Routes ---
  if (path === '/wallet/authenticate') {
    console.log(`[mock-rgs] authenticate session=${sessionID} lang=${body.language || ''}`);
    json(res, 200, {
      balance: s.balance,
      config: { ...s.config, jurisdiction: s.jurisdiction },
      // If there is an active round, return it so the frontend can resume.
      round: s.round && s.round.active ? s.round : null,
    });
    return;
  }

  if (path === '/wallet/balance') {
    console.log(`[mock-rgs] balance session=${sessionID}`);
    json(res, 200, { balance: s.balance });
    return;
  }

  if (path === '/wallet/play') {
    const amount = body.amount;
    const mode = body.mode || 'base';
    console.log(`[mock-rgs] play session=${sessionID} amount=${amount} mode=${mode}`);

    if (s.round && s.round.active) {
      return conflict(res, 'A round is already active', { round: s.round });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return badRequest(res, 'Invalid amount');
    }
    // Validate bet limits
    if (amount < s.config.minBet || amount > s.config.maxBet) {
      return badRequest(res, `Bet amount must between min bet (${s.config.minBet}) and max bet (${s.config.maxBet})`);
    }
    // Validate step
    if (amount % s.config.stepBet !== 0) {
      return badRequest(res, `Bet amount must be a multiple of ${s.config.stepBet}`);
    }
    // Optionally enforce bet levels
    if (s.settings.enforceBetLevels) {
      if (!s.config.betLevels.includes(amount)) {
        return badRequest(res, `Bet amount must be one of the following levels: ${s.config.betLevels.join(', ')}`);
      }
    }
    if (amount > s.balance.amount) {
      return paymentRequired(res, 'Insufficient balance');
    }

    // Debit bet
    s.balance = { ...s.balance, amount: s.balance.amount - amount };

    // Create an active round (server-side)
    const rng = makeRng((hashStringToSeed(sessionID) ^ args.seed ^ nextBetId()) >>> 0);
    const payoutMultiplier = computePayoutMultiplier(rng, mode);
    const payout = payoutMultiplier > 0 ? Math.round(amount * payoutMultiplier) : 0;
    const betID = nextBetId();
    s.round = {
      betID,
      amount,
      payout,
      payoutMultiplier,
      active: true,
      mode,
      event: null,
      state: generateRoundState(rng, amount, payoutMultiplier),
      createdAt: Date.now(),
    };

    json(res, 200, {
      balance: s.balance,
      round: s.round,
    });
    return;
  }

  if (path === '/wallet/end-round') {
    console.log(`[mock-rgs] end-round session=${sessionID}`);

    if (!s.round || !s.round.active) {
      return conflict(res, 'No active round');
    }
    // Enforce minimum round duration (simulates jurisdiction rules)
    const minMs = Number(s.jurisdiction.minimumRoundDuration) || 0;
    const elapsed = Date.now() - (s.round.createdAt || Date.now());
    if (minMs > 0 && elapsed < minMs) {
      return conflict(res, 'Minimum round duration not met', { remainingMs: clamp(minMs - elapsed, 0, minMs) });
    }

    // Credit payout and end round
    const payout = s.round.payout || 0;
    if (payout > 0) {
      s.balance = { ...s.balance, amount: s.balance.amount + payout };
    }
    s.round = { ...s.round, active: false };
    // In real RGS, round might be cleared; we keep it for inspection.

    json(res, 200, { balance: s.balance });
    return;
  }

  if (path === '/bet/event') {
    const event = body.event;
    console.log(`[mock-rgs] event session=${sessionID} event=${event}`);

    if (typeof event !== 'string') {
      badRequest(res, 'Invalid event');
      return;
    }

    // Store on round if active
    if (s.round && s.round.active) {
      s.round = { ...s.round, event };
    }

    json(res, 200, { event });
    return;
  }

  notFound(res);
});

server.listen(port, () => {
  console.log(`[mock-rgs] listening on http://localhost:${port}`);
  console.log(`[mock-rgs] try: http://localhost:8547?sessionID=test123&rgs_url=localhost:${port}`);
  console.log(
    `[mock-rgs] settings: currency=${args.currency} balance=${args.balanceDecimal} enforceBetLevels=${args.enforceBetLevels} minRoundMs=${args.minRoundMs} seed=${args.seed}`,
  );
});


