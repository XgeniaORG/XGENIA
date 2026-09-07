'use strict';

const { resolveSupabaseConfig, resolveRgsGame } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Create Deposit (Stripe)
// -----------------------
// Starts a REAL deposit: creates a Stripe Checkout Session for a player + amount
// and, by default, opens the hosted Checkout in a detached browser window so the
// player can pay. In the Electron editor `window.open` is routed to the user's
// external browser (main.js setWindowOpenHandler -> shell.openExternal), i.e. a
// real, detached browser window; in a published web game it opens a separate
// popup window. Opening the payment page in the OS browser (rather than an
// embedded webview) is also the recommended, trusted way to take a payment.
//
// The `checkoutUrl` is still exposed as an output, and `openAutomatically` (default
// true) can be turned off to fall back to the wire-it-yourself flow: `checkoutUrl`
// -> an "External Link" node (and `Done` -> its `Do`).
//
// Web popup-blocker handling: browsers block window.open once an `await` has broken
// the click's user-activation, so on the web this node opens a BLANK popup
// synchronously on the gesture (before the fetch) and navigates it to Checkout
// afterwards. If even that is blocked, it degrades to a same-tab redirect to
// Checkout (Stripe returns the player via success_url). In the Electron editor it
// opens the user's external browser directly (no popup blocker there).
//
// Unlike the "Deposit Balance" node (which credits players.balance
// immediately), this node moves NO balance itself. The balance is credited only
// after the payment settles, by the `stripe-webhook` edge function calling the
// `credit_stripe_deposit` RPC (idempotent by Stripe event id). The balance stays
// a plain players.balance integer — we just gate the credit behind a real payment.
//
// That same RPC also records the deposit in the RGS `transactions` table as a
// `Deposit (Stripe)` row with status `Done`, visible on the platform's
// Transactions page, with the Stripe event id in external_tx_id so the row can be
// traced back to the Stripe dashboard (see XRGS migration
// 20260726120400_stripe_deposit_transaction.sql). The row is written inside the
// event-id dedup, so a Stripe retry/resend records nothing further.
//
// It POSTs { playerID, amount, gameID } to the `create-checkout-session` edge
// function at `${url}/functions/v1/create-checkout-session` (note: the RPC-backed
// data nodes hit `/rest/v1/rpc/...` instead). `amount` is in minor units (e.g.
// cents) of the player's currency, matching players.balance. Supabase connection
// (url + anon key) is resolved the same way as the other RGS-backed nodes. See
// rgs-config.js.
//
// `gameID` is the Target Game this project was published against, read from the
// project's `rgsgame` metadata (see resolveRgsGame). It is stored in the Checkout
// Session's metadata and read back by `stripe-webhook` when the payment settles, so
// the deposit shows a game on the platform's Transactions page instead of "—".
// Absent it, the deposit is credited and recorded exactly as before.

