'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');
const { describeRgsFailure } = require('./rgs-error');

// Update Player
// -------------
// Updates an EXISTING player on the RGS platform: renames them and/or sets their
// play-money balance. One REST request to the Supabase PostgREST RPC
// `update_player` (see XRGS migration 20260804120000_player_admin_rpcs.sql), which
// is SECURITY DEFINER so it can write the players table despite its RLS — the anon
// key has no UPDATE policy there, so a direct PostgREST write would match no rows.
//
// One of three nodes that replace "Get Player ID by Player Name" (now deprecated),
// alongside Create New Player and Get Player. This is how a player's balance
// changes now that deposits, withdrawals and operator top-ups are switched off
// platform-wide: it is a setting on the player, not a money movement, and it
// writes no Transactions row.
//
// ADDRESSED BY ID OR BY NAME. Wire Player ID if you have it (it is stable and
// cannot collide); Player Name works when you do not. Player ID wins when both
// are given. Note the asymmetry: Player Name is how the player is FOUND, New
// Player Name is what they are renamed TO. They are two ports because a rename
// needs both halves, and collapsing them would make "look up" and "rename"
// indistinguishable.
//
// THE PLAYER ID CANNOT BE CHANGED, by design. Every round, session and log row on
// the platform already points at it, so it is an identity, not a field. There is
// no port for it and the RPC has no parameter for it.
//
// BLANK MEANS LEAVE ALONE. New Player Name and Demo Balance are both optional: an
// untouched port sends nothing and that field is not written, so a graph that only
// wants to move the balance leaves the name where it is. Demo Balance is declared
// with NO default precisely so that this works — an unset numeric port reads
// `undefined` (see registerInput in node.js), which leaves 0 free to mean "set the
// balance to zero" rather than "no opinion".
//
// AMOUNTS ARE MINOR UNITS: 1000 = 10.00. The value is a SET, not an increment —
// this is not a deposit. The RPC rounds to a whole minor unit and refuses a
// negative balance.
//
// DEMO MONEY ONLY. There is deliberately no input for the live (real-money)
// balance and the RPC will not write one — real money can only arrive through a
// payment rail, and the platform no longer has one.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes.

// A port that was never touched reads as undefined; one that was typed into and
// cleared can come back as an empty string. Both mean "not provided".
function isBlank(value) {
  return value === undefined || value === null || value.toString().trim() === '';
}

