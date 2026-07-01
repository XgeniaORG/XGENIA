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
// Example payload (calculator with Addition / Subtraction):
//   { "firstNumber": 1, "secondNumber": 2, "isAddition": true, "isSubtraction": false }
// Example response -> outputs:
//   { "result": 3 }   ->   out-result = 3
//
// Phase 1: the request URL is a dummy localhost value supplied at compile time.

const EdgeTriggeredInput = require('../../../edgetriggeredinput');

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
    applyOutputs: function (body) {
      if (!body || typeof body !== 'object') return;
      this._internal.outputValues = this._internal.outputValues || {};
      for (const field in body) {
        if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
        this._internal.outputValues[field] = body[field];
        this.registerOutputIfNeeded('out-' + field);
        if (this.hasOutput('out-' + field)) this.flagOutputDirty('out-' + field);
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

      this._internal.lastPayload = payload;

      const url = this._internal.url || DEFAULT_URL;
      const _this = this;
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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
              _this.applyOutputs(body);
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

  splitList(parameters.outputs).forEach(function (field) {
    ports.push({
      type: { name: '*', allowConnectionsOnly: true },
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
        if (event.name === 'dataInputs' || event.name === 'triggers' || event.name === 'outputs') {
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
