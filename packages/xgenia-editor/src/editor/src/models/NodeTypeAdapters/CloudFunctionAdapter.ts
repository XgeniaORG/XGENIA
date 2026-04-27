import { ComponentModel } from '@xgenia-models/componentmodel';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { ProjectModel } from '../projectmodel';
import NodeTypeAdapter from './NodeTypeAdapter';

export class CloudFunctionAdapter extends NodeTypeAdapter {
  events: Record<string, any>;
  private _updatingPorts: Set<string> = new Set(); // Track nodes currently being updated

  constructor() {
    super('CloudFunction2');

    this.events = {
      componentAdded: this.componentAddedOrRemoved.bind(this),
      componentRemoved: this.componentAddedOrRemoved.bind(this),
      componentRenamed: this.componentRenamed.bind(this),
      nodeAdded: this.nodeAddedOrRemoved.bind(this),
      nodeRemoved: this.nodeAddedOrRemoved.bind(this),
      'nodeAdded:CloudFunction2': this.functionNodeAdded.bind(this),
      'nodeAdded:xgenia.cloud.request': this.updateAllFunctionsPorts.bind(this),
      'nodeRemoved:xgenia.cloud.request': this.updateAllFunctionsPorts.bind(this),
      'nodeAdded:xgenia.cloud.response': this.updateAllFunctionsPorts.bind(this),
      'nodeRemoved:xgenia.cloud.response': this.updateAllFunctionsPorts.bind(this),
      projectLoaded: this.updateAllFunctionsPorts.bind(this),
      'parametersChanged:xgenia.cloud.request': this.updateAllFunctionsPorts.bind(this),
      'parametersChanged:xgenia.cloud.response': this.updateAllFunctionsPorts.bind(this),
      'parametersChanged:CloudFunction2': this.functionParametersChanged.bind(this) //update if a router name has changed
    };

    // Add EventDispatcher listeners for real-time updates
    this.setupEventDispatcherListeners();
  }

  setupEventDispatcherListeners() {
    // Listen for node additions
    EventDispatcher.instance.on(
      'Model.nodeAdded',
      (e) => {
        if (e.args && e.args.model && e.args.model.type) {
          const nodeType = e.args.model.type.name;

          if (nodeType === 'CloudFunction2') {
            this.functionNodeAdded({ args: { model: e.args.model } });
          } else if (nodeType === 'xgenia.cloud.request' || nodeType === 'xgenia.cloud.response') {
            this.updateAllFunctionsPorts();
          }
        }
      },
      this
    );

    // Listen for parameter changes
    EventDispatcher.instance.on(
      'Model.parametersChanged',
      (e) => {
        if (e.model && e.model.type) {
          const nodeType = e.model.type.name;

          if (nodeType === 'CloudFunction2') {
            // Check if we're already updating this node to prevent infinite loops
            if (this._updatingPorts.has(e.model.id)) {
              return;
            }
            this.functionParametersChanged({ model: e.model });
          } else if (nodeType === 'xgenia.cloud.request' || nodeType === 'xgenia.cloud.response') {
            this.updateAllFunctionsPorts();
          }
        }
      },
      this
    );

    // Listen for node removals
    EventDispatcher.instance.on(
      'Model.nodeRemoved',
      (e) => {
        if (e.model && e.model.type) {
          const nodeType = e.model.type.name;
          if (nodeType === 'xgenia.cloud.request' || nodeType === 'xgenia.cloud.response') {
            this.updateAllFunctionsPorts();
          }
        }
      },
      this
    );
  }

  componentAddedOrRemoved(e) {
    // Safety check: e can be undefined when called during project load
    if (!e) {
      console.warn('[CloudFunctionAdapter] componentAddedOrRemoved called with undefined event');
      return;
    }
    
    const componentName = e.model?.fullName;
    if (componentName && componentName.startsWith('/#__cloud__/')) {
      // A cloud function node is possibly removed, update all functions
      this.updateAllFunctionsPorts();
    }
  }

  componentRenamed(e) {
    // Safety check: e can be undefined when called during project load
    if (!e) {
      console.warn('[CloudFunctionAdapter] componentRenamed called with undefined event');
      return;
    }
    
    const before = e.oldName;
    const after = e.model?.fullName;

    if (!before || !after) {
      return; // Skip if we don't have the required information
    }

    // Note: No need to handle undo here as it will simply revert back to a new renamne
    // Find all functions that have this component as it's function and change
    const functionNodes = this.findAllNodes();

    functionNodes.forEach((f) => {
      if ('/#__cloud__/' + f.parameters['function'] === before) {
        f.setParameter('function', after.replace('/#__cloud__/', ''));
      }
    });

    this.updateAllFunctionsPorts();
  }