const UpdatePlayerNode = {
  name: 'UpdatePlayer',
  displayNodeName: 'Update Player',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/update-player',
  category: 'Data',
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/update_player), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: [
    'player',
    'update',
    'edit',
    'change',
    'modify',
    'rename',
    'set',
    'name',
    'display name',
    'balance',
    'demo balance',
    'play money',
    'rgs',
    'cloud'
  ],
  initialize: function () {
    this._internal.playerId = undefined;
    this._internal.playerName = undefined;
    this._internal.newPlayerName = undefined;
    this._internal.demoBalance = undefined;
    this._internal.resultPlayerId = null;
    this._internal.resultPlayerName = '';
    this._internal.resultDemoBalance = 0;
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
        this.updatePlayer();
      }
    },
    // ── Which player ──
    playerId: {
      type: 'string',
      displayName: 'Player ID',
      group: 'Identify',
      // No default: see the header. Blank means "identify by name instead".
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
    },
    // ── What to change ──
    newPlayerName: {
      type: 'string',
      displayName: 'New Player Name',
      group: 'Update',
      set: function (value) {
        this._internal.newPlayerName = value;
      }
    },
    demoBalance: {
      type: 'number',
      displayName: 'Demo Balance',
      group: 'Update',
      // Deliberately NO default — see the header. With `default: 0` an untouched
      // port would zero every player it ran against.
      set: function (value) {
        this._internal.demoBalance = value;
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
      // The name AFTER the update, so a graph that renamed someone does not have
      // to reconstruct what it asked for.
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
    isSuccessful: {
      displayName: 'Is Successful',
      type: 'boolean',
      group: 'Result',
      getter: function () {
        return this._internal.isSuccessful;
      }
    },
    error: {
      displayName: 'Error',
      type: 'string',
      group: 'Result',
      // Empty on success; otherwise the platform's own message — 'no player named
      // "x" found', 'a player named "y" already exists'.
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
    updatePlayer: async function () {
      this._internal.lastError = null;
      let ok = false;
      let error = '';
      let resultPlayerId = null;
      let resultPlayerName = '';
      let resultDemoBalance = 0;

      try {
        const rawPlayerId = this.getInputValue('playerId') !== undefined
          ? this.getInputValue('playerId')
          : this._internal.playerId;
        const rawPlayerName = this.getInputValue('playerName') !== undefined
          ? this.getInputValue('playerName')
          : this._internal.playerName;
        const rawNewName = this.getInputValue('newPlayerName') !== undefined
          ? this.getInputValue('newPlayerName')
          : this._internal.newPlayerName;
        const rawBalance = this.getInputValue('demoBalance') !== undefined
          ? this.getInputValue('demoBalance')
          : this._internal.demoBalance;

        const playerId = isBlank(rawPlayerId) ? null : rawPlayerId.toString().trim();
        const playerName = isBlank(rawPlayerName) ? null : rawPlayerName.toString().trim();
        const newPlayerName = isBlank(rawNewName) ? null : rawNewName.toString().trim();

        if (!playerId && !playerName) {
          throw new Error('either playerId or playerName is required to identify the player');
        }

        // Checked here as well as in the RPC so a graph that wired nothing to
        // either Update port gets told, instead of quietly making one round trip
        // that changes nothing and reports success.
        let demoBalance = null;
        if (!isBlank(rawBalance)) {
          demoBalance = Number(rawBalance);
          if (!Number.isFinite(demoBalance) || demoBalance < 0) {
            throw new Error('demoBalance must be zero or a positive number');
          }
        }

        if (!newPlayerName && demoBalance === null) {
          throw new Error('nothing to update: set New Player Name and/or Demo Balance');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        // Only send the arguments this call actually means. PostgREST resolves an
        // RPC by the exact set of named arguments it is given, and every parameter
        // on update_player defaults to NULL = "leave alone", so omitting a key and
        // sending it as null mean the same thing to the database — sending only
        // what was asked for keeps the request self-describing in a network log.
        const payload = {};
        if (playerId) payload.p_player_id = playerId;
        if (playerName) payload.p_display_name = playerName;
        if (newPlayerName) payload.p_new_display_name = newPlayerName;
        if (demoBalance !== null) payload.p_demo_balance = demoBalance;

        const endpoint = `${url}/rest/v1/rpc/update_player`;
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

        // PostgREST returns RETURNS TABLE results as an array of rows.
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : data;

        if (!row || !row.player_id) {
          throw new Error('Invalid response from RGS: missing player_id');
        }

        resultPlayerId = row.player_id;
        resultPlayerName = row.display_name || '';
        resultDemoBalance = Number(row.demo_balance || 0);
        ok = true;

        // The game knows who is playing. Remember it so the rounds around this
        // call are attributed to this player rather than the browser's anonymous
        // guest. See rgs-play-context.js.
        setCurrentPlayerId(resultPlayerId);

        this._internal.inspectData = {
          identifiedBy: playerId ? 'playerId' : 'playerName',
          playerId: resultPlayerId,
          playerName: resultPlayerName,
          renamedTo: newPlayerName || '(unchanged)',
          demoBalance: resultDemoBalance,
          demoBalanceSet: demoBalance !== null,
          liveBalance: row.live_balance !== undefined ? row.live_balance : 0,
          isSuccessful: true
        };
      } catch (err) {
        error = err.message;
        this._internal.lastError = error;
        this._internal.inspectData = { isSuccessful: false, error: error };
        console.error('Update Player error:', err);
      }

      this._internal.resultPlayerId = resultPlayerId;
      this._internal.resultPlayerName = resultPlayerName;
      this._internal.resultDemoBalance = resultDemoBalance;
      this._internal.isSuccessful = ok;
      this._internal.error = error;
      this.flagOutputDirty('playerId');
      this.flagOutputDirty('playerName');
      this.flagOutputDirty('demoBalance');
      this.flagOutputDirty('isSuccessful');
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: UpdatePlayerNode
};
