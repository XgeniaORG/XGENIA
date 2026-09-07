/**
 * Standard Library Node Converter for XGENIA Cloud Functions
 *
 * This module provides conversion logic for standard library nodes like:
 * - Logic nodes (If, Condition, Inverter)
 * - Utility nodes (BooleanToString, DateToString)
 * - String manipulation nodes
 * - Data conversion nodes
 */

import { Node } from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Standard library node conversion result
 */
export interface StdLibraryNodeResult {
  functionName: string;
  functionDefinition: string;
  inputMapping: string;
  outputMapping: string;
  calculationLogic: string;
  nodeType: string;
  isStateful: boolean;
}

/**
 * Standard library node configuration
 */
export interface StdLibraryNodeConfig {
  nodeType: string;
  inputPorts: string[];
  outputPorts: string[];
  defaultValues: Record<string, any>;
  calculationMethod: string;
  isStateful: boolean;
  category: 'logic' | 'utility' | 'string' | 'conversion' | 'variables' | 'data' | 'state';
}

// ============================================================================
// STANDARD LIBRARY NODE CONVERTER
// ============================================================================

/**
 * Main converter for standard library nodes
 */
export class StdLibraryNodeConverter {
  /**
   * Check if a node type is a standard library node
   */
  public isStdLibraryNode(nodeType: string): boolean {
    const stdLibraryNodes = [
      'If',
      'Condition',
      'Inverter',
      'Boolean To String',
      'Date To String',
      'String To Number',
      'Number To String',
      'Array To String',
      'String To Array',
      'Object To String',
      'String To Object',
      'JSON Parse',
      'JSON Stringify',
      'Boolean',
      'String',
      'Number',
      // New high-priority nodes
      'Switch',
      'Counter',
      'Static Data',
      'Expression',
      'Color',
      'Loop',
      'Signal Pass Through',
      'Simple JavaScript',
      'Array State Manager',
      'State Manager',
      'REST2',
      'REST',
      'DbConfig',
      'NewDbModelProperties',
      'DbCollection2',
      'DeleteDbModelProperties',
      // Signal/Event flow nodes
      'Boolean To Signal',
      'Value Changed',
      'States',
      'Timer',
      'Event Sender',
      'Event Receiver',
      'CloudFunction2'
    ];
    return stdLibraryNodes.includes(nodeType);
  }

  /**
   * Convert a standard library node to Supabase Edge Function code
   */
  public convertStdLibraryNode(node: Node, functionName: string): StdLibraryNodeResult {
    const nodeType = node.typename;

    switch (nodeType) {
      case 'If':
        return this.convertIfNode(node, functionName);
      case 'Condition':
        return this.convertConditionNode(node, functionName);
      case 'Inverter':
        return this.convertInverterNode(node, functionName);
      case 'Boolean To String':
        return this.convertBooleanToStringNode(node, functionName);
      case 'Date To String':
        return this.convertDateToStringNode(node, functionName);
      case 'Boolean':
        return this.convertBooleanNode(node, functionName);
      case 'String':
        return this.convertStringNode(node, functionName);
      case 'Number':
        return this.convertNumberNode(node, functionName);
      case 'Switch':
        return this.convertSwitchNode(node, functionName);
      case 'Counter':
        return this.convertCounterNode(node, functionName);
      case 'Static Data':
        return this.convertStaticDataNode(node, functionName);
      case 'Expression':
        return this.convertExpressionNode(node, functionName);
      case 'Color':
        return this.convertColorNode(node, functionName);
      case 'Loop':
        return this.convertLoopNode(node, functionName);
      case 'State Manager':
        return this.convertStateManagerNode(node, functionName);
      case 'Array State Manager':
        return this.convertArrayStateManagerNode(node, functionName);
      case 'REST2':
      case 'REST':
        return this.convertRestNode(node, functionName);
      case 'DbConfig':
        return this.convertDbConfigNode(node, functionName);
      case 'NewDbModelProperties':
        return this.convertNewDbModelPropertiesNode(node, functionName);
      case 'DbCollection2':
        return this.convertDbCollection2Node(node, functionName);
      case 'DeleteDbModelProperties':
        return this.convertDeleteDbModelPropertiesNode(node, functionName);
      case 'Boolean To Signal':
        return this.convertBooleanToSignalNode(node, functionName);
      case 'Value Changed':
        return this.convertValueChangedNode(node, functionName);
      case 'States':
        return this.convertStatesNode(node, functionName);
      case 'Timer':
        return this.convertTimerNode(node, functionName);
      case 'Event Sender':
        return this.convertEventSenderNode(node, functionName);
      case 'Event Receiver':
        return this.convertEventReceiverNode(node, functionName);
      case 'CloudFunction2':
        return this.convertCloudFunction2Node(node, functionName);
      default:
        return this.convertUnknownStdLibraryNode(node, functionName);
    }
  }

  /**
   * Convert If node
   */
  private convertIfNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { input } = inputs;
  
  // If node logic - evaluates boolean input immediately (no do signal required in cloud functions)
  let trueCondition = false;
  let falseCondition = false;
  
  if (input === true) {
    trueCondition = true;
  } else if (input === false) {
    falseCondition = true;
  }
  
