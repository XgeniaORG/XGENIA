"use strict";

function NodeRegister(context) {
    this._constructors = {};
    this.context = context;
    // FIX (2026-03-10): Cache for resolved names to avoid re-computing
    this._nameAliasCache = {};
}

// FIX (2026-03-10): Resolve node type name — handles CamelCase → 'Camel Case'
// Editor sends 'SetVariable' but runtime registers as 'Set Variable'.
// Also handles 'Variable2', 'ForEach', etc.
NodeRegister.prototype.resolveName = function (name) {
    if (!name) return name;
    // Direct match — fast path
    if (this._constructors && this._constructors.hasOwnProperty(name)) {
        return name;
    }
    // Check cache
    if (this._nameAliasCache[name]) {
        return this._nameAliasCache[name];
    }
    // Try CamelCase → 'Camel Case' (e.g. SetVariable → Set Variable)
    var spacedName = name.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (spacedName !== name && this._constructors && this._constructors.hasOwnProperty(spacedName)) {
        this._nameAliasCache[name] = spacedName;
        return spacedName;
    }
    // Try fully qualified name with common prefixes
    var prefixed = ['net.xgenia.' + name, 'xgenia.' + name];
    for (var i = 0; i < prefixed.length; i++) {
        if (this._constructors && this._constructors.hasOwnProperty(prefixed[i])) {
            this._nameAliasCache[name] = prefixed[i];
            return prefixed[i];
        }
    }
    // No match found, return original
    return name;
};

NodeRegister.prototype.register = function (nodeDefinition) {
    // Check if nodeDefinition and nodeDefinition.metadata exist
    if (!nodeDefinition) {
        return;
    }

    // If metadata is missing, try to get the name from the node definition directly
    var name;
    if (nodeDefinition.metadata && nodeDefinition.metadata.name) {
        name = nodeDefinition.metadata.name;
    } else if (nodeDefinition.name) {
        name = nodeDefinition.name;
        // Create metadata if it doesn't exist
        if (!nodeDefinition.metadata) {
            nodeDefinition.metadata = { name: name };
        }
    } else {
        return;
    }

    this._constructors[name] = nodeDefinition;
};

