'use strict';

// XRGS bet replay, for a game published from the editor.
// --------------------------------------------------------
// WHY (2026-11-11). XRGS can share any finished round as a link: the game's own published page opened with
// `?replay=true&event=<token>&token=<token>&rgs_url=…&game=…&version=…&mode=…` (and optionally currency, amount,
// lang, social, demo, device — Stake Engine's replay parameters). Whoever opens it — a player showing off a win,
// support answering a dispute, a reviewer — must watch THAT round play on the game's own screen, with no login
// and no session. The server side is live (XRGS supabase/functions/replay, docs/STUDIO_GUIDE.md "Bet replay").
// Until now this runtime ignored `replay=true`: the link opened a normal game that adopted no session, made up a
// guest one, and took bets. That is the one thing a replay link must never do.
//
// What a replay page does here, and nothing else:
//   - detects `replay=true` at boot (bootReplayMode, from xgenia-runtime.js) and STAYS a replay page for its
//     whole life, even after a pushState that drops the query string;
//   - never adopts or invents a session (rgs-play-context.js asks isReplayPage()), never calls /rgs-fn, never
//     calls an authenticated endpoint (rgs-config.js refuses the cashier/player nodes; a fetch guard refuses
//     any RGS function, RPC or auth call that is not the replay read itself — defence in depth for nodes that
//     build their own URLs, the private pro-nodes' __jackpots / __leaderboard among them);
//   - fetches `GET {rgs}/replay/{token}` with no credentials, where {rgs} is the RGS THIS GAME was published
//     against (the functions base of its Aggregators' /rgs-fn URLs). An `rgs_url` naming another host is
//     ignored and logged: a crafted link must not be able to feed outcomes from a server of its choosing into
//     a game's screen. Unknown, revoked and expired tokens are a plain 404 → the error state;
//   - answers the game's Aggregator triggers from the replay's frames, in order: each frame's
//     `component_data` is exactly what that round's /rgs-fn call returned to the output ports, so it goes
//     through the same applyOutputs a live response does, and the frame's `state` comes out on
//     `replayFrameState`. A trigger outside a playing replay is REFUSED (failure + error), never sent;
//   - shows a loader, then a Play button, then Play Again, or an error — with the bet (and the real cost when
//     the mode costs more than one bet) and the win. No balance, and no way into real play.
//
// Rejected: answering every Aggregator trigger from the frames at all times. Then the game's Spin button would
// "play" the replay with whatever bet the player dialled, and a page that cannot tell a replay from a game would
// look like one that takes bets. The replay starts from Play; a trigger before it, or after the last frame, is
// refused.
//
// How a frame-0 trigger arrives: Play fires `replayPlay` on every Aggregator (wire it to the game's spin so the
// round starts with its own animation). A game that has not wired it still plays: if no trigger has asked for
// the first frame shortly after Play, it is pushed into the first Aggregator as its response. Later frames (free
// spins, bonus rounds) are answered when the game's own feature loop fires its triggers, as it does live.
//
// Pure apart from the DOM view and the fetch guard, both injectable: test/rgs-replay.test.js drives it with a
// stubbed fetch and a recording view.

const STATES = { LOADING: 'LOADING', READY: 'READY', PLAYING: 'PLAYING', ENDED: 'ENDED', ERROR: 'ERROR' };

const CODES = {
  NOT_FOUND: 'REPLAY_NOT_FOUND',
  MISSING_TOKEN: 'REPLAY_MISSING_TOKEN',
  UNAVAILABLE: 'REPLAY_UNAVAILABLE',
  INVALID: 'REPLAY_INVALID',
  WRONG_GAME: 'REPLAY_WRONG_GAME',
  NO_RGS: 'REPLAY_NO_RGS',
  NO_BETTING: 'REPLAY_NO_BETTING'
};

// The share token XRGS issues: 32 random bytes, base64url, 43 characters (round-replay.ts looksLikeReplayToken).
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const SEGMENT = /^[A-Za-z0-9_.:-]{1,100}$/;
const FETCH_TIMEOUT_MS = 10000;
/** How long after Play a game has to ask for the first frame itself before it is pushed in. */
const START_GRACE_MS = 400;
/** How long after boot a replay page waits for an Aggregator to name its RGS. */
const NO_RGS_TIMEOUT_MS = 8000;

const SESSION_KEY = '__xgeniaRgsReplaySession';
const GUARD_KEY = '__xgeniaRgsReplayFetchGuard';