  return { trueCondition, falseCondition };
};`,
      inputMapping: 'input',
      outputMapping: 'trueCondition, falseCondition',
      calculationLogic: 'Conditional logic evaluation',
      nodeType: 'If',
      isStateful: false
    };
  }

  /**
   * Convert Condition node
   */
  private convertConditionNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { condition, eval: evalSignal } = inputs;
  
  // Condition node logic
  const result = !!condition;
  const isfalse = !condition;
  
  let ontrue = false;
  let onfalse = false;
  
  if (evalSignal) {
    if (condition) {
      ontrue = true;
    } else {
      onfalse = true;
    }
  }
  
  return { result, isfalse, ontrue, onfalse };
};`,
      inputMapping: 'condition, eval',
      outputMapping: 'result, isfalse, ontrue, onfalse',
      calculationLogic: 'Boolean condition evaluation',
      nodeType: 'Condition',
      isStateful: false
    };
  }

  /**
   * Convert Inverter node
   */
  private convertInverterNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { value } = inputs;
  
  // Inverter node logic - inverts boolean value
  const result = value === undefined ? undefined : !value;
  
  return { result };
};`,
      inputMapping: 'value',
      outputMapping: 'result',
      calculationLogic: 'Boolean inversion',
      nodeType: 'Inverter',
      isStateful: false
    };
  }

  /**
   * Convert Boolean To String node
   */
  private convertBooleanToStringNode(node: Node, functionName: string): StdLibraryNodeResult {
    const trueString = node.parameters.trueString || 'true';
    const falseString = node.parameters.falseString || 'false';

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { input, trueString, falseString } = inputs;
  
  // Boolean To String node logic
  const currentValue = input ? (trueString || 'true') : (falseString || 'false');
  const inputChanged = true; // Signal that input changed
  
  return { currentValue, inputChanged };
};`,
      inputMapping: 'input, trueString, falseString',
      outputMapping: 'currentValue, inputChanged',
      calculationLogic: `Boolean to string conversion (true: "${trueString}", false: "${falseString}")`,
      nodeType: 'Boolean To String',
      isStateful: false
    };
  }

  /**
   * Convert Date To String node
   */
  private convertDateToStringNode(node: Node, functionName: string): StdLibraryNodeResult {
    const formatString = node.parameters.formatString || '{year}-{month}-{date}';

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { input, formatString } = inputs;
  
  // Date To String node logic
  let currentValue = '';
  let inputChanged = false;
  let onError = false;
  
  try {
    if (input) {
      const date = typeof input === 'string' ? new Date(input) : input;
      
      if (isNaN(date.getTime())) {
        throw new Error('Invalid date');
      }
      
      const format = formatString || '{year}-{month}-{date}';
      const dateStr = ('0' + date.getDate()).slice(-2);
      const month = ('0' + (date.getMonth() + 1)).slice(-2);
      const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date);
      const year = date.getFullYear();
      const yearShort = year.toString().substring(2);
      const hours = ('0' + date.getHours()).slice(-2);
      const minutes = ('0' + date.getMinutes()).slice(-2);
      const seconds = ('0' + date.getSeconds()).slice(-2);
      
      currentValue = format
        .replace(/\\{date\\}/g, dateStr)
        .replace(/\\{month\\}/g, month)
        .replace(/\\{monthShort\\}/g, monthShort)
        .replace(/\\{year\\}/g, year)
        .replace(/\\{yearShort\\}/g, yearShort)
        .replace(/\\{hours\\}/g, hours)
        .replace(/\\{minutes\\}/g, minutes)
        .replace(/\\{seconds\\}/g, seconds);
      
      inputChanged = true;
    }
  } catch (error: any) {
    currentValue = '';
    onError = true;
  }
  
  return { currentValue, inputChanged, onError };
};`,
      inputMapping: 'input, formatString',
      outputMapping: 'currentValue, inputChanged, onError',
      calculationLogic: `Date to string conversion (format: "${formatString}")`,
      nodeType: 'Date To String',
      isStateful: false
    };
  }

  /**
   * Convert Boolean variable node
   */
  private convertBooleanNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { value, saveValue } = inputs;
  
  // Boolean variable node logic
  let currentValue = false;
  let changed = false;
  let stored = false;
  
  if (saveValue) {
    currentValue = Boolean(value);
    stored = true;
  } else if (value !== undefined) {
    currentValue = Boolean(value);
    changed = true;
  }
  
  return { savedValue: currentValue, changed, stored };
};`,
      inputMapping: 'value, saveValue',
      outputMapping: 'savedValue, changed, stored',
      calculationLogic: 'Boolean variable storage and change detection',
      nodeType: 'Boolean',
      isStateful: true
    };
  }

  /**
   * Convert String variable node
   */
  private convertStringNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { value, saveValue } = inputs;
  
  // String variable node logic
  let currentValue = '';
  let changed = false;
  let stored = false;
  let length = 0;
  
  if (saveValue) {
    currentValue = String(value || '');
    length = currentValue.length;
    stored = true;
  } else if (value !== undefined) {
    currentValue = String(value || '');
    length = currentValue.length;
    changed = true;
  }
  
  return { savedValue: currentValue, changed, stored, length };
};`,
      inputMapping: 'value, saveValue',
      outputMapping: 'savedValue, changed, stored, length',
      calculationLogic: 'String variable storage, change detection, and length calculation',
      nodeType: 'String',
      isStateful: true
    };
  }

  /**
   * Convert Number variable node
   */
  private convertNumberNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { value, saveValue } = inputs;
  
  // Number variable node logic
  let currentValue = 0;
  let changed = false;
  let stored = false;
  
  if (saveValue) {
    currentValue = Number(value) || 0;
    stored = true;
  } else if (value !== undefined) {
    currentValue = Number(value) || 0;
    changed = true;
  }
  
  return { savedValue: currentValue, changed, stored };
};`,
      inputMapping: 'value, saveValue',
      outputMapping: 'savedValue, changed, stored',
      calculationLogic: 'Number variable storage and change detection',
      nodeType: 'Number',
      isStateful: true
    };
  }

  /**
   * Convert Switch node
   */
  private convertSwitchNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { on, off, flip, onFromStart } = inputs;
  
  // Switch node logic - toggle state management
  let state = false;
  let switched = false;
  let switchedToOn = false;
  let switchedToOff = false;
  
  // Handle state changes
  if (on) {
    if (!state) {
      state = true;
      switched = true;
      switchedToOn = true;
    }
  } else if (off) {
    if (state) {
      state = false;
      switched = true;
      switchedToOff = true;
    }
  } else if (flip) {
    state = !state;
    switched = true;
    if (state) {
      switchedToOn = true;
    } else {
      switchedToOff = true;
    }
  } else if (onFromStart !== undefined) {
    const newState = !!onFromStart;
    if (newState !== state) {
      state = newState;
      switched = true;
      if (state) {
        switchedToOn = true;
      } else {
        switchedToOff = true;
      }
    }
  }
  
  return { state, switched, switchedToOn, switchedToOff };
};`,
      inputMapping: 'on, off, flip, onFromStart',
      outputMapping: 'state, switched, switchedToOn, switchedToOff',
      calculationLogic: 'Toggle state management with signal outputs',
      nodeType: 'Switch',
      isStateful: true
    };
  }

  /**
   * Convert Counter node.
   *
   * The generated function was written against ports the node does not have.
   * The real node (nodes/std-library/counter.js) takes `increase` / `decrease` /
   * `reset` signals plus `startValue` and the `limits*` group, and outputs
   * `currentCount` / `countChanged` — this emitted `increment` / `decrement` /
   * `setValue` and returned `count` / `changed` / `reachedMax` / `reachedMin`.
   * Not one name lined up, so a compiled Counter read nothing from its wires and
   * every downstream read of `currentCount` was undefined. No deployed component
   * used one (0 of the 128 live on 2026-09-03), which is why it went unnoticed.
   *
   * It also declared itself stateful while starting from `startValue` on every
   * call. It now carries `currentCount` through the `ctx.state.__nodes` channel
   * (see STATE_CHANNEL_NODE_TYPES in supabase-converter.ts), which makes it the
   * game-type-agnostic accumulator: a pot, a meter, a streak, a rolling count.
   *
   * The compiled script has no signal engine — every node's function runs once
   * per round — so a signal input is read as "did this fire this round", which
   * is the same translation the slot converter applies to its `reset` ports.
   */
  private convertCounterNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { increase, decrease, reset, startValue, limitsEnabled, limitsMin, limitsMax } = inputs;

  const start = Number(startValue) || 0;
  const min = Number(limitsMin) || 0;
  const max = Number(limitsMax) || 0;
  const limited = !!limitsEnabled;

  // Resume where the previous round left off. Absent state (round 1, or a
  // caller that does not persist state) starts from startValue.
  const prior = inputs.state && typeof inputs.state === 'object' ? inputs.state : {};
  let currentCount = typeof prior.currentCount === 'number' ? prior.currentCount : start;
  let countChanged = false;

  if (reset) {
    currentCount = start;
    countChanged = true;
  }
  if (increase && !(limited && currentCount >= max)) {
    currentCount++;
    countChanged = true;
  }
  if (decrease && !(limited && currentCount <= min)) {
    currentCount--;
    countChanged = true;
  }

  return { currentCount, countChanged, updatedState: { currentCount } };
};`,
      inputMapping: 'increase, decrease, reset, startValue, limitsEnabled, limitsMin, limitsMax',
      outputMapping: 'currentCount, countChanged',
      calculationLogic: 'Counting operations with increase/decrease/reset, persisted across rounds',
      nodeType: 'Counter',
      isStateful: true
    };
  }

  /**
   * Convert Static Data node
   */
  private convertStaticDataNode(node: Node, functionName: string): StdLibraryNodeResult {
    const dataType = node.parameters.type || 'csv';
    const csvData = node.parameters.csv || '';
    const jsonData = node.parameters.json || '[]';

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { type, csv, json } = inputs;
  
  // Static Data node logic - static data storage
  let items = [];
  let count = 0;
  
  try {
    if (type === 'json' || type === undefined) {
      // Parse JSON data
      const jsonString = json || '${jsonData}';
      items = JSON.parse(jsonString);
    } else if (type === 'csv') {
      // Parse CSV data
      const csvString = csv || '${csvData}';
      const lines = csvString.split('\\n').filter(line => line.trim());
      if (lines.length > 0) {
        const headers = lines[0].split(',').map(h => h.trim());
        items = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim());
          const obj = {};
          headers.forEach((header, index) => {
            obj[header] = values[index] || '';
          });
          return obj;
        });
      }
    }
    
    count = items.length;
  } catch (error: any) {
    items = [];
    count = 0;
  }
  
  return { items, count };
};`,
      inputMapping: 'type, csv, json',
      outputMapping: 'items, count',
      calculationLogic: `Static data storage (type: ${dataType})`,
      nodeType: 'Static Data',
      isStateful: false
    };
  }

  /**
   * Convert Expression node
   */
  private convertExpressionNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const exprSource = String(inputs.expression || '0');

  // Build scope from all inputs except reserved keys
  const scope: Record<string, any> = {};
  Object.keys(inputs).forEach((key) => {
    if (key === 'expression' || key === 'requestBody') return;
    scope[key] = inputs[key];
  });

  const argNames = Object.keys(scope);
  const argValues = argNames.map((k) => scope[k]);

  let result: any = 0;
  let error = false;

  try {
    // Math preamble similar to local node
    const preamble = \`const min=Math.min,max=Math.max,cos=Math.cos,sin=Math.sin,tan=Math.tan,sqrt=Math.sqrt,pi=Math.PI,round=Math.round,floor=Math.floor,ceil=Math.ceil,abs=Math.abs,random=Math.random;\`;
    const body = \`\${preamble} return ( \${exprSource} );\`;
    const fn = new Function(...argNames, body) as (...args: any[]) => any;
    result = fn(...argValues);
  } catch (e: any) {
    result = 0;
    error = true;
  }

  const isTrue = !!result;
  const isFalse = !isTrue;
  return { result, isTrue, isFalse, error };
};`,
      inputMapping: 'expression, ...vars',
      outputMapping: 'result, isTrue, isFalse, error',
      calculationLogic: 'Mathematical expression evaluation with dynamic inputs',
      nodeType: 'Expression',
      isStateful: false
    };
  }

  /**
   * Convert Color node
   */
  private convertColorNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { value, saveValue } = inputs;
  
  // Color variable node logic
  let currentValue = '#000000';
  let changed = false;
  let stored = false;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 1;
  
  if (saveValue) {
    currentValue = String(value || '#000000');
    stored = true;
  } else if (value !== undefined) {
    currentValue = String(value || '#000000');
    changed = true;
  }
  
  // Parse color components
  try {
    if (currentValue.startsWith('#')) {
      const hex = currentValue.slice(1);
      if (hex.length === 3) {
        r = parseInt(hex[0] + hex[0], 16) / 255;
        g = parseInt(hex[1] + hex[1], 16) / 255;
        b = parseInt(hex[2] + hex[2], 16) / 255;
      } else if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16) / 255;
        g = parseInt(hex.slice(2, 4), 16) / 255;
        b = parseInt(hex.slice(4, 6), 16) / 255;
      }
    }
  } catch (error: any) {
    r = 0; g = 0; b = 0; a = 1;
  }
  
  return { savedValue: currentValue, changed, stored, r, g, b, a };
};`,
      inputMapping: 'value, saveValue',
      outputMapping: 'savedValue, changed, stored, r, g, b, a',
      calculationLogic: 'Color variable storage with RGB components',
      nodeType: 'Color',
      isStateful: true
    };
  }

  /**
   * Convert Loop node (simplified for cloud functions)
   * Note: This is a simplified version that executes the loop in a single call
   * rather than maintaining state between iterations
   */
  private convertLoopNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { do: doSignal, next, index, steps, lessThan, moreThan } = inputs;
  
  // Simplified Loop node logic for cloud functions
  // Executes the entire loop in a single call rather than maintaining state
  let currentIndex = index || 0;
  let indexUpdated = false;
  let done = false;
  
  if (doSignal) {
    // Reset to initial index
    currentIndex = index || 0;
    indexUpdated = true;
    
    // Execute the loop logic in a single pass
    const stepValue = steps || 1;
    const lessThanValue = lessThan || 1;
    const moreThanValue = moreThan || -1;
    
    // Calculate final index based on loop conditions
    if (stepValue > 0) {
      // Positive steps: increment until lessThan
      while (currentIndex < lessThanValue) {
        currentIndex += stepValue;
        if (currentIndex >= lessThanValue) {
          done = true;
          break;
        }
      }
    } else if (stepValue < 0) {
      // Negative steps: decrement until moreThan
      while (currentIndex > moreThanValue) {
        currentIndex += stepValue;
        if (currentIndex <= moreThanValue) {
          done = true;
          break;
        }
      }
    }
  }
  
  return { index: currentIndex, currentIndex, indexUpdated, done: done };
};`,
      inputMapping: 'do, next, index, steps, lessThan, moreThan',
      outputMapping: 'index, currentIndex, indexUpdated, done',
      calculationLogic: 'Simplified loop execution for cloud functions (single-pass)',
      nodeType: 'Loop',
      isStateful: false
    };
  }

  /**
   * Convert State Manager node (simplified for cloud functions)
   * Note: This is a simplified version that processes inputs in a single call
   * rather than maintaining persistent state
   */
  private convertStateManagerNode(node: Node, functionName: string): StdLibraryNodeResult {
    const numInputs = node.parameters.numInputs || 3;

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { update, reset, numInputs, ...inputValues } = inputs;
  
  // Simplified State Manager node logic for cloud functions
  // Processes inputs in a single call rather than maintaining state
  let updated = false;
  let resetDone = false;
  let stateObject = null;
  let objectId = null;
  
  if (reset) {
    // Reset all outputs to null/empty
    const outputs = {};
    for (let i = 0; i < (numInputs || 3); i++) {
      outputs[\`output\${i}\`] = null;
    }
    resetDone = true;
    return { ...outputs, updated: false, resetDone: true, stateObject: null, objectId: null };
  }
  
  if (update) {
    // Process all inputs and create outputs
    const outputs = {};
    const stateData = { timestamp: new Date().toISOString() };
    
    for (let i = 0; i < (numInputs || 3); i++) {
      const inputName = \`input\${i}\`;
      const outputName = \`output\${i}\`;
      const aliasName = \`alias\${i}\`;
      
      const inputValue = inputValues[inputName];
      const aliasValue = inputValues[aliasName];
      
      // Set output value
      outputs[outputName] = inputValue;
      
      // Add to state object with alias if provided
      if (inputValue !== undefined) {
        const keyName = aliasValue && aliasValue.trim() !== '' ? aliasValue : \`input\${i}\`;
        stateData[keyName] = inputValue;
      }
    }
    
    // Create state object
    stateObject = stateData;
    objectId = Math.random().toString(36).substring(2, 15);
    updated = true;
    
    return { ...outputs, updated: true, resetDone: false, stateObject, objectId };
  }
  
  return { updated: false, resetDone: false, stateObject: null, objectId: null };
};`,
      inputMapping: `update, reset, numInputs, ${Array.from(
        { length: numInputs },
        (_, i) => `input${i}, alias${i}`
      ).join(', ')}`,
      outputMapping: `updated, resetDone, stateObject, objectId, ${Array.from(
        { length: numInputs },
        (_, i) => `output${i}`
      ).join(', ')}`,
      calculationLogic: `Simplified state management for cloud functions (${numInputs} inputs)`,
      nodeType: 'State Manager',
      isStateful: false
    };
  }

  /**
   * Convert Array State Manager node (simplified for cloud functions)
   * Note: This is a simplified version that processes arrays in a single call
   * rather than maintaining persistent array state
   */
  private convertArrayStateManagerNode(node: Node, functionName: string): StdLibraryNodeResult {
    const numInputs = node.parameters.numInputs || 3;

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs: Record<string, any>) => {
  const { update, reset, numInputs, ...inputValues } = inputs;
  
  // Simplified Array State Manager node logic for cloud functions
  // Processes arrays in a single call rather than maintaining persistent state
  let updated = false;
  let resetDone = false;
  
  if (reset) {
    // Reset all outputs to empty arrays
    const outputs = {};
    for (let i = 0; i < (numInputs || 3); i++) {
      outputs[\`output\${i}\`] = [];
    }
    resetDone = true;
    return { ...outputs, updated: false, resetDone: true };
  }
  
  if (update) {
    // Process all inputs and create array outputs
    const outputs = {};
    
    for (let i = 0; i < (numInputs || 3); i++) {
      const inputName = \`input\${i}\`;
      const outputName = \`output\${i}\`;
      
      const inputValue = inputValues[inputName];
      
      // For cloud functions, we'll create a single-item array
      // In a real implementation, you might want to accumulate from previous calls
      // but that would require external storage (database, cache, etc.)
      outputs[outputName] = inputValue !== undefined ? [inputValue] : [];
    }
    
    updated = true;
    return { ...outputs, updated: true, resetDone: false };
  }
  
  return { updated: false, resetDone: false };
};`,
      inputMapping: `update, reset, numInputs, ${Array.from(
        { length: numInputs },
        (_, i) => `input${i}, alias${i}`
      ).join(', ')}`,
      outputMapping: `updated, resetDone, ${Array.from({ length: numInputs }, (_, i) => `output${i}`).join(', ')}`,
      calculationLogic: `Simplified array state management for cloud functions (${numInputs} inputs)`,
      nodeType: 'Array State Manager',
      isStateful: false
    };
  }

  /**
   * Default scripts for cleaning purposes (from original REST node implementation)
   */
  private readonly defaultRequestScript =
    '//Add custom code to setup the request object before the request\n//is made.\n//\n' +
    '//*Request.resource     contains the resource path of the request.\n' +
    '//*Request.method       contains the method, GET, POST, PUT or DELETE.\n' +
    '//*Request.headers      is a map where you can add additional headers.\n' +
    '//*Request.parameters   is a map the parameters that will be appended\n' +
    '//                      to the url.\n' +
    '//*Request.content      contains the content of the request as a javascript\n' +
    '//                      object.\n//\n';
  private readonly defaultResponseScript =
    '// Add custom code to convert the response content to outputs\n' +
    '//\n' +
    '//*Response.status    The status code of the response\n' +
    '//*Response.content   The content of the response as a javascript\n' +
    '//                    object.\n' +
    '//*Response.request   The request object that resulted in the response.\n' +
    '//\n' +
    '//*Inputs and *Outputs contain the inputs and outputs of the node.\n';

  /**
   * Extracts the dynamic input and output ports from the node's configuration.
   * This is a refined version that uses Sets for better deduplication.
   */
  private extractRestNodePorts(node: Node): {
    inputs: Set<string>;
    outputs: Set<string>;
  } {
    const inputs = new Set<string>();
    const outputs = new Set<string>();

    // First, check if dynamicports are available (set by editor)
    if (node.dynamicports && node.dynamicports.length > 0) {
      node.dynamicports.forEach((port) => {
        if (port.plug === 'input' && port.name.startsWith('in-')) {
          const portName = port.displayName || port.name.replace('in-', '');
          inputs.add(portName);
        } else if (port.plug === 'output' && port.name.startsWith('out-')) {
          const portName = port.displayName || port.name.replace('out-', '');
          outputs.add(portName);
        }
      });
    }

    // Extract from resource path (e.g., /users/{userId})
    const resource = node.parameters.resource || '';
    const resourceMatches = resource.match(/\{([A-Za-z0-9_]+)\}/g);
    resourceMatches?.forEach((match) => inputs.add(match.replace(/[{}]/g, '')));

    // Combine scripts for a single pass
    const allScripts = (node.parameters.requestScript || '') + (node.parameters.responseScript || '');
    const scriptWithoutComments = allScripts.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');

    // Extract from Inputs.variable
    const inputMatches = scriptWithoutComments.match(/Inputs\.([A-Za-z0-9_]+)/g);
    inputMatches?.forEach((match) => inputs.add(match.replace('Inputs.', '')));

    // Extract from Outputs.variable
    const outputMatches = scriptWithoutComments.match(/Outputs\.([A-Za-z0-9_]+)/g);
    outputMatches?.forEach((match) => outputs.add(match.replace('Outputs.', '')));

    return { inputs, outputs };
  }

  /**
   * Cleans the default placeholder comments from user scripts.
   * Returns the script with comments removed, or a minimal placeholder if empty/default.
   * Preserves actual code while removing comment-only lines.
   */
  private sanitizeScript(script: string | undefined, defaultScript: string): string {
    if (!script || script.trim() === defaultScript.trim() || script.trim().length === 0) {
      return '// No script provided.';
    }
    // Remove comment-only lines but preserve code lines (even if they have inline comments)
    const lines = script.split('\n');
    const codeLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Keep lines that have actual code (not just comments)
      // A line is code if it's not empty and doesn't start with //
      return trimmed.length > 0 && !trimmed.startsWith('//');
    });
    // If we have actual code, return it; otherwise return placeholder
    return codeLines.length > 0 ? codeLines.join('\n').trim() : '// No script provided.';
  }

  /**
   * Transforms Outputs assignments to use bracket notation for consistency.
   * Converts Outputs.variable = to Outputs['variable'] =
   */
  private transformOutputsAssignments(script: string): string {
    // Match Outputs.variable = or Outputs.variable= (with optional whitespace)
    // Replace with Outputs['variable'] =
    return script.replace(/Outputs\.([A-Za-z0-9_]+)\s*=/g, (match, variableName) => {
      return `Outputs['${variableName}'] =`;
    });
  }

  /**
   * Properly escapes script content for embedding in a template literal.
   * This ensures multiline scripts work correctly when embedded in generated code.
   * Only escapes characters that would break the template literal syntax.
   */
  private escapeScriptForEmbedding(script: string): string {
    // Escape in this order to avoid double-escaping:
    // 1. Backslashes first (must be first)
    // 2. Backticks to prevent breaking out of template literal
    // 3. ${ to prevent template literal interpolation (but keep $ alone)
    return script
      .replace(/\\/g, '\\\\') // Escape backslashes
      .replace(/`/g, '\\`') // Escape backticks
      .replace(/\${/g, '\\${'); // Escape template literal expressions (${...})
  }

  /**
   * Convert REST node to Supabase Edge Function code
   * Generates a function compatible with the supabase-converter structure.
   * Scripts are embedded directly into the generated code at generation time for security.
   */
  private convertRestNode(node: Node, functionName: string): StdLibraryNodeResult {
    const { parameters } = node;
    const { inputs, outputs } = this.extractRestNodePorts(node);

    const cleanRequestScript = this.sanitizeScript(parameters.requestScript, this.defaultRequestScript);
    const cleanResponseScript = this.sanitizeScript(parameters.responseScript, this.defaultResponseScript);

    // Convert Sets to arrays for easier string manipulation
    const inputPorts = Array.from(inputs);
    const outputPorts = Array.from(outputs);

    // Build input parameters string - include fetch signal and resource/method overrides
    // NOTE: requestScript and responseScript are NOT included here - they're embedded in the function body
    const inputParams = ['fetch', 'resource', 'method', ...inputPorts].join(', ');
    const returnOutputs = ['success', 'failure', 'canceled', ...outputPorts].join(', ');

    // Transform Outputs assignments to bracket notation for consistency
    const transformedRequestScript = this.transformOutputsAssignments(cleanRequestScript);
    const transformedResponseScript = this.transformOutputsAssignments(cleanResponseScript);

    // Escape script content for embedding in template literal
    const escapedRequestScript = this.escapeScriptForEmbedding(transformedRequestScript);
    const escapedResponseScript = this.escapeScriptForEmbedding(transformedResponseScript);

    // Build input destructuring - handle resource and method from inputs or use defaults
    const resourceDefault = JSON.stringify(parameters.resource || '/');
    const methodDefault = JSON.stringify(parameters.method || 'GET');

    // Build input destructuring
    // NOTE: requestScript and responseScript are NOT parameters - they're embedded in the function body
    const inputDestructuring =
      inputPorts.length > 0
        ? `  const { fetch: fetchSignal = true, resource: resourceParam, method: methodParam, ${inputPorts.join(
            ', '
          )} } = inputs;`
        : `  const { fetch: fetchSignal = true, resource: resourceParam, method: methodParam } = inputs;`;

    // Build Inputs object from input parameters
    const inputsObjectMapping =
      inputPorts.length > 0
        ? inputPorts.map((port) => `      ${port}: ${port}`).join(',\n')
        : '      // No inputs defined';

    // Build output initialization
    const outputInitString =
      outputPorts.length > 0
        ? outputPorts.map((o) => `  Outputs['${o}'] = null;`).join('\n')
        : '  // No outputs defined';

    // Generate function compatible with supabase-converter structure
    const functionDefinition = `
const ${functionName} = async (inputs: Record<string, any>): Promise<Record<string, any>> => {
${inputDestructuring}
  
  // REST node logic - performs HTTP request
  let success = false;
  let failure = false;
  let canceled = false;
  
  // Initialize Outputs object (will be populated by response script)
  const Outputs: Record<string, any> = {};
${outputInitString}

  // Only execute if fetch signal is true
  if (!fetchSignal) {
    return { success: false, failure: false, canceled: false${
      outputPorts.length > 0 ? `, ${outputPorts.map((p) => `${p}: null`).join(', ')}` : ''
    } };
  }

  try {
    // 1. PREPARE THE REQUEST OBJECT (as defined by the original node)
    const Request = {
      resource: resourceParam || ${resourceDefault},
      method: methodParam || ${methodDefault},
      headers: { 'Content-Type': 'application/json' } as Record<string, string>,
      parameters: {} as Record<string, string>,
      content: {} as any,
    };

    // Create Inputs object from input parameters
    const Inputs = {
${inputsObjectMapping}
    };

    // --- BEGIN USER REQUEST SCRIPT ---
    // Scripts are embedded directly as code (not as strings) for security
${escapedRequestScript
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : `    ${line}`))
  .join('\n')}
    // --- END USER REQUEST SCRIPT ---

    // 2. BUILD AND EXECUTE THE FETCH CALL
    // Substitute path parameters (e.g., {userId}) from the Inputs object
    let finalUrl = Request.resource;
    for (const key in Inputs) {
      if (finalUrl.includes(\`{\${key}}\`)) {
        finalUrl = finalUrl.replace(\`{\${key}}\`, encodeURIComponent(String(Inputs[key])));
      }
    }

    // Append query parameters from the script-modified Request.parameters
    const queryParams = new URLSearchParams(Request.parameters).toString();
    if (queryParams) {
      finalUrl += \`?\${queryParams}\`;
    }
    
    const fetchResponse = await fetch(finalUrl, {
      method: Request.method,
      headers: Request.headers,
      body: (Request.method !== 'GET' && Request.content && Object.keys(Request.content).length > 0)
        ? JSON.stringify(Request.content)
        : undefined,
    });

    // 3. PREPARE THE RESPONSE OBJECT (for the response script)
    const contentType = fetchResponse.headers.get('content-type') || '';
    const responseContent = contentType.includes('application/json')
      ? await fetchResponse.json()
      : await fetchResponse.text();

    const Response = {
      status: fetchResponse.status,
      content: responseContent,
      request: Request, // Provide the original request context
    };

    // --- BEGIN USER RESPONSE SCRIPT ---
    // Scripts are embedded directly as code (not as strings) for security
${escapedResponseScript
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : `    ${line}`))
  .join('\n')}
    // --- END USER RESPONSE SCRIPT ---

    // 4. DETERMINE SUCCESS/FAILURE BASED ON STATUS CODE
    if (fetchResponse.status >= 200 && fetchResponse.status < 300) {
      success = true;
    } else {
      failure = true;
    }

    // 5. BUILD RETURN OBJECT WITH ALL OUTPUTS
    const result: Record<string, any> = {
      success,
      failure,
      canceled${
        outputPorts.length > 0 ? `,\n      ${outputPorts.map((p) => `${p}: Outputs['${p}']`).join(',\n      ')}` : ''
      }
    };

    return result;
  } catch (error: any) {
    console.error('REST node error:', error);
    failure = true;
    return {
      success: false,
      failure: true,
      canceled: false${
        outputPorts.length > 0 ? `,\n      ${outputPorts.map((p) => `${p}: null`).join(',\n      ')}` : ''
      }
    };
  }
};`;

    return {
      functionName,
      functionDefinition,
      inputMapping: inputParams,
      outputMapping: returnOutputs,
      calculationLogic: `HTTP ${parameters.method || 'GET'} request to ${parameters.resource || '/'}`,
      nodeType: 'REST2',
      isStateful: false
    };
  }

  /**
   * Convert DbConfig node - reads from Supabase environment variables
   * Note: This generates a variable instead of a function since config values are static
   */
  private convertDbConfigNode(node: Node, functionName: string): StdLibraryNodeResult {
    const defaultConfigKey = node.parameters.configKey || '';

    return {
      functionName,
      functionDefinition: `const ${functionName} = Deno.env.get(${JSON.stringify(defaultConfigKey)}) || '';`,
      inputMapping: 'configKey',
      outputMapping: 'value',
      calculationLogic: `Read config from Supabase environment variable${
        defaultConfigKey ? `: ${defaultConfigKey}` : ''
      }`,
      nodeType: 'DbConfig',
      isStateful: false
    };
  }

  /**
   * Convert NewDbModelProperties (Create New Record) node to Supabase Edge Function code
   */
  private convertNewDbModelPropertiesNode(node: Node, functionName: string): StdLibraryNodeResult {
    const collectionName = node.parameters.collectionName || 'unknown';

    // Extract property inputs from node parameters (prop-* keys)
    // These will be populated from connections or sidepanel values
    const propertyKeys = Object.keys(node.parameters || {}).filter((k) => k.startsWith('prop-'));

    // Build data object for insert - properties will come from inputs
    const dataEntries: string[] = [];
    const inputParams: string[] = ['collectionName'];

    // Add all property inputs to the input mapping
    propertyKeys.forEach((key) => {
      const fieldName = key.replace('prop-', '');
      // Use the field name directly (will be mapped from connections or parameters)
      inputParams.push(fieldName);
      // Add to data object - use the input parameter name
      dataEntries.push(`      ${fieldName}: ${fieldName}`);
    });

    const dataObject = dataEntries.length > 0 ? `{\n${dataEntries.join(',\n')}\n    }` : '{}';

    return {
      functionName,
      functionDefinition: `
const ${functionName} = async (inputs: Record<string, any>) => {
  const { collectionName, ...allInputs } = inputs;
  
  // Validate collection name
  if (!collectionName || typeof collectionName !== 'string') {
    return {
      success: false,
      record: null,
      recordId: undefined,
      id: undefined,
      failure: true,
      error: 'Collection name is required'
    };
  }
  
  // Create Supabase client with service role key (server authority)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      success: false,
      record: null,
      recordId: undefined,
      id: undefined,
      failure: true,
      error: 'Supabase configuration missing'
    };
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  // Build data object from inputs (exclude special parameters)
  // Exclude: collectionName, accessControl, and any ACL-related fields
  const insertData: Record<string, any> = {};
  Object.keys(allInputs).forEach((key) => {
    // Skip special parameters that shouldn't be inserted into the database
    if (
      key === 'accessControl' ||
      key.startsWith('acl-') ||
      key === 'store' ||
      key === 'sourceObjectId'
    ) {
      return;
    }
    // Only include defined values
    if (allInputs[key] !== undefined) {
      insertData[key] = allInputs[key];
    }
  });
  
  // Atomic insert operation
  const { data, error } = await supabase
    .from(collectionName)
    .insert(insertData)
    .select()
    .single();
  
  if (error) {
    return {
      success: false,
      record: null,
      recordId: undefined,
      id: undefined,
      failure: true,
      error: error.message
    };
  }
  
  // Success response - include both 'id' and 'recordId' for compatibility
  const recordId = data.id || data.objectId;
  return {
    success: true,
    record: data,
    recordId: recordId,
    id: recordId,
    failure: false,
    error: undefined
  };
};`,
      inputMapping: inputParams.join(', '),
      outputMapping: 'success, record, recordId, id, failure, error',
      calculationLogic: `Create new record in Supabase table: ${collectionName}`,
      nodeType: 'NewDbModelProperties',
      isStateful: false
    };
  }

  /**
   * Convert DbCollection2 (Query Records) node to Supabase Edge Function code
   */
  private convertDbCollection2Node(node: Node, functionName: string): StdLibraryNodeResult {
    const collectionName = node.parameters.collectionName || 'unknown';
    const filterType = node.parameters.storageFilterType || 'simple';
    const enableLimit = node.parameters.storageEnableLimit || false;
    const enableCount = node.parameters.storageEnableCount || false;

    // Build input parameters list
    // Note: Query parameters (qp-*) and filter values (storageFilterValue-*) are dynamic
    // and will be extracted from inputs at runtime
    const inputParams: string[] = ['collectionName', 'storageFetch'];

    // Add filter-related inputs based on filter type
    if (filterType === 'simple') {
      inputParams.push('visualFilter', 'visualSort');
      // Query parameters (qp-*) are dynamic and extracted from inputs
    } else if (filterType === 'json') {
      inputParams.push('storageJSONFilter');
      // Filter values (storageFilterValue-*) are dynamic and extracted from inputs
    }

    // Add pagination inputs if limit is enabled
    if (enableLimit) {
      inputParams.push('storageLimit', 'storageSkip');
    }

    // Helper function to convert Parse Server filters to Supabase queries
    const filterConversionHelper = `
  // Helper function to convert Parse Server filters to Supabase queries
  const applySupabaseFilters = (query: any, where: any) => {
    if (!where || typeof where !== 'object') {
      return query;
    }

    Object.keys(where).forEach((key) => {
      const value = where[key];

      // Handle logical operators
      if (key === '$and') {
        if (Array.isArray(value)) {
          value.forEach((condition) => {
            query = applySupabaseFilters(query, condition);
          });
        }
        return;
      }

      if (key === '$or') {
        if (Array.isArray(value) && value.length > 0) {
          const orConditions: string[] = [];
          value.forEach((condition) => {
            const conditionStr = buildSupabaseConditionString(condition);
            if (conditionStr) {
              orConditions.push(conditionStr);
            }
          });
          if (orConditions.length > 0) {
            query = query.or(orConditions.join(','));
          }
        }
        return;
      }

      // Handle field-specific filters
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.keys(value).forEach((operator) => {
          const operatorValue = value[operator];
          switch (operator) {
            case '$eq':
              query = query.eq(key, operatorValue);
              break;
            case '$ne':
              query = query.neq(key, operatorValue);
              break;
            case '$gt':
              query = query.gt(key, operatorValue);
              break;
            case '$gte':
              query = query.gte(key, operatorValue);
              break;
            case '$lt':
              query = query.lt(key, operatorValue);
              break;
            case '$lte':
              query = query.lte(key, operatorValue);
              break;
            case '$in':
              if (Array.isArray(operatorValue)) {
                query = query.in(key, operatorValue);
              }
              break;
            case '$nin':
              if (Array.isArray(operatorValue)) {
                query = query.not(key, 'in', operatorValue);
              }
              break;
            case '$regex':
              let pattern = operatorValue;
              if (typeof pattern === 'string') {
                pattern = pattern.replace(/\\.\\*/g, '%').replace(/\\./g, '_');
                query = query.like(key, pattern);
              }
              break;
            case '$exists':
              if (operatorValue) {
                query = query.not(key, 'is', null);
              } else {
                query = query.is(key, null);
              }
              break;
          }
        });
      } else {
        // Simple equality
        query = query.eq(key, value);
      }
    });

    return query;
  };

  // Helper to build condition string for OR queries
  const buildSupabaseConditionString = (condition: any): string | null => {
    if (!condition || typeof condition !== 'object') {
      return null;
    }

    const conditionParts: string[] = [];
    Object.keys(condition).forEach((key) => {
      const value = condition[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        Object.keys(value).forEach((operator) => {
          const operatorValue = value[operator];
          switch (operator) {
            case '$eq':
              conditionParts.push(\`\${key}.eq.\${operatorValue}\`);
              break;
            case '$ne':
              conditionParts.push(\`\${key}.neq.\${operatorValue}\`);
              break;
            case '$gt':
              conditionParts.push(\`\${key}.gt.\${operatorValue}\`);
              break;
            case '$gte':
              conditionParts.push(\`\${key}.gte.\${operatorValue}\`);
              break;
            case '$lt':
              conditionParts.push(\`\${key}.lt.\${operatorValue}\`);
              break;
            case '$lte':
              conditionParts.push(\`\${key}.lte.\${operatorValue}\`);
              break;
          }
        });
      } else {
        conditionParts.push(\`\${key}.eq.\${value}\`);
      }
    });

    return conditionParts.length > 0 ? conditionParts.join(',') : null;
  };

  // Helper to convert visual filter to Parse Server format
  const convertVisualFilter = (query: any, queryParameters: Record<string, any>): any => {
    if (!query) return undefined;

    if (query.combinator !== undefined && query.rules !== undefined) {
      if (query.rules.length === 0) return undefined;
      if (query.rules.length === 1) return convertVisualFilter(query.rules[0], queryParameters);
      
      const res: any = {};
      const op = '$' + query.combinator;
      res[op] = [];
      query.rules.forEach((r: any) => {
        const cond = convertVisualFilter(r, queryParameters);
        if (cond !== undefined) res[op].push(cond);
      });
      return res;
    } else if (query.operator === 'related to') {
      const value = query.input !== undefined ? queryParameters[query.input] : undefined;
      if (value === undefined) return undefined;
      return {
        $relatedTo: {
          object: {
            __type: 'Pointer',
            objectId: value,
            className: query.relatedTo
          },
          key: query.relationProperty
        }
      };
    } else {
      const res: any = {};
      const value = query.input !== undefined ? queryParameters[query.input] : query.value;
      
      if (query.operator === 'exist') {
        res[query.property] = { $exists: true };
        return res;
      } else if (query.operator === 'not exist') {
        res[query.property] = { $exists: false };
        return res;
      }

      if (value === undefined) return undefined;

      let cond: any;
      if (query.operator === 'greater than') cond = { $gt: value };
      else if (query.operator === 'greater than or equal to') cond = { $gte: value };
      else if (query.operator === 'less than') cond = { $lt: value };
      else if (query.operator === 'less than or equal to') cond = { $lte: value };
      else if (query.operator === 'equal to') cond = { $eq: value };
      else if (query.operator === 'not equal to') cond = { $ne: value };
      else if (query.operator === 'points to') {
        cond = {
          $eq: { __type: 'Pointer', objectId: value, className: query.targetClass }
        };
      } else if (query.operator === 'contain') {
        cond = { $regex: value, $options: 'i' };
      }

      res[query.property] = cond;
      return res;
    }
  };

  // Helper to convert visual sorting to Supabase format
  const convertVisualSorting = (sorting: any): string | undefined => {
    if (!sorting || !Array.isArray(sorting) || sorting.length === 0) {
      return undefined;
    }

    return sorting.map((s: any) => {
      const direction = s.direction === 'desc' ? 'desc' : 'asc';
      return \`\${s.property}:\${direction}\`;
    }).join(',');
  };`;

    // Build the function definition with dynamic input extraction
    const functionDefinition = `
const ${functionName} = async (inputs: Record<string, any>) => {
  // Extract all inputs dynamically
  const collectionName = inputs.collectionName;
  const doFetch = inputs.storageFetch !== false; // Default to true if not provided
  ${
    filterType === 'simple'
      ? `
  const visualFilter = inputs.visualFilter;
  const visualSort = inputs.visualSort;
  `
      : filterType === 'json'
      ? `
  const storageJSONFilter = inputs.storageJSONFilter;
  `
      : ''
  }
  ${
    enableLimit
      ? `
  const storageLimit = inputs.storageLimit;
  const storageSkip = inputs.storageSkip;
  `
      : ''
  }
  
  // Extract query parameters (inputs with 'qp-' prefix)
  const queryParameters: Record<string, any> = {};
  Object.keys(inputs).forEach((key) => {
    if (key.startsWith('qp-')) {
      const paramName = key.substring(3); // Remove 'qp-' prefix
      queryParameters[paramName] = inputs[key];
    }
  });
  
  // Only execute if fetch signal is true
  if (!doFetch) {
    return {
      success: false,
      items: [],
      count: 0,
      firstItemId: undefined,
      isEmpty: true,
      fetched: false,
      failure: false,
      error: undefined,
      storageTotalCount: undefined
    };
  }

  // Validate collection name
  if (!collectionName || typeof collectionName !== 'string') {
    return {
      success: false,
      items: [],
      count: 0,
      firstItemId: undefined,
      isEmpty: true,
      fetched: false,
      failure: true,
      error: 'Collection name is required',
      storageTotalCount: undefined
    };
  }
  
  // Create Supabase client with service role key (server authority)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      success: false,
      items: [],
      count: 0,
      firstItemId: undefined,
      isEmpty: true,
      fetched: false,
      failure: true,
      error: 'Supabase configuration missing',
      storageTotalCount: undefined
    };
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  try {
${filterConversionHelper}

    // Build the query
    let query = supabase.from(collectionName).select('*'${enableCount ? ', { count: "exact" }' : ''});

    // Apply filters
    let whereFilter: any = undefined;
    ${
      filterType === 'simple'
        ? `
    // Convert visual filter to Parse Server format, then to Supabase
    if (visualFilter) {
      whereFilter = convertVisualFilter(visualFilter, queryParameters);
    }
    `
        : filterType === 'json'
        ? `
    // Handle JSON/javascript filter
    if (storageJSONFilter) {
      try {
        // Extract filter values from inputs (inputs with 'storageFilterValue-' prefix)
        const filterInputs: Record<string, any> = {};
        Object.keys(inputs).forEach((key) => {
          if (key.startsWith('storageFilterValue-')) {
            const varName = key.substring('storageFilterValue-'.length);
            filterInputs[varName] = inputs[key];
          }
        });
        
        // Parse filter script
        const filterCode = storageJSONFilter.replace(/\\/\\*[\\s\\S]*?\\*\\/|\\/\\/.*/g, '');
        const filterVariables = filterCode.match(/\\$[A-Za-z0-9]+/g) || [];
        
        // Build filter function - similar to how the node does it
        let _filter: any = {};
        const _filterCb = (f: any) => {
          _filter = f;
        };
        
        // Convert filter to Parse Server format using convertFilterOp helper
        const convertFilterOp = (filter: any): any => {
          // Simplified conversion - in production, use full QueryUtils.convertFilterOp logic
          const res: any = {};
          Object.keys(filter).forEach((key) => {
            const opAndValue = filter[key];
            if (typeof opAndValue === 'object' && opAndValue !== null) {
              if (opAndValue['$eq'] !== undefined) res[key] = { $eq: opAndValue['$eq'] };
              else if (opAndValue['$ne'] !== undefined) res[key] = { $ne: opAndValue['$ne'] };
              else if (opAndValue['$gt'] !== undefined) res[key] = { $gt: opAndValue['$gt'] };
              else if (opAndValue['$gte'] !== undefined) res[key] = { $gte: opAndValue['$gte'] };
              else if (opAndValue['$lt'] !== undefined) res[key] = { $lt: opAndValue['$lt'] };
              else if (opAndValue['$lte'] !== undefined) res[key] = { $lte: opAndValue['$lte'] };
              else if (opAndValue['$in'] !== undefined) res[key] = { $in: opAndValue['$in'] };
              else if (opAndValue['$regex'] !== undefined) res[key] = { $regex: opAndValue['$regex'] };
              else res[key] = opAndValue;
            } else {
              res[key] = opAndValue;
            }
          });
          return res;
        };
        
        const filterFuncArgs = [_filterCb, filterInputs];
        filterVariables.forEach((v) => {
          const varName = v.substring(1);
          filterFuncArgs.push(filterInputs[varName] || inputs['storageFilterValue-' + varName]);
        });
        
        const filterArgs = ['where', 'Inputs'].concat(filterVariables.map((v) => v.substring(1)));
        const filterBody = \`\${filterCode}\`;
        const filterFunc = new Function(...filterArgs, filterBody);
        
        filterFunc.apply(null, filterFuncArgs);
        whereFilter = convertFilterOp(_filter);
      } catch (e: any) {
        return {
          success: false,
          items: [],
          count: 0,
          firstItemId: undefined,
          isEmpty: true,
          fetched: false,
          failure: true,
          error: 'Invalid filter script: ' + e.message,
          storageTotalCount: undefined
        };
      }
    }
    `
        : ''
    }

    // Apply filters to query
    if (whereFilter) {
      query = applySupabaseFilters(query, whereFilter);
    }

    // Apply sorting
    ${
      filterType === 'simple'
        ? `
    if (visualSort) {
      const sortString = convertVisualSorting(visualSort);
      if (sortString) {
        const sortParts = sortString.split(',');
        sortParts.forEach((part: string) => {
          const [column, direction] = part.split(':');
          if (direction === 'desc') {
            query = query.order(column, { ascending: false });
          } else {
            query = query.order(column, { ascending: true });
          }
        });
      }
    }
    `
        : ''
    }

    // Apply pagination
    ${
      enableLimit
        ? `
    if (storageLimit !== undefined) {
      const from = storageSkip || 0;
      const to = from + storageLimit - 1;
      query = query.range(from, to);
    }
    `
        : ''
    }

    // Execute query
    const { data, error, count } = await query;
    
    if (error) {
      return {
        success: false,
        items: [],
        count: 0,
        firstItemId: undefined,
        isEmpty: true,
        fetched: false,
        failure: true,
        error: error.message,
        storageTotalCount: undefined
      };
    }

    // Process results
    const items = data || [];
    const itemCount = items.length;
    const firstItemId = itemCount > 0 ? (items[0].id || items[0].objectId) : undefined;
    const isEmpty = itemCount === 0;

    return {
      success: true,
      items: items,
      count: itemCount,
      firstItemId: firstItemId,
      isEmpty: isEmpty,
      fetched: true,
      failure: false,
      error: undefined,
      storageTotalCount: ${enableCount ? 'count' : 'undefined'}
    };
  } catch (error: any) {
    return {
      success: false,
      items: [],
      count: 0,
      firstItemId: undefined,
      isEmpty: true,
      fetched: false,
      failure: true,
      error: error.message || 'Failed to fetch records',
      storageTotalCount: undefined
    };
  }
};`;

    return {
      functionName,
      functionDefinition,
      inputMapping: inputParams.join(', '),
      outputMapping: 'success, items, count, firstItemId, isEmpty, fetched, failure, error, storageTotalCount',
      calculationLogic: `Query records from Supabase table: ${collectionName}`,
      nodeType: 'DbCollection2',
      isStateful: false
    };
  }

  /**
   * Convert DeleteDbModelProperties (Delete Record) node to Supabase Edge Function code
   */
  private convertDeleteDbModelPropertiesNode(node: Node, functionName: string): StdLibraryNodeResult {
    const collectionName = node.parameters.collectionName || 'unknown';

    // Build input parameters list
    // Note: modelId is conditional based on idSource, but we'll include it in the function
    const inputParams: string[] = ['collectionName', 'store', 'modelId'];

    // Build the function definition
    const functionDefinition = `
const ${functionName} = async (inputs: Record<string, any>) => {
  const { collectionName, store: doDelete = true, modelId } = inputs;
  
  // Only execute if delete signal is true
  if (!doDelete) {
    return {
      success: false,
      deleted: false,
      failure: false,
      error: undefined,
      id: undefined
    };
  }

  // Validate collection name
  if (!collectionName || typeof collectionName !== 'string') {
    return {
      success: false,
      deleted: false,
      failure: true,
      error: 'Collection name is required',
      id: undefined
    };
  }

  // Validate record ID
  if (!modelId) {
    return {
      success: false,
      deleted: false,
      failure: true,
      error: 'Missing Record Id',
      id: undefined
    };
  }
  
  // Create Supabase client with service role key (server authority)
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return {
      success: false,
      deleted: false,
      failure: true,
      error: 'Supabase configuration missing',
      id: undefined
    };
  }
  
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  try {
    // Delete the record by ID
    // Supabase uses 'id' as the primary key by default
    // If the table uses 'objectId', we'll try both
    let deleteError = null;
    
    // Try 'id' first (standard Supabase primary key)
    const { error: errorById } = await supabase
      .from(collectionName)
      .delete()
      .eq('id', modelId);
    
    if (errorById) {
      // Try 'objectId' as fallback (for Parse Server compatibility)
      const { error: errorByObjectId } = await supabase
        .from(collectionName)
        .delete()
        .eq('objectId', modelId);
      
      if (errorByObjectId) {
        // Both failed
        return {
          success: false,
          deleted: false,
          failure: true,
          error: errorByObjectId.message || 'Failed to delete record',
          id: undefined
        };
      }
      // objectId delete succeeded
    }
    
    // Success response (either id or objectId delete succeeded)
    return {
      success: true,
      deleted: true,
      failure: false,
      error: undefined,
      id: modelId
    };
  } catch (error: any) {
    return {
      success: false,
      deleted: false,
      failure: true,
      error: error.message || 'Failed to delete record',
      id: undefined
    };
  }
};`;

    return {
      functionName,
      functionDefinition,
      inputMapping: inputParams.join(', '),
      outputMapping: 'success, deleted, failure, error, id',
      calculationLogic: `Delete record from Supabase table: ${collectionName}`,
      nodeType: 'DeleteDbModelProperties',
      isStateful: false
    };
  }

  /**
   * Convert Boolean To Signal node
   * In RGS context: when boolean input is true, emits a signal (true) on output
   */
  private convertBooleanToSignalNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  const value = !!inputs.value;
  return { signal: value };
};`,
      inputMapping: 'value',
      outputMapping: 'signal',
      calculationLogic: 'Boolean to signal conversion',
      nodeType: 'Boolean To Signal',
      isStateful: false
    };
  }

  /**
   * Convert Value Changed node
   * In RGS synchronous context: always fires (no previous-frame comparison possible)
   */
  private convertValueChangedNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  // In synchronous RGS context, value is always "changed"
  return { value: inputs.value, changed: true };
};`,
      inputMapping: 'value',
      outputMapping: 'value, changed',
      calculationLogic: 'Value change detection (always fires in RGS)',
      nodeType: 'Value Changed',
      isStateful: false
    };
  }

  /**
   * Convert States node (state machine)
   * In RGS context: receives a state value and passes it through with the current state name
   */
  private convertStatesNode(node: Node, functionName: string): StdLibraryNodeResult {
    // Extract state names from node parameters
    const states: string[] = [];
    if (node.parameters.states && Array.isArray(node.parameters.states)) {
      for (const s of node.parameters.states) {
        if (s && typeof s === 'object' && s.label) states.push(s.label);
        else if (typeof s === 'string') states.push(s);
      }
    }
    const stateOutputs = states.length > 0 ? states.map(s => `${this.sanitizeParameterName(s)}: currentState === '${s}'`).join(', ') : '';

    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  const currentState = inputs.state || inputs.value || '${states[0] || 'default'}';
  return { currentState${stateOutputs ? ', ' + stateOutputs : ''} };
};`,
      inputMapping: 'state, value',
      outputMapping: 'currentState' + (states.length > 0 ? ', ' + states.map(s => this.sanitizeParameterName(s)).join(', ') : ''),
      calculationLogic: 'State machine node',
      nodeType: 'States',
      isStateful: true
    };
  }

  /**
   * Convert Timer node
   * In RGS synchronous context: fires immediately (no delay possible)
   */
  private convertTimerNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  // Timer fires immediately in synchronous RGS context
  return { timerDone: true, running: false };
};`,
      inputMapping: 'start, stop, duration',
      outputMapping: 'timerDone, running',
      calculationLogic: 'Timer (immediate fire in RGS)',
      nodeType: 'Timer',
      isStateful: false
    };
  }

  /**
   * Convert Event Sender node
   * In RGS context: passthrough — sends signal/data downstream
   */
  private convertEventSenderNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  // Event Sender passthrough in RGS context
  return { sent: true, ...inputs };
};`,
      inputMapping: '...inputs',
      outputMapping: 'sent',
      calculationLogic: 'Event sender passthrough',
      nodeType: 'Event Sender',
      isStateful: false
    };
  }

  /**
   * Convert Event Receiver node
   * In RGS context: passthrough — receives signal/data from upstream
   */
  private convertEventReceiverNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  // Event Receiver passthrough in RGS context
  return { received: true, ...inputs };
};`,
      inputMapping: '...inputs',
      outputMapping: 'received',
      calculationLogic: 'Event receiver passthrough',
      nodeType: 'Event Receiver',
      isStateful: false
    };
  }

  /**
   * Convert CloudFunction2 node
   * In RGS context: passthrough — cloud function reference
   */
  private convertCloudFunction2Node(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `
