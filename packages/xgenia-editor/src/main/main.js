// Disable console.log globally - must be first!
const DISABLE_CONSOLE_LOGS = true;
if (DISABLE_CONSOLE_LOGS) {
  const noop = () => { };
  console.log = noop;
  console.debug = noop;
  console.info = noop;
  // Keep console.warn and console.error for important messages
}

process.env.DEBUG = 'app:*';
const electron = require('electron');
const { app, dialog } = electron;
const fs = require('fs');
const path = require('path');
const axios = require('axios');
// Ensure fetch is available in the main process (older Electron/Node may lack global fetch)
try {
  if (typeof fetch === 'undefined') {
    const { fetch: undiciFetch, Headers, Request, Response } = require('undici');
    global.fetch = undiciFetch;
    global.Headers = Headers;
    global.Request = Request;
    global.Response = Response;
    console.log('[Main Process] Installed undici fetch polyfill');
  }
} catch (e) {
  console.warn('[Main Process] Unable to polyfill fetch:', e?.message);
}

const AutoUpdater = require('./src/autoupdater');
const FloatingWindow = require('./src/floating-window');
const startServer = require('./src/web-server');
const { startCloudFunctionServer, closeRuntimeWhenWindowCloses } = require('./src/cloud-function-server');
const DesignToolImportServer = require('./src/design-tool-import-server');
const jsonstorage = require('../shared/utils/jsonstorage');
const StorageApi = require('./src/StorageApi');
const { getOAuthServer } = require('./src/oauth-callback-server');

const { handleProjectMerge } = require('./src/merge-driver');

//fixes problem with reloading the viewer when it's
//running in a separate browser window (file:// cross origin warning)
app.commandLine.appendSwitch('disable-site-isolation-trials');

// Add more robust GPU and network flags to prevent crashes
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// NOTE: VaapiVideoDecoder removed — Linux-only, no effect on macOS
// NOTE: VizDisplayCompositor disable removed — it is the ONLY rendering
//       pipeline in Chromium 128+ (Electron 31.x). Disabling it caused
//       multicolored static/noise artifacts across the entire app.
// Preserve symlinks to avoid realpathSync "no access" errors on Windows
// when resolving npm workspace symlinks/junctions in node_modules
app.commandLine.appendSwitch('--preserve-symlinks');
app.commandLine.appendSwitch('--preserve-symlinks-main');

var args = process.argv || [];