  updatePortsForNode(node) {
    // Mark this node as being updated to prevent infinite loops
    this._updatingPorts.add(node.id);

    try {
      // PRESERVE existing parameter values before updating ports
      const existingParams = { ...node.parameters };

      const ports = [];

      // Collect all cloud function components
      const functionRequestNodes = ProjectModel.instance.getNodesWithType('xgenia.cloud.request');
      const functions = functionRequestNodes
        .map((r) => {
          const component = r.owner.owner;
          return component.fullName;
        })
        // Remove all the Cloud Trigger functions
        .filter((x) => !x.startsWith('/#__cloud__/__xgenia_cloud_triggers__'));

      ports.push({
        plug: 'input',
        type: {
          name: 'component',
          components: functions,
          ignoreSheetName: true,
          allowEditOnly: true
        },
        group: 'General',
        displayName: 'Function',
        name: 'function'
      });

      if (node.parameters['function'] !== undefined) {
        const componentName = '/#__cloud__/' + node.parameters['function'];
        const component = ProjectModel.instance.getComponentWithName(componentName);
        if (component !== undefined) {
          // Collect inputs from request nodes
          const functionRequests = component.getNodesWithType('xgenia.cloud.request');
          if (functionRequests !== undefined) {
            const uniqueNames = {};

            functionRequests.forEach((pi) => {
              if (pi.parameters['params'] !== undefined)
                pi.parameters['params'].split(',').forEach((p) => {
                  const trimmed = p.trim();
                  if (trimmed !== '') {
                    uniqueNames[trimmed] = true;
                  }
                });
            });

            Object.keys(uniqueNames).forEach((inputName) => {
              ports.push({
                name: 'in-' + inputName,
                displayName: inputName,
                type: '*',
                plug: 'input',
                group: 'Parameters'
              });
            });
          }

          // Collect outputs from response nodes
          const functionResponses = component.getNodesWithTypeRecursive('xgenia.cloud.response');
          const uniqueNames = {};

          functionResponses.forEach((pi) => {
            if (pi.parameters['params'] !== undefined)
              pi.parameters['params'].split(',').forEach((p) => (uniqueNames[p] = true));
          });

          Object.keys(uniqueNames).forEach((inputName) => {
            ports.push({
              name: 'out-' + inputName,
              displayName: inputName,
              type: '*',
              plug: 'output',
              group: 'Results'
            });
          });
        }
      }

      node.setDynamicPorts(ports);

      // CRITICAL: Register the dynamic ports with the node's runtime methods
      // This ensures the proper getter/setter functions are bound
      ports.forEach((port) => {
        if (port.plug === 'input' && typeof (node as any).registerInputIfNeeded === 'function') {
          (node as any).registerInputIfNeeded(port.name);
        } else if (port.plug === 'output' && typeof (node as any).registerOutputIfNeeded === 'function') {
          (node as any).registerOutputIfNeeded(port.name);
        }
      });

      // RESTORE existing parameter values after updating ports
      // Only restore parameters that are still valid (i.e., have corresponding ports)
      const validParamNames = new Set(['function']); // Always preserve the function parameter
      ports.forEach((port) => {
        if (port.plug === 'input' && port.name.startsWith('in-')) {
          validParamNames.add(port.name);
        }
      });

      // Restore valid existing parameters
      Object.keys(existingParams).forEach((paramName) => {
        if (validParamNames.has(paramName) && existingParams[paramName] !== undefined) {
          // Only restore if the value is different to avoid unnecessary updates
          if (node.parameters[paramName] !== existingParams[paramName]) {
            node.setParameter(paramName, existingParams[paramName]);
          }
        } else if (!validParamNames.has(paramName)) {
          // Remove invalid parameters that no longer exist in the cloud function
          delete node.parameters[paramName];
        }
      });
    } finally {
      // Always clean up the tracking to prevent infinite loops
      this._updatingPorts.delete(node.id);
    }
  }

  functionNodeAdded(e) {
    // Safety check: e can be undefined when called during project load
    if (!e) {
      console.warn('[CloudFunctionAdapter] functionNodeAdded called with undefined event');
      return;
    }
    
    // Handle both event structures: e.args.model (EventDispatcher wrapper) and e.args.model (regular adapter)
    const node = e.args?.model;
    if (!node) {
      return;
    }

    // Add a small delay to ensure the node is fully processed
    setTimeout(() => {
      this.updatePortsForNode(node);
    }, 100);

    // Also try again after a longer delay in case the component is still loading
    setTimeout(() => {
      this.updatePortsForNode(node);
    }, 500);
  }

  nodeAddedOrRemoved(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.args || !e.args.model) {
      console.warn('[CloudFunctionAdapter] nodeAddedOrRemoved called with undefined event or model');
      return;
    }
    
    const type = e.args.model.type;

    if (
      type instanceof ComponentModel && //is this node an instance of a component?
      type.fullName.startsWith('/#__cloud__/') && //...in a cloud function?
      type.graph.forEachNodeRecursive((n) => n.type.name === 'xgenia.cloud.response') //...and has a response node?
    ) {
      this.updateAllFunctionsPorts();
    }
  }

  updateAllFunctionsPorts() {
    // We need to update all function nodes
    const functionNodes = this.findAllNodes();

    if (functionNodes.length === 0) {
      // Fallback: check all nodes in project if adapter nodes not found
      const allNodes = ProjectModel.instance.getNodesWithType('CloudFunction2');

      if (allNodes.length > 0) {
        // Update these nodes directly
        allNodes.forEach((node) => {
          this.updatePortsForNode(node);
        });
      }
    } else {
      // Only run this if we found nodes via findAllNodes()
      functionNodes.forEach((node) => {
        this.updatePortsForNode(node);
      });
    }
  }

  functionParametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e) {
      console.warn('[CloudFunctionAdapter] functionParametersChanged called with undefined event');
      return;
    }
    
    // Handle both event structures: e.model (EventDispatcher) and e.args.model (regular adapter)
    const node = e.model || e.args?.model;
    if (node) {
      this.updatePortsForNode(node);
    }
  }

  // Test method to manually trigger port updates for debugging
  testUpdateAllPorts() {
    this.updateAllFunctionsPorts();
  }

  // Test method to check if adapter is working
  testAdapter() {
    const functionNodes = this.findAllNodes();
    const allNodes = ProjectModel.instance.getNodesWithType('CloudFunction2');
    return { functionNodes, allNodes };
  }
}