const CreateStripeDepositNode = {
  name: 'CreateStripeDeposit',
  displayNodeName: 'Create Deposit (Stripe)',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/create-deposit-stripe',
  category: 'Data',
  // TEMPORARILY DISABLED (2026-07-26). `deprecated` hides the node from the node
  // picker and the search index (NodePicker.utils.ts) and refuses new instances
  // with a message (componentmodel.ts canCreateNode), while leaving every
  // EXISTING instance loading, running and publishing exactly as before — which
  // deleting the node or commenting out its registration would not: those turn
  // saved projects that already use it into unknown-type graphs.
  //
  // Nothing else here is stubbed out, so re-enabling is deleting this one line
  // (plus a viewer-bundle rebuild, since the editor reads node metadata from
  // src/external/viewer/xgenia.viewer.js, not from this file).
  deprecated: true,
  color: 'data',
  // Calls the RGS platform itself (the create-checkout-session edge function under
  // /functions/v1) and then needs the browser to reach Stripe Checkout, so it never
  // routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: ['balance', 'deposit', 'stripe', 'payment', 'checkout', 'pay', 'player', 'wallet', 'credit', 'funds', 'money', 'rgs', 'cloud', 'top up', 'top-up'],
  initialize: function () {
    this._internal.playerID = '';
    this._internal.amount = 0;
    this._internal.openAutomatically = true;
    this._internal.checkoutUrl = '';
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
        this.createCheckoutSession();
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
    amount: {
      type: 'number',
      displayName: 'Amount',
      group: 'General',
      default: 0,
      set: function (value) {
        this._internal.amount = value;
      }
    },
    openAutomatically: {
      type: 'boolean',
      displayName: 'Open Automatically',
      group: 'General',
      default: true,
      set: function (value) {
        this._internal.openAutomatically = value;
      }
    }
  },
  outputs: {
    checkoutUrl: {
      displayName: 'Checkout URL',
      type: 'string',
      group: 'Result',
      getter: function () {
        return this._internal.checkoutUrl;
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
    openCheckout: function (url, ctx) {
      // Send the player to the hosted Checkout using the most reliable mechanism
      // for the current environment. Returns the method used (for the inspector).
      // See createCheckoutSession for why the web path pre-opens a popup.
      ctx = ctx || {};
      if (!ctx.hasWindow) {
        return 'none'; // cloud runtime — no window/DOM
      }
      // Electron editor: window.open is routed to the user's real browser
      // (main-window setWindowOpenHandler -> shell.openExternal). No popup blocker
      // applies, so opening after the await is fine.
      if (ctx.isElectron) {
        try {
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
          console.error('Create Deposit (Stripe): open failed:', e);
        }
        return 'external';
      }
      // Web: reuse the blank popup opened on the click gesture, if it survived the
      // async gap, and just navigate it to Checkout.
      if (ctx.popup && !ctx.popup.closed) {
        try {
          ctx.popup.location.href = url;
          if (typeof ctx.popup.focus === 'function') {
            try { ctx.popup.focus(); } catch (e) { /* cross-origin focus can throw */ }
          }
          return 'popup';
        } catch (e) {
          try { ctx.popup.close(); } catch (e2) { /* ignore */ }
        }
      }
      // Popup blocked (e.g. the deposit ran outside the click's activation): fall
      // back to a same-tab redirect, which browsers do not popup-block. Stripe
      // returns the player via the session success_url.
      try {
        window.location.assign(url);
        return 'redirect';
      } catch (e) {
        console.error('Create Deposit (Stripe): redirect failed:', e);
        return 'none';
      }
    },
    createCheckoutSession: async function () {
      this._internal.lastError = null;
      this._internal.checkoutUrl = '';
      let ok = false;

      const openAutoRaw = this.getInputValue('openAutomatically');
      const openAutomatically =
        openAutoRaw !== undefined ? openAutoRaw !== false : this._internal.openAutomatically !== false;

      const hasWindow = typeof window !== 'undefined' && typeof window.open === 'function';
      const isElectron =
        hasWindow &&
        typeof navigator !== 'undefined' &&
        typeof navigator.userAgent === 'string' &&
        navigator.userAgent.indexOf('Electron') !== -1;

      // Blank popup pre-opened on the web (below), navigated to Checkout later.
      let popup = null;

      try {
        const playerID = (this.getInputValue('playerID') || this._internal.playerID || '').toString();

        // A cashier node running means the game knows who is playing, even if it
        // never used the Get Player ID node. Remember it so the rounds around
        // this call are attributed to the same player. See rgs-play-context.js.
        setCurrentPlayerId(playerID);

        const rawAmount = this.getInputValue('amount');
        const amount = Number(rawAmount !== undefined ? rawAmount : this._internal.amount);

        if (!playerID.trim()) {
          throw new Error('playerID is required');
        }
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('amount must be a positive number (minor units, e.g. cents)');
        }

        const { url, anonKey } = this.getSupabaseConfig();
        if (!url || !anonKey) {
          throw new Error('No Supabase cloud service configured (missing url or anon key).');
        }

        // Which game this deposit belongs to; empty in an editor preview and in
        // projects published before the deploy flow started stamping it.
        const game = resolveRgsGame(this);

        const endpoint = `${url}/functions/v1/create-checkout-session`;

        // IMPORTANT: open the blank popup NOW, synchronously, before the first
        // await. On the web a browser blocks window.open once an await has broken
        // the user-gesture chain, so opening here (still within the click) is what
        // keeps the popup from being blocked; we navigate it to Checkout once the
        // session exists. Skipped in Electron (window.open is routed to the
        // external browser, so a blank '' would open a stray tab) and when
        // auto-open is off. If this returns null the popup was blocked and
        // openCheckout() falls back to a same-tab redirect.
        if (openAutomatically && hasWindow && !isElectron) {
          try {
            popup = window.open('', '_blank', 'popup=1,width=480,height=760');
          } catch (e) {
            popup = null;
          }
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            playerID: playerID,
            amount: amount,
            // Omitted when the project does not know its game; the edge function
            // then leaves the game out of the Checkout Session's metadata.
            gameID: game.id || undefined
          })
        });

        if (!response.ok) {
          let detail = '';
          try {
            detail = JSON.stringify(await response.json());
          } catch (e) {
            detail = response.statusText;
          }
          throw new Error(`Create checkout session failed: ${response.status} ${detail}`);
        }

        const data = await response.json().catch(function () {
          return null;
        });
        const checkoutUrl = data && data.url;

        if (!checkoutUrl) {
          throw new Error('Invalid response from create-checkout-session: missing url');
        }

        this._internal.checkoutUrl = checkoutUrl;
        ok = true;

        let openMethod = 'disabled';
        if (openAutomatically) {
          openMethod = this.openCheckout(checkoutUrl, {
            popup: popup,
            isElectron: isElectron,
            hasWindow: hasWindow
          });
        } else if (popup) {
          try { popup.close(); } catch (e) { /* ignore */ }
        }
        popup = null; // handed off (or closed) — don't re-close in catch

        this._internal.inspectData = {
          playerID: playerID,
          amount: amount,
          game: game.name || game.id || '(none)',
          checkoutUrl: checkoutUrl,
          openMethod: openMethod,
          isSuccessful: true
        };

        this.flagOutputDirty('checkoutUrl');
      } catch (error) {
        // Close the pre-opened blank popup if we failed before using it.
        if (popup) {
          try { popup.close(); } catch (e) { /* ignore */ }
        }
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Create Deposit (Stripe) error:', error);
      } finally {
        this._internal.isSuccessful = ok;
        this.flagOutputDirty('isSuccessful');
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: CreateStripeDepositNode
};
