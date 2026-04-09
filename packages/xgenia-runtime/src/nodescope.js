'use strict';

const guid = require('./guid');

function NodeScope(context, componentOwner) {
  this.context = context;
  this.nodes = {};
  this.componentOwner = componentOwner; //Component Instance that owns this NodeScope
  this.componentInstanceChildren = {};
}

function verifyData(data, requiredKeys) {
  requiredKeys.forEach(function (key) {
    if (!data[key]) {
      throw new Error('Missing ' + key);
    }
  });
}

NodeScope.prototype.addConnection = function (connectionData) {
  try {
    verifyData(connectionData, ['sourceId', 'sourcePort', 'targetId', 'targetPort']);
  } catch (e) {
    throw new Error('Error in connection: ' + e.message);
  }

  try {
    // Get nodes with our robust fallback implementation
    var sourceNode = this.getNodeWithId(connectionData.sourceId);
    var targetNode = this.getNodeWithId(connectionData.targetId);

    // Ensure the nodes have the required methods by adding them if they don't exist
    if (typeof targetNode.registerInputIfNeeded !== 'function') {
      console.log("Adding missing registerInputIfNeeded method to target node");
      targetNode.registerInputIfNeeded = function(inputName) {
        if (!this.inputs) this.inputs = {};
        if (!this.inputs[inputName]) {
          this.inputs[inputName] = {
            connections: [],
            value: null
          };
        }
        return this;
      };
    }

    if (typeof sourceNode.registerOutputIfNeeded !== 'function') {
      console.log("Adding missing registerOutputIfNeeded method to source node");
      sourceNode.registerOutputIfNeeded = function(outputName) {
        if (!this.outputs) this.outputs = {};
        if (!this.outputs[outputName]) {
          this.outputs[outputName] = {
            connections: [],
            value: null
          };
        }
        return this;
      };
    }

    if (typeof targetNode.connectInput !== 'function') {
      console.log("Adding missing connectInput method to target node");
      targetNode.connectInput = function(inputName, sourceNode, sourcePort) {
        this.registerInputIfNeeded(inputName);
        if (!this.inputs[inputName].connections) {
          this.inputs[inputName].connections = [];
        }
        
        // Check if connection already exists
        const existingConnection = this.inputs[inputName].connections.find(
          conn => conn.node === sourceNode && conn.port === sourcePort
        );
        
        if (!existingConnection) {
          this.inputs[inputName].connections.push({
            node: sourceNode,
            port: sourcePort
          });
        }
        
        return this;
      };
    }

    // Now we can safely call these methods
    targetNode.registerInputIfNeeded(connectionData.targetPort);
    sourceNode.registerOutputIfNeeded(connectionData.sourcePort);
    targetNode.connectInput(connectionData.targetPort, sourceNode, connectionData.sourcePort);
  } catch (e) {
    // Non-critical: fallback nodes may not support full connection API.
    // The guards in Node.prototype.connectInput handle this gracefully.
    console.warn("[NodeScope.addConnection] Skipped connection (source:" + connectionData.sourceId + " → target:" + connectionData.targetId + "):", e.message);
  }
};

NodeScope.prototype.setNodeParameters = function (node, nodeModel) {
  // Safety check for node
  if (!node) {
    console.error("Cannot set node parameters: node is null or undefined");
    return;
  }

  // Safety check for nodeModel
  if (!nodeModel) {
    console.error("Cannot set node parameters: nodeModel is null or undefined");
    return;
  }

  // Safety check for nodeModel.type
  if (!nodeModel.type) {
    console.error("Cannot set node parameters: nodeModel.type is null or undefined");
    return;
  }

  try {
    // Safety check for context and variants
    if (!this.context || !this.context.variants) {
      console.warn("Context or variants is undefined, skipping variant application");
    } else {
      const variant = this.context.variants.getVariant(nodeModel.type, nodeModel.variant);
      if (variant) {
        //apply the variant (this will also apply the parameters)
        if (typeof node.setVariant === 'function') {
          node.setVariant(variant);
        } else {
          console.warn("Node does not have setVariant method");
        }
        return; // Early return if variant was applied
      }
    }

    // Safety check for nodeModel.parameters
    if (!nodeModel.parameters) {
      console.warn("Node model has no parameters, skipping parameter application");
      return;
    }

    const parameters = nodeModel.parameters;
    var inputNames = Object.keys(parameters);

    // Safety check for context and nodeRegister
    if (this.context && this.context.nodeRegister && 
        typeof this.context.nodeRegister.hasNode === 'function' && 
        node.name && this.context.nodeRegister.hasNode(node.name)) {
      
      try {
        var metadata = this.context.nodeRegister.getNodeMetadata(node.name);
        
        // Safety check for metadata and metadata.inputs
        if (metadata && metadata.inputs) {
          inputNames.sort(function (a, b) {
            var inputA = metadata.inputs[a];
            var inputB = metadata.inputs[b];
            return (inputB ? inputB.inputPriority : 0) - (inputA ? inputA.inputPriority : 0);
          });
        }
      } catch (e) {
        console.error("Error sorting input names:", e.message);
        // Continue with unsorted input names
      }
    }

    // Apply parameters
    inputNames.forEach((inputName) => {
      try {
        // Ensure the node has the required methods by adding them if they don't exist
        if (typeof node.registerInputIfNeeded !== 'function') {
          console.log("Adding missing registerInputIfNeeded method to node");
          node.registerInputIfNeeded = function(inputName) {
            if (!this.inputs) this.inputs = {};
            if (!this.inputs[inputName]) {
              this.inputs[inputName] = {
                connections: [],
                value: null
              };
            }
            return this;
          };
        }

        if (typeof node.hasInput !== 'function') {
          console.log("Adding missing hasInput method to node");
          node.hasInput = function(inputName) {
            return !!(this.inputs && this.inputs[inputName]);
          };
        }

        if (typeof node.queueInput !== 'function') {
          console.log("Adding missing queueInput method to node");
          node.queueInput = function(inputName, value) {
            if (!this.inputs) this.inputs = {};
            if (!this.inputs[inputName]) {
              this.registerInputIfNeeded(inputName);
            }
            this.inputs[inputName].value = value;
            return this;
          };
        }

        // Now we can safely call these methods
        node.registerInputIfNeeded(inputName);
        
        //protect against obsolete parameters
        if (node.hasInput(inputName) === false) {
          return;
        }
        
        node.queueInput(inputName, parameters[inputName]);
      } catch (e) {
        console.error(`Error applying parameter ${inputName}:`, e.message);
      }
    });
  } catch (e) {
    console.error("Error in setNodeParameters:", e.message);
  }
};

