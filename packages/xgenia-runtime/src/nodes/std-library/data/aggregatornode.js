'use strict';

// Aggregator Node
// ----------------
// Inserted into a (visual) component by the "Compile" feature. It replaces the
// logic that used to live in the component: instead of running the logic
// in-place, it collects the relevant UI output values and the per-operation
// trigger signals, aggregates them into a single JSON payload and POSTs that
// payload to the logic component that was extracted during compilation (which,
// in production, is deployed as a Supabase edge function).
//
// Two kinds of dynamic inputs, declared through stringlist parameters:
//   * `dataInputs`  -> one `data-<field>` input per UI output value. Each value
//                      becomes a field on the payload (e.g. `firstNumber`).
//   * `triggers`    -> one `do-<X>` signal input per extracted logic operation.
//                      Firing `do-<X>` sets `is<X>: true` (and every other
//                      `is<Y>: false`) on the payload, so the same URL can
//                      dispatch different operations purely by payload contents.
//
// And dynamic OUTPUTS, declared through one more stringlist parameter:
//   * `outputs`     -> one `out-<field>` output port per field of the JSON
//                      response. After the POST resolves, each response field is
//                      emitted on its port and flows back into the UI component
//                      that originally displayed that value (the reverse of the
//                      input aggregation).
//
//   * `signalOutputs` -> the subset of `outputs` that are SIGNALS on the logic
//                      component (a maths component's Done, BonusTriggered, …).
//                      Their port is a signal, fired once for each response
//                      that carries the field as true — after every data output
//                      of that response is set, so a listener reads fresh values.
//                      (2026-10-05) Without it a maths component's signals came
//                      back as plain values: Done never reached what waited for
//                      it, and a value that stayed true could fire only once.
//
// Example payload (calculator with Addition / Subtraction):
//   { "firstNumber": 1, "secondNumber": 2, "isAddition": true, "isSubtraction": false }
// Example response -> outputs:
//   { "result": 3 }   ->   out-result = 3
//
// Phase 1: the request URL is a dummy localhost value supplied at compile time.
//
// Money in cents (2026-11-03): an Aggregator Publish points at a Math Component whose deployed script converts
// (editor utils/rgs/moneyScale.ts) carries `moneyScale` (100), `betField` and `winField`. It sends the bet field
// × moneyScale with `__moneyScale`, and divides the win field — and the RGS balance and win — by it, so the RGS
// ledger counts cents while the game's graph keeps the money the player sees. Without `moneyScale` nothing changes.
//
// The wallet on load (2026-11-04): rgsBalance used to arrive only with a round's answer, so a reloaded page showed the
// game's opening balance until the first spin. A published page that converts money now asks the RGS once, on load,
// for this browser guest's play-money balance (GET /rgs-fn/<game>/__balance) and fills rgsBalance with it. Not for a
// launched session (a casino's player is not the browser guest), and a round's own answer always wins over it.

const EdgeTriggeredInput = require('../../../edgetriggeredinput');
const { getPlayContextFields, getClientId, launchedSessionFromUrl } = require('./rgs-play-context');
const { stakeBookSessionForPage, parseStakeConfig } = require('./stake-book-session');
const { isReplayPage, replaySessionForPage, ReplayRefused, STATES: REPLAY_STATES } = require('./rgs-replay');

// XRGS bet replay (2026-11-11): on a page opened with ?replay=true (rgs-replay.js) an http Aggregator never POSTs.
// Its triggers are answered from the replay's frames, in order, through the same applyOutputs a live /rgs-fn
// answer takes — and REFUSED (failure + error) when no replay is playing, so a replay page has no bet path.
// Extra outputs let a game present the replay: replayMode, replayState, replayPlay (signal: wire it to the spin
// so Play starts the round with its own animation), replayEnded (signal), replayFrameIndex, replayFrameState
// (the state that frame's round left), replayBet / replayCost / replayWin / replayCurrency (money as a person
// reads it) and replayBetText / replayWinText (e.g. "BONUS: €1.00 / REAL COST: €250.00", "WIN: €5.00").
const REPLAY_OUTPUTS = [
  ['replayMode', 'Replay Mode'],
  ['replayState', 'Replay State'],
  ['replayPlay', 'Replay Play', 'signal'],
  ['replayEnded', 'Replay Ended', 'signal'],
  ['replayFrameIndex', 'Replay Frame Index'],
  ['replayFrameState', 'Replay Frame State'],
  ['replayBet', 'Replay Bet'],
  ['replayCost', 'Replay Cost'],
  ['replayWin', 'Replay Win'],
  ['replayCurrency', 'Replay Currency'],
  ['replayBetText', 'Replay Bet Text'],
  ['replayWinText', 'Replay Win Text']
];

