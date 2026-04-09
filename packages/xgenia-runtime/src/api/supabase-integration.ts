/**
 * Supabase Edge Functions Integration for XGENIA
 *
 * This module provides seamless integration between XGENIA cloud functions
 * and Supabase Edge Functions, allowing users to:
 * 1. Sync existing Supabase Edge Functions to XGENIA
 * 2. Deploy XGENIA cloud functions to Supabase
 * 3. Manage Edge Functions from within the XGENIA editor
 */

import * as acorn from 'acorn';
import { randomUUID } from 'crypto';
import type { Node, Program } from 'estree';

import {
    GeneratedSupabaseFunction,
    SupabaseEdgeFunctionManager,
    SupabaseFunctionDetails,
    SupabaseFunctionMetadata,
    XgeniaComponent
} from './supabase-converter';

// ============================================================================
// INTEGRATION TYPES
// ============================================================================

/**
 * XgeniaCloudFunction interface - matches the actual cloud function component structure
 */
export interface XgeniaCloudFunction {
  name: string;
  id: string;
  graph: {
    connections: XgeniaConnection[];
    roots: XgeniaNode[];
    visualRoots: any[];
  };
  dependentComponents?: XgeniaCloudFunction[];
}

/**
 * XGENIA connection structure
 */
export interface XgeniaConnection {
  fromId: string;
  fromProperty: string;
  toId: string;
  toProperty: string;
}

/**
 * XGENIA node structure - matches the actual structure from cloud function components
 */
export interface XgeniaNode {
  id: string;
  type: string | { name: string };
  x?: number;
  y?: number;
  parameters: Record<string, any>;
  ports?: any[];
  dynamicports?: XgeniaPort[];
  children?: any[];
}

/**
 * XGENIA port structure
 */
export interface XgeniaPort {
  name: string;
  displayName?: string;
  plug: 'input' | 'output';
  type: string | { name: string };
  group: string;
  index?: number;
}

/**
 * Supabase project configuration from XGENIA cloud service
 */
export interface SupabaseProjectConfig {
  projectId: string;
  accessToken?: string;
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
}

/**
 * Sync result for Edge Functions
 */
export interface EdgeFunctionSyncResult {
  imported: XgeniaCloudFunction[];
  exported: SupabaseFunctionDetails[];
  errors: string[];
}

/**
 * Edge Function import options
 */
export interface ImportOptions {
  overwriteExisting?: boolean;
  createAsDraft?: boolean;
  includeInactive?: boolean;
}

/**
 * Edge Function export options
 */
export interface ExportOptions {
  updateExisting?: boolean;
  deployImmediately?: boolean;
  includeMetadata?: boolean;
}

/**
 * Parsed function result from AST analysis
 */
interface ParsedFunctionResult {
  parameters: string[];
  responseFields: string[];
  logicScript: string; // Add this to store the function's core logic
  requiresAuth: boolean;
  hasErrorResponse: boolean;
  errorResponseFields: string[];
}

// ============================================================================
// AST PARSING UTILITIES
// ============================================================================

/**
 * Walk through AST nodes and apply visitors
 */
function walk(ast: Node, visitors: { [type: string]: (node: any) => void }) {
  function visit(node: Node) {
    if (visitors[node.type]) {
      visitors[node.type](node);
    }
    for (const key in node) {
      if (Object.prototype.hasOwnProperty.call(node, key)) {
        const child = (node as any)[key];
        if (typeof child === 'object' && child !== null) {
          if (Array.isArray(child)) {
            child.forEach((c) => c && c.type && visit(c));
          } else if (child.type) {
            visit(child);
          }
        }
      }
    }
  }
  visit(ast);
}

/**
 * Parse Supabase function code using AST to extract parameters and response fields
 */
