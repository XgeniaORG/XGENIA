'use strict';

// List Game Sessions
// ------------------
// Fetches every game_sessions row on the RGS platform that matches a given
// player_id and game_id. The node sends one REST request to the Supabase
// PostgREST RPC `list_game_sessions` (see XRGS migration
// 20260628130000_list_game_sessions.sql), which is SECURITY DEFINER so it
// returns rows despite game_sessions RLS (a direct table read with the anon
// key would always return []).
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. Get Player
// ID by Player Name, Server Seed Generator).

const ListGameSessionsNode = {
  name: 'ListGameSessions',
  displayNodeName: 'List Game Sessions',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/list-game-sessions',
  category: 'Data',
  color: 'data',
  searchTags: ['game', 'session', 'sessions', 'player', 'game id', 'rgs', 'cloud', 'list', 'fetch', 'query'],
  initialize: function () {
    this._internal.playerId = '';
    this._internal.gameId = '';
    this._internal.sessions = [];
    this._internal.isEmpty = true;
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
        this.fetchSessions();
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
    }
  },
  outputs: {
    sessions: {
      displayName: 'Sessions',
      type: 'array',
      group: 'Result',
      getter: function () {
        return this._internal.sessions;
      }
    },
    isEmpty: {
      displayName: 'Is Empty',
      type: 'boolean',
      group: 'Result',
      getter: function () {
        return this._internal.isEmpty;
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
      let cloudServices = null;
      if (this.context && this.context.graphModel && typeof this.context.graphModel.getMetaData === 'function') {
        cloudServices = this.context.graphModel.getMetaData('cloudservices');
      } else if (typeof window !== 'undefined' && window.XgeniaRuntime && window.XgeniaRuntime.instance) {
        cloudServices = window.XgeniaRuntime.instance.getMetaData('cloudservices');
      }

      const supabaseConfig = cloudServices && cloudServices.supabase;
      const url = supabaseConfig && supabaseConfig.url;
      const anonKey =
        supabaseConfig && (supabaseConfig.anonKey || supabaseConfig.apikey || supabaseConfig.accessToken);

      return { url, anonKey };
    },
    fetchSessions: async function () {
      this._internal.lastError = null;

      try {
        const playerId = (this.getInputValue('playerId') || this._internal.playerId || '').toString();
        const gameId = (this.getInputValue('gameId') || this._internal.gameId || '').toString();

        if (!playerId.trim()) {
          throw new Error('playerId is required');
        }
        if (!gameId.trim()) {
          throw new Error('gameId is required');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/list_game_sessions`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({ p_player_id: playerId, p_game_id: gameId })
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

        // PostgREST returns RETURNS SETOF results as an array of rows.
        const data = await response.json();
        const sessions = Array.isArray(data) ? data : [];

        this._internal.sessions = sessions;
        this._internal.isEmpty = sessions.length === 0;

        this._internal.inspectData = {
          playerId: playerId,
          gameId: gameId,
          count: sessions.length,
          isEmpty: this._internal.isEmpty,
          sessions: sessions
        };

        this.flagOutputDirty('sessions');
        this.flagOutputDirty('isEmpty');
        this.sendSignalOnOutput('Done');
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { error: error.message };
        console.error('List Game Sessions error:', error);
      }
    }
  }
};

module.exports = {
  node: ListGameSessionsNode
};
