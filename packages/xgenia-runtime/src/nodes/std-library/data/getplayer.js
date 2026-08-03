'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');
const { describeRgsFailure } = require('./rgs-error');

// Get Player
// ----------
// Reads an EXISTING player from the RGS platform and reports their id, name and
// both balances. One REST request to the Supabase PostgREST RPC `get_player` (see
// XRGS migration 20260804120000_player_admin_rpcs.sql), which is SECURITY DEFINER
// so it returns the row despite players RLS — a direct table read with the anon key
// would always return [].
//
// One of three nodes that replace "Get Player ID by Player Name" (now deprecated),
// alongside Create New Player and Update Player.
//
// IT CREATES NOTHING. That is the point of splitting it out: the old node returned
// an id whether the player existed or not, so a graph could never ask "is this
// player real?" without side effects, and a typo silently registered somebody. An
// unknown player here is a failure — `isSuccessful` goes false and `error` says
// 'no player named "x" found'. Use Create New Player to register one.
//
// ADDRESSED BY ID OR BY NAME, exactly like Update Player. Player ID wins when both
// are given.
//
// BOTH BALANCES ARE REPORTED, in minor units (1000 = 10.00). Demo Balance is the
// play money a game stakes against. Live Balance is the real-money pot; it is
// read-only everywhere, and zero platform-wide, because real money can only arrive
// through a payment rail and the platform no longer has one. It is exposed so a
// game can show it rather than having to assume it.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes.

// A port that was never touched reads as undefined; one that was typed into and
// cleared can come back as an empty string. Both mean "not provided".
function isBlank(value) {
  return value === undefined || value === null || value.toString().trim() === '';
}

