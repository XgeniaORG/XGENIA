'use strict';

const Model = require('../../../model');
const CloudStore = require('../../../api/cloudstore');

function _addBaseInfo(def, opts) {
  const _includeInputProperties = opts === undefined || opts.includeInputProperties;
  const _includeRelations = opts !== undefined && opts.includeRelations;

  Object.assign(def.node, {
    category: 'Data',
    color: 'data',
    inputs: def.node.inputs || {},
    outputs: def.node.outputs || {},
    methods: def.node.methods || {}
  });

  // Outputs
  Object.assign(def.node.outputs, {
    failure: {
      type: 'signal',
      displayName: 'Failure',
      group: 'Events'
    },
    error: {
      type: 'string',
      displayName: 'Error',
      group: 'Error',
      getter: function () {
        return this._internal.error;
      }
    }
  });

  // Methods
  Object.assign(def.node.methods, {
    scheduleOnce: function (type, cb) {
      const _this = this;
      const _type = 'hasScheduled' + type;
      if (this._internal[_type]) return;
      this._internal[_type] = true;
      this.scheduleAfterInputsHaveUpdated(function () {
        _this._internal[_type] = false;
        cb();
      });
    },
    checkWarningsBeforeCloudOp() {
      //clear all errors first
      this.clearWarnings();

      if (!this._internal.collectionId) {
        this.setError('No class name specified');
        return false;
      }

      return true;
    },
    setError: function (err) {
      this._internal.error = err;
      this.flagOutputDirty('error');
      this.sendSignalOnOutput('failure');

      if (this.context.editorConnection) {
        this.context.editorConnection.sendWarning(this.nodeScope.componentOwner.name, this.id, 'storage-op-warning', {
          message: err,
          showGlobally: true
        });
      }
    },
    clearWarnings() {
      if (this.context.editorConnection) {
        this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'storage-op-warning');
      }
    },
    // NEW: Clear schema cache to prevent field interference between tables
    _clearSchemaCache: function () {
      console.log(`[DbModelCRUDBase] Clearing schema cache for node ${this.id}`);

      // Clear any cached schema-related data
      if (this._internal.lastCollectionSchema) {
        console.log(
          `[DbModelCRUDBase] Clearing schema cache for collection: ${this._internal.lastCollectionSchema.collectionName}`
        );
        delete this._internal.lastCollectionSchema;
      }

      // ENHANCED: More aggressive clearing of input values
      if (this._internal.inputValues) {
        const clearedFields = Object.keys(this._internal.inputValues);
        console.log(`[DbModelCRUDBase] Clearing ${clearedFields.length} input values: ${clearedFields.join(', ')}`);

        // Clear ALL input values to prevent cross-table interference
        this._internal.inputValues = {};

        // Also clear any registered inputs to force re-registration
        clearedFields.forEach((fieldName) => {
          const inputName = `prop-${fieldName}`;
          if (this.hasInput(inputName)) {
            console.log(`[DbModelCRUDBase] Unregistering input: ${inputName}`);
            try {
              this.unregisterInput(inputName);
            } catch (e) {
              console.warn(`[DbModelCRUDBase] Could not unregister input ${inputName}:`, e.message);
            }
          }
        });
      }

      // Clear last selected collection tracking
      if (this._internal.lastSelectedCollection) {
        delete this._internal.lastSelectedCollection;
      }

      // ENHANCED: Clear any validation errors and warnings related to field validation
      if (this.context.editorConnection) {
        this.context.editorConnection.clearWarning(
          this.nodeScope.componentOwner.name,
          this.id,
          'field-validation-warning'
        );
        this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'storage-op-warning');
      }

      // Force refresh of dynamic ports
      if (this.context.editorConnection && this.nodeScope.graphModel) {
        setTimeout(() => {
          this.nodeScope.graphModel.emit('forceNodePortsUpdate', { nodeId: this.id });
        }, 10);
      }
    },

    // NEW: Emergency method to clear all problematic cached data
    _emergencyClearAllData: function () {
      console.log(`[DbModelCRUDBase] EMERGENCY CLEAR: Clearing ALL cached data for node ${this.id}`);

      // Clear everything
      if (this._internal) {
        const beforeKeys = Object.keys(this._internal);
        console.log(`[DbModelCRUDBase] Before clear - internal keys:`, beforeKeys);

        // Keep only essential properties, clear everything else
        const essential = {
          collectionId: this._internal.collectionId
        };

        // Clear all non-essential internal data
        Object.keys(this._internal).forEach((key) => {
          if (!['collectionId'].includes(key)) {
            delete this._internal[key];
          }
        });

        // Reset to clean state
        this._internal.inputValues = {};
        this._internal.lastCollectionSchema = null;
        this._internal.lastSelectedCollection = null;

        console.log(`[DbModelCRUDBase] After clear - internal keys:`, Object.keys(this._internal));
      }

      // Clear all warnings
      if (this.context.editorConnection) {
        this.context.editorConnection.clearWarning(
          this.nodeScope.componentOwner.name,
          this.id,
          'field-validation-warning'
        );
        this.context.editorConnection.clearWarning(this.nodeScope.componentOwner.name, this.id, 'storage-op-warning');
      }
    }
  });

  // Setup
  Object.assign(def, {
    setup: function (context, graphModel) {
      if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
        return;
      }

      function _managePortsForNode(node) {
        function _updatePorts() {
          // Add debouncing to prevent rapid successive calls that cause blinking
          if (node._portUpdateTimeout) {
            clearTimeout(node._portUpdateTimeout);
          }

          node._portUpdateTimeout = setTimeout(() => {
            _doUpdatePorts();
            delete node._portUpdateTimeout;
          }, 50); // 50ms debounce
        }

        function _doUpdatePorts() {
          var ports = [];

          const dbCollections = graphModel.getMetaData('dbCollections');
          const systemCollections = graphModel.getMetaData('systemCollections');

          const _systemClasses = [
            { label: 'User', value: '_User' },
            { label: 'Role', value: '_Role' }
          ];

          const parameters = node.parameters;

          ports.push({
            name: 'collectionName',
            displayName: 'Class',
            group: 'General',
            type: {
              name: 'enum',
              enums: _systemClasses.concat(
                dbCollections !== undefined
                  ? dbCollections.map((c) => {
                      return { value: c.name, label: c.name };
                    })
                  : []
              ),
              allowEditOnly: true
            },
            plug: 'input',
            // ENHANCED: Automatically clear cache when collection changes
            set: function (value) {
              console.log(`[DbModelCRUDBase] Collection setter called: ${this._internal.collectionId} -> ${value}`);

              const previousCollection = this._internal.collectionId;
              this._internal.collectionId = value;

              console.log(`[DbModelCRUDBase] Collection set to: ${value}`);
              console.log(`[DbModelCRUDBase] Current inputValues before cache clear:`, this._internal.inputValues);

              // Clear cache if collection actually changed
              if (previousCollection !== value && this._clearSchemaCache) {
                console.log(
                  `[DbModelCRUDBase] Collection changed from '${previousCollection}' to '${value}', clearing schema cache`
                );
                this._clearSchemaCache();
              }

              console.log(
                `[DbModelCRUDBase] Collection setter complete. inputValues after:`,
                this._internal.inputValues
              );
            }
          });

          if (_includeRelations && parameters.collectionName && dbCollections) {
            // Fetch ports from collection keys
            var c = dbCollections.find((c) => c.name === parameters.collectionName);
            if (c === undefined && systemCollections)
              c = systemCollections.find((c) => c.name === parameters.collectionName);
            if (c && c.schema && c.schema.properties) {
              const props = c.schema.properties;
              const enums = Object.keys(props)
                .filter((key) => props[key].type === 'Relation')
                .map((key) => ({ label: key, value: key }));

              ports.push({
                name: 'relationProperty',
                displayName: 'Relation',
                group: 'General',
                type: { name: 'enum', enums: enums, allowEditOnly: true },
                plug: 'input'
              });
            }
          }

          if (_includeInputProperties && parameters.collectionName && dbCollections) {
            const _typeMap = {
              String: 'string',
              Boolean: 'boolean',
              Number: 'number',
              Date: 'date',
              Object: 'object'
            };

            // ENHANCED: Check if collection changed to clear cache
            if (node._internal) {
              const lastCollection = node._internal.lastSelectedCollection;
              const currentCollection = parameters.collectionName;

              if (lastCollection && lastCollection !== currentCollection) {
                console.log(
                  `[DbModelCRUDBase] Collection changed from '${lastCollection}' to '${currentCollection}', clearing cache`
                );
                if (node._clearSchemaCache) {
                  node._clearSchemaCache();
                }
              }

              node._internal.lastSelectedCollection = currentCollection;
            }

            // Fetch ports from collection keys
            var c = dbCollections.find((c) => c.name === parameters.collectionName);
            if (c === undefined && systemCollections)
              c = systemCollections.find((c) => c.name === parameters.collectionName);
            if (c && c.schema && c.schema.properties) {
              var props = c.schema.properties;
              console.log(
                `[DbModelCRUDBase] Generating input properties for collection '${parameters.collectionName}':`,
                props
              );

              // ENHANCED: Store schema for cache validation
              if (node._internal) {
                node._internal.lastCollectionSchema = {
                  collectionName: parameters.collectionName,
                  properties: Object.keys(props)
                };
              }

              for (var key in props) {
                var p = props[key];
                if (ports.find((_p) => _p.name === key)) continue;

                // Skip system fields that shouldn't be editable in create operations
                if (['id', 'objectId', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(key)) {
                  continue;
                }

                const inputType = _typeMap[p.type] ? _typeMap[p.type] : '*';
                console.log(`[DbModelCRUDBase] Adding input property: ${key} (${p.type} -> ${inputType})`);

                ports.push({
                  type: {
                    name: inputType
                  },
                  plug: 'input',
                  group: 'Properties',
                  name: 'prop-' + key,
                  displayName: key
                });
              }

              console.log(
                `[DbModelCRUDBase] Generated ${Object.keys(props).length} input properties for ${
                  parameters.collectionName
                }`
              );
            } else if (parameters.collectionName) {
              console.warn(
                `[DbModelCRUDBase] No schema found for collection '${parameters.collectionName}'. Available collections:`,
                dbCollections?.map((c) => c.name) || []
              );

              if (context && context.editorConnection && typeof CloudStore !== 'undefined') {
                console.log(
                  `[DbModelCRUDBase] Attempting to trigger Supabase table discovery for missing collection: ${parameters.collectionName}`
                );

                setTimeout(async () => {
                  try {
                    let cloudStore = null;

                    if (CloudStore.instance) {
                      cloudStore = CloudStore.instance;
                    } else if (typeof xgeniaRuntime !== 'undefined' && xgeniaRuntime.instance) {
                      cloudStore = xgeniaRuntime.instance.cloudStore;
                    }

                    if (cloudStore && cloudStore.supabaseClient) {
                      console.log(`[DbModelCRUDBase] Triggering manual table discovery...`);
                      const result = await cloudStore.forceTableDiscovery();

                      if (result.success) {
                        console.log(`[DbModelCRUDBase] Discovery successful, refreshing ports...`);
                        if (graphModel && graphModel.emit) {
                          graphModel.emit('metadataChanged.dbCollections', graphModel.getMetaData('dbCollections'));
                        }
                      }
                    }
                  } catch (discoveryError) {
                    console.warn(`[DbModelCRUDBase] Table discovery failed:`, discoveryError);
                  }
                }, 100);
              }
            }
          }

          def._additionalDynamicPorts && def._additionalDynamicPorts(node, ports, graphModel);

          context.editorConnection.sendDynamicPorts(node.id, ports);
        }

        _updatePorts();

        // Cleanup timeout when node is destroyed to prevent memory leaks
        if (node.on && typeof node.on === 'function') {
          node.on('destroy', function () {
            if (node._portUpdateTimeout) {
              clearTimeout(node._portUpdateTimeout);
              delete node._portUpdateTimeout;
            }
          });
        }

        node.on('parameterUpdated', function (event) {
          if (event.name === 'collectionName') {
            // Fix: Use nodeScope instead of graphModel to get node instance
            const nodeInstance = node.nodeScope ? node.nodeScope.getNodeWithId(node.id) : node;
            if (nodeInstance && nodeInstance._clearSchemaCache) {
              nodeInstance._clearSchemaCache();
            }
          }
          _updatePorts();
        });

        graphModel.on('metadataChanged.dbCollections', function (data) {
          CloudStore.invalidateCollections();
          _updatePorts();
        });

        graphModel.on('metadataChanged.systemCollections', function (data) {
          CloudStore.invalidateCollections();
          _updatePorts();
        });

        graphModel.on('forceNodePortsUpdate', function (data) {
          if (!data.nodeId || data.nodeId === node.id) {
            console.log(`[DbModelCRUDBase] Force updating ports for node ${node.id}`);
            _updatePorts();
          }
        });
      }

      graphModel.on('editorImportComplete', () => {
        graphModel.on('nodeAdded.' + def.node.name, function (node) {
          _managePortsForNode(node);
        });

        for (const node of graphModel.getNodesWithType(def.node.name)) {
          _managePortsForNode(node);
        }
      });
    }
  });
}

