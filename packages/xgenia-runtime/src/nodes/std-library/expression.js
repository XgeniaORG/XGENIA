'use strict';

const difference = require('lodash.difference');
// (2026-09-22, export 1790026115336) Called from the run-time catch below but never imported —
// so a failing expression threw a SECOND error, `ReferenceError: logJavaScriptNodeError is not
// defined`, from inside its own handler, and the editorConnection.sendWarning that follows was
// never reached. The real error only ever reached the browser console.
const { logJavaScriptNodeError } = require('../../utils');

//const Model = require('./data/model');

const ExpressionNode = {
  name: 'Expression',
  docs: 'https://docsapp.xgenia.com/nodes/math/expression',
  usePortAsLabel: 'expression',
  category: 'CustomCode',
  color: 'javascript',
  nodeDoubleClickAction: {
    focusPort: 'Expression'
  },
  searchTags: ['javascript'],
  initialize: function () {
    var internal = this._internal;

    internal.scope = {};
    internal.hasScheduledEvaluation = false;

    internal.code = undefined;
    internal.cachedValue = 0;
    internal.currentExpression = '';
    internal.compiledFunction = undefined;
    internal.inputNames = [];
    internal.inputValues = [];
  },
  getInspectInfo() {
    return this._internal.cachedValue;
  },
  inputs: {
    expression: {
      group: 'General',
      inputPriority: 1,
      type: {
        name: 'string',
        allowEditOnly: true,
        codeeditor: 'javascript'
      },
      displayName: 'Expression',
      set: function (value) {
        var internal = this._internal;
        internal.currentExpression = functionPreamble + 'return (' + value + ');';
        internal.compiledFunction = undefined;

        var newInputs = parsePorts(value);

        var inputsToAdd = difference(newInputs, internal.inputNames);
        var inputsToRemove = difference(internal.inputNames, newInputs);

        var self = this;
        inputsToRemove.forEach(function (name) {
          self.deregisterInput(name);
          delete internal.scope[name];
        });

        inputsToAdd.forEach(function (name) {
          if (self.hasInput(name)) {
            return;
          }

          self.registerInput(name, {
            set: function (value) {
              internal.scope[name] = value;
              if (!this.isInputConnected('run')) this._scheduleEvaluateExpression();
            }
          });

          internal.scope[name] = 0;
          self._inputValues[name] = 0;
        });

        /*      if(value.indexOf('Vars') !== -1 || value.indexOf('Variables') !== -1)  {
                    // This expression is using variables, it should listen for changes
                    this._internal.onVariablesChangedCallback = (args) => {
                        this._scheduleEvaluateExpression()
                    }

                    Model.get('--ndl--global-variables').off('change',this._internal.onVariablesChangedCallback)
                    Model.get('--ndl--global-variables').on('change',this._internal.onVariablesChangedCallback)
                }*/

        internal.inputNames = Object.keys(internal.scope);
        if (!this.isInputConnected('run')) this._scheduleEvaluateExpression();
      }
    },
    run: {
      group: 'Actions',
      displayName: 'Run',
      type: 'signal',
      valueChangedToTrue: function () {
        this._scheduleEvaluateExpression();
      }
    }
  },
  outputs: {
    result: {
      group: 'Result',
      type: '*',
      displayName: 'Result',
      getter: function () {
        if (!this._internal.currentExpression) {
          return 0;
        }

        return this._internal.cachedValue;
      }
    },
    isTrue: {
      group: 'Result',
      type: 'boolean',
      displayName: 'Is True',
      getter: function () {
        if (!this._internal.currentExpression) {
          return false;
        }

        return !!this._internal.cachedValue;
      }
    },
    isFalse: {
      group: 'Result',
      type: 'boolean',
      displayName: 'Is False',
      getter: function () {
        if (!this._internal.currentExpression) {
          return true;
        }

        return !this._internal.cachedValue;
      }
    },
    isTrueEv: {
      group: 'Events',
      type: 'signal',
      displayName: 'On True'
    },
    isFalseEv: {
      group: 'Events',
      type: 'signal',
      displayName: 'On False'
    }
  },
  prototypeExtensions: {
    registerInputIfNeeded: {
      value: function (name) {
        if (this.hasInput(name)) {
          return;
        }

        this._internal.scope[name] = 0;
        this._inputValues[name] = 0;

        this.registerInput(name, {
          set: function (value) {
            this._internal.scope[name] = value;
            if (!this.isInputConnected('run')) this._scheduleEvaluateExpression();
          }
        });
      }
    },
    _scheduleEvaluateExpression: {
      value: function () {
        var internal = this._internal;
        if (internal.hasScheduledEvaluation === false) {
          internal.hasScheduledEvaluation = true;
          this.flagDirty();
          this.scheduleAfterInputsHaveUpdated(function () {
            var lastValue = internal.cachedValue;
            internal.cachedValue = this._calculateExpression();
            if (lastValue !== internal.cachedValue) {
              this.flagOutputDirty('result');
              this.flagOutputDirty('isTrue');
              this.flagOutputDirty('isFalse');
            }
            if (internal.cachedValue) this.sendSignalOnOutput('isTrueEv');
            else this.sendSignalOnOutput('isFalseEv');
            internal.hasScheduledEvaluation = false;
          });
        }
      }
    },
    _calculateExpression: {
      value: function () {
        var internal = this._internal;

        if (!internal.compiledFunction) {
          internal.compiledFunction = this._compileFunction();
        }
        for (var i = 0; i < internal.inputNames.length; ++i) {
          var inputValue = internal.scope[internal.inputNames[i]];
          internal.inputValues[i] = inputValue;
        }
        try {
          const expression = this._internal.currentExpression; // Get expression for logging
          console.log(`[Expression RUN] Node ID: ${this.id}, About to evaluate expression:`, expression);
          const result = internal.compiledFunction.apply(null, internal.inputValues);
          console.log(`[Expression RUN] Node ID: ${this.id}, Evaluation result:`, result);
          return result;
        } catch (e) {
          console.error(`[Expression ERROR] Node ID: ${this.id}, Expression:`, this._internal.currentExpression, 'Error:', e);
          logJavaScriptNodeError(e); // Use existing helper for better formatting if needed

          // Re-send warning to editor if possible
          if (this.context.editorConnection && this.context.isWarningTypeEnabled('javascriptExecution')) {
             this.context.editorConnection.sendWarning(
               this.nodeScope.componentOwner.name,
               this.id,
               'expression-run-waring', // New warning key for runtime error
               {
                 showGlobally: true,
                 message: e.message,
                 stack: e.stack
               }
             );
           }
        }
        return 0; // Return default value on error
      }
    },
    _compileFunction: {
      value: function () {
        var expression = this._internal.currentExpression;
        var args = Object.keys(this._internal.scope);

        var key = expression + args.join(' ');

        if (compiledFunctionsCache.hasOwnProperty(key) === false) {
          args.push(expression);

          try {
            compiledFunctionsCache[key] = construct(Function, args);
          } catch (e) {
            console.error('Failed to compile JS function', e.message);
          }
        }
        return compiledFunctionsCache[key];
      }
    }
  }
};

