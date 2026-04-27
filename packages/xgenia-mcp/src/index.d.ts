export interface MCPServerConfig {
  name: string;
  description: string;
  category: string[];
  url: URL;
  connectionType: 'sse' | 'http';
}

export interface MCPConfig {
  proxyUrl: string;
  useProxy: boolean;
  remoteServers: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: any;
}

export declare class MCPService {
  constructor();
  loadAllMcpServers(): MCPServerConfig[];
  getTools(serverName: string): Promise<MCPTool[]>;
  callTool(serverName: string, toolName: string, inputSchema: any): Promise<any>;
  connect(serverName: string): Promise<void>;
  findMcp(serverName: string): MCPServerConfig;
  isRemoteServer(serverName: string): boolean;
  getConfig(): MCPConfig;
}

export interface SharedMCPService {
  loadAllMcpServers(): MCPServerConfig[];
  getTools(serverName: string): Promise<MCPTool[]>;
  callTool(serverName: string, toolName: string, inputSchema: any): Promise<any>;
  isServiceReady(): boolean;
  initialize(): Promise<boolean>;
  getServiceInstance(): MCPService;
}

export declare const sharedMCPService: SharedMCPService;
export declare const DEFAULT_MCP_CONFIG: MCPConfig;
export declare const ConnectionType: {
  SSE: 'sse';
  HTTP: 'http';
};

export declare function getMCPService(): MCPService;
export declare function initializeMCPConfig(): void;