function _addModelId(def, opts) {
  var _def = { node: Object.assign({}, def.node), setup: def.setup };
  var _methods = Object.assign({}, def.node.methods);

  const _includeInputs = opts === undefined || opts.includeInputs;
  const _includeOutputs = opts === undefined || opts.includeOutputs;

  Object.assign(def.node, {
    inputs: def.node.inputs || {},
    outputs: def.node.outputs || {},
    methods: def.node.methods || {}
  });

  if (_includeInputs) {
    Object.assign(def.node, {
      usePortAsLabel: 'collectionName'
    });

    def.node.dynamicports = (def.node.dynamicports || []).concat([
      {
        name: 'conditionalports/extended',
        condition: 'idSource = explicit OR idSource NOT SET',
        inputs: ['modelId']
      }
    ]);

    // Inputs
    Object.assign(def.node.inputs, {
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
        displayName: 'Id Source',
        group: 'General',
        tooltip:
          'Choose if you want to specify the Id explicitly, \n or if you want it to be that of the current record in a repeater.',
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
          if (value instanceof Model) value = value.getId(); // Can be passed as model as well
          this._internal.modelId = value; // Wait to fetch data
          this.setModelID(value);
        }
      }
    });
  }

  // Outputs
  if (_includeOutputs) {
    Object.assign(def.node.outputs, {
      id: {
        type: 'string',
        displayName: 'Id',
        group: 'General',
        getter: function () {
          return this._internal.model ? this._internal.model.getId() : this._internal.modelId;
        }
      }
    });
  }

  // Methods
  Object.assign(def.node.methods, {
    setCollectionID: function (id) {
      // ENHANCED: Clear schema cache when collection changes to prevent field interference
      const previousCollectionId = this._internal.collectionId;
      if (previousCollectionId && previousCollectionId !== id) {
        console.log(
          `[DbModelCRUDBase] Collection changing from '${previousCollectionId}' to '${id}', clearing schema cache`
        );
        if (this._clearSchemaCache) {
          this._clearSchemaCache();
        }
      }

      this._internal.collectionId = id;
      this.clearWarnings();
    },
    setModelID: function (id) {
      var model = (this.nodeScope.modelScope || Model).get(id);
      this.setModel(model);
    },
    setModel: function (model) {
      this._internal.model = model;
      this.flagOutputDirty('id');
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name === 'collectionName')
        this.registerInput(name, {
          set: this.setCollectionID.bind(this)
        });

      _methods && _methods.registerInputIfNeeded && _methods.registerInputIfNeeded.call(this, name);
    }
  });
}

