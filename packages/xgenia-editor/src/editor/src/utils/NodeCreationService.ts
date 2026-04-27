import { LogLevel, logMessage } from '@xgenia-ai/ChatPanel/logging'; // Assuming logging utility exists
import { NodeCreationContext, NodeCreationRequest, NodeCreationResult } from '@xgenia-ai/ChatPanel/types/ai-types';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { guid, generateUniqueNodeLabel } from '@xgenia-utils/utils';
import { IVector2 } from '../views/nodegrapheditor'; // Assuming this path is correct relative to utils/

// Rely on global declarations from AgenticsUtils.ts or other core files

/**
 * NodeCreationService - Handles programmatic creation of XGENIA nodes based on requests.
 * Ensures operations are performed within the correct context and supports undo/redo.
 */
export class NodeCreationService {
  private static instance: NodeCreationService;

  private constructor() {
    logMessage('NodeCreationService initialized', LogLevel.INFO);
  }

  public static getInstance(): NodeCreationService {
    if (!NodeCreationService.instance) {
      NodeCreationService.instance = new NodeCreationService();
    }
    return NodeCreationService.instance;
  }

  /**
   * Retrieves the necessary XGENIA context (NodeGraph, NodeLibrary, etc.).
   * Throws an error if essential context is missing.
   */
  private _getXgeniaContext(): NodeCreationContext {
    const nodeGraph = (window as any).NodeGraphContextTmp?.nodeGraph; // Or use getNodeGraph from AgenticsUtils if preferred
    const nodeLibrary = (window as any).NodeLibrary?.instance;
    const projectModel = (window as any).ProjectModel?.instance;
    const undoQueue = (window as any).UndoQueue?.instance;

    if (!nodeGraph) {
      throw new Error('NodeCreationService: Failed to get NodeGraph context.');
    }
    if (!nodeLibrary) {
      throw new Error('NodeCreationService: Failed to get NodeLibrary instance.');
    }
    // projectModel might not be strictly needed for adding nodes if parent is known, but useful for validation/lookup
    // if (!projectModel) {
    //   logMessage('NodeCreationService: ProjectModel instance not found.', LogLevel.WARN);
    // }
    if (!undoQueue) {
      throw new Error('NodeCreationService: Failed to get UndoQueue instance.');
    }
    if (typeof (window as any).UndoActionGroup !== 'function') {
      throw new Error('NodeCreationService: UndoActionGroup constructor not found.');
    }
    if (typeof (window as any).NodeGraphNode?.fromJSON !== 'function') {
      logMessage('NodeCreationService: NodeGraphNode.fromJSON not found. Node creation might be limited.', LogLevel.WARN);
      // Consider throwing an error if fromJSON is essential for your strategy
    }


    return { nodeGraph, nodeLibrary, projectModel, undoQueue };
  }

