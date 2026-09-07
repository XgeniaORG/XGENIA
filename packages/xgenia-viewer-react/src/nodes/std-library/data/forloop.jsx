import { Node } from '@xgenia/runtime';
import guid from '../../../guid';
import Collection from '@xgenia/runtime/src/collection';
import Model from '@xgenia/runtime/src/model';

import React from 'react';
import XgeniaRuntime from '@xgenia/runtime';

function ForLoopComponent(props) {
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
  "// A component in a sheet is referred to by '/#Sheet Name/Component Name'.\n" +
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

// Repeater Loop is a general-purpose repeater like For Each, with two selectable Modes:
//
// - Incremental (default): items are never torn down when new ones arrive - each
//   new item spawns exactly one new component that lives on its own until something
//   removes it individually (e.g. via For Each Actions once it's done with itself).
//   Good for things that accumulate and live independently: chat messages, spawned
//   game objects/particles, notifications, log entries, Plinko balls animating down
//   a board, etc. New arrivals that show up close together are staggered a bit so
//   they don't all pop in on the same frame; a lone arrival always spawns immediately.
// - Rebuild: the classic repeater behavior - any change to Items tears everything
//   down and recreates it from scratch, in order. Good for filtered/sorted/paginated
//   lists where the whole set conceptually replaces itself each time.
const ForLoopDefinition = {
  name: 'Repeater Loop',
  displayNodeName: 'Repeater Loop',
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
    this._internal.collection = Collection.get(); // Internal snapshot, diffed by id against the bound Items source
    this._internal.queuedOperations = [];
    this._internal.mountedOperations = [];

    this._internal.mode = 'incremental';
    this._internal.delay = 500; // Stagger delay - only applied when multiple new items are already waiting (Incremental mode)
    this._internal.startIndex = 0;
    this._internal.hasBoundOnce = false;
    this._internal.index = 0;
    this._internal.processedCount = 0;
    this._internal.pendingSpawns = [];
    this._internal.drainId = 0;
    this._internal.rebuildId = 0;
    this._internal.isRunning = false;

    // A new item appeared in the source - queue it for a (possibly staggered) spawn.
    // Existing items are never touched by this. Only relevant in Incremental mode -
    // Rebuild mode handles everything itself via _rebuildAll.
    this._internal.collection.on('add', (args) => {
      if (this._internal.mode !== 'incremental') return;
      if (!this._internal.target) return;

      this._queueOperation(() => {
        this._queueSpawn(args.item, args.index);
      });
    });

    // An item was removed from the source (e.g. it asked to be removed once it was
    // done with itself) - only that one item's component is torn down. Incremental mode only.
    this._internal.collection.on('remove', (args) => {
      if (this._internal.mode !== 'incremental') return;

      this._queueOperation(() => {
        this.removeItem(args.item);
      });
    });

    // Whenever the bound source announces a change, re-sync our internal snapshot.
    // In Incremental mode this diffs by item id, so only genuinely new/removed items
    // trigger a spawn/despawn. In Rebuild mode everything is torn down and recreated.
    this._internal.onItemsCollectionChanged = () => {
      const repeaterDisabledWhenUnmounted = XgeniaRuntime.instance.getProjectSettings().repeaterDisabledWhenUnmounted;

      if (repeaterDisabledWhenUnmounted && !this.isMounted) {
        this._internal.mountedOperations.push(() => {
          this._syncItems();
        });
      } else {
        this._queueOperation(() => {
          this._syncItems();
        });
      }
    };

    this.addDeleteListener(() => {
      this.stopLoop();
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
      }
    },
    template: {
      type: 'component',
      displayName: 'Template',
      group: 'Appearance',
      set: function (value) {
        this._internal.template = value;
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
              'forloop-syntax-warning',
              { message: '<strong>Syntax</strong>: ' + e.message }
            );
          }
        }
      }
    },
    mode: {
      group: 'Behavior',
      displayName: 'Mode',
      type: {
        name: 'enum',
        enums: [
          { label: 'Incremental (keep existing)', value: 'incremental' },
          { label: 'Rebuild (replace all)', value: 'rebuild' }
        ]
      },
      default: 'incremental',
      set: function (value) {
        this._internal.mode = value === 'rebuild' ? 'rebuild' : 'incremental';
      }
    },
    delay: {
      group: 'Loop',
      displayName: 'Stagger Delay (ms)',
      type: 'number',
      default: 500,
      set: function (value) {
        this._internal.delay = Math.max(0, Number(value) || 0);
      }
    },
    startIndex: {
      group: 'Loop',
      displayName: 'Start Index',
      type: 'number',
      default: 0,
      set: function (value) {
        this._internal.startIndex = Math.max(0, Math.floor(Number(value) || 0));
      }
    },
    run: {
      group: 'Loop',
      displayName: 'Force Re-sync',
      type: 'signal',
      valueChangedToTrue: function () {
        // Manual escape hatch. Incremental mode: re-checks Items for anything
        // not yet spawned (spawning itself is automatic, this only matters if
        // a change was ever missed, e.g. Items mutated before Target was ready).
        // Rebuild mode: forces an immediate full rebuild.
        this.scheduleAfterInputsHaveUpdated(() => {
          this.scheduleCopyItems();
        });
      }
    },
    stop: {
      group: 'Loop',
      displayName: 'Cancel Pending',
      type: 'signal',
      valueChangedToTrue: function () {
        // Cancels spawns still waiting their staggered turn - items already
        // spawned are never affected.
        this.stopLoop();
      }
    }
  },
  outputs: {
    index: {
      type: 'number',
      group: 'Loop',
      displayName: 'Index',
      getter: function () {
        return this._internal.index;
      }
    },
    isRunning: {
      type: 'boolean',
      group: 'Loop',
      displayName: 'Is Running',
      getter: function () {
        return this._internal.isRunning;
      }
    },
    processedCount: {
      type: 'number',
      group: 'Loop',
      displayName: 'Used Count',
      getter: function () {
        return this._internal.processedCount;
      }
    },
    queuedCount: {
      type: 'number',
      group: 'Loop',
      displayName: 'Queued Spawns',
      getter: function () {
        return this._internal.pendingSpawns.length;
      }
    },
    iteration: {
      type: 'signal',
      group: 'Loop',
      displayName: 'Item Spawned'
    },
    done: {
      type: 'signal',
      group: 'Loop',
      displayName: 'Done'
    },
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
    unbindCurrentCollection: function () {
      var collection = this._internal.items;
      if (!collection) return;

      Collection.instanceOf(collection) && collection.off('change', this._internal.onItemsCollectionChanged);
      this._internal.items = undefined;
    },
    bindCollection: function (collection) {
      var internal = this._internal;

      this.unbindCurrentCollection();

      Collection.instanceOf(collection) && collection.on('change', internal.onItemsCollectionChanged);

      internal.items = collection;

      if (internal.mode === 'incremental' && !internal.hasBoundOnce) {
        // Only on the very first bind: items sitting below Start Index are
        // treated as already-handled history and never spawn a component.
        // Every later arrival always spawns, regardless of Start Index.
        // (Rebuild mode applies Start Index fresh on every rebuild instead.)
        internal.hasBoundOnce = true;
        this._seedHistoricalItems(collection);
      }

      this.scheduleCopyItems();
    },
    _seedHistoricalItems: function (source) {
      var internal = this._internal;
      var startIndex = internal.startIndex || 0;
      if (!source || !startIndex) return;

      var length = typeof source.size === 'function' ? source.size() : source.length;
      var count = Math.min(startIndex, length || 0);

      for (var i = 0; i < count; i++) {
        var raw = source[i];
        var model = Model.instanceOf(raw) ? raw : Model.create(raw);
        // Raw push bypasses add()/notify - these are marked as already known
        // so the diff in scheduleCopyItems never spawns them.
        internal.collection.push(model);
      }
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
            'forloop-dynamic-warning',
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
    _setIsRunning: function (value) {
      if (this._internal.isRunning === value) return;
      this._internal.isRunning = value;
      this.flagOutputDirty('isRunning');
    },
    _syncItems: function () {
      var internal = this._internal;

      // Always keep the internal snapshot correct - diffed by item id. In
      // Incremental mode this alone fires the 'add'/'remove' listeners above.
      internal.collection.set(internal.items);

      if (internal.mode === 'rebuild') {
        this._rebuildAll();
      }
    },
    _rebuildAll: async function () {
      var internal = this._internal;

      if (!(internal.template || internal.templateFunction)) return;
      if (!internal.target) return;

      const rebuildId = ++internal.rebuildId;
      this._setIsRunning(true);

      this._deleteAllItemNodes();

      const baseIndex = internal.target.getChildren().indexOf(this) + 1;
      const size = internal.collection.size();
      const start = Math.min(internal.startIndex || 0, size);
      internal.index = start;

      for (var i = start; i < size; i++) {
        if (rebuildId !== internal.rebuildId || this._deleted) return;

        var model = internal.collection.get(i);
        internal.index = i;
        this.flagOutputDirty('index');

        await this.addItem(model, baseIndex + i);

        if (rebuildId !== internal.rebuildId || this._deleted) return;

        internal.processedCount++;
        this.flagOutputDirty('processedCount');
        this.sendSignalOnOutput('iteration');
      }

      if (rebuildId === internal.rebuildId) {
        this._setIsRunning(false);
        this.sendSignalOnOutput('done');
      }
    },
    _queueSpawn: function (model, index) {
      this._internal.pendingSpawns.push({ model: model, index: index });
      this.flagOutputDirty('queuedCount');
      if (!this._internal.isRunning) this._drainSpawnQueue();
    },
    _drainSpawnQueue: async function () {
      var internal = this._internal;

      const drainId = ++internal.drainId;
      this._setIsRunning(true);

      while (internal.pendingSpawns.length > 0 && drainId === internal.drainId && !this._deleted) {
        const next = internal.pendingSpawns.shift();
        this.flagOutputDirty('queuedCount');

        if (internal.target) {
          internal.index = next.index;
          this.flagOutputDirty('index');

          const baseIndex = internal.target.getChildren().indexOf(this) + 1;
          await this.addItem(next.model, baseIndex + next.index);

          internal.processedCount++;
          this.flagOutputDirty('processedCount');
          this.sendSignalOnOutput('iteration');
        }

        // Only stagger if something else is already waiting - a lone arrival is instant
        if (internal.pendingSpawns.length > 0 && internal.delay > 0 && drainId === internal.drainId) {
          await new Promise((resolve) => {
            internal.loopResolve = resolve;
            internal.loopTimer = setTimeout(resolve, internal.delay);
          });
          internal.loopTimer = undefined;
          internal.loopResolve = undefined;
        }
      }

      if (drainId === internal.drainId) {
        this._setIsRunning(false);
        this.sendSignalOnOutput('done');
      }
    },
    stopLoop: function () {
      var internal = this._internal;

      // Cancel spawns still waiting their turn - items already spawned keep running
      internal.pendingSpawns = [];
      this.flagOutputDirty('queuedCount');
      internal.drainId++;
      internal.rebuildId++; // also cancels an in-progress rebuild, if any

      if (internal.loopTimer) {
        clearTimeout(internal.loopTimer);
        internal.loopTimer = undefined;
      }

      // Release a drain waiting on its stagger delay so it can exit cleanly
      if (internal.loopResolve) {
        const resolve = internal.loopResolve;
        internal.loopResolve = undefined;
        resolve();
      }

      this._setIsRunning(false);
    },
    addItem: async function (model, index) {
      var internal = this._internal;

      // Defensive check: ensure model is valid and has required methods
      if (!model || typeof model.getId !== 'function' || typeof model.on !== 'function') {
        console.error('[ForLoop] addItem called with invalid model:', model);
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
        console.error('[ForLoop] addItem - failed to create itemNode for template:', template, 'Error:', error);
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
          if ((oldValue === false || oldValue === undefined) && value === true && internal.itemOutputSignals[name]) {
            this.itemOutputSignalTriggered(name, model, itemNode);
          }
        }
      };

      // Discover and register all outputs from the child component at runtime
      const nodeTypeName = itemNode.nodeTypeName || itemNode.name;

      let nodeMetadata = null;
      try {
        nodeMetadata = this.nodeScope.context.nodeRegister.getNodeMetadata(nodeTypeName);
      } catch (e) {
        // No metadata available for this node type
      }

      for (let outputName in itemNode._outputs) {
        const output = itemNode._outputs[outputName];
        if (output) {
          // Try to determine if this is a signal from multiple sources
          let isSignal = false;

          const outputMetadata = nodeMetadata?.outputs?.[outputName];
          if (outputMetadata?.type === 'signal') {
            isSignal = true;
          }

          if (!isSignal && itemNode.componentModel) {
            const componentOutputPorts = itemNode.componentModel.getOutputPorts();
            const componentOutputPort = componentOutputPorts[outputName];
            if (componentOutputPort?.type === 'signal') {
              isSignal = true;
            }
          }

          if (!isSignal && ['clicked', 'Success', 'Failure', 'submit', 'cancel', 'done'].includes(outputName)) {
            isSignal = true;
          }

          // Register both signal and regular outputs dynamically
          this.registerOutputIfNeeded('itemOutputSignal-' + outputName);
          this.registerOutputIfNeeded('itemOutput-' + outputName);
          this._internal.itemOutputSignals[outputName] = true;

          // Hook into the output's sendValue method to intercept value changes
          const originalSendValue = output.sendValue.bind(output);

          try {
            Object.defineProperty(output, 'sendValue', {
              value: (value) => {
                originalSendValue(value);

                if (isSignal) {
                  if (value === true) {
                    this.itemOutputSignalTriggered(outputName, model, itemNode);
                  }
                } else {
                  this._internal.itemOutputs[outputName] = value;
                  this.flagOutputDirty('itemOutput-' + outputName);
                }
              },
              writable: true,
              configurable: true
            });
          } catch (e) {
            // sendValue could not be wrapped, rely on creatorCallbacks only
          }
        }
      }

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
      return <ForLoopComponent key={this.id} didMount={() => this.didMount()} willUnmount={() => this.willUnmount()} />;
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
            this._syncItems();
          });
        } else {
          this._syncItems();
        }
      });
    },
    itemOutputSignalTriggered: function (name, model, itemNode) {
      // Defensive check: ensure model is valid and has getId method
      if (!model || typeof model.getId !== 'function') {
        console.error('[ForLoop] itemOutputSignalTriggered called with invalid model:', model);
        return;
      }

      this._internal.itemActionItemId = model.getId();
      this._internal.itemActionSignal = name;
      this.flagOutputDirty('itemActionItemId');

      // Send signal and update item outputs after they have been correctly updated
      if (!this._internal.hasScheduledTriggerItemOutputSignal) {
        this._internal.hasScheduledTriggerItemOutputSignal = true;

        this.context.scheduleAfterUpdate(() => {
          this._internal.hasScheduledTriggerItemOutputSignal = false;

          for (var key in itemNode._outputs) {
            var _output = 'itemOutput-' + key;
            if (this.hasOutput(_output)) {
              this._internal.itemOutputs[key] = itemNode._outputs[key].value;
              this.flagOutputDirty(_output);
            }
          }

          this.sendSignalOnOutput('itemOutputSignal-' + this._internal.itemActionSignal);
        });
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
          'forloop-inputmapping-warning'
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
              'forloop-inputmapping-warning',
              { message: '<strong>Input mapping</strong>: ' + e.message }
            );
          }
        }
      } else {
        this._internal.inputMapFunc = undefined;
      }
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
export { ForLoopComponent };
export const node = ForLoopDefinition;

