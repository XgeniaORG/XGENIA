'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');

// Load Game Session
// -----------------
// Loads a single game_sessions row from the RGS platform and exposes its
// session_data payload. The node sends one REST request to the Supabase
// PostgREST RPC `load_game_session` (see XRGS migration
// 20260628150000_load_game_session.sql), which is SECURITY DEFINER so it returns
// the row despite game_sessions RLS (a direct table read with the anon key would
// always return []).
//
// The String `sessionId` maps onto the table's unique `session_token`, the same
// key the Save Game Session node upserts on, so the two nodes round-trip.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes.

const LoadGameSessionNode = {
  name: 'LoadGameSession',
  displayNodeName: 'Load Game Session',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/load-game-session',
  category: 'Data',
  color: 'data',
  searchTags: ['game', 'session', 'sessions', 'player', 'game id', 'rgs', 'cloud', 'load', 'read', 'fetch', 'get', 'restore'],
  initialize: function () {
    this._internal.playerId = '';
    this._internal.gameId = '';
    this._internal.sessionId = '';
    this._internal.sessionData = null;
    this._internal.isSuccessful = false;
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
        this.loadSession();
      }
    },
    playerId: {
      type: 'string',
      displayName: 'Player Id',
      group: 'General',
      default: '',
      set: function (value) {
        this._internal.playerId = value;
      }
    },
    gameId: {
      type: 'string',
      displayName: 'Game Id',
      group: 'General',
      default: '',
      set: function (value) {
        this._internal.gameId = value;
      }
    },
    sessionId: {
      type: 'string',
      displayName: 'Session Id',
      group: 'General',
      default: '',
      set: function (value) {
        this._internal.sessionId = value;
      }
    }
  },
  outputs: {
    sessionData: {
      displayName: 'Session Data',
      type: '*',
      group: 'Result',
      getter: function () {
        return this._internal.sessionData;
      }
    },
    isSuccessful: {
      displayName: 'Is Successful',
      type: 'boolean',
      group: 'Result',
      getter: function () {
        return this._internal.isSuccessful;
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
    loadSession: async function () {
      this._internal.lastError = null;
      let ok = false;

      try {
        const playerId = (this.getInputValue('playerId') || this._internal.playerId || '').toString();
        const gameId = (this.getInputValue('gameId') || this._internal.gameId || '').toString();
        const sessionId = (this.getInputValue('sessionId') || this._internal.sessionId || '').toString();

        if (!playerId.trim()) {
          throw new Error('playerId is required');
        }
        if (!sessionId.trim()) {
          throw new Error('sessionId is required');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/load_game_session`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            p_player_id: playerId,
            p_game_id: gameId.trim() ? gameId : null,
            p_session_id: sessionId
          })
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

        // PostgREST returns RETURNS SETOF results as an array of rows; the RPC
        // is LIMIT 1, so at most one row comes back.
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : null;

        if (row) {
          this._internal.sessionData = row.session_data !== undefined ? row.session_data : null;
          ok = true;
          this._internal.inspectData = {
            playerId: playerId,
            gameId: gameId,
            sessionId: sessionId,
            isSuccessful: true,
            sessionData: this._internal.sessionData
          };
        } else {
          // No matching session — a completed request that found nothing.
          this._internal.sessionData = null;
          this._internal.inspectData = {
            playerId: playerId,
            gameId: gameId,
            sessionId: sessionId,
            isSuccessful: false,
            note: 'No matching session found'
          };
        }
      } catch (error) {
        this._internal.sessionData = null;
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Load Game Session error:', error);
      }

      this._internal.isSuccessful = ok;
      this.flagOutputDirty('sessionData');
      this.flagOutputDirty('isSuccessful');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: LoadGameSessionNode
};
