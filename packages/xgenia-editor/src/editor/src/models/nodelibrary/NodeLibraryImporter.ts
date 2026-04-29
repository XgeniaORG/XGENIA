import { difference } from 'underscore';

import { NodeLibrary } from '@xgenia-models/nodelibrary/nodelibrary';
import {
  NodeLibraryData,
  NodeLibraryDataNodeType,
  RuntimeType,
  RuntimeTypes
} from '@xgenia-models/nodelibrary/NodeLibraryData';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';

declare global {
  interface Window {
    NodeLibraryData: NodeLibraryData | Record<string, never>;
  }
}

/**
 * Keep track of all the clients and their nodes.
 *
 * This is so we can make sure we always give the user the correct information
 * on what nodes are available to them.
 *
 * Because the viewers can connect/disconnect at any times, we keep a cache around to.
 * So when you get all the node names you will always get for all kinds of viewers runtimes.
 */
class ClientCollection {
  // NOTE: Made public for labbing with ConnectionInspector
  public _clients: {
    [clientId: string]: {
      runtimeTypes: Set<RuntimeType>;
      nodes: Set<string>;
    };
  } = {};

  private _cache: {
    [key: string]: Set<string>;
  } = {};

  public get count(): number {
    return Object.keys(this._clients).length;
  }

  public getNodeNames() {
    const taken = new Set<RuntimeType>();

    // Get all the nodes of the viewers we have
    let nodes = Object.entries(this._clients).flatMap(([_clientId, item]) => {
      item.runtimeTypes.forEach((runtimeType) => taken.add(runtimeType));
      return [...item.nodes];
    });

    // Check if we are missing any runtime types
    if (taken.size !== RuntimeTypes.length) {
      const missing = difference(RuntimeTypes, Array.from(taken.keys()));
      missing.forEach((runtimeType) => {
        // For browser and maths runtimes, use empty set if not explicitly provided
        // These may not have a connected viewer/client but should not produce warnings
        if ((runtimeType === RuntimeType.Browser || runtimeType === RuntimeType.Maths || runtimeType === RuntimeType.Cloud) && !this._cache[runtimeType]) {
          this._cache[runtimeType] = new Set();
        }

        if (this._cache[runtimeType]) {
          nodes = nodes.concat(Array.from(this._cache[runtimeType].keys()));
        } else {
          console.warn(`[nodelib] Runtime type not initialized: ${runtimeType}`);
        }
      });
    }

    return new Set<string>(nodes);
  }

  public import(clientId: string, runtimeType: RuntimeType, nodetypes: NodeLibraryDataNodeType[]): void {
    if (!this._clients[clientId]) {
      this._clients[clientId] = {
        runtimeTypes: new Set(),
        nodes: new Set()
      };
    }

    this._clients[clientId].runtimeTypes.add(runtimeType);

    // Update the node set
    this._clients[clientId].nodes.clear();
    nodetypes.forEach((node) => {
      this._clients[clientId].nodes.add(node.name);
    });

    this._cache[runtimeType] = this._clients[clientId].nodes;
  }

  public remove(clientId: string) {
    delete this._clients[clientId];
  }

  public clear() {
    this._clients = {};
    this._cache = {};
  }
}

/**
 * Handle merging of node libraries between different runtimes.
 */
export class NodeLibraryImporter {
  public static instance = new NodeLibraryImporter();

  private currentNodeLibrary: NodeLibraryData = null;
  private clients = new ClientCollection();
  private _cache: { [key: string]: Set<string> } = {};

  constructor() {
    EventDispatcher.instance.on(
      'ProjectModel.instanceWillChange',
      () => {
        this.clients.clear();
        this.currentNodeLibrary = null;
      },
      this
    );

    // Initialize with default browser runtime
    this.initializeDefaultRuntime();
  }

  private initializeDefaultRuntime() {
    const defaultClientId = 'default-browser';
    if (!this.clients._clients[defaultClientId]) {
      this.clients._clients[defaultClientId] = {
        runtimeTypes: new Set([RuntimeType.Browser]),
        nodes: new Set()
      };
      this._cache[RuntimeType.Browser] = new Set();
    }
  }

  // NOTE: Made for labbing with ConnectionInspector
  public clientsWithRuntime(runtimeType: RuntimeType): string[] {
    return Object.keys(this.clients._clients).filter((key) => this.clients._clients[key].runtimeTypes.has(runtimeType));
  }

  public clear() {
    console.debug('[nodelib] Clear');

    this.clients.clear();
    this.currentNodeLibrary = null;
  }

  /**
   * Occurs when the client is disconnecting.
   *
   * @param clientId
   */
  public onClientDisconnect(clientId: string) {
    this.clients.remove(clientId);
    this.updateIndex(false);
  }

