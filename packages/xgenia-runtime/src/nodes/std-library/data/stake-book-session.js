'use strict';

// Stake Book Session — the game's maths, answered from a Stake Engine book.
// --------------------------------------------------------------------------
// WHY (2026-11-09). On XRGS a game asks its Math Component once per round: Spin → one answer, the next free
// spin → another, and the server remembers the feature in between. Stake Engine (now "Engine") has no game
// server: ONE /wallet/play returns ONE pre-played book — the paid round AND every free round, pick and retrigger
// it leads to — and the game must show all of it, then call /wallet/end-round. A winning round is not paid,
// and every next bet is refused (ERR_BE), until it does. XGENIA games wired their free-spin loop to a new paid
// play per spin, or never ended the round: the "stuck bonus".
//
// This module makes Stake look like XRGS to the game graph. The Aggregator (aggregatornode.js, transport
// "stake") hands it each trigger its Math Component used to receive; it answers:
//   - a trigger with no book open      → /wallet/play (amount = the game's bet, mode = the game's bet mode),
//                                        and the book's first round;
//   - any trigger while a book is open → the book's NEXT round, locally, no network — so the free spins the
//                                        game fires one by one are the free spins Stake already paid for;
//   - the last round of the book       → its answer at once, then /wallet/end-round in the background (after
//                                        jurisdiction.minimumRoundDuration); the next play waits for it.
// Each round's answer is the book event's `data`: what XRGS stake-books.ts recorded as the Math Component's
// outputs for that round, so the game's graph cannot tell the difference. Money in it was played at the
// export bet and is scaled to the player's bet here (config.exportBet); the round's win is taken from the
// event's winMultiplier × the player's bet, which is exact.
//
// Resume: /wallet/authenticate hands back a round left active (tab closed mid-bonus). The next trigger replays
// that book FROM ITS FIRST ROUND, at no charge, and ends it — the simplest resume that can never resume on the
// wrong event (`resumePending` tells the game, so it can fire Spin by itself). Progress is still saved with
// /bet/event at every round of a multi-round book, as Stake's reviewers check for it.
// Replay (?replay=true): GET /bet/replay/{game}/{version}/{mode}/{event}, played the same way, and NO wallet call.
//
// One session per page, kept on globalThis and keyed by rgs_url + sessionID read the first time: a game that
// navigates with pushState loses its query string, and a client keyed by location.href (the old Stake nodes)
// became a new, unauthenticated client holding no round.
//
// Never silent: a book this module cannot play (Stake-standard events with no `data`, an empty state), a bet
// that is not one of Stake's bet levels, an RGS error — each is thrown as a StakeError with Stake's code, and
// the Aggregator fires `failure` with the message on `error`.

const API_MULTIPLIER = 1000000;
const ROUND_TYPES = { round: 1, featureRound: 1, choiceRound: 1 };

class StakeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StakeError';
    this.code = code;
  }
}

function roundPositions(events) {
  const out = [];
  for (let i = 0; i < events.length; i++) if (events[i] && ROUND_TYPES[events[i].type]) out.push(i);
  return out;
}

function hostOf(raw) {
  return String(raw || '')
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/+$/, '');
}

function protocolFor(host, pageProtocol) {
  // Stake serves its RGS over https only; a local emulator may be plain http.
  return pageProtocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host.split('/')[0]) ? 'http' : 'https';
}

function readLaunch(search) {
  const q = new URLSearchParams(search || '');
  return {
    sessionID: q.get('sessionID') || '',
    rgsUrl: hostOf(q.get('rgs_url')),
    lang: q.get('lang') || 'en',
    currency: q.get('currency') || '',
    social: q.get('social') === 'true',
    replay: q.get('replay') === 'true',
    game: q.get('game') || '',
    version: q.get('version') || '',
    mode: q.get('mode') || 'base',
    event: q.get('event') || '',
    amount: Number(q.get('amount')) || API_MULTIPLIER
  };
}

function isMoneyNumber(v) {
  return typeof v === 'number' && isFinite(v);
}

