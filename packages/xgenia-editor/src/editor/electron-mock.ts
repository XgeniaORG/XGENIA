// @ts-nocheck
// electron-mock.ts
// Injected into the Vite build or imported at the top-level of the Next.js app 
// when running in a standard browser (like the AI's browser_subagent) to mock 
// the required Electron APIs.

if (typeof window !== 'undefined' && !window.electron && !window.require) {
    console.log('[Electron Mock] Initializing Electron API mocks for browser testing');

    // 1. Mock Node.js require for missing Electron modules
    window.require = function (moduleName) {
        console.log(`[Electron Mock] Intercepted require('${moduleName}')`);

        if (moduleName === 'electron') {
            return {
                ipcRenderer: {
                    send: (channel, ...args) => console.log(`[Electron Mock] ipcRenderer.send('${channel}')`, args),
                    invoke: async (channel, ...args) => {
                        console.log(`[Electron Mock] ipcRenderer.invoke('${channel}')`, args);
                        // Provide sensible defaults for known MCP and Auth channels
                        if (channel === 'mcp:isTokenExpired') return false;
                        if (channel === 'mcp:loadAllMcpServers') return [];
                        return {};
                    },
                    on: (channel, listener) => console.log(`[Electron Mock] ipcRenderer.on('${channel}')`),
                    once: (channel, listener) => console.log(`[Electron Mock] ipcRenderer.once('${channel}')`),
                    removeListener: (channel, listener) => console.log(`[Electron Mock] ipcRenderer.removeListener('${channel}')`),
                }
            };
        }

        // Return a dummy object for other requires
        return {};
    };

    // 2. Mock window.XgeniaEditorAPI
    window.XgeniaEditorAPI = {
        sendMessage: (channel, data) => {
            console.log(`[Electron Mock] XgeniaEditorAPI.sendMessage('${channel}')`, data);
        },
        setResponseHandler: (handler) => {
            console.log(`[Electron Mock] XgeniaEditorAPI.setResponseHandler assigned`);
            window.handleEditorApiResponse = handler;
        }
    };

    // 3. Mock window.mcpAPI
    window.mcpAPI = {
        loadAllMcpServers: async () => [],
        addOrUpdateMcpServer: async () => ({}),
        removeMcpServer: async () => ({}),
        fetchTools: async () => [],
        callTool: async () => ({}),
        isInitialized: () => true,
        onInitialized: (cb) => cb(),
        startOAuthServer: async () => ({}),
        setOAuthRedirectUri: () => { },
        registerOAuthClient: async () => ({}),
        initiateOAuthFlow: async () => ({}),
        handleOAuthCallback: async () => ({}),
        handleMCPOAuthTokens: async () => ({}),
        refreshOAuthToken: async () => ({}),
        isTokenExpired: async () => false,
        onServersChanged: (cb) => { return () => { }; }
    };

    // 4. Mock window.XgeniaEditorInspectorAPI
    window.XgeniaEditorInspectorAPI = {
        setEnabled: (enabled) => console.log(`[Electron Mock] Inspector enabled: ${enabled}`)
    };

    // 5. Mock window.XgeniaEditorHighlightAPI
    window.XgeniaEditorHighlightAPI = {
        selectNode: (nodeId) => console.log(`[Electron Mock] Selected node: ${nodeId}`)
    };
}