export function parseSupabaseFunctionCodeWithAST(sourceCode: string): ParsedFunctionResult {
  console.log('🔍 AST Parser: Starting to parse source code...');
  console.log('📄 Source code preview:', sourceCode.substring(0, 300) + '...');

  const result: ParsedFunctionResult = {
    parameters: [],
    responseFields: [],
    logicScript: '', // Initialize logicScript
    requiresAuth: false,
    hasErrorResponse: false,
    errorResponseFields: []
  };

  // Track context for better response field detection
  let inTryBlock = false;
  let inCatchBlock = false;
  let foundSuccessResponse = false;
  let foundErrorResponse = false;

  try {
    // Clean the source code by removing null bytes and other control characters
    const cleanedSourceCode = sourceCode
      .replace(/\0/g, '') // Remove null bytes
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove other control characters
      .trim(); // Remove leading/trailing whitespace

    console.log('🧹 Cleaned source code length:', cleanedSourceCode.length);
    console.log('📄 Cleaned source code preview:', cleanedSourceCode.substring(0, 200) + '...');

    const ast = acorn.parse(cleanedSourceCode, {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Enable locations to extract code snippets
      locations: true
    }) as Program;

    console.log('🌳 AST parsed successfully, walking through nodes...');

    let requestNodeEnd = 0;
    let responseNodeStart = cleanedSourceCode.length;

    walk(ast, {
      TryStatement(node) {
        console.log('🔍 Found TryStatement');
        inTryBlock = true;
        inCatchBlock = false;
      },
      CatchClause(node) {
        console.log('🔍 Found CatchClause');
        inTryBlock = false;
        inCatchBlock = true;
      },
      VariableDeclarator(node) {
        console.log('🔍 Found VariableDeclarator:', node.id.type);

        // Look for parameter extraction from req.json()
        if (
          node.init?.type === 'AwaitExpression' &&
          node.init.argument?.type === 'CallExpression' &&
          (node.init.argument.callee as any)?.property?.name === 'json'
        ) {
          console.log('✅ Found req.json() call with destructuring');
          if (node.id.type === 'ObjectPattern') {
            result.parameters = node.id.properties.map((prop) => (prop as any).key.name);
            console.log('📥 Extracted parameters:', result.parameters);
            // @ts-ignore
            requestNodeEnd = node.end;
          }
        }
      },
      ReturnStatement(node) {
        console.log('🔍 Found ReturnStatement - inTryBlock:', inTryBlock, 'inCatchBlock:', inCatchBlock);

        // Look for Response constructor with JSON.stringify
        if (
          node.argument?.type === 'NewExpression' &&
          node.argument.callee.type === 'Identifier' &&
          node.argument.callee.name === 'Response'
        ) {
          console.log('✅ Found Response constructor');
          const stringifyCall = node.argument.arguments.find(
            (arg) =>
              arg.type === 'CallExpression' &&
              (arg.callee as any)?.object?.name === 'JSON' &&
              (arg.callee as any)?.property?.name === 'stringify'
          );
          if (stringifyCall && (stringifyCall as any).arguments[0]?.type === 'ObjectExpression') {
            const responseFields = (stringifyCall as any).arguments[0].properties.map((prop: any) => prop.key.name);

            // Extract response fields based on context
            if (inTryBlock && !inCatchBlock && !foundSuccessResponse) {
              // Success response from try block
              result.responseFields = responseFields;
              foundSuccessResponse = true;
              console.log('📤 Extracted response fields (success path):', result.responseFields);
              // @ts-ignore
              if (node.start < responseNodeStart) responseNodeStart = node.start;
            } else if (inCatchBlock && !foundErrorResponse) {
              // Error response from catch block
              result.hasErrorResponse = true;
              result.errorResponseFields = responseFields;
              foundErrorResponse = true;
              console.log('📤 Extracted response fields (error path):', result.errorResponseFields);
            } else if (!inTryBlock && !inCatchBlock && !foundSuccessResponse) {
              // Response outside try-catch (simple function)
              result.responseFields = responseFields;
              foundSuccessResponse = true;
              console.log('📤 Extracted response fields (simple function):', result.responseFields);
              // @ts-ignore
              if (node.start < responseNodeStart) responseNodeStart = node.start;
            } else {
              console.log('⏭️ Skipping additional response fields:', responseFields);
            }
          }
        }
      },
      // Check for authentication requirements
      MemberExpression(node) {
        if ((node.object as any)?.name === 'req' && (node.property as any)?.name === 'headers') {
          result.requiresAuth = true;
        }
      },
      CallExpression(node) {
        if (
          (node.callee as any)?.property?.name === 'get' &&
          (node.callee as any)?.object?.object?.name === 'req' &&
          (node.callee as any)?.object?.property?.name === 'headers'
        ) {
          result.requiresAuth = true;
        }
      }
    });

    // Extract logic script based on node positions
    if (requestNodeEnd > 0 && responseNodeStart > requestNodeEnd) {
      result.logicScript = cleanedSourceCode.substring(requestNodeEnd, responseNodeStart).trim();
      console.log('📜 Extracted logic script:', result.logicScript);
    }

    console.log('🎯 AST parsing complete. Final result:', result);
  } catch (error: any) {
    console.warn('❌ AST parsing failed:', error.message);
    console.log('🔄 Falling back to regex parsing...');
    // Fallback to regex parsing if AST fails
    return parseSupabaseFunctionCodeWithRegex(sourceCode);
  }

  return result;
}

/**
 * Fallback regex-based parsing for when AST parsing fails
 */
