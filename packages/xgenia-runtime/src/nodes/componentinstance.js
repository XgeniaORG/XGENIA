'use strict';

var Node = require('../node');
var NodeScope = require('../nodescope');

let componentIdCounter = 0;

function ComponentInstanceNode(context, id, parentNodeScope) {
  Node.call(this, context, id);

  this.nodeScope = new NodeScope(context, this);
  this.parentNodeScope = parentNodeScope;
  this._internal.childRoot = null;
  this._internal.componentOutputValues = {};
  this._internal.componentOutputs = [];
  this._internal.componentInputs = [];
  this._internal.inputValues = {};
  this._internal.roots = [];

  this._internal.instanceId = '__$ndl_componentInstaceId' + componentIdCounter;

  this.nodeScope.modelScope = parentNodeScope ? parentNodeScope.modelScope : undefined;

  componentIdCounter++;
}

ComponentInstanceNode.prototype = Object.create(Node.prototype, {
  setComponentModel: {
    value: async function (componentModel) {
      this.componentModel = componentModel;
      var self = this;

      await this.nodeScope.setComponentModel(componentModel);

      this._internal.componentInputs = this.nodeScope.getNodesWithType('Component Inputs');
      this._internal.componentOutputs = this.nodeScope.getNodesWithType('Component Outputs');

      Object.values(componentModel.getInputPorts()).forEach(this.registerComponentInputPort.bind(this));
      Object.values(componentModel.getOutputPorts()).forEach(this.registerComponentOutputPort.bind(this));

      const roots = componentModel.roots || [];
      this._internal.roots = roots.map((id) => this.nodeScope.getNodeWithId(id));

      componentModel.on(
        'rootAdded',
        (id) => {
          this._internal.roots.push(this.nodeScope.getNodeWithId(id));
          this.forceUpdate();
        },
        this
      );

      componentModel.on(
        'rootRemoved',
        function (id) {
          const index = this._internal.roots.findIndex((root) => root.id === id);
          if (index !== -1) {
            this._internal.roots.splice(index, 1);
          }
          this.forceUpdate();
        },
        this
      );

      componentModel.on('inputPortAdded', this.registerComponentInputPort.bind(this), this);
      componentModel.on('outputPortAdded', this.registerComponentOutputPort.bind(this), this);

      componentModel.on(
        'inputPortRemoved',
        function (port) {
          if (self.hasInput(port.name)) {
            self.deregisterInput(port.name);
          }
        },
        this
      );
      componentModel.on(
        'outputPortRemoved',
        function (port) {
          if (this.hasOutput(port.name)) {
            self.deregisterOutput(port.name);
          }
        },
        this
      );

      componentModel.on(
        'nodeAdded',
        function (node) {
          if (node.type === 'Component Inputs') {
            self._internal.componentInputs.push(self.nodeScope.getNodeWithId(node.id));
          } else if (node.type === 'Component Outputs') {
            self._internal.componentOutputs.push(self.nodeScope.getNodeWithId(node.id));
          }
        },
        this
      );

      componentModel.on(
        'nodeRemoved',
        function (node) {
          function removeNodesWithId(array, id) {
            return array.filter((e) => e.id !== id);
          }
          if (node.type === 'Component Inputs') {
            self._internal.componentInputs = removeNodesWithId(self._internal.componentInputs, node.id);
          } else if (node.type === 'Component Outputs') {
            self._internal.componentOutputs = removeNodesWithId(self._internal.componentOutputs, node.id);
          }
        },
        this
      );

      componentModel.on(
        'renamed',
        function (event) {
          self.name = event.newName;
        },
        this
      );
    }
  },
  _onNodeDeleted: {
    value: function () {
      if (this.componentModel) {
        this.componentModel.removeListenersWithRef(this);
        this.componentModel = undefined;
      }

      this.nodeScope.reset();
      Node.prototype._onNodeDeleted.call(this);
    }
  },
  registerComponentInputPort: {
    value: function (port) {
      this.registerInput(port.name, {
        set: function (value) {
          this._internal.inputValues[port.name] = value;
          this._internal.componentInputs.forEach(function (componentInput) {
            componentInput.registerOutputIfNeeded(port.name);
            componentInput.flagOutputDirty(port.name);
          });
        }
      });
    }
  },
  registerComponentOutputPort: {
    value: function (port) {
      this.registerOutput(port.name, {
        getter: function () {
          return this._internal.componentOutputValues[port.name];
        }
      });
    }
  },
  setOutputFromComponentOutput: {
    value: function (name, value) {
      if (this.hasOutput(name) === false) {
        return;
      }

      this._internal.creatorCallbacks &&
        this._internal.creatorCallbacks.onOutputChanged &&
        this._internal.creatorCallbacks.onOutputChanged(name, value, this._internal.componentOutputValues[name]);

      this._internal.componentOutputValues[name] = value;
      this.flagOutputDirty(name);
    }
  },
  setChildRoot: {
    value: function (node) {
      const prevChildRoot = this._internal.childRoot;
      const newChildRoot = node;

      this._internal.childRoot = newChildRoot;

      // Safety check for model and model.children
      if (!this.model || !this.model.children || !Array.isArray(this.model.children)) {
        console.warn('Cannot set child root: model or model.children is invalid');
        return;
      }

      // Safety check for parentNodeScope
      if (!this.parentNodeScope) {
        console.warn('Cannot set child root: parentNodeScope is null or undefined');
        return;
      }

      try {
        const parentNodeScope = this.parentNodeScope;

        // Get children with safety checks
        const children = [];
        for (let i = 0; i < this.model.children.length; i++) {
          const childModel = this.model.children[i];
          if (!childModel) continue;
          
          // Skip Component Children nodes
          if (childModel.type === 'Component Children') continue;
          
          // Safety check for childModel.id
          if (!childModel.id) {
            console.warn('Child model has no id, skipping');
            continue;
          }
          
          try {
            const childNode = parentNodeScope.getNodeWithId(childModel.id);
            if (childNode) {
              children.push(childNode);
            }
          } catch (e) {
            console.error('Error getting node with id:', e);
          }
        }

        // Remove children from previous root
        if (prevChildRoot) {
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child) continue;
            
            try {
              // Safety check for isChild method
              if (typeof prevChildRoot.isChild === 'function' && prevChildRoot.isChild(child)) {
                // Safety check for removeChild method
                if (typeof prevChildRoot.removeChild === 'function') {
                  prevChildRoot.removeChild(child);
                }
              }
            } catch (e) {
              console.error('Error removing child from previous root:', e);
            }
          }
        }

        // Add children to new root
        if (newChildRoot) {
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (!child) continue;
            
            try {
              // Safety check for child.model and child.model.parent
              if (child.model && child.model.parent && Array.isArray(child.model.parent.children)) {
                const index = child.model.parent.children.indexOf(child.model);
                this.addChild(child, index);
              } else {
                // Fallback to adding without index
                this.addChild(child);
              }
            } catch (e) {
              console.error('Error adding child to new root:', e);
            }
          }
        }
      } catch (e) {
        console.error('Error in setChildRoot:', e);
      }
    }
  },
  getChildRootIndex: {
    value: function () {
      if (!this._internal.childRoot || !this._internal.childRoot.model || !this._internal.childRoot.model.children) {
        return 0;
      }

      var children = this._internal.childRoot.model.children;

      for (var i = 0; i < children.length; i++) {
        if (children[i].type === 'Component Children') {
          return i;
        }
      }

      return 0;
    }
  },
  getChildRoot: {
    value: function () {
      if (this._internal.childRoot) {
        return this._internal.childRoot;
      }
      return null;
    }
  },
  getRoots: {
    value: function () {
      return this._internal.roots;
    }
  },
  /** Added for SSR Support */
  triggerDidMount: {
    value: function () {
      this._internal.roots.forEach((root) => {
        root.triggerDidMount && root.triggerDidMount();
      });
    }
  },
  render: {
    value: function () {
      if (this._internal.roots.length === 0) {
        return null;
      }

      return this._internal.roots[0].render();
    }
  },
  setChildIndex: {
    value: function (childIndex) {
      // NOTE: setChildIndex can be undefined when it is not a React node,
      //       but still a visual node like the foreach (Repeater) node.
      this.getRoots().forEach((root) => root.setChildIndex && root.setChildIndex(childIndex));
    }
  },
  addChild: {
    value: function (child, index) {
      // Safety check for child
      if (!child) {
        console.warn('Cannot add null or undefined child to component instance');
        return;
      }

      const childRoot = this.getChildRoot();
      if (!childRoot) {
        console.warn('Cannot add child to component instance: child root is null');
        return;
      }

      // Safety check for childRoot.addChild
      if (typeof childRoot.addChild !== 'function') {
        console.error('Child root does not have addChild method');
        return;
      }

      try {
        // Safety check for index
        const childIndex = typeof index === 'number' ? index : 0;
        const rootIndex = this.getChildRootIndex();
        
        // Add the child to the root
        childRoot.addChild(child, childIndex + rootIndex);
      } catch (e) {
        console.error('Error adding child to component instance:', e);
        
        // Fallback implementation if the normal method fails
        try {
          if (!childRoot.children) childRoot.children = [];
          if (child.parent && child.parent !== childRoot && typeof child.parent.removeChild === 'function') {
            child.parent.removeChild(child);
          }
          child.parent = childRoot;
          childRoot.children.push(child);
          console.log('Used fallback method to add child to component instance');
        } catch (fallbackError) {
          console.error('Fallback method also failed:', fallbackError);
        }
      }
    }
  },
  removeChild: {
    value: function (child) {
      // Safety check for child
      if (!child) {
        console.warn('Cannot remove null or undefined child from component instance');
        return;
      }

      const childRoot = this.getChildRoot();
      if (!childRoot) {
        console.warn('Cannot remove child from component instance: child root is null');
        return;
      }

      // Safety check for childRoot.removeChild
      if (typeof childRoot.removeChild !== 'function') {
        console.error('Child root does not have removeChild method');
        return;
      }

      try {
        childRoot.removeChild(child);
      } catch (e) {
        console.error('Error removing child from component instance:', e);
        
        // Fallback implementation if the normal method fails
        try {
          if (childRoot.children) {
            const index = childRoot.children.indexOf(child);
            if (index !== -1) {
              childRoot.children.splice(index, 1);
              child.parent = undefined;
              console.log('Used fallback method to remove child from component instance');
            }
          }
        } catch (fallbackError) {
          console.error('Fallback method also failed:', fallbackError);
        }
      }
    }
  },
  getChildren: {
    value: function (child) {
      const childRoot = this.getChildRoot();
      return childRoot ? childRoot.getChildren() : [];
    }
  },
  isChild: {
    value: function (child) {
      if (!this.getChildRoot()) {
        return false;
      }

      return this.getChildRoot().isChild(child);
    }
  },
  contains: {
    value: function (node) {
      return this.getRoots().some((root) => root.contains && root.contains(node));
    }
  },
  _performDirtyUpdate: {
    value: function () {
      Node.prototype._performDirtyUpdate.call(this);

      var componentInputs = this._internal.componentInputs;
      for (var i = 0, len = componentInputs.length; i < len; i++) {
        componentInputs[i].flagDirty();
      }

      this._internal.componentOutputs.forEach(function (componentOutput) {
        componentOutput.flagDirty();
      });
    }
  },
  getRef: {
    value: function () {
      const root = this._internal.roots[0];
      return root ? root.getRef() : undefined;
    }
  },
  update: {
    value: function () {
      Node.prototype.update.call(this);

      this._internal.componentOutputs.forEach(function (componentOutput) {
        componentOutput.update();
      });
    }
  },
  forceUpdate: {
    //this is only used when roots are added or removed
    value: function () {
      if (!this.parent) return;

      //the parent will need to re-render the roots of this component instance
      //TODO: make this use a cleaner API, and only invalidate the affected child, instead of all children
      this.parent.cachedChildren = undefined;
      this.parent.forceUpdate();
    }
  },
  getInstanceId: {
    value() {
      return this._internal.instanceId;
    }
  }
});

ComponentInstanceNode.prototype.constructor = ComponentInstanceNode;
module.exports = ComponentInstanceNode;