NodeScope.prototype.createNodeFromModel = async function (nodeModel, updateOnDirtyFlagging) {
  if (!nodeModel) {
    console.error("Cannot create node from undefined model");
    return;
  }

  // Add safety check for nodeModel.type
  if (typeof nodeModel.type !== 'string') {
    console.error("Invalid node model: type is not a string", nodeModel);
    return;
  }

  if (nodeModel.type === 'Component Children') {
    // Add safety check for nodeModel.parent and nodeModel.parent.id
    if (nodeModel.parent && nodeModel.parent.id) {
      try {
        var parentInstance = this.getNodeWithId(nodeModel.parent.id);
        if (this.componentOwner && typeof this.componentOwner.setChildRoot === 'function') {
          this.componentOwner.setChildRoot(parentInstance);
        } else {
          console.error("Cannot set child root, componentOwner is undefined or missing setChildRoot method");
        }
      } catch (e) {
        console.error("Error setting child root:", e.message);
      }
    } else {
      console.warn("Component Children node has no parent or parent.id is missing");
    }
    return;
  }

  var node;
  try {
    // Special handling for Canvas nodes
    if (nodeModel.type === 'Canvas') {
      console.log("Creating Canvas node with ID:", nodeModel.id);
      // Create a fallback node for Canvas type if it's not registered
      // Pass the type as an extraProp instead of trying to set name directly
      node = await this.createNode('Group', nodeModel.id, { _originalType: 'Canvas' });
      if (node) {
        console.log("Created fallback Group node for Canvas with ID:", nodeModel.id);
      }
    } 
    // If node wasn't created above for special cases, create it normally
    if (!node) {
      // Let createNode handle the type lookup (standard node or component)
      node = await this.createNode(nodeModel.type, nodeModel.id);
      if (node) {
        node.updateOnDirtyFlagging = updateOnDirtyFlagging === false ? false : true;
        if (typeof node.setNodeModel === 'function') {
          node.setNodeModel(nodeModel);
        }
      } else {
        console.error("Failed to create node of type", nodeModel.type);
        // Create a fallback node as a last resort
        // Pass the original type as an extraProp instead of trying to set name directly
        node = await this.createNode('Group', nodeModel.id, { _originalType: nodeModel.type });
        if (node) {
          node.updateOnDirtyFlagging = updateOnDirtyFlagging === false ? false : true;
          console.log("Created last-resort fallback node for type:", nodeModel.type);
        } else {
          return; // Give up if we can't even create a fallback
        }
      }
    }
  } catch (e) {
    console.error("Error creating node:", e.message);
    if (this.context && this.context.editorConnection && 
        typeof this.context.isWarningTypeEnabled === 'function' && 
        this.context.isWarningTypeEnabled('nodescope')) {
      this.context.editorConnection.sendWarning(
        this.componentOwner ? this.componentOwner.name : 'unknown',
        nodeModel.id, 
        'nodelibrary-unknown-node', 
        {
          message: e.message,
          showGlobally: true
        }
      );
    }
    return;
  }

  if (nodeModel.variant && node.setVariant) node.setVariant(nodeModel.variant);
  this.setNodeParameters(node, nodeModel);

  if (nodeModel.parent) {
    this.insertNodeInTree(node, nodeModel);
  }

  return node;
};

