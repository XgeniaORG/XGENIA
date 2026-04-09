import { MCPService, DEFAULT_MCP_CONFIG, ConnectionType, AuthType, MCPServer } from './mcp-service';

type MCPServerInput = {
  name: string;
  description: string;
  category?: string[];
  url: string | URL;
  connectionType?: ConnectionType;
  requiresAuth?: boolean;
  authType?: AuthType;
  command?: string;
  args?: string;
  env?: Record<string, string>;
  bearerToken?: string;
  headerName?: string;
  oauthClientId?: string;
  oauthScope?: string;
  source?: 'builtin' | 'custom' | 'remote';
  // OAuth-specific endpoints
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
};

// Singleton instance
let mcpServiceInstance: MCPService | null = null;

// Initialize MCP configuration for browser environments
function initializeMCPConfig() {
  if (typeof window !== 'undefined' && !(window as any).MCPConfig) {
    // Set default configuration if not already set
    (window as any).MCPConfig = {
      proxyUrl: 'http://localhost:3001',
      useProxy: false, // Changed to false by default since proxy may not always be available
      remoteServers: ['Fetch', 'Sequential Thinking', 'Semgrep']
    };
  }
}

// Get or create the singleton MCP service instance
function getMCPService() {
  if (!mcpServiceInstance) {
    initializeMCPConfig();
    mcpServiceInstance = new MCPService();
  }
  return mcpServiceInstance;
}

// Shared MCP service interface
const sharedMCPService = {
  // Get all available MCP servers
  loadAllMcpServers() {
    const service = getMCPService();
    return service.loadAllMcpServers();
  },

  // Remove an MCP server
  removeServer(serverName: string) {
    const service = getMCPService();
    return service.removeServer(serverName);
  },

  // Add or update an MCP server
  addOrUpdateServer(serverConfig: MCPServerInput) {
    const service = getMCPService();
    const existing = service.getServer(serverConfig.name);
    const normalizedServer: MCPServer = {
      name: serverConfig.name,
      description: serverConfig.description,
      category: serverConfig.category ?? (existing?.category ?? ['custom']),
      requiresAuth: serverConfig.requiresAuth ?? existing?.requiresAuth ?? false,
      authType: serverConfig.authType ?? existing?.authType,
      connectionType: serverConfig.connectionType ?? existing?.connectionType ?? ConnectionType.SSE,
      command: serverConfig.command ?? existing?.command,
      args: serverConfig.args ?? existing?.args,
      env: serverConfig.env ?? existing?.env,
      bearerToken: serverConfig.bearerToken ?? existing?.bearerToken,
      headerName: serverConfig.headerName ?? existing?.headerName,
      oauthClientId: serverConfig.oauthClientId ?? existing?.oauthClientId,
      oauthScope: serverConfig.oauthScope ?? existing?.oauthScope,
      url: new URL((serverConfig.url ?? existing?.url)?.toString()),
      source: serverConfig.source ?? existing?.source ?? 'custom',
      // OAuth endpoints
      issuer: serverConfig.issuer ?? existing?.issuer,
      authorizationEndpoint: serverConfig.authorizationEndpoint ?? existing?.authorizationEndpoint,
      tokenEndpoint: serverConfig.tokenEndpoint ?? existing?.tokenEndpoint,
      registrationEndpoint: serverConfig.registrationEndpoint ?? existing?.registrationEndpoint
    };

    service.addServer(normalizedServer);
    return normalizedServer;
  },

  // Get tools from a specific server
  async getTools(serverName: string) {
    const service = getMCPService();
    try {
      return await service.getTools(serverName);
    } catch (error: any) {
      console.error(`Error getting tools from ${serverName}:`, error);
      throw error;
    }
  },

  // Call a tool on a specific server
  async callTool(serverName: string, toolName: string, inputSchema: any) {
    const service = getMCPService();
    try {
      return await service.callTool(serverName, toolName, inputSchema);
    } catch (error: any) {
      console.error(`Error calling tool ${toolName} on ${serverName}:`, error);
      throw error;
    }
  },

  // OAuth authentication methods
  setOAuthRedirectUri(uri: string) {
    const service = getMCPService();
    service.setOAuthRedirectUri(uri);
  },

  getOAuthRedirectUri() {
    const service = getMCPService();
    return service.getOAuthRedirectUri();
  },

  async registerOAuthClient(serverName: string) {
    const service = getMCPService();
    try {
      return await service.registerOAuthClient(serverName);
    } catch (error: any) {
      console.error(`Error registering OAuth client for ${serverName}:`, error);
      throw error;
    }
  },

  async initiateOAuthFlow(serverName: string) {
    const service = getMCPService();
    try {
      return await service.initiateOAuthFlow(serverName);
    } catch (error: any) {
      console.error(`Error initiating OAuth flow for ${serverName}:`, error);
      throw error;
    }
  },

  async handleOAuthCallback(serverName: string, code: string, state: string, expectedState: string) {
    const service = getMCPService();
    try {
      return await service.handleOAuthCallback(serverName, code, state, expectedState);
    } catch (error: any) {
      console.error(`Error handling OAuth callback for ${serverName}:`, error);
      throw error;
    }
  },

  async refreshOAuthToken(serverName: string) {
    const service = getMCPService();
    try {
      return await service.refreshOAuthToken(serverName);
    } catch (error: any) {
      console.error(`Error refreshing OAuth token for ${serverName}:`, error);
      throw error;
    }
  },

  isTokenExpired(serverName: string) {
    const service = getMCPService();
    try {
      return service.isTokenExpired(serverName);
    } catch (error: any) {
      console.error(`Error checking token expiry for ${serverName}:`, error);
      throw error;
    }
  },

  // Events
  onServersChanged(listener: () => void) {
    const service = getMCPService();
    return service.onServersChanged(listener);
  },

  // Check if service is ready
  isServiceReady() {
    return mcpServiceInstance !== null;
  },

  // Initialize the service (no-op for compatibility)
  async initialize() {
    const svc = getMCPService(); // ensures instance
    try {
      await svc.initialize();
    } catch {}
    return true;
  },

  // Get the raw service instance (for advanced usage)
  getServiceInstance() {
    return getMCPService();
  }
};

// Export everything for different use cases
export {
  MCPService,
  sharedMCPService,
  DEFAULT_MCP_CONFIG,
  ConnectionType,
  AuthType,
  getMCPService,
  initializeMCPConfig
};
