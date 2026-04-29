import { EventEmitter } from 'events';
import { ServerCapabilities, Progress, LoggingLevel } from '@modelcontextprotocol/sdk/types.js';

import urls from './utils/urls';

export enum ConnectionType {
  SSE = 'sse',
  HTTP = 'http',
  STREAMABLE_HTTP = 'streamable-http',
  STDIO = 'stdio'
}

export enum AuthType {
  API_KEY = 'apiKey',
  BEARER_TOKEN = 'bearerToken',
  BASIC_AUTH = 'basicAuth',
  OAUTH2 = 'oauth2',
  NONE = 'none'
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  ERROR = 'error',
  ERROR_CONNECTING_TO_PROXY = 'error-connecting-to-proxy'
}

// Default configuration for MCP service
export const DEFAULT_MCP_CONFIG = {
  proxyUrl: 'http://localhost:3001',
  useProxy: true, // Enable proxy by default for SSE connections
  remoteServers: ['Fetch', 'Sequential Thinking', 'Semgrep', 'CoinGeko'],
  requestTimeout: 30000,
  maxTotalTimeout: 120000,
  resetTimeoutOnProgress: true,
  defaultLoggingLevel: 'info' as LoggingLevel
};


export interface MCPServer {
  name: string;
  description: string;
  requiresAuth: boolean;
  authType?: AuthType;
  category: string[];
  connectionType: ConnectionType;
  url: URL;
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
  // OAuth tokens (stored after authentication)
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

interface MCPConnectionOptions {
  transportType?: ConnectionType;
  command?: string;
  args?: string;
  env?: Record<string, string>;
  bearerToken?: string;
  headerName?: string;
  oauthClientId?: string;
  oauthScope?: string;
  defaultLoggingLevel?: LoggingLevel;
  onProgress?: (progress: Progress) => void;
  onNotification?: (notification: any) => void;
  useProxy?: boolean;
  callbackUrl?: string; // OAuth callback URL for authentication flows
}

/**
 * MCP Service for connecting to Model Context Protocol servers
 *
 * OAuth Authentication Flow:
 * For MCP servers that require OAuth2 authentication, the service supports a popup-based
 * authentication flow using the oauth-mcp-post endpoint:
 *
 * 1. When connecting to an OAuth2 server without tokens, it calls oauth-init action
 * 2. Opens a popup window with the authorization URL from the server
 * 3. Handles the callback when authentication completes
 * 4. Stores tokens and retries the connection
 *
 * Usage:
 * ```typescript
 * const mcp = new MCPService();
 *
 * // Listen for OAuth completion events
 * mcp.onOAuthCompleted(({ serverName, success, error }) => {
 *   if (success) {
 *     console.log(`OAuth completed for ${serverName}`);
 *   } else {
 *     console.error(`OAuth failed for ${serverName}:`, error);
 *   }
 * });
 *
 * // Connect to server (will trigger OAuth popup if needed)
 * await mcp.connect('Sentry'); // Server with OAuth2 auth
 * ```
 */
export class MCPService {
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private serverCapabilities: ServerCapabilities | null = null;
  private sessionId: string | null = null;
  private oauthMetadata: any = null; // OAuth metadata for current session
  private clientInfo: any = null; // OAuth client info for current session
  private codeVerifier: string | null = null; // PKCE code verifier
  private currentServerName: string | null = null;
  private config: typeof DEFAULT_MCP_CONFIG;
  private mcpServers: Map<string, MCPServer>;
  private requestHistory: { request: string; response?: string }[] = [];
  private oauthRedirectUri: string = 'http://localhost:3333/oauth/callback'; // Default
  private events = new EventEmitter();

  // Persistence
  private storageDir: string | null = null;
  private serversFilePath: string | null = null;
  private static KEYTAR_SERVICE = 'xgenia-mcp';
  private _fs: typeof import('fs') | null = null;
  private _path: typeof import('path') | null = null;
  private _keytar: typeof import('keytar') | null = null;

  constructor(config?: Partial<typeof DEFAULT_MCP_CONFIG>) {
    this.config = { ...DEFAULT_MCP_CONFIG, ...this.getConfig(), ...config };

    this.mcpServers = new Map<string, MCPServer>([
      [
        'Ahrefs',
        {
          name: 'Ahrefs',
          description: 'Ahrefs is an SEO platform for website analysis and keyword research.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['seo', 'development'],
          url: new URL('https://api.ahrefs.com/mcp/mcp'),
          connectionType: ConnectionType.HTTP
        }
      ],
      [
        'Asana',
        {
          name: 'Asana',
          description: 'Asana is a project management tool.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['seo', 'development'],
          url: new URL('https://mcp.asana.com/sse'),
          connectionType: ConnectionType.SSE
        }
      ],
      [
        'Apify',
        {
          name: 'Apify',
          description:
            'Use 3,000+ pre-built cloud tools to extract data from websites, e-commerce, social media, search engines, maps, and more',
          requiresAuth: true,
          authType: AuthType.BEARER_TOKEN,
          category: ['development'],
          url: new URL('https://mcp.apify.com'),
          connectionType: ConnectionType.SSE
        }
      ],
      [
        'CoinGeko',
        {
          name: 'CoinGeko',
          description: 'MCP Server for Crypto Price & Market Data',
          requiresAuth: false,
          category: ['finance', 'development'],
          url: new URL('https://mcp.api.coingecko.com/sse'),
          connectionType: ConnectionType.SSE
        }
      ],
      [
        'DeepWiki',
        {
          name: 'DeepWiki',
          description:
            'DeepWiki automatically generates architecture diagrams, documentation, and links to source code to help you understand unfamiliar codebases quickly.',
          requiresAuth: false,
          category: ['productivity', 'development'],
          connectionType: ConnectionType.HTTP,
          url: new URL('https://mcp.deepwiki.com/mcp')
        }
      ],
      [
        'Fetch',
        {
          name: 'Fetch',
          description: 'Provides web content fetching capabilities for LLMs.',
          requiresAuth: false,
          category: ['content'],
          connectionType: ConnectionType.STREAMABLE_HTTP,
          url: new URL('https://remote.mcpservers.org/fetch/mcp')
        }
      ],
      [
        'Figma',
        {
          name: 'Figma',
          description: 'Figma is a collaborative design and prototyping platform.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development', 'design'],
          connectionType: ConnectionType.HTTP,
          url: new URL('https://mcp.figma.com/mcp')
        }
      ],
      [
        'Globalping',
        {
          name: 'Globalping',
          description: 'Remote MCP server that gives LLMs access to run network commands with Globalping',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development', 'networking'],
          connectionType: ConnectionType.SSE,
          url: new URL('https://mcp.globalping.dev/sse')
        }
      ],
      [
        'Intercom',
        {
          name: 'Intercom',
          description: 'Intercom is a customer support platform.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['content'],
          connectionType: ConnectionType.SSE,
          url: new URL('https://mcp.intercom.com/sse')
        }
      ],
      [
        'Notion',
        {
          name: 'Notion',
          description: 'Notion is a collaboration and productivity tool.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development'],
          url: new URL('https://mcp.notion.com/mcp'),
          connectionType: ConnectionType.HTTP
        }
      ],
      [
        'Sentry',
        {
          name: 'Sentry',
          description: 'Official MCP server for Sentry.',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development'],
          url: new URL('https://mcp.sentry.dev/sse'),
          connectionType: ConnectionType.SSE
        }
      ],
      [
        'Sequential Thinking',
        {
          name: 'Sequential Thinking',
          description: 'Structured thinking process for problem solving.',
          requiresAuth: false,
          category: ['content'],
          connectionType: ConnectionType.STREAMABLE_HTTP,
          url: new URL('https://remote.mcpservers.org/sequentialthinking/mcp')
        }
      ],
      [
        'Webflow',
        {
          name: 'Webflow',
          description: 'Visual website builder',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development', 'design'],
          connectionType: ConnectionType.SSE,
          url: new URL('https://mcp.webflow.com/sse')
        }
      ],
      [
        'Wix',
        {
          name: 'Wix',
          description: 'Website builder',
          requiresAuth: true,
          authType: AuthType.OAUTH2,
          category: ['development', 'design'],
          connectionType: ConnectionType.SSE,
          url: new URL('https://mcp.wix.com/sse')
        }
      ],
      [
        'Supabase',
        {
          name: 'Supabase',
          description: 'Supabase database, auth, storage, and edge functions via MCP',
          requiresAuth: true,
          authType: AuthType.BEARER_TOKEN,
          category: ['database', 'backend'],
          connectionType: ConnectionType.HTTP,
          url: new URL('https://mcp.supabase.com/mcp'),
          source: 'builtin' as const
        }
      ],
      [
        'HuggingFace',
        {
          name: 'HuggingFace',
          description: 'HuggingFace model inference, datasets, and spaces via MCP',
          requiresAuth: true,
          authType: AuthType.BEARER_TOKEN,
          category: ['ai', 'machine-learning'],
          connectionType: ConnectionType.STREAMABLE_HTTP,
          url: new URL('https://huggingface.co/mcp'),
          source: 'builtin' as const
        }
      ]
    ]);