function parseSupabaseFunctionCodeWithRegex(sourceCode: string): ParsedFunctionResult {
  console.log('🔧 Using regex fallback parsing...');

  const parameters: string[] = [];
  const responseFields: string[] = [];
  let requiresAuth = false;
  let hasErrorResponse = false;
  const errorResponseFields: string[] = [];
  let logicScript = '';

  try {
    // Extract parameters from JSON destructuring
    const paramMatch = sourceCode.match(/const\s*{\s*([^}]+)\s*}\s*=\s*await\s*req\.json\(\)/);
    if (paramMatch) {
      const paramString = paramMatch[1];
      parameters.push(...paramString.split(',').map((p) => p.trim()));
    }

    // A simplified way to find logic: everything between param extraction and return
    const logicMatch = sourceCode.match(/await req\.json\(\);([\s\S]*)return new Response/);
    if (logicMatch && logicMatch[1]) {
      logicScript = logicMatch[1].trim();
    }

    // Check if function has try-catch structure
    const hasTryCatch = sourceCode.includes('try') && sourceCode.includes('catch');

    if (hasTryCatch) {
      // Extract success response fields from try block
      const tryBlockMatch = sourceCode.match(/try\s*{([\s\S]*?)}catch/);
      if (tryBlockMatch) {
        const tryBlockContent = tryBlockMatch[1];
        const responseMatch = tryBlockContent.match(/const\s+data\s*=\s*{\s*([^}]+)\s*}/s);
        if (responseMatch) {
          const responseString = responseMatch[1];
          const fieldMatches = responseString.match(/(\w+):/g);
          if (fieldMatches) {
            responseFields.push(...fieldMatches.map((match) => match.replace(':', '')));
          }
        }
      }

      // Extract error response fields from catch block
      const catchBlockMatch = sourceCode.match(/catch\s*\([^)]*\)\s*{([\s\S]*?)}/);
      if (catchBlockMatch) {
        const catchBlockContent = catchBlockMatch[1];
        const errorResponseMatch = catchBlockContent.match(/JSON\.stringify\(\s*{([^}]+)}\s*\)/);
        if (errorResponseMatch) {
          const errorResponseString = errorResponseMatch[1];
          const errorFieldMatches = errorResponseString.match(/(\w+):/g);
          if (errorFieldMatches) {
            errorResponseFields.push(...errorFieldMatches.map((match) => match.replace(':', '')));
            hasErrorResponse = true;
          }
        }
      }
    } else {
      // Simple function without try-catch
      const responseMatch = sourceCode.match(/const\s+data\s*=\s*{\s*([^}]+)\s*}/s);
      if (responseMatch) {
        const responseString = responseMatch[1];
        const fieldMatches = responseString.match(/(\w+):/g);
        if (fieldMatches) {
          responseFields.push(...fieldMatches.map((match) => match.replace(':', '')));
        }
      }
    }

    // Check if authentication is required
    requiresAuth = sourceCode.includes('Authorization') || sourceCode.includes('Bearer');

    console.log(
      '✅ Regex parsing complete - Parameters:',
      parameters,
      'Response fields:',
      responseFields,
      'Has error response:',
      hasErrorResponse,
      'Error fields:',
      errorResponseFields
    );
  } catch (error: any) {
    console.warn('Failed to parse Supabase function code with regex:', error);
  }

  return { parameters, responseFields, requiresAuth, hasErrorResponse, errorResponseFields, logicScript };
}

// ============================================================================
// XGENIA FUNCTION BUILDER
// ============================================================================

/**
 * Builder class for creating XGENIA components from parsed Supabase functions
 */
class XgeniaFunctionBuilder {
  /**
   * The main public method to build a complete XGENIA component.
   */
  public build(functionName: string, parsed: ParsedFunctionResult): XgeniaComponent {
    // Create request and response nodes
    const requestNode = this._createRequestNode(parsed);
    const responseNode = this._createResponseNode(parsed);

    console.log('Request Node:', requestNode);
    console.log('Response Node:', responseNode);

    // Create a JavaScriptFunction node to represent the actual logic
    const logicNode = this._createJavaScriptFunctionNode(parsed);

    // Create connections between the nodes
    const connections = this._createConnections(requestNode, logicNode, responseNode, parsed);

    return {
      name: `/#__cloud__/${functionName}`,
      id: randomUUID(), // Generate a unique ID for the component
      graph: {
        connections: connections,
        roots: [requestNode, logicNode, responseNode],
        visualRoots: []
      }
    };
  }

  /**
   * Creates the detailed JSON object for the xgenia.cloud.request node.
   * @private
   */
  private _createRequestNode(parsed: ParsedFunctionResult): XgeniaNode {
    const dynamicports: XgeniaPort[] = parsed.parameters.map((param, index) => ({
      type: '*',
      plug: 'output',
      group: 'Parameters',
      name: `pm-${param}`,
      displayName: param,
      index: 5 + index
    }));

    return {
      id: randomUUID(),
      type: 'xgenia.cloud.request',
      x: 0,
      y: 0,
      parameters: {
        allowNoAuth: !parsed.requiresAuth,
        params: parsed.parameters.join(',')
      },
      ports: [],
      dynamicports: dynamicports,
      children: []
    };
  }

  /**
   * Creates the detailed JSON object for the xgenia.cloud.response node.
   * @private
   */
  private _createResponseNode(parsed: ParsedFunctionResult): XgeniaNode {
    const dynamicports: XgeniaPort[] = parsed.responseFields.map((field, index) => ({
      type: '*',
      plug: 'input',
      group: 'Parameters',
      name: `pm-${field}`,
      displayName: field,
      index: 4 + index
    }));

    return {
      id: randomUUID(),
      type: 'xgenia.cloud.response',
      x: 300,
      y: 0,
      parameters: {
        params: parsed.responseFields.join(',')
      },
      ports: [],
      dynamicports: dynamicports,
      children: []
    };
  }

