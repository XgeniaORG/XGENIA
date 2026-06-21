/**
 * Math Node Converter - Handles all math-related node conversions
 *
 * This module provides a clean, maintainable, and scalable architecture for
 * converting XGENIA math nodes to Supabase Edge Function code.
 */

import { Node } from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Math node configuration
 */
export interface MathNodeConfig {
  nodeType: string;
  inputPorts: string[];
  outputPorts: string[];
  defaultValues: Record<string, any>;
  calculationMethod: string;
}

/**
 * Math node calculation result
 */
export interface MathNodeResult {
  functionDefinition: string;
  inputMapping: string;
  outputMapping: string;
  calculationLogic: string;
}

// ============================================================================
// MATH NODE REGISTRY
// ============================================================================

/**
 * Registry of all supported math nodes
 */
export class MathNodeRegistry {
  private static readonly MATH_NODES: Map<string, MathNodeConfig> = new Map([
    // Basic Arithmetic
    [
      'Addition',
      {
        nodeType: 'Addition',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Subtraction',
      {
        nodeType: 'Subtraction',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Multiplication',
      {
        nodeType: 'Multiplication',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Division',
      {
        nodeType: 'Division',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 1 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Modulo',
      {
        nodeType: 'Modulo',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 1 },
        calculationMethod: 'calculate'
      }
    ],

    // Comparison Operations
    [
      'Min',
      {
        nodeType: 'Min',
        inputPorts: ['firstValue', 'secondValue'],
        outputPorts: ['result'],
        defaultValues: { firstValue: 0, secondValue: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Max',
      {
        nodeType: 'Max',
        inputPorts: ['firstValue', 'secondValue'],
        outputPorts: ['result'],
        defaultValues: { firstValue: 0, secondValue: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Less Than Or Equal',
      {
        nodeType: 'Less Than Or Equal',
        inputPorts: ['firstNumber', 'secondNumber'],
        outputPorts: ['result'],
        defaultValues: { firstNumber: 0, secondNumber: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Equal',
      {
        nodeType: 'Equal',
        inputPorts: ['firstValue', 'secondValue'],
        outputPorts: ['result'],
        defaultValues: { firstValue: 0, secondValue: 0 },
        calculationMethod: 'calculate'
      }
    ],

    // Array Operations
    [
      'Min Array',
      {
        nodeType: 'Min Array',
        inputPorts: ['array', 'keyPath'],
        outputPorts: ['result'],
        defaultValues: { array: [], keyPath: '' },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Max Array',
      {
        nodeType: 'Max Array',
        inputPorts: ['array', 'keyPath'],
        outputPorts: ['result'],
        defaultValues: { array: [], keyPath: '' },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Sum',
      {
        nodeType: 'Sum',
        inputPorts: ['array', 'keyPath'],
        outputPorts: ['result'],
        defaultValues: { array: [], keyPath: '' },
        calculationMethod: 'calculate'
      }
    ],

    // Rounding Operations
    [
      'Round',
      {
        nodeType: 'Round',
        inputPorts: ['value'],
        outputPorts: ['result'],
        defaultValues: { value: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Floor',
      {
        nodeType: 'Floor',
        inputPorts: ['value'],
        outputPorts: ['result'],
        defaultValues: { value: 0 },
        calculationMethod: 'calculate'
      }
    ],
    [
      'Ceil',
      {
        nodeType: 'Ceil',
        inputPorts: ['value'],
        outputPorts: ['result'],
        defaultValues: { value: 0 },
        calculationMethod: 'calculate'
      }
    ],

    // Random Number Generators
    [
      'True Random Number Generator',
      {
        nodeType: 'True Random Number Generator',
        inputPorts: [],
        outputPorts: ['value'],
        defaultValues: {},
        calculationMethod: 'generateRandomValue'
      }
    ],
    [
      'True Random Number Array Generator',
      {
        nodeType: 'True Random Number Array Generator',
        inputPorts: ['count'],
        outputPorts: ['value'],
        defaultValues: { count: 10 },
        calculationMethod: 'generateRandomValue'
      }
    ],
    [
      'ISAAC Random Number Generator',
      {
        nodeType: 'ISAAC Random Number Generator',
        inputPorts: ['seed', 'nonce'],
        outputPorts: ['value'],
        defaultValues: { seed: null, nonce: null },
        calculationMethod: 'generateRandomValue'
      }
    ],
    [
      'ISAAC Random Number Array Generator',
      {
        nodeType: 'ISAAC Random Number Array Generator',
        inputPorts: ['size', 'seed', 'nonce'],
        outputPorts: ['array'],
        defaultValues: { size: 1, seed: null, nonce: null },
        calculationMethod: 'generateRandomValue'
      }
    ],

    // Formula Operations
    [
      'Single Parameter Formula',
      {
        nodeType: 'Single Parameter Formula',
        inputPorts: ['parameterValue', 'mathFormula'],
        outputPorts: ['result'],
        defaultValues: { parameterValue: 0, mathFormula: 'x * 2' },
        calculationMethod: 'calculateResult'
      }
    ],
    [
      'Formula-Generated Array',
      {
        nodeType: 'Formula-Generated Array',
        inputPorts: ['arrayLength', 'mathFormula'],
        outputPorts: ['items'],
        defaultValues: { arrayLength: 10, mathFormula: 'x * 2' },
        calculationMethod: 'generateArray'
      }
    ]
  ]);

  /**
   * Check if a node type is a math node
   */
  public static isMathNode(nodeType: string): boolean {
    return this.MATH_NODES.has(nodeType);
  }

  /**
   * Get math node configuration
   */
  public static getMathNodeConfig(nodeType: string): MathNodeConfig | undefined {
    return this.MATH_NODES.get(nodeType);
  }

  /**
   * Get all supported math node types
   */
  public static getAllMathNodeTypes(): string[] {
    return Array.from(this.MATH_NODES.keys());
  }
}

// ============================================================================
// CALCULATION LOGIC GENERATORS
// ============================================================================

/**
 * Generates calculation logic for different math node types
 */
export class MathCalculationGenerator {
  /**
   * Generate calculation logic for a math node
   */
  public static generateCalculationLogic(nodeType: string): string {
    const generatorMap: Record<string, () => string> = {
      Addition: () => this.generateAdditionLogic(),
      Subtraction: () => this.generateSubtractionLogic(),
      Multiplication: () => this.generateMultiplicationLogic(),
      Division: () => this.generateDivisionLogic(),
      Modulo: () => this.generateModuloLogic(),
      Min: () => this.generateMinLogic(),
      Max: () => this.generateMaxLogic(),
      'Min Array': () => this.generateMinArrayLogic(),
      'Max Array': () => this.generateMaxArrayLogic(),
      Sum: () => this.generateSumLogic(),
      Round: () => this.generateRoundLogic(),
      Floor: () => this.generateFloorLogic(),
      Ceil: () => this.generateCeilLogic(),
      'True Random Number Generator': () => this.generateTRNGLogic(),
      'True Random Number Array Generator': () => this.generateTRNGArrayLogic(),
      'ISAAC Random Number Generator': () => this.generateISAACRNGLogic(),
      'ISAAC Random Number Array Generator': () => this.generateISAACRNGArrayLogic(),
      'Single Parameter Formula': () => this.generateSPFLogic(),
      'Formula-Generated Array': () => this.generateMFAGLogic(),
      'Less Than Or Equal': () => this.generateLessThanOrEqualLogic(),
      Equal: () => this.generateEqualLogic()
    };

    const generator = generatorMap[nodeType];
    if (!generator) {
      throw new Error(`Unknown math node type: ${nodeType}`);
    }

    return generator();
  }

  // ============================================================================
  // BASIC ARITHMETIC OPERATIONS
  // ============================================================================

  private static generateAdditionLogic(): string {
    return `
      const result = firstNumber + secondNumber;`;
  }

  private static generateSubtractionLogic(): string {
    return `
      const result = firstNumber - secondNumber;`;
  }

  private static generateMultiplicationLogic(): string {
    return `
      const result = firstNumber * secondNumber;`;
  }

  private static generateDivisionLogic(): string {
    return `
      if (secondNumber === 0) {
        throw new Error('Division by zero');
      }
      const result = firstNumber / secondNumber;`;
  }

  private static generateModuloLogic(): string {
    return `
      if (secondNumber === 0) {
        throw new Error('Modulo by zero');
      }
      const result = firstNumber % secondNumber;`;
  }

  // ============================================================================
  // COMPARISON OPERATIONS
  // ============================================================================

  private static generateMinLogic(): string {
    return `
      const result = Math.min(firstValue, secondValue);`;
  }

  private static generateMaxLogic(): string {
    return `
      const result = Math.max(firstValue, secondValue);`;
  }

  private static generateLessThanOrEqualLogic(): string {
    return `
      const result = firstNumber <= secondNumber;`;
  }

  private static generateEqualLogic(): string {
    return `
      const result = firstValue === secondValue;`;
  }

  // ============================================================================
  // ARRAY OPERATIONS
  // ============================================================================

  private static generateMinArrayLogic(): string {
    return `
      if (!Array.isArray(array) || array.length === 0) {
        throw new Error('Input must be a non-empty array');
      }
      
      let values = array;
      if (keyPath && keyPath.trim() !== '') {
        values = array.map(item => {
          const keys = keyPath.split(',').map(k => k.trim());
          let value = item;
          for (const key of keys) {
            if (value === null || value === undefined) return undefined;
            value = value[key];
          }
          return value;
        });
      }
      
      const validValues = values.filter(v => v !== null && v !== undefined);
      const result = validValues.length === 0 ? 0 : Math.min(...validValues);`;
  }

  private static generateMaxArrayLogic(): string {
    return `
      if (!Array.isArray(array) || array.length === 0) {
        throw new Error('Input must be a non-empty array');
      }
      
      let values = array;
      if (keyPath && keyPath.trim() !== '') {
        values = array.map(item => {
          const keys = keyPath.split(',').map(k => k.trim());
          let value = item;
          for (const key of keys) {
            if (value === null || value === undefined) return undefined;
            value = value[key];
          }
          return value;
        });
      }
      
      const validValues = values.filter(v => v !== null && v !== undefined);
      const result = validValues.length === 0 ? 0 : Math.max(...validValues);`;
  }

  private static generateSumLogic(): string {
    return `
      if (!Array.isArray(array) || array.length === 0) {
        throw new Error('Input must be a non-empty array');
      }
      
      let values = array;
      if (keyPath && keyPath.trim() !== '') {
        values = array.map(item => {
          const keys = keyPath.split(',').map(k => k.trim());
          let value = item;
          for (const key of keys) {
            if (value === null || value === undefined) return undefined;
            value = value[key];
          }
          return value;
        });
      }
      
      const validValues = values.filter(v => v !== null && v !== undefined);
      let result;
      if (validValues.length === 0) {
        result = 0;
      } else {
        // Check if any value is a string - if so, perform concatenation
        const hasStringValues = validValues.some(v => typeof v === 'string');
        result = hasStringValues 
          ? validValues.map(v => String(v)).join('')
          : validValues.reduce((sum, value) => sum + value, 0);
      }`;
  }

  // ============================================================================
  // ROUNDING OPERATIONS
  // ============================================================================

  private static generateRoundLogic(): string {
    return `
      const result = Math.round(value);`;
  }

  private static generateFloorLogic(): string {
    return `
      const result = Math.floor(value);`;
  }

  private static generateCeilLogic(): string {
    return `
      const result = Math.ceil(value);`;
  }

  // ============================================================================
  // RANDOM NUMBER GENERATORS
  // ============================================================================

  private static generateTRNGLogic(): string {
    return `
      // Use crypto.getRandomValues for true randomness when available
      let value;
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const array = new Uint32Array(1);
        crypto.getRandomValues(array);
        const normalizedRandom = array[0] / (0xffffffff + 1);
        value = normalizedRandom * 1000000000000;
      } else {
        // Fallback to Math.random
        value = Math.random() * 1000000000000;
      }`;
  }

  private static generateTRNGArrayLogic(): string {
    return `
      const arrayLength = Math.max(1, Math.min(count, 1000)); // Limit to 1000 items
      const value = [];
      
      for (let i = 0; i < arrayLength; i++) {
        let randomValue;
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
          const array = new Uint32Array(1);
          crypto.getRandomValues(array);
          const normalizedRandom = array[0] / (0xffffffff + 1);
          randomValue = normalizedRandom * 1000000000000;
        } else {
          randomValue = Math.random() * 1000000000000;
        }
        value.push(randomValue);
      }`;
  }

  private static generateISAACRNGLogic(): string {
    return `
      // Simplified ISAAC implementation for Edge Functions
      const isaac = new IsaacRNG(seed, nonce);
      const value = isaac.randomFloat(0, 1000000000000);`;
  }

  public static generateISAACRNGClassDefinition(): string {
    return `
    // ISAAC RNG implementation
    class IsaacRNG {
      constructor(seed, nonce) {
        this.RANDSIZL = 8;
        this.RANDSIZ = 1 << this.RANDSIZL;
        this.randrsl = new Array(this.RANDSIZ);
        this.mm = new Array(this.RANDSIZ);
        this.aa = 0;
        this.bb = 0;
        this.cc = 0;
        this.randcnt = 0;
        this.init(seed, nonce);
      }
      
      init(seed, nonce) {
        for (let i = 0; i < this.RANDSIZ; i++) {
          this.mm[i] = 0;
          this.randrsl[i] = 0;
        }
        
        if (seed !== null && seed !== undefined) {
          this.randrsl[0] = Math.abs(Math.floor(seed)) >>> 0;
        }
        
        if (nonce !== null && nonce !== undefined) {
          this.randrsl[1] = Math.abs(Math.floor(nonce)) >>> 0;
        }
        
        const now = Date.now();
        this.randrsl[2] = now & 0xffffffff;
        this.randrsl[3] = (now >>> 32) & 0xffffffff;
        
        for (let i = 4; i < this.RANDSIZ; i++) {
          this.randrsl[i] = (Math.random() * 0x100000000) >>> 0;
        }
        
        this.randinit();
      }
      
      randinit() {
        let a, b, c, d, e, f, g, h;
        a = b = c = d = e = f = g = h = 0x9e3779b9;
        
        for (let i = 0; i < 4; i++) {
          a ^= b << 11; d += a; b += c;
          b ^= c >>> 2; e += b; c += d;
          c ^= d << 8; f += c; d += e;
          d ^= e >>> 16; g += d; e += f;
          e ^= f << 10; h += e; f += g;
          f ^= g >>> 4; a += f; g += h;
          g ^= h << 8; b += g; h += a;
          h ^= a >>> 9; c += h; a += b;
        }
        
        for (let i = 0; i < this.RANDSIZ; i += 8) {
          a += this.randrsl[i]; b += this.randrsl[i + 1];
          c += this.randrsl[i + 2]; d += this.randrsl[i + 3];
          e += this.randrsl[i + 4]; f += this.randrsl[i + 5];
          g += this.randrsl[i + 6]; h += this.randrsl[i + 7];
          
          a ^= b << 11; d += a; b += c;
          b ^= c >>> 2; e += b; c += d;
          c ^= d << 8; f += c; d += e;
          d ^= e >>> 16; g += d; e += f;
          e ^= f << 10; h += e; f += g;
          f ^= g >>> 4; a += f; g += h;
          g ^= h << 8; b += g; h += a;
          h ^= a >>> 9; c += h; a += b;
          
          this.mm[i] = a; this.mm[i + 1] = b;
          this.mm[i + 2] = c; this.mm[i + 3] = d;
          this.mm[i + 4] = e; this.mm[i + 5] = f;
          this.mm[i + 6] = g; this.mm[i + 7] = h;
        }
        
        this.isaac();
        this.randcnt = this.RANDSIZ;
      }
      
      isaac() {
        this.cc++;
        this.bb += this.cc;
        
        for (let i = 0; i < this.RANDSIZ; i++) {
          const x = this.mm[i];
          
          switch (i % 4) {
            case 0: this.aa ^= this.aa << 13; break;
            case 1: this.aa ^= this.aa >>> 6; break;
            case 2: this.aa ^= this.aa << 2; break;
            case 3: this.aa ^= this.aa >>> 16; break;
          }
          
          this.aa += this.mm[(i + 128) % this.RANDSIZ];
          this.mm[i] = (this.mm[(x >>> 2) & 0xff] + this.aa + this.bb) >>> 0;
          this.randrsl[i] = this.bb = (this.mm[(this.mm[i] >>> 10) & 0xff] + x) >>> 0;
        }
      }
      
      next() {
        if (this.randcnt >= this.RANDSIZ) {
          this.isaac();
          this.randcnt = 0;
        }
        return this.randrsl[this.randcnt++];
      }
      
      random() {
        return this.next() / 0x100000000;
      }
      
      randomFloat(min, max) {
        return min + this.random() * (max - min);
      }
    }`;
  }

  private static generateISAACRNGArrayLogic(): string {
    return `
      const arrayLength = Math.max(1, Math.min(size, 1000)); // Limit to 1000 items
      const isaac = new IsaacRNG(seed, nonce);
      const array = [];
      
      for (let i = 0; i < arrayLength; i++) {
        const randomValue = isaac.randomFloat(0, 1000000000000);
        array.push(randomValue);
      }`;
  }

  // ============================================================================
  // FORMULA OPERATIONS
  // ============================================================================

  private static generateSPFLogic(): string {
    return `
      try {
        // Simple formula evaluation (for Edge Functions)
        const result = eval(mathFormula.replace(/x/g, parameterValue));
        
        if (typeof result !== 'number') {
          throw new Error('Formula must evaluate to a number');
        }
        
        if (!isFinite(result)) {
          throw new Error('Formula produced non-finite value');
        }
      } catch (error: any) {
        throw new Error('Formula evaluation error: ' + error.message);
      }`;
  }

  private static generateMFAGLogic(): string {
    return `
      try {
        const length = Math.max(1, Math.min(arrayLength, 1000)); // Limit to 1000 items
        const items = [];
        
        for (let i = 0; i < length; i++) {
          const result = eval(mathFormula.replace(/x/g, i));
          
          if (typeof result !== 'number') {
            throw new Error('Formula must evaluate to a number');
          }
          
          if (!isFinite(result)) {
            throw new Error('Formula produced non-finite value');
          }
          
          items.push(result);
        }
      } catch (error: any) {
        throw new Error('Formula evaluation error: ' + error.message);
      }`;
  }
}

// ============================================================================
// MAIN MATH NODE CONVERTER
// ============================================================================

/**
 * Math Node Converter - Main class for converting math nodes to Supabase Edge Function code
 */
export class MathNodeConverter {
  /**
   * Check if a node type is a math node
   */
  public isMathNode(nodeType: string): boolean {
    return MathNodeRegistry.isMathNode(nodeType);
  }

  /**
   * Generate function definition for a math node
   */
  public generateMathNodeFunctionDefinition(node: Node, functionName: string): string {
    const nodeType = node.typename;
    const config = MathNodeRegistry.getMathNodeConfig(nodeType);

    if (!config) {
      throw new Error(`Math node configuration not found for type: ${nodeType}`);
    }

    // Merge default values with node parameters
    const mergedDefaults = { ...config.defaultValues, ...node.parameters };

    // Scalar-arithmetic nodes take plain numbers. The runtime nodes coerce their
    // inputs via Number() (validateNumberInput), so the generated logic must too —
    // otherwise a UI text field feeding "5" makes Addition do "5"+"3" = "53".
    // Array / RNG / formula nodes are excluded (their inputs aren't plain numbers).
    const numericScalarNodes = new Set<string>([
      'Addition', 'Subtraction', 'Multiplication', 'Division', 'Modulo',
      'Min', 'Max', 'Round', 'Floor', 'Ceil', 'Less Than Or Equal', 'Equal'
    ]);

    // Generate input parameter mapping
    const inputMapping = this.generateInputMapping(config.inputPorts, mergedDefaults, numericScalarNodes.has(nodeType));

    // Generate the core calculation logic
    const calculationLogic = MathCalculationGenerator.generateCalculationLogic(nodeType);

    // Generate output mapping
    const outputMapping = this.generateOutputMapping(config.outputPorts);

    // Check if this is an ISAAC RNG node that needs the class definition
    const needsIsaacClass =
      nodeType === 'ISAAC Random Number Generator' || nodeType === 'ISAAC Random Number Array Generator';
    const classDefinition = needsIsaacClass ? MathCalculationGenerator.generateISAACRNGClassDefinition() : '';

    return `${classDefinition}
    const ${functionName} = (inputs: Record<string, any>) => {
      // Input parameter mapping
      ${inputMapping}
      
      // Core calculation logic
      ${calculationLogic}
      
      // Return results
      return { ${outputMapping} };
    };`;
  }

  /**
   * Generate input parameter mapping
   */
  private generateInputMapping(
    inputPorts: string[],
    defaultValues: Record<string, any>,
    coerceNumeric = false
  ): string {
    return inputPorts
      .map((port) => {
        const sanitizedPort = this.sanitizeParameterName(port);
        const defaultValue = this.formatDefaultValue(defaultValues[port]);
        const read = coerceNumeric ? `Number(inputs.${sanitizedPort})` : `inputs.${sanitizedPort}`;
        return `const ${port} = inputs.${sanitizedPort} !== undefined ? ${read} : ${defaultValue};`;
      })
      .join('\n      ');
  }

  /**
   * Generate output parameter mapping
   */
  private generateOutputMapping(outputPorts: string[]): string {
    return outputPorts
      .map((port) => {
        const sanitizedPort = this.sanitizeParameterName(port);
        return `${sanitizedPort}: ${port}`;
      })
      .join(', ');
  }

  /**
   * Format default value for JavaScript
   */
  private formatDefaultValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  }

  /**
   * Sanitize parameter name for JavaScript
   */
  private sanitizeParameterName(name: string): string {
    return name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  }
}