    this.setupPersistencePaths();
    // Best-effort load persisted servers and tokens
    try {
      this.loadFromDisk();
      this.loadAllTokensFromKeychainSync();
    } catch (e: any) {
      // Non-fatal in renderer/browser
      // console.warn('MCP persistence load failed:', e);
    }
  }

  // Get configuration from multiple sources
  getConfig() {
    const config = { ...DEFAULT_MCP_CONFIG };

    // Try to get from process.env (Node.js environments)
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.MCP_PROXY_URL) {
        config.proxyUrl = process.env.MCP_PROXY_URL;
      }
      if (process.env.USE_MCP_PROXY !== undefined) {
        config.useProxy = process.env.USE_MCP_PROXY !== 'false';
      }
    }

    // Try to get from window global (browser environments)
    if (typeof window !== 'undefined' && (window as any).MCPConfig) {
      Object.assign(config, (window as any).MCPConfig);
    }

    return config;
  }

  // --- Events ---
  onServersChanged(listener: () => void) {
    this.events.on('serversChanged', listener);
    return () => this.events.off('serversChanged', listener);
  }

  private emitServersChanged() {
    this.events.emit('serversChanged');
  }

  // --- Persistence helpers (Node-only, guarded) ---
  private isNodeEnvironment(): boolean {
    return typeof process !== 'undefined' && !!(process.versions as any)?.node;
  }

  // Use eval('require') to avoid bundlers attempting to include native modules
  private nodeRequire<T = any>(moduleId: string): T | null {
    try {
      // eslint-disable-next-line no-new-func
      const r = Function('try { return require; } catch { return null; }')() as any;
      if (!r) return null;
      return r(moduleId) as T;
    } catch {
      return null;
    }
  }

  private setupPersistencePaths() {
    if (!this.isNodeEnvironment()) return;
    try {
      let baseDir: string | null = null;
      // Try Electron userData
      try {
        const electron = this.nodeRequire<any>('electron');
        const app = electron && electron.app;
        if (app && app.getPath) {
          baseDir = app.getPath('userData');
        }
      } catch { }
      if (!baseDir) {
        const home = process.env.APPDATA || process.env.HOME || process.env.USERPROFILE;
        if (home) {
          this._path = this._path || this.nodeRequire('path');
          if (this._path) baseDir = this._path.join(home, '.xgenia');
        }
      }
      this._fs = this._fs || this.nodeRequire('fs');
      this._path = this._path || this.nodeRequire('path');
      if (baseDir && this._fs && this._path) {
        this.storageDir = this._path.join(baseDir, 'mcp');
        this.serversFilePath = this._path.join(this.storageDir, 'servers.json');
        if (!this._fs.existsSync(this.storageDir)) {
          this._fs.mkdirSync(this.storageDir, { recursive: true });
        }
      }
    } catch { }
  }

  private saveServersToDisk() {
    if (!this.isNodeEnvironment() || !this.serversFilePath) return;
    this._fs = this._fs || this.nodeRequire('fs');
    const serializable = Array.from(this.mcpServers.values()).map((s) => ({
      name: s.name,
      description: s.description,
      requiresAuth: s.requiresAuth,
      authType: s.authType,
      category: s.category,
      connectionType: s.connectionType,
      url: s.url.toString(),
      command: s.command,
      args: s.args,
      env: s.env,
      bearerToken: s.bearerToken,
      headerName: s.headerName,
      oauthClientId: s.oauthClientId,
      oauthScope: s.oauthScope,
      source: s.source,
      issuer: s.issuer,
      authorizationEndpoint: s.authorizationEndpoint,
      tokenEndpoint: s.tokenEndpoint,
      registrationEndpoint: s.registrationEndpoint,
      // Do NOT write access/refresh tokens to disk
      tokenExpiresAt: s.tokenExpiresAt
    }));
    try {
      this._fs &&
        this._fs.writeFileSync(this.serversFilePath, JSON.stringify({ servers: serializable }, null, 2), 'utf-8');
    } catch { }
  }

  private loadFromDisk() {
    if (!this.isNodeEnvironment() || !this.serversFilePath) return;
    this._fs = this._fs || this.nodeRequire('fs');
    try {
      if (!this._fs || !this._fs.existsSync(this.serversFilePath)) return;
      const raw = this._fs.readFileSync(this.serversFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as { servers?: any[] };
      const list = parsed.servers || [];
      for (const s of list) {
        try {
          const normalized: MCPServer = {
            name: s.name,
            description: s.description,
            requiresAuth: !!s.requiresAuth,
            authType: s.authType,
            category: Array.isArray(s.category) ? s.category : ['custom'],
            connectionType: s.connectionType,
            url: new URL(s.url),
            command: s.command,
            args: s.args,
            env: s.env,
            bearerToken: s.bearerToken,
            headerName: s.headerName,
            oauthClientId: s.oauthClientId,
            oauthScope: s.oauthScope,
            source: s.source ?? 'custom',
            issuer: s.issuer,
            authorizationEndpoint: s.authorizationEndpoint,
            tokenEndpoint: s.tokenEndpoint,
            registrationEndpoint: s.registrationEndpoint,
            tokenExpiresAt: s.tokenExpiresAt
          } as MCPServer;
          this.mcpServers.set(normalized.name, normalized);
        } catch { }
      }
    } catch { }
  }

  private async saveTokensToKeychain(serverName: string) {
    if (!this.isNodeEnvironment()) return;
    this._keytar = this._keytar || this.nodeRequire('keytar');
    if (!this._keytar) return;
    const server = this.mcpServers.get(serverName);
    if (!server) return;
    const payload = {
      accessToken: server.accessToken || null,
      refreshToken: server.refreshToken || null
    };
    try {
      await this._keytar.setPassword(MCPService.KEYTAR_SERVICE, serverName, JSON.stringify(payload));
    } catch { }
  }

  private async deleteTokensFromKeychain(serverName: string) {
    if (!this.isNodeEnvironment()) return;
    this._keytar = this._keytar || this.nodeRequire('keytar');
    if (!this._keytar) return;
    try {
      await this._keytar.deletePassword(MCPService.KEYTAR_SERVICE, serverName);
    } catch { }
  }

  private loadAllTokensFromKeychainSync() {
    // Keytar does not have sync API; best-effort no-op in sync init.
    // Consumers should call initialize() for async load when needed.
  }

  async initialize(): Promise<void> {
    // For exported projects, load tokens from browser storage
    if (this.isExportedProject()) {
      const names = Array.from(this.mcpServers.keys());
      for (const name of names) {
        const tokenData = this.loadTokenFromBrowserStorage(name);
        if (tokenData) {
          const s = this.mcpServers.get(name);
          if (s) {
            s.accessToken = tokenData.accessToken;
            s.refreshToken = tokenData.refreshToken;
            if (tokenData.tokenExpiresAt) {
              s.tokenExpiresAt = tokenData.tokenExpiresAt;
            } else if (tokenData.expiresIn) {
              s.tokenExpiresAt = Date.now() + tokenData.expiresIn * 1000;
            }
            this.mcpServers.set(name, s);
          }
        }
      }
      // Check for OAuth callback in URL (for exported projects)
      this.handleBrowserOAuthCallback();
      return;
    }

    // For editor (Electron), load tokens from keychain
    if (!this.isNodeEnvironment()) return;
    this._keytar = this._keytar || this.nodeRequire('keytar');
    if (!this._keytar) return;
    const names = Array.from(this.mcpServers.keys());
    for (const name of names) {
      try {
        const str = await this._keytar.getPassword(MCPService.KEYTAR_SERVICE, name);
        if (str) {
          const parsed = JSON.parse(str);
          const s = this.mcpServers.get(name);
          if (s) {
            s.accessToken = parsed.accessToken || undefined;
            s.refreshToken = parsed.refreshToken || undefined;
            this.mcpServers.set(name, s);
          }
        }
      } catch { }
    }
  }

  // Handle OAuth callback in browser (for exported projects)
  private handleBrowserOAuthCallback(): void {
    if (!this.isExportedProject() || typeof window === 'undefined') {
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const error = urlParams.get('error');

    if (error) {
      console.error(`[MCPService] OAuth error: ${error}`);
      const errorDescription = urlParams.get('error_description');
      console.error(`[MCPService] Error description: ${errorDescription}`);
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    if (!code || !state) {
      return;
    }

    // Get server name from sessionStorage (stored when OAuth was initiated)
    const pendingServer = sessionStorage.getItem('oauth_pending_server');
    const expectedState = sessionStorage.getItem(`oauth_state_${pendingServer}`);

    if (!pendingServer) {
      console.error('[MCPService] No pending server found for OAuth callback');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // Verify state
    if (state !== expectedState) {
      console.error('[MCPService] OAuth state mismatch');
      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }

    // Process OAuth callback asynchronously
    this.processBrowserOAuthCallback(pendingServer, code, state).catch((error) => {
      console.error('[MCPService] Error processing OAuth callback:', error);
    });
  }

  // Process OAuth callback for exported projects
  private async processBrowserOAuthCallback(serverName: string, code: string, state: string): Promise<void> {
    try {
      // Get sessionId from sessionStorage
      const sessionId = sessionStorage.getItem(`oauth_sessionId_${serverName}`);
      if (!sessionId) {
        throw new Error('No session ID found for OAuth callback');
      }

      // Exchange code for tokens
      const tokenData = await this.mcpOauthCallback(code, state, sessionId);

      // Store tokens in server configuration
      const server = this.findMcp(serverName);
      server.accessToken = tokenData.accessToken;
      server.refreshToken = tokenData.refreshToken;

      if (tokenData.expiresIn) {
        server.tokenExpiresAt = Date.now() + tokenData.expiresIn * 1000;
      }

      this.mcpServers.set(serverName, server);

      // Save to browser storage for exported projects
      this.saveTokenToBrowserStorage(serverName, {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        tokenExpiresAt: server.tokenExpiresAt
      });

      // Initialize MCP with the accessToken to get sessionId
      try {
        const initResult = await this.initializeMCP(server.url.toString(), tokenData.accessToken);
        this.sessionId = initResult.sessionId;
        this.connectionStatus = ConnectionStatus.CONNECTED;
        this.currentServerName = serverName;
      } catch (initError) {
        console.error(`[MCPService] Failed to initialize MCP after OAuth for '${serverName}':`, initError);
      }

      // Clean up sessionStorage
      sessionStorage.removeItem(`oauth_state_${serverName}`);
      sessionStorage.removeItem('oauth_pending_server');
      sessionStorage.removeItem(`oauth_sessionId_${serverName}`);

      // Clean up URL
      window.history.replaceState({}, document.title, window.location.pathname);

      // Emit event for UI to refresh
      this.emitServersChanged();
    } catch (error: any) {
      // Clean up URL even on error
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      throw error;
    }
  }

  loadAllMcpServers(): any[] {
    // Convert URL objects to strings for frontend compatibility
    // Keep all properties including accessToken for authentication state
    return Array.from(this.mcpServers.values()).map((server) => ({
      ...server,
      url: server.url.toString(),
      authType: server.authType?.toLowerCase(),
      // Keep OAuth tokens and expiry info
      accessToken: server.accessToken,
      refreshToken: server.refreshToken,
      tokenExpiresAt: server.tokenExpiresAt
    }));
  }

  findMcp(serverName: string): MCPServer {
    const server = this.mcpServers.get(serverName);
    if (!server) {
      throw new Error(`MCP Server '${serverName}' not found`);
    }
    return server;
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  getServerCapabilities(): ServerCapabilities | null {
    return this.serverCapabilities;
  }

  getRequestHistory() {
    return this.requestHistory;
  }

  private pushHistory(request: object, response?: object) {
    this.requestHistory.push({
      request: JSON.stringify(request),
      response: response !== undefined ? JSON.stringify(response) : undefined
    });
  }

  // Core API helper functions matching the new implementation
  private async initializeMCP(serverUrl: string, token?: string): Promise<{ sessionId: string }> {
    // Check if this is a streamable-http server that we should handle directly
    const isStreamableHttp = serverUrl.includes('mapstools.googleapis.com') ||
      serverUrl.includes('remote.mcpservers.org');

    if (isStreamableHttp) {
      // Handle streamable-http servers directly with JSON-RPC format
      const initRequest = {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'xgenia',
            version: '1.0'
          }
        },
        id: 1
      };

      const response = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(initRequest)
      });

      if (!response.ok) {
        throw new Error(`Initialize failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        throw new Error(`Initialize failed: ${result.error.message}`);
      }

      // Return a mock session ID for streamable-http servers
      return { sessionId: `streamable-${Date.now()}` };
    }

    // Original Edge Function approach for other servers
    const requestBody: any = {
      serverUrl: serverUrl,
      operation: 'initialize'
    };

    // Only include token if it's provided and not empty
    if (token) {
      requestBody.token = token;
    }

    const response = await fetch(urls.mcpFlow, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      // Try to get error details from response body
      let errorMessage = `Initialize failed: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error) {
          errorMessage = errorBody.error;
        } else if (errorBody.message) {
          errorMessage = errorBody.message;
        } else if (typeof errorBody === 'string') {
          errorMessage = errorBody;
        }
      } catch (e: any) {
        // If we can't parse the error body, use the default message
        const text = await response.text().catch(() => '');
        if (text) {
          errorMessage = `${errorMessage}. Response: ${text}`;
        }
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result;
  }

  private async fetchTools(serverUrl: string, sessionId: string, token?: string): Promise<{ tools: any[] }> {
    console.log(`[MCPService] fetchTools called with URL: ${serverUrl}, token present: ${!!token}`);

    // Check if this is a streamable-http server that we should handle directly
    const isStreamableHttp = serverUrl.includes('mapstools.googleapis.com') ||
      serverUrl.includes('remote.mcpservers.org');

    if (isStreamableHttp) {
      console.log(`[MCPService] Handling as streamable-http server`);
      // Handle streamable-http servers directly with JSON-RPC format
      const toolsRequest = {
        jsonrpc: '2.0',
        method: 'tools/list',
        params: {},
        id: 2
      };

      // Prepare headers and URL
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      let requestUrl = serverUrl;
      let requestParams = { ...toolsRequest.params };

      if (serverUrl.includes('mapstools.googleapis.com') && token) {
        // For Google Maps MCP server, try both query parameter and params
        const url = new URL(serverUrl);
        url.searchParams.set('key', token);
        requestUrl = url.toString();

        // Also add to params in case the server expects it there
        (requestParams as any).key = token;

        console.log(`[MCPService] Added API key to Google Maps tools list request (query param and params)`);
      }

      // Update the request with modified params
      const finalRequest = { ...toolsRequest, params: requestParams };

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MCPService] Tools list failed for ${serverUrl}:`, response.status, errorText);
        throw new Error(`Tools list failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        console.error(`[MCPService] Tools list error:`, result.error);
        throw new Error(`Tools list failed: ${result.error.message}`);
      }

      return { tools: result.result?.tools || [] };
    }

    // Original Edge Function approach for other servers
    const requestBody: any = {
      sessionId,
      serverUrl: serverUrl,
      operation: 'list_tools'
    };

    // Only include token if it's provided and not empty
    if (token) {
      requestBody.token = token;
    }

    const response = await fetch(urls.mcpFlow, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      // Try to get error details from response body
      let errorMessage = `List tools failed: ${response.status} ${response.statusText}`;
      const errorBody = await response.json();
      if (errorBody.error) {
        errorMessage = errorBody.error;
      } else if (errorBody.message) {
        errorMessage = errorBody.message;
      } else if (typeof errorBody === 'string') {
        errorMessage = errorBody;
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();
    return result;
  }

  private async callMCPTool(
    serverUrl: string,
    toolName: string,
    inputSchema: any,
    sessionId: string,
    token?: string
  ): Promise<{ result: any }> {
    // Check if this is a streamable-http server that we should handle directly
    const isStreamableHttp = serverUrl.includes('mapstools.googleapis.com') ||
      serverUrl.includes('remote.mcpservers.org');

    if (isStreamableHttp) {
      // Handle streamable-http servers directly with JSON-RPC format
      const toolRequest = {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: inputSchema
        },
        id: 3
      };

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // Add authentication for Google Maps
      let requestUrl = serverUrl;
      let requestParams = { ...toolRequest.params };

      if (serverUrl.includes('mapstools.googleapis.com') && token) {
        // For Google Maps MCP server, try both query parameter and params
        const url = new URL(serverUrl);
        url.searchParams.set('key', token);
        requestUrl = url.toString();

        // Also add to params in case the server expects it there
        (requestParams as any).key = token;

        console.log(`[MCPService] Added API key to Google Maps tool call request (query param and params)`);
      }

      // Update the request with modified params
      const finalRequest = { ...toolRequest, params: requestParams };

      const response = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(finalRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[MCPService] Tool call failed for ${toolName}:`, response.status, errorText);
        throw new Error(`Tool call failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        console.error(`[MCPService] Tool call error for ${toolName}:`, result.error);
        throw new Error(`Tool call failed: ${result.error.message}`);
      }

      return { result: result.result };
    }

    // Original Edge Function approach for other servers
    const requestBody: any = {
      serverUrl: serverUrl,
      sessionId,
      operation: 'call',
      toolName: toolName,
      toolArguments: inputSchema
    };

    // Only include token if it's provided and not empty
    if (token) {
      requestBody.token = token;
    }

    const response = await fetch(urls.mcpFlow, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      // Try to get error details from response body
      let errorMessage = `Tool call failed: ${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error) {
          errorMessage = errorBody.error;
        } else if (errorBody.message) {
          errorMessage = errorBody.message;
        } else if (typeof errorBody === 'string') {
          errorMessage = errorBody;
        }
      } catch (e: any) {
        // If we can't parse the error body, use the default message
        const text = await response.text().catch(() => '');
        if (text) {
          errorMessage = `${errorMessage}. Response: ${text}`;
        }
      }
      throw new Error(errorMessage);
    }
    const contentType = response.headers.get('Content-Type');
    if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let result = '';
      while (true) {
        const { done, value } = await reader?.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      return { result };
    }
    const result = await response.json();
    return result;
  }

  // OAuth helper functions matching the new implementation
  private async mcpOauthInitialize(
    serverUrl: string,
    callbackUrl: string
  ): Promise<{ authorizationUrl: string; sessionId: string; state: string }> {
    const response = await fetch(urls.oauthInit, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        serverUrl: serverUrl,
        callbackUrl: callbackUrl
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize MCP OAuth: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  }

  private async mcpOauthCallback(
    code: string,
    state: string,
    sessionId: string
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; tokenType: string }> {
    const response = await fetch(urls.oauthExchange, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code: code,
        state: state,
        sessionId: sessionId
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to handle MCP OAuth callback: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  }

  // Enhanced connection method using new MCP API
  async connect(serverName: string, options: MCPConnectionOptions = {}): Promise<void> {
    const server = this.findMcp(serverName);

    this.connectionStatus = ConnectionStatus.CONNECTING;
    this.currentServerName = serverName;

    try {
      let result: { sessionId: string; accessToken?: string };
      let accessToken: string | undefined = server.accessToken || options.bearerToken;

      // Auto-refresh OAuth2 tokens if expired and refresh token available
      if (server.authType === AuthType.OAUTH2 && this.isTokenExpired(serverName) && server.refreshToken) {
        try {
          await this.refreshOAuthToken(serverName);
          await this.saveTokensToKeychain(serverName);
          this.saveServersToDisk();
          // Update accessToken after refresh - refreshOAuthToken updates server.accessToken and tokenExpiresAt
          accessToken = server.accessToken || options.bearerToken;
        } catch (e: any) {
          console.warn(`[MCPService] Token refresh failed for '${serverName}':`, e);
          // Clear invalid token so we can re-authenticate
          accessToken = undefined;
        }
      }

      // Check if we need OAuth authentication
      // Only initiate OAuth if:
      // 1. Server requires auth AND is OAuth2 type
      // 2. AND (no access token OR token is expired)
      // Note: After token refresh above, isTokenExpired should return false if refresh succeeded
      const needsOAuth =
        server.requiresAuth && server.authType === AuthType.OAUTH2 && (!accessToken || this.isTokenExpired(serverName));

      // Handle OAuth authentication if needed
      if (needsOAuth) {
        // For exported projects, use current page URL as callback
        // For editor (Electron), use the configured redirect URI
        let callbackUrl: string;
        if (this.isExportedProject() && typeof window !== 'undefined') {
          callbackUrl = `${window.location.origin}${window.location.pathname}`;
        } else {
          callbackUrl = options.callbackUrl || this.oauthRedirectUri;
        }
        const initOauth = await this.mcpOauthInitialize(server.url.toString(), callbackUrl);

        // Store sessionId for OAuth callback
        this.sessionId = initOauth.sessionId;

        // For exported projects, store sessionId in sessionStorage and redirect to auth URL
        if (this.isExportedProject() && typeof window !== 'undefined') {
          const state = initOauth.state || initOauth.sessionId;
          sessionStorage.setItem(`oauth_state_${serverName}`, state);
          sessionStorage.setItem('oauth_pending_server', serverName);
          sessionStorage.setItem(`oauth_sessionId_${serverName}`, initOauth.sessionId);
          // Redirect to authorization URL
          window.location.href = initOauth.authorizationUrl;
          return; // Don't continue, we're redirecting
        }

        // For browser environments (Electron), open popup and handle callback
        if (this.isBrowserEnvironment()) {
          await this.createMCPOAuthPopup(
            initOauth.authorizationUrl,
            callbackUrl,
            serverName,
            initOauth.sessionId,
            initOauth.state
          );

          // After OAuth popup completes, get tokens from callback
          // The popup handler will call handleMCPOAuthTokens which stores the tokens
          // We need to wait for the tokens to be available
          const maxWait = 30000; // 30 seconds
          const startTime = Date.now();
          while (!server.accessToken && Date.now() - startTime < maxWait) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          if (!server.accessToken) {
            throw new Error('OAuth authentication timed out or was cancelled');
          }

          accessToken = server.accessToken;
        } else {
          // For non-browser environments, return authorization URL for manual handling
          throw new Error(`OAuth authentication required. Please visit: ${initOauth.authorizationUrl}`);
        }
      }

      // Initialize MCP connection
      result = await this.initializeMCP(server.url.toString(), accessToken);
      this.sessionId = result.sessionId;

      if (!this.sessionId) {
        throw new Error('No sessionId received from initialize operation');
      }

      // Store accessToken if returned from initialization
      if (result.accessToken) {
        accessToken = result.accessToken;
        server.accessToken = accessToken;
        this.mcpServers.set(serverName, server);
        await this.saveTokensToKeychain(serverName);
        this.saveServersToDisk();
      }

      // Set basic server capabilities (we don't get detailed capabilities from the new API)
      this.serverCapabilities = {
        tools: { listChanged: true },
        logging: {},
        prompts: {},
        resources: {}
      };

      // Log successful connection
      const initializeRequest = { method: 'initialize', serverName };
      this.pushHistory(initializeRequest, {
        sessionId: this.sessionId,
        capabilities: this.serverCapabilities
      });

      this.connectionStatus = ConnectionStatus.CONNECTED;
    } catch (error: any) {
      this.connectionStatus = ConnectionStatus.ERROR;
      console.error(`Failed to connect to MCP Server '${serverName}':`, error);

      // Clean up on error
      this.sessionId = null;
      this.serverCapabilities = null;
      this.currentServerName = null;

      throw error;
    }
  }

  // Check if we have a valid session for a specific server
  private hasValidSession(serverName: string): boolean {
    return (
      this.connectionStatus === ConnectionStatus.CONNECTED &&
      this.sessionId !== null &&
      this.currentServerName === serverName
    );
  }

  // Ensure we have a valid session for the specified server
  private async ensureSession(serverName: string, options: MCPConnectionOptions = {}): Promise<void> {
    if (!this.hasValidSession(serverName)) {
      await this.connect(serverName, options);
      this.currentServerName = serverName;
    } else {
      // In browser environments, validate that the session is still active
      // by attempting a lightweight operation
      if (this.isBrowserEnvironment()) {
        try {
          await this.validateSession(serverName, options);
        } catch (error: any) {
          console.warn(`[MCPService] Session validation failed for ${serverName}, reconnecting:`, error);
          await this.connect(serverName, options);
          this.currentServerName = serverName;
        }
      }
    }
  }

  // Validate that a session is still active (lightweight check)
  private async validateSession(serverName: string, options: MCPConnectionOptions = {}): Promise<void> {
    if (!this.sessionId) {
      throw new Error('No active session to validate');
    }

    const server = this.findMcp(serverName);
    const token = server.accessToken || options.bearerToken;

    // Try a simple operation to validate the session
    try {
      await this.fetchTools(server.url.toString(), this.sessionId, token);
    } catch (error: any) {
      throw new Error(`Session validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Check if we're running in a browser environment
  private isBrowserEnvironment(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
  }

  // Check if we're running in an exported project (browser but not Electron)
  private isExportedProject(): boolean {
    if (!this.isBrowserEnvironment()) {
      return false;
    }
    // Check if we're in Electron
    const isElectron =
      typeof window !== 'undefined' &&
      ((window as any).process?.type === 'renderer' ||
        (typeof navigator !== 'undefined' && navigator.userAgent?.indexOf('Electron') >= 0));
    // Exported project = browser but not Electron
    return !isElectron;
  }

  // Browser storage methods for exported projects
  private getBrowserStorageKey(serverName: string): string {
    return `xgenia_mcp_token_${serverName}`;
  }

  private saveTokenToBrowserStorage(
    serverName: string,
    tokenData: {
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
      tokenExpiresAt?: number;
    }
  ): void {
    if (!this.isExportedProject()) {
      return;
    }
    try {
      const storageKey = this.getBrowserStorageKey(serverName);
      localStorage.setItem(storageKey, JSON.stringify(tokenData));
    } catch (error: any) {
      console.error(`[MCPService] Failed to save token to browser storage:`, error);
    }
  }

  private loadTokenFromBrowserStorage(serverName: string): {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: number;
    tokenExpiresAt?: number;
  } | null {
    if (!this.isExportedProject()) {
      return null;
    }
    try {
      const storageKey = this.getBrowserStorageKey(serverName);
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const tokenData = JSON.parse(stored);
        return tokenData;
      }
    } catch (error: any) {
      console.error(`[MCPService] Failed to load token from browser storage:`, error);
    }
    return null;
  }

  private removeTokenFromBrowserStorage(serverName: string): void {
    if (!this.isExportedProject()) {
      return;
    }
    try {
      const storageKey = this.getBrowserStorageKey(serverName);
      localStorage.removeItem(storageKey);
    } catch (error: any) {
      console.error(`[MCPService] Failed to remove token from browser storage:`, error);
    }
  }

  // Disconnect from current server
  async disconnect(): Promise<void> {
    // Clear session data
    this.sessionId = null;
    this.serverCapabilities = null;
    this.connectionStatus = ConnectionStatus.DISCONNECTED;
    this.currentServerName = null;
  }

  // Get tools from the connected server
  async getTools(serverName: string, options: MCPConnectionOptions = {}): Promise<any[]> {
    try {
      // Ensure we have a valid session for this server
      await this.ensureSession(serverName, options);

      const server = this.findMcp(serverName);
      const token = server.accessToken || options.bearerToken;

      console.log(`[MCPService] Fetching tools for ${serverName}, server URL: ${server.url}, has token: ${!!token}, token length: ${token?.length || 0}`);

      const result = await this.fetchTools(server.url.toString(), this.sessionId!, token);

      // Log the request
      this.pushHistory({ operation: 'list_tools', serverName, sessionId: this.sessionId }, result);

      return result.tools || [];
    } catch (error: any) {
      console.error(`[MCPService] Error getting tools from '${serverName}':`, error);
      this.pushHistory(
        { operation: 'list_tools', serverName },
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  // Call a tool on the connected server
  async callTool(
    serverName: string,
    toolName: string,
    inputSchema: any,
    options: MCPConnectionOptions = {}
  ): Promise<any> {
    try {
      // Ensure we have a valid session for this server
      await this.ensureSession(serverName, options);

      const server = this.findMcp(serverName);
      const token = server.accessToken || options.bearerToken;

      // Validate that we have a sessionId
      if (!this.sessionId) {
        throw new Error(`No active session for server '${serverName}'. Please reconnect.`);
      }

      // For OAuth servers, validate that we have a token
      if (server.requiresAuth && server.authType === AuthType.OAUTH2 && !token) {
        throw new Error(`OAuth token required for server '${serverName}'. Please authenticate first.`);
      }

      const result = await this.callMCPTool(server.url.toString(), toolName, inputSchema, this.sessionId, token);

      // Log the request
      this.pushHistory(
        {
          operation: 'call',
          serverName,
          sessionId: this.sessionId,
          toolName,
          toolArguments: inputSchema
        },
        result
      );

      return result.result || result;
    } catch (error: any) {
      console.error(`[MCPService] Error calling tool '${toolName}' on '${serverName}':`, error);
      this.pushHistory(
        { operation: 'call', serverName, toolName, toolArguments: inputSchema },
        { error: error instanceof Error ? error.message : String(error) }
      );
      throw error;
    }
  }

  // Convenience method for SSE servers that often need proxy
  async connectSSE(serverName: string, options: MCPConnectionOptions = {}): Promise<void> {
    return this.connect(serverName, {
      ...options,
      transportType: ConnectionType.SSE,
      useProxy: true // Force proxy for SSE
    });
  }

  // Check if server is remote (should use proxy)
  isRemoteServer(serverName: string): boolean {
    return this.config.remoteServers.includes(serverName);
  }

  // Get server by name
  getServer(serverName: string): MCPServer | undefined {
    return this.mcpServers.get(serverName);
  }

  // Add a new server
  addServer(server: MCPServer | any): void {
    const normalizedServer = {
      ...server,
      // Handle URL conversion from string to URL object
      url: typeof server.url === 'string' ? new URL(server.url) : server.url,
      category: server.category && server.category.length > 0 ? server.category : ['custom'],
      source: server.source ?? 'custom',
      connectionType: server.connectionType ?? ConnectionType.SSE,
      requiresAuth: server.requiresAuth ?? false,
      authType: server.authType ? AuthType[server.authType.toUpperCase() as keyof typeof AuthType] : undefined
    };

    this.mcpServers.set(normalizedServer.name, normalizedServer);
    this.saveServersToDisk();
    this.emitServersChanged();
  }

  // Remove a server
  removeServer(serverName: string): boolean {
    const ok = this.mcpServers.delete(serverName);
    if (ok) {
      this.saveServersToDisk();
      this.deleteTokensFromKeychain(serverName);
      // Also remove from browser storage for exported projects
      this.removeTokenFromBrowserStorage(serverName);
      this.emitServersChanged();
    }
    return ok;
  }

  // Set OAuth redirect URI
  setOAuthRedirectUri(uri: string): void {
    this.oauthRedirectUri = uri;
  }

  // Get OAuth redirect URI
  getOAuthRedirectUri(): string {
    return this.oauthRedirectUri;
  }

  // Dynamic client registration (RFC 7591)
  async registerOAuthClient(serverName: string): Promise<{ clientId: string; clientSecret?: string }> {
    const server = this.findMcp(serverName);

    if (!server.registrationEndpoint) {
      throw new Error(`Server '${serverName}' does not support dynamic client registration`);
    }

    const registrationData = {
      client_name: 'XGENIA MCP Client',
      redirect_uris: [this.oauthRedirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client (no client secret)
      application_type: 'native',
      ...(server.oauthScope && { scope: server.oauthScope })
    };

    try {
      const response = await fetch(server.registrationEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(registrationData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Client registration failed: ${response.status} - ${errorText}`);
      }

      const clientData = await response.json();

      // Store the client ID in the server config
      server.oauthClientId = clientData.client_id;
      if (clientData.client_secret) {
        server.bearerToken = clientData.client_secret; // Store secret securely
      }

      this.mcpServers.set(serverName, server);
      this.saveServersToDisk();
      this.emitServersChanged();

      return {
        clientId: clientData.client_id,
        clientSecret: clientData.client_secret
      };
    } catch (error: any) {
      console.error('Dynamic client registration failed:', error);
      throw error;
    }
  }

  // OAuth authentication methods - Updated to use MCP OAuth flow
  async initiateOAuthFlow(serverName: string): Promise<{ authUrl: string; state: string }> {
    const server = this.findMcp(serverName);

    if (server.authType !== AuthType.OAUTH2) {
      throw new Error(`Server '${serverName}' does not use OAuth2 authentication`);
    }

    // Check if we already have a valid (non-expired) token
    // If token exists and is not expired, throw an error to prevent unnecessary OAuth flow
    if (server.accessToken && !this.isTokenExpired(serverName)) {
      throw new Error(
        `Server '${serverName}' already has a valid access token. OAuth authentication is not needed. The token will remain valid until it expires.`
      );
    }

    try {
      // Generate callback URL
      // For exported projects, use the current page URL as callback
      // For editor (Electron), use the configured redirect URI
      let callbackUrl: string;
      if (this.isExportedProject() && typeof window !== 'undefined') {
        // Use current page URL as callback for exported projects
        callbackUrl = `${window.location.origin}${window.location.pathname}`;
      } else {
        callbackUrl = this.oauthRedirectUri;
      }

      // Call oauth-init to get authorization URL
      const initOauth = await this.mcpOauthInitialize(server.url.toString(), callbackUrl);

      if (!initOauth.authorizationUrl) {
        throw new Error('No authorization URL received from OAuth init');
      }

      // Store session data for later use
      this.sessionId = initOauth.sessionId;

      // For exported projects, store sessionId in sessionStorage for OAuth callback
      if (this.isExportedProject() && typeof window !== 'undefined') {
        const state = initOauth.state || initOauth.sessionId;
        sessionStorage.setItem(`oauth_state_${serverName}`, state);
        sessionStorage.setItem('oauth_pending_server', serverName);
        sessionStorage.setItem(`oauth_sessionId_${serverName}`, initOauth.sessionId);
      }

      // Return the authorization URL (maintaining the same interface as before)
      return {
        authUrl: initOauth.authorizationUrl,
        state: initOauth.state || initOauth.sessionId // Use state or sessionId for compatibility
      };
    } catch (error: any) {
      console.error(`[MCPService] Failed to initiate MCP OAuth flow for '${serverName}':`, error);
      throw error;
    }
  }

  async handleOAuthCallback(
    serverName: string,
    code: string,
    state: string,
    expectedState: string
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; sessionId?: string }> {
    const server = this.findMcp(serverName);

    // Exchange code for tokens using mcpOauthCallback
    const tokenData = await this.mcpOauthCallback(code, state, this.sessionId!);

    // Store tokens in the server configuration
    server.accessToken = tokenData.accessToken;
    server.refreshToken = tokenData.refreshToken;

    if (tokenData.expiresIn) {
      server.tokenExpiresAt = Date.now() + tokenData.expiresIn * 1000;
    }

    // Update the server in the map
    this.mcpServers.set(serverName, server);
    await this.saveTokensToKeychain(serverName);
    // Also save to browser storage for exported projects
    if (this.isExportedProject()) {
      this.saveTokenToBrowserStorage(serverName, {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        tokenExpiresAt: server.tokenExpiresAt
      });
    }
    this.saveServersToDisk();
    this.emitServersChanged();

    // Initialize MCP with the accessToken to get sessionId
    try {
      const initResult = await this.initializeMCP(server.url.toString(), tokenData.accessToken);
      this.sessionId = initResult.sessionId;

      // Update connection status
      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.currentServerName = serverName;

      return {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn,
        sessionId: this.sessionId
      };
    } catch (error: any) {
      console.error(`[MCPService] Failed to initialize MCP after OAuth for '${serverName}':`, error);
      // Still return tokens even if initialization fails
      return {
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresIn: tokenData.expiresIn
      };
    }
  }

  // Handle MCP OAuth tokens (when tokens are provided directly)
  async handleMCPOAuthTokens(
    serverName: string,
    tokens: { access_token: string; refresh_token?: string; expires_in?: number; token_type?: string }
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; sessionId?: string }> {
    const server = this.findMcp(serverName);

    // Store tokens in the server configuration
    server.accessToken = tokens.access_token;
    server.refreshToken = tokens.refresh_token;

    if (tokens.expires_in) {
      server.tokenExpiresAt = Date.now() + tokens.expires_in * 1000;
    }

    // Update the server in the map
    this.mcpServers.set(serverName, server);
    await this.saveTokensToKeychain(serverName);
    // Also save to browser storage for exported projects
    if (this.isExportedProject()) {
      this.saveTokenToBrowserStorage(serverName, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        tokenExpiresAt: server.tokenExpiresAt
      });
    }
    this.saveServersToDisk();
    this.emitServersChanged();

    // Initialize MCP with the accessToken to get sessionId
    try {
      const initResult = await this.initializeMCP(server.url.toString(), tokens.access_token);
      this.sessionId = initResult.sessionId;

      // Update connection status
      this.connectionStatus = ConnectionStatus.CONNECTED;
      this.currentServerName = serverName;

      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        sessionId: this.sessionId
      };
    } catch (error: any) {
      console.error(`[MCPService] Failed to initialize MCP after OAuth for '${serverName}':`, error);
      // Still return tokens even if initialization fails
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in
      };
    }
  }

  async refreshOAuthToken(serverName: string): Promise<string> {
    const server = this.findMcp(serverName);

    if (!server.refreshToken) {
      throw new Error(`No refresh token available for '${serverName}'`);
    }

    if (!server.tokenEndpoint) {
      throw new Error(`Server '${serverName}' missing token endpoint`);
    }

    const tokenResponse = await fetch(server.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: server.refreshToken,
        ...(server.oauthClientId && { client_id: server.oauthClientId })
      })
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token refresh failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();

    // Update tokens
    server.accessToken = tokenData.access_token;
    if (tokenData.refresh_token) {
      server.refreshToken = tokenData.refresh_token;
    }
    if (tokenData.expires_in) {
      server.tokenExpiresAt = Date.now() + tokenData.expires_in * 1000;
    }

    this.mcpServers.set(serverName, server);
    await this.saveTokensToKeychain(serverName);
    this.saveServersToDisk();
    this.emitServersChanged();

    return tokenData.access_token;
  }

  isTokenExpired(serverName: string): boolean {
    const server = this.mcpServers.get(serverName);

    // If server doesn't exist or has no access token, consider it expired/unauthenticated
    if (!server || !server.accessToken) {
      return true;
    }

    // If no expiry time is set, assume token is still valid
    if (!server.tokenExpiresAt) {
      return false;
    }

    // Consider token expired 5 minutes before actual expiry
    const isExpired = Date.now() >= server.tokenExpiresAt - 5 * 60 * 1000;
    return isExpired;
  }

  private generateRandomState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // Initiate MCP OAuth flow using the new oauth-init endpoint
  private async initiateMCPOAuthFlow(serverName: string, options: MCPConnectionOptions = {}): Promise<void> {
    const server = this.findMcp(serverName);

    // Generate callback URL - use the configured redirect URI or a default
    const callbackUrl = options.callbackUrl || this.oauthRedirectUri;

    try {
      // Call oauth-init to get authorization URL
      const initOauth = await this.mcpOauthInitialize(server.url.toString(), callbackUrl);

      if (!initOauth.authorizationUrl) {
        throw new Error('No authorization URL received from OAuth init');
      }

      // Store session ID for later use
      this.sessionId = initOauth.sessionId;

      // Create popup window for MCP OAuth authentication
      await this.createMCPOAuthPopup(
        initOauth.authorizationUrl,
        callbackUrl,
        serverName,
        initOauth.sessionId,
        initOauth.state
      );
    } catch (error: any) {
      console.error(`[MCPService] Failed to initiate OAuth flow for '${serverName}':`, error);
      throw error;
    }
  }

  // Create popup window for MCP OAuth authentication
  private async createMCPOAuthPopup(
    authorizationUrl: string,
    callbackUrl: string,
    serverName: string,
    sessionId: string,
    state: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Check if we're in a browser environment
        if (typeof window === 'undefined') {
          throw new Error('OAuth popup authentication is only available in browser environments');
        }

        // Create popup window
        const popupWidth = 500;
        const popupHeight = 600;
        const left = window.screen.width / 2 - popupWidth / 2;
        const top = window.screen.height / 2 - popupHeight / 2;

        const popup = window.open(
          authorizationUrl,
          'oauth-popup',
          `width=${popupWidth},height=${popupHeight},left=${left},top=${top},scrollbars=yes,resizable=yes`
        );

        if (!popup) {
          throw new Error('Failed to open OAuth popup window. Please allow popups for this site.');
        }

        // Set up message listener for OAuth callback
        const messageHandler = async (event: MessageEvent) => {
          // Verify origin for security (you might want to restrict this to your domain)
          if (event.data && event.data.type === 'oauth-callback') {
            // Clean up
            window.removeEventListener('message', messageHandler);
            popup.close();

            // Check if this is an error response
            if (event.data.error) {
              const error = new Error(event.data.error_description || event.data.error);
              console.error(`[MCPService] OAuth callback error for '${serverName}':`, error);
              this.events.emit('oauth-completed', { serverName, success: false, error });
              reject(error);
              return;
            }

            // Extract code and state from callback URL
            const urlParams = new URLSearchParams(event.data.url?.split('?')[1] || '');
            const code = urlParams.get('code') || event.data.code;
            const callbackState = urlParams.get('state') || event.data.state || state;

            try {
              // Exchange code for tokens using mcpOauthCallback
              const tokenData = await this.mcpOauthCallback(code!, callbackState, sessionId);

              // Store tokens in the server configuration
              const server = this.findMcp(serverName);
              server.accessToken = tokenData.accessToken;
              server.refreshToken = tokenData.refreshToken;

              if (tokenData.expiresIn) {
                server.tokenExpiresAt = Date.now() + tokenData.expiresIn * 1000;
              }

              this.mcpServers.set(serverName, server);
              await this.saveTokensToKeychain(serverName);
              this.saveServersToDisk();
              this.emitServersChanged();

              // Initialize MCP with the accessToken to get sessionId
              try {
                const initResult = await this.initializeMCP(server.url.toString(), tokenData.accessToken);
                this.sessionId = initResult.sessionId;
                this.connectionStatus = ConnectionStatus.CONNECTED;
                this.currentServerName = serverName;
              } catch (initError) {
                console.error(`[MCPService] Failed to initialize MCP after OAuth for '${serverName}':`, initError);
                // Continue even if initialization fails - tokens are saved
              }

              this.events.emit('oauth-completed', { serverName, success: true });
              resolve();
            } catch (error: any) {
              console.error(`[MCPService] OAuth callback handling failed for '${serverName}':`, error);
              this.events.emit('oauth-completed', { serverName, success: false, error });
              reject(error);
            }
          }
        };

        window.addEventListener('message', messageHandler);

        // Also listen for URL changes in the popup (for redirect-based OAuth)
        const checkPopupUrl = setInterval(() => {
          try {
            if (popup.closed) {
              clearInterval(checkPopupUrl);
              window.removeEventListener('message', messageHandler);
              reject(new Error('OAuth authentication was cancelled'));
              return;
            }

            // Try to read the popup URL (may fail due to cross-origin restrictions)
            const popupUrl = (popup as any).location?.href;
            if (popupUrl && popupUrl.includes(callbackUrl)) {
              clearInterval(checkPopupUrl);
              const urlParams = new URLSearchParams(popupUrl.split('?')[1] || '');
              const code = urlParams.get('code');
              const callbackState = urlParams.get('state') || state;

              if (code) {
                // Handle the callback
                this.mcpOauthCallback(code, callbackState, sessionId)
                  .then(async (tokenData) => {
                    const server = this.findMcp(serverName);
                    server.accessToken = tokenData.accessToken;
                    server.refreshToken = tokenData.refreshToken;

                    if (tokenData.expiresIn) {
                      server.tokenExpiresAt = Date.now() + tokenData.expiresIn * 1000;
                    }

                    this.mcpServers.set(serverName, server);
                    await this.saveTokensToKeychain(serverName);
                    this.saveServersToDisk();
                    this.emitServersChanged();

                    // Initialize MCP with the accessToken to get sessionId
                    try {
                      const initResult = await this.initializeMCP(server.url.toString(), tokenData.accessToken);
                      this.sessionId = initResult.sessionId;
                      this.connectionStatus = ConnectionStatus.CONNECTED;
                      this.currentServerName = serverName;
                    } catch (initError) {
                      console.error(
                        `[MCPService] Failed to initialize MCP after OAuth for '${serverName}':`,
                        initError
                      );
                      // Continue even if initialization fails - tokens are saved
                    }

                    window.removeEventListener('message', messageHandler);
                    popup.close();

                    this.events.emit('oauth-completed', { serverName, success: true });
                    resolve();
                  })
                  .catch((error) => {
                    window.removeEventListener('message', messageHandler);
                    popup.close();
                    console.error(`[MCPService] OAuth callback handling failed for '${serverName}':`, error);
                    this.events.emit('oauth-completed', { serverName, success: false, error });
                    reject(error);
                  });
              }
            }
          } catch (e: any) {
            // Cross-origin restrictions - ignore and continue polling
          }
        }, 500);

        // Timeout after 5 minutes
        setTimeout(() => {
          clearInterval(checkPopupUrl);
          window.removeEventListener('message', messageHandler);
          if (!popup.closed) {
            popup.close();
          }
          reject(new Error('OAuth authentication timed out'));
        }, 5 * 60 * 1000);
      } catch (error: any) {
        reject(error);
      }
    });
  }

  // Event listener for OAuth completion
  onOAuthCompleted(listener: (data: { serverName: string; success: boolean; error?: Error }) => void) {
    this.events.on('oauth-completed', listener);
    return () => this.events.off('oauth-completed', listener);
  }
}