const GetPlayerNode = {
  name: 'GetPlayer',
  displayNodeName: 'Get Player',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/get-player',
  category: 'Data',
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/get_player), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: [
    'player',
    'get',
    'read',
    'fetch',
    'find',
    'lookup',
    'retrieve',
    'exists',
    'name',
    'display name',
    'balance',
    'demo balance',
    'live balance',
    'rgs',
    'cloud'
  ],
  initialize: function () {
    this._internal.playerId = undefined;
    this._internal.playerName = undefined;
    this._internal.resultPlayerId = null;
    this._internal.resultPlayerName = '';
    this._internal.resultDemoBalance = 0;
    this._internal.resultLiveBalance = 0;
    this._internal.isSuccessful = false;
    this._internal.error = '';
    this._internal.lastError = null;
    this._internal.inspectData = null;
  },
  getInspectInfo() {
    if (this._internal.lastError) {
      return { type: 'text', value: `Error: ${this._internal.lastError}` };
    }
    return this._internal.inspectData
      ? { type: 'value', value: this._internal.inspectData }
      : { type: 'text', value: '[Not executed yet]' };
  },
  inputs: {
    Do: {
      type: 'signal',
      displayName: 'Do',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.getPlayer();
      }
    },
    playerId: {
      type: 'string',
      displayName: 'Player ID',
      group: 'Identify',
      // No default: blank means "identify by name instead". See Update Player.
      set: function (value) {
        this._internal.playerId = value;
      }
    },
    playerName: {
      type: 'string',
      displayName: 'Player Name',
      group: 'Identify',
      set: function (value) {
        this._internal.playerName = value;
      }
    }
  },
  outputs: {
    playerId: {
      displayName: 'Player Id',
      type: 'string',
      group: 'Result',
      getter: function () {
        return this._internal.resultPlayerId;
      }
    },
    playerName: {
      displayName: 'Player Name',
      type: 'string',
      group: 'Result',
      getter: function () {
        return this._internal.resultPlayerName;
      }
    },
    demoBalance: {
      displayName: 'Demo Balance',
      type: 'number',
      group: 'Result',
      getter: function () {
        return this._internal.resultDemoBalance;
      }
    },
    liveBalance: {
      displayName: 'Live Balance',
      type: 'number',
      group: 'Result',
      getter: function () {
        return this._internal.resultLiveBalance;
      }
    },
    isSuccessful: {
      displayName: 'Is Successful',
      type: 'boolean',
      group: 'Result',
      // False when the player does not exist, which is the useful signal here:
      // this node is also how a graph asks "is this name taken?" before calling
      // Create New Player.
      getter: function () {
        return this._internal.isSuccessful;
      }
    },
    error: {
      displayName: 'Error',
      type: 'string',
      group: 'Result',
      getter: function () {
        return this._internal.error;
      }
    },
    Done: {
      displayName: 'Done',
      type: 'signal',
      group: 'Events'
    }
  },
  methods: {
    getSupabaseConfig: function () {
      // Prefer connected cloudservices metadata; fall back to the XGENIA RGS
      // project so the node also works in the editor preview. See rgs-config.js.
      return resolveSupabaseConfig(this);
    },
    getPlayer: async function () {
      this._internal.lastError = null;
      let ok = false;
      let error = '';
      let resultPlayerId = null;
      let resultPlayerName = '';
      let resultDemoBalance = 0;
      let resultLiveBalance = 0;

      try {
        const rawPlayerId = this.getInputValue('playerId') !== undefined
          ? this.getInputValue('playerId')
          : this._internal.playerId;
        const rawPlayerName = this.getInputValue('playerName') !== undefined
          ? this.getInputValue('playerName')
          : this._internal.playerName;

        const playerId = isBlank(rawPlayerId) ? null : rawPlayerId.toString().trim();
        const playerName = isBlank(rawPlayerName) ? null : rawPlayerName.toString().trim();

        if (!playerId && !playerName) {
          throw new Error('either playerId or playerName is required to identify the player');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        // Send only the argument this call means — see the note in updateplayer.js.
        const payload = {};
        if (playerId) payload.p_player_id = playerId;
        if (playerName) payload.p_display_name = playerName;

        const endpoint = `${url}/rest/v1/rpc/get_player`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          throw new Error(await describeRgsFailure(response));
        }

        // PostgREST returns RETURNS TABLE results as an array of rows. The RPC
        // raises rather than returning an empty set when the player is unknown, so
        // reaching here with no row means something else went wrong.
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : data;

        if (!row || !row.player_id) {
          throw new Error('Invalid response from RGS: missing player_id');
        }

        resultPlayerId = row.player_id;
        resultPlayerName = row.display_name || '';
        resultDemoBalance = Number(row.demo_balance || 0);
        resultLiveBalance = Number(row.live_balance || 0);
        ok = true;

        // The game knows who is playing. Remember it so the rounds around this
        // call are attributed to this player rather than the browser's anonymous
        // guest. See rgs-play-context.js.
        setCurrentPlayerId(resultPlayerId);

        this._internal.inspectData = {
          identifiedBy: playerId ? 'playerId' : 'playerName',
          playerId: resultPlayerId,
          playerName: resultPlayerName,
          demoBalance: resultDemoBalance,
          liveBalance: resultLiveBalance,
          isSuccessful: true
        };
      } catch (err) {
        error = err.message;
        this._internal.lastError = error;
        this._internal.inspectData = { isSuccessful: false, error: error };
        console.error('Get Player error:', err);
      }

      this._internal.resultPlayerId = resultPlayerId;
      this._internal.resultPlayerName = resultPlayerName;
      this._internal.resultDemoBalance = resultDemoBalance;
      this._internal.resultLiveBalance = resultLiveBalance;
      this._internal.isSuccessful = ok;
      this._internal.error = error;
      this.flagOutputDirty('playerId');
      this.flagOutputDirty('playerName');
      this.flagOutputDirty('demoBalance');
      this.flagOutputDirty('liveBalance');
      this.flagOutputDirty('isSuccessful');
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: GetPlayerNode
};