var functionPreamble = [
  'var min = Math.min,' +
    '    max = Math.max,' +
    '    cos = Math.cos,' +
    '    sin = Math.sin,' +
    '    tan = Math.tan,' +
    '    sqrt = Math.sqrt,' +
    '    pi = Math.PI,' +
    '    round = Math.round,' +
    '    floor = Math.floor,' +
    '    ceil = Math.ceil,' +
    '    abs = Math.abs,' +
    '    random = Math.random;'
  /* '    Vars = Variables = XGENIA.Object.get("--ndl--global-variables");' */
].join('');

//Since apply cannot be used on constructors (i.e. new Something) we need this hax
//see http://stackoverflow.com/questions/1606797/use-of-apply-with-new-operator-is-this-possible
function construct(constructor, args) {
  function F() {
    return constructor.apply(this, args);
  }
  F.prototype = constructor.prototype;
  return new F();
}

var compiledFunctionsCache = {};

// Names that must NOT become input ports. Every identifier in the expression becomes a parameter
// of the compiled Function, and an unwired parameter is `undefined` — so a name on this list is
// left alone, and a name missing from it SHADOWS the real thing. (2026-09-22, export
// 1790026115336) `Date.now()` compiled to `Function('Date', 'return (Date.now())')`, the node
// grew a phantom `Date` input, and the engine reported `TypeError: Date.now is not a function`
// — an impossible fact in JavaScript, which the AI then chased for an hour. `Math.random()` only
// ever worked because 'Math' happened to be listed. The standard globals, the language keywords
// and the literals are now all exempt; a port is something the author's expression names that
// JavaScript itself does not already provide.
var portsToIgnore = [
  // The preamble's Math aliases (functionPreamble below).
  'min', 'max', 'cos', 'sin', 'tan', 'sqrt', 'pi', 'round', 'floor', 'ceil', 'abs', 'random',
  // Host objects and the historical exemptions.
  'Math', 'window', 'document', 'undefined', 'Vars', 'true', 'false', 'null', 'Boolean',
  'globalThis', 'self', 'console', 'XGENIA',
  // ECMAScript standard globals.
  'Date', 'JSON', 'Number', 'String', 'Array', 'Object', 'RegExp', 'Symbol', 'BigInt', 'Map', 'Set',
  'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError', 'RangeError', 'Function', 'Reflect',
  'Proxy', 'Intl', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  // Reserved words — a reserved parameter name is a SyntaxError in the compiled Function, so none
  // of these ever worked as a port. (Contextual names such as `of`, `let`, `async` are valid
  // identifiers and are deliberately NOT listed: an author may have a port called that.)
  'typeof', 'instanceof', 'in', 'new', 'void', 'delete', 'this',
  'if', 'else', 'return', 'var', 'const', 'function', 'for', 'while', 'do', 'switch',
  'case', 'break', 'continue', 'default', 'throw', 'try', 'catch', 'finally', 'class'
];