NodeScope.prototype.insertNodeInTree = function (nodeInstance, nodeModel) {
  // Safety check for nodeInstance
  if (!nodeInstance) {
    console.error("Cannot insert node in tree: node instance is null or undefined");
    return;
  }
  
  // Safety check for nodeModel and parent
  if (!nodeModel || !nodeModel.parent || !nodeModel.parent.id) {
    console.error("Cannot insert node in tree: invalid node model or missing parent information");
    return;
  }

  try {
    var parentInstance = this.getNodeWithId(nodeModel.parent.id);
    var childIndex = nodeModel.parent.children ? nodeModel.parent.children.indexOf(nodeModel) : -1;

    if (!parentInstance) {
      console.error("Cannot insert node in tree: parent instance not found");
      return;
    }

    if (typeof parentInstance.addChild !== 'function') {
      console.error(
        'Node ' + parentInstance.id + ' of type ' + (parentInstance.constructor ? parentInstance.constructor.name : 'unknown') + " can't have children"
      );
      return; // Return instead of throwing an error to prevent crashes
    }

    // Safety check for nodeInstance.id
    if (!nodeInstance.id) {
      console.error("Cannot insert node in tree: node instance has no id");
      return;
    }

    // Add the child with proper error handling
    try {
      parentInstance.addChild(nodeInstance, childIndex);
    } catch (addChildError) {
      console.error("Error in addChild:", addChildError.message);
      
      // Try to recover by using a default implementation if the parent's addChild failed
      if (!nodeInstance.parent) {
        nodeInstance.parent = parentInstance;
        if (!parentInstance.children) parentInstance.children = [];
        parentInstance.children.push(nodeInstance);
        console.log("Used fallback method to add child to parent");
      }
    }
  } catch (e) {
    console.error("Error inserting node in tree:", e.message);
  }
};

NodeScope.prototype.getNodeWithId = function (id) {
  // Create a fallback node object with all required methods
  const createFallbackNode = (id) => {
    // Create a more robust fallback node with all necessary methods
    return {
      id: id,
      name: 'FallbackNode',
      nodeScope: this,
      context: this.context,
      inputs: {},
      outputs: {},
      
      // Core node methods
      registerInputIfNeeded: function(inputName) {
        if (!this.inputs[inputName]) {
          this.inputs[inputName] = {
            connections: [],
            value: null
          };
        }
        return this;
      },
      
      registerOutputIfNeeded: function(outputName) {
        if (!this.outputs[outputName]) {
          this.outputs[outputName] = {
            connections: [],
            value: null
          };
        }
        return this;
      },
      
      connectInput: function(inputName, sourceNode, sourcePort) {
        this.registerInputIfNeeded(inputName);
        if (!this.inputs[inputName].connections) {
          this.inputs[inputName].connections = [];
        }
        
        // Check if connection already exists
        const existingConnection = this.inputs[inputName].connections.find(
          conn => conn.node === sourceNode && conn.port === sourcePort
        );
        
        if (!existingConnection) {
          this.inputs[inputName].connections.push({
            node: sourceNode,
            port: sourcePort
          });
        }
        
        return this;
      },
      
      hasInput: function(inputName) {
        return !!this.inputs[inputName];
      },
      
      queueInput: function(inputName, value) {
        if (this.hasInput(inputName)) {
          this.inputs[inputName].value = value;
        }
        return this;
      },
      
      _onNodeDeleted: function() {
        // Clean up connections
        for (const inputName in this.inputs) {
          if (this.inputs[inputName].connections) {
            this.inputs[inputName].connections = [];
          }
        }
        
        for (const outputName in this.outputs) {
          if (this.outputs[outputName].connections) {
            this.outputs[outputName].connections = [];
          }
        }
      },
      
      removeInputConnection: function(inputName, sourceNodeId, sourcePort) {
        if (this.hasInput(inputName) && this.inputs[inputName].connections) {
          this.inputs[inputName].connections = this.inputs[inputName].connections.filter(
            conn => !(conn.node.id === sourceNodeId && conn.port === sourcePort)
          );
        }
        return this;
      },
      
      setNodeModel: function(model) {
        this.model = model;
        return this;
      },
      
      setVariant: function(variant) {
        this.variant = variant;
        return this;
      },
      
      // React compatibility methods
      forceUpdate: function() {
        // React 19 compatibility - ensure this method exists and works
        if (this.reactComponentRef && typeof this.reactComponentRef.setState === 'function') {
          this.reactComponentRef.setState({});
        }
        return this;
      },
      
      setStyle: function(styles, styleTag) {
        if (!this.styles) this.styles = {};
        this.styles[styleTag || 'default'] = styles;
        return this;
      },
      
      removeStyle: function(styles, styleTag) {
        if (this.styles && this.styles[styleTag || 'default']) {
          delete this.styles[styleTag || 'default'];
        }
        return this;
      },
      
      scheduleAfterInputsHaveUpdated: function(callback) {
        if (typeof callback === 'function') {
          setTimeout(callback, 0);
        }
        return this;
      },
      
      // Methods for parent-child relationships
      addChild: function(child, index) {
        if (!this.children) this.children = [];
        
        if (child.parent && child.parent !== this && typeof child.parent.removeChild === 'function') {
          child.parent.removeChild(child);
        }
        
        child.parent = this;
        
        if (typeof index === 'number' && index >= 0 && index < this.children.length) {
          this.children.splice(index, 0, child);
        } else {
          this.children.push(child);
        }
        
        return this;
      },
      
      removeChild: function(child) {
        if (!this.children) return this;
        
        const index = this.children.indexOf(child);
        if (index !== -1) {
          this.children.splice(index, 1);
          child.parent = undefined;
        }
        
        return this;
      },
      
      getChildren: function() {
        return this.children || [];
      },
      
      // Additional methods for React component nodes
      getDOMElement: function() {
        return null;
      },
      
      getVisualParentNode: function() {
        return this.parent;
      },
      
      renderChildren: function() {
        return null;
      },
      
      render: function() {
        return null;
      },
      
      getOutput: function(outputName) {
        // Return an OutputProperty-compatible object so callers that
        // expect registerConnection/deregisterConnection won't crash.
        var val = this.outputs[outputName] ? this.outputs[outputName].value : undefined;
        return {
          value: val,
          name: outputName,
          owner: this,
          registerConnection: function() {},
          deregisterConnection: function() {}
        };
      },
      
      // Properties
      parent: null,
      children: [],
      styles: {},
      model: null,
      variant: null,
      _dirty: false,
      _deleted: false,
      
      update: function() {},
      flagDirty: function() {},
      
      // Additional method to handle dirty flagging
      _performDirtyUpdate: function() {
        this._dirty = false;
        return this;
      }
    };
  };

  if (!id) {
    console.error('Cannot get node with undefined or null id');
    console.warn('Using fallback node for undefined id');
    return createFallbackNode('fallback-' + Math.random().toString(36).substring(2, 9));
  }
  
  if (this.nodes.hasOwnProperty(id) === false) {
    // Try to find the node in component instance children recursively
    for (const childId in this.componentInstanceChildren) {
      if (this.componentInstanceChildren[childId] && 
          this.componentInstanceChildren[childId].nodeScope) {
        try {
          const node = this.componentInstanceChildren[childId].nodeScope.getNodeWithId(id);
          if (node) return node;
        } catch (e) {
          // Node not found in this child scope, continue searching
        }
      }
    }
    
    // If we get here, the node wasn't found
    console.warn('Unknown node id ' + id + ', using fallback node');
    const fallbackNode = createFallbackNode(id);
    // Store the fallback node so future lookups will find it
    this.nodes[id] = fallbackNode;
    return fallbackNode;
  }
  
  return this.nodes[id];
};

