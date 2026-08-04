const JavascriptNodeParser = require('../../javascriptnodeparser');
const { logJavaScriptNodeError } = require('../../utils');

const SimpleJavascriptNode = {
  name: 'JavaScriptFunction',
  displayNodeName: 'Function',
  docs: 'https://docsapp.xgenia.com/nodes/javascript/function',
  category: 'CustomCode',
  color: 'javascript',
  nodeDoubleClickAction: {
    focusPort: 'Script'
  },
  searchTags: ['javascript'],
  exportDynamicPorts: true,
  initialize: function () {
    this._internal.inputValues = {};
    this._internal.outputValues = {};

    this._internal.outputValuesProxy = new Proxy(this._internal.outputValues, {
      set: (obj, prop, value) => {
        //a function node can continue running after it has been deleted. E.g. with timeouts or event listeners that hasn't been removed.
        //if the node is deleted, just do nothing
        if (this._deleted) {
          return;
        }

        //only send outputs when they change.
        //Some XGENIA projects rely on this behavior, so changing it breaks backwards compability
        if (value !== this._internal.outputValues[prop]) {
          this.registerOutputIfNeeded('out-' + prop);

          this._internal.outputValues[prop] = value;
          this.flagOutputDirty('out-' + prop);
        }
        return true;
      }
    });

    this._internal._this = {};
  },
  getInspectInfo() {
    return [
      {
        type: 'value',
        value: {
          inputs: this._internal.inputValues,
          outputs: this._internal.outputValues
        }
      }
    ];
  },
  inputs: {
    scriptInputs: {
      type: {
        name: 'proplist',
        allowEditOnly: true
      },
      group: 'Script Inputs',
      set(value) {
        //  ignore
      }
    },
    scriptOutputs: {
      type: {
        name: 'proplist',
        allowEditOnly: true
      },
      group: 'Script Outputs',
      set(value) {
        //  ignore
      }
    },
    functionScript: {
      displayName: 'Script',
      plug: 'input',
      type: {
        name: 'string',
        allowEditOnly: true,
        codeeditor: 'javascript'
      },
      group: 'General',
      set(script) {
        if (script === undefined) {
          this._internal.func = undefined;
          return;
        }

        this._internal.func = this.parseScript(script);

        if (!this.isInputConnected('run')) this.scheduleRun();
      }
    },
    run: {
      type: 'signal',
      displayName: 'Run',
      group: 'Actions',
      valueChangedToTrue: function () {
        this.scheduleRun();
      }
    },
    // This node used to declare its own `isMath` deployment tickbox, opting out
    // of the generic injection in nodelibraryexport.js so the property was
    // always present on custom Function nodes. Removed 2026-08-04 with the
    // tickbox itself: deployment is decided by LOCATION now — a `/#__maths__/`
    // component compiles to the RGS, everything else stays on the frontend.
    //
    // This was the one node that declared the toggle itself rather than
    // receiving it, so it survived the first pass and kept rendering a
    // "Deployment / Is Math" property with no compiler left to read it.
  },
  outputs: {},
  methods: {
    scheduleRun: function () {
      if (this.runScheduled) return;
      this.runScheduled = true;

      this.scheduleAfterInputsHaveUpdated(() => {
        this.runScheduled = false;

        if (!this._deleted) {
          this.runScript();
        }
      });
    },
    runScript: async function () {
      const func = this._internal.func;
      const nodeId = this.id;
      const scriptContent = this.model.parameters.functionScript;

      console.log(`[JSFunction RUN] Node ID: ${nodeId}, About to run script:`, scriptContent);

      if (func === undefined) {
        console.log(`[JSFunction SKIP] Node ID: ${nodeId}, Function is undefined.`);
        return;
      }

      const inputs = this._internal.inputValues;
      const outputs = this._internal.outputValuesProxy;

      // Prepare send signal functions
      for (const key in this.model.outputPorts) {
        if (this._isSignalType(key)) {
          const _sendSignal = () => {
            if (this.hasOutput(key)) this.sendSignalOnOutput(key);
          };
          this._internal.outputValues[key.substring('out-'.length)] = _sendSignal;
          this._internal.outputValues[key.substring('out-'.length)].send = _sendSignal;
        }
      }

      try {
        await func.apply(this._internal._this, [
          inputs,
          outputs,
          JavascriptNodeParser.createXgeniaAPI(this.nodeScope.modelScope),
          JavascriptNodeParser.getComponentScopeForNode(this)
        ]);
        console.log(`[JSFunction RUN] Node ID: ${nodeId}, Script finished successfully.`);
      } catch (e) {
        console.error(`[JSFunction ERROR] Node ID: ${nodeId}, Script:`, scriptContent, 'Error:', e);
        logJavaScriptNodeError(e);

        if (this.context.editorConnection && this.context.isWarningTypeEnabled('javascriptExecution')) {
          this.context.editorConnection.sendWarning(
            this.nodeScope.componentOwner.name,
            this.id,
            'js-function-run-waring',
            {
              showGlobally: true,
              message: e.message,
              stack: e.stack
            }
          );
        }
      }
    },
    setScriptInputValue: function (name, value) {
      this._internal.inputValues[name] = value;

      if (!this.isInputConnected('run')) this.scheduleRun();
    },
    getScriptOutputValue: function (name) {
      if (this._isSignalType(name)) {
        return undefined;
      }
      return this._internal.outputValues[name];
    },
    setScriptInputType: function (name, type) {
      this._internal.inputTypes[name] = type;
    },
    setScriptOutputType: function (name, type) {
      this._internal.outputTypes[name] = type;
    },
    parseScript: function (script) {
      if (typeof script !== 'string' || !script.trim()) {
        console.warn('Invalid or empty script provided. Returning a no-op function.');
        return async function () { };
      }

      let func;
      try {
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

        // Check if the script contains await statements
        const hasAwait = /\bawait\b/.test(script);

        if (hasAwait) {
          // Wrap the script in an async function to properly handle await statements
          const wrappedScript = `
            (async function() {
              ${JavascriptNodeParser.getCodePrefix()}
              ${script}
            })();
          `;

          func = new AsyncFunction('Inputs', 'Outputs', 'XGENIA', 'Component', wrappedScript);
        } else {
          // For scripts without await, use the original approach
          func = new AsyncFunction(
            'Inputs',
            'Outputs',
            'XGENIA',
            'Component',
            JavascriptNodeParser.getCodePrefix() + script
          );
        }
      } catch (e) {
        console.log('Error while parsing action script: ' + e);
      }

      return func;
    },
    _isSignalType: function (name) {
      // This will catch signals in script that may not have been delivered by the editor yet
      return this.model.outputPorts[name] && this.model.outputPorts[name].type === 'signal';
    },
    registerInputIfNeeded: function (name) {
      if (this.hasInput(name)) {
        return;
      }

      if (name.startsWith('in-')) {
        const n = name.substring('in-'.length);

        const input = {
          set: this.setScriptInputValue.bind(this, n)
        };

        //make sure we register the type as well, so XGENIA resolves types like color styles to an actual color
        if (this.model && this.model.parameters['intype-' + n]) {
          input.type = this.model.parameters['intype-' + n];
        }

        this.registerInput(name, input);
      }

      if (name.startsWith('intype-')) {
        const n = name.substring('intype-'.length);

        this.registerInput(name, {
          set(value) {
            //make sure we register the type as well, so XGENIA resolves types like color styles to an actual color
            if (this.hasInput('in' + n)) {
              this.getInput('in' + n).type = value;
            }
          }
        });
      }

      if (name.startsWith('outtype-')) {
        this.registerInput(name, {
          set() { } // Ignore
        });
      }
    },
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name)) {
        return;
      }

      if (name.startsWith('out-'))
        return this.registerOutput(name, {
          getter: this.getScriptOutputValue.bind(this, name.substring('out-'.length))
        });
    }
  }
};

