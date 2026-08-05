/**
 * Supabase Edge Function Converter for XGENIA Cloud Functions
 *
 * This module provides functionality to:
 * 1. Convert XGENIA cloud function nodes to Supabase Edge Function format
 * 2. Deploy functions to Supabase programmatically
 * 3. Fetch and manage existing Supabase Edge Functions
 * 4. Handle secure credential storage and validation
 */

// Setup type definitions for built-in Supabase Runtime APIs
// import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Import math node converter

// Import collection node converter
import { CollectionNodeConverter } from './collection-node-converter';
import { MathNodeConverter } from './math-node-converter';
// Import RGS extra (provably-fair / data / I-O) node converter
import { RgsExtraNodeConverter } from './rgs-extra-node-converter';
// Import signal passthrough node converter
import { SignalPassthroughNodeConverter } from './signal-passthrough-node-converter';
// Import slot game node converter
import { SlotGameNodeConverter } from './slot-game-node-converter';
// Import standard library node converter
import { StdLibraryNodeConverter } from './std-library-node-converter';
// Import the RGS sandbox sanitizer (extracted pure function, parity-tested)
import { sanitizeForSandbox } from './sanitize-for-sandbox';
// Import shared types
import {
    Component,
    Connection,
    CorsConfiguration,
    Node,
    Project
} from './types';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supabase project configuration
 */
export interface SupabaseConfig {
  projectId: string;
  accessToken: string;
  region?: string; // Optional region override
}

/**
 * Supabase Edge Function metadata from API
 */
export interface SupabaseFunctionMetadata {
  id: string;
  slug: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'REMOVED';
  version: number;
  created_at: number; // Timestamp
  updated_at: number; // Timestamp
  verify_jwt: boolean;
  import_map: boolean;
  entrypoint_path: string;
  import_map_path: string | null;
}

/**
 * Full Supabase Edge Function details including source code
 */
export interface SupabaseFunctionDetails extends SupabaseFunctionMetadata {
  body: string; // The full source code of the function
}

/**
 * XGENIA port structure
 */
export interface XgeniaPort {
  name: string;
  plug: 'input' | 'output';
  type: string | { name: string };
  group: string;
  displayName?: string;
  index?: number;
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
 * Generated Supabase Edge Function code structure
 */
export interface GeneratedSupabaseFunction {
  functionName: string;
  sourceCode: string;
  parameters: string[];
  responseFields: string[];
}

/**
 * Supabase deployment payload structure
 */
export interface SupabaseDeploymentPayload {
  slug: string;
  file: string[];
  metadata: {
    entrypoint_path?: string;
    import_map_path?: string | null;
    static_patterns?: string[];
    verify_jwt: boolean;
    name: string;
  };
}

/**
 * XGENIA component structure for conversion
 */
export interface XgeniaComponent {
  name: string;
  id: string;
  displayName?: string;
  graph: {
    roots: XgeniaNode[];
    connections: XgeniaConnection[];
    visualRoots?: any[];
  };
}

/**
 * XGENIA node structure - matches the actual structure from cloud function components
 */
export interface XgeniaNode {
  id: string;
  type: string | { name: string };
  x?: number; // Position coordinates
  y?: number; // Position coordinates
  parameters: Record<string, any>;
  ports?: XgeniaPort[];
  dynamicports?: XgeniaPort[];
  children?: any[]; // For nested structures
}

// ============================================================================
// CREDENTIAL MANAGEMENT
// ============================================================================

/**
 * Secure credential storage and validation
 */
export class SupabaseCredentialManager {
  private static instance: SupabaseCredentialManager;
  private config: SupabaseConfig | null = null;

  private constructor() { }

  public static getInstance(): SupabaseCredentialManager {
    if (!SupabaseCredentialManager.instance) {
      SupabaseCredentialManager.instance = new SupabaseCredentialManager();
    }
    return SupabaseCredentialManager.instance;
  }

  /**
   * Set Supabase credentials securely
   */
  public setCredentials(config: SupabaseConfig): void {
    if (!config.projectId || !config.accessToken) {
      throw new Error('Supabase project ID and access token are required');
    }

    // Validate project ID format (should be a valid UUID or project identifier)
    if (!/^[a-zA-Z0-9-_]+$/.test(config.projectId)) {
      throw new Error('Invalid project ID format');
    }

    // Validate access token format (should be a valid JWT or API key)
    if (config.accessToken.length < 20) {
      throw new Error('Access token appears to be too short');
    }

    this.config = {
      ...config,
      region: config.region || 'us-east-1' // Default region
    };
  }

  /**
   * Get current credentials
   */
  public getCredentials(): SupabaseConfig {
    if (!this.config) {
      throw new Error('Supabase credentials not configured. Call setCredentials() first.');
    }
    return this.config;
  }

  /**
   * Check if credentials are configured
   */
  public isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * Clear stored credentials
   */
  public clearCredentials(): void {
    this.config = null;
  }
}

// ============================================================================
// ERROR FORMATTING UTILITY
// ============================================================================

/**
 * Format error messages for user-friendly display
 * Detects expired PAT and provides helpful guidance
 */
function formatSupabaseErrorMessage(operation: string, status: number, statusText: string, errorData: any): string {
  // Check for 401 Unauthorized (expired or invalid PAT)
  if (status === 401) {
    const errorMessage = errorData?.message || errorData?.error || statusText || '';
    if (
      errorMessage.toLowerCase().includes('unauthorized') ||
      errorMessage.toLowerCase().includes('invalid') ||
      errorMessage.toLowerCase().includes('token') ||
      errorMessage.toLowerCase().includes('expired')
    ) {
      return `Your Supabase Personal Access Token (PAT) has expired or is invalid. Please update your access token in the Cloud Service settings. You can get a new token from https://app.supabase.com/account/tokens`;
    }
    return `Authentication failed (401). Your Supabase access token may be expired. Please update your access token in the Cloud Service settings.`;
  }

  // Check for 403 Forbidden
  if (status === 403) {
    return `Access forbidden (403). Your Supabase access token may not have the required permissions. Please verify your token has Edge Functions management permissions.`;
  }

  // Check for 404 Not Found
  if (status === 404) {
    return `${operation} failed: Function not found (404). The function may not exist or has been deleted.`;
  }

  // Generic error with cleaned details
  const errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData);
  return `${operation} failed: ${errorDetails}`;
}

// ============================================================================
// SUPABASE API CLIENT
// ============================================================================

/**
 * Supabase API client for managing Edge Functions
 */
export class SupabaseAPIClient {
  private credentialManager: SupabaseCredentialManager;

  constructor() {
    this.credentialManager = SupabaseCredentialManager.getInstance();
  }

  /**
   * Get the base API URL for Supabase
   */
  private getApiUrl(): string {
    const config = this.credentialManager.getCredentials();
    return `https://api.supabase.com/v1/projects/${config.projectId}`;
  }