function _addInputProperties(def) {
  var _def = { node: Object.assign({}, def.node), setup: def.setup };
  var _methods = Object.assign({}, def.node.methods);

  Object.assign(def.node, {
    inputs: def.node.inputs || {},
    outputs: def.node.outputs || {},
    methods: def.node.methods || {}
  });

  Object.assign(def.node, {
    initialize: function () {
      var internal = this._internal;
      internal.inputValues = {};

      _def.node.initialize && _def.node.initialize.call(this);
    }
  });

  // Outputs
  Object.assign(def.node.outputs, {});

  // Inputs
  Object.assign(def.node.inputs, {});

  // Methods
  Object.assign(def.node.methods, {
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('prop-'))
        this.registerInput(name, {
          set: this._setInputValue.bind(this, name.substring('prop-'.length))
        });

      _methods && _methods.registerInputIfNeeded && _methods.registerInputIfNeeded.call(this, name);
    },
    _setInputValue: function (name, value) {
      console.log(`[DbModelCRUDBase] _setInputValue called: ${name} = ${value}`);
      console.log(`[DbModelCRUDBase] Current collection: ${this._internal.collectionId}`);
      console.log(`[DbModelCRUDBase] Last schema:`, this._internal.lastCollectionSchema);

      // ENHANCED: Validate field exists in current schema to prevent interference
      // But be more lenient for legitimate use cases
      if (this._internal.lastCollectionSchema && this._internal.collectionId) {
        const { collectionName, properties } = this._internal.lastCollectionSchema;

        // Only reject if we're sure this is from a different table
        if (collectionName !== this._internal.collectionId) {
          console.warn(
            `[DbModelCRUDBase] Schema mismatch: cached schema is for '${collectionName}' but current collection is '${this._internal.collectionId}'. Refreshing schema...`
          );
          // Clear outdated schema and allow the value
          delete this._internal.lastCollectionSchema;
        } else if (!properties.includes(name)) {
          console.warn(
            `[DbModelCRUDBase] Warning: Field '${name}' not found in schema for '${collectionName}'. Schema properties:`,
            properties
          );
          console.warn(
            `[DbModelCRUDBase] This might be a legitimate field that wasn't included in the schema discovery. Allowing value to be set.`
          );
          // Don't reject - let it through in case schema is incomplete
        }
      }

      // Always set the value - let the backend handle final validation
      this._internal.inputValues[name] = value;
      console.log(
        `[DbModelCRUDBase] Successfully set field value: ${name} = ${value} for collection ${this._internal.collectionId}`
      );
      console.log(`[DbModelCRUDBase] Current inputValues:`, this._internal.inputValues);
    }
  });
}

