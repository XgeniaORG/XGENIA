'use strict';

// (2026-11-12) Run XRGS edge functions beside the database, not beside the player.
//
// Supabase runs an edge function in the region nearest the CALLER. XRGS's database is in eu-west-1, and a round
// makes ~20 sequential database calls, so a player in the US or Asia had every one of them cross an ocean: a demo
// round measured p50 4.1 s from the US, 0.93 s once pinned (XRGS SYSTEM_MAP I-208). `?forceFunctionRegion=` makes
// the gateway run the function in that region. A query parameter, not the `x-region` header: a custom header
// needs a CORS preflight the RGS's functions do not allow, so every round would have been refused.
//
// XRGS pins the function_url it hands the editor at publish (maths-deployer), so a game published after that
// already carries the pin. This covers the URLs the runtime builds ITSELF from that URL (the play-money balance,
// the replay read) and games published before, whose baked URL has none.
//
// Mirrors XRGS supabase/functions/_shared/function-region.ts; keep the default in step with it.

const FUNCTION_REGION_PARAM = 'forceFunctionRegion';
const DEFAULT_FUNCTION_REGION = 'eu-west-1';

/**
 * `url` with `forceFunctionRegion=<region>` added when it is a hosted Supabase function URL (`…/functions/v1/…`
 * on a host that is not this machine): after any query, before any fragment, never twice — a URL that already
 * names a region keeps it. Anything else (the compile-time localhost default, a local stack, a non-RGS endpoint)
 * is returned as it is.
 */
function withFunctionRegion(url, region) {
  const r = region === undefined ? DEFAULT_FUNCTION_REGION : region;
  const s = String(url || '');
  if (!r || !s) return s;
  const m = /^https?:\/\/([^/?#:]+)(?::\d+)?(\/[^?#]*)?/i.exec(s);
  if (!m) return s;
  const host = m[1].toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]') return s;
  if (!/\/functions\/v1(\/|$)/.test(m[2] || '')) return s;
  const hashAt = s.indexOf('#');
  const head = hashAt === -1 ? s : s.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : s.slice(hashAt);
  const qAt = head.indexOf('?');
  if (qAt !== -1 && head.slice(qAt + 1).split('&').some((kv) => kv.split('=')[0] === FUNCTION_REGION_PARAM)) return s;
  const sep = qAt === -1 ? '?' : head.endsWith('?') || head.endsWith('&') ? '' : '&';
  return head + sep + FUNCTION_REGION_PARAM + '=' + encodeURIComponent(r) + hash;
}

module.exports = { withFunctionRegion, FUNCTION_REGION_PARAM, DEFAULT_FUNCTION_REGION };