  /**
   * Creates a JavaScriptFunction node to represent the actual logic
   * @private
   */
  private _createJavaScriptFunctionNode(parsed: ParsedFunctionResult): XgeniaNode {
    // Create input ports for parameters
    const inputPorts: XgeniaPort[] = parsed.parameters.map((param, index) => ({
      name: `in-${param}`,
      displayName: param,
      plug: 'input',
      type: '*',
      group: 'Inputs',
      index: 4 + index
    }));

    // Create output ports for response fields
    const outputPorts: XgeniaPort[] = parsed.responseFields.map((field, index) => ({
      name: `out-${field}`,
      displayName: field,
      plug: 'output',
      type: '*',
      group: 'Outputs',
      index: 6 + index
    }));

    // Use the extracted logic script
    const functionScript = parsed.logicScript || this._generateFunctionScript(parsed);

    return {
      id: randomUUID(),
      type: 'JavaScriptFunction',
      x: 150,
      y: 0,
      parameters: {
        functionScript: functionScript
      },
      ports: [],
      dynamicports: [...inputPorts, ...outputPorts],
      children: []
    };
  }

  /**
   * Creates connections between the nodes
   * @private
   */
  private _createConnections(
    requestNode: XgeniaNode,
    logicNode: XgeniaNode,
    responseNode: XgeniaNode,
    parsed: ParsedFunctionResult
  ): any[] {
    const connections: any[] = [];

    // Connect request receive to logic run
    connections.push({
      fromId: requestNode.id,
      fromProperty: 'receive',
      toId: logicNode.id,
      toProperty: 'run'
    });

    // Connect request parameters to logic inputs
    parsed.parameters.forEach((param) => {
      connections.push({
        fromId: requestNode.id,
        fromProperty: `pm-${param}`,
        toId: logicNode.id,
        toProperty: `in-${param}`
      });
    });

    // Connect logic outputs to response parameters
    parsed.responseFields.forEach((field) => {
      connections.push({
        fromId: logicNode.id,
        fromProperty: `out-${field}`,
        toId: responseNode.id,
        toProperty: `pm-${field}`
      });
    });

    return connections;
  }

  /**
   * Generates a simple function script based on the parsed parameters and response fields
   * @private
   */
  private _generateFunctionScript(parsed: ParsedFunctionResult): string {
    // Create a simple script that processes inputs and creates outputs
    const inputAssignments = parsed.parameters.map((param) => `Inputs.${param} = ${param};`).join('\n');

    const outputAssignments = parsed.responseFields.map((field) => `const ${field} = Outputs.${field};`).join('\n');

    const logicScript = parsed.responseFields
      .map((field) => {
        // Create simple logic based on the field name
        if (field.toLowerCase().includes('message') || field.toLowerCase().includes('result')) {
          return `Outputs.${field} = \`Processed: \${Inputs.${parsed.parameters[0] || 'input'}}\`;`;
        } else if (field.toLowerCase().includes('data')) {
          return `Outputs.${field} = { processed: true, input: Inputs.${parsed.parameters[0] || 'input'} };`;
        } else {
          return `Outputs.${field} = Inputs.${parsed.parameters[0] || 'input'};`;
        }
      })
      .join('\n');

    return `// JavaScript Function Logic
const Inputs = {
${parsed.parameters.map((param) => `  ${param}: undefined`).join(',\n')}
};

const Outputs = {
${parsed.responseFields.map((field) => `  ${field}: undefined`).join(',\n')}
};

// Extract input values from request parameters
${inputAssignments}

// Process the inputs
${logicScript}

// Prepare output values
${outputAssignments}`;
  }
}

// ============================================================================
// SUPABASE TO XGENIA CONVERTER (NEW IMPLEMENTATION)
// ============================================================================

// Define simplified internal types for clarity
interface XgeniaNodeInternal {
  id: string;
  type: string;
  label?: string;
  parameters: Record<string, any>;
  dynamicports: any[];
  [key: string]: any;
}

interface XgeniaConnectionInternal {
  fromId: string;
  fromProperty: string;
  toId: string;
  toProperty: string;
}

class SupabaseToXgeniaConverter {
  private readonly functionName: string;
  private readonly tsCode: string;

  // State maps to build the graph
  private nodes = new Map<string, XgeniaNodeInternal>();
  private connections: XgeniaConnectionInternal[] = [];
  private funcNameToNodeId = new Map<string, string>();
  private resultVarToNodeId = new Map<string, string>();
  private requestNodeId: string = '';
  private responseNodeId: string = '';

  constructor(functionName: string, tsCode: string) {
    this.functionName = functionName;
    this.tsCode = tsCode;
  }