function launchApp() {
  console.log('[Main Process] launchApp() called.');

  try {
    console.log('[Main Process] About to destructure electron module...');
    const { Menu, BrowserWindow, ipcMain, shell } = electron;
    console.log('[Main Process] Electron destructuring complete');
    console.log('[Main Process] About to require Config...');
    const Config = require('../shared/config/config');
    console.log('[Main Process] Config required successfully');

    console.log('[Main Process] About to check app.isReady()...');
    const appIsReady = app.isReady();
    console.log('[Main Process] Electron app.isReady():', appIsReady);

    // If app is already ready, call the ready handler immediately
    console.log('[Main Process] Checking if app is ready for immediate execution...');
    if (appIsReady) {
      console.log('[Main Process] App already ready, but will wait for ready event to avoid duplicate window creation');
      // REMOVED: Immediate window creation to prevent duplicate windows
      // The app.on('ready') event handler will create the window properly
    } else {
      console.log('[Main Process] App not ready yet, setting up ready event listener');
    }

    console.log('[Main Process] Continuing with initialization after app.isReady() check...');
    require('@electron/remote/main').initialize();
    console.log('[Main Process] @electron/remote/main initialized');

    const appPath = app.getAppPath();
    console.log('[Main Process] App path:', appPath);

    app.setAsDefaultProtocolClient('xgenia');
    console.log('[Main Process] Set as default protocol client');

    let win;
    // Simple main-process memory profiler state
    let __memprofSession = null;
    let __memprofActive = false;
    async function startMainMemoryProfiling() {
      if (__memprofActive) return { ok: true, already: true };
      try {
        const { Session } = require('inspector');
        __memprofSession = new Session();
        __memprofSession.connect();
        await new Promise((res, rej) =>
          __memprofSession.post('HeapProfiler.enable', {}, (e) => (e ? rej(e) : res(null)))
        );
        await new Promise((res, rej) =>
          __memprofSession.post(
            'HeapProfiler.startSampling',
            {
              samplingInterval: 32768,
              includeObjectsCollectedByGC: true
            },
            (e) => (e ? rej(e) : res(null))
          )
        );
        __memprofActive = true;
        return { ok: true };
      } catch (e) {
        try {
          __memprofSession && __memprofSession.disconnect();
        } catch { }
        __memprofSession = null;
        __memprofActive = false;
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }
    async function stopMainMemoryProfiling(appObj, shellObj) {
      if (!__memprofActive || !__memprofSession) return { ok: true, empty: true };
      try {
        const profile = await new Promise((resolve, reject) => {
          __memprofSession.post('HeapProfiler.stopSampling', (err, params) => {
            if (err) reject(err);
            else resolve(params && params.profile ? params.profile : params);
          });
        });
        try {
          __memprofSession.post('HeapProfiler.disable', () => { });
        } catch { }
        try {
          __memprofSession.disconnect();
        } catch { }
        __memprofSession = null;
        __memprofActive = false;
        const reportsDir = path.join(appObj.getPath('userData'), 'mem-reports');
        try {
          if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
        } catch { }
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(reportsDir, `main-allocation-profile-${ts}.json`);
        fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
        // Quick top allocators summary
        try {
          const nodes = (profile && profile.nodes) || [];
          const map = new Map();
          for (const n of nodes) {
            const f = n.callFrame || {};
            const key = `${f.url || 'eval'}:${f.functionName || '(anonymous)'}:${f.lineNumber || 0}`;
            const size = Number(n.selfSize || 0);
            map.set(key, (map.get(key) || 0) + size);
          }
          const top = Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 25)
            .map(([k, v]) => ({ key: k, bytes: v }));
          const summaryPath = path.join(reportsDir, `main-allocation-top-${ts}.json`);
          fs.writeFileSync(summaryPath, JSON.stringify({ createdAt: ts, top }, null, 2), 'utf8');
        } catch { }
        return { ok: true, filePath };
      } catch (e) {
        try {
          __memprofSession && __memprofSession.disconnect();
        } catch { }
        __memprofSession = null;
        __memprofActive = false;
        return { ok: false, error: String(e && e.message ? e.message : e) };
      }
    }

    console.log('[Main Process] Requesting single instance lock...');
    const gotTheLock = app.requestSingleInstanceLock();
    console.log('[Main Process] Got single instance lock:', gotTheLock);

    if (!gotTheLock) {
      console.log(`
-------------------------------
   XGENIA is already running.   
-------------------------------

`);
      app.quit();
      return;
    } else {
      // Someone tried to run a second instance, we should focus our window.
      app.on('second-instance', (event, argv, workingDirectory) => {
        console.log('[Main Process] Second instance detected');
        if (win) {
          console.log('[Main Process] Focusing existing window');
          if (win.isMinimized()) win.restore();
          win.focus();
          win.show(); // Ensure window is visible

          console.log('second-instance', event, argv);

          var args = argv || [];
          for (var i = 0; i < args.length; i++) {
            if (args[i].indexOf('xgenia:') === 0) {
              process.env.xgeniaURI = args[i];
              win.webContents.send('open-xgenia-uri', args[i]);
            }
          }
        } else {
          console.log('[Main Process] No existing window found to focus');
        }
      });
    }

    //chech if local docs are running
    //If they are running, use those instead of xgenia docs domain
    const version = app.getVersion().split('.').slice(0, 2).join('.');
    require('http')
      .get(`http://127.0.0.1:3000/${version}/version.json`, (res) => {
        if (res.statusCode !== 200) {
          global.useLocalDocs = false;
          return;
        }

        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          try {
            // Check if the JSON have:
            // > "kind": "xgenia-docs"
            const json = JSON.parse(rawData);
            global.useLocalDocs = json.kind === 'xgenia-docs';

            if (global.useLocalDocs) {
              console.log('> Using local docs');
            }
          } catch (e) {
            console.error(e.message);
            global.useLocalDocs = false;
          }
        });
      })
      .on('error', () => {
        global.useLocalDocs = false;
      });

    const viewerWindow = new FloatingWindow();

    // Try to use shared MCP service from the dedicated package (guarded ESM/CJS interop)
    let mcpService = null;
    try {
      // Some dependencies of @xgenia/mcp are ESM-only; avoid crashing main by lazily requiring
      // and falling back to renderer-side service when unavailable in main.
      const mod = require('@xgenia/mcp');
      mcpService = mod.sharedMCPService;
      console.log('[Main Process] Using dedicated MCP service in main');
    } catch (e) {
      console.warn(
        '[Main Process] MCP service not available in main process. Renderer/preload will handle MCP.',
        e && e.message
      );
    }
    //const messageTrackerWindow = new FloatingWindow();

    function guid() {
      function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
          .toString(16)
          .substring(1);
      }
      return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
    }

    const _editorAPICallbacks = {};

    function makeEditorAPIRequest(api, args, callback) {
      const t = guid();
      _editorAPICallbacks[t] = (r) => {
        callback(r.response);
      };
      if (win && win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send('editor-api-request', { api: api, token: t, args: args });
      }
    }

    ipcMain.on('editor-api-response', function (event, args) {
      const token = args.token;

      if (!_editorAPICallbacks[token]) return;
      _editorAPICallbacks[token](args);
      delete _editorAPICallbacks[token];
    });

    ipcMain.handle('image-editor:write-file', async (event, { filePath, dataBase64 }) => {
      const fs = require('fs');
      await fs.promises.writeFile(filePath, Buffer.from(dataBase64, 'base64'));
      return { ok: true };
    });

    ipcMain.handle('image-editor:open-file', async (event) => {
      const { dialog, ipcMain } = require('electron');
      const fs = require('fs');
      const path = require('path');

      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }
        ]
      });

      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }

      const filePath = result.filePaths[0];
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().substring(1);
      const mimeType = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
      const dataBase64 = buffer.toString('base64');

      return {
        data: `data:${mimeType};base64,${dataBase64}`,
        filename: path.basename(filePath)
      };
    });


    // Only register MCP IPC fallbacks if the main process MCP service is available.
    if (mcpService) {
      // Ensure persistence and token load (non-blocking)
      mcpService.initialize && mcpService.initialize().catch(() => { });
      // Broadcast server changes to renderer
      try {
        mcpService.onServersChanged(() => {
          if (win && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('mcp:serversChanged');
          }
        });
      } catch { }

      // Handler for loading all MCP servers
      ipcMain.handle('mcp:loadAllMcpServers', (event) => {
        const servers = mcpService.loadAllMcpServers();
        return servers.map((server) => ({
          name: server.name,
          description: server.description,
          category: server.category,
          url: server.url ? server.url.toString() : undefined,
          connectionType: server.connectionType,
          requiresAuth: server.requiresAuth,
          authType: server.authType,
          source: server.source,
          // OAuth configuration and tokens
          oauthClientId: server.oauthClientId,
          oauthScope: server.oauthScope,
          issuer: server.issuer,
          authorizationEndpoint: server.authorizationEndpoint,
          tokenEndpoint: server.tokenEndpoint,
          registrationEndpoint: server.registrationEndpoint,
          accessToken: server.accessToken,
          refreshToken: server.refreshToken,
          tokenExpiresAt: server.tokenExpiresAt
          // Do NOT include initialize, fetchTools, callTool, or any methods
        }));
      });

      ipcMain.handle('mcp:addOrUpdateServer', (event, serverConfig) => {
        const normalized = mcpService.addOrUpdateServer(serverConfig);
        return {
          ...normalized,
          url: normalized.url?.toString()
        };
      });

      ipcMain.handle('mcp:fetchTools', async (event, serverName) => {
        const tools = await mcpService.getTools(serverName);
        return tools;
      });

      ipcMain.handle('mcp:callTool', async (event, serverName, toolName, inputSchema) => {
        const result = await mcpService.callTool(serverName, toolName, inputSchema);
        if (!result) throw new Error('Server not found');
        return result;
      });

      ipcMain.handle('mcp:removeServer', async (event, serverName) => {
        return mcpService.removeServer(serverName);
      });
    }

    // OAuth handlers
    ipcMain.handle('mcp:startOAuthServer', async (event) => {
      const oauthServer = getOAuthServer();
      const port = await oauthServer.start((data) => {
        // Forward OAuth callback to renderer
        console.log('[OAuth] Callback received in main process:', data);
        console.log('[OAuth] win exists:', !!win);
        console.log('[OAuth] win.webContents exists:', win && !!win.webContents);

        if (win && win.webContents && !win.webContents.isDestroyed()) {
          console.log('[OAuth] Sending callback to renderer...');
          if (data.error) {
            win.webContents.send('oauth-callback-error', data);
            console.log('[OAuth] Error sent to renderer');
          } else {
            win.webContents.send('oauth-callback', data);
            console.log('[OAuth] Success data sent to renderer');
          }
        } else {
          console.error('[OAuth] Cannot send to renderer - window not available');
        }
      });
      return { port, callbackUrl: oauthServer.getCallbackUrl() };
    });

    ipcMain.handle('mcp:registerOAuthClient', async (event, serverName) => {
      return await mcpService.registerOAuthClient(serverName);
    });

    ipcMain.handle('mcp:initiateOAuthFlow', async (event, serverName) => {
      return await mcpService.initiateOAuthFlow(serverName);
    });

    ipcMain.handle('mcp:handleOAuthCallback', async (event, serverName, code, state, expectedState) => {
      return await mcpService.handleOAuthCallback(serverName, code, state, expectedState);
    });

    ipcMain.handle('mcp:handleMCPOAuthTokens', async (event, serverName, tokens) => {
      return await mcpService.handleMCPOAuthTokens(serverName, tokens);
    });

    ipcMain.handle('mcp:refreshOAuthToken', async (event, serverName) => {
      return await mcpService.refreshOAuthToken(serverName);
    });

    ipcMain.handle('mcp:isTokenExpired', async (event, serverName) => {
      return mcpService.isTokenExpired(serverName);
    });

    // Handler for verifying Anthropic API Key (using handle/invoke)
    ipcMain.handle('verify-anthropic-key', async (event, { apiKey, model }) => {
      console.log(`[Main Process] Handling IPC invoke 'verify-anthropic-key'`);

      // Simplified check for now - Restore axios logic later
      if (!apiKey) {
        console.warn('[Main Process] No API key provided for verification.');
        return false; // Return false if no key
      }

      console.log('[Main Process] Returning hardcoded true for verification test.');
      return true; // Hardcoded success for testing IPC
    });

    // Handler for verifying OpenRouter API Key
    ipcMain.handle('verify-openrouter-key', async (event, { apiKey }) => {
      console.log(`[Main Process] Handling IPC invoke 'verify-openrouter-key'`);
      if (!apiKey) {
        console.warn('[Main Process] No OpenRouter API key provided for verification.');
        return false;
      }
      try {
        const response = await axios.get('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000
        });
        console.log('[Main Process] OpenRouter verification status:', response.status);
        return response.status === 200; // Check for successful status
      } catch (error) {
        if (axios.isAxiosError(error)) {
          console.error(
            '[Main Process] OpenRouter verification failed (Axios):',
            error.response?.status,
            error.response?.data?.error?.message
          );
        } else {
          console.error('[Main Process] OpenRouter verification failed (Unknown):', error);
        }
        return false;
      }
    });
    console.log('[Main Process] IPC handler for verify-openrouter-key registered.');

    // Handler for verifying Firecrawl API Key
    ipcMain.handle('verify-firecrawl-key', async (event, { apiKey }) => {
      console.log(`[Main Process] Handling IPC invoke 'verify-firecrawl-key'`);
      if (!apiKey) {
        console.warn('[Main Process] No Firecrawl API key provided for verification.');
        return false;
      }
      try {
        // Use the scrape endpoint with a non-existent or dummy URL for verification
        const response = await axios.post(
          'https://api.firecrawl.dev/v0/scrape',
          { url: 'https://example.com/verifying', pageOptions: { onlyMainContent: true } },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000 // Slightly longer timeout for potential scrape
          }
        );
        console.log('[Main Process] Firecrawl verification status:', response.status);
        // Firecrawl might return 200 even with scrape errors if key is valid,
        // or 401/403 if key is invalid. So 200 is a good sign.
        // A more specific check might involve looking at response data if needed.
        return response.status === 200;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          // A 401/403 is a definite key failure. Other errors might be network/scrape related.
          console.error(
            '[Main Process] Firecrawl verification failed (Axios):',
            error.response?.status,
            error.response?.data?.error
          );
          if (error.response?.status === 401 || error.response?.status === 403) {
            return false; // Explicitly fail on auth errors
          }
          // For other errors (like timeout or scrape issues), we might treat the key as potentially valid?
          // Or just return false for any error during verification.
          // Let's return false for simplicity.
          return false;
        } else {
          console.error('[Main Process] Firecrawl verification failed (Unknown):', error);
          return false;
        }
      }
    });
    console.log('[Main Process] IPC handler for verify-firecrawl-key registered.');

    // Handler for verifying OpenAI API Key
    ipcMain.handle('verify-openai-key', async (event, { apiKey }) => {
      console.log(`[Main Process] Handling IPC invoke 'verify-openai-key'`);
      if (!apiKey) {
        console.warn('[Main Process] No OpenAI API key provided for verification.');
        return false;
      }
      try {
        // Simple call to list models using the key
        const response = await axios.get('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 10000
        });
        console.log('[Main Process] OpenAI verification status:', response.status);
        // OpenAI API typically returns 200 on success
        return response.status === 200;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          // 401 usually means invalid key for OpenAI
          console.error(
            '[Main Process] OpenAI verification failed (Axios):',
            error.response?.status,
            error.response?.data?.error?.message
          );
        } else {
          console.error('[Main Process] OpenAI verification failed (Unknown):', error);
        }
        return false;
      }
    });
    console.log('[Main Process] IPC handler for verify-openai-key registered.');

    console.log('[Main Process] IPC handler for verify-anthropic-key registered.');

    // Placeholder handler for 'read-tools-project'
    ipcMain.handle('read-tools-project', async (event, ...args) => {
      console.log(`[Main Process] IPC 'read-tools-project' invoked with args:`, args);
      // TODO: Implement actual logic for reading tools project
      // For now, return a dummy response or an error structure
      // to prevent the "No handler registered" error.
      // Example: return { success: true, data: {} };
      // Example: return Promise.reject(new Error("read-tools-project not implemented yet"));
      console.warn("[Main Process] 'read-tools-project' handler is a placeholder.");
      return { message: "Handler for 'read-tools-project' is a placeholder." };
    });
    console.log("[Main Process] IPC handler for 'read-tools-project' registered (placeholder).");

    function projectGetSettings(callback) {
      makeEditorAPIRequest('projectGetSettings', undefined, callback);
    }

    function projectGetInfo(callback) {
      makeEditorAPIRequest('projectGetInfo', undefined, callback);
    }

    function projectGetComponentBundleExport(name, callback) {
      makeEditorAPIRequest('projectGetComponentBundleExport', { name }, callback);
    }

    function cloudServicesGetActive(callback) {
      makeEditorAPIRequest('cloudServicesGetActive', undefined, callback);
    }

    process.env.exePath = app.getPath('exe');
    let reopenWindow = false;

    function createWindow() {
      console.log('[Main Process] *** ENTERING createWindow() function ***');
      // Check if preload script exists before using it
      let preloadPath = path.join(appPath, 'src/editor/preload.js');
      let preloadExists = false;

      try {
        if (fs.existsSync(preloadPath)) {
          console.log('[Main Process] Preload script exists at:', preloadPath);
          preloadExists = true;
        } else {
          console.error('[Main Process] Preload script NOT FOUND at:', preloadPath);
          // Try alternative paths
          const altPaths = [
            path.join(appPath, '../../../preload.js'), // Root preload.js
            path.join(appPath, 'preload.js'),
            path.resolve(__dirname, '../../../preload.js')
          ];

          for (const altPath of altPaths) {
            if (fs.existsSync(altPath)) {
              console.log('[Main Process] Found preload script at alternative path:', altPath);
              preloadPath = altPath;
              preloadExists = true;
              break;
            }
          }

          if (!preloadExists) {
            console.warn('[Main Process] No preload script found, continuing without preload');
          }
        }
      } catch (err) {
        console.error('[Main Process] Error checking preload script:', err);
        preloadExists = false;
      }

      // Configure webPreferences with conditional preload
      const webPreferences = {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false, // Required for nodeIntegration; explicit to prevent future Electron defaults
        webviewTag: true,
        webSecurity: false, // Disabling webSecurity to allow any connections
        // Always include preload script if it exists (needed in both dev and production)
        ...(preloadExists ? { preload: preloadPath } : {})
      };

      console.log('[Main Process] Creating BrowserWindow with webPreferences:', webPreferences);

      try {
        win = new BrowserWindow({
          width: 1368,
          height: 900,
          acceptFirstMouse: true,
          backgroundColor: '#272625',
          center: true,
          frame: false,
          minWidth: 600,
          minHeight: 300,
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 12, y: 12 },
          icon: path.join(appPath, 'src/assets/images/icon.png'),
          webPreferences,
          show: false
        });
        console.log('[Main Process] BrowserWindow created successfully');
        console.log('[Main Process] Window ID:', win.id);
        console.log('[Main Process] Window webContents ID:', win.webContents.id);
      } catch (error) {
        console.error('[Main Process] CRITICAL ERROR creating BrowserWindow:', error);
        throw error;
      }

      require('@electron/remote/main').enable(win.webContents);

      // Register main-process memory profiling IPC once window is ready
      try {
        if (!ipcMain._memprofHandlersInstalled) {
          ipcMain._memprofHandlersInstalled = true;
          ipcMain.handle('memprof:start', async () => startMainMemoryProfiling());
          ipcMain.handle('memprof:stop', async () => stopMainMemoryProfiling(app, shell));

          ipcMain.handle('memprof:reveal', async () => {
            const dir = path.join(app.getPath('userData'), 'mem-reports');
            try {
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            } catch { }
            try {
              shell.openPath(dir);
            } catch { }
            return { ok: true, dir };
          });
        }
      } catch (e) {
        console.warn('[Main Process] Failed to install memprof handlers:', e && e.message ? e.message : e);
      }

      // Strip frame-ancestors and X-Frame-Options from responses so the
      // Vercel-hosted chat panel can be iframed from Electron's file://
      // (or custom) scheme.
      // The wildcard '*' in frame-ancestors only covers network schemes,
      // so Electron's non-network origin gets blocked without this.
      // X-Frame-Options must also be removed because Windows Electron
      // enforces it more strictly than macOS/Linux, causing the chat
      // iframe to fail with SAMEORIGIN or DENY on Windows.
      win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const headers = details.responseHeaders;
        if (headers) {
          // Strip CSP frame-ancestors directives
          const cspKeys = Object.keys(headers).filter(
            k => k.toLowerCase() === 'content-security-policy' || k.toLowerCase() === 'content-security-policy-report-only'
          );
          for (const key of cspKeys) {
            headers[key] = headers[key].map(val =>
              val.replace(/frame-ancestors\s+[^;]+(;|$)/gi, '')
            );
          }
          // Strip X-Frame-Options headers (blocks iframe on Windows file://)
          const xfoKeys = Object.keys(headers).filter(
            k => k.toLowerCase() === 'x-frame-options'
          );
          for (const key of xfoKeys) {
            delete headers[key];
          }
        }
        callback({ responseHeaders: headers });
      });

      win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
        callback(true);
      });

      if (Config.enableAutoUpdate) {
        AutoUpdater.setupAutoUpdate(win);
      }

      // Load the main HTML file with enhanced debugging
      const indexPath = Config.devMode
        ? 'http://localhost:8080/src/editor/index.html'
        : 'file:///' + appPath + '/src/editor/index.html';
      console.log('[Main Process] Attempting to load URL:', indexPath);

      if (Config.devMode) {
        // In dev mode, load directly from webpack dev server
        console.log('[Main Process] Loading from webpack dev server in dev mode...');
        win.loadURL(indexPath, {
          extraHeaders: 'pragma: no-cache\nCache-Control: no-cache'
        });
      } else {
        // In production mode, check if the HTML file exists before trying to load it
        const htmlFilePath = path.join(appPath, 'src/editor/index.html');
        console.log('[Main Process] Checking if HTML file exists at:', htmlFilePath);

        if (fs.existsSync(htmlFilePath)) {
          console.log('[Main Process] HTML file exists, proceeding with load...');
          win.loadURL(indexPath, {
            extraHeaders: 'pragma: no-cache\nCache-Control: no-cache'
          });
        } else {
          console.error('[Main Process] HTML file NOT FOUND at expected path!');
          console.log('[Main Process] App path is:', appPath);
          // Try to find the HTML file in alternate locations
          const altPaths = [
            path.join(appPath, 'index.html'),
            path.join(appPath, '../../../packages/xgenia-editor/src/editor/index.html')
          ];

          for (const altPath of altPaths) {
            if (fs.existsSync(altPath)) {
              console.log('[Main Process] Found HTML file at alternative path:', altPath);
              const altUrl = 'file:///' + altPath.replace(/\\/g, '/');
              win.loadURL(altUrl, {
                extraHeaders: 'pragma: no-cache\nCache-Control: no-cache'
              });
              break;
            }
          }
        }
      }

      // Make sure <a href target="_blank"> and window.open opens in external browser
      win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' }; //deny a new electron window
      });

      win.webContents.on('did-finish-load', () => {
        // No longer clearing cache or reloading to avoid infinite reload loop
        console.log('[Main Process] Page loaded successfully');
      });

      win.webContents.on('dom-ready', () => {
        console.log('[Main Process] DOM ready event fired');
      });

      win.webContents.on('did-start-loading', () => {
        console.log('[Main Process] Page started loading');
      });

      win.webContents.on('did-stop-loading', () => {
        console.log('[Main Process] Page stopped loading');
      });

      // Add error handling for preload script issues and black screen prevention
      win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error(`[Main Process] Failed to load URL: ${validatedURL}. Error ${errorCode}: ${errorDescription}`);

        // If it's a critical error that causes black screen, try to reload once
        if (errorCode === -105 || errorCode === -103) {
          // ERR_NAME_NOT_RESOLVED or ERR_CONNECTION_ABORTED
          console.log('[Main Process] Critical error detected, attempting recovery reload');
          setTimeout(() => {
            if (win && !win.isDestroyed()) {
              win.reload();
            }
          }, 2000);
        }
      });

      win.webContents.on('crashed', (event, killed) => {
        console.error('[Main Process] WebContents crashed. Killed:', killed);
      });

      win.webContents.on('unresponsive', () => {
        console.error('[Main Process] WebContents became unresponsive');
      });

      win.webContents.on('console-message', (event, level, message, line, sourceId) => {
        if (message.includes('[Preload]')) {
          console.log(`[Main Process] Preload log: ${message}`);
        }

        // Detect hot reload related errors
        if (message.includes('module hot update') || message.includes('Cannot read properties of undefined')) {
          console.warn('[Main Process] Hot reload related error detected:', message);
        }
      });

      // Enhanced debugging for window visibility
      console.log('[Main Process] Attempting to show window...');
      console.log('[Main Process] Window bounds:', win.getBounds());
      console.log('[Main Process] Window isVisible():', win.isVisible());
      console.log('[Main Process] Window isMinimized():', win.isMinimized());

      // Force window to be visible and focused
      win.show();
      win.focus();
      win.moveTop();

      console.log('[Main Process] After show - isVisible():', win.isVisible());
      console.log('[Main Process] After show - isMinimized():', win.isMinimized());
      console.log('[Main Process] After show - isFocused():', win.isFocused());

      win.once('ready-to-show', () => {
        console.log('[Main Process] ready-to-show event fired (after manual show)');
      });

      win.on('closed', () => {
        win = null;
        clearTimeout(saveWindowSettingsTimeout);
        if (reopenWindow) {
          reopenWindow = false;
          createWindow();
          closeRuntimeWhenWindowCloses(win);
        }
      });

      win.webContents.on('render-process-gone', (event, details) => {
        if (details.reason === 'crashed') {
          console.log('Editor window process crashed');
          closeViewer();

          dialog.showMessageBoxSync({
            message: 'Oh No! XGENIA has crashed :( Click OK to restart',
            type: 'error'
          });

          win.close();
          win = null;
          reopenWindow = true;
        }
      });

      process.env.xgeniaURI && win.webContents.send('open-xgenia-uri', process.env.xgeniaURI);

      DesignToolImportServer.setWindow(win);
      StorageApi.setup(win);
    }

    function closeViewer() {
      if (!viewerWindow.isOpen()) {
        return;
      }

      viewerWindow.close();
      win && win.webContents.send('viewer-closed');
    }

    function openViewer(sender, eventArgs) {
      if (viewerWindow.isOpen()) {
        return;
      }

      const parentBounds = win.getBounds();

      // TODO: There seems to be an issue with Electron that it doesn't respect
      //       the minWidth,minHeight on multi monitor screens.
      const minWidth = 320;
      const minHeight = 568;

      const height = Math.max(minHeight, parentBounds.height - 200);
      const width = Math.max(minWidth, Math.floor(((height - 37) * 9) / 16));

      const viewerUrl = Config.devMode
        ? 'http://localhost:8080/src/frames/viewer-frame/index.html'
        : 'file:///' + appPath + '/src/frames/viewer-frame/index.html';

      viewerWindow.open({
        x: parentBounds.width - width - 50,
        y: 80,
        parent: win,
        width,
        height,
        minWidth,
        minHeight,
        url: viewerUrl,
        alwaysShadow: true
      });

      viewerWindow.window.webContents.once('did-finish-load', () => {
        viewerWindow.send('viewer-cookies', eventArgs.cookies);

        if (eventArgs.zoomFactor) {
          viewerWindow.send('viewer-set-zoom-factor', eventArgs.zoomFactor);
        }

        if (eventArgs.route) {
          viewerWindow.send('viewer-set-route', eventArgs.route);
        }

        if (eventArgs.viewportSize) {
          viewerWindow.send('viewer-set-viewport-size', eventArgs.viewportSize);
        }

        viewerWindow.send('viewer-set-inspect-mode', eventArgs.inspectMode);
        viewerWindow.send('viewer-select-node', eventArgs.selectedNodeId);
      });

      viewerWindow.openDevTools();
    }

    var floatingWindows = {};
    function closeFloatingWindow(options) {
      if (!floatingWindows[options.id]) return;

      floatingWindows[options.id].close();
      if (options.sendCloseEvent) {
        win && win.webContents.send('floating-window-closed', { id: options.id });
      }
    }

    function openFloatingWindow(options) {
      if (!floatingWindows[options.id]) floatingWindows[options.id] = new FloatingWindow();
      const floatingWindow = floatingWindows[options.id];

      const parentBounds = win.getBounds();

      const width = options.width || 800;
      const height = options.height || 600;

      floatingWindow.open({
        x: parentBounds.width - width - 50,
        y: 80,
        width,
        height,
        parent: win,
        minWidth: options.minWidth || 120,
        minHeight: options.minHeight || 175,
        url: options.url.replace('{{appPath}}', appPath)
      });

      // floatingWindow.openDevTools();

      floatingWindow.window.webContents.once('did-finish-load', () => {
        floatingWindow.send('floating-window-options', options.id, options.options);
      });

      floatingWindow.forwardIpcEvents(['editor-api-response']);

      return floatingWindow;
    }

    let saveWindowSettingsTimeout;
    function onMainWindowBoundsChanged() {
      clearTimeout(saveWindowSettingsTimeout);
      saveWindowSettingsTimeout = setTimeout(() => {
        win && jsonstorage.set('windowBounds', win.getBounds());
      }, 1000);
    }

    function resizeMainWindow(options) {
      win.off('resize', onMainWindowBoundsChanged);
      win.off('move', onMainWindowBoundsChanged);

      if (options.size === 'editor') {
        jsonstorage.get('windowBounds', (bounds) => {
          win.setResizable(true);
          win.setMaximizable(true);
          win.setMinimizable(true);

          // We cannot require the screen module until the app is ready.
          const { screen } = require('electron');
          const primaryDisplay = screen.getPrimaryDisplay();

          if (
            bounds &&
            bounds.width &&
            bounds.height &&
            bounds.x + bounds.width < primaryDisplay.workAreaSize.width &&
            bounds.y + bounds.height < primaryDisplay.workAreaSize.height
          ) {
            win.setPosition(bounds.x, bounds.y);
            win.setSize(bounds.width, bounds.height);
          } else {
            win.setSize(1368, 900);
            if (options.center) win.center();
          }

          win.on('move', onMainWindowBoundsChanged);
          win.on('resize', onMainWindowBoundsChanged);
        });
      }
    }

    const buildNumber = JSON.parse(fs.readFileSync(appPath + '/package.json')).buildNumber;

    let submenu = [
      {
        label: 'About Application',
        click: () => {
          require('about-window').default({
            icon_path: appPath + '/src/assets/images/icon.png',
            copyright: 'Copyright (c) 2024 XGENIA LLC',
            description: buildNumber ? 'Build ' + buildNumber : undefined
          });
        }
      },
      { type: 'separator' }
    ];

    if (process.platform === 'darwin') {
      submenu = submenu.concat([{ role: 'hide' }, { role: 'hideothers' }, { role: 'unhide' }, { type: 'separator' }]);
    }

    submenu.push({
      label: 'Quit',
      accelerator: 'Command+Q',
      click: function () {
        closeViewer();
        app.quit();
      }
    });

    function setupMenu() {
      var template = [
        {
          label: 'Application',
          submenu: submenu
        },
        {
          label: 'Edit',
          submenu: [
            { label: 'Undo', accelerator: 'CmdOrCtrl+Z', selector: 'undo:' },
            { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', selector: 'redo:' },
            { type: 'separator' },
            { label: 'Cut', accelerator: 'CmdOrCtrl+X', selector: 'cut:' },
            { label: 'Copy', accelerator: 'CmdOrCtrl+C', selector: 'copy:' },
            { label: 'Paste', accelerator: 'CmdOrCtrl+V', selector: 'paste:' },
            { label: 'Select All', accelerator: 'CmdOrCtrl+A', selector: 'selectAll:' }
          ]
        }
      ];

      // if(Config.devMode) {
      template.push({
        label: 'Dev',
        submenu: [
          {
            label: 'Open Editor Devtools',
            accelerator: 'CmdOrCtrl+E',
            click: () => {
              if (!win) {
                return;
              }

              if (win.isDevToolsOpened()) {
                win.closeDevTools();
              }

              win.openDevTools();
            }
          },
          { type: 'separator' },
          {
            label: 'Start Main Memory Profiling',
            click: async () => {
              await startMainMemoryProfiling();
            }
          },
          {
            label: 'Stop Main Memory Profiling',
            click: async () => {
              await stopMainMemoryProfiling(app, shell);
            }
          },
          {
            label: 'Reveal Memory Reports Folder',
            click: async () => {
              try {
                const dir = path.join(app.getPath('userData'), 'mem-reports');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                shell.openPath(dir);
              } catch { }
            }
          },
          { type: 'separator' },
          {
            label: 'Toggle Memory Panel (Renderer)',
            accelerator: 'CmdOrCtrl+Alt+M',
            click: () => {
              try {
                win && win.webContents && win.webContents.send('mempanel:toggle');
              } catch { }
            }
          }
        ]
      });
      // }

      // AI menu
      template.push({
        label: 'AI',
        submenu: [
          {
            label: 'AI Settings',
            accelerator: 'CmdOrCtrl+Shift+,',
            click: () => {
              try {
                win && win.webContents && win.webContents.send('menu:open-ai-settings');
              } catch { }
            }
          },
          {
            label: 'New Conversation',
            accelerator: 'CmdOrCtrl+Shift+N',
            click: () => {
              try {
                win && win.webContents && win.webContents.send('menu:new-conversation');
              } catch { }
            }
          }
        ]
      });

      // Help menu
      template.push({
        label: 'Help',
        submenu: [
          {
            label: 'XGENIA Documentation',
            click: () => {
              shell.openExternal('https://docsapp.xgenia.com/');
            }
          },
          { type: 'separator' },
          {
            label: 'Report Issue',
            click: () => {
              try {
                win && win.webContents && win.webContents.send('menu:open-feedback');
              } catch { }
            }
          }
        ]
      });

      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    }

    function forwardIpcEventsToEditorWindow(events) {
      for (const eventName of events) {
        ipcMain.on(eventName, (e, ...args) => {
          console.log(
            `[Main Process] Forwarding IPC event '${eventName}' to editor window. Args count: ${args.length}`
          );
          if (eventName === 'viewer-capture-thumb-reply' && args[0]) {
            console.log(
              `[Main Process] viewer-capture-thumb-reply data (first 50 chars): ${String(args[0]).substring(0, 50)}`
            );
          }
          win && win.webContents.send(eventName, ...args);
        });
      }
    }

    function setupAskForMediaAccessIpc() {
      const { systemPreferences } = require('electron');

      ipcMain.on('request-media-access', function (event, mediaTypes) {
        console.log('Requesting media access ' + mediaTypes);

        //MacOS is the only platform with this API. For Windows we can just return true.
        if (systemPreferences.askForMediaAccess) {
          let promises = [];
          if (mediaTypes.indexOf('video') !== -1) promises.push(systemPreferences.askForMediaAccess('camera'));
          if (mediaTypes.indexOf('audio') !== -1) promises.push(systemPreferences.askForMediaAccess('microphone'));

          Promise.all(promises)
            .then((results) => {
              let isAllowed = true;
              results.forEach(function (r) {
                isAllowed = isAllowed && r;
              });
              event.reply('request-media-access-reply', isAllowed);
            })
            .catch((error) => {
              event.reply('request-media-access-reply', false);
            });
        } else {
          event.reply('request-media-access-reply', true);
        }
      });
    }

    function setupViewerIpc() {
      // Using a timer to hackily prevent
      // the viewer from flashing when subjected
      // to consecutive hide+show after another
      let showTimer;

      ipcMain.on('viewer-attach', () => {
        closeViewer();
      });

      // EMERGENCY FIX: Add emergency recovery handler
      ipcMain.on('emergency-reset-viewer', () => {
        console.log('[Main Process] EMERGENCY RESET: Force closing viewer and resetting state');
        try {
          if (viewerWindow && viewerWindow.isOpen()) {
            viewerWindow.close();
          }
          // Clear any pending timers
          clearTimeout(showTimer);
          // Send reset signal to main window
          win && win.webContents.send('viewer-emergency-reset');
        } catch (error) {
          console.error('[Main Process] Error during emergency reset:', error);
        }
      });

      ipcMain.on('viewer-show', () => {
        showTimer = setTimeout(() => {
          viewerWindow.show();
          win && win.focus();
        }, 10);
      });

      ipcMain.on('viewer-hide', () => {
        if (viewerWindow.dockedInParent) {
          clearTimeout(showTimer);
          viewerWindow.hide();
          win && win.focus();
        }
      });

      ipcMain.on('viewer-detach', openViewer);
      ipcMain.on('project-closed', closeViewer);

      forwardIpcEventsToEditorWindow([
        'viewer-refreshed',
        'viewer-attach',
        'viewer-detach',
        'viewer-navigation-state',
        'viewer-capture-thumb-reply',
        'viewer-inspect-node',
        'inspector-select-node'
      ]);

      // Handle screenshot capture response from floating viewer
      ipcMain.on('screenshot-captured-in-viewer', (e, imageData) => {
        console.log('[Main Process] Received screenshot-captured-in-viewer, forwarding as viewer-capture-thumb-reply');
        console.log('[Main Process] Image data length:', imageData ? imageData.length : 'null');
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('viewer-capture-thumb-reply', imageData);
        } else {
          console.warn('[Main Process] Cannot forward screenshot - main window not available');
        }
      });

      //events to forward from main window to viewer
      viewerWindow.forwardIpcEvents([
        'viewer-open-devtools',
        'viewer-refresh',
        'viewer-focus',
        'viewer-inspect',
        'viewer-inspect-selected',
        'viewer-set-zoom-factor',
        'viewer-navigate-forward',
        'viewer-navigate-back',
        'viewer-set-route',
        'viewer-set-viewport-size',
        'viewer-set-inspect-mode',
        'viewer-select-node',
        // 'viewer-capture-thumb', // Let's handle this more specifically for embedded webview vs floating
        'viewer-show-inspect-menu',
        'editor-api-response'
      ]);

      // Specific handler for 'viewer-capture-thumb' to decide target
      ipcMain.on('viewer-capture-thumb', (e, ...args) => {
        console.log('[Main Process] 📸 Received viewer-capture-thumb on ipcMain from renderer, args:', args);
        // Option 1: If a floating viewer window is open and active, send it there.
        if (
          viewerWindow.isOpen() &&
          viewerWindow.window &&
          viewerWindow.window.webContents &&
          !viewerWindow.window.webContents.isDestroyed()
        ) {
          console.log('[Main Process] Forwarding viewer-capture-thumb to FLOATING viewerWindow.');
          viewerWindow.window.webContents.send('viewer-capture-thumb', ...args);
        }
        // Option 2: Also (or instead) send a message to the main editor window,
        // which can then decide to trigger its embedded webview.
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          console.log('[Main Process] Sending embedded-viewer-capture-request to MAIN editor window.');
          win.webContents.send('embedded-viewer-capture-request', ...args);
        } else {
          console.warn(
            '[Main Process] Main editor window (win) not available to send embedded-viewer-capture-request.'
          );
        }
      });

      // Specific handler for 'viewer-capture-fullpage' (scroll-and-stitch)
      ipcMain.on('viewer-capture-fullpage', (e, ...args) => {
        console.log('[Main Process] 📸 Received viewer-capture-fullpage on ipcMain from renderer');
        if (
          viewerWindow.isOpen() &&
          viewerWindow.window &&
          viewerWindow.window.webContents &&
          !viewerWindow.window.webContents.isDestroyed()
        ) {
          console.log('[Main Process] Forwarding viewer-capture-fullpage to FLOATING viewerWindow.');
          viewerWindow.window.webContents.send('viewer-capture-fullpage', ...args);
        }
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          console.log('[Main Process] Sending embedded-viewer-capture-fullpage-request to MAIN editor window.');
          win.webContents.send('embedded-viewer-capture-fullpage-request', ...args);
        }
      });

      // Forward full-page screenshot reply back to renderer
      ipcMain.on('viewer-capture-fullpage-reply', (e, imageData) => {
        console.log('[Main Process] Received viewer-capture-fullpage-reply, forwarding to renderer');
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.send('viewer-capture-fullpage-reply', imageData);
        }
      });

      // Specific handler for 'viewer-get-full-html'
      ipcMain.on('viewer-get-full-html', (e, ...args) => {
        console.log('[Main Process] 📄 Received viewer-get-full-html on ipcMain from renderer');

        // Forward to floating viewer if open
        if (
          viewerWindow.isOpen() &&
          viewerWindow.window &&
          viewerWindow.window.webContents &&
          !viewerWindow.window.webContents.isDestroyed()
        ) {
          console.log('[Main Process] Forwarding viewer-get-full-html to FLOATING viewerWindow.');
          viewerWindow.window.webContents.send('viewer-get-full-html', ...args);
        }

        // Forward to main window (embedded)
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          console.log('[Main Process] Sending embedded-viewer-get-full-html-request to MAIN editor window.');
          win.webContents.send('embedded-viewer-get-full-html-request', ...args);
        }
      });

      // Handle HTML response from viewer (floating or embedded)
      ipcMain.on('viewer-get-full-html-reply', (e, result) => {
        console.log('[Main Process] Received viewer-get-full-html-reply, forwarding to renderer');
        if (win && win.webContents && !win.webContents.isDestroyed()) {
          // The tool is waiting for this event on the main window renderer
          win.webContents.send('viewer-get-full-html-reply', result);
        }
      });
    }

    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on('ready', function () {
      console.log('[Main Process] *** APP READY EVENT FIRED - Starting initialization ***');
      // CSP will be handled by meta tag in index.html
      // console.log('[Main Process] onHeadersReceived CSP handler removed.'); // Optional: for logging

      console.log('[Main Process] About to call createWindow()...');
      createWindow();
      if (process.platform === 'darwin') {
        app.dock.setIcon(path.join(appPath, 'src/assets/images/icon.png'));
      }
      console.log('[Main Process] createWindow() call completed');

      setupViewerIpc();

      setupAskForMediaAccessIpc();

      forwardIpcEventsToEditorWindow(['editor-api-request', 'editor-api-response']);

      setupFloatingWindowIpc();

      setupMainWindowControlIpc();

      setupMenu();

      startServer(app, projectGetSettings, projectGetInfo, projectGetComponentBundleExport);

      startCloudFunctionServer(app, cloudServicesGetActive);
      closeRuntimeWhenWindowCloses(win);

      DesignToolImportServer.start(projectGetInfo);

      try {
        startUDPMulticast();
      } catch (e) {
        console.log('Failed to start UDP Multicast');
      }
    });

    app.on('will-finish-launching', function () {
      app.on('open-url', function (event, uri) {
        console.log('open-url', uri);
        event.preventDefault();
        win && win.webContents.send('open-xgenia-uri', uri);
        process.env.xgeniaURI = uri;
        //  logEverywhere("open-url# " + deeplinkingUrl)
      });
    });

    // Quit when all windows are closed.
    app.on('window-all-closed', () => {
      // On macOS it is common for applications and their menu bar
      // to stay active until the user quits explicitly with Cmd + Q
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (win === null) {
        createWindow();
      }
    });

    function isAppFocused() {
      return BrowserWindow.getAllWindows().some((x) => x.isFocused());
    }

    // Lets make sure we only trigger it when the app have been unfocused.
    let appHaveFocus = true;

    app.on('browser-window-focus', (event, win) => {
      win && win.webContents.send('window-focused');

      if (isAppFocused() && !appHaveFocus) {
        appHaveFocus = true;
        win && win.webContents.send('app-focused');
      }
    });

    app.on('browser-window-blur', (event, win) => {
      win && win.webContents.send('window-blurred');

      if (!isAppFocused()) {
        appHaveFocus = false;
        win && win.webContents.send('app-blurred');
      }
    });

    // --------------------------------------------------------------------------------------------------------------------
    // Floating windows
    // --------------------------------------------------------------------------------------------------------------------
    function setupFloatingWindowIpc() {
      ipcMain.on('floating-window-close', function (event, options) {
        closeFloatingWindow(options);
      });
      ipcMain.on('floating-window-open', function (event, options) {
        openFloatingWindow(options);
      });
    }

    // --------------------------------------------------------------------------------------------------------------------
    // Main window control
    // --------------------------------------------------------------------------------------------------------------------
    function setupMainWindowControlIpc() {
      ipcMain.on('main-window-resize', function (event, options) {
        resizeMainWindow(options);
      });
    }
  } catch (error) {
    console.error('[Main Process] CRITICAL ERROR in launchApp():', error);
    console.error('[Main Process] Error stack:', error.stack);
    // Try to show an error dialog if possible
    try {
      const { dialog } = electron;
      dialog.showErrorBox('XGENIA Startup Error', `Failed to initialize XGENIA: ${error.message}`);
    } catch (dialogError) {
      console.error('[Main Process] Could not show error dialog:', dialogError);
    }
  }
}