class ReplayRefused extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ReplayRefused';
    this.code = code || CODES.NO_BETTING;
  }
}

function flag(v) {
  return v !== null && v !== undefined && /^(true|1|yes)$/i.test(String(v).trim());
}

/**
 * The replay launch in a query string, or null when the page is not a replay (`replay` is not true).
 * `replay=true` alone makes it a replay: a missing or malformed token is `token: null` (the error state later),
 * never a fall-through into a normal game.
 */
function parseReplayLaunch(search) {
  let q;
  try {
    q = new URLSearchParams(search || '');
  } catch (e) {
    return null;
  }
  if (!flag(q.get('replay'))) return null;
  const raw = (q.get('event') || q.get('token') || '').trim();
  const seg = (k) => {
    const v = (q.get(k) || '').trim();
    return SEGMENT.test(v) ? v : null;
  };
  const amount = Number(q.get('amount'));
  const currency = (q.get('currency') || '').trim().toUpperCase();
  const lang = (q.get('lang') || '').trim();
  const device = (q.get('device') || '').trim().toLowerCase();
  const rgs = (q.get('rgs_url') || '').trim();
  return {
    token: TOKEN.test(raw) ? raw : null,
    rgsUrl: rgs && rgs.length <= 300 && !/[\s<>"']/.test(rgs) ? rgs : null,
    game: seg('game'),
    version: seg('version'),
    mode: seg('mode'),
    currency: /^[A-Z0-9]{3,8}$/.test(currency) ? currency : null,
    amount: q.get('amount') !== null && Number.isSafeInteger(amount) && amount >= 0 ? amount : null,
    lang: /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang) ? lang : null,
    device: device === 'mobile' || device === 'desktop' ? device : null,
    social: flag(q.get('social')),
    demo: flag(q.get('demo'))
  };
}

function currentSearch() {
  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.search === 'string')
      return window.location.search;
    if (typeof location !== 'undefined' && location && typeof location.search === 'string') return location.search;
  } catch (e) {
    /* no location to read */
  }
  return '';
}

// Sticky: once this page has been seen as a replay it stays one (a pushState that drops the query string must
// not turn it into a game that takes bets).
let stickyLaunch = null;

/** This page's replay launch, or null. */
function replayLaunch() {
  if (stickyLaunch) return stickyLaunch;
  const found = parseReplayLaunch(currentSearch());
  if (found) stickyLaunch = found;
  return found;
}

function isReplayPage() {
  return !!replayLaunch();
}

/**
 * The RGS a published Aggregator plays on: `https://<ref>.supabase.co/functions/v1` from
 * `…/functions/v1/rgs-fn/<game>/<function>`, plus the game slug. Null for any other URL (the compile-time
 * localhost dummy, a non-RGS endpoint).
 */
