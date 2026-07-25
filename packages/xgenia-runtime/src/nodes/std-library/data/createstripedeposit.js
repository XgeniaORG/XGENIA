'use strict';

const { resolveSupabaseConfig } = require('./rgs-config');

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
// -> an "External Link" node (and `Done` -> its `Do`). Auto-open can be blocked by
// a browser popup blocker in a web build when not triggered by a user gesture (a
// button press is fine); the URL output is the fallback for that case.
//
// Unlike the mock "Deposit Balance" node (which credits players.balance
// immediately), this node moves NO balance itself. The balance is credited only
// after the payment settles, by the `stripe-webhook` edge function calling the
// `credit_stripe_deposit` RPC (idempotent by Stripe event id). The balance stays
// a plain players.balance integer — we just gate the credit behind a real payment.
//
// It POSTs { playerID, amount } to the `create-checkout-session` edge function at
// `${url}/functions/v1/create-checkout-session` (note: the mock data nodes hit
// `/rest/v1/rpc/...` instead). `amount` is in minor units (e.g. cents) of the
// player's currency, matching players.balance. Supabase connection (url + anon
// key) is resolved the same way as the other RGS-backed nodes. See rgs-config.js.

const CreateStripeDepositNode = {
  name: 'CreateStripeDeposit',
  displayNodeName: 'Create Deposit (Stripe)',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/create-deposit-stripe',
  category: 'Data',
  color: 'data',
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
    openCheckout: function (url) {
      // Open the hosted Checkout in a detached browser window. In the Electron
      // editor, window.open is intercepted by the main-window setWindowOpenHandler
      // and routed to shell.openExternal (the user's real browser); in a published
      // web game it opens a separate popup window. No-ops in the cloud runtime,
      // which has no window object.
      if (typeof window === 'undefined' || typeof window.open !== 'function') {
        return;
      }
      try {
        const features = 'popup=1,width=480,height=760,noopener,noreferrer';
        const opened = window.open(url, '_blank', features);
        if (opened && typeof opened.focus === 'function') {
          try {
            opened.focus();
          } catch (e) {
            /* focus may throw for cross-origin popups; ignore */
          }
        }
      } catch (e) {
        console.error('Create Deposit (Stripe): failed to open checkout window:', e);
      }
    },
    createCheckoutSession: async function () {
      this._internal.lastError = null;
      this._internal.checkoutUrl = '';
      let ok = false;

      try {
        const playerID = (this.getInputValue('playerID') || this._internal.playerID || '').toString();

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

        const endpoint = `${url}/functions/v1/create-checkout-session`;
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
          },
          body: JSON.stringify({
            playerID: playerID,
            amount: amount
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

        const openAutoRaw = this.getInputValue('openAutomatically');
        const openAutomatically =
          openAutoRaw !== undefined ? openAutoRaw !== false : this._internal.openAutomatically !== false;

        let openAttempted = false;
        if (openAutomatically) {
          openAttempted = true;
          // Best-effort: opens a detached browser window (the external browser in
          // the Electron editor). The return value is unreliable (Electron denies
          // the in-app window; noopener returns null on the web), so a null handle
          // is NOT treated as failure — the checkoutUrl output is the fallback.
          this.openCheckout(checkoutUrl);
        }

        this._internal.inspectData = {
          playerID: playerID,
          amount: amount,
          checkoutUrl: checkoutUrl,
          openAttempted: openAttempted,
          isSuccessful: true
        };

        this.flagOutputDirty('checkoutUrl');
      } catch (error) {
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
