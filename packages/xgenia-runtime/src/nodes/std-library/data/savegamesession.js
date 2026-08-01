'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');

// Save Game Session
// -----------------
// Upserts a single game_sessions row on the RGS platform. The node sends one
// REST request to the Supabase PostgREST RPC `save_game_session` (see XRGS migration
// 20260628140000_save_game_session.sql), which is SECURITY DEFINER so it can
// write and read despite game_sessions RLS (the anon key has no direct
// INSERT/UPDATE/SELECT grants on the table).
//
// The String `sessionId` is the upsert key: it maps onto the table's unique
// `session_token`. An existing session with that id is updated; otherwise a new
// session is created (a blank id gets a generated token server-side).
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. List Game
// Sessions, Get Player ID by Player Name).

const SaveGameSessionNode = {
  name: 'SaveGameSession',
  displayNodeName: 'Save Game Session',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/save-game-session',
  category: 'Data',
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/save_game_session), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: ['game', 'session', 'sessions', 'player', 'game id', 'rgs', 'cloud', 'save', 'upsert', 'write', 'store', 'update', 'insert'],
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
        this.saveSession();
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
    },
    sessionData: {
      type: '*',
      displayName: 'Session Data',
      group: 'General',
      set: function (value) {
        this._internal.sessionData = value;
      }
    }
  },
  outputs: {
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
    // Normalise the Record input into a plain JSON object for the jsonb param.
    normalizeSessionData: function (value) {
      if (value === undefined || value === null) {
        return {};
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
          return {};
        }
        try {
          return JSON.parse(trimmed);
        } catch (e) {
          // Not JSON — store the raw string as the payload value.
          return trimmed;
        }
      }
      return value;
    },
    saveSession: async function () {
      this._internal.lastError = null;
      let ok = false;

      try {
        const playerId = (this.getInputValue('playerId') || this._internal.playerId || '').toString();
        const gameId = (this.getInputValue('gameId') || this._internal.gameId || '').toString();
        const sessionId = (this.getInputValue('sessionId') || this._internal.sessionId || '').toString();
        const sessionData = this.normalizeSessionData(
          this.getInputValue('sessionData') !== undefined ? this.getInputValue('sessionData') : this._internal.sessionData
        );

        if (!playerId.trim()) {
          throw new Error('playerId is required');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/save_game_session`;
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
            p_session_id: sessionId,
            p_session_data: sessionData
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

        // Drain the response body so the connection is freed; the upserted
        // rows it returns are no longer surfaced as an output.
        await response.json().catch(function () {});
        ok = true;

        this._internal.inspectData = {
          playerId: playerId,
          gameId: gameId,
          sessionId: sessionId,
          isSuccessful: true
        };
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Save Game Session error:', error);
      }

      this._internal.isSuccessful = ok;
      this.flagOutputDirty('isSuccessful');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: SaveGameSessionNode
};
