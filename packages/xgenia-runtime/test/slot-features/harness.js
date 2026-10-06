// ─────────────────────────────────────────────────────────────────────────────
// Shared harness for the slot-features client nodes (Autoplay, Audio Mixer, Volume Ramp,
// Win Rollup, Reality Check, Session Limits).
//
// Same approach as ../state-manager-initial-values.test.js: a real NodeContext, a real
// ComponentModel built from export data, a real ComponentInstance, and the node under test
// defined through NodeDefinition.defineNode(require(<path>).node) — the exact object the
// pro-node index registers. Signal OUTPUTS are observed the way ../signal-arrival-order.test.js
// does it: wired into a probe node whose edge-triggered inputs log each rising edge. That
// is the only honest way to see a signal, since a signal output's getter is always undefined.
//
// Signal INPUTS are edge triggered (edgetriggeredinput.js), so `fire` queues true THEN false,
// exactly what sendSignalOnOutput does — a second bare `true` would never fire.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const path = require('path');
const NodeContext = require('../../src/nodecontext');
const ComponentInstance = require('../../src/nodes/componentinstance');
const ComponentModel = require('../../src/models/componentmodel');
const NodeDefinition = require('../../src/nodedefinition');

const FEATURES_DIR = path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features');

function featurePath(file) {
  return path.join(FEATURES_DIR, file);
}

/** The node module exactly as shipped: `module.exports = { node }`. */
function defineFeature(file) {
  const mod = require(featurePath(file));
  return NodeDefinition.defineNode(mod.node);
}

/**
 * Stand the node up in a real component with `parameters` applied the way the editor applies
 * them (through the input setters), plus a probe wired to every signal output.
 */
async function mount(Def, parameters) {
  const signals = [];
  const signalNames = Object.keys(Def.metadata.outputs).filter((n) => Def.metadata.outputs[n].type === 'signal');

  const probeInputs = {};
  signalNames.forEach((name) => {
    probeInputs[name] = {
      type: 'signal',
      valueChangedToTrue() {
        signals.push(name);
      }
    };
  });
  const Probe = NodeDefinition.defineNode({ name: 'FeatureProbe', category: 'test', inputs: probeInputs, outputs: {} });

  const ctx = new NodeContext();
  ctx.nodeRegister.register(Def);
  ctx.nodeRegister.register(Probe);

  const model = await ComponentModel.createFromExportData({
    name: 'c',
    id: '1',
    nodes: [
      { id: 'N', type: Def.metadata.name, parameters: parameters || {} },
      { id: 'P', type: 'FeatureProbe' }
    ],
    connections: signalNames.map((name) => ({ sourceId: 'N', sourcePort: name, targetId: 'P', targetPort: name }))
  });
  const inst = new ComponentInstance(ctx);
  await inst.setComponentModel(model);
  ctx.update();

  const node = inst.nodeScope.getNodeWithId('N');

  return {
    ctx,
    node,
    signals,
    /** Value of a non-signal output: getOutput() returns the port definition, the getter has the value. */
    out(name) {
      const def = node.getOutput(name);
      return def && typeof def.getter === 'function' ? def.getter.call(node) : undefined;
    },
    set(name, value) {
      node.queueInput(name, value);
      ctx.update();
    },
    fire(name) {
      node.queueInput(name, true);
      node.queueInput(name, false);
      ctx.update();
    },
    /**
     * Advance the fake clock and let the runtime deliver what the timers queued.
     * Stepped in frame-sized slices with an update after each: the real runtime flushes
     * every frame, so a 600 ms jump flushed once would deliver 30 frames' worth of queued
     * signals in one batch and reorder them (ticks landing after `finished`) in a way the
     * editor never does.
     */
    advance(ms) {
      const step = 16;
      let left = ms;
      while (left > 0) {
        const slice = Math.min(step, left);
        jest.advanceTimersByTime(slice);
        ctx.update();
        left -= slice;
      }
    },
    count(name) {
      return signals.filter((n) => n === name).length;
    },
    clearSignals() {
      signals.length = 0;
    },
    /** What the runtime does when the node is removed from the graph (nodescope.deleteNode). */
    dispose() {
      node._onNodeDeleted();
    }
  };
}

// Fake timers for the whole file; promise plumbing stays real so the async mount resolves.
function useFakeClock() {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'performance'] });
  });
  afterEach(() => {
    jest.useRealTimers();
  });
}

module.exports = { defineFeature, mount, useFakeClock, featurePath };