const ${functionName} = (inputs) => {
  // CloudFunction2 node — in RGS context, acts as passthrough
  // The actual cloud function logic is embedded via component references
  return { ...inputs, executed: true };
};`,
      inputMapping: '...inputs',
      outputMapping: 'executed',
      calculationLogic: 'Cloud function reference passthrough',
      nodeType: 'CloudFunction2',
      isStateful: false
    };
  }

  /**
   * Convert unknown standard library node
   */
  private convertUnknownStdLibraryNode(node: Node, functionName: string): StdLibraryNodeResult {
    return {
      functionName,
      functionDefinition: `// Unknown standard library node type: ${node.typename}`,
      inputMapping: '',
      outputMapping: '',
      calculationLogic: '',
      nodeType: node.typename,
      isStateful: false
    };
  }

  /**
   * Sanitize parameter name for use in JavaScript/TypeScript code
   */
  private sanitizeParameterName(name: string): string {
    // Replace spaces with underscores, remove special characters that aren't valid in JS identifiers
    return name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  }

  /**
   * Get configuration for a standard library node
   */
  public getStdLibraryNodeConfig(nodeType: string): StdLibraryNodeConfig | undefined {
    const configs: Record<string, StdLibraryNodeConfig> = {
      If: {
        nodeType: 'If',
        inputPorts: ['input'],
        outputPorts: ['trueCondition', 'falseCondition'],
        defaultValues: {},
        calculationMethod: 'conditionalLogic',
        isStateful: false,
        category: 'logic'
      },
      Condition: {
        nodeType: 'Condition',
        inputPorts: ['condition', 'eval'],
        outputPorts: ['result', 'isfalse', 'ontrue', 'onfalse'],
        defaultValues: {},
        calculationMethod: 'booleanEvaluation',
        isStateful: false,
        category: 'logic'
      },
      Inverter: {
        nodeType: 'Inverter',
        inputPorts: ['value'],
        outputPorts: ['result'],
        defaultValues: {},
        calculationMethod: 'booleanInversion',
        isStateful: false,
        category: 'logic'
      },
      'Boolean To String': {
        nodeType: 'Boolean To String',
        inputPorts: ['input', 'trueString', 'falseString'],
        outputPorts: ['currentValue', 'inputChanged'],
        defaultValues: { trueString: 'true', falseString: 'false' },
        calculationMethod: 'stringConversion',
        isStateful: false,
        category: 'conversion'
      },
      'Date To String': {
        nodeType: 'Date To String',
        inputPorts: ['input', 'formatString'],
        outputPorts: ['currentValue', 'inputChanged', 'onError'],
        defaultValues: { formatString: '{year}-{month}-{date}' },
        calculationMethod: 'dateFormatting',
        isStateful: false,
        category: 'conversion'
      },
      Boolean: {
        nodeType: 'Boolean',
        inputPorts: ['value', 'saveValue'],
        outputPorts: ['savedValue', 'changed', 'stored'],
        defaultValues: { startValue: false },
        calculationMethod: 'variableStorage',
        isStateful: true,
        category: 'variables'
      },
      String: {
        nodeType: 'String',
        inputPorts: ['value', 'saveValue'],
        outputPorts: ['savedValue', 'changed', 'stored', 'length'],
        defaultValues: { startValue: '' },
        calculationMethod: 'variableStorage',
        isStateful: true,
        category: 'variables'
      },
      Number: {
        nodeType: 'Number',
        inputPorts: ['value', 'saveValue'],
        outputPorts: ['savedValue', 'changed', 'stored'],
        defaultValues: { startValue: 0 },
        calculationMethod: 'variableStorage',
        isStateful: true,
        category: 'variables'
      },
      Switch: {
        nodeType: 'Switch',
        inputPorts: ['on', 'off', 'flip', 'onFromStart'],
        outputPorts: ['state', 'switched', 'switchedToOn', 'switchedToOff'],
        defaultValues: { onFromStart: false },
        calculationMethod: 'stateManagement',
        isStateful: true,
        category: 'logic'
      },
      Counter: {
        nodeType: 'Counter',
        inputPorts: ['increase', 'decrease', 'reset', 'startValue', 'limitsEnabled', 'limitsMin', 'limitsMax'],
        outputPorts: ['currentCount', 'countChanged'],
        defaultValues: { startValue: 0, limitsEnabled: false, limitsMin: 0, limitsMax: 0 },
        calculationMethod: 'counting',
        isStateful: true,
        category: 'utility'
      },
      'Static Data': {
        nodeType: 'Static Data',
        inputPorts: ['type', 'csv', 'json'],
        outputPorts: ['items', 'count'],
        defaultValues: { type: 'csv', csv: '', json: '[]' },
        calculationMethod: 'dataStorage',
        isStateful: false,
        category: 'data'
      },
      Expression: {
        nodeType: 'Expression',
        inputPorts: ['expression', 'a', 'b', 'c', 'd', 'e'],
        outputPorts: ['result', 'error'],
        defaultValues: { expression: 'a + b' },
        calculationMethod: 'mathematical',
        isStateful: false,
        category: 'utility'
      },
      Color: {
        nodeType: 'Color',
        inputPorts: ['value', 'saveValue'],
        outputPorts: ['savedValue', 'changed', 'stored', 'r', 'g', 'b', 'a'],
        defaultValues: { startValue: '#000000' },
        calculationMethod: 'variableStorage',
        isStateful: true,
        category: 'variables'
      },
      Loop: {
        nodeType: 'Loop',
        inputPorts: ['do', 'next', 'index', 'steps', 'lessThan', 'moreThan'],
        outputPorts: ['index', 'currentIndex', 'indexUpdated', 'done'],
        defaultValues: { index: 0, steps: 1, lessThan: 1, moreThan: -1 },
        calculationMethod: 'loopExecution',
        isStateful: false,
        category: 'utility'
      },
      'State Manager': {
        nodeType: 'State Manager',
        inputPorts: ['update', 'reset', 'numInputs'],
        outputPorts: ['updated', 'resetDone', 'stateObject', 'objectId'],
        defaultValues: { numInputs: 3 },
        calculationMethod: 'stateManagement',
        isStateful: false,
        category: 'state'
      },
      'Array State Manager': {
        nodeType: 'Array State Manager',
        inputPorts: ['update', 'reset', 'numInputs'],
        outputPorts: ['updated', 'resetDone'],
        defaultValues: { numInputs: 3 },
        calculationMethod: 'arrayStateManagement',
        isStateful: false,
        category: 'state'
      }
    };

    return configs[nodeType];
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Exports are already declared above with the class and interface definitions
