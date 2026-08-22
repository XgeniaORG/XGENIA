'use strict';

const { resolveSupabaseConfig, resolveRgsGame } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Withdraw Balance
// ----------------
// Subtracts a withdraw amount from a player's balance on the RGS platform AND
// files a withdrawal request there. The node sends one REST request to the
// Supabase PostgREST RPC `withdraw_balance` (see XRGS migrations
// 20260709140000_withdraw_balance.sql and 20260726120100_withdraw_balance_request.sql),
// which is SECURITY DEFINER so it can update the players table despite its RLS
// (the anon key has no UPDATE policy on players, so a direct PostgREST write
// would match no rows).
//
// The debit and the request are one call on purpose: the RPC does both inside a
// single transaction, so the player can never be debited without a matching
// request being recorded (or vice versa). The request lands in the RGS
// `transactions` table as a `Withdraw` row with status `Pending`, visible on the
// platform's Transactions page, for an operator to settle out of band. The money
// is reserved immediately — a pending request is already deducted from the
// balance, so it cannot be spent twice.
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
//
// The request is also attributed to the game it was made in, exactly as the Deposit
// Balance node does: p_game_id carries the Target Game this project was published
// against, read from the project's `rgsgame` metadata (see resolveRgsGame). Absent
// it, the withdrawal is filed exactly as before but shows no game on the platform's
// Transactions page. Nothing to wire — no new input, no graph changes.

const WithdrawBalanceNode = {
  name: 'WithdrawBalance',
  displayNodeName: 'Withdraw Balance',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/withdraw-balance',
  category: 'Data',
  // DEPRECATED 2026-08-04 — withdrawals are switched off across the RGS platform.
  // `withdraw_balance` now raises 'withdrawals are disabled on this platform', has
  // lost EXECUTE for the anon key this node uses, and the pending `transactions`
  // row it used to file would be refused by a trigger (XRGS migration
  // 20260804120100_disable_payment_features). There is nothing left for it to do:
  // with no cashier there is nowhere for a balance to be paid out TO.
  //
  // To take play money off a player, set a lower Demo Balance with **Update
  // Player** — a correction to an account, not a payout.
  //
  // See depositbalance.js for what `deprecated` does and does not change, and why
  // the node stays registered rather than being removed.
  deprecated: true,
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/withdraw_balance), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
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

        // A cashier node running means the game knows who is playing, even if it
        // never used the Get Player ID node. Remember it so the rounds around
        // this call are attributed to the same player. See rgs-play-context.js.
        setCurrentPlayerId(playerID);

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

        // Only send p_game_id when the project knows its game — PostgREST resolves
        // the function by the exact argument set, so sending it against an RGS that
        // still has the older two-argument withdraw_balance would fail the call.
        const game = resolveRgsGame(this);
        const payload = {
          p_player_id: playerID,
          p_withdraw_amount: withdrawAmount
        };
        if (game.id) payload.p_game_id = game.id;

        const endpoint = `${url}/rest/v1/rpc/withdraw_balance`;
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
          game: game.name || game.id || '(none)',
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