  /**
   * Occurs when the client is sending their node library.
   *
   * @param clientId
   * @param runtimeType
   * @param library
   * @returns
   */
  public onClientImport(clientId: string, runtimeType: RuntimeType, library: NodeLibraryData): void {
    // Ensure default runtime is initialized
    this.initializeDefaultRuntime();

    this.clients.import(clientId, runtimeType, library.nodetypes);

    console.debug('[nodelib] Received', runtimeType, ` (nodes: ${library.nodetypes.length})`);

    // Assign or update the new library into our current version.
    let updated = false;
    if (!this.currentNodeLibrary) {
      this.assignNewLibrary(runtimeType, library);
      updated = true;
    } else {
      if (this.mergeUpdates(runtimeType, library)) {
        updated = true;
      }
    }

    this.updateIndex(updated);
  }

  private updateIndex(forceUpdate: boolean): void {
    if (!this.currentNodeLibrary) {
      window.NodeLibraryData = {};
      return;
    }

    const nodeNames = this.clients.getNodeNames();

    // Remove all the nodes that we don't have anymore
    const removedNodes = [];
    this.currentNodeLibrary.nodetypes = this.currentNodeLibrary.nodetypes.filter((node) => {
      if (!nodeNames.has(node.name)) {
        removedNodes.push(node);
        return false;
      }
      return true;
    });

    if (forceUpdate || removedNodes.length > 0) {
      // Send the node library to our NodeLibrary
      const exportJSON = JSON.parse(JSON.stringify(this.currentNodeLibrary));
      console.debug('[nodelib] Updated clients:', Object.keys(this.clients._clients));
      window.NodeLibraryData = exportJSON;

      // Always reload the editor node library when the runtime reports changes.
      // Previously this was gated behind "2+ clients", which prevents updates from showing
      // in the common case where you only have a single local viewer connected.
      console.debug('[nodelib] Loaded new node library');
      if (removedNodes.length > 0) console.debug('[nodelib] Removed nodes: ', removedNodes);
      try {
        NodeLibrary.instance.reload();
      } catch (e: any) {
        console.warn('[nodelib] Failed to reload NodeLibrary:', e);
      }
    }
  }

  private assignNewLibrary(runtimeType: RuntimeType, library: NodeLibraryData) {
    // Use the new library if we have none already.
    this.currentNodeLibrary = library;

    // Add what runtime the nodes are from.
    this.currentNodeLibrary.nodetypes.forEach((node) => {
      node.runtimeTypes = [runtimeType];
    });

    // Make sure the data structure is what we expect
    if (!this.currentNodeLibrary.nodeIndex.coreNodes) {
      this.currentNodeLibrary.nodeIndex.coreNodes = [];
    }

    if (!this.currentNodeLibrary.nodeIndex.moduleNodes) {
      this.currentNodeLibrary.nodeIndex.moduleNodes = [];
    }
  }

  private mergeUpdates(runtimeType: RuntimeType, library: NodeLibraryData): boolean {
    let updated = false;

    // Loop over all the new node types
    library.nodetypes.forEach((node) => {
      const index = this.currentNodeLibrary.nodetypes.findIndex((x) => node.name === x.name);
      if (index === -1) {
        // Add the node, if it doesnt exist with the correct runtime
        node.runtimeTypes = [runtimeType];
        this.currentNodeLibrary.nodetypes.push(node);
        updated = true;
      } else {
        // TODO: Update the node data?

        // Create the array if it doesnt exist
        if (!this.currentNodeLibrary.nodetypes[index].runtimeTypes) {
          this.currentNodeLibrary.nodetypes[index].runtimeTypes = [];
        }

        // Insert the new runtime if we dont have it.
        if (!this.currentNodeLibrary.nodetypes[index].runtimeTypes.includes(runtimeType)) {
          this.currentNodeLibrary.nodetypes[index].runtimeTypes.push(runtimeType);
          updated = true;
        }
      }
    });

    // Merge replace by name function
    function mergeInByName(inputArray: { name: string }[], outputArray: { name: string }[]) {
      inputArray.forEach((inputItem) => {
        const index = outputArray.findIndex((_t) => inputItem.name === _t.name);
        if (index !== -1) {
          outputArray[index] = inputItem;
        } else {
          outputArray.push(inputItem);
          updated = true;
        }
      });

      // if (inputArray.length > 0) {
      //   updated = true;
      // }
    }

    if (library.nodeIndex.coreNodes) {
      mergeInByName(library.nodeIndex.coreNodes, this.currentNodeLibrary.nodeIndex.coreNodes);
    }

    if (library.nodeIndex.moduleNodes) {
      mergeInByName(library.nodeIndex.moduleNodes, this.currentNodeLibrary.nodeIndex.moduleNodes);
    }

    // do the same for project settings ports
    mergeInByName(library.projectsettings.ports, this.currentNodeLibrary.projectsettings.ports);
    mergeInByName(library.projectsettings.dynamicports, this.currentNodeLibrary.projectsettings.dynamicports);

    return updated;
  }
}