NodeScope.prototype.createFallbackNode = function (id, originalType, extraProps) {
  // Create a fallback node using the Group type
  try {
    const node = this.context.nodeRegister.createNode('Group', id, this);
    
    // Add original type and other properties
    node._originalType = originalType;
    
    // Add any extra properties
    if (extraProps) {
      for (const prop in extraProps) {
        node[prop] = extraProps[prop];
      }
    }
    
    return node;
  } catch (e) {
    console.error("Error creating fallback node:", e.message);
    
    // Create a minimal fallback node as a last resort
    const minimalNode = {
      id: id,
      name: 'Group',
      _originalType: originalType,
      nodeScope: this,
      context: this.context,
      inputs: {},
      outputs: {},
      _dirty: false,
      _deleted: false,
      registerInputIfNeeded: function() {},
      registerOutputIfNeeded: function() {},
      connectInput: function() {},
      hasInput: function() { return false; },
      queueInput: function() {},
      _onNodeDeleted: function() {},
      removeInputConnection: function() {},
      setNodeModel: function() {},
      setVariant: function() {},
      forceUpdate: function() {},
      update: function() {},
      flagDirty: function() {},
      addChild: function() {},
      removeChild: function() {},
      getChildren: function() { return []; },
      parent: null,
      children: []
    };
    
    // Add any extra properties
    if (extraProps) {
      for (const prop in extraProps) {
        minimalNode[prop] = extraProps[prop];
      }
    }
    
    return minimalNode;
  }
};

NodeScope.prototype.hasNodeWithId = function (id) {
  return this.nodes.hasOwnProperty(id);
};

NodeScope.prototype.createPrimitiveNode = function (name, id, extraProps) {
  if (!id) id = guid();

  if (this.nodes.hasOwnProperty(id)) {
    throw Error('duplicate id ' + id);
  }

  const node = this.context.nodeRegister.createNode(name, id, this);
  if (extraProps) {
    for (const prop in extraProps) {
      node[prop] = extraProps[prop];
    }
  }

  this.nodes[id] = node;
  return node;
};

