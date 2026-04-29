/**
 * Collection Node Converter for XGENIA Cloud Functions
 *
 * This module provides functionality to convert collection/array manipulation nodes
 * to Deno-compatible functions for Supabase Edge Functions.
 */

import { Node } from './types';

export class CollectionNodeConverter {
  /**
   * Check if a node is a collection node
   */
  public isCollectionNode(nodeType: string): boolean {
    // Check for collection-related node types
    return (
      nodeType === 'CollectionClear' ||
      nodeType === 'ClearArray' ||
      nodeType === 'collection-clear' ||
      nodeType === 'collection_clear' ||
      nodeType.toLowerCase().includes('collectionclear') ||
      nodeType.toLowerCase().includes('cleararray') ||
      nodeType.toLowerCase().includes('collection_clear') ||
      nodeType.toLowerCase().includes('collection-clear')
    );
  }

  /**
   * Convert a collection clear node to a Deno function definition
   */
  public convertCollectionNode(node: Node, functionName: string): string {
    // Collection clear nodes remove all objects from an array
    // In Supabase context, this could be clearing an in-memory array or database collection

    return `
/**
 * Collection clear function generated from '${node.typename}' node.
 * Removes all objects from the specified array/collection.
 */
const ${functionName} = (inputs: Record<string, any>): Record<string, any> => {
  const { collectionId } = inputs;

  if (!collectionId) {
    throw new Error('Collection ID is required for array clear operation');
  }

  // In Supabase Edge Functions context, we simulate clearing the collection
  // This could be clearing an in-memory array or marking a database collection for clearing
  try {
    // Simulate clearing the collection by setting it to empty array
    // In a real implementation, this might involve database operations
    const clearedCollection = {
      id: collectionId,
      data: [],
      cleared: true,
      timestamp: new Date().toISOString()
    };

    return {
      modified: true,
      clearedCollection
    };
  } catch (error: any) {
    console.error('Error clearing collection:', error);
    return {
      modified: false,
      error: error.message
    };
  }
};`;
  }
}
