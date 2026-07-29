'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Get Player ID by Player Name
// ----------------------------
// Resolves a player_id from a player's display_name on the RGS platform. The
// node sends one REST request to the Supabase PostgREST RPC
// `get_or_create_player_by_name` (see XRGS migration
// 20260628120000_players_display_name_unique_and_get_or_create.sql), which:
//   * returns the existing player_id when a player with that display_name
//     already exists (isExistBefore = true), or
//   * creates a new player row (generated id + table defaults) and returns the
//     new player_id (isExistBefore = false).
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. Server
// Seed Generator).

const GetPlayerIdByNameNode = {
  name: 'GetPlayerIdByName',
  displayNodeName: 'Get Player ID by Player Name',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/get-player-id-by-name',
  category: 'Data',
  color: 'data',
  searchTags: ['player', 'id', 'name', 'display name', 'rgs', 'cloud', 'lookup', 'find', 'create'],
  initialize: function () {
    this._internal.playerName = '';
    this._internal.playerId = null;
    this._internal.isExistBefore = false;
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
        this.fetchPlayerId();
      }
    },
    playerName: {
      type: 'string',
      displayName: 'Player Name',
      group: 'General',
      default: '',
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
        return this._internal.playerId;
      }
    },
    isExistBefore: {
      displayName: 'Is Exist Before',
      type: 'boolean',
      group: 'Result',
      getter: function () {
        return this._internal.isExistBefore;
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
    fetchPlayerId: async function () {
      this._internal.lastError = null;

      try {
        const playerName = (this.getInputValue('playerName') || this._internal.playerName || '').toString();

        if (!playerName.trim()) {
          throw new Error('playerName is required');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/get_or_create_player_by_name`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({ p_display_name: playerName })
        });

        if (!response.ok) {
          let detail = '';
          try {
            detail = JSON.stringify(await response.json());
          } catch (e) {
            detail = response.statusText;
          }
          throw new Error(`RGS request failed: ${response.status} ${detail}`);
        }

        // PostgREST returns RETURNS TABLE results as an array of rows.
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : data;

        if (!row || !row.player_id) {
          throw new Error('Invalid response from RGS: missing player_id');
        }

        this._internal.playerId = row.player_id;
        this._internal.isExistBefore = row.is_exist_before === true;

        // This is a deployed game telling us who is playing. Remember it, so the
        // rounds that follow are attributed to this player instead of the
        // browser's anonymous guest. See rgs-play-context.js.
        setCurrentPlayerId(row.player_id);

        this._internal.inspectData = {
          playerName: playerName,
          playerId: this._internal.playerId,
          isExistBefore: this._internal.isExistBefore
        };

        this.flagOutputDirty('playerId');
        this.flagOutputDirty('isExistBefore');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { error: error.message };
        console.error('Get Player ID by Player Name error:', error);
      } finally {
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: GetPlayerIdByNameNode
};
