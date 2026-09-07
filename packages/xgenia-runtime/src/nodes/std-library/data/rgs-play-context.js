'use strict';

// Who is playing, and in which sitting — for RGS round tracking.
// ---------------------------------------------------------------
// A published game's logic runs server-side: the Aggregator POSTs to
// /rgs-fn/<game>/<component>, the platform executes the component and (when the
// publish card mapped a bet input and a win output) records the round as
// transactions + a game_sessions row. Recording needs a player, and the request
// is the only place that knowledge can come from — the edge function sees an
// anonymous HTTPS call with a JSON body and nothing else.
//
// Games identify players in exactly one way today: the "Get Player ID by Player
// Name" node, plus the cashier nodes that are handed a player id. So this module
// remembers whatever player id those nodes last worked with, and the Aggregator
// attaches it to every POST.
//
// Most games have no player node at all (they were built as standalone titles),
// which is why there is a second identifier: a random id generated once per
// browser and kept in localStorage. The platform turns that into a guest player,
// so a game with no login still shows up on the Transactions and Game Sessions
// pages, and the same visitor coming back tomorrow lands on the same guest.
//
// Nothing here identifies a person. The client id is a random value this browser
// made up about itself; it carries no name, no device information and nothing
// derived from either.
//
// Three ids, three lifetimes:
//
//   client  — localStorage,   one per browser. Groups a returning visitor.
//   session — sessionStorage, one per tab. Groups one sitting into one
//             game_sessions row; a new tab is a new session.
//   player  — sessionStorage, the real RGS player the game logged in, if any.
//             Session-scoped on purpose: closing the tab should not leave the
//             next visitor logged in as the last one.

var CLIENT_ID_KEY = 'xgenia_rgs_client_id';
var SESSION_ID_KEY = 'xgenia_rgs_session_id';
var PLAYER_ID_KEY = 'xgenia_rgs_player_id';

// Storage throws rather than returning null in a few real situations (Safari
// private browsing, third-party iframe restrictions, storage disabled). Falling
// back to a per-page-load object keeps tracking working for the current sitting
// instead of failing the round.
var memoryStore = {};

function storage(kind) {
  try {
    var store = kind === 'local' ? window.localStorage : window.sessionStorage;
    // Presence isn't enough — reading can throw even when the object exists.
    store.getItem(CLIENT_ID_KEY);
    return store;
  } catch (e) {
    return null;
  }
}

function readId(kind, key) {
  if (typeof window === 'undefined') return memoryStore[key] || '';
  var store = storage(kind);
  if (!store) return memoryStore[key] || '';
  try {
    return store.getItem(key) || '';
  } catch (e) {
    return memoryStore[key] || '';
  }
}

function writeId(kind, key, value) {
  memoryStore[key] = value;
  if (typeof window === 'undefined') return;
  var store = storage(kind);
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch (e) {
    /* quota or a locked-down store — the memory copy still covers this sitting */
  }
}

function randomId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (e) {
    /* fall through */
  }
  // Not a UUID and not required to be — the platform treats it as an opaque key.
  return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function getOrCreate(kind, key) {
  var existing = readId(kind, key);
  if (existing) return existing;
  var created = randomId();
  writeId(kind, key, created);
  return created;
}

/** Stable per-browser id. Created on first use. */
function getClientId() {
  return getOrCreate('local', CLIENT_ID_KEY);
}

/** Per-tab id, so one sitting is one session row. Created on first use. */
function getSessionId() {
  return getOrCreate('session', SESSION_ID_KEY);
}

/**
 * Remember the RGS player the game is acting as. Called by every node that
 * resolves or is handed a player id, so a game that logs in once has its rounds
 * attributed for the rest of the sitting without wiring anything up.
 *
 * Ignores anything that isn't a uuid: these inputs are free text on the node, so
 * an unbound or half-typed one would otherwise replace a good id with junk.
 */
function setCurrentPlayerId(playerId) {
  var id = (playerId === null || playerId === undefined ? '' : String(playerId)).trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
  writeId('session', PLAYER_ID_KEY, id);
}

/** The remembered player id, or '' when the game never identified one. */
function getCurrentPlayerId() {
  return readId('session', PLAYER_ID_KEY);
}

/**
 * The reserved fields the Aggregator adds to every request. Underscore-prefixed
 * to sit alongside the dispatcher's existing __game / __function and stay out of
 * the way of a component's own port names.
 *
 * Never throws: a failure to build these must not stop a round being played.
 */
function getPlayContextFields() {
  try {
    var fields = {
      __client: getClientId(),
      __session: getSessionId()
    };
    var playerId = getCurrentPlayerId();
    if (playerId) fields.__player = playerId;
    return fields;
  } catch (e) {
    return {};
  }
}

module.exports = {
  getClientId: getClientId,
  getSessionId: getSessionId,
  setCurrentPlayerId: setCurrentPlayerId,
  getCurrentPlayerId: getCurrentPlayerId,
  getPlayContextFields: getPlayContextFields
};