  /**
   * The main conversion method.
   * @returns The XGENIA JSON component object.
   */
  public convert(): object {
    // First, try to extract the original XGENIA metadata from the comment block
    const originalComponent = this.extractXgeniaMetadata();
    if (originalComponent) {
      return originalComponent;
    }

    // Isolate the core logic block to make regex simpler and more reliable
    const coreLogic = this.extractCoreLogic();
    if (!coreLogic) {
      throw new Error('Could not find the core logic block inside the try-catch.');
    }

    // 1. Create boilerplate Request and Response nodes
    this.createBoilerplateNodes();

    // 2. Find all function definitions and create JavaScriptFunction nodes
    this.parseFunctionDefinitions(coreLogic);

    // 3. Find all function invocations and create the connections
    this.parseFunctionInvocations(coreLogic);

    // 4. Find the final return statement to connect the Response node
    this.parseFinalResponse(coreLogic);

    // 5. Assemble and return the final component
    return {
      name: `/#__cloud__/${this.functionName}`,
      id: randomUUID(),
      graph: {
        connections: this.connections,
        roots: Array.from(this.nodes.values())
      }
    };
  }

  /**
   * Extracts the original XGENIA component structure from the XGENIA_METADATA comment block.
   * @returns The original component structure if found, null otherwise.
   */
  private extractXgeniaMetadata(): object | null {
    try {
      // Look for the XGENIA_METADATA comment block
      const metadataMatch = this.tsCode.match(/\/\*\s*XGENIA_METADATA\s*\n([\s\S]*?)\s*\*\//);

      if (!metadataMatch) {
        return null;
      }

      const metadataJson = metadataMatch[1].trim();

      // Parse the JSON to get the original component structure
      const originalComponent = JSON.parse(metadataJson);

      // Validate that it has the expected structure
      if (originalComponent && originalComponent.name && originalComponent.graph) {
        return originalComponent;
      } else {
        return null;
      }
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Extracts the code inside the main `try { ... }` block.
   */
  private extractCoreLogic(): string | null {
    const match = this.tsCode.match(/try\s*{([\s\S]*?)} catch/);
    return match ? match[1].trim() : null;
  }

  private createBoilerplateNodes(): void {
    this.requestNodeId = randomUUID();
    this.responseNodeId = randomUUID();

    this.nodes.set(this.requestNodeId, {
      id: this.requestNodeId,
      type: 'xgenia.cloud.request',
      parameters: {},
      dynamicports: []
    });
    this.nodes.set(this.responseNodeId, {
      id: this.responseNodeId,
      type: 'xgenia.cloud.response',
      parameters: { params: 'result' },
      dynamicports: [
        {
          type: '*',
          plug: 'input',
          group: 'Parameters',
          name: 'pm-result',
          displayName: 'result'
        }
      ]
    });
  }

  /**
   * Finds and processes all `const Func = (inputs) => { ... };` blocks.
   */
  private parseFunctionDefinitions(logic: string): void {
    const regex = /const\s+([\w_]+)\s*=\s*\(([^)]*)\)\s*=>\s*{([\s\S]*?)};/g;
    let match;
    while ((match = regex.exec(logic)) !== null) {
      const functionName = match[1];
      const functionBody = match[3].trim();
      const nodeId = randomUUID();

      const { script, inputPorts, outputPorts } = this.parseFunctionBody(functionBody);

      this.nodes.set(nodeId, {
        id: nodeId,
        type: 'JavaScriptFunction',
        label: functionName,
        parameters: { functionScript: script },
        dynamicports: [...inputPorts, ...outputPorts]
      });

      this.funcNameToNodeId.set(functionName, nodeId);
    }
  }

  /**
   * Analyzes the body of a single function to find its ports and reformat its script.
   */
  private parseFunctionBody(body: string): {
    script: string;
    inputPorts: any[];
    outputPorts: any[];
  } {
    const inputPorts: any[] = [];
    const outputPorts: any[] = [];
    const inputNames = new Set<string>();

    // Find all `inputs.variable` to determine input ports
    const inputRegex = /inputs\.(\w+)/g;
    let inputMatch;
    while ((inputMatch = inputRegex.exec(body)) !== null) {
      inputNames.add(inputMatch[1]);
    }

    inputNames.forEach((name) => {
      inputPorts.push({
        name: `in-${name}`,
        displayName: name,
        plug: 'input',
        type: '*',
        group: 'Inputs'
      });
    });

    // Find the return statement to determine output ports
    const returnRegex = /return\s*{\s*([^}]+)\s*}/;
    const returnMatch = body.match(returnRegex);
    if (returnMatch) {
      const outputNames = returnMatch[1].split(',').map((s) => s.trim());
      outputNames.forEach((name) => {
        outputPorts.push({
          name: `out-${name}`,
          displayName: name,
          plug: 'output',
          type: '*',
          group: 'Outputs'
        });
      });
    }

    // Convert the function body to XGENIA's `Outputs` format
    let script = body;
    script = script.replace(/let\s+[\w_]+;/g, '').trim(); // Remove variable initializations
    script = script.replace(returnRegex, '').trim(); // Remove the return statement
    script = script.replace(/inputs\.(\w+)/g, 'Inputs.$1'); // Replace inputs
    script = script.replace(/(\w+)\s*=\s*([^;]+);/g, 'Outputs.$1 = $2;'); // Replace assignments

    return { script, inputPorts, outputPorts };
  }

  /**
   * Finds and processes all `const FuncResult = Func({ ... });` blocks to create connections.
   */
  private parseFunctionInvocations(logic: string): void {
    const regex = /const\s+([\w_]+Result)\s*=\s*([\w_]+)\s*\(([\s\S]*?)\);/g;
    let match;
    while ((match = regex.exec(logic)) !== null) {
      const resultVar = match[1];
      const functionName = match[2];
      const argsObject = match[3].trim();

      const toNodeId = this.funcNameToNodeId.get(functionName);
      if (!toNodeId) continue;

      this.resultVarToNodeId.set(resultVar, toNodeId);

      // Parse arguments inside the object to create connections
      const argRegex = /(\w+):\s*([\w_]+)\.(\w+)/g;
      let argMatch;
      while ((argMatch = argRegex.exec(argsObject)) !== null) {
        const toProperty = `in-${argMatch[1]}`;
        const fromVar = argMatch[2]; // e.g., 'requestBody' or 'FunctionResult'
        const fromPropertyDisplayName = argMatch[3];

        let fromNodeId: string | undefined;
        let fromProperty: string = '';

        if (fromVar === 'requestBody') {
          fromNodeId = this.requestNodeId;
          fromProperty = `pm-${fromPropertyDisplayName}`;
          this.addPortToRequestNode(fromPropertyDisplayName); // Ensure the port exists
        } else {
          fromNodeId = this.resultVarToNodeId.get(fromVar);
          fromProperty = `out-${fromPropertyDisplayName}`;
        }

        if (fromNodeId) {
          this.connections.push({
            fromId: fromNodeId,
            fromProperty,
            toId: toNodeId,
            toProperty
          });
        }
      }
    }
  }

  /**
   * Connects the final result to the Response node.
   */
  private parseFinalResponse(logic: string): void {
    const match = logic.match(/return new Response\(JSON\.stringify\(([\w_]+Result)\)/);
    if (!match) return;

    const finalResultVar = match[1];
    const fromNodeId = this.resultVarToNodeId.get(finalResultVar);
    if (!fromNodeId) return;

    const fromNode = this.nodes.get(fromNodeId);
    const fromPort = fromNode?.dynamicports.find((p) => p.plug === 'output');
    if (fromPort) {
      this.connections.push({
        fromId: fromNodeId,
        fromProperty: fromPort.name,
        toId: this.responseNodeId,
        toProperty: 'pm-result'
      });
    }
  }

  /**
   * Helper to dynamically add ports to the Request node as they are discovered.
   */
  private addPortToRequestNode(paramName: string): void {
    const requestNode = this.nodes.get(this.requestNodeId);
    if (requestNode && !requestNode.dynamicports.some((p) => p.displayName === paramName)) {
      requestNode.dynamicports.push({
        type: '*',
        plug: 'output',
        group: 'Parameters',
        name: `pm-${paramName}`,
        displayName: paramName
      });
    }
  }
}

// ============================================================================
// SUPABASE INTEGRATION SERVICE
// ============================================================================

/**
 * Main integration service for Supabase Edge Functions
 */
export class SupabaseEdgeFunctionIntegration {
  private manager: SupabaseEdgeFunctionManager;
  private projectConfig: SupabaseProjectConfig | null = null;

  constructor() {
    this.manager = new SupabaseEdgeFunctionManager();
  }

  /**
   * Configure the integration with Supabase project details
   */
  public configure(config: SupabaseProjectConfig): void {
    this.projectConfig = config;

    if (config.accessToken) {
      this.manager.configure({
        projectId: config.projectId,
        accessToken: config.accessToken
      });
    }
  }

  /**
   * Check if the integration is properly configured
   */
  public isConfigured(): boolean {
    return this.projectConfig !== null && this.projectConfig.accessToken !== undefined && this.manager.isConfigured();
  }

  /**
   * Get the current project configuration
   */
  public getProjectConfig(): SupabaseProjectConfig | null {
    return this.projectConfig;
  }

  /**
   * Extract project ID from Supabase URL
   */
  public static extractProjectIdFromUrl(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Extract project ID from hostname like "yourproject.supabase.co"
      const match = hostname.match(/^([^.]+)\.supabase\.(co|io)$/);
      return match ? match[1] : null;
    } catch (error: any) {
      return null;
    }
  }

  /**
   * Sync Edge Functions from Supabase to XGENIA
   */
  public async syncFromSupabase(options: ImportOptions = {}): Promise<EdgeFunctionSyncResult> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    const result: EdgeFunctionSyncResult = {
      imported: [],
      exported: [],
      errors: []
    };

    try {
      // Get only XGENIA-deployed Edge Functions by slug prefix (no code fetch)
      const supabaseFunctions = (await this.manager.getFunctions()).filter(
        (f) => f.slug.startsWith('xgenia_') || f.slug.startsWith('xgenia')
      );

      // Filter functions based on options
      const functionsToImport = supabaseFunctions.filter((func) => {
        if (!options.includeInactive && func.status !== 'ACTIVE') {
          return false;
        }
        return true;
      });

      // Convert each Supabase function to XGENIA format without fetching code
      for (const supabaseFunc of functionsToImport) {
        try {
          const xgeniaFunction = this.convertFromSlugOnly(supabaseFunc);
          result.imported.push(xgeniaFunction);
        } catch (error: any) {
          result.errors.push(`Failed to import ${supabaseFunc.name}: ${error.message}`);
        }
      }
    } catch (error: any) {
      result.errors.push(`Failed to sync from Supabase: ${error.message}`);
    }

    return result;
  }

