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

const EdgeTriggeredInput = require('../../../edgetriggeredinput');
const { getPlayContextFields } = require('./rgs-play-context');

const DEFAULT_URL = 'http://localhost:54321/functions/v1/aggregator';

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
      for (const field in body) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        if (signals.has(field)) {
          // A signal is not a value: fire it (below) when this response says it fired.
          if (body[field] === true) fired.push(field);
          continue;
        }
        this._internal.outputValues[field] = body[field];
        this.registerOutputIfNeeded('out-' + field);
        if (this.hasOutput('out-' + field)) this.flagOutputDirty('out-' + field);
      }
      for (const field of fired) {
        this.registerOutputIfNeeded('out-' + field);
        if (this.hasOutput('out-' + field)) this.sendSignalOnOutput('out-' + field);
      }
    },
    doSend: function () {
      const payload = {};
      const data = this._internal.dataValues || {};
      for (const key in data) payload[key] = data[key];

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

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body
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
              _this.sendSignalOnOutput(response.ok ? 'success' : 'failure');
            });
        })
        .catch(function (e) {
          console.log('Aggregator: failed to POST to', url, e);
          _this.sendSignalOnOutput('failure');
        });
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
        if (event.name === 'dataInputs' || event.name === 'triggers' || event.name === 'outputs' || event.name === 'signalOutputs') {
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
