import { useState, useEffect, useMemo } from 'react';

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: any;
}

export interface MCPServer {
  name: string;
  description?: string;
  category: string[];
  url: string;
  connectionType?: string;
  requiresAuth?: boolean;
  authType?: string;
  source?: 'builtin' | 'custom' | 'remote';
  tags?: string[];
  // API Key authentication fields
  accessToken?: string;
  headerName?: string;
  // Bearer Token authentication fields
  // Basic Auth authentication fields
  basicUsername?: string;
  basicPassword?: string;
  // OAuth-specific fields
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  registrationEndpoint?: string;
  oauthClientId?: string;
  oauthScope?: string;
  // Token fields (persist per user request)
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export function useMcpServerBrowser() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [selectedServer, setSelectedServer] = useState<MCPServer | null>(null);
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);
  const [toolError, setToolError] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedTool, setSelectedTool] = useState<MCPTool | null>(null);
  const [isManagingServers, setIsManagingServers] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [needsAuthentication, setNeedsAuthentication] = useState(false);

  // Deprecated: localStorage server persistence — now handled by shared MCP service persistence.

  // Load servers on mount and subscribe to service changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      // Ensure service is initialized (loads tokens/persistence)
      try {
        await (window as any).mcpAPI.onInitialized?.(() => {});
      } catch {}
      const all = await window.mcpAPI.loadAllMcpServers();
      if (mounted) setServers(all as MCPServer[]);
    })();
    // subscribe to server changes
    const unsub = window.mcpAPI.onServersChanged?.(async () => {
      const all = await window.mcpAPI.loadAllMcpServers();
      if (mounted) setServers(all as MCPServer[]);
    });
    return () => {
      mounted = false;
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Set up OAuth callback listeners on mount
  useEffect(() => {
    console.log('[OAuth] Setting up OAuth callback listeners...');

    // OAuth callback handler
    const handleOAuthCallback = async (event: any, data: { code: string; state: string }) => {
      console.log('[OAuth] Callback received in renderer:', data);

      const pendingServer = sessionStorage.getItem('oauth_pending_server');
      const expectedState = sessionStorage.getItem(`oauth_state_${pendingServer}`);

      if (!pendingServer) {
        console.error('[OAuth] No pending server found');
        setToolError('No pending OAuth authentication found');
        setIsAuthenticating(false);
        return;
      }

      try {
        console.log('[OAuth] Exchanging code for token...');
        // Complete OAuth flow
        const result = await window.mcpAPI.handleOAuthCallback(
          pendingServer,
          data.code,
          data.state,
          expectedState || ''
        );

        console.log('[OAuth] Authentication successful:', result);

        // Clean up
        sessionStorage.removeItem(`oauth_state_${pendingServer}`);
        sessionStorage.removeItem('oauth_pending_server');

        // Refresh servers to get updated auth status
        const allServers = await window.mcpAPI.loadAllMcpServers();
        setServers(allServers as MCPServer[]);

        // Clear the authentication state and try to load tools
        setIsAuthenticating(false);
        setNeedsAuthentication(false);
        setToolError(null);

        // Find the authenticated server and select it to trigger tools load
        const server = (allServers as MCPServer[]).find((s) => s.name === pendingServer);
        if (server) {
          console.log('[OAuth] Selecting server to trigger tools fetch:', server.name);
          setSelectedServer(null);
          setTimeout(() => setSelectedServer(server), 100);
        }
      } catch (error: any) {
        console.error('[OAuth] Callback error:', error);
        setToolError(error instanceof Error ? error.message : 'OAuth callback failed');
        setIsAuthenticating(false);
      }
    };

    const handleOAuthError = (event: any, data: { error: string; error_description?: string }) => {
      console.error('[OAuth] Error:', data);
      setToolError(data.error_description || data.error);
      setIsAuthenticating(false);

      // Clean up
      const pendingServer = sessionStorage.getItem('oauth_pending_server');
      if (pendingServer) {
        sessionStorage.removeItem(`oauth_state_${pendingServer}`);
        sessionStorage.removeItem('oauth_pending_server');
      }
    };

    // Add event listeners using Electron IPC
    if (typeof window !== 'undefined' && (window as any).require) {
      try {
        const { ipcRenderer } = (window as any).require('electron');
        ipcRenderer.on('oauth-callback', handleOAuthCallback);
        ipcRenderer.on('oauth-callback-error', handleOAuthError);
        console.log('[OAuth] Listeners registered successfully');

        // Cleanup
        return () => {
          console.log('[OAuth] Removing OAuth callback listeners...');
          ipcRenderer.removeListener('oauth-callback', handleOAuthCallback);
          ipcRenderer.removeListener('oauth-callback-error', handleOAuthError);
        };
      } catch (error: any) {
        console.error('[OAuth] Failed to set up IPC listeners:', error);
      }
    } else {
      console.warn('[OAuth] Electron IPC not available');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - set up once on mount

  // Load tools when selectedServer changes
  useEffect(() => {
    const fetchTools = async () => {
      if (!selectedServer) {
        setTools([]);
        setToolError(null);
        setNeedsAuthentication(false);
        return;
      }

      // Check if server requires OAuth authentication
      if (selectedServer.authType === 'oauth2' && selectedServer.requiresAuth) {
        // Check if server is already authenticated (has access token)
        console.log('[OAuth] Checking if server is authenticated...');
        try {
          const isExpired = await window.mcpAPI.isTokenExpired(selectedServer.name);
          console.log('[OAuth] Token expired?', isExpired);

          if (isExpired) {
            // Token is expired or doesn't exist - need authentication
            console.log('[OAuth] Server needs authentication');
            setTools([]);
            setToolError(null);
            setNeedsAuthentication(true);
            setLoadingTools(false);
            return;
          } else {
            // Token exists and is valid - proceed to fetch tools
            console.log('[OAuth] Server already authenticated, fetching tools...');
          }
        } catch (error: any) {
          console.error('[OAuth] Error checking token:', error);
          // On error, assume needs authentication
          setTools([]);
          setToolError(null);
          setNeedsAuthentication(true);
          setLoadingTools(false);
          return;
        }
      }

      setNeedsAuthentication(false);
      setLoadingTools(true);
      setToolError(null);
      try {
        const fetchedTools = await window.mcpAPI.fetchTools(selectedServer.name);
        console.log('fetchedTools', fetchedTools);
        setTools(fetchedTools);
      } catch (error: any) {
        setTools([]);
        setToolError(error.message || 'Failed to fetch tools');
        console.error('Error fetching tools:', error);
      } finally {
        setLoadingTools(false);
      }
    };

    fetchTools();
  }, [selectedServer]);

  // Filtered servers by search
  const filteredServers = useMemo(() => {
    if (!search) return servers;
    const normalizedSearch = search.toLowerCase();
    return servers.filter((srv: MCPServer & { category?: string[]; tags?: string[] }) => {
      const description = srv.description?.toLowerCase() ?? '';
      const tagsMatch = srv.tags?.some((tag) => tag.toLowerCase().includes(normalizedSearch));
      const categoriesMatch = srv.category?.some((cat) => cat.toLowerCase().includes(normalizedSearch));

      return (
        srv.name.toLowerCase().includes(normalizedSearch) ||
        description.includes(normalizedSearch) ||
        Boolean(tagsMatch) ||
        Boolean(categoriesMatch)
      );
    });
  }, [servers, search]);
  const refreshServers = async () => {
    const allServers = await window.mcpAPI.loadAllMcpServers();
    setServers(allServers as MCPServer[]);
    if (selectedServer) {
      const updatedSelected = (allServers as MCPServer[]).find((srv) => srv.name === selectedServer.name) ?? null;
      setSelectedServer(updatedSelected);
    }
  };

  const addOrUpdateServer = async (serverConfig: MCPServer) => {
    const normalizedPayload = {
      ...serverConfig,
      url: serverConfig.url,
      category: serverConfig.category?.length ? serverConfig.category : ['custom'],
      tags: serverConfig.tags,
      // API Key authentication
      accessToken: serverConfig.accessToken,
      headerName: serverConfig.headerName,
      // Basic Auth
      basicUsername: serverConfig.basicUsername,
      basicPassword: serverConfig.basicPassword,
      // OAuth fields
      issuer: serverConfig.issuer,
      authorizationEndpoint: serverConfig.authorizationEndpoint,
      tokenEndpoint: serverConfig.tokenEndpoint,
      registrationEndpoint: serverConfig.registrationEndpoint,
      oauthClientId: serverConfig.oauthClientId,
      oauthScope: serverConfig.oauthScope
      // Tokens are persisted by service; UI does not write them.
    };

    console.log(`[MCPServerBrowser] Saving server ${serverConfig.name} with auth type: ${serverConfig.authType}, has accessToken: ${!!serverConfig.accessToken}`);

    await window.mcpAPI.addOrUpdateMcpServer(normalizedPayload);
    await refreshServers();
  };

  const removeServer = async (serverName: string) => {
    try {
      await (window as any).mcpAPI.removeMcpServer(serverName);
    } finally {
      await refreshServers();
    }
  };

  const openManageServers = () => setIsManagingServers(true);
  const closeManageServers = () => setIsManagingServers(false);

  // Handle OAuth authentication
  const handleAuthenticate = async (serverName: string) => {
    setIsAuthenticating(true);
    setToolError(null);

    try {
      // Check if server already has a valid token before initiating OAuth
      const isExpired = await window.mcpAPI.isTokenExpired(serverName);
      if (!isExpired) {
        console.log('[OAuth] Server already has a valid token, skipping OAuth flow');
        setToolError('Server already has a valid access token. No authentication needed.');
        setIsAuthenticating(false);
        // Refresh servers to update UI
        const allServers = await window.mcpAPI.loadAllMcpServers();
        setServers(allServers as MCPServer[]);
        // Try to load tools
        if (selectedServer?.name === serverName) {
          const fetchedTools = await window.mcpAPI.fetchTools(serverName);
          setTools(fetchedTools);
        }
        return;
      }

      // Start OAuth callback server
      console.log('[OAuth] Starting OAuth callback server...');
      const { callbackUrl } = await window.mcpAPI.startOAuthServer();
      console.log('[OAuth] OAuth server started:', callbackUrl);

      // Set the redirect URI in the MCP service
      window.mcpAPI.setOAuthRedirectUri(callbackUrl);

      // Initiate OAuth flow
      const { authUrl, state } = await window.mcpAPI.initiateOAuthFlow(serverName);
      console.log('[OAuth] Authorization URL:', authUrl);

      // Store state for verification
      sessionStorage.setItem(`oauth_state_${serverName}`, state);
      sessionStorage.setItem('oauth_pending_server', serverName);

      // Open OAuth URL in external browser
      console.log('[OAuth] Opening browser for authentication...');
      window.open(authUrl, '_blank');

      setToolError("Please complete authentication in the browser window. The app will detect when you're done.");
    } catch (error: any) {
      console.error('[OAuth] Authentication error:', error);
      setToolError(error instanceof Error ? error.message : 'Authentication failed');
      setIsAuthenticating(false);
    }
  };

  // Create MCP Bridge node using existing callTool method
  const createMcpBridgeNode = async (serverName: string, toolName: string, parameters: any, nodeLabel?: string) => {
    try {
      console.log('parameters from createMcpBridgeNode ========================');
      console.log({ serverName, toolName, parameters });
      // Call the tool with the proper MCP format
      const result = await window.mcpAPI.callTool(serverName, toolName, parameters);

      // Return the result along with node metadata for UI purposes
      return {
        result,
        nodeLabel: nodeLabel || `${serverName}: ${toolName}`,
        serverName,
        toolName
      };
    } catch (error: any) {
      console.error('Error creating MCP Bridge node:', error);
      throw error;
    }
  };

  // Handle tool selection for sidebar display
  const handleToolSelect = (tool: MCPTool) => {
    setSelectedTool(tool);
  };

  // Clear selected tool
  const clearSelectedTool = () => {
    setSelectedTool(null);
  };

  return {
    servers: filteredServers,
    selectedServer,
    setSelectedServer,
    tools,
    loadingTools,
    toolError,
    search,
    setSearch,
    filteredServers,
    createMcpBridgeNode,
    selectedTool,
    handleToolSelect,
    clearSelectedTool,
    refreshServers,
    addOrUpdateServer,
    removeServer,
    isManagingServers,
    openManageServers,
    closeManageServers,
    needsAuthentication,
    isAuthenticating,
    handleAuthenticate
  };
}