// Stake Engine (2026-11-09): with `transport` = "stake" the Aggregator does not POST to an RGS. It hands each
// trigger to the page's Stake Book Session (stake-book-session.js), which plays one /wallet/play per paid
// event and answers the free rounds that follow from the same book, locally — same ports, same outputs, so the
// game graph built for XRGS plays on Stake unchanged. `stakeConfig` (JSON) says how: exportBet, betField,
// winField, moneyFields, modeField, modes, startupTriggers, gameUnitsPerCurrencyUnit. Extra outputs:
// stakeInFeature, stakeRoundsLeft, stakeRoundComplete (signal), stakeBetLevels, stakeDefaultBet, stakeCurrency,
// stakeSocial, stakeReplay, stakeResumePending.
const STAKE_OUTPUTS = [
  ['stakeInFeature', 'In Feature'],
  ['stakeRoundsLeft', 'Rounds Left'],
  ['stakeRoundComplete', 'Round Complete', 'signal'],
  ['stakeBetLevels', 'Bet Levels'],
  ['stakeDefaultBet', 'Default Bet'],
  ['stakeCurrency', 'Currency'],
  ['stakeSocial', 'Social Mode'],
  ['stakeReplay', 'Replay Mode'],
  ['stakeResumePending', 'Resume Pending'],
  ['stakeModes', 'Stake Modes']
];

const DEFAULT_URL = 'http://localhost:54321/functions/v1/aggregator';
const REQUEST_TIMEOUT_MS = 10000;

function newRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// "firstNumber" -> "First Number" (used for port display names only)
function humanize(name) {
  return String(name)
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, function (c) {
      return c.toUpperCase();
    });
}

