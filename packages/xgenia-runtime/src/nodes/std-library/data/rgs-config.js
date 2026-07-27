'use strict';

// Shared Supabase/RGS connection resolver for the cloud-data nodes
// (Get Player ID by Player Name, Save/Load/List Game Session).
//
// Resolution order:
//   1. The project's `cloudservices` metadata — set when a cloud environment is
//      connected (see xgenia-editor setCloudServices). This is what deployed
//      games and editors-with-a-connected-environment use, so it always wins.
//   2. A hardcoded XGENIA RGS fallback so these nodes also work in the editor
//      preview before any cloud environment is connected. The RGS RPCs they
//      call (get_or_create_player_by_name, save/load/list_game_session) are
//      SECURITY DEFINER + `GRANT ... TO anon` and live ONLY in the XGENIA RGS
//      project, so this project is the correct default target for them.
//
// RGS_FALLBACK_ANON_KEY is the publishable anon key (NOT a secret) — the same
// value the editor already hardcodes in utils/rgs/rgsClient.ts (XRGS_ANON_KEY).
// It only passes the gateway's verify_jwt; data access is still governed by RLS
// and the SECURITY DEFINER functions.
//
// Keep these two constants in sync with rgsClient.ts (XRGS_URL is the same
// project with a `/functions/v1` suffix; here we need the bare project URL
// because the data nodes append `/rest/v1/rpc/...`).

const RGS_FALLBACK_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co';
const RGS_FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdWJ6d3lkcmplbG1qZmtrcmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4ODA3NDcsImV4cCI6MjA4NzQ1Njc0N30.Hewc7WlLZuufC0trhCKKKc4AhLXk7jy7qG3irBQPykY';

// Reads one key off the project metadata a node is running inside. Deployed games
// and editor previews both end up here: the graph model carries the metadata the
// project was saved with, and the window fallback covers nodes invoked outside a
// graph context.
function readProjectMetaData(node, key) {
  if (
    node &&
    node.context &&
    node.context.graphModel &&
    typeof node.context.graphModel.getMetaData === 'function'
  ) {
    return node.context.graphModel.getMetaData(key);
  }
  if (typeof window !== 'undefined' && window.XgeniaRuntime && window.XgeniaRuntime.instance) {
    return window.XgeniaRuntime.instance.getMetaData(key);
  }
  return null;
}

// Resolves { url, anonKey } for the given node, preferring connected
// cloudservices metadata and falling back to the XGENIA RGS project.
function resolveSupabaseConfig(node) {
  const cloudServices = readProjectMetaData(node, 'cloudservices');

  const supabaseConfig = cloudServices && cloudServices.supabase;
  const url = (supabaseConfig && supabaseConfig.url) || RGS_FALLBACK_URL;
  const anonKey =
    (supabaseConfig && (supabaseConfig.anonKey || supabaseConfig.apikey || supabaseConfig.accessToken)) ||
    RGS_FALLBACK_ANON_KEY;

  return { url, anonKey };
}

// Resolves which RGS game this project belongs to, as { id, name, slug }.
//
// The deploy flow stamps the Target Game picked in the Publish popup into the
// project's `rgsgame` metadata (see XgeniaDeployTab.deployToRgsAndVercel), so a
// deployed game can tell the platform WHICH game an action was taken in. The
// cashier nodes need it: deposit_balance / withdraw_balance / create-checkout-session
// otherwise see only a player and an amount, and their rows land on the platform's
// Transactions page with no game — the "—" in its Game column.
//
// Anything missing comes back as '' rather than undefined, so callers can test one
// way. Two cases resolve to empty and are expected, not errors:
//   * a project published before the deploy flow started stamping this;
//   * an editor preview, where nothing has been published yet.
// The nodes then simply omit the game, and the RGS functions record the row exactly
// as they did before.
function resolveRgsGame(node) {
  const game = readProjectMetaData(node, 'rgsgame') || {};

  return {
    id: (game.id || '').toString(),
    name: (game.name || '').toString(),
    slug: (game.slug || '').toString()
  };
}

module.exports = {
  RGS_FALLBACK_URL,
  RGS_FALLBACK_ANON_KEY,
  readProjectMetaData,
  resolveSupabaseConfig,
  resolveRgsGame
};