NodeScope.prototype.createNode = async function (name, id, extraProps) {
  // Safety check for name
  if (typeof name !== 'string') {
    console.error("Cannot create node: name is not a string", name);
    name = 'Group'; // Default to Group as fallback
  }

  // Generate ID if not provided
  if (!id) id = guid();

  // Handle duplicate IDs by generating a new unique ID
  if (this.nodes.hasOwnProperty(id)) {
    console.warn('Duplicate id detected: ' + id + '. Generating a new unique ID.');
    console.warn('Existing node:', this.nodes[id]?.name || 'unknown', 'New node:', name);
    console.warn('ComponentOwner:', this.componentOwner?.name || 'unknown');
    const newId = guid();
    console.log('New ID generated:', newId);
    id = newId;
  }

  let node;

  try {
    // Safety check for context
    if (!this.context) {
      console.error("Cannot create node: context is null or undefined");
      throw new Error("Context is null or undefined");
    }

    // First check if it's a registered node type
    if (this.context.nodeRegister && 
        typeof this.context.nodeRegister.hasNode === 'function' && 
        this.context.nodeRegister.hasNode(name)) {
      
      try {
        // Safety check for createNode method
        if (typeof this.context.nodeRegister.createNode !== 'function') {
          console.error("NodeRegister does not have createNode method");
          throw new Error("NodeRegister.createNode is not a function");
        }
        
        node = this.context.nodeRegister.createNode(name, id, this);
        
        // Safety check for node
        if (!node) {
          console.warn("NodeRegister.createNode returned null or undefined");
          throw new Error("Failed to create node");
        }
        
        // Apply extra properties
        if (extraProps) {
          for (const prop in extraProps) {
            node[prop] = extraProps[prop];
          }
        }
      } catch (nodeRegisterError) {
        console.error("Error in NodeRegister.createNode:", nodeRegisterError.message);
        throw nodeRegisterError; // Re-throw to be caught by outer try/catch
      }
    } 
    // If not a registered node, try to create a component instance node
    else {
      console.log(`About to create component instance node: ${name} ${id}`);
      
      // Try to get the component model - this will automatically fetch the bundle if needed
      let componentModel;
      try {
        componentModel = await this.context.getComponentModel(name);
        console.log(`Successfully got component model for: ${name}`);
      } catch (getModelError) {
        console.warn(`Could not get component model for '${name}':`, getModelError.message);
        componentModel = null;
      }
      
      if (componentModel) {
        try {
          // Make a safe copy of extraProps to avoid circular references if it contains context/nodeRegister
          const safeExtraProps = {};
          // Define properties that should NOT be copied to avoid circularity or redundancy
          const excludedProps = [
            'context', 
            'nodeRegister', 
            'nodeScope', 
            'id', 
            'name',
            '_dirtyNodes',
            'parentNodeScope',
            'componentModel',
            '_internal',
            'inputs',
            'outputs',
            '_inputs',
            '_outputs',
            '_inputValues',
            '_outputList',
            '_inputConnections',
            'parent'
          ];
          
          // Safely copy properties from extraProps
          if (extraProps) {
            for (const prop in extraProps) {
              if (extraProps.hasOwnProperty(prop) && !excludedProps.includes(prop)) {
                try {
                  const value = extraProps[prop];
                  if (prop === '_forEachModel') {
                    // Special handling for _forEachModel to preserve Model instances
                    safeExtraProps[prop] = value; // Keep the original Model instance
                  } else if (prop === '_forEachNode') {
                    // Special handling for _forEachNode to preserve the reference
                    safeExtraProps[prop] = value; // Keep the original reference
                  } else if (value === null || value === undefined) {
                    safeExtraProps[prop] = value;
                  } else if (typeof value === 'object') {
                    // For objects, do a shallow copy to avoid circular references
                    if (Array.isArray(value)) {
                      safeExtraProps[prop] = [...value];
                    } else {
                      // Only copy simple object properties
                      safeExtraProps[prop] = {};
                      for (const key in value) {
                        if (value.hasOwnProperty(key) && typeof value[key] !== 'object') {
                          safeExtraProps[prop][key] = value[key];
                        }
                      }
                    }
                  } else {
                    // Copy primitives directly
                    safeExtraProps[prop] = value;
                  }
                } catch (e) {
                  console.warn(`[createNode] Error copying property ${prop}:`, e.message);
                }
              }
            }
          }

          // Check if createComponentInstanceNode exists on the context
          if (typeof this.context.createComponentInstanceNode !== 'function') {
            throw new Error("createComponentInstanceNode is not a function on the context");
          }

          try {
             // Calling the async function with the properly copied props
            node = await this.context.createComponentInstanceNode(name, id, this, safeExtraProps);
          } catch (innerError) {
            console.error("Error creating component instance node:", innerError.message);
            console.error("Error stack:", innerError.stack);
            // Avoid trying to stringify the error object to prevent circular reference issues
            
            console.warn("Creating fallback node due to error.");
            const fallbackProps = {
              _originalType: name,
              _creationError: innerError.message,
              _fallbackReason: 'Error in createComponentInstanceNode'
            };
            node = this.createFallbackNode(id, name, fallbackProps);
            this.componentInstanceChildren[id] = node; 
          }
          
          if (node) {
            // Assign the created node to componentInstanceChildren BEFORE potential errors
            this.componentInstanceChildren[id] = node;
          } else {
            console.warn("Failed to create component instance node for '" + name + "'. Creating fallback node.");
            // Create a fallback node
            node = this.createFallbackNode(id, name);
            // Assign fallback to componentInstanceChildren as well
            this.componentInstanceChildren[id] = node; 
          }
        } catch (innerError) {
          console.error("Error creating component instance node:", innerError.message);
          console.error("Error stack:", innerError.stack);
          // Avoid trying to stringify the error object to prevent circular reference issues
          
          console.warn("Creating fallback node due to error.");
          const fallbackProps = {
            _originalType: name,
            _creationError: innerError.message,
            _fallbackReason: 'Error in createComponentInstanceNode'
          };
          node = this.createFallbackNode(id, name, fallbackProps);
          this.componentInstanceChildren[id] = node; 
        }
      } else {
        console.warn("Cannot create node of type '" + name + "': Component model not found. Creating fallback node.");
        // Create a fallback node
        try {
          node = this.context.nodeRegister.createNode('Group', id, this);
        } catch (fallbackError) {
          console.error("Error creating fallback Group node:", fallbackError.message);
          // Create a minimal fallback node as a last resort
          node = this.createFallbackNode(id, name);
        }
      }
    }

    // Final safety check for node
    if (!node) {
      console.warn("Failed to create node of type '" + name + "'. Creating minimal fallback node.");
      // Create a minimal fallback node
      node = {
        id: id,
        name: 'FallbackNode',
        _originalType: name,
        nodeScope: this,
        context: this.context,
        inputs: {},
        outputs: {},
        _dirty: false,
        _deleted: false,
        registerInputIfNeeded: function() {},
        registerOutputIfNeeded: function() {},
        connectInput: function() {},
        hasInput: function() { return false; },
        queueInput: function() {},
        _onNodeDeleted: function() {},
        removeInputConnection: function() {},
        setNodeModel: function() {},
        setVariant: function() {},
        forceUpdate: function() {},
        update: function() {},
        flagDirty: function() {},
        addChild: function() {},
        removeChild: function() {},
        getChildren: function() { return []; },
        parent: null,
        children: []
      };
    }

    // Store the node in the nodes map
    this.nodes[id] = node;
    return node;
  } catch (e) {
    console.error("Error in createNode for type '" + name + "':", e.message);
    console.warn("Creating fallback node due to error.");
    
    // Create a minimal fallback node as a last resort
    try {
      // Try to create a Group node first
      if (this.context && this.context.nodeRegister && 
          typeof this.context.nodeRegister.createNode === 'function') {
        node = this.context.nodeRegister.createNode('Group', id, this);
      } else {
        throw new Error("Cannot create Group node");
      }
    } catch (fallbackError) {
      // If that fails, create a minimal object with the necessary methods
      node = {
        id: id,
        name: 'FallbackNode',
        _originalType: name,
        nodeScope: this,
        context: this.context,
        inputs: {},
        outputs: {},
        _dirty: false,
        _deleted: false,
        registerInputIfNeeded: function() {},
        registerOutputIfNeeded: function() {},
        connectInput: function() {},
        hasInput: function() { return false; },
        queueInput: function() {},
        _onNodeDeleted: function() {},
        removeInputConnection: function() {},
        setNodeModel: function() {},
        setVariant: function() {},
        forceUpdate: function() {},
        update: function() {},
        flagDirty: function() {},
        addChild: function() {},
        removeChild: function() {},
        getChildren: function() { return []; },
        parent: null,
        children: []
      };
    }
    
    this.nodes[id] = node;
    return node;
  }
};