function splitList(value) {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

// Serialize the outgoing payload without letting a bad data value take down the
// send. A UI output wired as a `data-<field>` input can, in edge cases, carry a
// live runtime object (a node/graph model) instead of a plain value; those hold
// `context` <-> `_dirtyNodes` back-references, so a naive JSON.stringify throws
// "Converting circular structure to JSON" — synchronously, mid reactive-update
// flush, which crashes the whole app. Mirror the circular-safe replacer the
// editor connection already uses (WeakSet -> "[Circular]") so the POST still
// goes out, and warn loudly with the offending field(s) so a mis-wired
// non-serializable input stays VISIBLE rather than being silently swallowed.
function stringifyPayloadSafe(payload) {
  try {
    return JSON.stringify(payload);
  } catch (e) {
    const offenders = Object.keys(payload).filter(function (k) {
      return payload[k] !== null && typeof payload[k] === 'object';
    });
    console.warn(
      'Aggregator: payload was not directly JSON-serializable (' +
        (e && e.message ? e.message : e) +
        '). Replacing cycles with "[Circular]". Verify these data input(s) are ' +
        'wired to a plain value, not a node/model object:',
      offenders
    );
    const seen = new WeakSet();
    return JSON.stringify(payload, function (key, value) {
      if (value !== null && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    });
  }
}

const AggregatorNode = {
  name: 'Aggregator',
  displayNodeName: 'Aggregator Node',
  docs: 'https://docsapp.xgenia.com/nodes/cloud-functions/aggregator',
  category: 'Cloud Functions',
  color: 'data',
  searchTags: ['aggregate', 'aggregator', 'compile', 'payload', 'post', 'edge function'],
  initialize: function () {
    this._internal.dataValues = {};
    this._internal.outputValues = {};
    this._internal.url = DEFAULT_URL;
  },
  getInspectInfo: function () {
    return { type: 'value', value: this._internal.lastPayload };
  },
  inputs: {
    url: {
      type: 'string',
      displayName: 'URL',
      group: 'General',
      default: DEFAULT_URL,
      set: function (value) {
        this._internal.url = value;
        this.scheduleAfterInputsHaveUpdated(this.attachReplay.bind(this));
        this.scheduleAfterInputsHaveUpdated(this.readRgsBalanceOnLoad.bind(this));
      }
    },
    dataInputs: {
      type: { name: 'stringlist', allowEditOnly: true },
      displayName: 'Data Inputs',
      group: 'Configuration',
      set: function (value) {
        this._internal.dataInputs = value;
      }
    },
    triggers: {
      type: { name: 'stringlist', allowEditOnly: true },
      displayName: 'Triggers',
      group: 'Configuration',
      set: function (value) {
        this._internal.triggers = value;
      }
    },
    outputs: {
      type: { name: 'stringlist', allowEditOnly: true },
      displayName: 'Outputs',
      group: 'Configuration',
      set: function (value) {
        this._internal.outputs = value;
      }
    },
    signalOutputs: {
      type: { name: 'stringlist', allowEditOnly: true },
      displayName: 'Signal Outputs',
      group: 'Configuration',
      set: function (value) {
        this._internal.signalOutputs = value;
      }
    },
    transport: {
      type: { name: 'enum', enums: [{ value: 'http', label: 'XGENIA RGS (HTTP)' }, { value: 'stake', label: 'Stake Engine book' }] },
      displayName: 'Transport',
      group: 'General',
      default: 'http',
      set: function (value) {
        this._internal.transport = value;
        this.scheduleAfterInputsHaveUpdated(this.readStakeInfoOnLoad.bind(this));
      }
    },
    stakeConfig: {
      type: 'string',
      displayName: 'Stake Config',
      group: 'Stake',
      set: function (value) {
        this._internal.stakeConfig = value;
      }
    },
    moneyScale: {
      type: 'number',
      displayName: 'Money Scale',
      group: 'Money',
      default: 1,
      set: function (value) {
        this._internal.moneyScale = Number(value) || 1;
      }
    },
    betField: {
      type: 'string',
      displayName: 'Bet Field',
      group: 'Money',
      set: function (value) {
        this._internal.betField = value;
      }
    },
    winField: {
      type: 'string',
      displayName: 'Win Field',
      group: 'Money',
      set: function (value) {
        this._internal.winField = value;
      }
    }
  },
  outputs: {
    success: { type: 'signal', displayName: 'Success', group: 'Events' },
    failure: { type: 'signal', displayName: 'Failure', group: 'Events' }
  },
  methods: {
    setDataValue: function (field, value) {
      this._internal.dataValues[field] = value;
    },
    triggerSend: function (triggerName) {
      this._internal.activeTrigger = triggerName;
      this.scheduleAfterInputsHaveUpdated(this.doSend.bind(this));
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) return;

      if (name.indexOf('data-') === 0) {
        this.registerInput(name, {
          set: this.setDataValue.bind(this, name.substring('data-'.length))
        });
      } else if (name.indexOf('do-') === 0) {
        // Dynamically registered signal inputs are NOT auto-wrapped as
        // edge-triggered, so wrap explicitly (mirrors nodedefinition.js).
        this.registerInput(name, {
          set: EdgeTriggeredInput.createSetter({
            valueChangedToTrue: this.triggerSend.bind(this, name.substring('do-'.length))
          })
        });
      }
    },
    getOutputValue: function (field) {
      return this._internal.outputValues ? this._internal.outputValues[field] : undefined;
    },
    // Materialise an out-<field> output port on demand. Called by the framework
    // when a connection from this port is bound (mirrors the REST node).
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) return;
      if (name.indexOf('out-') === 0) {
        this.registerOutput(name, {
          getter: this.getOutputValue.bind(this, name.substring('out-'.length))
        });
      }
    },
    // Take the JSON response body and push each field onto its out-<field>
    // output port, so the values flow back into the connected UI components.
    //
    // IMPORTANT: only surface the fields the response ACTUALLY carries. The
    // deployed edge function omits the outputs of operations that weren't
    // triggered this request (their value is undefined, which JSON drops). If we
    // flagged every DECLARED output dirty regardless, triggering one operation
    // would push values into — and visibly "trigger" — UI bound to unrelated
    // operations. So we iterate the response body's own keys only.
    // `ok`: the response was a 2xx. A declared signal the response does not
    // mention at all is fired on a 2xx — what every signal output did before
    // signalOutputs existed (they all rode `success`) — so a script deployed by an
    // older compiler, which never reports signals, keeps its game working.
    applyOutputs: function (body, ok) {
      if (!body || typeof body !== 'object') return;
      this._internal.outputValues = this._internal.outputValues || {};
      const signals = new Set(splitList(this._internal.signalOutputs));
      const fired = ok === true ? Array.from(signals).filter((s) => !Object.prototype.hasOwnProperty.call(body, s)) : [];
      // What the RGS recorded for a staked round: the wallet balance after it, what it paid and its id. A published
      // demo shows THIS balance and win (the RGS owns the money), not what the game's own logic would have said.
      const rgs = body.__rgs && typeof body.__rgs === 'object' ? body.__rgs : null;
      if (body.__stake && typeof body.__stake === 'object') this.applyStakeOutputs(body.__stake);
      // Cents back to the game's money: only from a script that converted this request (it says so).
      const scale = this.moneyScaleInUse();
      const converted = scale > 1 && Number(body.__moneyScale) === scale;
      const money = (v) => (converted && typeof v === 'number' ? v / scale : v);
      const winField = converted ? this._internal.winField : null;
      const fromRgs = rgs ? { rgsBalance: money(rgs.balance_after), rgsWin: money(rgs.win_amount), rgsRoundId: rgs.round_id } : null;
      if (fromRgs) {
        this._internal.roundAnswered = true;
        for (const name in fromRgs) {
          if (fromRgs[name] === undefined) continue;
          this._internal.outputValues[name] = fromRgs[name];
          this.registerOutputIfNeeded('out-' + name);
          if (this.hasOutput('out-' + name)) this.flagOutputDirty('out-' + name);
        }
      }
      for (const field in body) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        if (field === '__rgs' || field === '__moneyScale' || field === '__stake') continue;
        // A Math Component may declare rgsBalance / rgsWin / rgsRoundId outputs so its game can read them; the maths
        // never sets them (it cannot see the wallet), so its own empty value must not overwrite what the RGS recorded.
        if (fromRgs && fromRgs[field] !== undefined) continue;
        if (signals.has(field)) {
          // A signal is not a value: fire it (below) when this response says it fired.
          if (body[field] === true) fired.push(field);
          continue;
        }
        this._internal.outputValues[field] = field === winField ? money(body[field]) : body[field];
        this.registerOutputIfNeeded('out-' + field);
        if (this.hasOutput('out-' + field)) this.flagOutputDirty('out-' + field);
      }
      for (const field of fired) {
        this.registerOutputIfNeeded('out-' + field);
        if (this.hasOutput('out-' + field)) this.sendSignalOnOutput('out-' + field);
      }
    },
    // The wallet before the first round (see the header). Once per node; never throws.
    readRgsBalanceOnLoad: function () {
      if (this._internal.balanceAsked) return;
      const url = this._internal.url || '';
      const match = /^(https?:\/\/[^?#]*\/rgs-fn\/[^/?#]+)\/[^/?#]+/.exec(url);
      const scale = this.moneyScaleInUse();
      if (this._internal.transport === 'stake' || !match || scale <= 1 || typeof fetch !== 'function' || launchedSessionFromUrl() || isReplayPage()) return;
      this._internal.balanceAsked = true;
      const _this = this;
      let client;
      try {
        client = getClientId();
      } catch (e) {
        return;
      }
      if (!client) return;
      fetch(match[1] + '/__balance?client=' + encodeURIComponent(client), { method: 'GET' })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (body) {
          // A round that answered meanwhile carries the fresher figure.
          if (!body || typeof body.balance !== 'number' || !isFinite(body.balance) || _this._internal.roundAnswered) return;
          _this._internal.outputValues = _this._internal.outputValues || {};
          _this._internal.outputValues.rgsBalance = body.balance / scale;
          _this.registerOutputIfNeeded('out-rgsBalance');
          if (_this.hasOutput('out-rgsBalance')) _this.flagOutputDirty('out-rgsBalance');
        })
        .catch(function () {});
    },
    setOutput: function (name, value) {
      this._internal.outputValues = this._internal.outputValues || {};
      this._internal.outputValues[name] = value;
      this.registerOutputIfNeeded('out-' + name);
      if (this.hasOutput('out-' + name)) this.flagOutputDirty('out-' + name);
    },
    applyStakeOutputs: function (st) {
      if (st.inFeature !== undefined) this.setOutput('stakeInFeature', !!st.inFeature);
      if (st.roundsLeft !== undefined) this.setOutput('stakeRoundsLeft', st.roundsLeft);
      if (st.roundComplete) {
        this.registerOutputIfNeeded('out-stakeRoundComplete');
        if (this.hasOutput('out-stakeRoundComplete')) this.sendSignalOnOutput('out-stakeRoundComplete');
      }
    },
    stakeSession: function () {
      if (!this._internal.stake) {
        this._internal.stake = stakeBookSessionForPage({
          fetch: typeof fetch === 'function' ? fetch.bind(globalThis) : null,
          location: typeof location !== 'undefined' ? location : { search: '', protocol: 'https:' }
        });
      }
      return this._internal.stake;
    },
    // Bet levels, balance, currency and the modes Stake launched the game in — before the first round, so the
    // bet selector offers only Stake's levels and a reloaded game knows a round is waiting.
    readStakeInfoOnLoad: function () {
      if (this._internal.transport !== 'stake' || this._internal.stakeInfoAsked) return;
      this._internal.stakeInfoAsked = true;
      const _this = this;
      let cfg;
      try {
        cfg = parseStakeConfig(this._internal.stakeConfig);
      } catch (e) {
        this.setError(e.message);
        return;
      }
      this.stakeSession()
        .info(cfg)
        .then(function (info) {
          for (const k in info) if (info[k] !== undefined) _this.setOutput(k === 'rgsBalance' ? 'rgsBalance' : k, info[k]);
        })
        .catch(function (e) {
          _this.setError((e && e.message) || String(e));
        });
    },
    doSendStake: function () {
      const _this = this;
      const data = {};
      const values = this._internal.dataValues || {};
      for (const k in values) data[k] = values[k];
      let cfg;
      try {
        cfg = parseStakeConfig(this._internal.stakeConfig);
      } catch (e) {
        this.setError(e.message);
        this.sendSignalOnOutput('failure');
        return;
      }
      this._internal.lastPayload = { trigger: this._internal.activeTrigger, data: data };
      this.stakeSession()
        .request(this._internal.activeTrigger, data, cfg)
        .then(function (body) {
          _this._internal.lastResponse = body;
          _this._internal.inspectData = { transport: 'stake', payload: _this._internal.lastPayload, response: body };
          _this.applyOutputs(body, true);
          _this.sendSignalOnOutput('success');
        })
        .catch(function (e) {
          console.log('Aggregator (Stake):', e);
          _this.setError((e && e.message) || String(e));
          _this.sendSignalOnOutput('failure');
        });
    },
    moneyScaleInUse: function () {
      const scale = Number(this._internal.moneyScale) || 1;
      return scale > 1 && this._internal.betField && this._internal.winField ? scale : 1;
    },
    // ── Replay (see the header) ──
    attachReplay: function () {
      if (this._internal.transport === 'stake' || !isReplayPage()) return null;
      const session = replaySessionForPage();
      if (!session) return null;
      if (!this._internal.replayAttached) {
        this._internal.replayAttached = true;
        this.setOutput('replayMode', true);
        session.onChange(this.showReplayState.bind(this));
        this.showReplayState(session.state, session);
      }
      session.attach(this, this._internal.url);
      return session;
    },
    showReplayState: function (state, session) {
      this.setOutput('replayState', state);
      const sum = session && session.summary();
      if (sum) {
        this.setOutput('replayBet', sum.bet);
        this.setOutput('replayCost', sum.cost);
        this.setOutput('replayWin', sum.win);
        this.setOutput('replayCurrency', sum.currency);
        this.setOutput('replayBetText', sum.text.bet);
        this.setOutput('replayWinText', sum.text.win);
      }
      if (state === REPLAY_STATES.ERROR && session && session.error) this.setError(session.error.message);
      if (state === REPLAY_STATES.ENDED) this.fireOutputSignal('replayEnded');
    },
    fireOutputSignal: function (name) {
      this.registerOutputIfNeeded('out-' + name);
      if (this.hasOutput('out-' + name)) this.sendSignalOnOutput('out-' + name);
    },
    /** Play / Play Again was pressed: tell the game, so its spin starts the round. */
    onReplayPlay: function () {
      this.fireOutputSignal('replayPlay');
    },
    /** The session pushes the first frame in when the game did not ask for it (replayPlay unwired). */
    presentReplayFrame: function () {
      this._internal.activeTrigger = null;
      this.doSendReplay();
    },
    doSendReplay: function () {
      const session = this.attachReplay();
      let answer;
      try {
        if (!session) throw new ReplayRefused('This is a replay: betting is disabled.');
        answer = session.next();
      } catch (e) {
        this.setError((e && e.message) || String(e));
        this.sendSignalOnOutput('failure');
        return;
      }
      const frame = answer.frame || {};
      this._internal.lastPayload = { replay: true, trigger: this._internal.activeTrigger || null, frame: frame.index };
      // Asynchronously, as a live answer arrives: never inside the update that fired the trigger.
      setTimeout(() => {
        this._internal.lastResponse = answer.body;
        this._internal.inspectData = { transport: 'replay', frame: frame.index, response: answer.body };
        this.setOutput('replayFrameIndex', typeof frame.index === 'number' ? frame.index : null);
        this.setOutput('replayFrameState', frame.state && typeof frame.state === 'object' ? frame.state : null);
        this.applyOutputs(answer.body, true);
        this.sendSignalOnOutput('success');
        session.frameShown();
      }, 0);
    },
    doSend: function () {
      if (this._internal.transport === 'stake') return this.doSendStake();
      // Never a request from a replay page: the frames answer, or the trigger is refused.
      if (isReplayPage()) return this.doSendReplay();
      const payload = {};
      const data = this._internal.dataValues || {};
      for (const key in data) payload[key] = data[key];

      // The bet in cents, rounded to a whole cent; the script divides it back before the maths runs.
      const scale = this.moneyScaleInUse();
      if (scale > 1) {
        const betField = this._internal.betField;
        if (typeof payload[betField] === 'string' && payload[betField].trim() !== '' && isFinite(Number(payload[betField]))) {
          payload[betField] = Number(payload[betField]);
        }
        if (typeof payload[betField] === 'number' && isFinite(payload[betField])) {
          payload[betField] = Math.round(payload[betField] * scale);
        }
        payload.__moneyScale = scale;
      }

      const triggers = splitList(this._internal.triggers);
      for (let i = 0; i < triggers.length; i++) {
        payload['is' + triggers[i]] = triggers[i] === this._internal.activeTrigger;
      }

      // Who is playing, and in which sitting. The deployed component's logic
      // ignores these — they exist so the platform can attribute the round to a
      // player and a session when the publish card mapped a bet/win port.
      // Applied last, so these reserved names win over a component field of the
      // same name rather than being silently disabled by one. See
      // rgs-play-context.js.
      const context = getPlayContextFields();
      for (const key in context) payload[key] = context[key];
      // One key per request: the RGS answers a repeat of it with the round it already played, so a request the
      // network delivered twice can never be charged or paid twice.
      payload.__idempotency = newRequestId();

      this._internal.lastPayload = payload;

      const url = this._internal.url || DEFAULT_URL;
      const _this = this;

      let body;
      try {
        body = stringifyPayloadSafe(payload);
      } catch (e) {
        // A serialization failure the circular-safe replacer can't fix (e.g. a
        // BigInt). Don't let it throw through the reactive update flush — report
        // a failed send instead so the graph stays alive.
        console.log('Aggregator: failed to serialize payload for', url, e);
        _this.sendSignalOnOutput('failure');
        return;
      }

      // A request that never answers used to leave the game waiting forever (the reels spun on with no result).
      // After REQUEST_TIMEOUT_MS it fails like any other failure, with the reason on `error`.
      const abort = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = abort ? setTimeout(function () { abort.abort(); }, REQUEST_TIMEOUT_MS) : null;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        ...(abort ? { signal: abort.signal } : {})
      })
        .then(function (response) {
          return response
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              _this._internal.lastResponse = body;
              _this._internal.inspectData = { status: response.status, payload: payload, response: body };
              // Map response fields -> output ports -> connected UI components.
              _this.applyOutputs(body, response.ok);
              if (!response.ok) _this.setError((body && (body.message || body.error)) || 'HTTP ' + response.status);
              _this.sendSignalOnOutput(response.ok ? 'success' : 'failure');
            });
        })
        .catch(function (e) {
          console.log('Aggregator: failed to POST to', url, e);
          _this.setError(e && e.name === 'AbortError' ? 'No answer within ' + REQUEST_TIMEOUT_MS / 1000 + ' s' : String((e && e.message) || e));
          _this.sendSignalOnOutput('failure');
        })
        .finally(function () {
          if (timer) clearTimeout(timer);
        });
    },
    setError: function (message) {
      this._internal.outputValues = this._internal.outputValues || {};
      this._internal.outputValues.error = String(message);
      this.registerOutputIfNeeded('out-error');
      if (this.hasOutput('out-error')) this.flagOutputDirty('out-error');
    }
  }
};

