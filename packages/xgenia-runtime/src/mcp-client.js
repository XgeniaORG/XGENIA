'use strict';

/**
 * 🔌 Simple MCP Client
 *
 * Handles communication with Model Context Protocol servers.
 * Supports both HTTP and WebSocket connections.
 */

class MCPClient {
  constructor(serverUrl, options = {}) {
    this.serverUrl = serverUrl;
    this.options = {
      timeout: 10000,
      retries: 3,
      ...options
    };
    this.isConnected = false;
    this.availableTools = [];
    this.resources = [];
  }

  /**
   * Connect to the MCP server and discover capabilities
   */
  async connect() {
    try {
      console.log(`[MCPClient] Connecting to ${this.serverUrl}`);

      // Send initialize request
      const response = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          roots: { listChanged: true },
          sampling: {}
        },
        clientInfo: {
          name: 'xgenia-mcp-client',
          version: '1.0.0'
        }
      });

      if (response.capabilities) {
        console.log('[MCPClient] Server capabilities:', response.capabilities);
        this.serverCapabilities = response.capabilities;
        this.isConnected = true;

        // Discover available tools
        await this.discoverTools();

        // Discover available resources
        await this.discoverResources();

        return true;
      } else {
        throw new Error('Invalid initialize response');
      }
    } catch (error) {
      console.error('[MCPClient] Connection error:', error);
      throw error;
    }
  }

  /**
   * Discover available tools from the server
   */
  async discoverTools() {
    try {
      const response = await this.sendRequest('tools/list', {});

      if (response.tools && Array.isArray(response.tools)) {
        this.availableTools = response.tools.map((tool) => ({
          name: tool.name,
          description: tool.description || '',
          inputSchema: tool.inputSchema || {},
          outputSchema: tool.outputSchema || {}
        }));

        console.log(
          `[MCPClient] Discovered ${this.availableTools.length} tools:`,
          this.availableTools.map((t) => t.name)
        );
      }
    } catch (error) {
      console.warn('[MCPClient] Failed to discover tools:', error.message);
      this.availableTools = [];
    }
  }

  /**
   * Discover available resources from the server
   */
  async discoverResources() {
    try {
      const response = await this.sendRequest('resources/list', {});

      if (response.resources && Array.isArray(response.resources)) {
        this.resources = response.resources;
        console.log(`[MCPClient] Discovered ${this.resources.length} resources`);
      }
    } catch (error) {
      console.warn('[MCPClient] Failed to discover resources:', error.message);
      this.resources = [];
    }
  }

  /**
   * Execute a tool with given inputs
   */
  async executeTool(toolName, inputs = {}) {
    if (!this.isConnected) {
      await this.connect();
    }

    const tool = this.availableTools.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool '${toolName}' not found. Available tools: ${this.availableTools.map((t) => t.name).join(', ')}`
      );
    }

    try {
      console.log(`[MCPClient] Executing tool '${toolName}' with inputs:`, inputs);

      const response = await this.sendRequest('tools/call', {
        name: toolName,
        arguments: inputs
      });

      if (response.content) {
        console.log(`[MCPClient] Tool '${toolName}' completed successfully`);
        return response.content;
      } else if (response.isError) {
        throw new Error(response.error || 'Tool execution failed');
      } else {
        return response;
      }
    } catch (error) {
      console.error(`[MCPClient] Tool execution error:`, error);
      throw error;
    }
  }

  /**
   * Send request to MCP server
   */
  async sendRequest(method, params = {}) {
    const requestId = this.generateRequestId();

    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: method,
      params: params
    };

    try {
      const response = await this.makeHttpRequest(request);

      if (response.error) {
        throw new Error(`MCP Error: ${response.error.message || 'Unknown error'}`);
      }

      return response.result || response;
    } catch (error) {
      console.error(`[MCPClient] Request failed:`, error);
      throw error;
    }
  }

  /**
   * Make HTTP request to MCP server
   */
  async makeHttpRequest(request) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);

    try {
      const response = await fetch(this.serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders()
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  /**
   * Get authentication headers if configured
   */
  getAuthHeaders() {
    const headers = {};

    if (this.options.apiKey) {
      headers['Authorization'] = `Bearer ${this.options.apiKey}`;
    }

    if (this.options.customHeaders) {
      Object.assign(headers, this.options.customHeaders);
    }

    return headers;
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get available tools
   */
  getAvailableTools() {
    return this.availableTools;
  }

  /**
   * Get tool schema by name
   */
  getToolSchema(toolName) {
    return this.availableTools.find((tool) => tool.name === toolName);
  }

  /**
   * Check if connected
   */
  isConnectedToServer() {
    return this.isConnected;
  }

  /**
   * Disconnect from server
   */
  disconnect() {
    this.isConnected = false;
    this.availableTools = [];
    this.resources = [];
    console.log('[MCPClient] Disconnected from server');
  }
}

/**
 * MCP Client Factory
 * Creates and manages MCP client instances
 */
class MCPClientFactory {
  constructor() {
    this.clients = new Map();
  }

  /**
   * Get or create MCP client for a server URL
   */
  getClient(serverUrl, options = {}) {
    const key = `${serverUrl}:${JSON.stringify(options)}`;

    if (!this.clients.has(key)) {
      const client = new MCPClient(serverUrl, options);
      this.clients.set(key, client);
    }

    return this.clients.get(key);
  }

  /**
   * Remove client from cache
   */
  removeClient(serverUrl, options = {}) {
    const key = `${serverUrl}:${JSON.stringify(options)}`;

    if (this.clients.has(key)) {
      const client = this.clients.get(key);
      client.disconnect();
      this.clients.delete(key);
    }
  }

  /**
   * Clear all clients
   */
  clearAll() {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
  }
}

// Create global factory instance
const mcpClientFactory = new MCPClientFactory();

module.exports = {
  MCPClient,
  MCPClientFactory,
  mcpClientFactory
};