// Setup function for dynamic port registration
function setupFunction(context, graphModel) {
  if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
    return;
  }

  function _managePortsForNode(node) {
    function _collectPortsInTemplateComponent() {
      var templateComponentName = node.parameters.template;
      if (templateComponentName === undefined) return;

      var ports = [];
      var c = graphModel.components[templateComponentName];
      if (c === undefined) return;

      // Collect item outputs and signals
      for (var outputName in c.outputPorts) {
        var o = c.outputPorts[outputName];
        const typeName = _typeName(o.type);
        const isSignal =
          typeName === 'signal' || ['clicked', 'Success', 'Failure', 'submit', 'cancel', 'done'].includes(outputName);

        if (isSignal) {
          ports.push({
            name: 'itemOutputSignal-' + outputName,
            displayName: outputName,
            type: 'signal',
            plug: 'output',
            group: 'Item Signals'
          });
        } else {
          ports.push({
            name: 'itemOutput-' + outputName,
            displayName: outputName,
            type: o.type,
            plug: 'output',
            group: 'Item Outputs'
          });
        }
      }

      // Collect default mappings for template component inputs
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

      context.editorConnection.sendDynamicPorts(node.id, ports, {
        detectRenamed: {
          plug: 'output',
          prefix: 'itemOutput'
        }
      });
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

    _collectPortsInTemplateComponent();
    _trackComponentOutputs(node.parameters.template);

    node.on('parameterUpdated', function (event) {
      if (event.name === 'template') {
        _collectPortsInTemplateComponent();
        _trackComponentOutputs(node.parameters.template);
      }
    });
  }

  graphModel.on('editorImportComplete', () => {
    graphModel.on('nodeAdded.Repeater Loop', function (node) {
      _managePortsForNode(node);
    });

    const existingNodes = graphModel.getNodesWithType('Repeater Loop');
    for (const node of existingNodes) {
      _managePortsForNode(node);
    }
  });
}

// Export the setup function
export const setup = setupFunction;