function _addRelationProperty(def) {
  var _def = { node: Object.assign({}, def.node), setup: def.setup };
  var _methods = Object.assign({}, def.node.methods);

  Object.assign(def.node, {
    inputs: def.node.inputs || {},
    outputs: def.node.outputs || {},
    methods: def.node.methods || {}
  });

  // Inputs
  Object.assign(def.node.inputs, {
    targetId: {
      type: { name: 'string', allowConnectionsOnly: true },
      displayName: 'Target Record Id',
      group: 'General',
      set: function (value) {
        this._internal.targetModelId = value;
      }
    }
  });

  // Methods
  Object.assign(def.node.methods, {
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name === 'relationProperty')
        this.registerInput(name, {
          set: this.setRelationProperty.bind(this)
        });

      _methods && _methods.registerInputIfNeeded && _methods.registerInputIfNeeded.call(this, name);
    },
    setRelationProperty: function (value) {
      this._internal.relationProperty = value;
    }
  });
}

function _getCurrentUser(modelScope) {
  if (typeof _xgenia_cloud_runtime_version === 'undefined') {
    // We are running in browser, try to find the current user

    var _cu = localStorage['Parse/' + CloudStore.instance.appId + '/currentUser'];
    if (_cu !== undefined) {
      let cu;
      try {
        cu = JSON.parse(_cu);
      } catch (e) {}

      return cu !== undefined ? cu.objectId : undefined;
    }
  } else {
    // Assume we are running in cloud runtime
    const request = modelScope.get('Request');
    return request.UserId;
  }
}