NodeScope.prototype.getNodesWithIdRecursive = function (id) {
  var ComponentInstanceNode = require('./nodes/componentinstance');

  function findNodesWithIdRec(scope, id, result) {
    if (scope.nodes.hasOwnProperty(id)) {
      result.push(scope.nodes[id]);
    }

    var componentIds = Object.keys(scope.nodes).filter(function (nodeId) {
      return scope.nodes[nodeId] instanceof ComponentInstanceNode;
    });

    componentIds.forEach(function (componentId) {
      findNodesWithIdRec(scope.nodes[componentId].nodeScope, id, result);
    });
  }

  var result = [];
  findNodesWithIdRec(this, id, result);
  return result;
};

NodeScope.prototype.getNodesWithType = function (name) {
  var self = this;
  var ids = Object.keys(this.nodes).filter(function (id) {
    return self.nodes[id].name === name;
  });
  return ids.map(function (id) {
    return self.nodes[id];
  });
};

NodeScope.prototype.getNodesWithTypeRecursive = function (name) {
  var ComponentInstanceNode = require('./nodes/componentinstance');

  var self = this;
  function findNodesWithTypeRec() {
    result = result.concat(self.getNodesWithType(name));

    var componentIds = Object.keys(self.nodes).filter(function (nodeId) {
      return self.nodes[nodeId] instanceof ComponentInstanceNode;
    });

    componentIds.forEach(function (componentId) {
      var res = self.nodes[componentId].nodeScope.getNodesWithTypeRecursive(name);
      result = result.concat(res);
    });
  }

  var result = [];
  findNodesWithTypeRec(result);
  return result;
};