function startUDPMulticast() {
  var dgram = require('dgram');
  var server = dgram.createSocket('udp4');
  var os = require('os');
  const { ipcMain } = electron;

  server.bind();

  server.on('listening', function () {
    server.setBroadcast(true);
    server.setMulticastTTL(128);
    try {
      server.addMembership('225.0.0.100');
    } catch (e) {
      //this can happen when running without a connection to a router, just ignore for now
    }
    setInterval(broadcastNew, 2000);
  });

  let projectName = 'No Project Open';
  ipcMain.on('project-opened', (e, newProjectName) => {
    projectName = newProjectName;
    broadcastNew();
    DesignToolImportServer.setProjectName(newProjectName);
  });
  ipcMain.on('project-closed', () => {
    projectName = 'No Project Open';
    DesignToolImportServer.setProjectName(null);
  });

  //converts an object to a UTF16 ArrayBuffer
  function jsToArrayBuffer(obj) {
    const str = JSON.stringify(obj);
    const buf = new ArrayBuffer(str.length * 2);
    const bufView = new Uint16Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
      bufView[i] = str.charCodeAt(i);
    }
    return buf;
  }

  app.on('quit', () => {
    //broadcast a message when shutting down so clients can
    //remove the editor as fast as possible, without having to wait
    //for a timeout
    const hostname = os.hostname();

    if (hostname) {
      const message = new Buffer(
        jsToArrayBuffer({ https: process.env.ssl ? true : false, hostname, status: 'closed' })
      );
      server.send(message, 0, message.length, 8575, '225.0.0.100');
    }
  });

  function broadcastNew() {
    const hostname = os.hostname();
    const httpPort = process.env.XGENIAPORT || 8574;

    if (hostname) {
      const message = new Buffer(
        jsToArrayBuffer({ https: process.env.ssl ? true : false, hostname, httpPort, projectName, status: 'active' })
      );
      server.send(message, 0, message.length, 8575, '225.0.0.100');
    }
  }
}