function _parseScriptForErrorsAndPorts(script, name, node, context, ports) {
  // Clear run warnings if the script is edited
  context.editorConnection.clearWarning(node.component.name, node.id, 'js-function-run-waring');

  if (script === undefined) {
    context.editorConnection.clearWarning(node.component.name, node.id, 'js-function-parse-waring');
    return;
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;

    // Check if the script contains await statements
    const hasAwait = /\bawait\b/.test(script);

    if (hasAwait) {
      // Wrap the script in an async function to properly handle await statements
      const wrappedScript = `
        (async function() {
          ${script}
        })();
      `;
      new AsyncFunction('Inputs', 'Outputs', 'XGENIA', 'Component', wrappedScript);
    } else {
      // For scripts without await, use the original approach
      new AsyncFunction('Inputs', 'Outputs', 'XGENIA', 'Component', script);
    }

    context.editorConnection.clearWarning(node.component.name, node.id, 'js-function-parse-waring');
  } catch (e) {
    context.editorConnection.sendWarning(node.component.name, node.id, 'js-function-parse-waring', {
      showGlobally: true,
      message: e.message
    });
  }

  JavascriptNodeParser.parseAndAddPortsFromScript(script, ports, {
    inputPrefix: 'in-',
    outputPrefix: 'out-'
  });
}