function buildPorts(parameters) {
  const ports = [];

  splitList(parameters.dataInputs).forEach(function (field) {
    ports.push({
      type: { name: '*', allowConnectionsOnly: true },
      plug: 'input',
      group: 'Data Inputs',
      name: 'data-' + field,
      displayName: humanize(field)
    });
  });

  splitList(parameters.triggers).forEach(function (trigger) {
    ports.push({
      type: 'signal',
      plug: 'input',
      group: 'Triggers',
      name: 'do-' + trigger,
      displayName: 'Do ' + humanize(trigger)
    });
  });

  const signalOutputs = new Set(splitList(parameters.signalOutputs));
  splitList(parameters.outputs).forEach(function (field) {
    ports.push({
      type: signalOutputs.has(field) ? 'signal' : { name: '*', allowConnectionsOnly: true },
      plug: 'output',
      group: 'Outputs',
      name: 'out-' + field,
      displayName: humanize(field)
    });
  });

  // Always there: what the RGS recorded for a staked round, and why a request failed.
  const declared = new Set(splitList(parameters.outputs));
  [
    ['rgsBalance', 'RGS Balance'],
    ['rgsWin', 'RGS Win'],
    ['rgsRoundId', 'RGS Round Id'],
    ['error', 'Error']
  ].forEach(function (pair) {
    if (declared.has(pair[0])) return;
    ports.push({ type: { name: '*', allowConnectionsOnly: true }, plug: 'output', group: 'RGS', name: 'out-' + pair[0], displayName: pair[1] });
  });
  if (parameters.transport !== 'stake') {
    REPLAY_OUTPUTS.forEach(function (o) {
      if (declared.has(o[0])) return;
      ports.push({ type: o[2] === 'signal' ? 'signal' : { name: '*', allowConnectionsOnly: true }, plug: 'output', group: 'Replay', name: 'out-' + o[0], displayName: o[1] });
    });
  }
  if (parameters.transport === 'stake') {
    STAKE_OUTPUTS.forEach(function (o) {
      if (declared.has(o[0])) return;
      ports.push({ type: o[2] === 'signal' ? 'signal' : { name: '*', allowConnectionsOnly: true }, plug: 'output', group: 'Stake', name: 'out-' + o[0], displayName: o[1] });
    });
  }

  return ports;
}

module.exports = {
  node: AggregatorNode,
  // Export so the Compile feature can pre-populate identical dynamic ports on
  // the node JSON it writes (the editor regenerates them on load anyway).
  buildPorts: buildPorts,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function manage(node) {
      context.editorConnection.sendDynamicPorts(node.id, buildPorts(node.parameters));
      node.on('parameterUpdated', function (event) {
        if (event.name === 'dataInputs' || event.name === 'triggers' || event.name === 'outputs' || event.name === 'signalOutputs' || event.name === 'transport') {
          context.editorConnection.sendDynamicPorts(node.id, buildPorts(node.parameters));
        }
      });
    }

    graphModel.getNodesWithType('Aggregator').forEach(manage);
    graphModel.on('nodeAdded.Aggregator', manage);
    graphModel.on('editorImportComplete', function () {
      graphModel.getNodesWithType('Aggregator').forEach(manage);
    });
  }
};
