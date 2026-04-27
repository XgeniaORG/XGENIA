'use strict';

module.exports = {
  node: {
    name: 'MCP Tool',
    shortDesc: 'Executes an MCP tool with configurable parameters',
    docs: 'https://docsapp.xgenia.com/nodes/mcp/mcp-tool',
    category: 'MCP',
    color: 'mcp',
    inputs: {
      trigger: {
        type: { name: 'signal' },
        displayName: 'Execute',
        description: 'Trigger to execute the MCP tool',
        valueChangedToTrue: function () {
          this.execute();
        }
      }
    },
    outputs: {
      result: {
        type: { name: '*' },
        displayName: 'Result',
        description: 'Result from the MCP tool execution'
      },
      success: {
        type: { name: 'boolean' },
        displayName: 'Success',
        description: 'Whether the tool execution was successful'
      },
      error: {
        type: { name: 'string' },
        displayName: 'Error',
        description: 'Error message if execution failed'
      },
      // Signal outputs for data flow animations
      executed: {
        type: { name: 'signal' },
        displayName: 'Executed',
        description: 'Triggered when MCP tool execution completes'
      },
      successSignal: {
        type: { name: 'signal' },
        displayName: 'Success Signal',
        description: 'Triggered when MCP tool execution succeeds'
      },
      errorSignal: {
        type: { name: 'signal' },
        displayName: 'Error Signal',
        description: 'Triggered when MCP tool execution fails'
      }
    },
    initialize: function () {
      var internal = this._internal;
      internal.inputValues = {};
      internal.lastInputSchema = null;
    },
    parameters: {
      serverName: {
        type: { name: 'string' },
        displayName: 'Server Name',
        description: 'Name of the MCP server',
        defaultValue: ''
      },
      toolName: {
        type: { name: 'string' },
        displayName: 'Tool Name',
        description: 'Name of the MCP tool to execute',
        defaultValue: ''
      },
      toolDescription: {
        type: { name: 'string' },
        displayName: 'Tool Description',
        description: 'Description of the MCP tool',
        defaultValue: ''
      },
      inputSchema: {
        type: { name: 'object' },
        displayName: 'Input Schema',
        description: 'JSON schema for tool parameters',
        defaultValue: {}
      },
      toolParameters: {
        type: { name: 'object' },
        displayName: 'Tool Parameters',
        description: 'Parameters to pass to the MCP tool',
        defaultValue: {}
      }
    },
    methods: {
      initialize: function () {
        this._internal = {
          isExecuting: false,
          lastExecution: null,
          lastResult: null,
          lastError: null
        };

        // Auto-execute when node is initialized if parameters are available
        this.autoExecute();
      },

      // Auto-execute method that runs when node is created
      autoExecute: function () {
        // Small delay to ensure parameters are properly set
        setTimeout(async () => {
          const parameters = this.getParameters();
          if (parameters.serverName && parameters.toolName) {
            // Check if MCP service is available through context
            const mcpService = this.context && this.context.getMCPService();
            if (!mcpService || !mcpService.isServiceReady()) {
              console.log('[MCP Tool Node] MCP service not ready, skipping auto-execution');
              return;
            }

            console.log('[MCP Tool Node] Auto-executing on initialization');
            this.execute();
          }
        }, 100);
      },

      execute: async function () {
        try {
          // Ensure node is properly initialized
          if (!this._internal) {
            this.initialize();
          }

          // Debug: Check available methods
          console.log('[MCP Tool Node] Available methods:', {
            sendValue: typeof this.sendValue === 'function',
            sendSignalOnOutput: typeof this.sendSignalOnOutput === 'function',
            flagDirty: typeof this.flagDirty === 'function',
            hasOutput: typeof this.hasOutput === 'function'
          });

          // Get parameters using the helper method
          const parameters = this.getParameters();

          const serverName = parameters.serverName;
          const toolName = parameters.toolName;
          const panelParameters = parameters.toolParameters || {};

          // Merge panel parameters with connected input values (connected values take priority)
          const toolParameters = Object.assign({}, panelParameters, this._internal.inputValues);

          console.log('[MCP Tool Node] Panel parameters:', panelParameters);
          console.log('[MCP Tool Node] Connected input values:', this._internal.inputValues);
          console.log('[MCP Tool Node] Final merged parameters:', toolParameters);

          console.log('[MCP Tool Node] Executing tool:', { serverName, toolName, toolParameters });

          // Check if node is properly configured
          if (!serverName || !toolName) {
            console.warn('[MCP Tool Node] Node not properly configured yet. Parameters:', parameters);
            return;
          }

          // Set executing visual state
          this._internal.isExecuting = true;
          this.flagDirty();

          // Get MCP service from context instead of window.mcpAPI
          const mcpService = this.context && this.context.getMCPService();
          if (!mcpService) {
            throw new Error('MCP service is not available. Context or MCP service not initialized.');
          }

          // Call the MCP tool using the context MCP service
          const result = await mcpService.callTool(serverName, toolName, toolParameters);

          // Store execution result in internal state (same as property panel)
          this._internal.lastExecution = Date.now();
          this._internal.lastResult = result;
          this._internal.lastError = null;

          // Set outputs for connected nodes using runtime methods
          this.sendValue('result', result);
          this.sendValue('success', true);
          this.sendValue('error', '');

          // Send signals for data flow animations
          this.sendSignalOnOutput('executed');
          this.sendSignalOnOutput('successSignal');

          // Clear executing visual state
          this._internal.isExecuting = false;
          this.flagDirty();

          console.log(`[MCP Tool Node] Successfully executed ${toolName} on ${serverName}:`, result);
        } catch (error) {
          console.error(`[MCP Tool Node] Error executing ${this.parameters?.toolName || 'unknown tool'}:`, error);

          // Store error result in internal state (same as property panel)
          this._internal.lastExecution = Date.now();
          this._internal.lastResult = null;
          this._internal.lastError = error.message;

          // Set outputs for connected nodes using runtime methods
          this.sendValue('result', null);
          this.sendValue('success', false);
          this.sendValue('error', error.message);

          // Send signals for data flow animations
          this.sendSignalOnOutput('executed');
          this.sendSignalOnOutput('errorSignal');

          // Clear executing visual state
          this._internal.isExecuting = false;
          this.flagDirty();
        }
      },

      // Method to get the last execution result for the property panel
      getLastExecutionResult: function () {
        return {
          success: this._internal.lastError === null,
          result: this._internal.lastResult,
          error: this._internal.lastError,
          timestamp: this._internal.lastExecution,
          isExecuting: this._internal.isExecuting
        };
      },

      // Method to get current execution state
      getExecutionState: function () {
        return {
          isExecuting: this._internal.isExecuting,
          lastExecution: this._internal.lastExecution,
          lastResult: this._internal.lastResult,
          lastError: this._internal.lastError
        };
      },

      // Helper method to get parameters (matches property panel approach)
      getParameters: function () {
        // Try different ways to access parameters
        let parameters = this.parameters || {};

        // If we have a model, try to access parameters through it
        if (this.model && this.model.parameters) {
          parameters = this.model.parameters;
        }

        // If we're in a runtime context, the parameters might be directly accessible
        if (!parameters.serverName && this.parameters) {
          parameters = this.parameters;
        }

        return parameters;
      },

      // Register dynamic inputs for schema properties
      registerInputIfNeeded: function (name) {
        if (this.hasInput(name)) {
          return;
        }

        if (name.startsWith('param-')) {
          this.registerInput(name, {
            set: this._setInputValue.bind(this, name.substring('param-'.length))
          });
        }
      },

      // Set input value from connected nodes
      _setInputValue: function (name, value) {
        console.log(`[MCP Tool Node] _setInputValue called: ${name} = ${value}`);
        console.log(`[MCP Tool Node] Current tool: ${this.getParameters().toolName}`);

        // Always set the value - let the MCP tool handle final validation
        this._internal.inputValues[name] = value;
        console.log(`[MCP Tool Node] Successfully set parameter: ${name} = ${value}`);
        console.log(`[MCP Tool Node] Current inputValues:`, this._internal.inputValues);
      },

      getInspectInfo: function () {
        const internal = this._internal || {};

        return {
          type: 'value',
          value: {
            success: internal.lastError === null,
            result: internal.lastResult,
            error: internal.lastError,
            timestamp: internal.lastExecution,
            inputValues: internal.inputValues,
            lastInputSchema: internal.lastInputSchema,
            isExecuting: internal.isExecuting || false
          }
        };
      }
    }
  },

  // Setup dynamic port generation based on inputSchema
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function _managePortsForNode(node) {
      function _updatePorts() {
        // Add debouncing to prevent rapid successive calls
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

        const parameters = node.parameters;
        const inputSchema = parameters.inputSchema;

        console.log(`[MCP Tool Node] Updating ports for tool: ${parameters.toolName}`);
        console.log(`[MCP Tool Node] Input schema:`, inputSchema);

        // Check if schema changed to clear cached input values
        if (node._internal) {
          const lastSchema = node._internal.lastInputSchema;
          const currentSchemaStr = JSON.stringify(inputSchema);

          if (lastSchema && lastSchema !== currentSchemaStr) {
            console.log(`[MCP Tool Node] Schema changed, clearing input values`);
            node._internal.inputValues = {};
          }

          node._internal.lastInputSchema = currentSchemaStr;
        }

        // Generate input ports from schema properties
        if (inputSchema && inputSchema.properties) {
          const properties = inputSchema.properties;
          const required = inputSchema.required || [];

          // JSON Schema type mapping to node input types
          const typeMap = {
            string: 'string',
            number: 'number',
            integer: 'number',
            boolean: 'boolean',
            array: 'array',
            object: 'object'
          };

          console.log(`[MCP Tool Node] Generating input ports for properties:`, Object.keys(properties));

          for (const [propName, propSchema] of Object.entries(properties)) {
            const inputType = typeMap[propSchema.type] || '*';
            const isRequired = required.includes(propName);

            console.log(
              `[MCP Tool Node] Adding input port: ${propName} (${propSchema.type} -> ${inputType}, required: ${isRequired})`
            );

            ports.push({
              type: {
                name: inputType
              },
              plug: 'input',
              group: 'Parameters',
              name: 'param-' + propName,
              displayName: propName + (isRequired ? ' *' : ''),
              description: propSchema.description || `Parameter: ${propName}`
            });
          }

          console.log(`[MCP Tool Node] Generated ${Object.keys(properties).length} input ports`);
        } else {
          console.log(`[MCP Tool Node] No schema properties found for tool: ${parameters.toolName}`);
        }

        context.editorConnection.sendDynamicPorts(node.id, ports);
      }

      _updatePorts();

      // Cleanup timeout when node is destroyed
      if (node.on && typeof node.on === 'function') {
        node.on('destroy', function () {
          if (node._portUpdateTimeout) {
            clearTimeout(node._portUpdateTimeout);
            delete node._portUpdateTimeout;
          }
        });
      }

      // Update ports when parameters change
      node.on('parameterUpdated', function (event) {
        if (event.name === 'inputSchema' || event.name === 'toolName') {
          console.log(`[MCP Tool Node] Parameter ${event.name} updated, refreshing ports`);
          _updatePorts();
        }
      });
    }

    // Set up port management for existing and new nodes
    graphModel.on('editorImportComplete', () => {
      graphModel.on('nodeAdded.MCP Tool', function (node) {
        _managePortsForNode(node);
      });

      for (const node of graphModel.getNodesWithType('MCP Tool')) {
        _managePortsForNode(node);
      }
    });
  }
};