  /**
   * Get authorization headers
   */
  private getAuthHeaders(): Record<string, string> {
    const config = this.credentialManager.getCredentials();
    return {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Fetch all Edge Functions from Supabase project
   */
  public async fetchSupabaseEdgeFunctions(): Promise<SupabaseFunctionMetadata[]> {
    const apiUrl = `${this.getApiUrl()}/functions`;
    const options: RequestInit = {
      method: 'GET',
      headers: this.getAuthHeaders()
    };

    try {
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }
        throw new Error(
          formatSupabaseErrorMessage('Failed to fetch functions', response.status, response.statusText, errorData)
        );
      }

      return (await response.json()) as SupabaseFunctionMetadata[];
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Get detailed information about a specific Edge Function
   */
  public async getSupabaseEdgeFunctionDetail(functionName: string): Promise<SupabaseFunctionDetails> {
    const apiUrl = `${this.getApiUrl()}/functions/${functionName}`;
    const options: RequestInit = {
      method: 'GET',
      headers: this.getAuthHeaders()
    };

    try {
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }
        throw new Error(
          formatSupabaseErrorMessage(
            'Failed to fetch function details',
            response.status,
            response.statusText,
            errorData
          )
        );
      }
      const result: SupabaseFunctionDetails = await response.json();
      return result;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Extract source code from ESZIP format
   */
  private extractCodeFromEszip(rawEszipText: string): string {
    // Try multiple possible start markers (in order of preference)
    const startMarkers = [
      '//Please do not manipulate the code manually below this line.',
      '//PLease do not manipulate the code manually below this line.',
      '//Please do not manipulate the code manually below this line. It is used to deploy the function to Supabase.'
    ];

    // Try multiple possible end markers (in order of preference)
    const endMarkers = [
      '//NOTE: PLEASE DO NOT REMOVE THE XGENIA_METADATA COMMENT BLOCK.',
      '//NOTE: PLEASE DO NOT REMOVE THE XGENIA_METADATA COMMENT BLOCK. IT IS USED TO RE-STORE THE ORIGINAL XGENIA COMPONENT STRUCTURE.'
    ];

    // Find the first matching start marker
    let startIndex = -1;
    for (const marker of startMarkers) {
      startIndex = rawEszipText.indexOf(marker);
      if (startIndex !== -1) {
        break;
      }
    }

    // Find the last matching end marker (use lastIndexOf to get the actual end)
    let endIndex = -1;
    for (const marker of endMarkers) {
      const index = rawEszipText.lastIndexOf(marker);
      if (index !== -1) {
        endIndex = index;
        break;
      }
    }

    // Validate findings
    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      console.warn('Could not locate function boundaries in the provided text.');
      console.warn(`Start index: ${startIndex}, End index: ${endIndex}`);
      console.warn('Raw text preview (first 500 chars):', rawEszipText.substring(0, 500));
      console.warn(
        'Raw text preview (last 500 chars):',
        rawEszipText.substring(Math.max(0, rawEszipText.length - 500))
      );

      // Fallback: try to extract code between the XGENIA_METADATA comment block
      const metadataMatch = rawEszipText.match(/\/\*\s*XGENIA_METADATA[\s\S]*?\*\//);
      if (metadataMatch) {
        const metadataEnd = metadataMatch.index! + metadataMatch[0].length;
        // Look backwards from metadata for the start of the actual function code
        const beforeMetadata = rawEszipText.substring(0, metadataMatch.index!);
        const codeStartMatch = beforeMetadata.match(/\/\/Please do not manipulate[\s\S]*?(?=\/\* XGENIA_METADATA)/);
        if (codeStartMatch) {
          startIndex = codeStartMatch.index!;
          endIndex = metadataMatch.index!;
        }
      }

      if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
        throw new Error(
          `Could not extract code from ESZIP format. ` +
          `Start index: ${startIndex}, End index: ${endIndex}. ` +
          `The ESZIP format may have changed.`
        );
      }
    }

    // 5. Extract and trim the result
    // We extract from the startMarker up to (but not including) the endMarker
    const extractedCode = rawEszipText.substring(startIndex, endIndex);

    if (!extractedCode || extractedCode.trim().length === 0) {
      throw new Error('Extracted code is empty after parsing ESZIP format');
    }

    return extractedCode.trim();
  }

  /**
   * Get the source code of an Edge Function
   */
  public async getSupabaseEdgeFunctionBody(functionName: string): Promise<string> {
    const apiUrl = `${this.getApiUrl()}/functions/${functionName}/body`;
    const options: RequestInit = {
      method: 'GET',
      headers: this.getAuthHeaders()
    };

    try {
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }
        throw new Error(
          formatSupabaseErrorMessage('Failed to fetch function body', response.status, response.statusText, errorData)
        );
      }

      const rawEszipText = await response.text();
      return this.extractCodeFromEszip(rawEszipText);
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Check if a function was deployed from XGENIA by name pattern
   * XGENIA functions follow specific naming conventions
   */
  private isXgeniaFunctionByName(functionName: string): boolean {
    // XGENIA functions typically follow these patterns:
    return (
      // PascalCase (e.g., SampleInput, MyFunction)
      !!functionName.match(/^[A-Z][a-z]+[A-Z][a-z]+$/) ||
      // PascalCase_PascalCase pattern (e.g., Grouped_Component_SampleInput)
      !!functionName.match(/^[A-Z][a-z]+_[A-Z][a-z]+/) ||
      // Explicitly prefixed with xgenia (including xgenia_ prefix)
      functionName.startsWith('xgenia') ||
      // Contains "Component" (e.g., TestComponent, MyComponent)
      functionName.includes('Component') ||
      // Contains "Function" (e.g., MyFunction, TestFunction)
      functionName.includes('Function') ||
      // Multiple PascalCase words with underscores (e.g., User_Profile_Manager)
      !!functionName.match(/^[A-Z][a-z]+(_[A-Z][a-z]+)+$/)
    );
  }

  /**
   * Check if source code contains XGENIA_METADATA comment block
   * This is the most reliable way to detect XGENIA-deployed functions
   */
  private hasXgeniaMetadata(sourceCode: string): boolean {
    if (!sourceCode || typeof sourceCode !== 'string') {
      return false;
    }

    // Look for the XGENIA_METADATA comment block
    // The pattern matches: /* XGENIA_METADATA ... */
    const metadataPattern = /\/\*\s*XGENIA_METADATA\s*\n[\s\S]*?\s*\*\//;
    return metadataPattern.test(sourceCode);
  }

  /**
   * Check if a function was deployed from XGENIA by checking source code metadata
   */
  public async isXgeniaFunction(functionName: string): Promise<boolean> {
    try {
      // First try name pattern matching for quick check
      if (this.isXgeniaFunctionByName(functionName)) {
        return true;
      }

      // If name pattern doesn't match, check source code for metadata
      const sourceCode = await this.getSupabaseEdgeFunctionBody(functionName);
      return this.hasXgeniaMetadata(sourceCode);
    } catch (error: any) {
      // If we can't fetch the source code, fall back to name pattern
      console.warn(`Could not check function ${functionName} for XGENIA metadata:`, error.message);
      return this.isXgeniaFunctionByName(functionName);
    }
  }

  /**
   * Get only XGENIA-deployed functions from Supabase by checking for XGENIA_METADATA comment
   */
  public async getXgeniaFunctions(): Promise<SupabaseFunctionMetadata[]> {
    try {
      const allFunctions = await this.fetchSupabaseEdgeFunctions();
      // Optimization: identify XGENIA functions purely by slug prefix to avoid fetching bodies
      return allFunctions.filter((func) => func.slug.startsWith('xgenia_') || func.slug.startsWith('xgenia'));
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Deploy or update a Supabase Edge Function
   */
  public async deploySupabaseEdgeFunction(
    functionName: string,
    functionCode: string
  ): Promise<SupabaseFunctionDetails> {
    const apiUrl = `${this.getApiUrl()}/functions/${functionName}`;
    const options: RequestInit = {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify({
        body: functionCode
      })
    };

    try {
      const response = await fetch(apiUrl, options);

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch {
          errorData = { message: response.statusText };
        }
        throw new Error(
          formatSupabaseErrorMessage('Failed to deploy function', response.status, response.statusText, errorData)
        );
      }

      return (await response.json()) as SupabaseFunctionDetails;
    } catch (error: any) {
      console.error('Error deploying Supabase Edge Function:', (error as Error).message);
      throw error;
    }
  }
}

// ============================================================================
// XGENIA TO SUPABASE CONVERTER
// ============================================================================

export class CloudFunctionConverter {
  private readonly component: Component;
  private readonly nodes: Map<string, Node>;
  private readonly connections: Connection[];
  private readonly functionName: string;
  private readonly nodeFunctionNames: Map<string, string>;
  private readonly corsConfig: CorsConfiguration;

  // Add math node converter
  private readonly mathNodeConverter: MathNodeConverter;
  // Add slot game node converter
  private readonly slotGameNodeConverter: SlotGameNodeConverter;
  // Add standard library node converter
  private readonly stdLibraryNodeConverter: StdLibraryNodeConverter;
  // Add signal passthrough node converter
  private readonly signalPassthroughNodeConverter: SignalPassthroughNodeConverter;
  // Add collection node converter
  private readonly collectionNodeConverter: CollectionNodeConverter;
  // Add RGS extra node converter (provably-fair / data / I-O nodes)
  private readonly rgsExtraNodeConverter: RgsExtraNodeConverter;
  // Stage-2 persistence: stateful variables (Variable2 + Set Variable writers)
  // resolved once per generateRgsScript run; null on the cloud-function path.
  private _statefulVars: Map<string, { initial: unknown; writers: Node[] }> | null = null;

  // Add project context for Cloud Logic components
  private readonly projectContext?: Project;

  constructor(component: Component, projectContext?: Project) {
    this.component = component;
    this.nodes = new Map(component.graph.roots.map((node) => [node.id, node]));
    this.connections = component.graph.connections;
    this.functionName = component.name.replace('/#__cloud__/', '');
    this.projectContext = projectContext;

    // Initialize converters first
    this.mathNodeConverter = new MathNodeConverter();
    this.slotGameNodeConverter = new SlotGameNodeConverter();
    this.stdLibraryNodeConverter = new StdLibraryNodeConverter();
    this.signalPassthroughNodeConverter = new SignalPassthroughNodeConverter();
    this.collectionNodeConverter = new CollectionNodeConverter();
    this.rgsExtraNodeConverter = new RgsExtraNodeConverter();

    // Then assign function names (which depends on converters)
    this.nodeFunctionNames = this.assignUniqueFunctionNames();

    // Initialize CORS configuration from component metadata or use defaults
    this.corsConfig = this.initializeCorsConfig();
  }

  /**
   * Initialize CORS configuration from component metadata or use defaults
   */
  private initializeCorsConfig(): CorsConfiguration {
    const metadata = this.component.metadata?.cors;
    return {
      allowedOrigins: metadata?.allowedOrigins || '*',
      allowedMethods: metadata?.allowedMethods || 'GET, POST, PUT, DELETE, OPTIONS',
      allowedHeaders:
        metadata?.allowedHeaders || 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
      maxAge: metadata?.maxAge || '86400'
    };
  }

  /**
   * Check if a component is a Cloud Logic component (has Component Inputs and Component Outputs)
   */
  private isCloudLogicComponent(component: Component): boolean {
    const rootTypes = new Set(component.graph.roots.map((node) => node.typename));
    return rootTypes.has('Component Inputs') && rootTypes.has('Component Outputs');
  }

  /**
   * Find a Cloud Logic component by name in the project context
   */
  private findCloudLogicComponent(componentName: string): Component | null {
    if (!this.projectContext) {
      return null;
    }

    const component = this.projectContext.components.find((c) => c.name === componentName);

    if (component && this.isCloudLogicComponent(component)) {
      return component;
    }

    return null;
  }

  /**
   * Check if a component is a Maths Logic component (has Component Inputs and Component Outputs)
   */
  private isMathsLogicComponent(component: Component): boolean {
    const rootTypes = new Set(component.graph.roots.map((node) => node.typename));
    return rootTypes.has('Component Inputs') && rootTypes.has('Component Outputs');
  }

  /**
   * Find a Maths Logic component by name in the project context
   */
  private findMathsLogicComponent(componentName: string): Component | null {
    if (!this.projectContext) {
      return null;
    }

    const component = this.projectContext.components.find((c) => c.name === componentName);

    if (component && this.isMathsLogicComponent(component)) {
      return component;
    }

    return null;
  }

  /**
   * Get all dependent Cloud Logic components used in this Cloud Function
   * Returns the complete Cloud Logic component structure for editor reconstruction
   */
  private getDependentCloudLogicComponents(): Component[] {
    const dependentComponents: Component[] = [];

    // Find all Cloud Logic component references in this Cloud Function
    const cloudLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/'));

    for (const node of cloudLogicNodes) {
      const logicComponent = this.findCloudLogicComponent(node.typename);
      if (logicComponent) {
        // Ensure the Cloud Logic component has the complete structure needed for editor reconstruction
        const completeLogicComponent: Component = {
          ...logicComponent,
          graph: {
            ...logicComponent.graph,
            // Ensure visualRoots is included for editor compatibility
            visualRoots: logicComponent.graph.visualRoots || []
          }
        };
        dependentComponents.push(completeLogicComponent);
      }
    }

    return dependentComponents;
  }

  /**
   * Get all dependent Maths Logic components used in this function
   */
  private getDependentMathsLogicComponents(): Component[] {
    const dependentComponents: Component[] = [];

    const mathsLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'));

    for (const node of mathsLogicNodes) {
      const logicComponent = this.findMathsLogicComponent(node.typename);
      if (logicComponent) {
        const completeLogicComponent: Component = {
          ...logicComponent,
          graph: {
            ...logicComponent.graph,
            visualRoots: logicComponent.graph.visualRoots || []
          }
        };
        dependentComponents.push(completeLogicComponent);
      }
    }

    return dependentComponents;
  }

  /**
   * Generate helper function code from a Cloud Logic component
   */
  /**
   * Generate helper function code from a Maths Logic component
   */
  private generateMathsLogicHelperFunction(mathsComponent: Component): string {
    const rawName = mathsComponent.name.replace('/#__maths__/', '');
    return this.generateLogicHelperFunction(mathsComponent, rawName);
  }

  /**
   * Generate helper function code from a Cloud Logic component
   */
  private generateCloudLogicHelperFunction(logicComponent: Component): string {
    const rawName = logicComponent.name.replace('/#__cloud__/', '');
    return this.generateLogicHelperFunction(logicComponent, rawName);
  }

  /**
   * Shared helper function generator for both Cloud and Maths Logic components
   */
  private generateLogicHelperFunction(logicComponent: Component, rawName: string): string {
    const functionName = this.sanitizeForIdentifier(rawName);

    // Find the JavaScriptFunction node in the Cloud Logic component
    const jsNode = logicComponent.graph.roots.find((node) => node.typename === 'JavaScriptFunction');
    if (!jsNode) {
      return '';
    }

    // Get input and output ports from the Cloud Logic component
    const inputPorts = jsNode.dynamicports?.filter((p) => p.plug === 'input') || [];
    const outputPorts = jsNode.dynamicports?.filter((p) => p.plug === 'output') || [];

    // Get the script from the JavaScriptFunction node
    let script = jsNode.parameters.functionScript || '';

    // Detect if the function contains async operations
    const hasAsyncOperations = this.detectAsyncOperations(script);

    // Transform Inputs.parameterName to inputs.sanitizedParameterName
    inputPorts.forEach((port) => {
      const originalName = this.portScriptName(port);
      const sanitizedName = this.sanitizeParameterName(originalName);
      if (originalName !== sanitizedName) {
        script = script.replace(
          new RegExp(`Inputs\\.${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `inputs.${sanitizedName}`
        );
      } else {
        script = script.replace(new RegExp(`Inputs\\.${originalName}`, 'g'), `inputs.${sanitizedName}`);
      }
    });

    // Transform Outputs.parameterName = to let sanitizedParameterName =
    // Fix the variable mapping issue by ensuring proper variable names and scope
    outputPorts.forEach((port) => {
      const originalName = this.portScriptName(port);
      const sanitizedName = this.sanitizeParameterName(originalName);
      if (originalName !== sanitizedName) {
        script = script.replace(
          new RegExp(`Outputs\\.${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'g'),
          `${sanitizedName} =`
        );
      } else {
        script = script.replace(new RegExp(`Outputs\\.${originalName}\\s*=`, 'g'), `${sanitizedName} =`);
      }
    });

    // Handle signal outputs properly for cloud functions
    // Replace any Outputs.<Signal>() calls with boolean variables and include them in outputs
    const signalNames = new Set<string>();
    const signalCallRegex = /Outputs\.(\w+)\(\)/g;
    let match;
    while ((match = signalCallRegex.exec(script)) !== null) {
      signalNames.add(match[1]);
    }

    // Get output port names for return statement (needed for early returns)
    // outputPorts is an array of port objects in Cloud Logic functions
    const outputPortNames = outputPorts.map((p) => this.sanitizeParameterName(this.portScriptName(p)));

    // Declare all detected signals as booleans and include in outputs
    signalNames.forEach((name) => {
      if (!outputPortNames.includes(name)) {
        outputPortNames.push(name);
      }
    });

    // Build return statement string for early returns
    const returnStatement = `return { ${outputPortNames.join(', ')} };`;

    // Replace each signal call with a boolean assignment AND early return
    // Failure and Error signals should stop execution (early return)
    // Success signals can continue, but we'll still track them
    signalNames.forEach((name) => {
      const re = new RegExp(`Outputs\\\.${name}\\\(\\\)`, 'g');
      if (name === 'Failure' || name === 'Error') {
        // For Failure/Error signals, insert assignment + early return
        script = script.replace(re, `${name} = true;\n  ${returnStatement}`);
      } else {
        // For other signals (like Success), just assign (execution can continue)
        script = script.replace(re, `${name} = true`);
      }
    });

    // Add variable declarations for all output ports at function scope
    let variableDeclarations = '';

    // Declare all detected signals as booleans and include in outputs
    signalNames.forEach((name) => {
      if (!variableDeclarations.includes(`let ${name}`)) {
        variableDeclarations += `let ${name} = false;\n`;
      }
      if (!outputPortNames.includes(name)) {
        outputPortNames.push(name);
      }
    });

    // Add declarations for all other output variables
    outputPortNames.forEach((portName) => {
      if (
        !variableDeclarations.includes(`let ${portName}`) &&
        !variableDeclarations.includes(`const ${portName}`) &&
        !signalNames.has(portName)
      ) {
        // Check if the variable is already declared in the transformed script
        const variableAlreadyDeclared = new RegExp(`(let|const|var)\\s+${portName}\\s*[=;]`).test(script);
        if (!variableAlreadyDeclared) {
          variableDeclarations += `let ${portName};\n`;
        }
      }
    });

    // Generate the result object that describes the outcome (include a generic isSuccess if present)
    let resultObject = '';
    if (signalNames.size > 0) {
      const resultFields: string[] = [];
      // Include a generic isSuccess if there is a Success signal
      if (signalNames.has('Success')) {
        resultFields.push('isSuccess: Success || false');
      }
      // Also mirror each signal as a boolean field in result for routing if needed
      signalNames.forEach((name) => {
        const field = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
        resultFields.push(`${field}: ${name} || false`);
      });
      resultObject = `\n  // Signal routing metadata\n  const __signals = { ${resultFields.join(', ')} };`;
    }

    // Determine if function should be async
    const functionSignature = hasAsyncOperations
      ? `const ${functionName} = async (inputs: Record<string, any>): Promise<Record<string, any>> => {`
      : `const ${functionName} = (inputs: Record<string, any>): Record<string, any> => {`;

    return `
/**
 * Helper function generated from the '${logicComponent.name}' Cloud Logic Component.
 */
${functionSignature}
  ${variableDeclarations}${script.trim().replace(/\n/g, '\n  ')}
  return { ${outputPortNames.join(', ')} };
};`;
  }

  /**
   * Detect if a script contains async operations that require async/await
   */
  private detectAsyncOperations(script: string): boolean {
    // Common async patterns in JavaScript
    const asyncPatterns = [
      /\bawait\s+/g, // await keyword
      /\bfetch\s*\(/g, // fetch calls
      /\bPromise\s*\./g, // Promise methods
      /\b\.then\s*\(/g, // .then() calls
      /\b\.catch\s*\(/g, // .catch() calls
      /\bXgenia\.Records\./g, // Xgenia Records operations
      /\bXgenia\.Users\./g, // Xgenia Users operations
      /\bsetTimeout\s*\(/g, // setTimeout calls
      /\bsetInterval\s*\(/g, // setInterval calls
      /\brequestAnimationFrame\s*\(/g // requestAnimationFrame calls
    ];

    return asyncPatterns.some((pattern) => pattern.test(script));
  }

  private assignUniqueFunctionNames(): Map<string, string> {
    const nameMap = new Map<string, string>();
    const usedNames = new Set<string>();

    // Get all function nodes (JavaScript + Math + Slot Game + Standard Library + Signal Passthrough + Collection + Cloud/Maths Logic)
    const jsFunctionNodes = this.findAllNodesByType('JavaScriptFunction');
    const mathNodes = this.findAllMathNodes();
    const slotGameNodes = this.findAllSlotGameNodes();
    const stdLibraryNodes = this.findAllStdLibraryNodes();
    const signalPassthroughNodes = this.findAllSignalPassthroughNodes();
    const collectionNodes = this.findAllCollectionNodes();
    const extraNodes = this.findAllExtraNodes();
    const cloudLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/'));
    const mathsLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'));
    const allFunctionNodes = [
      ...jsFunctionNodes,
      ...mathNodes,
      ...slotGameNodes,
      ...stdLibraryNodes,
      ...signalPassthroughNodes,
      ...collectionNodes,
      ...extraNodes,
      ...cloudLogicNodes,
      ...mathsLogicNodes
    ];

    for (const node of allFunctionNodes) {
      let baseName = 'function';

      if (node.typename === 'JavaScriptFunction') {
        baseName = 'jsFunction';
        if (node.label) {
          const sanitizedLabel = this.sanitizeForIdentifier(node.label);
          if (sanitizedLabel) {
            baseName = sanitizedLabel;
          }
        }
      } else if (this.mathNodeConverter && this.mathNodeConverter.isMathNode(node.typename)) {
        baseName = `math_${node.typename.toLowerCase().replace(/\s+/g, '_')}`;
      } else if (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) {
        baseName = `slot_${node.typename.toLowerCase().replace(/\s+/g, '_')}`;
      } else if (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(node.typename)) {
        baseName = `std_${node.typename.toLowerCase().replace(/\s+/g, '_')}`;
      } else if (
        this.signalPassthroughNodeConverter &&
        this.signalPassthroughNodeConverter.isSignalPassthroughNode(node.typename)
      ) {
        baseName = `signal_${node.typename.toLowerCase().replace(/\s+/g, '_')}`;
      } else if (this.collectionNodeConverter && this.collectionNodeConverter.isCollectionNode(node.typename)) {
        baseName = `collection_${node.typename.toLowerCase().replace(/\s+/g, '_')}`;
      } else if (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(node.typename)) {
        baseName = `extra_${node.typename.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
      } else if (node.typename.startsWith('/#__cloud__/')) {
        const rawName = node.typename.replace('/#__cloud__/', '');
        baseName = `cloud_${this.sanitizeForIdentifier(rawName) || 'logic'}`;
      } else if (node.typename.startsWith('/#__maths__/')) {
        const rawName = node.typename.replace('/#__maths__/', '');
        baseName = `maths_${this.sanitizeForIdentifier(rawName) || 'logic'}`;
      }

      let uniqueName = baseName;
      let counter = 1;
      while (usedNames.has(uniqueName)) {
        uniqueName = `${baseName}_${counter}`;
        counter++;
      }

      usedNames.add(uniqueName);
      nameMap.set(node.id, uniqueName);
    }
    return nameMap;
  }

  public generateSupabaseFunction(): { name: string; code: string } {
    // Stage-2 persistence is an RGS-only concept — never let a prior
    // generateRgsScript() run on this instance leak into the cloud path.
    this._statefulVars = null;
    const requestNode = this.findNodeByType('xgenia.cloud.request');

    // Get all function nodes (JavaScript + Math + Slot Game + Standard Library + Signal Passthrough + Collection + Cloud Logic references)
    const jsFunctionNodes = this.findAllNodesByType('JavaScriptFunction');
    const mathNodes = this.findAllMathNodes();
    const slotGameNodes = this.findAllSlotGameNodes();
    const stdLibraryNodes = this.findAllStdLibraryNodes();
    const signalPassthroughNodes = this.findAllSignalPassthroughNodes();
    const collectionNodes = this.findAllCollectionNodes();
    const cloudLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/'));
    const mathsLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'));
    const allFunctionNodes = [
      ...jsFunctionNodes,
      ...mathNodes,
      ...slotGameNodes,
      ...stdLibraryNodes,
      ...signalPassthroughNodes,
      ...collectionNodes,
      ...cloudLogicNodes,
      ...mathsLogicNodes,
      ...this.findAllNodesByType('Javascript2'),
      ...this.findAllNodesByType('stateManager')
    ];
    const sortedFunctionNodes = this.sortNodesByExecutionOrder(allFunctionNodes);

    const inputParams = this.getRequestInputParams(requestNode);
    const functionDefinitions = this.generateFunctionDefinitions(sortedFunctionNodes);
    const functionInvocations = this.generateFunctionInvocations(sortedFunctionNodes, requestNode);
    const { responseStatement, statusCodeLogic } = this.getFinalResponseStatementWithStatus();

    // Additional debugging for response mapping
    const responseNode = this.findNodeByType('xgenia.cloud.response');
    if (responseNode) {
      const responseConnection = this.connections.find((c) => c.toId === responseNode.id);
      if (responseConnection) {
        const sourceNode = this.nodes.get(responseConnection.fromId);
      }
    }

    // Serialize the original XGENIA component structure for embedding
    // Include all dependent Cloud Logic and Maths Logic components in the metadata
    const metadataStructure = {
      ...this.component,
      dependentComponents: [
        ...this.getDependentCloudLogicComponents(),
        ...this.getDependentMathsLogicComponents()
      ]
    };
    const originalComponentStructure = JSON.stringify(metadataStructure, null, 2);

    // Sanitize function name for Supabase deployment (remove folder structure)
    const sanitizedFunctionName = this.sanitizeFunctionNameForSupabase(this.functionName);

    // Only include createClient import when nodes that use it are present (NewDbModelProperties, DbCollection2, DeleteDbModelProperties)
    const usesSupabaseClient = this.component.graph.roots.some(
      (n) =>
        n.typename === 'NewDbModelProperties' ||
        n.typename === 'DbCollection2' ||
        n.typename === 'DeleteDbModelProperties'
    );
    const createClientImport = usesSupabaseClient
      ? 'import { createClient } from "https://esm.sh/@supabase/supabase-js@2";\n\n'
      : '';

    const code = `
//Please do not manipulate the code manually below this line. It is used to deploy the function to Supabase.
// supabase/functions/${sanitizedFunctionName}/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
${createClientImport}
interface RequestBody {
  ${inputParams.map((p) => `${p}?: any;`).join('\n  ')}
}

serve(async (req) => {
  // CORS configuration
  const corsHeaders = {
    'Access-Control-Allow-Origin': '${this.corsConfig.allowedOrigins}',
    'Access-Control-Allow-Methods': '${this.corsConfig.allowedMethods}',
    'Access-Control-Allow-Headers': '${this.corsConfig.allowedHeaders}',
    'Access-Control-Max-Age': '${this.corsConfig.maxAge}'
  };

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const requestBody: RequestBody = await req.json();

    // --- XGENIA Node Logic: Generated Function Definitions ---
    ${functionDefinitions}

    // --- XGENIA Node Logic: Generated Function Invocations ---
    ${functionInvocations}

    // --- Determine HTTP Status Code Based on Success/Failure Signals ---
    ${statusCodeLogic}

    return new Response(
      JSON.stringify(${responseStatement}),
      { 
        status: httpStatus,
        headers: { 
          "Content-Type": "application/json", 
          ...corsHeaders 
        } 
      }
    );
  } catch (error: any) {
    console.error('Error processing request:', error);
    return new Response(
      JSON.stringify({ error: error.message, status: 'failure' }),
      { 
        status: 400, 
        headers: { 
          "Content-Type": "application/json", 
          ...corsHeaders 
        } 
      }
    );
  }
});

//NOTE: PLEASE DO NOT REMOVE THE XGENIA_METADATA COMMENT BLOCK. IT IS USED TO RE-STORE THE ORIGINAL XGENIA COMPONENT STRUCTURE.

/* XGENIA_METADATA
${originalComponentStructure}
*/
`;
    return { name: sanitizedFunctionName, code };
  }

  /**
   * Generate an RGS evaluate(ctx) script from the maths component.
   *
   * Reuses the same node discovery, function definition generation, and
   * connection wiring as generateSupabaseFunction(), but wraps the output
   * in a self-contained evaluate(ctx) function with an RNG adapter.
   *
   * ctx = { bet: number, rng: number[], state: {}, config: {}, round: number }
   * Must return { win: number, data: {}, state: {} }
   */
  public generateRgsScript(): { script: string; configData: Record<string, any> } {
    // Stage-2 cross-spin persistence: variables written via Set Variable
    // compile to a ctx.state-backed `_vars` store (see collectStatefulVariables).
    const statefulVars = this.collectStatefulVariables();
    this._statefulVars = statefulVars;

    // Discover ALL node types — matching generateSupabaseFunction()
    const jsFunctionNodes = this.findAllNodesByType('JavaScriptFunction');
    const mathNodes = this.findAllMathNodes();
    const slotGameNodes = this.findAllSlotGameNodes();
    const stdLibraryNodes = this.findAllStdLibraryNodes();
    const signalPassthroughNodes = this.findAllSignalPassthroughNodes();
    const collectionNodes = this.findAllCollectionNodes();
    const extraNodes = this.findAllExtraNodes();
    const mathsLogicNodes = this.component.graph.roots.filter((n) => n.typename.startsWith('/#__maths__/'));

    const allFunctionNodes = [
      ...jsFunctionNodes,
      ...mathNodes,
      ...slotGameNodes,
      ...stdLibraryNodes,
      ...signalPassthroughNodes,
      ...collectionNodes,
      ...extraNodes,
      ...mathsLogicNodes,
      ...this.findAllNodesByType('Javascript2'),
      ...this.findAllNodesByType('stateManager'),
      // Stage-2: Set Variable writers of stateful variables join the ordered
      // node stream — they emit gated `_vars` writes, not function calls.
      ...this.component.graph.roots.filter(
        (n) =>
          (n.typename === 'Set Variable' || n.typename === '/#__cloud__/Set Variable') &&
          statefulVars.has((n.parameters as any)?.name)
      ),
    ];
    const sortedFunctionNodes = this.sortNodesByExecutionOrder(allFunctionNodes);

    // Shared sandbox-safe helpers (sha256 / hashToRange / uuid) used by the
    // provably-fair & data node functions — emitted once, before the node defs.
    const extraPrelude = this.rgsExtraNodeConverter.hasAnyExtraNode(allFunctionNodes.map((n) => n.typename))
      ? RgsExtraNodeConverter.helperPrelude()
      : '';

    // Generate function definitions (same code generators as cloud)
    const functionDefinitions = extraPrelude + this.generateFunctionDefinitions(sortedFunctionNodes);

    // Generate invocations with RGS-specific wiring
    const functionInvocations = this.generateRgsFunctionInvocations(sortedFunctionNodes);

    // Extract config data from node parameters + Variable2 defaults
    const configData = this.extractMathsConfig(sortedFunctionNodes);

    // Stage-2 persistence prelude: hydrate `_vars` from ctx.state (production
    // /spin threads game_sessions.round_state; the stress runner threads
    // persistedState), defaulting each variable to its Variable2 initial value
    // on the first spin of a session.
    const statefulPrelude = statefulVars.size === 0
      ? ''
      : [
          '// --- Cross-spin variable store (hydrated from ctx.state.__vars) ---',
          'var _vars = (ctx.state && typeof ctx.state === "object" && ctx.state.__vars && typeof ctx.state.__vars === "object") ? Object.assign({}, ctx.state.__vars) : {};',
          ...Array.from(statefulVars.entries()).map(
            ([name, info]) =>
              `if (!Object.prototype.hasOwnProperty.call(_vars, ${JSON.stringify(name)})) _vars[${JSON.stringify(name)}] = ${JSON.stringify(info.initial === undefined ? null : info.initial)};`
          ),
        ].join('\n');

    const script = [
      '// XGENIA RGS Maths Script - Auto-generated from editor graph',
      '// Generated: ' + new Date().toISOString(),
      '// Component: ' + this.component.name,
      '',
      '// --- Node function definitions ---',
      functionDefinitions,
      '',
      statefulPrelude,
      '',
      '// --- Node invocations (wired via graph connections) ---',
      functionInvocations,
      '',
      '// Collect results — prefer Component Outputs mapping if available',
      'var _lastResult = typeof _lastNodeResult !== "undefined" ? _lastNodeResult : {};',
      'var _dataOut = typeof _componentOutputs !== "undefined"',
      '  ? _componentOutputs',
      '  : (typeof _lastResult === "object" ? { ..._lastResult } : { result: _lastResult });',
      '',
      '// 2026-07-14 (trace 1784044997749): the RGS RTP harness scores each spin by the',
      '// top-level `win` field — see this converter\'s own { win, data, state } contract',
      '// (docstring above) and knowledge/topics.ts evaluate_contract. The old return',
      '// OMITTED `win`, so EVERY spin scored 0 payout -> 0% RTP for all generated maths.',
      '// Derive it from the data output (flat OR decomposed/finalResult shape). 0 is a',
      '// valid win (a losing spin), so preserve it. Conservative JS only (sandbox-safe).',
      'var _win = (function (d) {',
      '  if (!d || typeof d !== "object") return 0;',
      '  var fr = d.finalResult;',
      '  var w = 0;',
      '  if (d.win != null) w = d.win;',
      '  else if (d.winAmount != null) w = d.winAmount;',
      '  else if (d.spinWinnings != null) w = d.spinWinnings;',
      '  else if (d.totalPayout != null) w = d.totalPayout;',
      '  else if (d.totalWinnings != null) w = d.totalWinnings;',
      '  else if (fr && fr.spinResults && fr.spinResults.totalPayout != null) w = fr.spinResults.totalPayout;',
      '  else if (fr && fr.totalWinnings != null) w = fr.totalWinnings;',
      '  else if (fr && fr.spinWinnings != null) w = fr.spinWinnings;',
      '  var n = Number(w);',
      '  return isFinite(n) ? n : 0;',
      '})(_dataOut);',
      '',
      'return {',
      '  win: _win,',
      '  data: _dataOut,',
      statefulVars.size > 0
        ? '  state: { ...ctx.state, __vars: _vars, round: ctx.round }'
        : '  state: { ...ctx.state, round: ctx.round }',
      '};',
    ].join('\n');

    // Sanitize the script to be sandbox-compatible
    const sanitizedScript = this.sanitizeForSandbox(script);

    return { script: sanitizedScript, configData };
  }

  /**
   * Sanitize a generated script to be compatible with the RGS sandbox.
   *
   * The sandbox (script-sandbox.ts) has a blocklist that rejects scripts
   * containing Deno, eval(, Function(, crypto, import, require, etc.
   * The cloud deploy code generators produce TypeScript and use these
   * patterns, so we strip/replace them here for RGS use.
   *
   * 2026-07-10: extracted to sanitize-for-sandbox.ts (pure function) so the
   * formula-eval parity test can assert the sanitizer leaves the emitted
   * evaluator working — see that file's docblock for the trace-1783634013326
   * story (eval-strip zeroed every slot-maths formula in the uploaded bundle).
   */
  private sanitizeForSandbox(script: string): string {
    return sanitizeForSandbox(script);
  }


  /**
   * Generate function invocations for the RGS script.
   * Similar to generateFunctionInvocations but uses ctx.config instead of requestBody.
   */
  /**
   * Build a memoized resolver that returns, for a node id, the set of request
   * operation-trigger flags (`is<Operation>`) whose `Do`-signal chain reaches it:
   *   null    -> unconditional: no operation trigger gates this node (it has no
   *              signal input, or its `Do` is driven directly by a non-`is*`
   *              request signal like `do`/`fetch`). Always invoke.
   *   Set(0)  -> gated but reachable from no trigger (dead/cyclic). Never invoke.
   *   Set(>0) -> invoke only when one of these flags is set.
   *
   * This mirrors the editor, where a node computes only when its `Do` fires. A
   * signal edge into a node is a request `pm-is*` trigger, or an internal
   * `Do`/`Done` connection. Used to gate BOTH node invocations and response
   * fields so an operation that wasn't triggered neither runs its nodes (e.g. a
   * Division that would throw "Division by zero") nor leaks their outputs.
   *
   * Components without an `xgenia.cloud.request` node (slot/maths graphs driven
   * by `Component Inputs`) resolve to `null` for every node, so gating built on
   * this resolver is a no-op for them.
   */
  private buildTriggerResolver(requestNode?: Node): (nodeId: string) => Set<string> | null {
    const isTriggerEdge = (c: Connection): boolean =>
      !!requestNode &&
      c.fromId === requestNode.id &&
      typeof c.fromProperty === 'string' &&
      c.fromProperty.startsWith('pm-is');
    const isSignalEdge = (c: Connection): boolean =>
      isTriggerEdge(c) || c.toProperty === 'Do' || c.fromProperty === 'Done';

    const memo = new Map<string, Set<string> | null>();
    const resolve = (nodeId: string, stack: Set<string>): Set<string> | null => {
      if (memo.has(nodeId)) return memo.get(nodeId)!;
      if (stack.has(nodeId)) return new Set<string>(); // cycle guard
      stack.add(nodeId);
      const sigConns = this.connections.filter((c) => c.toId === nodeId && isSignalEdge(c));
      let res: Set<string> | null;
      if (sigConns.length === 0) {
        res = null; // no signal inputs -> unconditional
      } else {
        res = new Set<string>();
        for (const c of sigConns) {
          if (isTriggerEdge(c)) {
            res.add(String(c.fromProperty).replace(/^pm-/, ''));
          } else if (requestNode && c.fromId === requestNode.id) {
            // `Do`/`Done` straight from the request node but NOT an `is*` trigger
            // (e.g. a plain `do`/`fetch` signal) -> node runs unconditionally.
            res = null;
            break;
          } else {
            const up = resolve(c.fromId, stack);
            if (up === null) {
              res = null;
              break;
            } // upstream always fires -> so does this
            up.forEach((t) => (res as Set<string>).add(t));
          }
        }
      }
      stack.delete(nodeId);
      memo.set(nodeId, res);
      return res;
    };
    return (nodeId: string) => resolve(nodeId, new Set<string>());
  }

  private generateRgsFunctionInvocations(nodes: Node[]): string {
    let invocationCode = '';
    const outputVariableMap = new Map<string, string>();
    let lastResultVar = '';

    // Gate each node's invocation (and, further down, each response field) on the
    // request operation-triggers that reach its `Do` — mirroring the editor,
    // where a node computes only when triggered. See buildTriggerResolver().
    const requestNode = this.component.graph.roots.find((n) => n.typename === 'xgenia.cloud.request');
    const triggersForNode = this.buildTriggerResolver(requestNode);
    // Gate expression for a node's invocation:
    //   null    -> unconditional, always invoke
    //   'false' -> signal-wired but no request trigger reaches it, never invoke
    //   string  -> a `config.isX || config.isY` guard; invoke only when it holds
    const invocationGateFor = (nodeId: string): string | null => {
      const trigs = triggersForNode(nodeId);
      if (trigs === null) return null;
      if (trigs.size === 0) return 'false';
      return Array.from(trigs)
        .map((t) => this.safePropertyAccess('config', t))
        .join(' || ');
    };

    nodes.forEach((node) => {
      const functionName = this.getFunctionName(node);
      const inputConnections = this.connections.filter((c) => c.toId === node.id);
      const inputMappings = new Map<string, string>();

      // JavaScriptFunction nodes use in-/out- prefixed port names externally,
      // but the function body uses the bare scriptInput ID (e.g. "reels" not "in-reels").
      const isJsFunction = node.typename === 'JavaScriptFunction';

      // Wire connections from upstream nodes
      inputConnections.forEach((conn) => {
        // Strip 'in-' prefix for JS function nodes so the key matches the function body
        let inputName = conn.toProperty;
        if (isJsFunction && inputName.startsWith('in-')) {
          inputName = inputName.substring(3);
        }

        let sourceValue: string;

        // Stage-2: reads from a STATEFUL Variable2 come from the `_vars` store
        // (persisted via ctx.state), not from re-deriving the writer's source.
        const _rawSrc = this.nodes.get(conn.fromId);
        if (_rawSrc && (_rawSrc.typename === 'Variable2' || _rawSrc.typename === '/#__cloud__/Variable2')) {
          const _vn = (_rawSrc.parameters as any)?.name;
          if (_vn && this._statefulVars?.has(_vn)) {
            inputMappings.set(inputName, `_vars[${JSON.stringify(_vn)}]`);
            return;
          }
        }

        // Resolve passthrough (Variable2) nodes by tracing backwards — follows
        // both direct `value` wires AND name-matched Set Variable writers
        // (see resolveThroughVariables; trace 1784154340515).
        const _resolved = this.resolveThroughVariables(conn.fromId, conn.fromProperty, (id) => outputVariableMap.has(id));
        const resolvedFromId = _resolved.fromId;
        const resolvedFromProperty = _resolved.fromProperty;

        if (outputVariableMap.has(resolvedFromId)) {
          const sourceNode = this.nodes.get(resolvedFromId);
          const sourceNodeType = sourceNode?.typename || '';

          // Strip 'out-' prefix when reading from JS function outputs
          let fromProp = resolvedFromProperty;
          if (sourceNode?.typename === 'JavaScriptFunction' && fromProp.startsWith('out-')) {
            fromProp = fromProp.substring(4);
          }

          if (
            (this.mathNodeConverter && this.mathNodeConverter.isMathNode(sourceNodeType)) ||
            (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(sourceNodeType))
          ) {
            sourceValue = this.safePropertyAccess(outputVariableMap.get(resolvedFromId)!, fromProp);
          } else {
            const sourcePort = this.findPort(resolvedFromId, resolvedFromProperty);
            if (sourcePort) {
              sourceValue = this.safePropertyAccess(outputVariableMap.get(resolvedFromId)!, this.sanitizeParameterName(sourcePort.displayName));
            } else {
              sourceValue = this.safePropertyAccess(outputVariableMap.get(resolvedFromId)!, fromProp);
            }
          }
        } else {
          // Source node is NOT in the function list — check what kind it is
          const srcNode = this.nodes.get(conn.fromId);

          if (srcNode && (srcNode.typename === 'Variable2' || srcNode.typename === '/#__cloud__/Variable2') && srcNode.parameters.value !== undefined) {
            // Inline Variable2 initial values directly
            sourceValue = JSON.stringify(srcNode.parameters.value);
          } else if (srcNode && srcNode.typename === 'Component Inputs') {
            // Map Component Inputs to RGS context variables
            const portName = conn.fromProperty;
            if (portName.toLowerCase() === 'betamount' || portName === 'BetAmount') {
              sourceValue = 'bet';
            } else {
              // Use the Component Inputs port name (fromProperty) as the config key,
              // not the downstream node's port name (inputName/toProperty).
              // This ensures the script reads config["A"] matching the _portManifest
              // and input_overrides sent by the Play Tester UI.
              sourceValue = this.safePropertyAccess('config', portName);
            }
          } else if (srcNode && srcNode.typename === 'xgenia.cloud.request') {
            // Compiled cloud component: the request node feeds values via its
            // pm-<field> output ports. The config key is the FIELD name
            // (fromProperty minus the "pm-" prefix), NOT the destination port name
            // (inputName/toProperty) — these differ whenever a node's input port
            // name isn't the same as the aggregator data field (e.g. a "client
            // seed" port fed by the "clientSeed" field, or an "input0" port fed by
            // "firstNumber"). Using toProperty here would read a non-existent
            // config key and silently feed undefined.
            const field = conn.fromProperty.startsWith('pm-')
              ? conn.fromProperty.substring(3)
              : conn.fromProperty;
            sourceValue = this.safePropertyAccess('config', field);
          } else {
            sourceValue = this.safePropertyAccess('config', inputName);
          }
        }
        inputMappings.set(inputName, sourceValue);
      });

      // Stage-2: a stateful Set Variable node compiles to a signal-gated write
      // into `_vars` — no function call, no output variable. The gate keeps
      // init/reset chains from clobbering persisted state every spin (the
      // compiled script has no real signal engine; everything runs per spin).
      if (
        (node.typename === 'Set Variable' || node.typename === '/#__cloud__/Set Variable') &&
        this._statefulVars?.has((node.parameters as any)?.name)
      ) {
        const varName = (node.parameters as any).name;
        const valueSrc = inputMappings.get('value');
        if (valueSrc !== undefined) {
          const writeGate = this.signalGateForWriter(node);
          const wLabel = node.label || `Set Variable ${varName}`;
          invocationCode += writeGate === 'true'
            ? `_vars[${JSON.stringify(varName)}] = ${valueSrc}; /* [${wLabel}] */\n    `
            : `if (${writeGate}) { _vars[${JSON.stringify(varName)}] = ${valueSrc}; } /* [${wLabel}] */\n    `;
        }
        return;
      }

      // Add node parameters as fallbacks
      Object.entries(node.parameters).forEach(([paramName, paramValue]) => {
        if (paramName === 'params' || paramName === 'functionScript' || paramName === 'code') return;
        // isMath is a deployment-routing flag (Compile feature), not a data input.
        if (paramName === 'isMath') return;
        // Skip internal port metadata that should never be passed as inputs
        if (paramName.startsWith('intype-') || paramName.startsWith('outtype-') ||
            paramName.startsWith('Inputs.') || paramName.startsWith('Outputs.') ||
            paramName === 'scriptInputs' || paramName === 'scriptOutputs') return;
        if (!inputMappings.has(paramName)) {
          if (typeof paramValue === 'string') {
            inputMappings.set(paramName, JSON.stringify(paramValue));
          } else if (typeof paramValue === 'number' || typeof paramValue === 'boolean') {
            inputMappings.set(paramName, String(paramValue));
          } else {
            inputMappings.set(paramName, JSON.stringify(paramValue));
          }
        }
      });

      // Inject RGS RNG for slot game nodes
      if (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) {
        inputMappings.set('_rgsRandom', 'rgsRandom');
        inputMappings.set('_rgsRandomInt', 'rgsRandomInt');
        inputMappings.set('betAmount', 'bet');
      }

      const inputObject = Array.from(inputMappings.entries())
        .map(([name, value]) => {
          const needsQuotes = /[^a-zA-Z0-9_]/.test(name);
          return needsQuotes ? `"${name}": ${value}` : `${name}: ${value}`;
        })
        .join(', ');

      const outputVar = `${functionName}Result`;
      const nodeLabel = node.label || functionName;
      const gate = invocationGateFor(node.id);
      // Only invoke the node when its `Do` was actually triggered by this
      // request (mirrors the editor, where a node computes solely on `Do`).
      // Un-triggered nodes yield {} so downstream reads are undefined and their
      // response fields are dropped by the trigger-gated response mapping below.
      // Wrap the call in try/catch so any thrown error names the node.
      invocationCode += `let ${outputVar} = {};\n    `;
      if (gate === null) {
        invocationCode += `try { ${outputVar} = ${functionName}({ ${inputObject} }); }\n    `;
        invocationCode += `catch(_e) { throw new Error("[${nodeLabel}] " + _e.message); }\n    `;
      } else if (gate === 'false') {
        invocationCode += `/* [${nodeLabel}] not invoked: no request trigger reaches its Do */\n    `;
      } else {
        invocationCode += `if (${gate}) {\n      try { ${outputVar} = ${functionName}({ ${inputObject} }); }\n      catch(_e) { throw new Error("[${nodeLabel}] " + _e.message); }\n    }\n    `;
      }

      outputVariableMap.set(node.id, outputVar);
      lastResultVar = outputVar;
    });

    invocationCode += lastResultVar
      ? `const _lastNodeResult = ${lastResultVar};\n    `
      : `const _lastNodeResult = {};\n    `;

    // --- Component Outputs mapping ---
    // Map each Component Outputs port name to its connected upstream result.
    // This ensures result.data uses the port manifest names (e.g. {Sum: 8})
    // instead of raw node output names (e.g. {result: 8}).
    const componentOutputsNode = this.component.graph.roots.find(
      (n) => n.typename === 'Component Outputs'
    );
    if (componentOutputsNode) {
      const outputConns = this.connections.filter((c) => c.toId === componentOutputsNode.id);
      if (outputConns.length > 0) {
        const mappings: string[] = [];
        for (const conn of outputConns) {
          // conn.toProperty is the Component Outputs port name (e.g. "Sum")
          const outputPortName = conn.toProperty;

          // Stage-2: a Component Outputs port fed by a stateful Variable2
          // reads the persisted `_vars` store.
          const _rawOutSrc = this.nodes.get(conn.fromId);
          if (_rawOutSrc && (_rawOutSrc.typename === 'Variable2' || _rawOutSrc.typename === '/#__cloud__/Variable2')) {
            const _ovn = (_rawOutSrc.parameters as any)?.name;
            if (_ovn && this._statefulVars?.has(_ovn)) {
              const safeName = /[^a-zA-Z0-9_]/.test(outputPortName) ? `"${outputPortName}"` : outputPortName;
              mappings.push(`${safeName}: _vars[${JSON.stringify(_ovn)}]`);
              continue;
            }
          }

          // Resolve the source through Variable2 passthroughs (incl. name-matched
          // Set Variable writers — see resolveThroughVariables).
          const _resolvedOut = this.resolveThroughVariables(conn.fromId, conn.fromProperty, (id) => outputVariableMap.has(id));
          const resolvedFromId = _resolvedOut.fromId;
          const resolvedFromProperty = _resolvedOut.fromProperty;

          if (outputVariableMap.has(resolvedFromId)) {
            const sourceNode = this.nodes.get(resolvedFromId);
            let fromProp = resolvedFromProperty;
            if (sourceNode?.typename === 'JavaScriptFunction' && fromProp.startsWith('out-')) {
              fromProp = fromProp.substring(4);
            }
            const sourceExpr = this.safePropertyAccess(outputVariableMap.get(resolvedFromId)!, fromProp);
            const safeName = /[^a-zA-Z0-9_]/.test(outputPortName) ? `"${outputPortName}"` : outputPortName;
            mappings.push(`${safeName}: ${sourceExpr}`);
          }
        }
        if (mappings.length > 0) {
          invocationCode += `const _componentOutputs = { ${mappings.join(', ')} };\n    `;
        }
      }
    }

    // --- xgenia.cloud.response mapping (compiled cloud components) ---
    // Cloud components built by the editor's "Compile" feature use an
    // xgenia.cloud.response node (params -> pm-<field> input ports) instead of a
    // "Component Outputs" node. Without this the script would fall back to
    // _lastNodeResult — i.e. whichever node happens to sort last — which is wrong
    // (and is 0 when that node is an unconnected/dead one). Build the response
    // object from the response node's connections instead.
    const responseNode = this.component.graph.roots.find(
      (n) => n.typename === 'xgenia.cloud.response'
    );
    // `requestNode`, `isSignalEdge` and `triggersForNode` are declared once at
    // the top of this method and reused here for response-field gating.
    if (responseNode && !componentOutputsNode) {
      // Resolve a source connection (through Variable2 passthroughs) to its
      // result expression, or null if the source isn't a generated node.
      const resolveSourceExpr = (conn: any): string | null => {
        const _resolvedResp = this.resolveThroughVariables(conn.fromId, conn.fromProperty, (id) => outputVariableMap.has(id));
        const resolvedFromId = _resolvedResp.fromId;
        const resolvedFromProperty = _resolvedResp.fromProperty;
        if (!outputVariableMap.has(resolvedFromId)) return null;
        const sourceNode = this.nodes.get(resolvedFromId);
        let fromProp = resolvedFromProperty;
        if (sourceNode?.typename === 'JavaScriptFunction' && fromProp.startsWith('out-')) {
          fromProp = fromProp.substring(4);
        }
        return this.safePropertyAccess(outputVariableMap.get(resolvedFromId)!, fromProp);
      };

      // Trigger isolation. The Aggregator fires ONE operation per request (sets
      // exactly one `is<X>` flag true). In the editor graph a node only produces
      // output when its `Do` signal fires — directly from a request `pm-is<X>`
      // trigger, or transitively from an upstream node's `Done`. But the deployed
      // script runs every node function unconditionally, so without gating EVERY
      // output would come back on EVERY request and the aggregator would push
      // values into UI bound to operations the user never triggered.
      //
      // So we compute, per source node, the set of request trigger flags whose
      // signal chain reaches it, and gate that node's output on those flags:
      //   field = (config.isX || config.isY) ? value : undefined
      // (undefined is dropped by JSON.stringify, so non-triggered fields simply
      // don't appear in the response). A node with no signal input at all is
      // unconditional (e.g. a constant feeding the response directly).
      //
      // Signal edges are: a request `pm-is*` trigger, or an internal `Do`/`Done`
      // connection (the universal trigger-in / signal-out ports for these nodes).
      // `isSignalEdge` / `triggersForNode` are defined once at the top of this
      // method (they now gate node invocations too) and reused here.
      const responseConns = this.connections.filter(
        (c) => c.toId === responseNode.id && c.toProperty.startsWith('pm-')
      );
      const byParam = new Map<string, any[]>();
      for (const conn of responseConns) {
        const param = conn.toProperty.replace('pm-', '');
        if (!byParam.has(param)) byParam.set(param, []);
        byParam.get(param)!.push(conn);
      }

      const safeName = (param: string) => (/[^a-zA-Z0-9_]/.test(param) ? `"${param}"` : param);
      const mappings: string[] = [];
      for (const [param, conns] of byParam) {
        // Fold the sources for this field into a chain of trigger-gated ternaries.
        // Base is `undefined` so a field whose operation wasn't triggered is
        // dropped from the response entirely (not pushed to the UI).
        let expr = 'undefined';
        for (let i = conns.length - 1; i >= 0; i--) {
          const resolved = resolveSourceExpr(conns[i]);
          // A source we can't resolve (e.g. an I-O node that can't run in the
          // sandbox) still keeps its field — as null — when its trigger fires,
          // so the response shape matches the aggregator's declared outputs.
          const valueExpr = resolved != null ? resolved : 'null';
          const trigs = requestNode ? triggersForNode(conns[i].fromId) : null;
          let gate: string | null;
          if (trigs === null) {
            gate = null; // unconditional — no signal gating on this source
          } else if (trigs.size > 0) {
            gate = Array.from(trigs).map((t) => this.safePropertyAccess('config', t)).join(' || ');
          } else {
            continue; // signal-gated but unreachable from any trigger — never fires
          }
          expr = gate ? `(${gate} ? ${valueExpr} : ${expr})` : valueExpr;
        }
        mappings.push(`${safeName(param)}: ${expr}`);
      }
      if (mappings.length > 0) {
        invocationCode += `const _componentOutputs = { ${mappings.join(', ')} };\n    `;
      }
    }

    return invocationCode;
  }

  /**
   * Extract maths configuration from node parameters. Becomes ctx.config in the RGS sandbox.
   */
  private extractMathsConfig(nodes: Node[]): Record<string, any> {
    const config: Record<string, any> = {};

    // 1. Extract parameters from slot game and math nodes
    nodes.forEach((node) => {
      if (
        (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) ||
        (this.mathNodeConverter && this.mathNodeConverter.isMathNode(node.typename))
      ) {
        Object.entries(node.parameters).forEach(([key, value]) => {
          // isMath is a compile-time deployment-routing flag, not maths config.
          if (key !== 'params' && key !== 'functionScript' && key !== 'isMath') {
            config[key] = value;
          }
        });
      }
    });

    // 2. Include Variable2 initial values (state defaults)
    for (const node of this.component.graph.roots) {
      if ((node.typename === 'Variable2' || node.typename === '/#__cloud__/Variable2') && node.parameters.value !== undefined) {
        const key = node.label || node.parameters.name || node.id;
        config[`_var_${key}`] = node.parameters.value;
      }
    }

    // 2026-07-14 (trace 1784044997749): read component ports from BOTH shapes. Real
    // editor Component Inputs/Outputs nodes store their ports at `node.ports` (with
    // parameters = {}); only hand-written fixtures put them under `parameters.ports`.
    // Reading ONLY parameters.ports made _portManifest empty for every real game -> the
    // deployer printed "0 inputs (none), 0 outputs (none traced)", which misled the AI
    // into thinking evaluate() was a no-op (it wasn't — data-flow tracing is by edges,
    // not ports). Fall back to node.ports and normalize type (object {name} on real
    // nodes, string on fixtures).
    const _readCompPorts = (n: any): Array<{ name: string; type: string }> => {
      const raw = ((n && n.parameters && n.parameters.ports) || (n && n.ports) || []) as any[];
      return raw
        .filter((p: any) => p && p.name)
        .map((p: any) => ({
          name: p.name,
          type: typeof p.type === 'string' ? p.type : ((p.type && (p.type.name || p.type.type)) || 'number'),
        }));
    };

    // 3. Include Component Inputs defaults
    for (const node of this.component.graph.roots) {
      if (node.typename === 'Component Inputs') {
        for (const port of _readCompPorts(node)) {
          if (port.name.toLowerCase() === 'betamount') {
            config['bet'] = config['bet'] || 100; // Default bet amount
          }
        }
      }
    }

    // 4. Build _portManifest from Component Inputs / Outputs nodes
    //    This lets the RGS Play Tester display the correct ports.
    const manifestInputs: Array<{ name: string; type: string }> = [];
    const manifestOutputs: Array<{ name: string; type: string }> = [];

    for (const node of this.component.graph.roots) {
      if (node.typename === 'Component Inputs') {
        for (const port of _readCompPorts(node)) manifestInputs.push(port);
      }
      if (node.typename === 'Component Outputs') {
        for (const port of _readCompPorts(node)) manifestOutputs.push(port);
      }
    }

    if (manifestInputs.length > 0 || manifestOutputs.length > 0) {
      config._portManifest = { inputs: manifestInputs, outputs: manifestOutputs };
    }

    return config;
  }

  /**
   * Sanitize function name for Supabase deployment
   * Removes folder structure and invalid characters while preserving uniqueness
   */
  private sanitizeFunctionNameForSupabase(originalName: string): string {
    // Remove the /#__cloud__/ prefix
    let sanitized = originalName.replace('/#__cloud__/', '');

    // Replace folder separators and spaces with underscores
    sanitized = sanitized.replace(/[/\s]+/g, '_');

    // Remove any other invalid characters for Supabase slugs
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

    // Ensure it starts with a letter or underscore
    if (/^[0-9]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }

    // Ensure it's not empty
    if (!sanitized) {
      sanitized = 'xgenia_function';
    }

    return sanitized;
  }

  /**
   * **[UPDATED]** Generates function definitions with math, slot game, standard library, and Cloud Logic node support
   */
  private generateFunctionDefinitions(nodes: Node[]): string {
    return nodes
      .map((node) => {
        if (node.typename === 'JavaScriptFunction') {
          return this.generateJavaScriptFunctionDefinition(node);
        } else if (this.mathNodeConverter && this.mathNodeConverter.isMathNode(node.typename)) {
          const functionName = this.getFunctionName(node);
          return this.mathNodeConverter.generateMathNodeFunctionDefinition(node, functionName);
        } else if (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) {
          const functionName = this.getFunctionName(node);
          return this.slotGameNodeConverter.generateSlotGameNodeFunctionDefinition(node, functionName);
        } else if (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(node.typename)) {
          const functionName = this.getFunctionName(node);
          const result = this.stdLibraryNodeConverter.convertStdLibraryNode(node, functionName);
          return result.functionDefinition;
        } else if (
          this.signalPassthroughNodeConverter &&
          this.signalPassthroughNodeConverter.isSignalPassthroughNode(node.typename)
        ) {
          const functionName = this.getFunctionName(node);
          return this.signalPassthroughNodeConverter.convertSignalPassthroughNode(node, functionName);
        } else if (this.collectionNodeConverter && this.collectionNodeConverter.isCollectionNode(node.typename)) {
          const functionName = this.getFunctionName(node);
          return this.collectionNodeConverter.convertCollectionNode(node, functionName);
        } else if (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(node.typename)) {
          const functionName = this.getFunctionName(node);
          return this.rgsExtraNodeConverter.generateNodeFunctionDefinition(node, functionName);
        } else if (node.typename.startsWith('/#__cloud__/')) {
          // Handle Cloud Logic component references
          const logicComponent = this.findCloudLogicComponent(node.typename);
          if (logicComponent) {
            return this.generateCloudLogicHelperFunction(logicComponent);
          } else {
            return `// Cloud Logic component not found: ${node.typename}`;
          }
        } else if (node.typename.startsWith('/#__maths__/')) {
          // Handle Maths Logic component references
          const mathsComponent = this.findMathsLogicComponent(node.typename);
          if (mathsComponent) {
            return this.generateMathsLogicHelperFunction(mathsComponent);
          } else {
            return `// Maths Logic component not found: ${node.typename}`;
          }
        } else if (node.typename === 'Javascript2') {
          // Javascript2 nodes use Script.Signals pattern (signal flow control).
          // In the synchronous RGS context, these are essentially passthrough/no-op.
          const funcName = this.getFunctionName(node);
          const rawOutputs = (node.parameters.scriptOutputs as Array<{name?: string}>) || [];
          const outputNames = rawOutputs.filter(o => o && o.name).map(o => this.sanitizeParameterName(o.name!));
          return `function ${funcName}(inputs) {\n  // Javascript2 signal flow node (passthrough in RGS)\n  return { ${outputNames.map(n => `${n}: true`).join(', ')} };\n}\n`;
        } else if (node.typename === 'stateManager') {
          // StateManager nodes are state containers — convert to passthrough functions
          const funcName = this.getFunctionName(node);
          const numInputs = node.parameters.numInputs || 0;
          const aliases: string[] = [];
          for (let i = 0; i < numInputs; i++) {
            const alias = node.parameters[`alias${i}`];
            if (typeof alias === 'string' && alias) aliases.push(alias);
            else aliases.push(`state${i}`);
          }
          return `function ${funcName}(inputs) {\n  // StateManager passthrough: forward all state inputs\n  return { ${aliases.map(a => `${this.sanitizeParameterName(a)}: inputs.${this.sanitizeParameterName(a)}`).join(', ')} };\n}\n`;
        }

        // Stage-2: stateful Set Variable nodes emit inline `_vars` writes in the
        // invocation stream — no function definition.
        if (node.typename === 'Set Variable' || node.typename === '/#__cloud__/Set Variable') {
          return '';
        }

        return `// Unknown node type: ${node.typename}`;
      })
      .join('\n');
  }

  /**
   * Generate JavaScript function definition
   */
  private generateJavaScriptFunctionDefinition(node: Node): string {
    const functionName = this.getFunctionName(node);
    const script = node.parameters.functionScript || '';
    const outputPorts = this.getOutputPortNames(node);

    // Detect if the function contains async operations
    const hasAsyncOperations = this.detectAsyncOperations(script);

    // Base transformations - use sanitized parameter names
    let transformedScript = script;

    // Transform Inputs.parameterName to inputs.sanitizedParameterName
    const inputPorts = node.dynamicports?.filter((p) => p.plug === 'input') || [];
    inputPorts.forEach((port) => {
      // `displayName` is what the script writes (`Inputs.<displayName>`), but it is
      // not guaranteed present — editor-model ports carry it, ports rehydrated from
      // a project export or a fixture often carry only `name`. Reading it blindly
      // threw "Cannot read properties of undefined (reading 'replace')" out of the
      // middle of code generation, which surfaces as a failed compile with no clue
      // which port caused it. Fall back to the port name, which is what the script
      // would have referenced anyway.
      const originalName = this.portScriptName(port);
      if (!originalName) return;
      const sanitizedName = this.sanitizeParameterName(originalName);
      if (originalName !== sanitizedName) {
        transformedScript = transformedScript.replace(
          new RegExp(`Inputs\\.${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
          `inputs.${sanitizedName}`
        );
      } else {
        transformedScript = transformedScript.replace(
          new RegExp(`Inputs\\.${originalName}`, 'g'),
          `inputs.${sanitizedName}`
        );
      }
    });

    // Transform Outputs.parameterName = to sanitizedParameterName =
    // Fix the variable mapping issue by ensuring proper variable names and scope
    outputPorts.forEach((portName) => {
      const originalPort = node.dynamicports?.find(
        (p) => p.plug === 'output' && this.sanitizeParameterName(this.portScriptName(p)) === portName
      );
      if (originalPort) {
        // Same fallback as the input side above: `displayName` is absent on ports
        // rehydrated from an export, and reading it blindly crashed code generation.
        const originalName = this.portScriptName(originalPort);
        if (!originalName) return;

        // Check if the variable is already declared as const in the script
        const isConstVariable = new RegExp(`const\\s+${portName}\\s*=`).test(transformedScript);

        if (originalName !== portName) {
          // More flexible regex to handle various spacing patterns
          if (isConstVariable) {
            // If it's a const variable, we need to change the assignment to modify the existing const
            // We'll change const result = value to let result = value first, then do the assignment
            transformedScript = transformedScript.replace(
              new RegExp(`const\\s+${portName}\\s*=`, 'g'),
              `let ${portName} =`
            );
          }
          transformedScript = transformedScript.replace(
            new RegExp(`Outputs\\.${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*`, 'g'),
            `${portName} = `
          );
        } else {
          // More flexible regex to handle various spacing patterns
          if (isConstVariable) {
            // If it's a const variable, we need to change the assignment to modify the existing const
            // We'll change const result = value to let result = value first, then do the assignment
            transformedScript = transformedScript.replace(
              new RegExp(`const\\s+${portName}\\s*=`, 'g'),
              `let ${portName} =`
            );
          }
          transformedScript = transformedScript.replace(
            new RegExp(`Outputs\\.${originalName}\\s*=\\s*`, 'g'),
            `${portName} = `
          );
        }
      }
    });

    // Fix common JavaScriptFunction patterns for data processing
    // Handle the case where the script tries to access res.results and res.result[key]
    // but the data is passed directly as results
    if (transformedScript.includes('res.results') && transformedScript.includes('res.result[')) {
      // Replace res.results with res and res.result[key] with res[key]
      transformedScript = transformedScript.replace(/res\.results/g, 'res');
      transformedScript = transformedScript.replace(/res\.result\[/g, 'res[');
    }

    // Handle signal outputs properly for cloud functions
    // Replace any Outputs.<Signal>() calls with boolean variables and include them in outputs
    const signalNames = new Set<string>();
    const signalCallRegex = /Outputs\.(\w+)\(\)/g;
    let match;
    while ((match = signalCallRegex.exec(transformedScript)) !== null) {
      signalNames.add(match[1]);
    }

    // Get output port names for return statement (needed for early returns)
    // outputPorts is already a string array from getOutputPortNames, so we can use it directly
    const outputPortNames = [...outputPorts]; // Create a copy

    // Declare all detected signals as booleans and include in outputs
    signalNames.forEach((name) => {
      if (!outputPortNames.includes(name)) {
        outputPortNames.push(name);
      }
    });

    // Build return statement string for early returns
    const returnStatement = `return { ${outputPortNames.join(', ')} };`;

    // Replace each signal call with a boolean assignment AND early return
    // Failure and Error signals should stop execution (early return)
    // Success signals can continue, but we'll still track them
    signalNames.forEach((name) => {
      const re = new RegExp(`Outputs\\\.${name}\\\(\\\)`, 'g');
      if (name === 'Failure' || name === 'Error') {
        // For Failure/Error signals, insert assignment + early return
        transformedScript = transformedScript.replace(re, `${name} = true;\n          ${returnStatement}`);
      } else {
        // For other signals (like Success), just assign (execution can continue)
        transformedScript = transformedScript.replace(re, `${name} = true`);
      }
    });

    // Add variable declarations for all output ports at function scope
    let variableDeclarations = '';

    // Declare all detected signals as booleans and include in outputs
    signalNames.forEach((name) => {
      if (!variableDeclarations.includes(`let ${name}`)) {
        variableDeclarations += `let ${name} = false;\n`;
      }
      if (!outputPorts.includes(name)) {
        outputPorts.push(name);
      }
    });

    // Add declarations for all other output variables
    outputPorts.forEach((portName) => {
      if (
        !variableDeclarations.includes(`let ${portName}`) &&
        !variableDeclarations.includes(`const ${portName}`) &&
        !signalNames.has(portName)
      ) {
        // Check if the variable is already declared in the transformed script
        const variableAlreadyDeclared = new RegExp(`(let|const|var)\\s+${portName}\\s*[=;]`).test(transformedScript);
        if (!variableAlreadyDeclared) {
          variableDeclarations += `let ${portName};\n`;
        }
      }
    });

    // --- Targeted slot spin result fixes ---
    // 1) Avoid TS property errors when adding jackpotWinningDetails after object literal creation
    if (transformedScript.includes('jackpotWinningDetails')) {
      transformedScript = transformedScript.replace(/\.jackpotWinningDetails\b/g, "['jackpotWinningDetails']");
    }

    // 2) Ensure CurrentFreeSpins is declared when used in Finalize Spin Result scripts
    const needsCurrentFreeSpinsDecl =
      transformedScript.includes('CurrentFreeSpins =') && !/let\s+CurrentFreeSpins\b/.test(variableDeclarations);
    if (needsCurrentFreeSpinsDecl) {
      variableDeclarations += 'let CurrentFreeSpins;\n';
      if (!outputPorts.includes('CurrentFreeSpins')) {
        outputPorts.push('CurrentFreeSpins');
      }
    }

    // Generate the result object that describes the outcome (include a generic isSuccess if present)
    if (signalNames.size > 0) {
      const resultFields: string[] = [];
      // Include a generic isSuccess if there is a Success signal
      if (signalNames.has('Success')) {
        resultFields.push('isSuccess: Success || false');
      }
      // Also mirror each signal as a boolean field in result for routing if needed
      signalNames.forEach((name) => {
        const field = `${name.charAt(0).toLowerCase()}${name.slice(1)}`;
        resultFields.push(`${field}: ${name} || false`);
      });
    }

    // Determine if function should be async — use PLAIN JS (no TS annotations) for RGS sandbox
    const functionSignature = hasAsyncOperations
      ? `const ${functionName} = async (inputs) => {`
      : `const ${functionName} = (inputs) => {`;

    return `
        ${functionSignature}
          ${variableDeclarations}${transformedScript}
          return { ${outputPorts.join(', ')} };
        };`;
  }

  // --- No other methods need to be changed. The rest of the class remains the same. ---

  private findNodeByType(type: Node['typename']): Node | undefined {
    return this.component.graph.roots.find((node) => node.typename === type);
  }

  private findAllNodesByType(type: Node['typename']): Node[] {
    return this.component.graph.roots.filter((node) => node.typename === type);
  }

  /**
   * Find all math nodes in the component
   */
  private findAllMathNodes(): Node[] {
    if (!this.mathNodeConverter) {
      console.warn('MathNodeConverter not initialized, returning empty array');
      return [];
    }
    return this.component.graph.roots.filter((node) => this.mathNodeConverter.isMathNode(node.typename));
  }

  // Non-visual nodes not handled by any other converter (provably-fair / data /
  // I-O). These are extracted to the backend by Compile, so the RGS script must
  // generate functions for them — otherwise their outputs are dropped.
  private findAllExtraNodes(): Node[] {
    if (!this.rgsExtraNodeConverter) {
      return [];
    }
    return this.component.graph.roots.filter((node) => this.rgsExtraNodeConverter.isExtraNode(node.typename));
  }

  /**
   * Find all slot game nodes in the component
   */
  private findAllSlotGameNodes(): Node[] {
    if (!this.slotGameNodeConverter) {
      console.warn('SlotGameNodeConverter not initialized, returning empty array');
      return [];
    }
    return this.component.graph.roots.filter((node) => this.slotGameNodeConverter.isSlotGameNode(node.typename));
  }

  /**
   * Find all standard library nodes in the component
   */
  private findAllStdLibraryNodes(): Node[] {
    if (!this.stdLibraryNodeConverter) {
      console.warn('StdLibraryNodeConverter not initialized, returning empty array');
      return [];
    }
    return this.component.graph.roots.filter((node) => this.stdLibraryNodeConverter.isStdLibraryNode(node.typename));
  }

  /**
   * Find all signal passthrough nodes in the component
   */
  private findAllSignalPassthroughNodes(): Node[] {
    if (!this.signalPassthroughNodeConverter) {
      console.warn('SignalPassthroughNodeConverter not initialized, returning empty array');
      return [];
    }
    return this.component.graph.roots.filter((node) =>
      this.signalPassthroughNodeConverter.isSignalPassthroughNode(node.typename)
    );
  }

  /**
   * Find all collection nodes in the component
   */
  private findAllCollectionNodes(): Node[] {
    if (!this.collectionNodeConverter) {
      console.warn('CollectionNodeConverter not initialized, returning empty array');
      return [];
    }
    return this.component.graph.roots.filter((node) => this.collectionNodeConverter.isCollectionNode(node.typename));
  }

  private getRequestInputParams(requestNode?: Node): string[] {
    if (!requestNode?.dynamicports) return [];
    return requestNode.dynamicports
      .filter((p) => p.plug === 'output')
      .map((p) => this.sanitizeParameterName(this.portScriptName(p)));
  }

  private generateFunctionInvocations(nodes: Node[], requestNode?: Node): string {
    let invocationCode = '';
    const outputVariableMap = new Map<string, string>();

    // Gate each node's invocation on the request operation-triggers (`is<Op>`)
    // that reach its `Do`, so an operation the request never triggered doesn't
    // run its nodes (e.g. a Division that would throw "Division by zero" on an
    // unrelated request). Untriggered nodes keep {} — downstream reads and
    // response fields then resolve to undefined and drop out of the JSON.
    // No-op when there is no aggregator request node. See buildTriggerResolver().
    const triggersForNode = this.buildTriggerResolver(requestNode);
    const invocationGateFor = (nodeId: string): string | null => {
      const trigs = triggersForNode(nodeId);
      if (trigs === null) return null;
      if (trigs.size === 0) return 'false';
      return Array.from(trigs)
        .map((t) => this.safePropertyAccess('requestBody', t))
        .join(' || ');
    };

    nodes.forEach((node) => {
      const functionName = this.getFunctionName(node);

      // For math, slot game, standard library, signal passthrough, collection, and RGS-extra
      // nodes, we need to handle the case where dynamicports might be empty
      // but connections exist with the actual port names
      let inputConnections;
      if (
        (this.mathNodeConverter && this.mathNodeConverter.isMathNode(node.typename)) ||
        (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) ||
        (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(node.typename)) ||
        (this.signalPassthroughNodeConverter &&
          this.signalPassthroughNodeConverter.isSignalPassthroughNode(node.typename)) ||
        (this.collectionNodeConverter && this.collectionNodeConverter.isCollectionNode(node.typename)) ||
        (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(node.typename))
      ) {
        // For these nodes, look for connections to this node regardless of port prefix.
        // RGS-extra nodes (e.g. Convert Inputs into Record) name their dynamic value
        // ports "input{i}"/"key{i}", which do NOT carry the "in-" prefix the generic
        // branch below filters on — without this, their connections are silently
        // dropped and the generated function falls back to defaults.
        inputConnections = this.connections.filter((c) => c.toId === node.id);
      } else if (node.typename.startsWith('/#__cloud__/') || node.typename.startsWith('/#__maths__/')) {
        // For Cloud/Maths Logic component references, no input connections needed (they're self-contained)
        inputConnections = [];
      } else {
        // For other nodes, use the original logic
        inputConnections = this.connections.filter((c) => c.toId === node.id && c.toProperty.startsWith('in-'));
      }

      // Build input object for the function call
      let inputObject: string;

      if (node.typename.startsWith('/#__cloud__/') || node.typename.startsWith('/#__maths__/')) {
        // For Cloud/Maths Logic component references, no inputs needed (they're self-contained)
        inputObject = '';
      } else if (
        (this.mathNodeConverter && this.mathNodeConverter.isMathNode(node.typename)) ||
        (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) ||
        (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(node.typename)) ||
        (this.signalPassthroughNodeConverter &&
          this.signalPassthroughNodeConverter.isSignalPassthroughNode(node.typename)) ||
        (this.collectionNodeConverter && this.collectionNodeConverter.isCollectionNode(node.typename)) ||
        (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(node.typename))
      ) {
        // For math and slot game nodes, we need to include ALL required parameters
        // Some may come from connections, others from node parameters (sidepanel)
        const inputMappings = new Map<string, string>();

        // First, add parameters from connections
        inputConnections.forEach((conn) => {
          // For REST nodes, get the port to use displayName instead of toProperty
          // since toProperty might be 'in-prompt' (invalid JS identifier)
          // Also handle special ports like 'fetch' which are standard ports, not dynamic
          let inputName: string;
          if (node.typename === 'REST2' || node.typename === 'REST') {
            // Handle special standard ports (fetch, resource, method, cancel)
            if (
              conn.toProperty === 'fetch' ||
              conn.toProperty === 'resource' ||
              conn.toProperty === 'method' ||
              conn.toProperty === 'cancel'
            ) {
              inputName = conn.toProperty;
            } else {
              const targetPort = this.findPort(conn.toId, conn.toProperty);
              if (targetPort) {
                inputName = this.sanitizeParameterName(targetPort.displayName);
              } else {
                // Fallback: strip 'in-' prefix and sanitize
                inputName = this.sanitizeParameterName(conn.toProperty.replace(/^in-/, ''));
              }
            }
          } else if (node.typename === 'NewDbModelProperties' && conn.toProperty.startsWith('prop-')) {
            // For NewDbModelProperties, strip 'prop-' prefix from property inputs
            // The field name is what we want in the function
            inputName = conn.toProperty.replace(/^prop-/, '');
          } else {
            inputName = conn.toProperty; // e.g., 'firstNumber', 'secondNumber'
          }

          let sourceValue: string;
          if (conn.fromId === requestNode?.id) {
            // Connection from request node
            const requestPort = this.findPort(conn.fromId, conn.fromProperty);
            if (requestPort) {
              const originalName = requestPort.displayName;
              // Use square bracket notation for parameters with spaces or special characters
              if (originalName.includes(' ') || /[^a-zA-Z0-9_]/.test(originalName)) {
                sourceValue = `requestBody['${originalName}']`;
              } else {
                sourceValue = `requestBody.${originalName}`;
              }
            } else {
              // For signal connections (like 'do', 'eval'), set to true
              if (conn.toProperty === 'do' || conn.toProperty === 'eval') {
                sourceValue = 'true';
              } else {
                sourceValue = 'undefined';
              }
            }
          } else {
            // Connection from another function node (including math, slot game, and standard library nodes)
            if (outputVariableMap.has(conn.fromId)) {
              const sourceNodeType = this.nodes.get(conn.fromId)?.typename || '';

              // DbConfig nodes are variables, not result objects - access directly
              if (sourceNodeType === 'DbConfig') {
                // For DbConfig, the variable IS the value, so use it directly
                sourceValue = `${outputVariableMap.get(conn.fromId)}`;
              } else if (
                (this.mathNodeConverter && this.mathNodeConverter.isMathNode(sourceNodeType)) ||
                (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(sourceNodeType)) ||
                (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(sourceNodeType)) ||
                (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(sourceNodeType))
              ) {
                // For REST nodes, use bracket notation and strip 'out-' prefix from fromProperty
                // because REST node outputs are stored without the 'out-' prefix
                const isRestNode = sourceNodeType === 'REST2' || sourceNodeType === 'REST';
                if (isRestNode) {
                  // Strip 'out-' prefix if present (e.g., 'out-res' -> 'res')
                  const outputName = conn.fromProperty.startsWith('out-')
                    ? conn.fromProperty.replace(/^out-/, '')
                    : conn.fromProperty;
                  sourceValue = `${outputVariableMap.get(conn.fromId)}['${outputName}']`;
                } else {
                  // For math, slot game, and standard library nodes, use the fromProperty directly as the output name
                  sourceValue = `${outputVariableMap.get(conn.fromId)}.${conn.fromProperty}`;
                }
              } else {
                // For other nodes, use the port display name
                const sourcePort = this.findPort(conn.fromId, conn.fromProperty);
                if (sourcePort) {
                  const outputParamName = this.sanitizeParameterName(sourcePort.displayName);
                  sourceValue = `${outputVariableMap.get(conn.fromId)}.${outputParamName}`;
                } else {
                  sourceValue = 'undefined';
                }
              }
            } else {
              sourceValue = 'undefined';
            }
          }

          inputMappings.set(inputName, sourceValue);
        });

        // Then, add parameters from node.parameters (sidepanel values) as fallbacks
        // These will only be used if no connection value exists for that parameter
        Object.entries(node.parameters).forEach(([paramName, paramValue]) => {
          // Skip special parameters that aren't input ports
          // For REST nodes, requestScript and responseScript are embedded in the function body, not passed as parameters
          if (paramName === 'params' || paramName === 'functionScript') {
            return;
          }
          // isMath is a deployment-routing flag (Compile feature), not a data input.
          if (paramName === 'isMath') {
            return;
          }
          // Exclude requestScript and responseScript for REST nodes (they're embedded in function body)
          if (
            (node.typename === 'REST2' || node.typename === 'REST') &&
            (paramName === 'requestScript' || paramName === 'responseScript')
          ) {
            return;
          }

          // For NewDbModelProperties, handle prop-* parameters specially
          if (node.typename === 'NewDbModelProperties' && paramName.startsWith('prop-')) {
            const fieldName = paramName.replace(/^prop-/, '');
            // Only add if this field doesn't already have a connection value
            if (!inputMappings.has(fieldName)) {
              // Format the parameter value for JavaScript
              let formattedValue: string;
              if (typeof paramValue === 'string') {
                formattedValue = JSON.stringify(paramValue);
              } else if (typeof paramValue === 'number') {
                formattedValue = String(paramValue);
              } else if (typeof paramValue === 'boolean') {
                formattedValue = String(paramValue);
              } else {
                formattedValue = JSON.stringify(paramValue);
              }

              inputMappings.set(fieldName, formattedValue);
            }
            return; // Skip the default handling for prop-* params
          }

          // Only add if this parameter doesn't already have a connection value
          if (!inputMappings.has(paramName)) {
            // Format the parameter value for JavaScript
            let formattedValue: string;
            if (typeof paramValue === 'string') {
              formattedValue = JSON.stringify(paramValue);
            } else if (typeof paramValue === 'number') {
              formattedValue = String(paramValue);
            } else if (typeof paramValue === 'boolean') {
              formattedValue = String(paramValue);
            } else {
              formattedValue = JSON.stringify(paramValue);
            }

            inputMappings.set(paramName, formattedValue);
          }
        });

        // For slot game nodes, always add request body parameters
        if (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(node.typename)) {
          // Add request body as the main input for slot game nodes
          inputMappings.set('requestBody', 'requestBody');

          // Also add individual request parameters if they exist
          if (requestNode?.dynamicports) {
            requestNode.dynamicports
              .filter((p) => p.plug === 'output')
              .forEach((port) => {
                const originalName = this.portScriptName(port);
                const paramName = this.sanitizeParameterName(originalName);
                if (!inputMappings.has(paramName)) {
                  // Use square bracket notation for parameters with spaces or special characters
                  if (originalName.includes(' ') || /[^a-zA-Z0-9_]/.test(originalName)) {
                    inputMappings.set(paramName, `requestBody['${originalName}']`);
                  } else {
                    inputMappings.set(paramName, `requestBody.${originalName}`);
                  }
                }
              });
          }
        }

        // For REST nodes, add default values for fetch, resource, and method if not connected
        if (node.typename === 'REST2' || node.typename === 'REST') {
          // Default fetch to true if not connected (REST nodes should execute automatically in cloud functions)
          if (!inputMappings.has('fetch')) {
            // Check if there's a connection to 'fetch' input
            const fetchConnection = inputConnections.find((c) => c.toProperty === 'fetch');
            if (!fetchConnection) {
              inputMappings.set('fetch', 'true');
            }
          }

          // Add resource and method from node parameters if not connected
          if (!inputMappings.has('resource') && node.parameters.resource) {
            inputMappings.set('resource', JSON.stringify(node.parameters.resource));
          }
          if (!inputMappings.has('method') && node.parameters.method) {
            inputMappings.set('method', JSON.stringify(node.parameters.method));
          }
        }

        // Convert to string
        inputObject = Array.from(inputMappings.entries())
          .map(([name, value]) => {
            // Check if property name contains hyphens or other special characters that require quoting
            // JavaScript/TypeScript requires quoted property names when they contain hyphens or other non-alphanumeric characters (except _)
            const needsQuotes = /[^a-zA-Z0-9_]/.test(name);
            return needsQuotes ? `"${name}": ${value}` : `${name}: ${value}`;
          })
          .join(', ');
      } else {
        // For other nodes, use the original logic
        inputObject = inputConnections
          .map((conn) => {
            const targetPort = this.findPort(conn.toId, conn.toProperty);
            if (!targetPort) {
              return '';
            }
            const inputName = this.sanitizeParameterName(targetPort.displayName);

            // Determine the source value
            let sourceValue: string;
            if (conn.fromId === requestNode?.id) {
              // Connection from request node
              const requestPort = this.findPort(conn.fromId, conn.fromProperty);
              if (requestPort) {
                const originalName = requestPort.displayName;
                // Use square bracket notation for parameters with spaces or special characters
                if (originalName.includes(' ') || /[^a-zA-Z0-9_]/.test(originalName)) {
                  sourceValue = `requestBody['${originalName}']`;
                } else {
                  sourceValue = `requestBody.${originalName}`;
                }
              } else {
                sourceValue = 'undefined';
              }
            } else {
              // Connection from another function node
              const sourceNode = this.nodes.get(conn.fromId);
              if (sourceNode && outputVariableMap.has(conn.fromId)) {
                // DbConfig nodes are variables, not result objects - access directly
                if (sourceNode.typename === 'DbConfig') {
                  // For DbConfig, the variable IS the value, so use it directly
                  sourceValue = `${outputVariableMap.get(conn.fromId)}`;
                } else if (
                  (this.mathNodeConverter && this.mathNodeConverter.isMathNode(sourceNode.typename)) ||
                  (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(sourceNode.typename)) ||
                  (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(sourceNode.typename)) ||
                  (this.rgsExtraNodeConverter && this.rgsExtraNodeConverter.isExtraNode(sourceNode.typename))
                ) {
                  // For REST nodes, use bracket notation and strip 'out-' prefix from fromProperty
                  // because REST node outputs are stored without the 'out-' prefix
                  const isRestNode = sourceNode.typename === 'REST2' || sourceNode.typename === 'REST';
                  if (isRestNode) {
                    // Strip 'out-' prefix if present (e.g., 'out-res' -> 'res')
                    const outputName = conn.fromProperty.startsWith('out-')
                      ? conn.fromProperty.replace(/^out-/, '')
                      : conn.fromProperty;
                    sourceValue = `${outputVariableMap.get(conn.fromId)}['${outputName}']`;
                  } else {
                    // For math, slot game, and standard library nodes, use the fromProperty directly as the output name
                    sourceValue = `${outputVariableMap.get(conn.fromId)}.${conn.fromProperty}`;
                  }
                } else {
                  // For other nodes, use the port display name
                  const sourcePort = this.findPort(conn.fromId, conn.fromProperty);
                  if (sourcePort) {
                    const outputParamName = this.sanitizeParameterName(sourcePort.displayName);
                    sourceValue = `${outputVariableMap.get(conn.fromId)}.${outputParamName}`;
                  } else {
                    sourceValue = 'undefined';
                  }
                }
              } else {
                sourceValue = 'undefined';
              }
            }

            // Check if property name contains hyphens or other special characters that require quoting
            const needsQuotes = /[^a-zA-Z0-9_]/.test(inputName);
            return needsQuotes ? `"${inputName}": ${sourceValue}` : `${inputName}: ${sourceValue}`;
          })
          .filter((mapping) => mapping !== '') // Remove empty mappings
          .join(', ');
      }

      const outputVar = `${functionName}Result`;
      const nodeLabel = node.label || functionName;
      const gate = invocationGateFor(node.id);
      // Emit a (possibly gated) invocation of `callExpr`. When gated, the node is
      // only called if its request trigger fired; otherwise its result stays {}
      // (mirrors the editor, where an untriggered node never computes, so its
      // response fields resolve to undefined and drop out of the JSON).
      const emitCall = (callExpr: string) => {
        if (gate === null) {
          invocationCode += `const ${outputVar} = ${callExpr};\n    `;
        } else if (gate === 'false') {
          invocationCode += `let ${outputVar} = {}; /* [${nodeLabel}] not invoked: no request trigger reaches its Do */\n    `;
        } else {
          invocationCode += `let ${outputVar} = {};\n    if (${gate}) { ${outputVar} = ${callExpr}; }\n    `;
        }
      };

      if (node.typename.startsWith('/#__cloud__/') || node.typename.startsWith('/#__maths__/')) {
        // For Cloud/Maths Logic component references, we need to pass input parameters
        const isCloudRef = node.typename.startsWith('/#__cloud__/');
        const logicComponent = isCloudRef
          ? this.findCloudLogicComponent(node.typename)
          : this.findMathsLogicComponent(node.typename);
        if (logicComponent) {
          // Get input connections to this component
          const inputConnections = this.connections.filter((c) => c.toId === node.id);

          // Filter out the "Do" connection (which is a signal, not a data connection)
          const dataInputConnections = inputConnections.filter((c) => c.toProperty !== 'Do');

          // Build input object for the Logic component
          let inputObject: string;
          if (dataInputConnections.length > 0) {
            inputObject = dataInputConnections
              .map((conn) => {
                // Find the port in the actual Logic component
                const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');

                const targetPort = jsNode?.dynamicports?.find(
                  (p) =>
                    p.plug === 'input' &&
                    (p.name === conn.toProperty ||
                      p.displayName === conn.toProperty ||
                      p.name === `in-${conn.toProperty}` ||
                      p.displayName === conn.toProperty)
                );

                if (!targetPort) {
                  return '';
                }
                const inputName = this.sanitizeParameterName(targetPort.displayName);

                // Determine the source value
                let sourceValue: string;
                if (conn.fromId === requestNode?.id) {
                  // Connection from request node
                  const requestPort = this.findPort(conn.fromId, conn.fromProperty);
                  if (requestPort) {
                    const originalName = requestPort.displayName;
                    if (originalName.includes(' ') || /[^a-zA-Z0-9_]/.test(originalName)) {
                      sourceValue = `requestBody['${originalName}']`;
                    } else {
                      sourceValue = `requestBody.${originalName}`;
                    }
                  } else {
                    sourceValue = 'undefined';
                  }
                } else {
                  // Connection from another function node
                  const sourceNode = this.nodes.get(conn.fromId);
                  if (sourceNode && outputVariableMap.has(conn.fromId)) {
                    const sourcePort = this.findPort(conn.fromId, conn.fromProperty);
                    if (sourcePort) {
                      const outputParamName = this.sanitizeParameterName(sourcePort.displayName);
                      sourceValue = `${outputVariableMap.get(conn.fromId)}.${outputParamName}`;
                    } else {
                      sourceValue = 'undefined';
                    }
                  } else {
                    sourceValue = 'undefined';
                  }
                }

                const needsQuotes = /[^a-zA-Z0-9_]/.test(inputName);
                return needsQuotes ? `"${inputName}": ${sourceValue}` : `${inputName}: ${sourceValue}`;
              })
              .filter((mapping) => mapping !== '')
              .join(', ');
          } else {
            inputObject = '';
          }

          // Check if the Logic component has async operations
          const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');
          const hasAsyncOperations = jsNode
            ? this.detectAsyncOperations(jsNode.parameters.functionScript || '')
            : false;

          const awaitPrefix = hasAsyncOperations ? 'await ' : '';
          if (inputObject) {
            emitCall(`${awaitPrefix}${functionName}({ ${inputObject} })`);
          } else {
            emitCall(`${awaitPrefix}${functionName}()`);
          }
        } else {
          // Fallback if Logic component not found
          emitCall(`${functionName}()`);
        }
      } else {
        // DbConfig nodes are variables, not functions - skip function invocation
        if (node.typename === 'DbConfig') {
          // For DbConfig, the variable is already declared in function definitions
          // Store the variable name directly (not a Result object)
          outputVariableMap.set(node.id, functionName);
          return; // Skip the rest of the loop iteration
        }

        // For other nodes, check if they have async operations
        // REST nodes are always async (they use fetch), so always await them
        const isRestNode = node.typename === 'REST2' || node.typename === 'REST';

        // Check if standard library node is async by checking its function definition
        // Note: functionName is already defined earlier in this function
        let isAsyncStdLibraryNode = false;
        if (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(node.typename)) {
          const result = this.stdLibraryNodeConverter.convertStdLibraryNode(node, functionName);
          // Check if function definition contains 'async'
          isAsyncStdLibraryNode = result.functionDefinition.includes('async');
        }

        const hasAsyncOperations =
          isRestNode || isAsyncStdLibraryNode || this.detectAsyncOperations(node.parameters.functionScript || '');

        emitCall(`${hasAsyncOperations ? 'await ' : ''}${functionName}({ ${inputObject} })`);
      }

      outputVariableMap.set(node.id, outputVar);
    });

    return invocationCode;
  }

  /**
   * Get final response statement with status code logic based on Success/Failure signals
   */
  private getFinalResponseStatementWithStatus(): { responseStatement: string; statusCodeLogic: string } {
    const responseNode = this.findNodeByType('xgenia.cloud.response');
    if (!responseNode) {
      return {
        responseStatement: '{ "error": "Response node not found" }',
        statusCodeLogic: 'let httpStatus = 500;'
      };
    }

    // Get ALL connections to the response node (not just the first one)
    const responseConnections = this.connections.filter((c) => c.toId === responseNode.id);
    if (responseConnections.length === 0) {
      return {
        responseStatement: '{}',
        statusCodeLogic: 'let httpStatus = 200;'
      };
    }

    // Get all function nodes to check for Success/Failure signals
    const allFunctionNodes = [
      ...this.findAllNodesByType('JavaScriptFunction'),
      ...this.findAllMathNodes(),
      ...this.findAllSlotGameNodes(),
      ...this.findAllStdLibraryNodes(),
      ...this.findAllSignalPassthroughNodes(),
      ...this.findAllCollectionNodes(),
      ...this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/')),
      ...this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'))
    ];

    // Detect Success and Failure signals from all function results
    const signalChecks: string[] = [];
    const hasSignals = this.detectAllSignals(allFunctionNodes, signalChecks);

    // Generate status code logic based on signals
    let statusCodeLogic = '';
    if (hasSignals && signalChecks.length > 0) {
      // Collect unique result variables that have signals
      const resultVarsWithFailure = new Set<string>();
      const resultVarsWithSuccess = new Set<string>();

      // Get all function nodes to extract result variable names
      const jsFunctionNodes = this.findAllNodesByType('JavaScriptFunction');
      const cloudLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/'));
      const mathsLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'));

      for (const node of [...jsFunctionNodes, ...cloudLogicNodes, ...mathsLogicNodes]) {
        const functionName = this.getFunctionName(node);
        const resultVar = `${functionName}Result`;

        // Check for signals in JavaScriptFunction nodes
        if (node.typename === 'JavaScriptFunction') {
          const script = node.parameters.functionScript || '';
          const signalCallRegex = /Outputs\.(\w+)\(\)/g;
          let match;
          while ((match = signalCallRegex.exec(script)) !== null) {
            const signalName = match[1];
            if (signalName === 'Failure' || signalName === 'Error') {
              resultVarsWithFailure.add(resultVar);
            } else if (signalName === 'Success') {
              resultVarsWithSuccess.add(resultVar);
            }
          }
        }
        // Check for signals in Cloud/Maths Logic components
        else if (node.typename.startsWith('/#__cloud__/') || node.typename.startsWith('/#__maths__/')) {
          const isCloudRef = node.typename.startsWith('/#__cloud__/');
          const logicComponent = isCloudRef
            ? this.findCloudLogicComponent(node.typename)
            : this.findMathsLogicComponent(node.typename);
          if (logicComponent) {
            const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');
            if (jsNode) {
              const script = jsNode.parameters.functionScript || '';
              const signalCallRegex = /Outputs\.(\w+)\(\)/g;
              let match;
              while ((match = signalCallRegex.exec(script)) !== null) {
                const signalName = match[1];
                if (signalName === 'Failure' || signalName === 'Error') {
                  resultVarsWithFailure.add(resultVar);
                } else if (signalName === 'Success') {
                  resultVarsWithSuccess.add(resultVar);
                }
              }
            }
          }
        }
      }

      // Generate status code logic
      const failureChecks = Array.from(resultVarsWithFailure)
        .map((resultVar) => `${resultVar}?.Failure === true || ${resultVar}?.Error === true`)
        .join(' || ');

      const successChecks = Array.from(resultVarsWithSuccess)
        .map((resultVar) => `${resultVar}?.Success === true`)
        .join(' || ');

      if (failureChecks || successChecks) {
        // Generate error throwing logic for Failure/Error signals
        let errorThrowingLogic = '';
        if (failureChecks) {
          // Build logic to extract error message from result variables
          const errorExtractions = Array.from(resultVarsWithFailure)
            .map((resultVar) => {
              return `(${resultVar}?.Failure === true || ${resultVar}?.Error === true) ? (${resultVar}?.Error || 'Bad request') : null`;
            })
            .join(' || ');

          errorThrowingLogic = `// Check for Failure/Error signals and throw error with message
    const errorMessage = ${errorExtractions};
    if (errorMessage) {
      throw new Error(errorMessage);
    }`;
        }

        // Generate status code logic for Success signals
        let successStatusLogic = '';
        if (successChecks && !failureChecks) {
          // Only check success if there are no failure checks (failures throw errors)
          successStatusLogic = `// Check for Success signal
    if (${successChecks}) {
      httpStatus = 200; // Success
    }`;
        }

        statusCodeLogic = `
    // Determine HTTP status code based on Success/Failure signals
    let httpStatus = 200; // Default to success
    
    ${errorThrowingLogic}
    
    ${successStatusLogic}`;
      } else {
        statusCodeLogic = '    let httpStatus = 200; // Default success status';
      }
    } else {
      // No signals detected, default to 200
      statusCodeLogic = '    let httpStatus = 200; // Default success status';
    }

    // Generate response statement (same logic as before)
    // Check if we have Cloud/Maths Logic components with signal outputs
    const cloudLogicConnections = responseConnections.filter((conn) => {
      const sourceNode = this.nodes.get(conn.fromId);
      return sourceNode && (sourceNode.typename.startsWith('/#__cloud__/') || sourceNode.typename.startsWith('/#__maths__/'));
    });

    let responseStatement: string;
    // If we have Cloud/Maths Logic components, we need to implement signal routing
    if (cloudLogicConnections.length > 0) {
      responseStatement = this.generateSignalBasedResponse(cloudLogicConnections, responseNode);
    } else {
      // Filter out signal connections (like 'send') - only process parameter connections (pm-*)
      const parameterConnections = responseConnections.filter((conn) => {
        // Only process connections to parameter ports (pm-*) or dynamic parameter ports
        const responsePort = this.findPort(responseNode.id, conn.toProperty);
        return responsePort && (conn.toProperty.startsWith('pm-') || responsePort.plug === 'input');
      });

      // Group connections by response parameter to detect conflicts
      const connectionsByResponseParam = new Map<string, typeof responseConnections>();
      for (const conn of parameterConnections) {
        const responseParam = conn.toProperty;
        if (!connectionsByResponseParam.has(responseParam)) {
          connectionsByResponseParam.set(responseParam, []);
        }
        connectionsByResponseParam.get(responseParam)!.push(conn);
      }

      // Process each response parameter
      const responseMappings: string[] = [];

      for (const [responseParam, connections] of connectionsByResponseParam) {
        const responsePort = this.findPort(responseNode.id, responseParam);
        if (!responsePort) continue;

        // Use original parameter name for response field, not sanitized
        // Quote the field name if it contains spaces or special characters
        const responseFieldName =
          responsePort.displayName.includes(' ') || /[^a-zA-Z0-9_]/.test(responsePort.displayName)
            ? `"${responsePort.displayName}"`
            : responsePort.displayName;

        // If multiple connections to the same response parameter, handle conditionally
        if (connections.length > 1) {
          // Check if this is a conditional response (If node with multiple outputs)
          const ifNode = this.findIfNodeForConditionalResponse(connections);
          if (ifNode) {
            // Generate conditional logic for the response
            const conditionalValue = this.generateConditionalResponseValue(ifNode, connections);
            responseMappings.push(`${responseFieldName}: ${conditionalValue}`);
          } else {
            // For non-conditional multiple connections, use the last one (fallback)
            const lastConnection = connections[connections.length - 1];
            const value = this.generateConnectionValue(lastConnection);
            responseMappings.push(`${responseFieldName}: ${value}`);
          }
        } else {
          // Single connection - handle normally
          const connection = connections[0];
          const value = this.generateConnectionValue(connection);
          responseMappings.push(`${responseFieldName}: ${value}`);
        }
      }

      // Generate the final response object
      if (responseMappings.length === 0) {
        responseStatement = '{}';
      } else {
        responseStatement = `{ ${responseMappings.join(', ')} }`;
      }
    }

    return { responseStatement, statusCodeLogic };
  }

  /**
   * Detect all Success/Failure signals from function nodes and generate check statements
   */
  private detectAllSignals(nodes: Node[], signalChecks: string[]): boolean {
    let hasSignals = false;

    for (const node of nodes) {
      const functionName = this.getFunctionName(node);
      const resultVar = `${functionName}Result`;

      // Check for signals in JavaScriptFunction nodes
      if (node.typename === 'JavaScriptFunction') {
        const script = node.parameters.functionScript || '';
        const signalNames = new Set<string>();
        const signalCallRegex = /Outputs\.(\w+)\(\)/g;
        let match;
        while ((match = signalCallRegex.exec(script)) !== null) {
          signalNames.add(match[1]);
        }

        if (signalNames.size > 0) {
          hasSignals = true;
          signalNames.forEach((signalName) => {
            signalChecks.push(`${resultVar}?.${signalName}`);
          });
        }
      }
      // Check for signals in Cloud/Maths Logic components
      else if (node.typename.startsWith('/#__cloud__/') || node.typename.startsWith('/#__maths__/')) {
        const isCloudRef = node.typename.startsWith('/#__cloud__/');
        const logicComponent = isCloudRef
          ? this.findCloudLogicComponent(node.typename)
          : this.findMathsLogicComponent(node.typename);
        if (logicComponent) {
          const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');
          if (jsNode) {
            const script = jsNode.parameters.functionScript || '';
            const signalNames = new Set<string>();
            const signalCallRegex = /Outputs\.(\w+)\(\)/g;
            let match;
            while ((match = signalCallRegex.exec(script)) !== null) {
              signalNames.add(match[1]);
            }

            if (signalNames.size > 0) {
              hasSignals = true;
              signalNames.forEach((signalName) => {
                signalChecks.push(`${resultVar}?.${signalName}`);
              });
            }
          }
        }
      }
    }

    return hasSignals;
  }

  /**
   * Generate signal-based response for Cloud Logic components
   * Implements the pattern: helper function returns result object, main function routes based on result
   */
  private generateSignalBasedResponse(cloudLogicConnections: Connection[], responseNode: Node): string {
    // Removed __signals usage; simply map the connection value
    const cloudLogicConnection = cloudLogicConnections[0];
    return this.generateConnectionValue(cloudLogicConnection);
  }

  /**
   * Check if any Cloud Logic components have signal outputs
   */
  private hasCloudLogicWithSignals(): boolean {
    const cloudLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__cloud__/'));
    const mathsLogicNodes = this.component.graph.roots.filter((node) => node.typename.startsWith('/#__maths__/'));

    for (const node of [...cloudLogicNodes, ...mathsLogicNodes]) {
      const isCloudRef = node.typename.startsWith('/#__cloud__/');
      const logicComponent = isCloudRef
        ? this.findCloudLogicComponent(node.typename)
        : this.findMathsLogicComponent(node.typename);
      if (logicComponent) {
        const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');
        if (jsNode && jsNode.parameters.functionScript) {
          const script = jsNode.parameters.functionScript;
          if (
            script.includes('Outputs.Success()') ||
            script.includes('Outputs.Error()') ||
            script.includes('Outputs.Failure()')
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Get HTTP status code based on response content
   */
  private getResponseStatus(responseContent: any): number {
    if (typeof responseContent === 'object' && responseContent !== null) {
      if (responseContent.status === 'error' || responseContent.status === 'failure') {
        return 400;
      }
      if (responseContent.status === 'success') {
        return 200;
      }
    }
    return 200; // Default to success
  }

  /**
   * Find If node that controls conditional response
   */
  private findIfNodeForConditionalResponse(connections: Connection[]): Node | null {
    // Look for If node in the source chain by checking if any source nodes
    // are connected to an If node's outputs
    for (const conn of connections) {
      const sourceNode = this.nodes.get(conn.fromId);
      if (sourceNode) {
        // Check if this source node is connected to an If node's outputs
        const ifConnections = this.connections.filter(
          (c) =>
            c.fromId !== conn.fromId &&
            c.toId === conn.fromId &&
            (c.fromProperty === 'trueCondition' || c.fromProperty === 'falseCondition')
        );

        if (ifConnections.length > 0) {
          const ifNodeId = ifConnections[0].fromId;
          const ifNode = this.nodes.get(ifNodeId);
          if (ifNode && ifNode.typename === 'If') {
            return ifNode;
          }
        }
      }
    }
    return null;
  }

  /**
   * Generate conditional response value based on If node logic
   */
  private generateConditionalResponseValue(ifNode: Node, connections: Connection[]): string {
    const ifResult = `${this.getFunctionName(ifNode)}Result`;

    // Find the true and false connections by checking which String nodes
    // are connected to the If node's trueCondition and falseCondition outputs
    const trueConnection = connections.find((conn) => {
      const sourceNode = this.nodes.get(conn.fromId);
      return (
        sourceNode &&
        sourceNode.typename === 'String' &&
        this.connections.some(
          (c) => c.fromId === ifNode.id && c.fromProperty === 'trueCondition' && c.toId === conn.fromId
        )
      );
    });

    const falseConnection = connections.find((conn) => {
      const sourceNode = this.nodes.get(conn.fromId);
      return (
        sourceNode &&
        sourceNode.typename === 'String' &&
        this.connections.some(
          (c) => c.fromId === ifNode.id && c.fromProperty === 'falseCondition' && c.toId === conn.fromId
        )
      );
    });

    if (trueConnection && falseConnection) {
      const trueValue = this.generateConnectionValue(trueConnection);
      const falseValue = this.generateConnectionValue(falseConnection);
      return `${ifResult}.trueCondition ? ${trueValue} : ${falseValue}`;
    }

    // Fallback to first connection
    return this.generateConnectionValue(connections[0]);
  }

  /**
   * Generate value for a single connection
   */
  private generateConnectionValue(connection: Connection): string {
    const sourceNode = this.nodes.get(connection.fromId);
    if (!sourceNode) return 'undefined';

    // Check if the source is a request node (direct connection)
    if (sourceNode.typename === 'xgenia.cloud.request') {
      const requestPort = this.findPort(sourceNode.id, connection.fromProperty);
      if (requestPort) {
        const originalName = requestPort.displayName;
        // Use square bracket notation for parameters with spaces or special characters
        if (originalName.includes(' ') || /[^a-zA-Z0-9_]/.test(originalName)) {
          return `requestBody['${originalName}']`;
        } else {
          return `requestBody.${originalName}`;
        }
      }
      return 'undefined';
    }
    // For JavaScriptFunction nodes
    else if (sourceNode.typename === 'JavaScriptFunction') {
      const functionResult = `${this.getFunctionName(sourceNode)}Result`;
      const functionOutputPort = this.findPort(sourceNode.id, connection.fromProperty);
      if (functionOutputPort) {
        const functionOutputName = this.sanitizeParameterName(functionOutputPort.displayName);
        return `${functionResult}.${functionOutputName}`;
      }
      return 'undefined';
    }
    // For math, slot game, and standard library nodes
    else if (
      (this.mathNodeConverter && this.mathNodeConverter.isMathNode(sourceNode.typename)) ||
      (this.slotGameNodeConverter && this.slotGameNodeConverter.isSlotGameNode(sourceNode.typename)) ||
      (this.stdLibraryNodeConverter && this.stdLibraryNodeConverter.isStdLibraryNode(sourceNode.typename))
    ) {
      // DbConfig nodes are variables, not result objects - access directly
      if (sourceNode.typename === 'DbConfig') {
        const functionName = this.getFunctionName(sourceNode);
        return functionName; // The variable IS the value
      }
      const functionResult = `${this.getFunctionName(sourceNode)}Result`;
      // For REST nodes, use bracket notation and strip 'out-' prefix from fromProperty
      // because REST node outputs are stored without the 'out-' prefix
      const isRestNode = sourceNode.typename === 'REST2' || sourceNode.typename === 'REST';
      if (isRestNode) {
        // Strip 'out-' prefix if present (e.g., 'out-res' -> 'res')
        const outputName = connection.fromProperty.startsWith('out-')
          ? connection.fromProperty.replace(/^out-/, '')
          : connection.fromProperty;
        return `${functionResult}['${outputName}']`;
      } else {
        // For slot game nodes, use fromProperty (strip out- prefix) since the return object uses output port names (reels, stopPosList)
        // For other nodes, try the output port's display name to match the function's return object
        const outputPort = this.findPort(sourceNode.id, connection.fromProperty);
        if (outputPort) {
          const outputName = this.slotGameNodeConverter?.isSlotGameNode(sourceNode.typename)
            ? (connection.fromProperty.startsWith('out-')
              ? connection.fromProperty.replace(/^out-/, '')
              : connection.fromProperty)
            : this.sanitizeParameterName(outputPort.displayName || connection.fromProperty);
          return `${functionResult}.${outputName}`;
        }
        // Fallback to using fromProperty directly
        // Note: NewDbModelProperties now returns both 'id' and 'recordId', so 'id' mapping works directly
        return `${functionResult}.${connection.fromProperty}`;
      }
    }
    // For Cloud/Maths Logic component references
    else if (sourceNode.typename.startsWith('/#__cloud__/') || sourceNode.typename.startsWith('/#__maths__/')) {
      const isCloudRef = sourceNode.typename.startsWith('/#__cloud__/');
      const prefix = isCloudRef ? '/#__cloud__/' : '/#__maths__/';
      const rawName = sourceNode.typename.replace(prefix, '');
      const logicFunctionName = this.sanitizeForIdentifier(rawName);
      const functionResult = `${logicFunctionName}Result`;

      const logicComponent = isCloudRef
        ? this.findCloudLogicComponent(sourceNode.typename)
        : this.findMathsLogicComponent(sourceNode.typename);
      let logicOutputName = connection.fromProperty; // fallback

      if (logicComponent) {
        const jsNode = logicComponent.graph.roots.find((n) => n.typename === 'JavaScriptFunction');
        if (jsNode) {
          const outputPort = jsNode.dynamicports?.find(
            (p) =>
              p.plug === 'output' &&
              (p.name === connection.fromProperty ||
                p.displayName === connection.fromProperty ||
                p.name === `out-${connection.fromProperty}` ||
                p.displayName === connection.fromProperty)
          );
          if (outputPort) {
            logicOutputName = this.sanitizeParameterName(outputPort.displayName);
          }
        }
      }

      return `${functionResult}.${logicOutputName}`;
    }
    // For other node types, use fallback
    else {
      const functionResult = `${this.getFunctionName(sourceNode)}Result`;
      return `${functionResult}.${connection.fromProperty}`;
    }
  }

  private getFunctionName(node: Node): string {
    if (this.nodeFunctionNames.has(node.id)) {
      return this.nodeFunctionNames.get(node.id)!;
    }

    // Handle Cloud/Maths Logic component references
    if (node.typename.startsWith('/#__cloud__/')) {
      const rawName = node.typename.replace('/#__cloud__/', '');
      return this.sanitizeForIdentifier(rawName);
    }
    if (node.typename.startsWith('/#__maths__/')) {
      const rawName = node.typename.replace('/#__maths__/', '');
      return this.sanitizeForIdentifier(rawName);
    }

    // Fallback for nodes that are not JavaScriptFunction nodes
    if (node.label) return this.sanitizeForIdentifier(node.label);
    return `jsFunction_${this.sanitizeForIdentifier(node.id)}`;
  }

  private getOutputPortNames(node: Node): string[] {
    // Guard against a missing dynamicports array (e.g. a custom Function node
    // loaded from disk before the editor materialised its derived out-* ports).
    return (node.dynamicports || [])
      .filter((p) => p.plug === 'output')
      .map((p) => this.sanitizeParameterName(this.portScriptName(p)));
  }

  /**
   * The name a script uses for a port: `Inputs.<x>` / `Outputs.<x>`.
   *
   * Editor-model ports carry `displayName`; ports rehydrated from a project
   * export or a fixture often carry only `name`, prefixed with its plug
   * (`in-reels`, `out-finalResult`). Reading displayName blindly crashed code
   * generation; falling back to the raw name emitted `let out-finalResult;`,
   * which is not an identifier. Strip the plug prefix — that is exactly what
   * displayName is, and the same convention this file already uses when it
   * builds the Inputs/Outputs objects.
   */
  private portScriptName(port: { displayName?: string; name?: string } | undefined | null): string {
    if (!port) return '';
    if (port.displayName) return port.displayName;
    return String(port.name || '').replace(/^(?:in|out)-/, '');
  }

  private findPort(nodeId: string, portName: string) {
    // `?.` guarded the node lookup but not `dynamicports`, so a node without that
    // array threw "Cannot read properties of undefined (reading 'find')" out of a
    // lookup whose whole contract is "return the port or undefined". Editor-model
    // nodes always carry it; nodes rehydrated from an export or a test fixture do
    // not, and those are exactly the inputs a harness feeds in.
    return this.nodes.get(nodeId)?.dynamicports?.find((p) => p.name === portName);
  }

  private sanitizeForIdentifier(name: string): string {
    let sanitized = name.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(sanitized)) sanitized = '_' + sanitized;
    return sanitized;
  }

  /**
   * Sanitize parameter names for JavaScript object properties
   * Only replaces spaces with underscores, preserves other characters
   */
  private sanitizeParameterName(name: string): string {
    if (!name) return 'unnamed';
    // Only replace spaces with underscores, leave other characters as-is
    return name.replace(/\s+/g, '_');
  }

  /**
   * Generate a safe property access expression.
   * Uses dot notation for valid JS identifiers, bracket notation otherwise.
   * This prevents `config.in-betAmount` from being parsed as `config.in - betAmount`.
   */
  private safePropertyAccess(obj: string, prop: string): string {
    // A property name is safe for dot notation if it matches a JS identifier
    const isSafeIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(prop);
    return isSafeIdentifier ? `${obj}.${prop}` : `${obj}["${prop}"]`;
  }

  /**
   * Resolve a connection source through Variable2 hops to a "real" node.
   *
   * (2026-07-15, trace 1784154340515 — Relic Run "[WReels] Reel strips array is
   * required and cannot be empty"): Variable2 and Set Variable are NOT compiled
   * node types — the old passthrough only followed a data wire into the
   * Variable2's `value` port. But the canonical persistence pattern writes the
   * variable via a name-matched `Set Variable` node (generator → SetX.value,
   * SetX.do fired by a signal), leaving the Variable2's `value` port unwired —
   * so resolution dead-ended and the reader was inlined with the variable's
   * INITIAL value (an empty array) forever. Any maths that generates reel strips
   * at init and reads them through a Variable2 crashed server-side on every spin.
   *
   * This resolver follows BOTH: a wire into `value`, OR (when absent) the
   * name-matched Set Variable writer's `value` source. NOTE the Stage-1
   * semantics: the resolved source is evaluated in the spin script, so
   * init-generated data is re-derived per evaluation rather than persisted
   * across spins (true cross-spin persistence needs ctx.state mapping — a
   * follow-up). With multiple same-name writers the first wired one wins.
   */
  /**
   * Stage-2 cross-spin persistence (2026-07-17). A "stateful" variable is a
   * Variable2 with at least one name-matched `Set Variable` writer whose value
   * port is wired. These compile to a `_vars` store hydrated from
   * `ctx.state.__vars` and written back into the returned state, so the value
   * genuinely persists across spins — in the RGS stress runner (persistedState)
   * AND in production /spin (game_sessions.round_state). Variable2 nodes with
   * no writer stay inlined as constants (Stage-1 behavior).
   */
  private collectStatefulVariables(): Map<string, { initial: unknown; writers: Node[] }> {
    const stateful = new Map<string, { initial: unknown; writers: Node[] }>();
    const roots = this.component.graph.roots;
    for (const node of roots) {
      if (node.typename !== 'Variable2' && node.typename !== '/#__cloud__/Variable2') continue;
      const varName = (node.parameters as any)?.name;
      if (!varName) continue;
      const writers = roots.filter(
        (n) =>
          (n.typename === 'Set Variable' || n.typename === '/#__cloud__/Set Variable') &&
          (n.parameters as any)?.name === varName &&
          this.connections.some((c) => c.toId === n.id && c.toProperty === 'value')
      );
      if (writers.length === 0) continue;
      if (!stateful.has(varName)) {
        stateful.set(varName, { initial: (node.parameters as any)?.value, writers });
      }
    }
    return stateful;
  }

  /** Port type lookup across both real-editor and fixture port storage shapes. */
  private portTypeOf(node: Node | undefined, portName: string): string {
    if (!node) return '';
    const pools: any[] = [
      ...((node as any).dynamicports || []),
      ...(((node as any).ports as any[]) || []),
      ...((((node as any).parameters || {}).ports as any[]) || []),
    ];
    const p = pools.find((x) => x && x.name === portName);
    const t = p?.type;
    return String((t && typeof t === 'object' ? t.name : t) || '').toLowerCase();
  }

  /**
   * Gate expression for a Set Variable write: trace the writer's `do` signal
   * chain backwards to its Component Inputs root(s).
   *
   * The compiled RGS script runs every node each evaluate() — there is no real
   * signal engine — so init/reset chains would clobber persisted state every
   * spin without this. Semantics: a chain rooted in a signal whose name looks
   * like init/reset fires on ROUND 1 only (or when the caller explicitly sends
   * `config.<Name>: true`); every other root (Spin etc.) fires every spin.
   * A writer with no traceable Component Inputs root gates to `true` — closest
   * to the editor "fired by an in-spin chain" case and to Stage-1 behavior.
   */
  private signalGateForWriter(writer: Node): string {
    const rootGates = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; portName: string }> = [{ nodeId: writer.id, portName: 'do' }];
    let steps = 0;
    while (queue.length > 0 && steps < 200) {
      steps++;
      const { nodeId, portName } = queue.shift()!;
      const key = `${nodeId} ${portName}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const conn of this.connections) {
        if (conn.toId !== nodeId || conn.toProperty !== portName) continue;
        const src = this.nodes.get(conn.fromId);
        if (!src) continue;
        if (src.typename === 'Component Inputs') {
          const root = conn.fromProperty;
          rootGates.add(
            /init|reset/i.test(root)
              ? `(ctx.round === 1 || config[${JSON.stringify(root)}] === true)`
              : 'true'
          );
          continue;
        }
        // Continue backwards through the source node's own signal inputs.
        for (const upstream of this.connections) {
          if (upstream.toId !== src.id) continue;
          const t = this.portTypeOf(src, upstream.toProperty);
          const looksSignal = t === 'signal' || /^(do|run|spin)$/i.test(upstream.toProperty) || upstream.toProperty.startsWith('on');
          if (looksSignal) queue.push({ nodeId: src.id, portName: upstream.toProperty });
        }
      }
    }
    if (rootGates.size === 0 || rootGates.has('true')) return 'true';
    return Array.from(rootGates).join(' || ');
  }

  private resolveThroughVariables(
    fromId: string,
    fromProperty: string,
    isResolved: (id: string) => boolean
  ): { fromId: string; fromProperty: string } {
    let resolvedFromId = fromId;
    let resolvedFromProperty = fromProperty;
    let hops = 0;
    while (!isResolved(resolvedFromId) && hops < 10) {
      const srcNode = this.nodes.get(resolvedFromId);
      if (!srcNode || (srcNode.typename !== '/#__cloud__/Variable2' && srcNode.typename !== 'Variable2')) break;
      let upstreamConn = this.connections.find(
        (c) => c.toId === resolvedFromId && c.toProperty === 'value'
      );
      if (!upstreamConn) {
        // Variable2 persistence: value arrives via a name-matched Set Variable.
        const varName = (srcNode.parameters as any)?.name;
        const writer = varName
          ? Array.from(this.nodes.values()).find(
              (n) =>
                (n.typename === 'Set Variable' || n.typename === '/#__cloud__/Set Variable') &&
                (n.parameters as any)?.name === varName &&
                this.connections.some((c) => c.toId === n.id && c.toProperty === 'value')
            )
          : undefined;
        if (!writer) break;
        upstreamConn = this.connections.find((c) => c.toId === writer.id && c.toProperty === 'value')!;
      }
      resolvedFromId = upstreamConn.fromId;
      resolvedFromProperty = upstreamConn.fromProperty;
      hops++;
    }
    return { fromId: resolvedFromId, fromProperty: resolvedFromProperty };
  }

  private sortNodesByExecutionOrder(nodes: Node[]): Node[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const adj: Map<string, string[]> = new Map();
    const inDegree: Map<string, number> = new Map();
    for (const node of nodes) {
      adj.set(node.id, []);
      inDegree.set(node.id, 0);
    }
    for (const conn of this.connections) {
      if (!nodeIds.has(conn.toId)) continue;
      // (2026-07-15) Variable-mediated dependencies: a compiled node reading a
      // Variable2 depends on the compiled node that WRITES it (via Set Variable).
      // Without this synthetic edge the writer could sort AFTER the reader and
      // the reader would reference its output before assignment.
      let fromId = conn.fromId;
      if (!nodeIds.has(fromId)) {
        // Stage-2: when the source is a STATEFUL Variable2, the reader depends
        // on the Set Variable writer NODES themselves (the `_vars` write must
        // emit before the read within a spin — round 1 would otherwise read the
        // initial value that Stage-1's inline resolution used to paper over).
        // Read-modify-write loops become cycles here; the Kahn remainder net
        // below keeps those nodes in original order instead of dropping them.
        const _srcVar = this.nodes.get(conn.fromId);
        const _svn = _srcVar && (_srcVar.typename === 'Variable2' || _srcVar.typename === '/#__cloud__/Variable2')
          ? (_srcVar.parameters as any)?.name
          : null;
        const _stInfo = _svn ? this._statefulVars?.get(_svn) : null;
        if (_stInfo) {
          for (const w of _stInfo.writers) {
            if (nodeIds.has(w.id) && w.id !== conn.toId) {
              adj.get(w.id)!.push(conn.toId);
              inDegree.set(conn.toId, (inDegree.get(conn.toId) || 0) + 1);
            }
          }
          continue;
        }
        fromId = this.resolveThroughVariables(conn.fromId, conn.fromProperty, (id) => nodeIds.has(id)).fromId;
      }
      if (nodeIds.has(fromId) && fromId !== conn.toId) {
        adj.get(fromId)!.push(conn.toId);
        inDegree.set(conn.toId, (inDegree.get(conn.toId) || 0) + 1);
      }
    }
    const queue = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);
    const sorted: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sorted.push(u);
      for (const v of adj.get(u) || []) {
        inDegree.set(v, inDegree.get(v)! - 1);
        if (inDegree.get(v) === 0) queue.push(v);
      }
    }
    // Cycle safety net: Kahn's algorithm silently DROPS nodes stuck in a cycle
    // (their in-degree never reaches 0) — they'd vanish from the compiled script
    // entirely. Variable-mediated edges can create legitimate read-modify-write
    // cycles (a node reads a variable it also writes), so append any remainder
    // in original order instead of dropping it.
    if (sorted.length < nodes.length) {
      const seen = new Set(sorted);
      for (const n of nodes) {
        if (!seen.has(n.id)) sorted.push(n.id);
      }
    }
    return sorted.map((id) => this.nodes.get(id)!);
  }
}

export class ProjectConverter {
  private readonly project: Project;

  constructor(projectData: Project) {
    this.project = projectData;
  }

  public convertAllCloudFunctions(): Map<string, string> {
    const cloudFunctions = this.project.components.filter((c) => c.name.startsWith('/#__cloud__/'));

    const generatedFunctions = new Map<string, string>();

    for (const func of cloudFunctions) {
      const converter = new CloudFunctionConverter(func);
      const { name, code } = converter.generateSupabaseFunction();
      generatedFunctions.set(name, code);
    }

    return generatedFunctions;
  }
}

/**
 * Converts XGENIA cloud function components to Supabase Edge Function format
 */
export class XgeniaToSupabaseConverter {
  private apiClient: SupabaseAPIClient;

  constructor() {
    this.apiClient = new SupabaseAPIClient();
  }

  /**
   * Convert a string to Pascal case
   */
  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  }

  /**
   * Converts an XGENIA component into a complete Supabase deployment payload.
   */
  public convert(component: XgeniaComponent, projectContext?: Project): SupabaseDeploymentPayload | null {
    const converter = new CloudFunctionConverter(component as any, projectContext);
    const { name, code } = converter.generateSupabaseFunction();
    const requestNode = component.graph.roots.find((n) => {
      const nodeType = typeof n.type === 'string' ? n.type : n.type?.name;
      return nodeType === 'xgenia.cloud.request';
    });

    if (!requestNode) {
      return null;
    }

    // Sanitize the function name for Supabase deployment (remove folder structure)
    // Convert "/#__cloud__/Grouped Component/SampleInput" to "GroupedComponentSampleInput"
    const sanitizedSlug = this.sanitizeFunctionNameForSupabase(name);

    // Add "xgenia" prefix to the slug while keeping the original name
    const slugWithPrefix = `xgenia_${sanitizedSlug}`;

    const payload: SupabaseDeploymentPayload = {
      slug: slugWithPrefix,
      file: [code],
      metadata: {
        name: sanitizedSlug, // Keep original name without prefix
        verify_jwt: !requestNode.parameters.allowNoAuth,
        entrypoint_path: 'index.ts',
        import_map_path: null,
        static_patterns: []
      }
    };

    return payload;
  }

  /**
   * Sanitize function name for Supabase deployment
   * Removes folder structure and invalid characters while preserving uniqueness
   */
  private sanitizeFunctionNameForSupabase(originalName: string): string {
    // Remove the /#__cloud__/ prefix
    let sanitized = originalName.replace('/#__cloud__/', '');

    // Replace folder separators and spaces with underscores
    sanitized = sanitized.replace(/[/\s]+/g, '_');

    // Remove any other invalid characters for Supabase slugs
    sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');

    // Ensure it starts with a letter or underscore
    if (/^[0-9]/.test(sanitized)) {
      sanitized = '_' + sanitized;
    }

    // Ensure it's not empty
    if (!sanitized) {
      sanitized = 'xgenia_function';
    }

    return sanitized;
  }

  /**
   * Generate logic script from logic node and component connections
   */
  private generateLogicScript(logicNode: XgeniaNode | undefined, component: XgeniaComponent): string {
    if (!logicNode) {
      return '// This component has no direct logic node.\n    // The request parameters will be passed directly to the response.';
    }

    const nodeType = typeof logicNode.type === 'string' ? logicNode.type : logicNode.type?.name;

    // Handle JavaScriptFunction nodes specifically
    if (nodeType === 'JavaScriptFunction' && logicNode.parameters.functionScript) {
      return this.generateJavaScriptFunctionScript(logicNode, component);
    }

    // For other node types, generate a placeholder
    return `// Logic processing for ${nodeType}
    // TODO: Implement specific logic based on node type and connections`;
  }

  /**
   * Get output names from logic node and response nodes
   */
  private getOutputNames(
    logicNode: XgeniaNode | undefined,
    responseNodes: XgeniaNode[],
    component: XgeniaComponent
  ): string[] {
    const outputNames: string[] = [];

    // Extract output names from response nodes
    for (const responseNode of responseNodes) {
      // Try dynamic ports first
      if (responseNode.dynamicports && responseNode.dynamicports.length > 0) {
        const responseParams = responseNode.dynamicports
          .filter((port) => port.plug === 'input' && port.name.startsWith('pm-'))
          .map((port) => port.name.replace('pm-', ''))
          .filter((param) => param.length > 0);
        outputNames.push(...responseParams);
      }
      // Fallback to parameters.params
      else if (responseNode.parameters.params) {
        const params = responseNode.parameters.params
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p);
        outputNames.push(...params);
      }
    }

    // If no specific outputs, generate default ones
    if (outputNames.length === 0) {
      outputNames.push('message');
    }

    return outputNames;
  }

  /**
   * Extract input parameters from request node
   */
  private extractInputParameters(requestNode: XgeniaNode): string[] {
    // Try dynamic ports first (preferred method)
    if (requestNode.dynamicports && requestNode.dynamicports.length > 0) {
      return requestNode.dynamicports
        .filter((port) => port.plug === 'output' && port.name.startsWith('pm-'))
        .map((port) => port.name.replace('pm-', ''))
        .filter((param) => param.length > 0);
    }

    // Fallback to parameters.params
    if (requestNode.parameters.params) {
      return requestNode.parameters.params
        .split(',')
        .map((param) => param.trim())
        .filter((param) => param.length > 0);
    }

    return [];
  }

  /**
   * Generate JavaScript function script from JavaScriptFunction node
   */
  private generateJavaScriptFunctionScript(logicNode: XgeniaNode, component: XgeniaComponent): string {
    const functionScript = logicNode.parameters.functionScript || '';

    if (!functionScript.trim()) {
      return '// No function script provided';
    }

    // Extract input and output port names from dynamic ports
    const inputPorts = logicNode.dynamicports?.filter((p) => p.plug === 'input') || [];
    const outputPorts = logicNode.dynamicports?.filter((p) => p.plug === 'output') || [];

    // Create Inputs and Outputs objects based on the ports
    const inputsObject = inputPorts
      .map((port) => {
        const cleanName = port.name.replace('in-', '');
        return `  ${cleanName}: undefined`;
      })
      .join(',\n');

    const outputsObject = outputPorts
      .map((port) => {
        const cleanName = port.name.replace('out-', '');
        return `  ${cleanName}: undefined`;
      })
      .join(',\n');

    return `// JavaScript Function Logic
const Inputs = {
${inputsObject}
};

const Outputs = {
${outputsObject}
};

// Extract input values from request parameters
${inputPorts
        .map((port) => {
          const cleanName = port.name.replace('in-', '');
          return `Inputs.${cleanName} = ${cleanName};`;
        })
        .join('\n')}

// Execute the function script
${functionScript}

// Prepare output values
${outputPorts
        .map((port) => {
          const cleanName = port.name.replace('out-', '');
          return `const ${cleanName} = Outputs.${cleanName};`;
        })
        .join('\n')}`;
  }

  /**
   * Generate CORS headers for browser compatibility
   */
  private generateCorsHeaders(): string {
    return `const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
  'Access-Control-Max-Age': '86400'
};`;
  }

  /**
   * Generate response data object with proper value mapping
   */
  private generateResponseDataObject(outputNames: string[], inputParams: string[], functionName: string): string {
    if (outputNames.length === 0) {
      return `const data = {
      message: "Operation successful",
      timestamp: new Date().toISOString(),
      functionName: "${functionName}"
    };`;
    }

    // Generate response data object with proper value mapping
    const responseDataFields = outputNames.map((field) => {
      // Clean field name for safe variable usage
      const cleanField = field.replace(/[^a-zA-Z0-9_]/g, '_');

      // Check if this field matches an input parameter
      if (inputParams.includes(field)) {
        return `      ${cleanField}: ${field}`;
      }

      // Generate appropriate default values based on field name
      const lowerFieldName = field.toLowerCase();

      if (lowerFieldName.includes('message')) {
        // Special case: if we have a 'name' parameter, use it in the message
        if (inputParams.includes('name')) {
          return `      ${cleanField}: \`Hello \${name || "Anonymous"}!\``;
        }
        return `      ${cleanField}: "Hello from ${functionName}!"`;
      } else if (lowerFieldName.includes('status')) {
        return `      ${cleanField}: "success"`;
      } else if (lowerFieldName.includes('timestamp') || lowerFieldName.includes('time')) {
        return `      ${cleanField}: new Date().toISOString()`;
      } else if (lowerFieldName.includes('id')) {
        return `      ${cleanField}: crypto.randomUUID()`;
      } else if (lowerFieldName.includes('count') || lowerFieldName.includes('number')) {
        return `      ${cleanField}: 1`;
      } else if (lowerFieldName.includes('success') || lowerFieldName.includes('result')) {
        return `      ${cleanField}: true`;
      } else if (lowerFieldName.includes('data') || lowerFieldName.includes('response')) {
        return `      ${cleanField}: { processed: true, timestamp: new Date().toISOString() }`;
      } else {
        // Default fallback - use the field name as a string value
        return `      ${cleanField}: "${field} value"`;
      }
    });

    return `const data = {
${responseDataFields.join(',\n')}
    };`;
  }

  /**
   * Deploy converted function to Supabase using the new API structure
   */
  public async deployFunction(
    component: XgeniaComponent,
    projectContext?: Project,
    update: boolean = false
  ): Promise<SupabaseFunctionDetails> {
    const payload = this.convert(component, projectContext);
    if (!payload) {
      throw new Error(`Failed to convert component ${component.name}`);
    }

    return await this.deployPayload(payload);
  }

  /**
   * Delete a Supabase Edge Function
   */
  public async deleteFunction(functionSlug: string): Promise<void> {
    const config = this.apiClient['credentialManager'].getCredentials();
    const url = `https://api.supabase.com/v1/projects/${config.projectId}/functions/${functionSlug}`;

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 404) {
        throw new Error(`Function "${functionSlug}" not found`);
      }

      if (response.status !== 200) {
        let responseData;
        try {
          responseData = await response.json();
        } catch {
          responseData = { message: response.statusText };
        }
        throw new Error(
          formatSupabaseErrorMessage('Failed to delete function', response.status, response.statusText, responseData)
        );
      }
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Deploy a Supabase deployment payload
   * Note: Supabase API automatically handles updates with POST requests
   */
  public async deployPayload(payload: SupabaseDeploymentPayload): Promise<SupabaseFunctionDetails> {
    const { slug, file, metadata } = payload;
    const config = this.apiClient['credentialManager'].getCredentials();
    const url = `https://api.supabase.com/v1/projects/${config.projectId}/functions/deploy?slug=${slug}`;

    try {
      // Use browser's native FormData API
      const formData = new FormData();

      // Append metadata as JSON string
      formData.append('metadata', JSON.stringify(metadata));

      // Create a Blob from the code string
      const codeBlob = new Blob([file[0]], { type: 'application/javascript' });
      formData.append('file', codeBlob, 'index.ts');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`
          // Don't set Content-Type - let the browser set it with the correct boundary
        },
        body: formData
      });

      let responseData;
      try {
        responseData = await response.json();
      } catch {
        responseData = { message: response.statusText };
      }

      if (response.status !== 201) {
        throw new Error(
          formatSupabaseErrorMessage('Failed to deploy function', response.status, response.statusText, responseData)
        );
      }

      return responseData as SupabaseFunctionDetails;
    } catch (error: any) {
      throw error;
    }
  }

  /**
   * Check if a function with the given slug already exists
   */
  public async functionExists(slug: string): Promise<boolean> {
    try {
      await this.apiClient.getSupabaseEdgeFunctionDetail(slug);
      return true;
    } catch (error: any) {
      // If we get a 404, the function doesn't exist
      if (error instanceof Error && error.message.includes('404')) {
        return false;
      }
      // For other errors, re-throw
      throw error;
    }
  }

  /**
   * Find potential existing functions that might be the same as the one being deployed
   * This helps identify when a function has been moved to a folder structure
   */
  public async findPotentialExistingFunctions(
    originalName: string,
    sanitizedSlug: string
  ): Promise<SupabaseFunctionMetadata[]> {
    try {
      const allFunctions = await this.apiClient.fetchSupabaseEdgeFunctions();

      // Extract the base name from the original name (remove folder structure)
      const baseName = originalName.replace('/#__cloud__/', '').split('/').pop() || originalName;
      const sanitizedBaseName = this.sanitizeFunctionNameForSupabase(baseName);

      // Find functions that might be the same
      const potentialMatches = allFunctions.filter((func) => {
        // Check if the function name contains the base name
        return (
          func.slug.includes(sanitizedBaseName) ||
          func.name.includes(baseName) ||
          // Check if the current slug is a variation of an existing function
          func.slug === sanitizedBaseName ||
          func.slug === sanitizedSlug
        );
      });

      return potentialMatches;
    } catch (error: any) {
      console.warn('Could not fetch existing functions for comparison:', error);
      return [];
    }
  }

  /**
   * Deploy function with conflict resolution
   * Handles cases where a function has been moved to a folder structure
   */
  public async deployFunctionWithConflictResolution(
    component: XgeniaComponent,
    projectContext?: Project,
    options: {
      overwriteExisting?: boolean;
      deleteOldVersions?: boolean;
    } = {}
  ): Promise<SupabaseFunctionDetails> {
    const payload = this.convert(component, projectContext);
    if (!payload) {
      throw new Error(`Failed to convert component ${component.name}`);
    }

    const { slug } = payload;
    const originalName = component.name;

    // Check if function already exists
    const exists = await this.functionExists(slug);

    if (exists) {
      if (options.overwriteExisting) {
        return await this.deployPayload(payload);
      } else {
        throw new Error(`Function "${slug}" already exists. Use overwriteExisting: true to replace it.`);
      }
    }

    // Check for potential existing functions that might be the same
    const potentialMatches = await this.findPotentialExistingFunctions(originalName, slug);

    if (potentialMatches.length > 0) {
      if (options.deleteOldVersions) {
        for (const match of potentialMatches) {
          try {
            await this.deleteFunction(match.slug);
          } catch (error: any) {
            // Silently continue if deletion fails
          }
        }
      }
    }

    return await this.deployPayload(payload);
  }

  /**
   * Batch deploy multiple functions
   */
  public async deployFunctions(
    components: XgeniaComponent[],
    projectContext?: Project
  ): Promise<SupabaseFunctionDetails[]> {
    const results: SupabaseFunctionDetails[] = [];

    for (const component of components) {
      try {
        const result = await this.deployFunction(component, projectContext);
        results.push(result);
      } catch (error: any) {
        console.error(`Failed to deploy function ${component.name}:`, error);
        throw error;
      }
    }

    return results;
  }
}

// ============================================================================
// MAIN EXPORT CLASS
// ============================================================================

/**
 * Main Supabase Edge Function Manager
 * Provides a unified interface for all Supabase Edge Function operations
 */
export class SupabaseEdgeFunctionManager {
  private credentialManager: SupabaseCredentialManager;
  private apiClient: SupabaseAPIClient;
  private converter: XgeniaToSupabaseConverter;

  constructor() {
    this.credentialManager = SupabaseCredentialManager.getInstance();
    this.apiClient = new SupabaseAPIClient();
    this.converter = new XgeniaToSupabaseConverter();
  }

  /**
   * Configure Supabase credentials
   */
  public configure(config: SupabaseConfig): void {
    this.credentialManager.setCredentials(config);
  }

  /**
   * Get all deployed Edge Functions
   */
  public async getFunctions(): Promise<SupabaseFunctionMetadata[]> {
    return await this.apiClient.fetchSupabaseEdgeFunctions();
  }

  /**
   * Get only XGENIA-deployed Edge Functions
   */
  public async getXgeniaFunctions(): Promise<SupabaseFunctionMetadata[]> {
    return await this.apiClient.getXgeniaFunctions();
  }

  /**
   * Check if a function was deployed from XGENIA
   */
  public async isXgeniaFunction(functionName: string): Promise<boolean> {
    return await this.apiClient.isXgeniaFunction(functionName);
  }

  /**
   * Get function details including source code
   */
  public async getFunctionDetails(functionName: string): Promise<SupabaseFunctionDetails> {
    return await this.apiClient.getSupabaseEdgeFunctionDetail(functionName);
  }

  /**
   * Get function source code
   */
  public async getFunctionCode(functionName: string): Promise<string> {
    return await this.apiClient.getSupabaseEdgeFunctionBody(functionName);
  }

  /**
   * Deploy a single XGENIA component to Supabase
   */
  public async deployComponent(component: XgeniaComponent, projectContext?: Project): Promise<SupabaseFunctionDetails> {
    return await this.converter.deployFunction(component, projectContext);
  }

  /**
   * Deploy a single XGENIA component with conflict resolution
   * Handles cases where functions have been moved to folder structures
   */
  public async deployComponentWithConflictResolution(
    component: XgeniaComponent,
    projectContext?: Project,
    options: {
      overwriteExisting?: boolean;
      deleteOldVersions?: boolean;
    } = {}
  ): Promise<SupabaseFunctionDetails> {
    return await this.converter.deployFunctionWithConflictResolution(component, projectContext, options);
  }

  /**
   * Check if a function exists
   */
  public async functionExists(slug: string): Promise<boolean> {
    return await this.converter.functionExists(slug);
  }

  /**
   * Find potential existing functions that might be the same
   */
  public async findPotentialExistingFunctions(
    originalName: string,
    sanitizedSlug: string
  ): Promise<SupabaseFunctionMetadata[]> {
    return await this.converter.findPotentialExistingFunctions(originalName, sanitizedSlug);
  }

  /**
   * Deploy multiple XGENIA components to Supabase
   */
  public async deployComponents(
    components: XgeniaComponent[],
    projectContext?: Project
  ): Promise<SupabaseFunctionDetails[]> {
    return await this.converter.deployFunctions(components, projectContext);
  }

  /**
   * Convert XGENIA component to Supabase deployment payload
   */
  public convertComponent(component: XgeniaComponent, projectContext?: Project): SupabaseDeploymentPayload | null {
    return this.converter.convert(component, projectContext);
  }

  /**
   * Delete a Supabase Edge Function
   */
  public async deleteFunction(functionSlug: string): Promise<void> {
    return await this.converter.deleteFunction(functionSlug);
  }

  /**
   * Check if credentials are configured
   */
  public isConfigured(): boolean {
    return this.credentialManager.isConfigured();
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a new Supabase Edge Function Manager instance
 */
export function createSupabaseManager(): SupabaseEdgeFunctionManager {
  return new SupabaseEdgeFunctionManager();
}

/**
 * Quick setup function for common use cases
 */
export async function setupSupabaseIntegration(
  projectId: string,
  accessToken: string,
  region?: string
): Promise<SupabaseEdgeFunctionManager> {
  const manager = createSupabaseManager();
  manager.configure({ projectId, accessToken, region });
  return manager;
}

// Export default instance for convenience
export const supabaseManager = createSupabaseManager();

// ============================================================================
// CORS CONFIGURATION UTILITIES
// ============================================================================

/**
 * Helper function to set CORS configuration on a component
 *
 * @example
 * // Allow global access (default)
 * setCorsConfig(component);
 *
 * @example
 * // Restrict to specific origins
 * setCorsConfig(component, {
 *   allowedOrigins: 'https://example.com, https://app.example.com',
 *   allowedMethods: 'GET, POST'
 * });
 */
export function setCorsConfig(component: Component, config?: Partial<CorsConfiguration>): void {
  if (!component.metadata) {
    component.metadata = {};
  }

  component.metadata.cors = {
    allowedOrigins: config?.allowedOrigins || '*',
    allowedMethods: config?.allowedMethods || 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders:
      config?.allowedHeaders || 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
    maxAge: config?.maxAge || '86400'
  };
}

/**
 * Get CORS configuration from a component
 */
export function getCorsConfig(component: Component): CorsConfiguration | undefined {
  return component.metadata?.cors;
}

/**
 * Preset CORS configurations for common scenarios
 */
export const CorsPresets = {
  /**
   * Allow all origins (default, recommended for public APIs)
   */
  PUBLIC: {
    allowedOrigins: '*',
    allowedMethods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
    maxAge: '86400'
  } as CorsConfiguration,

  /**
   * Development preset with no caching
   */
  DEVELOPMENT: {
    allowedOrigins: '*',
    allowedMethods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token',
    maxAge: '0' // No caching for development
  } as CorsConfiguration,

  /**
   * Strict preset requiring specific origin configuration
   */
  STRICT: (origins: string) =>
  ({
    allowedOrigins: origins,
    allowedMethods: 'POST',
    allowedHeaders: 'Content-Type, Authorization',
    maxAge: '3600'
  } as CorsConfiguration),

  /**
   * No CORS (server-to-server only)
   */
  NONE: {
    allowedOrigins: '',
    allowedMethods: '',
    allowedHeaders: '',
    maxAge: '0'
  } as CorsConfiguration
};