  /**
   * Creates a hierarchy of nodes based on the request structure.
   *
   * @param requests - A single request or an array of requests to create top-level nodes.
   * @param targetPosition - The desired starting position for the first top-level node.
   * @param targetParentModel - The parent node to add the new node(s) to. If null, adds to the root.
   * @param undoLabel - The label for the undo action.
   * @returns A promise resolving to the result of the creation operation.
   */
  public async createNodeHierarchy(
    requests: NodeCreationRequest | NodeCreationRequest[],
    targetPosition: IVector2,
    targetParentModel: NodeGraphNode | null,
    undoLabel: string
  ): Promise<NodeCreationResult> {
    logMessage(`createNodeHierarchy called with label: ${undoLabel}`, LogLevel.DEBUG, { requests, targetPosition, parentId: targetParentModel?.id });

    const context = this._getXgeniaContext();
    const { nodeGraph, nodeLibrary, undoQueue } = context;
    const UndoActionGroup = (window as any).UndoActionGroup;
    const undoGroup = new UndoActionGroup({ label: undoLabel });

    const createdTopLevelNodes: NodeGraphNode[] = [];
    let currentPosition = { ...targetPosition };
    const verticalSpacing = 20; // Spacing between vertically stacked nodes

    // Ensure requests is an array
    const requestArray = Array.isArray(requests) ? requests : [requests];

    try {
      // Recursive function to create nodes
      const _createRecursive = (
        request: NodeCreationRequest,
        currentParent: NodeGraphNode | null,
        position: IVector2,
        depth: number
      ): NodeGraphNode | null => {
        logMessage(`_createRecursive depth ${depth}: Creating node type ${request.typeName}`, LogLevel.DEBUG, { request, parentId: currentParent?.id, position });

        // 1. Get Node Type Definition
        const nodeTypeDef = nodeLibrary.getNodeTypeWithName(request.typeName);
        if (!nodeTypeDef) {
          throw new Error(`Node type "${request.typeName}" not found in NodeLibrary.`);
        }

        // 2. Validate Creation (Placeholder - needs refinement based on where getCreateStatus lives)
        // TODO: Find the correct way to validate if a node can be added to the parent/root
        // Example: const status = currentParent ? currentParent.getCreateStatus({ type: nodeTypeDef }) : nodeGraph.getCreateStatus({ type: nodeTypeDef });
        // if (!status?.creatable) {
        //   throw new Error(`Cannot create node "${request.typeName}": ${status?.message || 'Validation failed'}`);
        // }
        logMessage(`Validation placeholder for ${request.typeName}`, LogLevel.DEBUG);


        // 3. Create Node Instance
        const nodeId = request.nodeId || guid();

        // Ensure unique label
        const existingLabels = new Set<string>();
        nodeGraph.forEachNode((n) => {
          if (n.label) existingLabels.add(n.label);
        });
        const baseLabel = request.label || nodeTypeDef.displayName || nodeTypeDef.name || 'UnknownNode';
        const finalLabel = generateUniqueNodeLabel(baseLabel, existingLabels);

        const nodeData = {
          id: nodeId,
          type: nodeTypeDef.name, // Use the official name from the type definition
          typename: nodeTypeDef.name,
          x: position.x,
          y: position.y,
          parameters: request.parameters || {},
          metadata: request.metadata || {},
          name: finalLabel, // Use 'name' for label in XGENIA, guaranteeing uniqueness
          ...(request.variant && { variant: request.variant }),
        };

        // Use NodeGraphNode.fromJSON if available, otherwise basic instantiation
        let node: NodeGraphNode;
        if (typeof (window as any).NodeGraphNode?.fromJSON === 'function') {
          node = (window as any).NodeGraphNode.fromJSON(nodeData);
          logMessage(`Created node ${nodeId} using NodeGraphNode.fromJSON`, LogLevel.DEBUG);
        } else {
          // Basic instantiation as fallback - might lack methods needed by editor
          logMessage(`Creating node ${nodeId} using basic constructor (fallback)`, LogLevel.WARN);
          node = new NodeGraphNode(nodeData);
        }

        if (!node) {
          throw new Error(`Failed to instantiate NodeGraphNode for type ${request.typeName}`);
        }

        // Ensure essential properties/methods exist (might be needed if not using fromJSON)
        node.x = node.x ?? position.x;
        node.y = node.y ?? position.y;
        node.id = node.id ?? nodeId;
        node.typename = node.typename ?? nodeTypeDef.name;
        node.parameters = node.parameters ?? (request.parameters || {});
        node.metadata = node.metadata ?? (request.metadata || {});
        // Removed direct assignment to node.name as it's not a standard property


        // 4. Add Node to Model
        if (currentParent) {
          if (typeof currentParent.addChild !== 'function') {
            throw new Error(`Parent node ${currentParent.id} does not have addChild method.`);
          }
          logMessage(`Adding node ${node.id} as child to ${currentParent.id}`, LogLevel.DEBUG);
          currentParent.addChild(node, { undo: undoGroup }); // Pass undoGroup
        } else {
          if (typeof nodeGraph.addRoot !== 'function') {
            throw new Error(`NodeGraphModel does not have addRoot method.`);
          }
          logMessage(`Adding node ${node.id} as root`, LogLevel.DEBUG);
          nodeGraph.addRoot(node, { undo: undoGroup }); // Pass undoGroup
        }

        // 5. Recursively Create Children
        // Use fallback height for layout as node.height might not exist
        let childOffsetY = 40 + verticalSpacing;
        if (request.children && request.children.length > 0) {
          logMessage(`Creating ${request.children.length} children for node ${node.id}`, LogLevel.DEBUG);
          for (const childRequest of request.children) {
            const childPosition: IVector2 = {
              x: position.x + 20, // Indent children slightly
              y: position.y + childOffsetY,
            };
            const createdChild = _createRecursive(childRequest, node, childPosition, depth + 1);
            if (createdChild) {
              // Use fallback height for layout
              childOffsetY += 40 + verticalSpacing;
            } else {
              logMessage(`Failed to create child node ${childRequest.typeName}`, LogLevel.WARN);
              // Decide if failure of a child should abort the whole process
            }
          }
        }

        return node;
      }; // End of _createRecursive

      // Process all top-level requests
      for (const request of requestArray) {
        const createdNode = _createRecursive(request, targetParentModel, currentPosition, 0);
        if (createdNode) {
          createdTopLevelNodes.push(createdNode);
          // Adjust position for the next top-level node (stack vertically)
          // Use fallback height for layout
          currentPosition.y += 40 + verticalSpacing * 2;
        } else {
          // Handle failure of a top-level node creation if necessary
          // For now, just log and continue
          logMessage(`Failed to create top-level node ${request.typeName}`, LogLevel.ERROR);
        }
      }

      // Finalize Undo Group
      undoQueue.push(undoGroup);
      logMessage(`Pushed undo group: ${undoLabel}`, LogLevel.INFO);

      // Trigger UI update (important!)
      if (typeof nodeGraph.forceUpdate === 'function') {
        nodeGraph.forceUpdate(); // Or similar method to notify UI of changes
        logMessage('Called nodeGraph.forceUpdate()', LogLevel.DEBUG);
      } else if (typeof nodeGraph.emit === 'function') {
        nodeGraph.emit('change'); // Common event pattern
        logMessage('Emitted nodeGraph change event', LogLevel.DEBUG);
      } else {
        logMessage('Could not find method to trigger graph UI update.', LogLevel.WARN);
      }


      return {
        success: true,
        createdNodes: createdTopLevelNodes,
      };

    } catch (error: any) {
      logMessage(`Error in createNodeHierarchy: ${error.message}`, LogLevel.ERROR, { error });
      // Attempt to rollback if possible (UndoQueue might handle this automatically if operations failed)
      // undoQueue.undo(); // Be cautious with manual undo calls
      return {
        success: false,
        createdNodes: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Creates a single node without children. Wrapper around createNodeHierarchy.
   *
   * @param request - The request for the single node.
   * @param targetPosition - The desired position for the node.
   * @param targetParentModel - The parent node. If null, adds to root.
   * @param undoLabel - The label for the undo action.
   * @returns A promise resolving to the result of the creation operation.
   */
  public async createSingleNode(
    request: NodeCreationRequest,
    targetPosition: IVector2,
    targetParentModel: NodeGraphNode | null,
    undoLabel: string
  ): Promise<NodeCreationResult> {
    if (request.children && request.children.length > 0) {
      logMessage('createSingleNode called with children, use createNodeHierarchy instead.', LogLevel.WARN);
      // Optionally strip children or throw error, for now proceed but ignore children
      request.children = undefined;
    }
    return this.createNodeHierarchy(request, targetPosition, targetParentModel, undoLabel);
  }

}

// Export singleton instance
export const nodeCreationService = NodeCreationService.getInstance();
