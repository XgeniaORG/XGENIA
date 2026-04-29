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

    return `
/**
 * Signal passthrough function generated from '${node.typename}' node.
 * This function receives a signal input and passes it through to the output.
 */
const ${functionName} = (inputs: Record<string, any>): Record<string, any> => {
  const keys = Object.keys(inputs);
  if (keys.length !== 1) {
    throw new Error("Expected exactly one input variable.");
  }

  const value = inputs[keys[0]];

  return {
    output: value
  };
};`;
  }
}
