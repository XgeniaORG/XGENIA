'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Get Balance by Player ID
// ------------------------
// Reads a player's balance from the RGS platform and exposes it. The node sends
// one REST request to the Supabase PostgREST RPC `get_player_balance` (see XRGS
// migration 20260709150000_get_player_balance.sql), which is SECURITY DEFINER so
// it returns the row despite players RLS (a direct table read with the anon key
// would always return []).
//
// balance is stored in minor units (bigint) of players.currency_code. When the
// player id is unknown the RPC returns an empty set; the node then reports
// isSuccessful = false and leaves balance at 0. Read counterpart to the Deposit
// / Withdraw Balance nodes.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes.

const GetBalanceByPlayerIdNode = {
  name: 'GetBalanceByPlayerId',
  displayNodeName: 'Get Balance by Player ID',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/get-balance-by-player-id',
  category: 'Data',
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/get_player_balance), so it
  // never routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: ['balance', 'get', 'read', 'fetch', 'player', 'wallet', 'funds', 'money', 'rgs', 'cloud', 'retrieve', 'lookup'],
  initialize: function () {
    this._internal.playerID = '';
    this._internal.balance = 0;
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
        this.getBalance();
      }
    },
    playerID: {
      type: 'string',
      displayName: 'Player ID',
      group: 'General',
      default: '',
      set: function (value) {
        this._internal.playerID = value;
      }
    }
  },
  outputs: {
    balance: {
      displayName: 'Balance',
      type: 'number',
      group: 'Result',
      getter: function () {
        return this._internal.balance;
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
    getBalance: async function () {
      this._internal.lastError = null;
      let ok = false;
      let balance = 0;

      try {
        const playerID = (this.getInputValue('playerID') || this._internal.playerID || '').toString();

        // A cashier node running means the game knows who is playing, even if it
        // never used the Get Player ID node. Remember it so the rounds around
        // this call are attributed to the same player. See rgs-play-context.js.
        setCurrentPlayerId(playerID);

        if (!playerID.trim()) {
          throw new Error('playerID is required');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/get_player_balance`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            p_player_id: playerID
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

        // PostgREST returns RETURNS TABLE results as an array of rows; at most
        // one row comes back (matched on the primary key).
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : null;

        if (row && row.balance !== undefined && row.balance !== null) {
          balance = Number(row.balance);
          ok = true;
          this._internal.inspectData = {
            playerID: playerID,
            balance: balance,
            isSuccessful: true
          };
        } else {
          // No matching player — a completed request that found nothing.
          this._internal.inspectData = {
            playerID: playerID,
            isSuccessful: false,
            note: 'No matching player found'
          };
        }
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Get Balance by Player ID error:', error);
      }

      this._internal.balance = balance;
      this._internal.isSuccessful = ok;
      this.flagOutputDirty('balance');
      this.flagOutputDirty('isSuccessful');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: GetBalanceByPlayerIdNode
};