function rgsFromAggregatorUrl(url) {
  const m = /^(https?:\/\/[^?#]*?)\/rgs-fn\/([^/?#]+)\/[^/?#]+/.exec(String(url || ''));
  if (!m) return null;
  let game = m[2];
  try {
    game = decodeURIComponent(game);
  } catch (e) {
    /* keep it as written */
  }
  return { base: m[1].replace(/\/+$/, ''), game };
}

/**
 * Where the replay is read: always the game's own RGS. Returns the URL and the `rgs_url` that was IGNORED
 * because it names another host (null when there was none or it agrees).
 */
function replayFetchUrl(base, token, rgsUrl) {
  const clean = String(base).replace(/\/+$/, '');
  let ignored = null;
  if (rgsUrl) {
    try {
      const theirs = new URL(/^https?:\/\//i.test(rgsUrl) ? rgsUrl : 'https://' + rgsUrl);
      const ours = new URL(clean);
      if (theirs.host !== ours.host) ignored = rgsUrl;
    } catch (e) {
      ignored = rgsUrl;
    }
  }
  return { url: clean + '/replay/' + encodeURIComponent(token), ignoredRgsUrl: ignored };
}

// ─── Money on screen ───────────────────────────────────────────────────────────

// ISO 4217 exponents that are not 2 (XRGS _shared/currency.ts getMinorUnits). Anything else: Intl, then 2.
const MINOR_UNITS = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  CLP: 0,
  ISK: 0,
  UGX: 0,
  XAF: 0,
  XOF: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
  JOD: 3,
  TND: 3,
  LYD: 3,
  IQD: 3
};

function minorUnits(currency) {
  if (Object.prototype.hasOwnProperty.call(MINOR_UNITS, currency)) return MINOR_UNITS[currency];
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch (e) {
    return 2;
  }
}

/** Minor units → the amount a person reads. */
function toMajor(minor, currency) {
  return (Number(minor) || 0) / Math.pow(10, minorUnits(currency));
}

function formatMoney(minor, currency, lang) {
  const major = toMajor(minor, currency);
  try {
    return new Intl.NumberFormat(lang || 'en', { style: 'currency', currency }).format(major);
  } catch (e) {
    // A social-casino or made-up code Intl does not know.
    return major.toFixed(minorUnits(currency)) + ' ' + currency;
  }
}

/**
 * What the round cost and paid, as text and as numbers. `BONUS: €1.00 / REAL COST: €250.00` when the mode
 * costs more than one bet; social wording (PLAY / TOTAL / PRIZE) with `social=true`.
 */
function replaySummary(data, launch) {
  const currency = (data && typeof data.currency === 'string' && data.currency) || (launch && launch.currency) || 'EUR';
  const lang = launch && launch.lang;
  const social = !!(launch && launch.social);
  const bet = Number(data && data.bet_amount) || 0;
  const cost = Number(data && data.cost_amount) || 0;
  const win = Number(data && data.win_amount) || 0;
  const costMultiplier = Number(data && data.costMultiplier) || 1;
  const mode = (data && typeof data.mode === 'string' && data.mode) || 'base';
  const betLabel = mode !== 'base' ? mode.toUpperCase() : social ? 'PLAY' : 'BET';
  const costLabel = social ? 'TOTAL' : 'REAL COST';
  const winLabel = social ? 'PRIZE' : 'WIN';
  const betText = betLabel + ': ' + formatMoney(bet, currency, lang);
  const costText = costMultiplier > 1 ? costLabel + ': ' + formatMoney(cost, currency, lang) : null;
  return {
    currency,
    mode,
    bet: toMajor(bet, currency),
    cost: toMajor(cost, currency),
    win: toMajor(win, currency),
    costMultiplier,
    text: {
      bet: costText ? betText + ' / ' + costText : betText,
      win: winLabel + ': ' + formatMoney(win, currency, lang)
    }
  };
}

// ─── The session ───────────────────────────────────────────────────────────────

/**
 * One replay, for one page.
 * @param {object} deps
 * @param {object} deps.launch           parseReplayLaunch's answer
 * @param {Function} [deps.fetch]        fetch to read the replay with (never sent credentials)
 * @param {{render: Function}} [deps.view] what shows the loader / Play / Play Again / error
 * @param {Function} [deps.setTimeout]
 */
function createReplaySession(deps) {
  const launch = deps.launch || {};
  const later = deps.setTimeout || setTimeout;
  const view = deps.view || null;
  const s = {
    launch,
    state: STATES.LOADING,
    error: null,
    data: null,
    frames: [],
    cursor: 0,
    rgs: null,
    ignoredRgsUrl: null,
    aggregators: [],
    loading: null,
    listeners: new Set()
  };

  function render() {
    if (!view) return;
    try {
      view.render(s.state, {
        summary: s.data ? replaySummary(s.data, launch) : null,
        error: s.error,
        play: play,
        playAgain: play
      });
    } catch (e) {
      console.error('[replay] view failed:', e);
    }
  }

  function set(state) {
    s.state = state;
    render();
    for (const fn of s.listeners) {
      try {
        fn(state, s);
      } catch (e) {
        console.error('[replay] listener failed:', e);
      }
    }
  }

  function fail(code, message) {
    s.error = { code, message };
    set(STATES.ERROR);
    return null;
  }

  async function load() {
    if (!launch.token) return fail(CODES.MISSING_TOKEN, 'This replay link is incomplete: it carries no replay id.');
    const fetchFn = deps.fetch || (typeof fetch === 'function' ? fetch : null);
    if (!fetchFn) return fail(CODES.UNAVAILABLE, 'The replay could not be reached.');
    const { url, ignoredRgsUrl } = replayFetchUrl(s.rgs.base, launch.token, launch.rgsUrl);
    s.ignoredRgsUrl = ignoredRgsUrl;
    if (ignoredRgsUrl)
      console.warn(
        '[replay] rgs_url ' + ignoredRgsUrl + " is not this game's RGS; reading the replay from " + s.rgs.base
      );
    let res;
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = abort ? later(() => abort.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      // No credentials of any kind: a replay is public, and the page's cookies are none of its business.
      res = await fetchFn(url, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...(abort ? { signal: abort.signal } : {})
      });
    } catch (e) {
      return fail(CODES.UNAVAILABLE, 'The replay could not be reached. Check the connection and try again.');
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (res.status === 404)
      return fail(CODES.NOT_FOUND, 'This replay is not available. It may have been withdrawn or expired.');
    if (!res.ok) return fail(CODES.UNAVAILABLE, 'The replay could not be loaded (' + res.status + ').');
    let d;
    try {
      d = await res.json();
    } catch (e) {
      return fail(CODES.INVALID, 'The replay answer was not readable.');
    }
    const frames = d && d.state && d.state.frames;
    if (
      !d ||
      typeof d !== 'object' ||
      typeof d.payoutMultiplier !== 'number' ||
      typeof d.costMultiplier !== 'number' ||
      !Array.isArray(frames) ||
      frames.length === 0
    ) {
      return fail(CODES.INVALID, 'The replay answer was not a replay.');
    }
    const slug = d.game && typeof d.game.slug === 'string' ? d.game.slug : null;
    if (slug && s.rgs.game && slug !== s.rgs.game) return fail(CODES.WRONG_GAME, 'This replay is of another game.');
    s.data = d;
    s.frames = frames.slice().sort((a, b) => (Number(a && a.index) || 0) - (Number(b && b.index) || 0));
    set(STATES.READY);
    return d;
  }

  /**
   * An Aggregator of this page. The first one that names an RGS decides where the replay is read from and
   * starts the read; every one hears the state changes.
   */
  function attach(aggregator, url) {
    if (aggregator && s.aggregators.indexOf(aggregator) < 0) s.aggregators.push(aggregator);
    const rgs = rgsFromAggregatorUrl(url);
    if (rgs && !s.rgs) {
      s.rgs = rgs;
      s.loading = load();
    }
    return s.loading;
  }

  /** Play (and Play Again): from the first frame. */
  function play() {
    if (s.state !== STATES.READY && s.state !== STATES.ENDED) return false;
    s.cursor = 0;
    set(STATES.PLAYING);
    for (const a of s.aggregators.slice()) {
      try {
        if (typeof a.onReplayPlay === 'function') a.onReplayPlay();
      } catch (e) {
        console.error('[replay] play signal failed:', e);
      }
    }
    // A game that has not wired replayPlay to its spin: start the round for it.
    later(() => {
      if (s.state !== STATES.PLAYING || s.cursor !== 0) return;
      const first = s.aggregators[0];
      if (first && typeof first.presentReplayFrame === 'function') first.presentReplayFrame();
    }, START_GRACE_MS);
    return true;
  }

  /**
   * The answer to a trigger: the next frame, as a live /rgs-fn response body. Throws ReplayRefused outside a
   * playing replay — the bet paths of a replay page.
   */
  function next() {
    if (s.state === STATES.ENDED || (s.state === STATES.PLAYING && s.cursor >= s.frames.length)) {
      throw new ReplayRefused('This is a replay: the round has ended. Press Play Again to watch it again.');
    }
    if (s.state !== STATES.PLAYING) {
      throw new ReplayRefused(
        'This is a replay: betting is disabled.' + (s.state === STATES.READY ? ' Press Play to watch the round.' : '')
      );
    }
    if (s.cursor >= s.frames.length)
      throw new ReplayRefused('This is a replay: the round has ended. Press Play Again to watch it again.');
    const frame = s.frames[s.cursor];
    s.cursor += 1;
    return { body: frameResponse(frame), frame, last: s.cursor >= s.frames.length };
  }

  /** The Aggregator has applied a frame (outputs set, success fired). The last one ends the replay. */
  function frameShown() {
    if (s.state === STATES.PLAYING && s.cursor >= s.frames.length) set(STATES.ENDED);
  }

  function onChange(fn) {
    s.listeners.add(fn);
    return () => s.listeners.delete(fn);
  }

  return Object.assign(s, {
    attach,
    load,
    play,
    playAgain: play,
    next,
    frameShown,
    onChange,
    fail,
    render,
    summary: () => (s.data ? replaySummary(s.data, launch) : null)
  });
}

/**
 * A frame as the Aggregator receives a live answer: the component's outputs as they were, plus a round record
 * with the win and no balance (a replay knows nothing about anyone's wallet).
 */
function frameResponse(frame) {
  const data = frame && frame.component_data && typeof frame.component_data === 'object' ? frame.component_data : {};
  const body = {};
  for (const k in data) if (Object.prototype.hasOwnProperty.call(data, k)) body[k] = data[k];
  const index = Number(frame && frame.index) || 0;
  body.__rgs = { round_id: 'replay-frame-' + index, win_amount: Number(frame && frame.win_amount) || 0 };
  return body;
}

// ─── The page ──────────────────────────────────────────────────────────────────

/** The replay session of this page, made on first use (null on a page that is not a replay). */
function replaySessionForPage(deps) {
  const launch = replayLaunch();
  if (!launch) return null;
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (!g[SESSION_KEY]) {
    g[SESSION_KEY] = createReplaySession(
      Object.assign(
        {
          launch,
          fetch: typeof fetch === 'function' ? (url, init) => fetch(url, init) : null,
          view: createDomReplayView()
        },
        deps || {}
      )
    );
    g[SESSION_KEY].render();
  }
  return g[SESSION_KEY];
}

const RGS_PATH = /\/(rgs-fn|game-launch)(\/|$|\?)/;
const PROJECT_API = /\/(functions\/v1|rest\/v1|auth\/v1|storage\/v1\/object\/authenticated)(\/|$|\?)/;
const REPLAY_READ = /\/functions\/v1\/replay\/[A-Za-z0-9_-]{43}(\?|$)/;

/** True for a request a replay page must never make: an RGS function, a database RPC or an auth call. */
function refusedOnReplayPage(url, method) {
  const u = String(url || '');
  if (REPLAY_READ.test(u) && String(method || 'GET').toUpperCase() === 'GET') return false;
  return RGS_PATH.test(u) || PROJECT_API.test(u);
}

/**
 * On a replay page, wrap fetch so no node — this repository's or a pro-node building its own URL — can reach
 * the RGS with anything but the replay read. Installed once; a no-op on any other page.
 */
function installReplayFetchGuard() {
  const g = typeof globalThis !== 'undefined' ? globalThis : null;
  if (!g || typeof g.fetch !== 'function' || g[GUARD_KEY] || !isReplayPage()) return false;
  const original = g.fetch;
  const guarded = function (input, init) {
    const url = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : String(input);
    const method = (init && init.method) || (input && typeof input === 'object' && input.method) || 'GET';
    if (refusedOnReplayPage(url, method)) {
      console.warn('[replay] refused a request on a replay page:', method, url.split('?')[0]);
      return Promise.reject(
        new ReplayRefused('This is a replay: ' + url.split('?')[0] + ' is not called while watching one.')
      );
    }
    return original.apply(this, arguments);
  };
  g[GUARD_KEY] = { original };
  g.fetch = guarded;
  return true;
}

/** Pin `no-referrer`: the page's address holds the share token, and no asset request should carry it away. */
function noReferrerOnThisPage() {
  try {
    if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return false;
    let meta = document.head.querySelector('meta[name="referrer"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'referrer';
      document.head.appendChild(meta);
    }
    meta.content = 'no-referrer';
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * At runtime boot, before any node runs: on a replay page, guard the network, put the loader up, and fail
 * loudly if no Aggregator ever names an RGS to read the replay from (a game with no published maths).
 * Returns the session, or null on an ordinary page.
 */
function bootReplayMode(deps) {
  if (!isReplayPage()) return null;
  installReplayFetchGuard();
  noReferrerOnThisPage();
  const session = replaySessionForPage(deps);
  const later = (deps && deps.setTimeout) || setTimeout;
  later(() => {
    if (session && !session.rgs && session.state === STATES.LOADING) {
      session.fail(CODES.NO_RGS, 'This game cannot show replays: it has no XGENIA RGS maths to read the round from.');
    }
  }, NO_RGS_TIMEOUT_MS);
  return session;
}

// ─── The default view ──────────────────────────────────────────────────────────

/**
 * Loader, Play, Play Again and the error, over the game, as plain DOM (no framework: this runs before the
 * game's own UI and must work in a small popout). Null where there is no document (tests, workers).
 */
function createDomReplayView(doc) {
  doc = doc || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function') return null;
  let root = null;
  let style = null;
  let pending = null;

  function ensure() {
    if (root) return root;
    style = doc.createElement('style');
    style.textContent =
      '.xg-replay{position:fixed;z-index:2147483000;font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#fff;box-sizing:border-box}' +
      '.xg-replay *{box-sizing:border-box}' +
      '.xg-replay--full{inset:0;display:flex;align-items:center;justify-content:center;background:rgba(8,10,16,.78);padding:16px}' +
      '.xg-replay--bar{left:0;right:0;top:0;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;justify-content:center;padding:6px 12px;background:rgba(8,10,16,.72);pointer-events:auto}' +
      '.xg-replay__card{max-width:360px;width:100%;text-align:center;display:flex;flex-direction:column;gap:12px;align-items:center}' +
      '.xg-replay__tag{letter-spacing:.12em;font-size:12px;opacity:.75}' +
      '.xg-replay__btn{appearance:none;border:0;border-radius:999px;padding:10px 28px;font:inherit;font-size:16px;cursor:pointer;background:#fff;color:#111;min-width:140px}' +
      '.xg-replay--bar .xg-replay__btn{padding:5px 16px;font-size:13px;min-width:0}' +
      '.xg-replay__btn:focus-visible{outline:2px solid #7fb4ff;outline-offset:2px}' +
      '.xg-replay__spin{width:32px;height:32px;border-radius:50%;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;animation:xg-replay-spin .9s linear infinite}' +
      '@keyframes xg-replay-spin{to{transform:rotate(360deg)}}' +
      '@media (prefers-reduced-motion:reduce){.xg-replay__spin{animation:none}}';
    (doc.head || doc.body).appendChild(style);
    root = doc.createElement('div');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    doc.body.appendChild(root);
    return root;
  }

  function el(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function button(text, onClick) {
    const b = el('button', 'xg-replay__btn', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  return {
    render(state, info) {
      // Booted before <body> exists: draw the latest state once it does.
      if (!doc.body) {
        const first = !pending;
        pending = [state, info];
        if (first && typeof doc.addEventListener === 'function') {
          doc.addEventListener('DOMContentLoaded', () => {
            if (pending && doc.body) this.render(pending[0], pending[1]);
          });
        }
        return;
      }
      pending = null;
      const r = ensure();
      while (r.firstChild) r.removeChild(r.firstChild);
      const sum = info && info.summary;
      if (state === STATES.PLAYING || state === STATES.ENDED) {
        r.className = 'xg-replay xg-replay--bar';
        r.appendChild(el('span', 'xg-replay__tag', 'REPLAY'));
        if (sum) r.appendChild(el('span', null, sum.text.bet));
        if (sum) r.appendChild(el('span', null, sum.text.win));
        if (state === STATES.ENDED) r.appendChild(button('Play Again', () => info.playAgain()));
        return;
      }
      r.className = 'xg-replay xg-replay--full';
      const card = el('div', 'xg-replay__card');
      card.appendChild(el('div', 'xg-replay__tag', 'REPLAY'));
      if (state === STATES.LOADING) {
        card.appendChild(el('div', 'xg-replay__spin'));
        card.appendChild(el('div', null, 'Loading replay…'));
      } else if (state === STATES.READY) {
        if (sum) card.appendChild(el('div', null, sum.text.bet));
        if (sum) card.appendChild(el('div', null, sum.text.win));
        const b = button('Play', () => info.play());
        card.appendChild(b);
        try {
          b.focus();
        } catch (e) {
          /* not focusable yet */
        }
      } else if (state === STATES.ERROR) {
        root.setAttribute('role', 'alert');
        card.appendChild(
          el('div', null, (info && info.error && info.error.message) || 'This replay could not be loaded.')
        );
      }
      r.appendChild(card);
    }
  };
}

function _resetForTests() {
  stickyLaunch = null;
  const g = typeof globalThis !== 'undefined' ? globalThis : {};
  if (g[GUARD_KEY]) {
    g.fetch = g[GUARD_KEY].original;
    delete g[GUARD_KEY];
  }
  delete g[SESSION_KEY];
}

module.exports = {
  STATES,
  CODES,
  ReplayRefused,
  parseReplayLaunch,
  replayLaunch,
  isReplayPage,
  rgsFromAggregatorUrl,
  replayFetchUrl,
  replaySummary,
  formatMoney,
  toMajor,
  createReplaySession,
  frameResponse,
  replaySessionForPage,
  refusedOnReplayPage,
  installReplayFetchGuard,
  noReferrerOnThisPage,
  bootReplayMode,
  createDomReplayView,
  _resetForTests
};
