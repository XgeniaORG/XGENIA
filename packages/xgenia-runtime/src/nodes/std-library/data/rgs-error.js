'use strict';

// RGS error reporting
// -------------------
// Turns a non-2xx PostgREST response into the message the DATABASE actually
// raised, for the RGS-backed nodes that surface a failure reason to the game
// (Create New Player, Update Player, Get Player).
//
// Why this is not just `${status} ${statusText}`: the player-facing failures on
// those nodes are things a person needs to read — 'a player named "Ada" already
// exists', 'no player named "Bob" found'. Those are written deliberately in
// XRGS migration 20260804120000_player_admin_rpcs.sql, and PostgREST returns a
// RAISE EXCEPTION as a JSON envelope { message, details, hint, code }. Reporting
// "RGS request failed: 400" instead throws that away and leaves a registration
// form with nothing to show.
//
// Falls back to the status line when the body is not JSON (a gateway error page,
// for instance) and to the whole body when it is JSON without a message, so a
// caller is never left with an empty string.

async function describeRgsFailure(response) {
  let body = null;

  try {
    body = await response.json();
  } catch (e) {
    return `RGS request failed: ${response.status} ${response.statusText}`;
  }

  if (body && typeof body.message === 'string' && body.message.trim()) {
    return body.message;
  }

  return `RGS request failed: ${response.status} ${JSON.stringify(body)}`;
}

module.exports = {
  describeRgsFailure: describeRgsFailure
};
