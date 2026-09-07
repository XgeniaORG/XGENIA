'use strict';

const { resolveSupabaseConfig, resolveRgsGame } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Deposit Balance
// ---------------
// Adds a deposit amount to a player's balance on the RGS platform AND records
// the deposit there. The node sends one REST request to the Supabase PostgREST
// RPC `deposit_balance` (see XRGS migrations 20260709130000_deposit_balance.sql
// and 20260726120300_deposit_balance_transaction.sql), which is SECURITY DEFINER
// so it can update the players table despite its RLS (the anon key has no
// UPDATE policy on players, so a direct PostgREST write would match no rows).
//
// The credit and the record are one call on purpose: the RPC does both inside a
// single transaction, so a player can never be credited without a matching
// record (or vice versa). The deposit lands in the RGS `transactions` table as a
// `Deposit` row, visible on the platform's Transactions page. Unlike a
// withdrawal — which is a request an operator still has to settle, so it starts
// `Pending` — a deposit here is instant and complete, so its status is `Done`.
//
// balance is stored in minor units (bigint); the RPC rounds the amount to the
// nearest whole minor unit and rejects non-positive amounts / unknown players
// with a non-2xx response, which the node reports as isSuccessful = false.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes (e.g. Save Game
// Session, Get Player ID by Player Name).
//
// The deposit is also attributed to the game it was made in. The RPC sees only a
// player and an amount, so the game has to be told: p_game_id carries the Target
// Game this project was published against, which the deploy flow stamps into the
// project's `rgsgame` metadata (see resolveRgsGame). Without it the deposit still
// credits exactly as before, it just shows no game on the platform's Transactions
// page — which is what every deposit did until now. Nothing to wire: the node reads
// it from the published project, so no new input and no graph changes.

const DepositBalanceNode = {
  name: 'DepositBalance',
  displayNodeName: 'Deposit Balance',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/deposit-balance',
  category: 'Data',
  // DEPRECATED 2026-08-04 — deposits are switched off across the RGS platform.
  // `deposit_balance` now raises 'deposits are disabled on this platform', has lost
  // EXECUTE for the anon key this node uses, and a trigger on `transactions` would
  // refuse the row anyway (XRGS migration 20260804120100_disable_payment_features).
  // So this node can no longer succeed, whatever it is wired to.
  //
  // What to use instead: a player's play money is set where the player is — the
  // Initial Demo Balance on **Create New Player**, or the Demo Balance on **Update
  // Player**. That is a setting on the account rather than a money movement, which
  // is the whole point of the change: no cashier, no ledger row, no payment rail.
  //
  // `deprecated` hides it from the node picker and the search index and refuses new
  // instances, while leaving existing instances loading and publishing — deleting
  // the node or commenting out its registration would instead turn every saved
  // project that uses it into an unknown-type graph. Nothing below is stubbed out,
  // so re-enabling is deleting this one line (plus reversing that migration and a
  // viewer-bundle rebuild).
  deprecated: true,
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/deposit_balance), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
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

        // A cashier node running means the game knows who is playing, even if it
        // never used the Get Player ID node. Remember it so the rounds around
        // this call are attributed to the same player. See rgs-play-context.js.
        setCurrentPlayerId(playerID);

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

        // Only send p_game_id when the project actually knows its game. Sending it
        // unconditionally would break against an RGS that still has the older
        // two-argument deposit_balance, since PostgREST resolves the function by the
        // exact set of arguments it is given.
        const game = resolveRgsGame(this);
        const payload = {
          p_player_id: playerID,
          p_deposit_amount: depositAmount
        };
        if (game.id) payload.p_game_id = game.id;

        const endpoint = `${url}/rest/v1/rpc/deposit_balance`;
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
          depositAmount: depositAmount,
          game: game.name || game.id || '(none)',
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