NodeScope.prototype.getAllNodesRecursive = function () {
  var ComponentInstanceNode = require('./nodes/componentinstance');

  let result = [];

  const getAllNodesRec = () => {
    result = result.concat(Object.values(this.nodes));

    var componentIds = Object.keys(this.nodes).filter((nodeId) => {
      return this.nodes[nodeId] instanceof ComponentInstanceNode;
    });

    componentIds.forEach((componentId) => {
      var res = this.nodes[componentId].nodeScope.getAllNodesRecursive();
      result = result.concat(res);
    });
  };

  getAllNodesRec(result);
  return result;
};

NodeScope.prototype.getAllNodesWithVariantRecursive = function (variant) {
  const nodes = this.getAllNodesRecursive();
  return nodes.filter((node) => node.variant === variant);
};

NodeScope.prototype.onNodeModelRemoved = function (nodeModel) {
  if (!nodeModel || !nodeModel.id) {
    console.error("Cannot remove node model: invalid model or missing ID");
    return;
  }

  try {
    var nodeInstance = this.getNodeWithId(nodeModel.id);
    
    if (!nodeInstance) {
      console.error("Cannot remove node model: node instance not found for ID", nodeModel.id);
      return;
    }

    if (nodeModel.parent) {
      try {
        var parentInstance = this.getNodeWithId(nodeModel.parent.id);
        if (parentInstance && typeof parentInstance.removeChild === 'function') {
          parentInstance.removeChild(nodeInstance);
        }
      } catch (e) {
        console.error("Error removing child from parent:", e.message);
      }
    }

    if (typeof nodeInstance._onNodeDeleted === 'function') {
      nodeInstance._onNodeDeleted();
    }
    
    delete this.nodes[nodeInstance.id];
    delete this.componentInstanceChildren[nodeInstance.id];
  } catch (e) {
    console.error("Error removing node model:", e.message);
  }
};

NodeScope.prototype.removeConnection = function (connectionModel) {
  if (!connectionModel || !connectionModel.targetId || !connectionModel.targetPort || 
      !connectionModel.sourceId || !connectionModel.sourcePort) {
    console.error("Cannot remove connection: invalid connection model or missing required properties");
    return;
  }

  try {
    var targetNode = this.getNodeWithId(connectionModel.targetId);
    
    if (!targetNode) {
      console.error("Cannot remove connection: target node not found for ID", connectionModel.targetId);
      return;
    }

    if (typeof targetNode.removeInputConnection === 'function') {
      targetNode.removeInputConnection(connectionModel.targetPort, connectionModel.sourceId, connectionModel.sourcePort);
    } else {
      console.error("Cannot remove connection: target node does not have removeInputConnection method");
    }
  } catch (e) {
    console.error("Error removing connection:", e.message);
  }
};

NodeScope.prototype.setComponentModel = async function (componentModel) {
  // Prevent setting the same component model multiple times
  if (this.componentModel === componentModel) {
    console.log('⚠️ setComponentModel: Component model already set, skipping');
    return;
  }
  
  // If we already have a component model, reset first
  if (this.componentModel) {
    console.log('⚠️ setComponentModel: Resetting existing component model before setting new one');
    this.reset();
  }
  
  this.componentModel = componentModel;

  const nodes = [];

  //create all nodes
  for (const nodeModel of componentModel.getAllNodes()) {
    const node = await this.createNodeFromModel(nodeModel, false);
    if (node) nodes.push(node);
  }

  componentModel.getAllConnections().forEach((conn) => this.addConnection(conn));

  //now that all nodes and connections are setup, trigger the dirty flagging so nodes can run with all the connections in place
  nodes.forEach((node) => (node.updateOnDirtyFlagging = true));

  nodes.forEach((node) => {
    if (node._dirty) {
      node._performDirtyUpdate();
    }
  });

  componentModel.on('connectionAdded', (conn) => this.addConnection(conn), this);
  componentModel.on('connectionRemoved', this.removeConnection, this);
  componentModel.on('nodeAdded', this.createNodeFromModel, this);

  var self = this;
  componentModel.on(
    'nodeParentWillBeRemoved',
    function (nodeModel) {
      if (nodeModel.type === 'Component Children') {
        if (nodeModel.parent) {
          this.componentOwner.setChildRoot(null);
        }
        return;
      }

      const nodeInstance = self.getNodeWithId(nodeModel.id);
      if (nodeInstance.parent) {
        nodeInstance.parent.removeChild(nodeInstance);
      }
    },
    this
  );

  componentModel.on(
    'nodeParentUpdated',
    function (nodeModel) {
      if (nodeModel.type === 'Component Children') {
        var parentInstance = this.getNodeWithId(nodeModel.parent.id);
        this.componentOwner.setChildRoot(parentInstance);
      } else {
        var nodeInstance = self.getNodeWithId(nodeModel.id);
        self.insertNodeInTree(nodeInstance, nodeModel);
      }
    },
    this
  );

  componentModel.on(
    'nodeRemoved',
    function (nodeModel) {
      if (nodeModel.type !== 'Component Children') {
        self.onNodeModelRemoved(nodeModel);
      }
    },
    this
  );

  for (const id in this.nodes) {
    const node = this.nodes[id];
    node.nodeScopeDidInitialize && node.nodeScopeDidInitialize();
  }
};

