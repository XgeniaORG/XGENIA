'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');
const { describeRgsFailure } = require('./rgs-error');

// Create New Player
// -----------------
// Registers a NEW player on the RGS platform with an opening play-money balance
// and returns their Player ID. One REST request to the Supabase PostgREST RPC
// `create_player` (see XRGS migration 20260804120000_player_admin_rpcs.sql), which
// is SECURITY DEFINER so it can insert into the players table despite its RLS —
// the anon key has no INSERT policy there.
//
// WHY THIS EXISTS. It is one of three nodes that replace "Get Player ID by Player
// Name" (now deprecated): Create New Player, Update Player and Get Player. That
// node did two jobs behind one name — look up OR create — and the player it
// created always started on a zero balance, so a game had to follow it with
// Deposit Balance before anything could be staked. Deposits, withdrawals and
// operator top-ups are now switched off platform-wide, so there is no second step
// to make: the opening balance is set here, at registration.
//
// IT REFUSES A NAME THAT IS TAKEN. That is the difference from the old node, and
// the reason this is a separate node rather than a flag on it. Returning the
// existing player would quietly turn "create this player with 5000 to play with"
// into "adopt whoever already has that name", and then have to decide whether to
// overwrite their balance. Use Get Player to look one up, or Update Player to
// change one. `isSuccessful` goes false and `error` carries the reason, so a
// registration form can say "that name is taken" rather than just failing.
//
// AMOUNTS ARE MINOR UNITS, like every balance on the platform: 1000 = 10.00. The
// RPC rounds to a whole minor unit and refuses a negative opening balance.
//
// DEMO MONEY ONLY. There is deliberately no input for the live (real-money)
// balance and the RPC will not write one — real money can only arrive through a
// payment rail, and the platform no longer has one.
//
// Supabase connection (url + anon key) comes from the project's `cloudservices`
// metadata, the same source used by the other RGS-backed nodes.

const CreateNewPlayerNode = {
  name: 'CreateNewPlayer',
  displayNodeName: 'Create New Player',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/create-new-player',
  category: 'Data',
  color: 'data',
  // Calls the RGS platform itself (POST /rest/v1/rpc/create_player), so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: [
    'player',
    'create',
    'new',
    'register',
    'registration',
    'sign up',
    'signup',
    'add',
    'name',
    'display name',
    'balance',
    'demo balance',
    'play money',
    'rgs',
    'cloud'
  ],
  initialize: function () {
    this._internal.playerName = '';
    this._internal.demoBalance = 0;
    this._internal.playerId = null;
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
        this.createPlayer();
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
    },
    demoBalance: {
      type: 'number',
      displayName: 'Initial Demo Balance',
      group: 'General',
      // Minor units. 0 is a valid opening balance — a player who has to be given
      // money by Update Player before they can stake anything.
      default: 0,
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
        return this._internal.playerId;
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
      // Empty on success. Carries the platform's own message on failure — most
      // usefully 'a player named "x" already exists', which a registration form
      // wants to show the person typing.
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
    createPlayer: async function () {
      this._internal.lastError = null;
      let ok = false;
      let playerId = null;
      let error = '';

      try {
        const playerName = (this.getInputValue('playerName') || this._internal.playerName || '').toString();

        if (!playerName.trim()) {
          throw new Error('playerName is required');
        }

        const rawBalance = this.getInputValue('demoBalance');
        const demoBalance = Number(rawBalance !== undefined ? rawBalance : this._internal.demoBalance);

        if (!Number.isFinite(demoBalance) || demoBalance < 0) {
          throw new Error('demoBalance must be zero or a positive number');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        const endpoint = `${url}/rest/v1/rpc/create_player`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            p_display_name: playerName,
            p_demo_balance: demoBalance
          })
        });

        if (!response.ok) {
          // The platform's own message is the useful part ("a player named ...
          // already exists"), so pull it out of the PostgREST error envelope
          // rather than reporting a bare status code. See rgs-error.js.
          throw new Error(await describeRgsFailure(response));
        }

        // PostgREST returns RETURNS TABLE results as an array of rows.
        const data = await response.json();
        const row = Array.isArray(data) ? data[0] : data;

        if (!row || !row.player_id) {
          throw new Error('Invalid response from RGS: missing player_id');
        }

        playerId = row.player_id;
        ok = true;

        // This is a deployed game telling us who is playing. Remember it, so the
        // rounds that follow are attributed to this player instead of the
        // browser's anonymous guest. See rgs-play-context.js.
        setCurrentPlayerId(playerId);

        this._internal.inspectData = {
          playerName: playerName,
          playerId: playerId,
          demoBalance: row.demo_balance !== undefined ? row.demo_balance : demoBalance,
          liveBalance: row.live_balance !== undefined ? row.live_balance : 0,
          isSuccessful: true
        };
      } catch (err) {
        error = err.message;
        this._internal.lastError = error;
        this._internal.inspectData = { isSuccessful: false, error: error };
        console.error('Create New Player error:', err);
      }

      this._internal.playerId = playerId;
      this._internal.isSuccessful = ok;
      this._internal.error = error;
      this.flagOutputDirty('playerId');
      this.flagOutputDirty('isSuccessful');
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('Done');
    }
  }
};

module.exports = {
  node: CreateNewPlayerNode
};
