import { Node } from '@xgenia/runtime';
import guid from '../../../guid';
import Collection from '@xgenia/runtime/src/collection';
import Model from '@xgenia/runtime/src/model';

import React from 'react';
import XgeniaRuntime from '@xgenia/runtime';

function ForEachComponent(props) {
  const { didMount, willUnmount } = props;

  React.useEffect(() => {
    didMount();
    return () => {
      willUnmount();
    };
  }, []);

  return null;
}

function _typeName(t) {
  if (typeof t === 'object') return t.name;
  else return t;
}

const defaultDynamicScript =
  "// Set the 'component' variable to the name of the desired component for this item.\n" +
  "// Component name must start with a '/'.\n" +
  "// A component in a sheet is referred to by '/#Sheet Name/Comopnent Name'.\n" +
  "// The data for each item is available in a variable called 'item'\n" +
  "component = '/MyComponent';";

const defaultMapCode =
  '// Here you add mappings between the properties of the item objects and the inputs of the components.\n' +
  "// 'myComponentInput': 'myObjectProperty',\n" +
  "// 'anotherComponentInput': function () { return object.get('someProperty') + ' ' + object.get('otherProp') }\n" +
  '// These are the default mappings based on the selected template component.\n' +
  'map({\n' +
  '{{#mappings}}' +
  '})\n';