function _addAccessControl(def) {
  var _def = { node: Object.assign({}, def.node), setup: def.setup };
  var _methods = Object.assign({}, def.node.methods);

  Object.assign(def.node, {
    inputs: def.node.inputs || {},
    outputs: def.node.outputs || {},
    methods: def.node.methods || {}
  });

  Object.assign(def.node, {
    initialize: function () {
      var internal = this._internal;
      internal.accessControl = {};

      _def.node.initialize && _def.node.initialize.call(this);
    }
  });

  // Inputs
  Object.assign(def.node.inputs, {
    accessControl: {
      type: { name: 'proplist', autoName: 'Rule', allowEditOnly: true },
      index: 1000,
      displayName: 'Access Control Rules',
      group: 'Access Control Rules',
      set: function (value) {
        this._internal.accessControlRules = value;
      }
    }
  });

  // Dynamic ports
  const _super = def._additionalDynamicPorts;
  def._additionalDynamicPorts = function (node, ports, graphModel) {
    if (node.parameters['accessControl'] !== undefined && node.parameters['accessControl'].length > 0) {
      node.parameters['accessControl'].forEach((ac) => {
        const prefix = 'acl-' + ac.id;
        // User or role?
        ports.push({
          name: prefix + '-target',
          displayName: 'Target',
          editorName: ac.label + ' | Target',
          plug: 'input',
          type: {
            name: 'enum',
            enums: [
              { value: 'user', label: 'User' },
              { value: 'everyone', label: 'Everyone' },
              { value: 'role', label: 'Role' }
            ],
            allowEditOnly: true
          },
          group: ac.label + ' Access Rule',
          default: 'user',
          parent: 'accessControl',
          parentItemId: ac.id
        });

        if (node.parameters[prefix + '-target'] === 'role') {
          ports.push({
            name: prefix + '-role',
            displayName: 'Role',
            editorName: ac.label + ' | Role',
            group: ac.label + ' Access Rule',
            plug: 'input',
            type: 'string',
            parent: 'accessControl',
            parentItemId: ac.id
          });
        } else if (
          node.parameters[prefix + '-target'] === undefined ||
          node.parameters[prefix + '-target'] === 'user'
        ) {
          ports.push({
            name: prefix + '-userid',
            displayName: 'User Id',
            group: ac.label + ' Access Rule',
            editorName: ac.label + ' | User Id',
            plug: 'input',
            type: { name: 'string', allowConnectionsOnly: true },
            parent: 'accessControl',
            parentItemId: ac.id
          });
        }

        // Read
        ports.push({
          name: prefix + '-read',
          displayName: 'Read',
          editorName: ac.label + ' | Read',
          group: ac.label + ' Access Rule',
          plug: 'input',
          type: { name: 'boolean' },
          default: true,
          parent: 'accessControl',
          parentItemId: ac.id
        });

        // Write
        ports.push({
          name: prefix + '-write',
          displayName: 'Write',
          editorName: ac.label + ' | Write',
          group: ac.label + ' Access Rule',
          plug: 'input',
          type: { name: 'boolean' },
          default: true,
          parent: 'accessControl',
          parentItemId: ac.id
        });
      });
    }

    _super && _super(node, ports, graphModel);
  };

  // Methods
  Object.assign(def.node.methods, {
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('acl-'))
        this.registerInput(name, {
          set: this.setAccessControl.bind(this, name)
        });

      _methods && _methods.registerInputIfNeeded && _methods.registerInputIfNeeded.call(this, name);
    },
    _getACL: function () {
      let acl = {};

      function _rule(rule) {
        return {
          read: rule.read === undefined ? true : rule.read,
          write: rule.write === undefined ? true : rule.write
        };
      }

      const currentUserId = _getCurrentUser(this.nodeScope.modelScope);

      if (this._internal.accessControlRules !== undefined) {
        this._internal.accessControlRules.forEach((r) => {
          const rule = this._internal.accessControl[r.id];

          if (rule === undefined) {
            const userId = currentUserId;
            if (userId !== undefined) acl[userId] = { write: true, read: true };
          } else if (rule.target === 'everyone') {
            acl['*'] = _rule(rule);
          } else if (rule.target === 'user') {
            const userId = rule.userid || currentUserId;
            acl[userId] = _rule(rule);
          } else if (rule.target === 'role') {
            acl['role:' + rule.role] = _rule(rule);
          }
        });
      }

      return Object.keys(acl).length > 0 ? acl : undefined;
    },
    setAccessControl: function (name, value) {
      const _parts = name.split('-');

      if (this._internal.accessControl[_parts[1]] === undefined) this._internal.accessControl[_parts[1]] = {};
      this._internal.accessControl[_parts[1]][_parts[2]] = value;
    }
  });
}

module.exports = {
  addInputProperties: _addInputProperties,
  addModelId: _addModelId,
  addBaseInfo: _addBaseInfo,
  addRelationProperty: _addRelationProperty,
  addAccessControl: _addAccessControl
};