  /**
   * Sync XGENIA cloud functions to Supabase
   */
  public async syncToSupabase(
    xgeniaFunctions: XgeniaCloudFunction[],
    options: ExportOptions = {},
    projectContext?: any
  ): Promise<EdgeFunctionSyncResult> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    const result: EdgeFunctionSyncResult = {
      imported: [],
      exported: [],
      errors: []
    };

    try {
      // Convert to XgeniaComponent format and deploy with conflict resolution
      const components: XgeniaComponent[] = xgeniaFunctions.map((func) => ({
        name: func.name,
        id: func.id,
        displayName: func.name.replace('/#__cloud__/', ''),
        graph: {
          roots: func.graph.roots,
          connections: func.graph.connections,
          visualRoots: func.graph.visualRoots
        }
      }));

      // Deploy each component with conflict resolution
      const deployedFunctions: SupabaseFunctionDetails[] = [];
      for (const component of components) {
        try {
          const deployedFunction = await this.manager.deployComponentWithConflictResolution(component, projectContext, {
            overwriteExisting: options.updateExisting || false,
            deleteOldVersions: options.updateExisting || false
          });
          deployedFunctions.push(deployedFunction);
        } catch (error: any) {
          result.errors.push(`Failed to deploy ${component.name}: ${error.message}`);
        }
      }

      result.exported = deployedFunctions;
    } catch (error: any) {
      result.errors.push(`Failed to sync to Supabase: ${error.message}`);
    }