/**
 * @param {object} deps
 * @param {Function} deps.fetch
 * @param {{search: string, protocol: string}} deps.location
 * @param {(fn: Function, ms: number) => any} [deps.setTimeout]
 * @param {() => number} [deps.now]
 */
function createStakeBookSession(deps) {
  const fetchFn = deps.fetch;
  const launch = readLaunch(deps.location && deps.location.search);
  const later = deps.setTimeout || setTimeout;
  const now = deps.now || Date.now;
  const base = launch.rgsUrl ? protocolFor(launch.rgsUrl, deps.location && deps.location.protocol) + '://' + launch.rgsUrl : '';

  const s = {
    launch,
    auth: null, // Promise of the authenticate answer
    config: null,
    balance: null, // API units
    currency: launch.currency,
    book: null, // { round, positions, cursor, betGame, startedAt, resumed }
    resumable: null, // an active round authenticate handed back
    ending: null, // Promise of the background end-round
    endFailed: null,
    lastError: null
  };

  async function call(path, body) {
    if (!base) throw new StakeError('NO_RGS_URL', 'The launch URL has no rgs_url: open the game the way Stake does (?sessionID=…&rgs_url=…).');
    let res;
    try {
      res = await fetchFn(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ sessionID: launch.sessionID }, body || {})) });
    } catch (e) {
      throw new StakeError('NETWORK', 'Stake RGS unreachable (' + path + '): ' + ((e && e.message) || e));
    }
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    if (!res.ok) {
      const code = (json && json.error) || 'HTTP_' + res.status;
      throw new StakeError(code, 'Stake ' + path + ' refused: ' + code + (json && json.message ? ' — ' + json.message : ''));
    }
    return json || {};
  }

  function authenticate() {
    if (launch.replay) return Promise.resolve(null);
    if (!s.auth) {
      s.auth = call('/wallet/authenticate', { language: launch.lang }).then(
        (a) => {
          s.config = a.config || {};
          if (a.balance) {
            s.balance = a.balance.amount;
            s.currency = a.balance.currency || s.currency;
          }
          if (a.round && a.round.active && Array.isArray(a.round.state) && a.round.state.length) s.resumable = a.round;
          return a;
        },
        (e) => {
          s.auth = null; // a failed authenticate is asked again next time, never cached
          throw e;
        }
      );
    }
    return s.auth;
  }

  function gameUnits(cfg) {
    // How many of the game's money units make one unit of the currency (1 when the game counts dollars, 100 cents).
    const u = Number(cfg && cfg.gameUnitsPerCurrencyUnit);
    return u > 0 ? u : 1;
  }
  const toGame = (api, cfg) => (api / API_MULTIPLIER) * gameUnits(cfg);
  const toApi = (game, cfg) => Math.round((game / gameUnits(cfg)) * API_MULTIPLIER);

  async function endRound() {
    const book = s.book;
    s.book = null;
    if (!book || !book.round.active || book.replay) return;
    const min = Number(s.config && s.config.jurisdiction && s.config.jurisdiction.minimumRoundDuration) || 0;
    const wait = min - (now() - book.startedAt);
    if (wait > 0) await new Promise((r) => later(r, wait));
    const r = await call('/wallet/end-round', {});
    if (r.balance) s.balance = r.balance.amount;
  }

  async function settlePrevious() {
    if (s.ending) {
      const p = s.ending;
      s.ending = null;
      try {
        await p;
      } catch (e) {
        // One more try before the next play: an unended win blocks every bet (ERR_BE).
        await call('/wallet/end-round', {});
      }
    }
  }

  function openBook(round, betGame, opts) {
    const state = Array.isArray(round.state) ? round.state : [];
    if (!state.length) throw new StakeError('EMPTY_BOOK', 'Stake answered a round with no events (round.state is empty).');
    const positions = roundPositions(state);
    if (!positions.length) {
      throw new StakeError('NOT_AN_XGENIA_BOOK', 'This round\'s events are not XGENIA round events (round/featureRound with data): its books were not exported by XGENIA, so this game cannot play them.');
    }
    s.book = Object.assign({ round, positions, cursor: 0, betGame, startedAt: now() }, opts || {});
    return s.book;
  }

  async function play(payload, cfg) {
    const betField = cfg.betField;
    const betGame = Number(betField ? payload[betField] : NaN);
    if (!isMoneyNumber(betGame) || betGame <= 0) throw new StakeError('NO_BET', 'The game sent no bet' + (betField ? ' on "' + betField + '"' : ' (no betField configured)') + '.');
    const amount = toApi(betGame, cfg);
    const levels = (s.config && s.config.betLevels) || [];
    if (levels.length && levels.indexOf(amount) === -1) {
      throw new StakeError('BET_NOT_ON_LEVELS', 'Bet ' + betGame + ' is not one of Stake\'s bet levels (' + levels.map((l) => toGame(l, cfg)).join(', ') + '). Build the bet selector from the stakeBetLevels output.');
    }
    const gameMode = cfg.modeField ? payload[cfg.modeField] : null;
    const modes = cfg.modes || {};
    const mode = gameMode != null && gameMode !== '' ? (modes[gameMode] || String(gameMode)) : (modes.default || 'base');
    // Engine's authenticate lists the modes the uploaded maths has (config.gameModes, seen on rgsd.engine.io
    // 2026-11-09). An unknown mode is refused there as "invalid amount" — say what is really wrong instead.
    const offered = (s.config && Array.isArray(s.config.gameModes) ? s.config.gameModes : []).map((m) => String(m && m.mode).toLowerCase());
    if (offered.length && offered.indexOf(String(mode).toLowerCase()) === -1) {
      throw new StakeError('UNKNOWN_MODE', 'Bet mode "' + mode + '" is not in the maths uploaded to Stake (it has: ' + offered.join(', ') + '). Offer only those modes.');
    }
    const r = await call('/wallet/play', { amount, mode });
    if (r.balance) s.balance = r.balance.amount;
    return openBook(r.round, betGame, { mode });
  }

  async function replay(cfg) {
    const l = launch;
    let res;
    try {
      res = await fetchFn(base + '/bet/replay/' + [l.game, l.version, l.mode, l.event].map(encodeURIComponent).join('/'));
    } catch (e) {
      throw new StakeError('NETWORK', 'Stake replay unreachable: ' + ((e && e.message) || e));
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new StakeError(j.error || 'HTTP_' + res.status, 'Stake replay refused: ' + (j.message || j.error || res.status));
    const betGame = toGame(l.amount, cfg);
    return openBook({ state: j.state, payoutMultiplier: j.payoutMultiplier, costMultiplier: j.costMultiplier, amount: l.amount, payout: Math.round(j.payoutMultiplier * l.amount), active: false, betID: null }, betGame, { replay: true, mode: l.mode });
  }

  function answer(book, cfg) {
    const pos = book.positions[book.cursor];
    const ev = book.round.state[pos];
    book.cursor++;
    const last = book.cursor >= book.positions.length;
    const ratio = Number(cfg.exportBet) > 0 ? book.betGame / Number(cfg.exportBet) : 1;
    const moneyPaths = (cfg.moneyFields || []).concat(cfg.winField ? [cfg.winField] : []);
    const data = ev && ev.data && typeof ev.data === 'object' ? ev.data : {};
    // A copy: the book's own data stays as Stake sent it (resume and replay read it again).
    const body = JSON.parse(JSON.stringify(data));
    // Money fields may be nested ("finalResult.totalWinnings", as real book data is): scaled from the export bet.
    for (const path of moneyPaths) {
      const keys = String(path).split('.');
      let at = body;
      for (let i = 0; i < keys.length - 1 && at && typeof at === 'object'; i++) at = at[keys[i]];
      const last = keys[keys.length - 1];
      if (at && typeof at === 'object' && isMoneyNumber(at[last])) at[last] = at[last] * ratio;
    }
    if (cfg.winField && isMoneyNumber(ev && ev.winMultiplier)) body[cfg.winField] = ev.winMultiplier * book.betGame;

    const paidGame = toGame(book.round.payout || 0, cfg);
    body.__stake = {
      roundIndex: book.cursor - 1,
      rounds: book.positions.length,
      roundsLeft: book.positions.length - book.cursor,
      inFeature: !last,
      roundComplete: last,
      resumed: !!book.resumed,
      replay: !!book.replay,
      mode: book.mode || null
    };
    if (!book.replay) {
      const balanceNow = s.balance == null ? undefined : toGame(s.balance, cfg);
      body.__rgs = {
        // The win is credited by end-round; the balance the game shows after the last round already includes it.
        balance_after: balanceNow === undefined ? undefined : last && book.round.active ? balanceNow + paidGame : balanceNow,
        win_amount: last ? paidGame : undefined,
        round_id: book.round.betID
      };
    }
    return { body, pos, last };
  }

  async function request(trigger, payload, cfg) {
    cfg = cfg || {};
    payload = payload || {};
    await authenticate();
    if (!s.book && (cfg.startupTriggers || []).indexOf(trigger) !== -1) return { __stake: { startup: true } };

    let book = s.book;
    if (!book) {
      await settlePrevious();
      if (launch.replay) book = await replay(cfg);
      else if (s.resumable) {
        const r = s.resumable;
        s.resumable = null;
        book = openBook(r, toGame(r.amount, cfg), { resumed: true, mode: r.mode, startedAt: now() });
      } else book = await play(payload, cfg);
    }

    const { body, pos, last } = answer(book, cfg);
    // Progress for Stake's resume and its reviewers: the event index of every round of a multi-round book.
    if (book.round.active && !book.replay && book.positions.length > 1) {
      try {
        await call('/bet/event', { event: String(pos) });
      } catch (e) {
        s.lastError = e;
      }
    }
    if (last) {
      if (book.round.active && !book.replay) {
        s.ending = endRound();
        s.ending.catch((e) => {
          s.lastError = e;
        });
      } else s.book = null;
    }
    return body;
  }

  return {
    request,
    authenticate,
    /** What the game needs from Stake before its first round. */
    async info(cfg) {
      await authenticate();
      const levels = (s.config && s.config.betLevels) || [];
      return {
        stakeBetLevels: levels.map((l) => toGame(l, cfg || {})),
        stakeDefaultBet: s.config && s.config.defaultBetLevel ? toGame(s.config.defaultBetLevel, cfg || {}) : undefined,
        rgsBalance: s.balance == null ? undefined : toGame(s.balance, cfg || {}),
        stakeCurrency: s.currency,
        stakeSocial: launch.social,
        stakeReplay: launch.replay,
        stakeModes: s.config && Array.isArray(s.config.gameModes) ? s.config.gameModes.map((m) => ({ mode: m.mode, cost: m.costMultiplier })) : undefined,
        stakeResumePending: !!s.resumable
      };
    },
    /** For tests and the inspector. */
    _state: s
  };
}

/** One session per page (see the header): the first launch URL wins, later lookups reuse it. */
function stakeBookSessionForPage(deps) {
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  const launch = readLaunch(deps.location && deps.location.search);
  const key = launch.rgsUrl ? launch.rgsUrl + '|' + launch.sessionID : null;
  g.__xgeniaStakeSessions = g.__xgeniaStakeSessions || {};
  if (key && g.__xgeniaStakeSessions[key]) return g.__xgeniaStakeSessions[key];
  if (!key) {
    // The query string is gone (in-app navigation): reuse the session the page opened with.
    const any = Object.keys(g.__xgeniaStakeSessions)[0];
    if (any) return g.__xgeniaStakeSessions[any];
  }
  const session = createStakeBookSession(deps);
  if (key) g.__xgeniaStakeSessions[key] = session;
  return session;
}

/** `stakeConfig` parameter of an Aggregator: JSON text, or an object. Bad JSON is a loud error, not a default. */
function parseStakeConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new StakeError('BAD_STAKE_CONFIG', 'The Aggregator\'s Stake Config is not JSON: ' + e.message);
  }
}

module.exports = { createStakeBookSession, stakeBookSessionForPage, parseStakeConfig, StakeError, roundPositions, API_MULTIPLIER };
