'use strict';

const { resolveSupabaseConfig, resolveRgsGame } = require('./rgs-config');
const { setCurrentPlayerId } = require('./rgs-play-context');

// Create Deposit
// --------------
// Starts a player deposit: asks the RGS platform to open one and, by default,
// sends the player to the payment page so they can pay.
//
// This REPLACES "Create Deposit (Stripe)" (createstripedeposit.js, now
// deprecated). Stripe prohibits gambling in its Restricted Businesses list, so
// that node could never be used for real: the replacement names no payment
// company at all. Which processor actually takes the money is the platform's
// decision, not the game's — the platform's own PSP_PROVIDER setting picks it,
// and this node calls the same endpoint either way. A game built against this
// node keeps working when the operator switches processor, with no rewiring and
// no re-publish.
//
// WHAT IT DOES NOT DO
// ------------------
// It moves NO balance. Unlike the "Deposit Balance" node (which credits the
// player immediately, with no payment rail at all), this node only opens a
// deposit; the balance is credited when the payment settles, by the platform's
// webhook. So `isSuccessful` here means "the payment page was opened", never
// "the player has been credited" — read the balance again after the player
// returns (Get Balance By Player Id) rather than assuming the money arrived.
//
// DEMO BY DEFAULT
// --------------
// The deposit lands in the player's DEMO pot unless the platform says otherwise,
// and the node has no input that can change that. Deliberate: which pot is
// credited follows the TARGET GAME's mode on the platform, decided by whoever
// owns the game, in the database. A game cannot talk its way into real money by
// setting a port, and a project cannot take a real payment by accident in an
// editor preview.
//
// Amount is in minor units (e.g. cents) of the player's currency, matching the
// balance it will be credited to — 1000 is 10.00, not 1000.00.
//
// OPENING THE PAYMENT PAGE
// -----------------------
// Identical handling to the node it replaces, and the reasons are unchanged:
//   * Electron editor — window.open is routed to the user's real browser by the
//     main window's setWindowOpenHandler (shell.openExternal). No popup blocker.
//   * Published web — a node runs on the runtime's next animation frame, past the
//     click's user-activation window, so window.open('_blank') is blocked. The
//     node therefore opens a BLANK popup synchronously on the gesture (before the
//     fetch) and navigates it afterwards; if even that is blocked it degrades to a
//     same-tab redirect, and the player comes back via the return URL.
// Set `openAutomatically` to false to wire `paymentUrl` into an External Link
// node yourself instead.
//
// CRYPTO IS DIFFERENT: THERE IS NO PAGE
// ------------------------------------
// When the platform's provider is `crypto`, the player pays from their own wallet
// and there is nowhere to send them. The node opens nothing (navigating to an
// `ethereum:` URI would only raise an "unknown protocol" dialog on a desktop) and
// instead fills in the Crypto outputs — Deposit Address, Token Amount, Token and
// Network — for the game to display. `Payment URL` then holds an EIP-681 request
// URI, which is what belongs in a QR code or behind a mobile "open wallet" link.
//
// Nothing about the game's wiring changes between providers: the same Do/Player
// ID/Amount inputs serve all three, and the outputs a given provider does not use
// are simply empty.