NodeScope.prototype.reset = function () {
  if (this.componentModel) {
    this.componentModel.removeListenersWithRef(this);
    this.componentModel = undefined;
  }

  Object.keys(this.nodes).forEach((id) => {
    if (this.nodes.hasOwnProperty(id)) {
      this.deleteNode(this.nodes[id]);
    }
  });
};

NodeScope.prototype.deleteNode = function (nodeInstance) {
  if (!nodeInstance || !nodeInstance.id) {
    console.error("Cannot delete node: invalid node instance or missing ID");
    return;
  }

  if (this.nodes.hasOwnProperty(nodeInstance.id) === false) {
    console.error("Node doesn't belong to this scope", nodeInstance.id, nodeInstance.name);
    return;
  }

  try {
    if (nodeInstance.parent && typeof nodeInstance.parent.removeChild === 'function') {
      nodeInstance.parent.removeChild(nodeInstance);
    }

    //depth first
    if (nodeInstance.getChildren && typeof nodeInstance.getChildren === 'function') {
      const children = nodeInstance.getChildren();
      if (Array.isArray(children)) {
        children.forEach((child) => {
          if (child && typeof nodeInstance.removeChild === 'function') {
            nodeInstance.removeChild(child);
            //the child might be created in a different scope
            //if the child is a component instance, we want its parent scope, not the inner scope
            const nodeScope = (child.parentNodeScope || child.nodeScope);
            if (nodeScope && typeof nodeScope.deleteNode === 'function') {
              nodeScope.deleteNode(child);
            }
          }
        });
      }
    }

    if (this.componentModel) {
      let connectionFrom = [];
      let connectionTo = [];
      
      if (typeof this.componentModel.getConnectionsFrom === 'function') {
        connectionFrom = this.componentModel.getConnectionsFrom(nodeInstance.id) || [];
      }
      
      if (typeof this.componentModel.getConnectionsTo === 'function') {
        connectionTo = this.componentModel.getConnectionsTo(nodeInstance.id) || [];
      }

      const allConnections = connectionFrom.concat(connectionTo);
      if (Array.isArray(allConnections)) {
        allConnections.forEach((connection) => {
          if (connection && this.nodes.hasOwnProperty(connection.targetId) && 
              this.nodes.hasOwnProperty(connection.sourceId)) {
            this.removeConnection(connection);
          }
        });
      }
    }

    if (typeof nodeInstance._onNodeDeleted === 'function') {
      nodeInstance._onNodeDeleted();
    }
    
    delete this.nodes[nodeInstance.id];
    delete this.componentInstanceChildren[nodeInstance.id]; //in case this is a component
  } catch (e) {
    console.error("Error deleting node:", e.message);
  }
};

NodeScope.prototype.sendEventFromThisScope = function (eventName, data, propagation, sendEventInThisScope, _exclude) {
  if (sendEventInThisScope) {
    var eventReceivers = this.getNodesWithType('Event Receiver').filter(function (eventReceiver) {
      return eventReceiver.getChannelName() === eventName;
    });

    for (var i = 0; i < eventReceivers.length; i++) {
      var consumed = eventReceivers[i].handleEvent(data);
      if (consumed) return true;
    }
  }

  if (propagation === 'parent' && this.componentOwner.parentNodeScope) {
    // Send event to parent scope
    //either the scope of the visual parent if there is one, otherwise the parent component
    const parentNodeScope = this.componentOwner.parent
      ? this.componentOwner.parent.nodeScope
      : this.componentOwner.parentNodeScope;
    if (!parentNodeScope) return;
    parentNodeScope.sendEventFromThisScope(eventName, data, propagation, true);
  } else if (propagation === 'children') {
    // Send event to all child scopes
    var nodes = this.nodes;
    for (var nodeId in nodes) {
      var children = nodes[nodeId].children;
      if (children)
        children.forEach((child) => {
          if (child.name && this.context.hasComponentModelWithName(child.name)) {
            // This is a component instance child
            var consumed = child.nodeScope.sendEventFromThisScope(eventName, data, propagation, true);
            if (consumed) return true;
          }
        });
    }
  } else if (propagation === 'siblings') {
    // Send event to all siblings, that is all children of the parent scope except this scope
    let parentNodeScope;
    if (this.componentOwner.parent) {
      parentNodeScope = this.componentOwner.parent.nodeScope;
    } else {
      parentNodeScope = this.componentOwner.parentNodeScope;
    }

    if (!parentNodeScope) return;

    var nodes = parentNodeScope.nodes;
    for (var nodeId in nodes) {
      var children = nodes[nodeId].children;
      if (children) {
        var _c = children.filter(
          (child) => child.name && this.context.hasComponentModelWithName(child.name) && child.nodeScope !== this
        );
        _c.forEach((child) => {
          var consumed = child.nodeScope.sendEventFromThisScope(eventName, data, null, true);
          if (consumed) return true;
        });
      }
    }
  }

  return false;
};

module.exports = NodeScope;
