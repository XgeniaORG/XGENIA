/**
 * Shared type definitions for the Supabase converter system
 */

export interface Node {
  id: string;
  typename: string;
  label?: string;
  parameters: {
    params?: string;
    functionScript?: string;
    [key: string]: any; // Allow arbitrary parameters for math nodes
  };
  dynamicports: DynamicPort[];
}

export interface DynamicPort {
  name: string;
  displayName: string;
  plug: 'input' | 'output';
  group: 'Parameters' | 'Inputs' | 'Outputs';
}

export interface Connection {
  fromId: string;
  fromProperty: string;
  toId: string;
  toProperty: string;
}

export interface Graph {
  connections: Connection[];
  roots: Node[];
  visualRoots?: any[]; // For editor compatibility
}

export interface ComponentMetadata {
  cors?: CorsConfiguration;
}

export interface CorsConfiguration {
  /**
   * Allowed origins (comma-separated list or '*' for all)
   * @default '*'
   */
  allowedOrigins?: string;

  /**
   * Allowed HTTP methods
   * @default 'GET, POST, PUT, DELETE, OPTIONS'
   */
  allowedMethods?: string;

  /**
   * Allowed request headers
   * @default 'Content-Type, Authorization, X-Parse-Application-Id, X-Parse-Session-Token'
   */
  allowedHeaders?: string;

  /**
   * Max age for preflight cache in seconds
   * @default '86400' (24 hours)
   */
  maxAge?: string;
}

export interface Component {
  name: string;
  id: string;
  graph: Graph;
  metadata?: ComponentMetadata;
}

export interface Project {
  name: string;
  components: Component[];
}
