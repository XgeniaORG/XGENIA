'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');

// Deposit Balance
// ---------------
// Adds a deposit amount to a player's balance on the RGS platform. The node
// sends one REST request to the Supabase PostgREST RPC `deposit_balance` (see
// XRGS migration 20260709130000_deposit_balance.sql), which is SECURITY DEFINER
// so it can update the players table despite its RLS (the anon key has no
// UPDATE policy on players, so a direct PostgREST write would match no rows).
//
// balance is stored in minor units (bigint); the RPC rounds the amount to the
// nearest whole minor unit and rejects non-positive amounts / unknown players
// with a non-2xx response, which the node reports as isSuccessful = false.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. Save Game
// Session, Get Player ID by Player Name).

const DepositBalanceNode = {
  name: 'DepositBalance',
  displayNodeName: 'Deposit Balance',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/deposit-balance',
  category: 'Data',
  color: 'data',
  searchTags: ['balance', 'deposit', 'player', 'wallet', 'credit', 'funds', 'money', 'rgs', 'cloud', 'add', 'top up', 'top-up'],
  initialize: function () {
    this._internal.playerID = '';
    this._internal.depositAmount = 0;
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
        this.depositBalance();
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
    },
    depositAmount: {
      type: 'number',
      displayName: 'Deposit Amount',
      group: 'General',
      default: 0,
      set: function (value) {
        this._internal.depositAmount = value;
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
    depositBalance: async function () {
      this._internal.lastError = null;
      let ok = false;

      try {
        const playerID = (this.getInputValue('playerID') || this._internal.playerID || '').toString();

        const rawAmount = this.getInputValue('depositAmount');
        const depositAmount = Number(rawAmount !== undefined ? rawAmount : this._internal.depositAmount);

        if (!playerID.trim()) {
          throw new Error('playerID is required');
        }
        if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
          throw new Error('depositAmount must be a positive number');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/deposit_balance`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            p_player_id: playerID,
            p_deposit_amount: depositAmount
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

        // The RPC returns the player id and the new balance. Capture it for the
        // inspector; the node exposes only isSuccessful / Done as outputs.
        const rows = await response.json().catch(function () {
          return null;
        });
        const row = Array.isArray(rows) ? rows[0] : rows;
        ok = true;

        this._internal.inspectData = {
          playerID: playerID,
          depositAmount: depositAmount,
          balance: row && row.balance !== undefined ? row.balance : null,
          isSuccessful: true
        };
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Deposit Balance error:', error);
      }

      this._internal.isSuccessful = ok;
      this.flagOutputDirty('isSuccessful');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: DepositBalanceNode
};
