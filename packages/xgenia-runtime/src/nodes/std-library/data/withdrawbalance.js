'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');

// Withdraw Balance
// ----------------
// Subtracts a withdraw amount from a player's balance on the RGS platform. The
// node sends one REST request to the Supabase PostgREST RPC `withdraw_balance`
// (see XRGS migration 20260709140000_withdraw_balance.sql), which is SECURITY
// DEFINER so it can update the players table despite its RLS (the anon key has
// no UPDATE policy on players, so a direct PostgREST write would match no rows).
//
// balance is stored in minor units (bigint); the RPC rounds the amount to the
// nearest whole minor unit and rejects non-positive amounts, unknown players,
// and withdrawals greater than the current balance (insufficient funds) with a
// non-2xx response, which the node reports as isSuccessful = false. balance is
// never driven negative.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. Deposit
// Balance, Save Game Session).

const WithdrawBalanceNode = {
  name: 'WithdrawBalance',
  displayNodeName: 'Withdraw Balance',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/withdraw-balance',
  category: 'Data',
  color: 'data',
  searchTags: ['balance', 'withdraw', 'withdrawal', 'player', 'wallet', 'debit', 'funds', 'money', 'rgs', 'cloud', 'subtract', 'cash out', 'cashout', 'payout'],
  initialize: function () {
    this._internal.playerID = '';
    this._internal.withdrawAmount = 0;
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
        this.withdrawBalance();
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
    withdrawAmount: {
      type: 'number',
      displayName: 'Withdraw Amount',
      group: 'General',
      default: 0,
      set: function (value) {
        this._internal.withdrawAmount = value;
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
    withdrawBalance: async function () {
      this._internal.lastError = null;
      let ok = false;

      try {
        const playerID = (this.getInputValue('playerID') || this._internal.playerID || '').toString();

        const rawAmount = this.getInputValue('withdrawAmount');
        const withdrawAmount = Number(rawAmount !== undefined ? rawAmount : this._internal.withdrawAmount);

        if (!playerID.trim()) {
          throw new Error('playerID is required');
        }
        if (!Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
          throw new Error('withdrawAmount must be a positive number');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/withdraw_balance`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            p_player_id: playerID,
            p_withdraw_amount: withdrawAmount
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
          withdrawAmount: withdrawAmount,
          balance: row && row.balance !== undefined ? row.balance : null,
          isSuccessful: true
        };
      } catch (error) {
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Withdraw Balance error:', error);
      }

      this._internal.isSuccessful = ok;
      this.flagOutputDirty('isSuccessful');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: WithdrawBalanceNode
};
