/**
 * Signal Passthrough Node Converter for XGENIA Cloud Functions
 *
 * This module provides functionality to convert signal passthrough/relay nodes
 * to Deno-compatible functions for Supabase Edge Functions.
 */

import { Node } from './types';

export class SignalPassthroughNodeConverter {
  /**
   * Check if a node is a signal passthrough node
   */
  public isSignalPassthroughNode(nodeType: string): boolean {
    // Check for common signal passthrough/relay node types
    return (
      nodeType === 'Relay' ||
      nodeType === 'SignalPassthrough' ||
      nodeType === 'Signal Passthrough' ||
      nodeType === 'signal-passthrough' ||
      nodeType === 'signal_passthrough' ||
      // Also check for the module name pattern
      nodeType.toLowerCase().includes('relay') ||
      nodeType.toLowerCase().includes('signalpassthrough') ||
      nodeType.toLowerCase().includes('signal_passthrough') ||
      nodeType.toLowerCase().includes('signal-passthrough')
    );
  }

  /**
   * Convert a signal passthrough node to a Deno function definition
   */
  public convertSignalPassthroughNode(node: Node, functionName: string): string {
    // Signal passthrough nodes are simple - they receive a signal and pass it through
    // In the context of cloud functions, this means they return true when called
    // to indicate the signal has been successfully passed through

    // (2026-07-30, export 1785439497156) THIS MUST NOT THROW.
    //
    // It did: `[StateLatch] Expected exactly one input variable.` crashed a whole
    // 1,000-spin stress run, twice, and the RTP test never produced a number.
    //
    // The assertion was wrong about the node it compiles. The real Relay node
    // (nodes/std-library/signalpassthrough.js) has exactly one port, `input`, of type
    // SIGNAL, and its whole body is `this.sendSignalOnOutput('output')` — it carries no
    // value at all. But the invocation site builds `inputs` from connected DATA inputs
    // and parameters, so a correctly-wired Relay arrives here as `{}` — zero keys — and
    // `keys.length !== 1` threw on the normal case. Signal delivery in compiled RGS code
    // is modelled by the invocation gate (`if (gate) { ... }`) that wraps this call, not
    // by an entry in the value map, so there was never going to be exactly one key.
    //
    // Mirror the runtime node instead of inventing a contract for it: being reached IS
    // the passthrough. Forward a value when one happens to be present, forward the map
    // when several are, and return nothing when there is nothing — the same three cases
    // the editor handles silently. A relay is the most trivial node in the graph; it has
    // no business being the thing that kills a simulation.
    return `
/**
 * Signal passthrough function generated from '${node.typename}' node.
 *
 * The editor's Relay emits its output signal whenever its input signal arrives; it
 * never inspects a value. Signal arrival is represented here by this function being
 * called at all, so any value map — including an empty one — is valid input.
 */
const ${functionName} = (inputs: Record<string, any>): Record<string, any> => {
  const keys = Object.keys(inputs || {});

  // No value rode along with the signal — the ordinary case for a pure signal relay.
  if (keys.length === 0) {
    return { output: true, triggered: true };
  }

  // Exactly one value: pass it straight through, which is what the old code did on
  // the one input shape it accepted.
  if (keys.length === 1) {
    return { output: inputs[keys[0]], triggered: true };
  }

  // Several values: forward the first as \`output\` for callers that read a scalar, and
  // keep the rest addressable rather than discarding them. Previously this threw.
  return { output: inputs[keys[0]], values: { ...inputs }, triggered: true };
};`;
  }
}
