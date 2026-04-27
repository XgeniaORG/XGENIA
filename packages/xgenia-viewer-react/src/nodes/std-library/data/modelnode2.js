'use strict';

const { Node } = require('@xgenia/runtime');

var Model = require('@xgenia/runtime/src/model');

var ModelNodeDefinition = {
  name: 'Model2',
  docs: 'https://docsapp.xgenia.com/nodes/data/object/object-node',
  displayNodeName: 'Object',
  shortDesc:
    'Stores any amount of properties and can be used standalone or together with Collections and For Each nodes.',
  category: 'Data',
  usePortAsLabel: 'modelId',
  color: 'data',
  dynamicports: [
    {
      name: 'conditionalports/extended',
      condition: 'idSource = explicit OR idSource NOT SET',
      inputs: ['modelId']
    }
  ],
  initialize: function () {
    var internal = this._internal;
    internal.inputValues = {};
    internal.dirtyValues = {};

    var _this = this;
    this._internal.onModelChangedCallback = function (args) {
      if (_this.isInputConnected('fetch') === true) return;

      if (_this.hasOutput('prop-' + args.name)) _this.flagOutputDirty('prop-' + args.name);

      if (_this.hasOutput('changed-' + args.name)) _this.sendSignalOnOutput('changed-' + args.name);

      _this.sendSignalOnOutput('changed');
    };
  },
  getInspectInfo() {
    const model = this._internal.model;
    if (!model) return '[No Object]';

    return [
      { type: 'text', value: 'Id: ' + model.getId() },
      { type: 'value', value: model.data }
    ];
  },
  outputs: {
    id: {
      type: 'string',
      displayName: 'Id',
      group: 'General',
      getter: function () {
        // Defensive check: ensure model exists and has getId method
        if (this._internal.model && typeof this._internal.model.getId === 'function') {
          return this._internal.model.getId();
        } else if (this._internal.modelId) {
          return this._internal.modelId;
        } else {
          console.warn('[ModelNode2] getId called but model is invalid or missing getId method:', this._internal.model);
          return undefined;
        }
      }
    },
    changed: {
      type: 'signal',
      displayName: 'Changed',
      group: 'Events'
    },
    fetched: {
      type: 'signal',
      displayName: 'Fetched',
      group: 'Events'
    }
  },
  inputs: {
    idSource: {
      type: {
        name: 'enum',
        enums: [
          { label: 'Specify explicitly', value: 'explicit' },
          { label: 'From repeater', value: 'foreach' }
        ],
        allowEditOnly: true
      },
      default: 'explicit',
      displayName: 'Get Id from',
      group: 'General',
      set: function (value) {
        if (value === 'foreach') {
          this.scheduleAfterInputsHaveUpdated(() => {
            // Find closest nodescope that have a _forEachModel
            var component = this.nodeScope.componentOwner;
            while (component !== undefined && component._forEachModel === undefined && component.parentNodeScope) {
              component = component.parentNodeScope.componentOwner;
            }
            this.setModel(component !== undefined ? component._forEachModel : undefined);
          });
        }
      }
    },
    modelId: {
      type: {
        name: 'string',
        identifierOf: 'ModelName',
        identifierDisplayName: 'Object Ids'
      },
      displayName: 'Id',
      group: 'General',
      set: function (value) {
        if (value instanceof Model) value = value.getId();
        // Can be passed as model as well
        else if (typeof value === 'object') value = Model.create(value).getId(); // If this is an js object, dereference it

        this._internal.modelId = value; // Wait to fetch data
        if (this.isInputConnected('fetch') === false) this.setModelID(value);
        else {
          this.flagOutputDirty('id');
        }
      }
    },
    properties: {
      type: { name: 'stringlist', allowEditOnly: true },
      displayName: 'Properties',
      group: 'Properties',
      set: function (value) {}
    },
    fetch: {
      displayName: 'Fetch',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleSetModel();
      }
    }
  },
  prototypeExtensions: {
    scheduleStore: function () {
      if (this.hasScheduledStore) return;
      this.hasScheduledStore = true;

      var internal = this._internal;
      this.scheduleAfterInputsHaveUpdated(() => {
        this.hasScheduledStore = false;
        if (!internal.model) return;

        for (var i in internal.dirtyValues) {
          internal.model.set(i, internal.inputValues[i], { resolve: true });
        }
        internal.dirtyValues = {}; // Reset dirty values
      });
    },
    scheduleSetModel: function () {
      if (this.hasScheduledSetModel) return;
      this.hasScheduledSetModel = true;

      var internal = this._internal;
      this.scheduleAfterInputsHaveUpdated(() => {
        this.hasScheduledSetModel = false;
        this.setModelID(this._internal.modelId);
      });
    },
    setModelID: function (id) {
      var model = (this.nodeScope.modelScope || Model).get(id);
      this.setModel(model);
      this.sendSignalOnOutput('fetched');
    },
    setModel: function (model) {
      console.log('[ModelNode2] setModel() called with:', model);
      console.log('[ModelNode2] setModel() - model type:', typeof model);
      console.log('[ModelNode2] setModel() - model constructor:', model ? model.constructor.name : 'NO_MODEL');
      console.log('[ModelNode2] setModel() - model is Model instance:', model ? Model.instanceOf(model) : false);
      console.log('[ModelNode2] setModel() - model has getId:', model && typeof model.getId === 'function');
      
      // Check if this is coming from ForEach
      if (this._forEachModel) {
        console.log('[ModelNode2] setModel() - _forEachModel exists:', this._forEachModel);
        console.log('[ModelNode2] setModel() - _forEachModel type:', typeof this._forEachModel);
        console.log('[ModelNode2] setModel() - _forEachModel constructor:', this._forEachModel ? this._forEachModel.constructor.name : 'NO_FOREACH_MODEL');
        console.log('[ModelNode2] setModel() - _forEachModel is Model instance:', this._forEachModel ? Model.instanceOf(this._forEachModel) : false);
        console.log('[ModelNode2] setModel() - _forEachModel has getId:', this._forEachModel && typeof this._forEachModel.getId === 'function');
      }
      
      if (this._internal.model === model) return;

      if (this._internal.model) {
        // Remove old listener if existing
        this._internal.model.off('change', this._internal.onModelChangedCallback);
      }

      this._internal.model = model;
      this.flagOutputDirty('id');

      // In set idSource, we are calling setModel with undefined
      if (model) {
        // Defensive check: ensure model has the required methods
        if (typeof model.on === 'function') {
          model.on('change', this._internal.onModelChangedCallback);
        } else {
          console.warn('[ModelNode2] setModel called with model missing on method:', model);
        }

        // We have a new model, mark all outputs as dirty
        if (model.data) {
          for (var key in model.data) {
            if (this.hasOutput('prop-' + key)) this.flagOutputDirty('prop-' + key);
          }
        }
      }
    },
    _onNodeDeleted: function () {
      Node.prototype._onNodeDeleted.call(this);
      // Defensive check: ensure model exists and has off method before calling it
      if (this._internal.model && typeof this._internal.model.off === 'function') {
        this._internal.model.off('change', this._internal.onModelChangedCallback);
      }
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('prop-'))
        this.registerOutput(name, {
          getter: userOutputGetter.bind(this, name.substring('prop-'.length))
        });
    },
    registerInputIfNeeded: function (name) {
      var _this = this;

      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('prop-'))
        this.registerInput(name, {
          set: userInputSetter.bind(this, name.substring('prop-'.length))
        });
    }
  }
};

function userOutputGetter(name) {
  /* jshint validthis:true */
  // Defensive check: ensure model exists and has get method
  if (this._internal.model && typeof this._internal.model.get === 'function') {
    return this._internal.model.get(name, { resolve: true });
  } else {
    return undefined;
  }
}

function userInputSetter(name) {
  /* jshint validthis:true */
  return function (value) {
    // Defensive check: ensure model exists and has set method
    if (this._internal.model && typeof this._internal.model.set === 'function') {
      this._internal.model.set(name, value, { resolve: true });
    } else {
      console.warn('[ModelNode2] userInputSetter called but model is invalid or missing set method:', this._internal.model);
    }
  };
}

module.exports = ModelNodeDefinition; 