// Find domain name argument if existing
process.env.xgeniaArgs = JSON.stringify(args);
for (var i = 0; i < args.length; i++) {
  if (args[i].indexOf('--api=') === 0) {
    process.env.apiEndpoint = args[i].split('=')[1];
    } else if (args[i].indexOf('--autoupdate=') === 0) {
      process.env.autoUpdate = args[i].split('=')[1];
    } else if (args[i].indexOf('--lessons=') === 0) {
      process.env.lessons = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--feed=') === 0) {
    process.env.feed = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--library=') === 0) {
    process.env.library = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--previews=') === 0) {
    process.env.previews = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--projectTemplates=') === 0) {
    process.env.projectTemplates = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--ssl-cert=') === 0) {
    process.env.sslCert = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('--ssl-key=') === 0) {
    process.env.sslKey = path.resolve(args[i].split('=')[1]);
  } else if (args[i].indexOf('xgenia:') === 0) {
    process.env.xgeniaURI = args[i];
  }
}

let flagsOk = true;

if (process.env.sslCert && !process.env.sslKey) {
  console.log('missing --sslKey');
  flagsOk = false;
}

if (!process.env.sslCert && process.env.sslKey) {
  console.log('missing --sslCert');
  flagsOk = false;
}

if (process.env.sslCert && process.env.sslKey) {
  process.env.ssl = 'true';
}

if (args.indexOf('--merge') !== -1) {
  // The xgenia app can be started in merge mode, then it will merge two project files and then
  // exit the app
  handleProjectMerge(args);
} else if (flagsOk) {
  launchApp();
} else {
  app.quit();
}