const ForEachDefinition = {
  name: 'For Each',
  displayNodeName: 'Repeater',
  docs: 'https://docsapp.xgenia.com/nodes/ui-controls/repeater',
  color: 'visual',
  category: 'Visual',
  dynamicports: [
    {
      name: 'conditionalports/extended',
      condition: 'templateType = explicit OR templateType NOT SET',
      inputs: ['template']
    },
    {
      name: 'conditionalports/extended',
      condition: 'templateType = dynamic',
      inputs: ['templateScript']
    }
  ],
  initialize() {
    this._internal.itemNodes = [];
    this._internal.itemOutputSignals = {};
    this._internal.itemOutputs = {};
    this._internal.collection = Collection.get(); // We keep an internal collection so we don't have to refresh all content if the input items collection changes
    this._internal.queuedOperations = [];
    this._internal.mountedOperations = [];

    // Add an item
    this._internal.collection.on('add', (args) => {
      if (!this._internal.target) return;

      this._queueOperation(async () => {
        const baseIndex = this._internal.target.getChildren().indexOf(this) + 1;
        await this.addItem(args.item, baseIndex + args.index);
      });
    });

    // Remove an item
    this._internal.collection.on('remove', (args) => {
      this._queueOperation(() => {
        this.removeItem(args.item);
      });
    });

    // On collection changed
    this._internal.onItemsCollectionChanged = () => {
      const repeaterDisabledWhenUnmounted = XgeniaRuntime.instance.getProjectSettings().repeaterDisabledWhenUnmounted;

      if (repeaterDisabledWhenUnmounted && !this.isMounted) {
        this._internal.mountedOperations.push(() => {
          this._internal.collection.set(this._internal.items);
        });
      } else {
        this._queueOperation(() => {
          this._internal.collection.set(this._internal.items);
        });
      }
    };

    this.addDeleteListener(() => {
      this._deleteAllItemNodes();
    });
  },
  inputs: {
    items: {
      group: 'Data',
      displayName: 'Items',
      type: 'array',
      set: function (value) {
        if (!value) return;
        if (value === this._internal.items) return;
        this.bindCollection(value);
        //this.scheduleRefresh();
      }
    },
    templateType: {
      group: 'Appearance',
      displayName: 'Template Type',
      type: {
        name: 'enum',
        enums: [
          { label: 'Explicit', value: 'explicit' },
          { label: 'Dynamic', value: 'dynamic' }
        ]
      },
      default: 'explicit',
      set: function (value) {
        this._internal.templateType = value;
        this.scheduleRefresh();
      }
    },
    template: {
      type: 'component',
      displayName: 'Template',
      group: 'Appearance',
      set: function (value) {
        this._internal.template = value;
        this.scheduleRefresh();
      }
    },
    templateScript: {
      type: { name: 'string', codeeditor: 'javascript', allowEditOnly: true },
      displayName: 'Script',
      group: 'Appearance',
      default: defaultDynamicScript,
      set: function (value) {
        try {
          this._internal.templateFunction = new Function('item', 'var component;' + value + ';return component;');
        } catch (e) {
          console.log(e);
          if (this.context.editorConnection) {
            this.context.editorConnection.sendWarning(
              this.nodeScope.componentOwner.name,
              this.id,
              'foreach-syntax-warning',
              { message: '<strong>Syntax</strong>: ' + e.message }
            );
          }
        }
        this.scheduleRefresh();
      }
    },
    refresh: {
      group: 'Appearance',
      displayName: 'Refresh',
      type: 'signal',
      valueChangedToTrue: function () {
        this.scheduleRefresh();
      }
    }
  },
  outputs: {
    itemActionItemId: {
      type: 'string',
      group: 'Actions',
      displayName: 'Item Id',
      getter: function () {
        return this._internal.itemActionItemId;
      }
    }
  },
  prototypeExtensions: {
    updateTarget: function (targetId) {
      this._internal.target = targetId ? this.nodeScope.getNodeWithId(targetId) : undefined;
      this.scheduleRefresh();
    },
    setNodeModel: function (nodeModel) {
      Node.prototype.setNodeModel.call(this, nodeModel);
      if (nodeModel.parent) {
        this.updateTarget(nodeModel.parent.id);
      }
      var self = this;
      nodeModel.on(
        'parentUpdated',
        function (newParent) {
          self.updateTarget(newParent ? newParent.id : undefined);
        },
        this
      );
    },
    scheduleRefresh: function () {
      var _this = this;
      var internal = this._internal;
      if (!internal.hasScheduledRefresh) {
        internal.hasScheduledRefresh = true;
        this.scheduleAfterInputsHaveUpdated(() => {
          this._queueOperation(() => {
            this.refresh();
          });
        });
      }
    },
    unbindCurrentCollection: function () {
      var collection = this._internal.items;
      if (!collection) return;

      Collection.instanceOf(collection) && collection.off('change', this._internal.onItemsCollectionChanged);
      this._internal.items = undefined;
    },
    bindCollection: function (collection) {
      var internal = this._internal;

      this.unbindCurrentCollection();

      Collection.instanceOf(collection) && collection.on('change', this._internal.onItemsCollectionChanged);

      internal.items = collection;
      this.scheduleCopyItems();
    },
    getTemplateForModel: function (model) {
      var internal = this._internal;
      if (internal.templateType === undefined || internal.templateType === 'explicit') return internal.template;

      if (!internal.templateFunction) return;
      try {
        var template = internal.templateFunction(model);
      } catch (e) {
        console.log(e);
        if (this.context.editorConnection) {
          this.context.editorConnection.sendWarning(
            this.nodeScope.componentOwner.name,
            this.id,
            'foreach-dynamic-warning',
            { message: '<strong>Dynamic template</strong>: ' + e.message }
          );
        }
      }

      //simple (and limited) way to support ./ and ../ at the start of component template names
      if (template) {
        if (template.startsWith('./')) {
          template = this.model.component.name + template.substring(1);
        }

        if (template.startsWith('../')) {
          const pathParts = this.model.component.name.split('/');
          const parentPath = pathParts.slice(0, pathParts.length - 1).join('/');
          template = parentPath + template.substring(2);
        }
      }

      return template;
    },
    _mapInputs: function (itemNode, model) {
      if (this._internal.inputMapFunc !== undefined) {
        // We have a mapping function, run the function and use the mapped values
        // as inputs
        this._internal.inputMapFunc(function (mappings) {
          for (var key in mappings) {
            if (itemNode.hasInput(key)) {
              if (typeof mappings[key] === 'function') {
                itemNode.setInputValue(key, mappings[key](model));
              } else if (typeof mappings[key] === 'string') {
                itemNode.setInputValue(key, model.get(mappings[key]));
              }
            }
          }
        }, model);
      }
    },
    addItem: async function (model, index) {
      var internal = this._internal;

      // Defensive check: ensure model is valid and has required methods
      if (!model) {
        console.error('[ForEach] addItem called with undefined/null model');
        return;
      }

      if (typeof model.getId !== 'function') {
        console.error('[ForEach] addItem called with invalid model - missing getId method:', model);
        return;
      }

      if (typeof model.on !== 'function') {
        console.error('[ForEach] addItem called with invalid model - missing on method:', model);
        return;
      }

      // Create a new component for this item
      var template = this.getTemplateForModel(model);
      if (!template) return;

      try {
        var itemNode = await this.nodeScope.createNode(template, guid(), {
          _forEachModel: model,
          _forEachNode: this
        });
      } catch (error) {
        console.error('[ForEach] addItem - failed to create itemNode for template:', template, 'Error:', error);
        return;
      }

      // Set input values for all model data, and track changes
      if (this._internal.inputMapFunc === undefined) {
        //set component inputs with values from model
        if (itemNode.hasInput('Id')) {
          itemNode.setInputValue('Id', model.getId());
        }
        if (itemNode.hasInput('id')) {
          itemNode.setInputValue('id', model.getId());
        }

        for (var inputKey in itemNode._inputs) {
          if (model.data && model.data[inputKey] !== undefined) itemNode.setInputValue(inputKey, model.data[inputKey]);
        }

        //listen to changes on model
        itemNode._forEachModelChangeListener = function (ev) {
          if (itemNode._inputs[ev.name]) itemNode.setInputValue(ev.name, ev.value);
        };
        model.on('change', itemNode._forEachModelChangeListener);

        //listen to changes to the component inputs
        itemNode.componentModel.on(
          'inputPortAdded',
          (port) => {
            if (port.name === 'id') itemNode.setInputValue('id', model.getId());
            if (port.name === 'Id') itemNode.setInputValue('Id', model.getId());

            if (model.data && model.data[port.name] !== undefined) {
              itemNode.setInputValue(port.name, model.data[port.name]);
            }
          },
          this
        );
      } else {
        // If there is a map script, then use it
        this._mapInputs(itemNode, model);
        itemNode._forEachModelChangeListener = () => this._mapInputs(itemNode, model);
        model.on('change', itemNode._forEachModelChangeListener);
      }

      // Create connections for all item output signals that we should forward
      itemNode._internal.creatorCallbacks = {
        onOutputChanged: (name, value, oldValue) => {
          console.log(`[ForEach] NEW CODE: *** creatorCallbacks.onOutputChanged called ***:`, {
            name, value, oldValue,
            hasSignal: !!internal.itemOutputSignals[name],
            isSignalTrigger: (oldValue === false || oldValue === undefined) && value === true
          });

          if ((oldValue === false || oldValue === undefined) && value === true && internal.itemOutputSignals[name]) {
            console.log(`[ForEach] NEW CODE: *** Triggering signal via creatorCallbacks for '${name}' ***`);
            this.itemOutputSignalTriggered(name, model, itemNode);
          }
        }
      };

      // DEBUGGING: Add direct monitoring of the ComponentInstance output methods
      console.log('[ForEach] NEW CODE: Setting up direct monitoring of ComponentInstance methods');

      // Monitor setOutputFromComponentOutput calls using defineProperty
      if (itemNode.setOutputFromComponentOutput) {
        const originalSetOutput = itemNode.setOutputFromComponentOutput.bind(itemNode);
        try {
          Object.defineProperty(itemNode, 'setOutputFromComponentOutput', {
            value: (name, value) => {
              console.log(`[ForEach] NEW CODE: *** setOutputFromComponentOutput called ***:`, { name, value });
              return originalSetOutput(name, value);
            },
            writable: true,
            configurable: true
          });
        } catch (e) {
          console.log(`[ForEach] NEW CODE: Failed to wrap setOutputFromComponentOutput:`, e);
        }
      }

      // Monitor sendSignalOnOutput calls using defineProperty
      if (itemNode.sendSignalOnOutput) {
        const originalSendSignal = itemNode.sendSignalOnOutput.bind(itemNode);
        try {
          Object.defineProperty(itemNode, 'sendSignalOnOutput', {
            value: (outputName) => {
              console.log(`[ForEach] NEW CODE: *** sendSignalOnOutput called ***:`, { outputName });
              return originalSendSignal(outputName);
            },
            writable: true,
            configurable: true
          });
        } catch (e) {
          console.log(`[ForEach] NEW CODE: Failed to wrap sendSignalOnOutput:`, e);
        }
      }

      // Monitor flagOutputDirty calls using defineProperty
      if (itemNode.flagOutputDirty) {
        const originalFlagDirty = itemNode.flagOutputDirty.bind(itemNode);
        try {
          Object.defineProperty(itemNode, 'flagOutputDirty', {
            value: (outputName) => {
              console.log(`[ForEach] NEW CODE: *** flagOutputDirty called ***:`, { outputName });
              return originalFlagDirty(outputName);
            },
            writable: true,
            configurable: true
          });
        } catch (e) {
          console.log(`[ForEach] NEW CODE: Failed to wrap flagOutputDirty:`, e);
        }
      }

      // CRITICAL: Discover and register all outputs from the child component at runtime
      console.log('[ForEach] NEW CODE: Discovering outputs for itemNode:', itemNode.id);
      console.log('[ForEach] NEW CODE: ItemNode type:', itemNode.constructor.name);
      console.log('[ForEach] NEW CODE: ItemNode._outputs:', Object.keys(itemNode._outputs || {}));

      // Look up the node metadata to determine which outputs are signals
      const nodeTypeName = itemNode.nodeTypeName || itemNode.name;
      console.log('[ForEach] NEW CODE: Node type name:', nodeTypeName);
      console.log('[ForEach] NEW CODE: ItemNode.componentModel:', itemNode.componentModel);

      let nodeMetadata = null;
      try {
        nodeMetadata = this.nodeScope.context.nodeRegister.getNodeMetadata(nodeTypeName);
        console.log('[ForEach] NEW CODE: Found node metadata:', nodeMetadata);
        console.log('[ForEach] NEW CODE: Metadata outputs:', nodeMetadata?.outputs);

        // Debug: Show the actual metadata structure for each output
        if (nodeMetadata?.outputs) {
          for (const [outputName, outputDef] of Object.entries(nodeMetadata.outputs)) {
            console.log(`[ForEach] NEW CODE: Metadata for output '${outputName}':`, outputDef);
            console.log(`[ForEach] NEW CODE: Output '${outputName}' type: '${outputDef.type}' (${typeof outputDef.type})`);
          }
        }

        // Also try to get component model output ports
        if (itemNode.componentModel) {
          console.log('[ForEach] NEW CODE: Component model output ports:', itemNode.componentModel.getOutputPorts());
          const outputPorts = itemNode.componentModel.getOutputPorts();
          for (const [portName, portDef] of Object.entries(outputPorts)) {
            console.log(`[ForEach] NEW CODE: Component output port '${portName}':`, portDef);
            console.log(`[ForEach] NEW CODE: Component output port '${portName}' type: '${portDef.type}' (${typeof portDef.type})`);
          }
        }
      } catch (e) {
        console.log('[ForEach] NEW CODE: Could not get metadata for node type:', nodeTypeName, e);
      }

      // Process all outputs from the child node
      for (let outputName in itemNode._outputs) {
        const output = itemNode._outputs[outputName];
        if (output) {
          // Try to determine if this is a signal from multiple sources
          let isSignal = false;

          // Method 1: Check node metadata
          const outputMetadata = nodeMetadata?.outputs?.[outputName];
          if (outputMetadata?.type === 'signal') {
            isSignal = true;
          }

          // Method 2: Check component model output ports
          if (!isSignal && itemNode.componentModel) {
            const componentOutputPorts = itemNode.componentModel.getOutputPorts();
            const componentOutputPort = componentOutputPorts[outputName];
            if (componentOutputPort?.type === 'signal') {
              isSignal = true;
            }
          }

          // Method 3: For now, let's treat common signal names as signals
          if (!isSignal && ['clicked', 'Success', 'Failure', 'submit', 'cancel', 'done'].includes(outputName)) {
            console.log(`[ForEach] NEW CODE: Treating '${outputName}' as signal based on naming convention`);
            isSignal = true;
          }

          console.log(`[ForEach] NEW CODE: Processing output '${outputName}' - isSignal: ${isSignal} (metadata: ${outputMetadata?.type}, component: ${itemNode.componentModel?.getOutputPorts()?.[outputName]?.type})`);

          // Register both signal and regular outputs dynamically
          this.registerOutputIfNeeded('itemOutputSignal-' + outputName);
          this.registerOutputIfNeeded('itemOutput-' + outputName);

          // Mark the signal as available so it gets triggered properly
          this._internal.itemOutputSignals[outputName] = true;

          console.log(`[ForEach] NEW CODE: Registered outputs for ${outputName} - signal: itemOutputSignal-${outputName}, regular: itemOutput-${outputName}`);
          console.log(`[ForEach] NEW CODE: Marked ${outputName} as available signal: true`);

          // Hook into the output's sendValue method to intercept value changes
          // Since sendValue is read-only, we need to wrap it using Object.defineProperty
          const originalSendValue = output.sendValue.bind(output);

          try {
            Object.defineProperty(output, 'sendValue', {
              value: (value) => {
                console.log(`[ForEach] NEW CODE: INTERCEPTED sendValue for output '${outputName}' with value:`, value, 'type:', typeof value);

                // Call the original sendValue first to maintain normal behavior
                originalSendValue(value);

                // Forward the signal/value through the ForEach node
                if (isSignal) {
                  // For signals, we care about the true->false pulse or just true values
                  if (value === true) {
                    console.log(`[ForEach] NEW CODE: Triggering signal for output '${outputName}' (true pulse)`);
                    this.itemOutputSignalTriggered(outputName, model, itemNode);
                    console.log(`[ForEach] NEW CODE: Signal sent successfully for '${outputName}'`);
                  } else if (value === false) {
                    console.log(`[ForEach] NEW CODE: Signal false pulse for output '${outputName}' - not forwarding`);
                  }
                } else {
                  console.log(`[ForEach] NEW CODE: Updating regular output value for '${outputName}'`);
                  this._internal.itemOutputs[outputName] = value;
                  this.flagOutputDirty('itemOutput-' + outputName);
                }
              },
              writable: true,
              configurable: true
            });
            console.log(`[ForEach] NEW CODE: Successfully wrapped sendValue for output '${outputName}'`);
          } catch (e) {
            console.log(`[ForEach] NEW CODE: Failed to wrap sendValue for output '${outputName}':`, e);
            console.log(`[ForEach] NEW CODE: Will rely on creatorCallbacks only for this output`);
          }
        }
      }

      console.log('[ForEach] NEW CODE: Output discovery and interception complete for itemNode:', itemNode.id);

      // Connect all model nodes of the component that have id type = instance
      /*var itemScopes = itemNode.nodeScope.getNodesWithType('Model')
      if(itemScopes && itemScopes.length>0) {
        for(var j = 0; j < itemScopes.length; j++) {
          itemScopes[j].hasInstanceIDType()&&itemScopes[j].setModel(model);
        }
      }*/

      // If there is a for each actions node, signal that the item has been added
      var forEachActions = itemNode.nodeScope.getNodesWithType('For Each Actions');
      for (var j = 0; j < forEachActions.length; j++) {
        forEachActions[j].signalAdded();
      }

      internal.itemNodes.push(itemNode);
      internal.target.addChild(itemNode, index);
    },
    removeItem: function (model) {
      var internal = this._internal;
      if (!internal.target) return;

      function findChild() {
        var children = internal.target.getChildren();
        for (var i in children) {
          var c = children[i];
          if (c._forEachModel === model && !c._forEachRemoveInProgress) return c;
        }
      }
      var child = findChild();
      if (!child) return;

      var forEachActions = child.nodeScope.getNodesWithType('For Each Actions');
      if (forEachActions && forEachActions.length > 0) {
        // Run a try remove on the for each actions, remove the child when completed
        child._forEachRemoveInProgress = true;
        forEachActions[0].tryRemove(() => this._deleteItem(child));
      } else {
        // There are no for each actions, just remove the item
        this._deleteItem(child);
      }

      var idx = internal.itemNodes.indexOf(child);
      idx !== -1 && internal.itemNodes.splice(idx, 1);
    },
    _deleteItem(item) {
      // Defensive check: ensure item and its model are valid before calling methods
      if (item._forEachModel && typeof item._forEachModel.off === 'function') {
        item._forEachModel.off('change', item._forEachModelChangeListener);
      }

      item.model && item.model.removeListenersWithRef(this);
      item.componentModel && item.componentModel.removeListenersWithRef(this);

      const parent = item.parent;
      if (item._deleted || !parent) return;

      parent.removeChild(item);
      this.nodeScope.deleteNode(item);
    },
    _deleteAllItemNodes: function () {
      if (!this._internal.itemNodes) return;

      for (const itemNode of this._internal.itemNodes) {
        this._deleteItem(itemNode);
      }

      this._internal.itemNodes = [];
    },
    refresh: async function () {
      var internal = this._internal;
      internal.hasScheduledRefresh = false;
      if (!(internal.template || internal.templateFunction) || !internal.items) return;

      this._deleteAllItemNodes();

      //check if we have a target to add nodes to
      if (!internal.target) return;

      // figure out our index in our target
      const baseIndex = this._internal.target.getChildren().indexOf(this) + 1;

      // Iterate over all models and create items
      for (var i = 0; i < internal.collection.size(); i++) {
        var model = internal.collection.get(i);

        // If the model is not a proper Model instance, try to convert it
        if (!model || typeof model.getId !== 'function' || typeof model.on !== 'function') {
          console.warn(`[ForEach] refresh: Model at index ${i} is not a proper Model instance, attempting to convert:`, model);
          // Import Model class and try to create a proper model
          if (Model && Model.create) {
            model = Model.create(model);
          }
        }

        await this.addItem(model, baseIndex + i);
      }
    },
    _queueOperation(op) {
      this._internal.queuedOperations.push(op);
      this._runQueueOperations();
    },
    async _runQueueOperations() {
      if (this.runningOperations) {
        return;
      }
      this.runningOperations = true;

      const repeaterCreateComponentsAsync = XgeniaRuntime.instance.getProjectSettings().repeaterCreateComponentsAsync;

      if (repeaterCreateComponentsAsync) {
        //create items in chunks of roughly 25ms at a time
        //so basically trying to keep ~30 fps
        const runOps = async () => {
          const start = performance.now();

          while (this._internal.queuedOperations.length && performance.now() - start < 25) {
            const op = this._internal.queuedOperations.shift();
            await op();
          }

          if (this._internal.queuedOperations.length) {
            setTimeout(runOps, 0);
          } else {
            this.runningOperations = false;
          }
        };

        runOps();
      } else {
        while (this._internal.queuedOperations.length) {
          const op = this._internal.queuedOperations.shift();
          await op();
        }

        this.runningOperations = false;
      }
    },
    _onNodeDeleted: function () {
      Node.prototype._onNodeDeleted.call(this);
      this._internal.queuedOperations.length = 0; //delete all queued operations
      this.unbindCurrentCollection();
    },
    render() {
      return <ForEachComponent key={this.id} didMount={() => this.didMount()} willUnmount={() => this.willUnmount()} />;
    },
    didMount() {
      this.isMounted = true;

      for (const op of this._internal.mountedOperations) {
        this._queueOperation(op);
      }
      this._internal.mountedOperations = [];
    },
    willUnmount() {
      this.isMounted = false;
    },
    getItemActionParameter: function (name) {
      if (!this._internal.itemActionParameters) return;
      return this._internal.itemActionParameters[name];
    },
    scheduleCopyItems: function () {
      if (this._internal.hasScheduledCopyItems) return;
      this._internal.hasScheduledCopyItems = true;
      this.scheduleAfterInputsHaveUpdated(() => {
        this._internal.hasScheduledCopyItems = false;

        if (this._internal.items === undefined) return;

        const repeaterDisabledWhenUnmounted = XgeniaRuntime.instance.getProjectSettings().repeaterDisabledWhenUnmounted;

        if (repeaterDisabledWhenUnmounted && !this.isMounted) {
          this._internal.mountedOperations.push(() => {
            this._internal.collection.set(this._internal.items);
          });
        } else {
          this._internal.collection.set(this._internal.items);
        }
      });
    },
    itemOutputSignalTriggered: function (name, model, itemNode) {
      console.log(`[ForEach] NEW CODE: *** itemOutputSignalTriggered called for '${name}' ***`);

      // Defensive check: ensure model is valid and has getId method
      if (!model || typeof model.getId !== 'function') {
        console.error('[ForEach] itemOutputSignalTriggered called with invalid model:', model);
        return;
      }

      this._internal.itemActionItemId = model.getId();
      this._internal.itemActionSignal = name;
      this.flagOutputDirty('itemActionItemId');

      console.log(`[ForEach] NEW CODE: Set itemActionItemId to '${this._internal.itemActionItemId}' and itemActionSignal to '${name}'`);

      // Send signal and update item outputs after they have been correctly updated
      if (!this._internal.hasScheduledTriggerItemOutputSignal) {
        this._internal.hasScheduledTriggerItemOutputSignal = true;
        console.log(`[ForEach] NEW CODE: Scheduling ForEach output signal for '${name}'`);

        this.context.scheduleAfterUpdate(() => {
          this._internal.hasScheduledTriggerItemOutputSignal = false;

          console.log(`[ForEach] NEW CODE: Updating all item outputs and sending ForEach signal for '${this._internal.itemActionSignal}'`);

          for (var key in itemNode._outputs) {
            var _output = 'itemOutput-' + key;
            if (this.hasOutput(_output)) {
              this._internal.itemOutputs[key] = itemNode._outputs[key].value;
              this.flagOutputDirty(_output);
              console.log(`[ForEach] NEW CODE: Updated output '${_output}' with value:`, itemNode._outputs[key].value);
            }
          }

          const forEachSignalOutput = 'itemOutputSignal-' + this._internal.itemActionSignal;
          console.log(`[ForEach] NEW CODE: *** SENDING FOREACH SIGNAL OUTPUT: '${forEachSignalOutput}' ***`);
          this.sendSignalOnOutput(forEachSignalOutput);
          console.log(`[ForEach] NEW CODE: *** FOREACH SIGNAL SENT SUCCESSFULLY! ***`);
        });
      } else {
        console.log(`[ForEach] NEW CODE: Signal trigger already scheduled, skipping duplicate for '${name}'`);
      }
    },
    getItemOutput: function (name) {
      return this._internal.itemOutputs[name];
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('itemOutputSignal-')) {
        this._internal.itemOutputSignals[name.substring('itemOutputSignal-'.length)] = true;
        this.registerOutput(name, {
          getter: function () {
            /** No needed for signals */
          }
        });
      } else if (name.startsWith('itemOutput-'))
        this.registerOutput(name, {
          getter: this.getItemOutput.bind(this, name.substring('itemOutput-'.length))
        });
    },
    setInputMappingScript: function (value) {
      if (this.context.editorConnection) {
        this.context.editorConnection.clearWarning(
          this.nodeScope.componentOwner.name,
          this.id,
          'foreach-inputmapping-warning'
        );
      }

      this._internal.inputMappingScript = value;

      if (this._internal.inputMappingScript) {
        try {
          this._internal.inputMapFunc = new Function('map', 'object', this._internal.inputMappingScript);
        } catch (e) {
          this._internal.inputMapFunc = undefined;
          if (this.context.editorConnection) {
            this.context.editorConnection.sendWarning(
              this.nodeScope.componentOwner.name,
              this.id,
              'foreach-inputmapping-warning',
              { message: '<strong>Input mapping</strong>: ' + e.message }
            );
          }
        }
      } else {
        this._internal.inputMapFunc = undefined;
      }

      this.scheduleRefresh();
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name === 'inputMappingScript')
        return this.registerInput(name, {
          set: this.setInputMappingScript.bind(this)
        });
    }
  }
};