function parsePorts(expression) {
  var ports = [];

  function addPort(name) {
    if (portsToIgnore.indexOf(name) !== -1) return;
    if (
      ports.some(function (p) {
        return p === name;
      })
    )
      return;

    ports.push(name);
  }

  // First remove all strings
  expression = expression.replace(/\"([^\"]*)\"/g, '').replace(/\'([^\']*)\'/g, '');

  // Extract identifiers
  var identifiers = expression.matchAll(/[a-zA-Z\_\$][a-zA-Z0-9\.\_\$]*/g);
  for (const _id of identifiers) {
    var name = _id[0];
    if (name.indexOf('.') !== -1) {
      name = name.split('.')[0]; // Take first symbol on "." sequence
    }

    addPort(name);
  }

  return ports;
}

function updatePorts(nodeId, expression, editorConnection) {
  var portNames = parsePorts(expression);

  var ports = portNames.map(function (name) {
    return {
      group: 'Parameters',
      name: name,
      type: {
        name: '*',
        editAsType: 'string'
      },
      plug: 'input'
    };
  });

  editorConnection.sendDynamicPorts(nodeId, ports);
}

function evalCompileWarnings(editorConnection, node) {
  try {
    new Function(node.parameters.expression);
    editorConnection.clearWarning(node.component.name, node.id, 'expression-compile-error');
  } catch (e) {
    editorConnection.sendWarning(node.component.name, node.id, 'expression-compile-error', {
      message: e.message
    });
  }
}

module.exports = {
  node: ExpressionNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    graphModel.on('nodeAdded.Expression', function (node) {
      if (node.parameters.expression) {
        updatePorts(node.id, node.parameters.expression, context.editorConnection);
        evalCompileWarnings(context.editorConnection, node);
      }
      node.on('parameterUpdated', function (event) {
        if (event.name === 'expression') {
          updatePorts(node.id, node.parameters.expression, context.editorConnection);
          evalCompileWarnings(context.editorConnection, node);
        }
      });
    });
  }
};