const inputTypeEnums = [
  {
    value: 'string',
    label: 'String'
  },
  {
    value: 'boolean',
    label: 'Boolean'
  },
  {
    value: 'number',
    label: 'Number'
  },
  {
    value: 'object',
    label: 'Object'
  },
  {
    value: 'date',
    label: 'Date'
  },
  {
    value: 'array',
    label: 'Array'
  },
  {
    value: 'color',
    label: 'Color'
  }
];

module.exports = {
  node: SimpleJavascriptNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    function _managePortsForNode(node) {
      function _updatePorts() {
        var ports = [];

        const _outputTypeEnums = inputTypeEnums.concat([
          {
            value: 'signal',
            label: 'Signal'
          }
        ]);

        let rawOutputs = node.parameters['scriptOutputs'];
        let rawInputs = node.parameters['scriptInputs'];

        let outputs = [];
        let inputs = [];

        try {
          if (typeof rawOutputs === 'string') rawOutputs = JSON.parse(rawOutputs);
          if (Array.isArray(rawOutputs)) outputs = rawOutputs;
          else if (rawOutputs && rawOutputs.length > 0) outputs = Array.from(rawOutputs);
        } catch (e) { }

        try {
          if (typeof rawInputs === 'string') rawInputs = JSON.parse(rawInputs);
          if (Array.isArray(rawInputs)) inputs = rawInputs;
          else if (rawInputs && rawInputs.length > 0) inputs = Array.from(rawInputs);
        } catch (e) { }

        // Outputs
        if (outputs.length > 0) {
          outputs.forEach((p) => {
            if (!p || !p.label) return;
            // Type for output
            ports.push({
              name: 'outtype-' + p.label,
              displayName: 'Type',
              editorName: p.label + ' | Type',
              plug: 'input',
              type: {
                name: 'enum',
                enums: _outputTypeEnums,
                allowEditOnly: true
              },
              default: 'string',
              parent: 'scriptOutputs',
              parentItemId: p.id
            });

            // Value for output
            ports.push({
              name: 'out-' + p.label,
              displayName: p.label,
              plug: 'output',
              type: node.parameters['outtype-' + p.label] || '*',
              group: 'Outputs'
            });
          });
        }

        // Inputs
        if (inputs.length > 0) {
          inputs.forEach((p) => {
            if (!p || !p.label) return;
            // Type for input
            ports.push({
              name: 'intype-' + p.label,
              displayName: 'Type',
              editorName: p.label + ' | Type',
              plug: 'input',
              type: {
                name: 'enum',
                enums: inputTypeEnums,
                allowEditOnly: true
              },
              default: 'string',
              parent: 'scriptInputs',
              parentItemId: p.id
            });

            // Default Value for input
            ports.push({
              name: 'in-' + p.label,
              displayName: p.label,
              plug: 'input',
              type: node.parameters['intype-' + p.label] || 'string',
              group: 'Inputs'
            });
          });
        }

        _parseScriptForErrorsAndPorts(node.parameters['functionScript'], 'Script ', node, context, ports);

        // Push output ports that are signals directly to the model, it's needed by the initial run of
        // the script function
        ports.forEach((p) => {
          if (p.type === 'signal' && p.plug === 'output') {
            node.outputPorts[p.name] = p;
          }
        });

        context.editorConnection.sendDynamicPorts(node.id, ports);
      }

      _updatePorts();
      node.on('parameterUpdated', function (ev) {
        _updatePorts();
      });
    }

    graphModel.on('editorImportComplete', () => {
      graphModel.on('nodeAdded.JavaScriptFunction', function (node) {
        _managePortsForNode(node);
      });

      for (const node of graphModel.getNodesWithType('JavaScriptFunction')) {
        _managePortsForNode(node);
      }
    });
  }
};