const CreateDepositNode = {
  name: 'CreateDeposit',
  displayNodeName: 'Create Deposit',
  docs: 'https://docsapp.xgenia.com/nodes/data/cloud-data/create-deposit',
  category: 'Data',
  // DEPRECATED 2026-08-04 — deposits are switched off across the RGS platform, so
  // all three providers behind this node are closed at once. It opens a deposit
  // through `create-deposit-session`, which now returns 503 "payments are disabled"
  // from its first line (functions/_shared/payments-disabled.ts), and the
  // create_deposit_intent / settle_psp_deposit RPCs under it refuse regardless
  // (XRGS migration 20260804120100_disable_payment_features). Nothing is credited
  // by any route: demo cashier, Nuvei hosted page, or USDC on Base.
  //
  // What to use instead: a player's play money is set where the player is — the
  // Initial Demo Balance on **Create New Player**, or the Demo Balance on **Update
  // Player**.
  //
  // See depositbalance.js for what `deprecated` does and does not change. Note this
  // node is the SUCCESSOR to CreateStripeDeposit, which was already deprecated —
  // both are now off, and the whole Transactions category with them.
  deprecated: true,
  color: 'data',
  // Calls the RGS platform directly (the create-deposit-session edge function
  // under /functions/v1) and then needs the browser to reach the payment page, so
  // it never routes to a generated backend edge function: no `isMath` toggle.
  usesBackendServices: true,
  searchTags: [
    'balance', 'deposit', 'payment', 'pay', 'cashier', 'checkout', 'player',
    'wallet', 'credit', 'funds', 'money', 'card', 'rgs', 'cloud', 'top up',
    'top-up', 'nuvei', 'psp', 'stripe', 'crypto', 'usdc', 'usdt', 'stablecoin',
    'onchain', 'on-chain', 'base', 'web3', 'bitcoin', 'ethereum'
  ],
  initialize: function () {
    this._internal.playerID = '';
    this._internal.amount = 0;
    this._internal.openAutomatically = true;
    this._internal.paymentUrl = '';
    this._internal.depositAddress = '';
    this._internal.tokenAmount = '';
    this._internal.tokenSymbol = '';
    this._internal.chainName = '';
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
        this.createDeposit();
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
    paymentUrl: {
      displayName: 'Payment URL',
      type: 'string',
      group: 'Result',
      getter: function () {
        return this._internal.paymentUrl;
      }
    },
    // ── Crypto only ────────────────────────────────────────────────────────
    // Empty for every other provider. A crypto deposit has no payment page to
    // send the player to: they pay from their own wallet, so the game has to show
    // them WHERE to send it. These are those details.
    //
    // `Payment URL` still carries an EIP-681 request URI in this case, which is
    // what belongs in a QR code and what a mobile wallet link should point at —
    // it encodes the token, the chain, the address and the exact amount, so the
    // player cannot mistype any of it.
    depositAddress: {
      displayName: 'Deposit Address',
      type: 'string',
      group: 'Crypto',
      getter: function () {
        return this._internal.depositAddress;
      }
    },
    tokenAmount: {
      displayName: 'Token Amount',
      type: 'string',
      group: 'Crypto',
      getter: function () {
        return this._internal.tokenAmount;
      }
    },
    tokenSymbol: {
      displayName: 'Token',
      type: 'string',
      group: 'Crypto',
      getter: function () {
        return this._internal.tokenSymbol;
      }
    },
    chainName: {
      displayName: 'Network',
      type: 'string',
      group: 'Crypto',
      getter: function () {
        return this._internal.chainName;
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
    openPaymentPage: function (url, ctx) {
      // Send the player to the payment page using the most reliable mechanism for
      // the current environment. Returns the method used (for the inspector).
      ctx = ctx || {};
      if (!ctx.hasWindow) {
        return 'none'; // cloud runtime — no window/DOM
      }
      // Electron editor: window.open is routed to the user's real browser, so
      // opening after the await is fine.
      if (ctx.isElectron) {
        try {
          window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
          console.error('Create Deposit: open failed:', e);
        }
        return 'external';
      }
      // Web: reuse the blank popup opened on the click gesture, if it survived the
      // async gap, and just navigate it to the payment page.
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
      // back to a same-tab redirect, which browsers do not popup-block. The
      // player returns via the platform's success/cancel URL.
      try {
        window.location.assign(url);
        return 'redirect';
      } catch (e) {
        console.error('Create Deposit: redirect failed:', e);
        return 'none';
      }
    },
    createDeposit: async function () {
      this._internal.lastError = null;
      this._internal.paymentUrl = '';
      this._internal.depositAddress = '';
      this._internal.tokenAmount = '';
      this._internal.tokenSymbol = '';
      this._internal.chainName = '';
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

      // Blank popup pre-opened on the web (below), navigated to the payment page later.
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
        // projects published before the deploy flow started stamping it. The
        // platform reads the game's mode off this to decide which pot is credited,
        // so without it a deposit is demo — which is the right way round.
        const game = resolveRgsGame(this);

        const endpoint = `${url}/functions/v1/create-deposit-session`;

        // IMPORTANT: open the blank popup NOW, synchronously, before the first
        // await — see the note at the top of this file. Skipped in Electron
        // (window.open goes to the external browser, so a blank '' would open a
        // stray tab) and when auto-open is off. If this returns null the popup was
        // blocked and openPaymentPage() falls back to a same-tab redirect.
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
            // Omitted when the project does not know its game; the platform then
            // treats the deposit as demo.
            gameID: game.id || undefined
            // No `mode` and no `provider`: both are the platform's to decide. See
            // the note at the top of this file.
          })
        });

        if (!response.ok) {
          let detail = '';
          try {
            detail = JSON.stringify(await response.json());
          } catch (e) {
            detail = response.statusText;
          }
          throw new Error(`Create deposit failed: ${response.status} ${detail}`);
        }

        const data = await response.json().catch(function () {
          return null;
        });
        const paymentUrl = data && data.url;

        if (!paymentUrl) {
          throw new Error('Invalid response from create-deposit-session: missing url');
        }

        this._internal.paymentUrl = paymentUrl;
        ok = true;

        // Crypto pays from the player's own wallet, so there is no page to send
        // them to and nothing to navigate. The address and amount come back as
        // outputs for the game to display (with the URI above for a QR code).
        const crypto = (data && data.crypto) || null;
        if (crypto) {
          this._internal.depositAddress = (crypto.address || '').toString();
          this._internal.tokenAmount = (crypto.tokenAmount || '').toString();
          this._internal.tokenSymbol = (crypto.token || '').toString();
          this._internal.chainName = (crypto.chainName || '').toString();
          this.flagOutputDirty('depositAddress');
          this.flagOutputDirty('tokenAmount');
          this.flagOutputDirty('tokenSymbol');
          this.flagOutputDirty('chainName');
        }

        let openMethod = 'disabled';
        if (crypto) {
          // Navigating to an `ethereum:` URI does nothing useful on a desktop and
          // would pop an "unknown protocol" dialog, so the blank popup opened on
          // the click is closed instead. Wire `Payment URL` into a QR code, or
          // into an External Link node yourself for a mobile wallet hand-off.
          if (popup) {
            try { popup.close(); } catch (e) { /* ignore */ }
          }
          openMethod = 'crypto: pay from wallet';
        } else if (openAutomatically) {
          openMethod = this.openPaymentPage(paymentUrl, {
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
          // Reported back by the platform, so the inspector shows which processor
          // took the payment and which pot it lands in without having to guess.
          provider: (data && data.provider) || '(unknown)',
          mode: (data && data.mode) || '(unknown)',
          currency: (data && data.currency) || '',
          depositId: (data && data.intentId) || '',
          paymentUrl: paymentUrl,
          openMethod: openMethod,
          isSuccessful: true,
          ...(crypto
            ? {
              network: this._internal.chainName + (crypto.testnet ? ' (TESTNET)' : ''),
              send: this._internal.tokenAmount + ' ' + this._internal.tokenSymbol,
              toAddress: this._internal.depositAddress,
              confirmations: crypto.minConfirmations,
              quoteExpiresAt: crypto.quoteExpiresAt
            }
            : {}),
          note: crypto
            ? 'Show the address and amount to the player. The balance is credited once the transfer confirms on-chain.'
            : 'Payment page opened. The balance is credited only once the payment settles.'
        };

        this.flagOutputDirty('paymentUrl');
      } catch (error) {
        // Close the pre-opened blank popup if we failed before using it.
        if (popup) {
          try { popup.close(); } catch (e) { /* ignore */ }
        }
        this._internal.lastError = error.message;
        this._internal.inspectData = { isSuccessful: false, error: error.message };
        console.error('Create Deposit error:', error);
      } finally {
        this._internal.isSuccessful = ok;
        this.flagOutputDirty('isSuccessful');
        this.sendSignalOnOutput('Done');
      }
    }
  }
};

module.exports = {
  node: CreateDepositNode
};