NodeRegister.prototype.createNode = function (name, id, nodeScope) {
    // Create a fallback base node constructor
    const createBaseNode = function (context, id, nodeScope) {
        // Create a minimal node object with required properties
        return {
            id: id,
            name: name,
            nodeScope: nodeScope,
            context: context,
            inputs: {},
            outputs: {},
            registerInputIfNeeded: function () { },
            registerOutputIfNeeded: function () { },
            connectInput: function () { },
            hasInput: function () { return false; },
            queueInput: function () { },
            _onNodeDeleted: function () { },
            removeInputConnection: function () { },
            setNodeModel: function () { },
            setVariant: function () { },
            // Add missing methods that are used by the React component nodes
            forceUpdate: function () {
                // React 19 compatibility - ensure this method exists and works
                if (this.reactComponentRef && typeof this.reactComponentRef.setState === 'function') {
                    this.reactComponentRef.setState({});
                }
            },
            setStyle: function (styles, styleTag) {
                // No-op implementation to avoid errors
                console.log('Fallback node: setStyle called', styles, styleTag);
            },
            removeStyle: function (styles, styleTag) {
                // No-op implementation to avoid errors
                console.log('Fallback node: removeStyle called', styles, styleTag);
            },
            scheduleAfterInputsHaveUpdated: function (callback) {
                // Simple implementation to avoid errors
                if (typeof callback === 'function') {
                    setTimeout(callback, 0);
                }
            },
            // Additional methods needed for React component nodes
            getDOMElement: function () { return null; },
            getVisualParentNode: function () { return null; },
            getChildren: function () { return []; },
            renderChildren: function () { return null; },
            render: function () { return null; },
            // Add methods for parent-child relationships
            addChild: function (child) {
                if (!this.children) this.children = [];
                child.parent = this;
                this.children.push(child);
            },
            removeChild: function (child) {
                if (!this.children) return;
                const index = this.children.indexOf(child);
                if (index !== -1) {
                    this.children.splice(index, 1);
                    child.parent = undefined;
                }
            }
        };
    };

    // Check if we have constructors and the specific constructor
    if (!this._constructors) {
        console.warn("No constructors registered");
        this._constructors = {};
    }

    // If the constructor doesn't exist, log a warning and use the base node
    if (!this._constructors.hasOwnProperty(name)) {
        // FIX (2026-03-10): Try name resolution before giving up
        var resolvedName = this.resolveName(name);
        if (resolvedName !== name && this._constructors.hasOwnProperty(resolvedName)) {
            console.debug("[nodeRegister] Resolved '" + name + "' → '" + resolvedName + "'");
            name = resolvedName;
        } else {
            console.warn("Unknown node type with name " + name + ", using fallback node");
            return createBaseNode(this.context, id, nodeScope);
        }
    }

    const constructor = this._constructors[name];

    // If the constructor is not a function, log a warning and use the base node
    if (typeof constructor !== 'function') {
        console.warn("Constructor for node type '" + name + "' is not a function, using fallback node");
        return createBaseNode(this.context, id, nodeScope);
    }

    try {
        const node = constructor(this.context, id, nodeScope);
        if (!node) {
            console.warn("Constructor for '" + name + "' returned null or undefined, using fallback node");
            return createBaseNode(this.context, id, nodeScope);
        }

        // Always ensure the node has the required methods for React compatibility
        // Check if the node already has a forceUpdate method
        if (typeof node === 'object' && node !== null) {
            // Only add forceUpdate if it doesn't already exist
            if (typeof node.forceUpdate !== 'function') {
                try {
                    // Try to define the property using Object.defineProperty
                    Object.defineProperty(node, 'forceUpdate', {
                        value: function () {
                            var self = this;
                            // Use the node's context to schedule an update
                            if (self.context && self.context.scheduleUpdate) {
                                self.context.scheduleUpdate();
                            }
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define forceUpdate method on node:", e.message);
                    // If we can't define the property, we'll use the existing one or do nothing
                }
            }
        } else {
            console.error("Node constructor for '" + name + "' did not return a valid object");
            return createBaseNode(this.context, id, nodeScope);
        }

        // Always ensure required methods exist using Object.defineProperty
        if (typeof node === 'object' && node !== null) {
            // Define setStyle method if it doesn't exist
            if (typeof node.setStyle !== 'function') {
                try {
                    Object.defineProperty(node, 'setStyle', {
                        value: function (styles, styleTag) {
                            if (typeof this._originalSetStyle === 'function') {
                                this._originalSetStyle(styles, styleTag);
                            } else {
                                console.log('Fallback implementation: setStyle called on node of type ' + name, styles, styleTag);
                            }
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define setStyle method on node:", e.message);
                }
            }

            // Define removeStyle method if it doesn't exist
            if (typeof node.removeStyle !== 'function') {
                try {
                    Object.defineProperty(node, 'removeStyle', {
                        value: function (styles, styleTag) {
                            if (typeof this._originalRemoveStyle === 'function') {
                                this._originalRemoveStyle(styles, styleTag);
                            } else {
                                console.log('Fallback implementation: removeStyle called on node of type ' + name, styles, styleTag);
                            }
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define removeStyle method on node:", e.message);
                }
            }

            // Define scheduleAfterInputsHaveUpdated method if it doesn't exist
            if (typeof node.scheduleAfterInputsHaveUpdated !== 'function') {
                try {
                    Object.defineProperty(node, 'scheduleAfterInputsHaveUpdated', {
                        value: function (callback) {
                            if (typeof callback === 'function') {
                                setTimeout(callback, 0);
                            }
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define scheduleAfterInputsHaveUpdated method on node:", e.message);
                }
            }

            // Define addChild method if it doesn't exist
            if (typeof node.addChild !== 'function') {
                try {
                    Object.defineProperty(node, 'addChild', {
                        value: function (child) {
                            if (!this.children) this.children = [];
                            child.parent = this;
                            this.children.push(child);
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define addChild method on node:", e.message);
                }
            }

            // Define removeChild method if it doesn't exist
            if (typeof node.removeChild !== 'function') {
                try {
                    Object.defineProperty(node, 'removeChild', {
                        value: function (child) {
                            if (!this.children) return;
                            const index = this.children.indexOf(child);
                            if (index !== -1) {
                                this.children.splice(index, 1);
                                child.parent = undefined;
                            }
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define removeChild method on node:", e.message);
                }
            }

            // Define getChildren method if it doesn't exist
            if (typeof node.getChildren !== 'function') {
                try {
                    Object.defineProperty(node, 'getChildren', {
                        value: function () {
                            return this.children || [];
                        },
                        writable: true,
                        configurable: true
                    });
                } catch (e) {
                    console.warn("Could not define getChildren method on node:", e.message);
                }
            }
        }

        return node;
    } catch (e) {
        console.error("Error creating node of type '" + name + "':", e.message);
        console.warn("Using fallback node due to error");
        return createBaseNode(this.context, id, nodeScope);
    }
};

NodeRegister.prototype.getNodeMetadata = function (type) {
    // Create a fallback metadata object
    const createBaseMetadata = function () {
        return {
            name: type,
            category: 'Unknown',
            inputs: {},
            outputs: {}
        };
    };

    if (!this._constructors) {
        console.warn("No constructors registered when getting metadata for " + type);
        return createBaseMetadata();
    }

    if (this._constructors.hasOwnProperty(type) === false) {
        console.warn("Unknown node type with name " + type + " when getting metadata");
        return createBaseMetadata();
    }

    if (!this._constructors[type] || !this._constructors[type].metadata) {
        console.warn("Missing metadata for node type " + type);
        return createBaseMetadata();
    }

    return this._constructors[type].metadata;
};

NodeRegister.prototype.hasNode = function (type) {
    // FIX (2026-03-10): Use resolveName for consistent lookup
    var resolved = this.resolveName(type);
    return this._constructors && this._constructors.hasOwnProperty(resolved);
};

NodeRegister.prototype.getInputType = function (type, inputName) {
    const metadata = this.getNodeMetadata(type);
    return metadata.inputs[inputName] && metadata.inputs[inputName].type;
}

module.exports = NodeRegister;