    return result;
  }

  /**
   * Convert a Supabase Edge Function to XGENIA format
   */
  public async convertSupabaseToXgenia(supabaseFunc: SupabaseFunctionMetadata): Promise<XgeniaCloudFunction> {
    // Legacy path retained for callers that still require full reconstruction
    console.log('The supabaseFunc is:', supabaseFunc);

    let tsCode: string;
    try {
      tsCode = await this.manager.getFunctionCode(supabaseFunc.slug);
    } catch (error: any) {
      console.error(`Failed to fetch function code for ${supabaseFunc.slug}:`, error);
      throw new Error(
        `Failed to fetch function code for ${supabaseFunc.slug}: ${error.message}. ` +
          `This may be due to changes in the Supabase ESZIP format or API.`
      );
    }

    // Validate that we got actual code
    if (!tsCode || tsCode.trim().length === 0) {
      throw new Error(`Function code for ${supabaseFunc.slug} is empty or null`);
    }

    console.log('The tsCode length is:', tsCode.length);
    console.log('The tsCode preview (first 200 chars):', tsCode.substring(0, 200));

    const functionName = supabaseFunc.slug;
    console.log('The functionName is:', functionName);

    try {
      const converter = new SupabaseToXgeniaConverter(functionName, tsCode);
      console.log('The converter is:', converter);
      const xgeniaComponent = converter.convert();
      console.log('The xgeniaComponent is:', xgeniaComponent);
      return xgeniaComponent as XgeniaCloudFunction;
    } catch (error: any) {
      console.error(`Failed to convert function ${functionName} to XGENIA format:`, error);
      throw new Error(`Failed to convert function ${functionName} to XGENIA format: ${error.message}`);
    }
  }

  /**
   * Fast-path conversion from slug only, without fetching function body.
   * Derives the XGENIA name by stripping the `xgenia_` prefix when present.
   */
  private convertFromSlugOnly(supabaseFunc: SupabaseFunctionMetadata): XgeniaCloudFunction {
    const slug = supabaseFunc.slug;
    const baseName = slug.startsWith('xgenia_') ? slug.substring('xgenia_'.length) : slug.replace(/^xgenia/, '');
    const xgeniaName = `/#__cloud__/${baseName}`;

    // Create an empty skeleton component; detailed graph will be populated on demand later
    return {
      name: xgeniaName,
      id: randomUUID(),
      graph: {
        connections: [],
        roots: [],
        visualRoots: []
      }
    };
  }

  /**
   * Get available Edge Functions from Supabase
   */
  public async getAvailableEdgeFunctions(): Promise<SupabaseFunctionMetadata[]> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    return await this.manager.getFunctions();
  }

  /**
   * Get only XGENIA-deployed Edge Functions from Supabase
   * Uses XGENIA_METADATA comment detection for reliable identification
   */
  public async getXgeniaEdgeFunctions(): Promise<SupabaseFunctionMetadata[]> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    return await this.manager.getXgeniaFunctions();
  }

  /**
   * Get details of a specific Edge Function
   */
  public async getEdgeFunctionDetails(functionName: string): Promise<SupabaseFunctionDetails> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    return await this.manager.getFunctionDetails(functionName);
  }

  /**
   * Get the source code of a specific Edge Function
   */
  public async getEdgeFunctionCode(functionName: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    return await this.manager.getFunctionCode(functionName);
  }

  /**
   * Convert XGENIA function to Supabase format
   */
  public convertToSupabase(xgeniaFunction: XgeniaCloudFunction): GeneratedSupabaseFunction {
    // Convert to XgeniaComponent format
    const component: XgeniaComponent = {
      name: xgeniaFunction.name,
      id: xgeniaFunction.id,
      displayName: xgeniaFunction.name.replace('/#__cloud__/', ''),
      graph: {
        roots: xgeniaFunction.graph.roots,
        connections: xgeniaFunction.graph.connections,
        visualRoots: xgeniaFunction.graph.visualRoots
      }
    };

    const payload = this.manager.convertComponent(component);
    if (!payload) {
      throw new Error(`Failed to convert function ${xgeniaFunction.name}`);
    }

    // Extract request and response nodes for parameter extraction
    const requestNode = xgeniaFunction.graph.roots.find((node) => node.type === 'xgenia.cloud.request');
    const responseNode = xgeniaFunction.graph.roots.find((node) => node.type === 'xgenia.cloud.response');

    return {
      functionName: xgeniaFunction.name.replace('/#__cloud__/', ''),
      sourceCode: payload.file[0],
      parameters: requestNode ? this.extractParameters(requestNode) : [],
      responseFields: responseNode ? this.extractResponseFields(responseNode) : []
    };
  }

  /**
   * Extract parameters from request node
   */
  private extractParameters(requestNode: any): string[] {
    if (requestNode.dynamicports && requestNode.dynamicports.length > 0) {
      return requestNode.dynamicports
        .filter((port: any) => port.plug === 'output' && port.name.startsWith('pm-'))
        .map((port: any) => port.name.replace('pm-', ''))
        .filter((param: string) => param.length > 0);
    }

    if (requestNode.parameters && requestNode.parameters.params) {
      return requestNode.parameters.params
        .split(',')
        .map((param: string) => param.trim())
        .filter((param: string) => param.length > 0);
    }

    return [];
  }

  /**
   * Extract response fields from response node
   */
  private extractResponseFields(responseNode: any): string[] {
    if (responseNode.dynamicports && responseNode.dynamicports.length > 0) {
      return responseNode.dynamicports
        .filter((port: any) => port.plug === 'input' && port.name.startsWith('pm-'))
        .map((port: any) => port.name.replace('pm-', ''))
        .filter((param: string) => param.length > 0);
    }

    if (responseNode.parameters && responseNode.parameters.params) {
      return responseNode.parameters.params
        .split(',')
        .map((param: string) => param.trim())
        .filter((param: string) => param.length > 0);
    }

    return [];
  }

  /**
   * Deploy a single XGENIA function to Supabase
   */
  public async deployFunction(
    xgeniaFunction: XgeniaCloudFunction,
    update: boolean = false
  ): Promise<SupabaseFunctionDetails> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    // Convert to XgeniaComponent format
    const component: XgeniaComponent = {
      name: xgeniaFunction.name,
      id: xgeniaFunction.id,
      displayName: xgeniaFunction.name.replace('/#__cloud__/', ''),
      graph: {
        roots: xgeniaFunction.graph.roots,
        connections: xgeniaFunction.graph.connections,
        visualRoots: xgeniaFunction.graph.visualRoots
      }
    };

    return await this.manager.deployComponent(component);
  }

  /**
   * Deploy multiple XGENIA functions to Supabase
   */
  public async deployFunctions(
    xgeniaFunctions: XgeniaCloudFunction[],
    update: boolean = false
  ): Promise<SupabaseFunctionDetails[]> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    // Convert to XgeniaComponent format
    const components: XgeniaComponent[] = xgeniaFunctions.map((func) => ({
      name: func.name,
      id: func.id,
      displayName: func.name.replace('/#__cloud__/', ''),
      graph: {
        roots: func.graph.roots,
        connections: func.graph.connections,
        visualRoots: func.graph.visualRoots
      }
    }));

    return await this.manager.deployComponents(components);
  }

  /**
   * Delete a Supabase Edge Function
   */
  public async deleteFunction(functionSlug: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Supabase integration not configured. Please set up access token.');
    }

    return await this.manager.deleteFunction(functionSlug);
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a new Supabase Edge Function integration instance
 */
export function createSupabaseIntegration(): SupabaseEdgeFunctionIntegration {
  return new SupabaseEdgeFunctionIntegration();
}

/**
 * Quick setup function for common use cases
 */
export function setupSupabaseIntegration(projectConfig: SupabaseProjectConfig): SupabaseEdgeFunctionIntegration {
  const integration = createSupabaseIntegration();
  integration.configure(projectConfig);
  return integration;
}

// Export default instance for convenience
export const supabaseIntegration = createSupabaseIntegration();