// Export as ES modules
export { ForEachComponent };
export const node = ForEachDefinition;

// Setup function for dynamic port registration
function setupFunction(context, graphModel) {
  console.log('[ForEach] SETUP: Function called');

  if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
    console.log('[ForEach] SETUP: No editor connection or not running locally');
    return;
  }

  console.log('[ForEach] SETUP: Editor connection available, setting up port management');

  function _managePortsForNode(node) {
    console.log('[ForEach] SETUP: Managing ports for node:', node.id, 'template:', node.parameters.template);

    function _collectPortsInTemplateComponent() {
      var templateComponentName = node.parameters.template;
      console.log('[ForEach] SETUP: Collecting ports for template:', templateComponentName);

      if (templateComponentName === undefined) {
        console.log('[ForEach] SETUP: No template component name, returning');
        return;
      }

      var ports = [];
      var c = graphModel.components[templateComponentName];

      if (c === undefined) {
        console.log('[ForEach] SETUP: Component not found:', templateComponentName);
        return;
      }

      console.log('[ForEach] SETUP: Found component:', templateComponentName, 'with output ports:', Object.keys(c.outputPorts || {}));

      // Collect item outputs and signals
      for (var outputName in c.outputPorts) {
        var o = c.outputPorts[outputName];
        const typeName = _typeName(o.type);
        const isSignal = typeName === 'signal' ||
          ['clicked', 'Success', 'Failure', 'submit', 'cancel', 'done'].includes(outputName);

        console.log(`[ForEach] SETUP: Processing output '${outputName}' - type: '${typeName}', isSignal: ${isSignal}, originalType:`, o.type);

        if (isSignal) {
          const signalPort = {
            name: 'itemOutputSignal-' + outputName,
            displayName: outputName,
            type: 'signal',
            plug: 'output',
            group: 'Item Signals'
          };
          ports.push(signalPort);
          console.log(`[ForEach] SETUP: Added signal port:`, signalPort);
        } else {
          const regularPort = {
            name: 'itemOutput-' + outputName,
            displayName: outputName,
            type: o.type,
            plug: 'output',
            group: 'Item Outputs'
          };
          ports.push(regularPort);
          console.log(`[ForEach] SETUP: Added regular port:`, regularPort);
        }
      }

      // Collect default mappigs for template component inputs
      var defaultMappings = '';
      for (var inputName in c.inputPorts) {
        var o = c.inputPorts[inputName];
        if (_typeName(o.type) !== 'signal') {
          defaultMappings += "\t'" + inputName + "': '" + inputName + "',\n";
        }
      }

      ports.push({
        name: 'inputMappingScript',
        type: { name: 'string', codeeditor: 'javascript' },
        displayName: 'Script',
        group: 'Input Mapping',
        default: defaultMapCode.replace('{{#mappings}}', defaultMappings),
        plug: 'input'
      });

      console.log('[ForEach] SETUP: Sending dynamic ports:', ports.length, 'ports for node:', node.id);
      console.log('[ForEach] SETUP: Ports being sent:', ports);

      context.editorConnection.sendDynamicPorts(node.id, ports, {
        detectRenamed: {
          plug: 'output',
          prefix: 'itemOutput'
        }
      });

      console.log('[ForEach] SETUP: Dynamic ports sent successfully');
    }

    function _trackComponentOutputs(componentName) {
      if (componentName === undefined) return;
      var c = graphModel.components[componentName];
      if (c === undefined) return;

      c.on('outputPortAdded', _collectPortsInTemplateComponent);
      c.on('outputPortRemoved', _collectPortsInTemplateComponent);
      c.on('outputPortTypesUpdated', _collectPortsInTemplateComponent);

      c.on('inputPortTypesUpdated', _collectPortsInTemplateComponent);
      c.on('inputPortAdded', _collectPortsInTemplateComponent);
      c.on('inputPortRemoved', _collectPortsInTemplateComponent);
    }

    console.log('[ForEach] SETUP: Calling initial _collectPortsInTemplateComponent');
    _collectPortsInTemplateComponent();

    console.log('[ForEach] SETUP: Setting up component output tracking');
    _trackComponentOutputs(node.parameters.template);

    node.on('parameterUpdated', function (event) {
      console.log('[ForEach] SETUP: Parameter updated:', event.name);
      if (event.name === 'template') {
        console.log('[ForEach] SETUP: Template changed, recollecting ports');
        _collectPortsInTemplateComponent();
        _trackComponentOutputs(node.parameters.template);
      }
    });
  }

  console.log('[ForEach] SETUP: Setting up graph model listeners');

  graphModel.on('editorImportComplete', () => {
    console.log('[ForEach] SETUP: Editor import complete, setting up node listeners');

    graphModel.on('nodeAdded.For Each', function (node) {
      console.log('[ForEach] SETUP: New ForEach node added:', node.id);
      _managePortsForNode(node);
    });

    const existingNodes = graphModel.getNodesWithType('For Each');
    console.log('[ForEach] SETUP: Found', existingNodes.length, 'existing ForEach nodes');

    for (const node of existingNodes) {
      console.log('[ForEach] SETUP: Setting up existing ForEach node:', node.id);
      _managePortsForNode(node);
    }
  });

  console.log('[ForEach] SETUP: Setup function completed');
}

// Export the setup function
export const setup = setupFunction;
