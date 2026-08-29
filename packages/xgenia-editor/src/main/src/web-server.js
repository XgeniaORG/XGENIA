const fs = require('fs');
const http = require('http');
const https = require('https');
const nodePath = require('path');
const URL = require('url');
const path = require('path');

const WebSocket = require('ws');
const WebSocketServer = WebSocket.Server;

const ProjectModules = require('../../shared/utils/projectmodules');
const JSONStorage = require('../../shared/utils/jsonstorage');

function parseRangeHeader(range, length) {
  if (!range || range.length === 0) {
    return null;
  }

  const parts = range.replace(/bytes=/, '').split('-');
  const partialstart = parts[0];
  const partialend = parts[1];

  const start = parseInt(partialstart, 10);
  const end = parseInt(partialend, 10);

  const result = {
    start: isNaN(start) ? 0 : start,
    end: isNaN(end) ? length - 1 : end
  };

  if (!isNaN(start) && isNaN(end)) {
    result.start = start;
    result.end = length - 1;
  }

  if (isNaN(start) && !isNaN(end)) {
    result.start = length - end;
    result.end = length - 1;
  }

  return result;
}

function startServer(app, projectGetSettings, projectGetInfo, projectGetComponentBundleExport) {
  const appPath = app.getAppPath();
  console.log(`[web-server.js] appPath: ${appPath}`);

  //accept any certificate from localhost (e.g. self signed)
  app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
    if (url.startsWith('wss://localhost') || url.startsWith('https://localhost')) {
      event.preventDefault();
      callback(true);
    } else {
      console.log('reject certificate', url);
      callback(false);
    }
  });

  var port = process.env.XGENIAPORT || 8574;

  function serveIndexFile(filePath, response) {
    console.log(`[WebServer] Request for index file: ${filePath}`);
    fs.readFile(filePath, 'utf8', function (err, data) {
      if (err) {
        console.error(`[WebServer] Error reading index file: ${filePath}`, err);
        response.writeHead(404);
        response.end('internal error - cannot read index file');
        return;
      }

      projectGetInfo((info) => {
        console.log('[WebServer] Got project info inside serveIndexFile:', info);

        // Reinforced check: Ensure info is an object and has projectDirectory
        if (typeof info !== 'object' || info === null || !info.projectDirectory) {
          console.warn(
            '[WebServer] projectGetInfo returned invalid or incomplete project info (info was falsy, null, not an object, or missing projectDirectory). Aborting request.',
            info
          );
          response.writeHead(503, { 'Content-Type': 'text/plain' });
          response.end('Project information is temporarily unavailable. Please try refreshing.');
          return;
        }

        // Use ProjectModules to inject modules properly
        ProjectModules.instance.injectIntoHtml(info.projectDirectory, data, '/', (injected) => {
          projectGetSettings((settings) => {
            settings = settings || {};

            // Inject Title and Head Code (from original logic)
            injected = injected.replace('{{#title#}}', settings.htmlTitle || 'XGENIA Viewer');
            injected = injected.replace('{{#customHeadCode#}}', settings.headCode || '');

            console.log(
              '[WebServer] Final injection check - Does HTML contain minimal-module.js?',
              injected.includes('minimal-module.js')
            );

            response.writeHead(200, {
              'Content-Type': 'text/html'
            });
            response.end(injected);
          });
        });
      });
    });
  }

  function handleToolsRequest(requestPath, query, response) {
    console.log(`[WebServer - handleToolsRequest] ===== FUNCTION ENTRY =====`);
    console.log(`[WebServer - handleToolsRequest] Request Path: ${requestPath}`);
    console.log(`[WebServer - handleToolsRequest] Query: ${JSON.stringify(query)}`);

    // Find the tools project path
    findToolsProjectPath((toolsProjectPath) => {
      if (!toolsProjectPath) {
        console.error(`[WebServer - handleToolsRequest] Could not find tools project path`);
        response.writeHead(500, { 'Content-Type': 'text/plain' });
        response.end('Tools project not found. Please check configuration.');
        return;
      }

      console.log(`[WebServer - handleToolsRequest] Using tools project at: ${toolsProjectPath}`);

      const componentName = query.component;
      const toolId = query.toolId;
      const mode = query.mode || 'tool';

      if (!componentName) {
        response.writeHead(400, { 'Content-Type': 'text/plain' });
        response.end('Component name query parameter is required');
        return;
      }

      // Serve the tools project exactly like a normal XGENIA project
      // but with the component specified in the URL fragment
      const indexHtmlPath = appPath + '/src/external/viewer/index.html';

      console.log(`[WebServer - handleToolsRequest] Serving tools project index file: ${indexHtmlPath}`);
      fs.readFile(indexHtmlPath, 'utf8', function (err, data) {
        if (err) {
          console.error(`[WebServer - handleToolsRequest] Error reading index file: ${indexHtmlPath}`, err);
          response.writeHead(404);
          response.end('internal error - cannot read index file');
          return;
        }

        // Use ProjectModules to inject the tools project modules
        ProjectModules.instance.injectIntoHtml(toolsProjectPath, data, '/', (injected) => {
          // Get project settings for title and head code
          projectGetSettings((settings) => {
            settings = settings || {};

            // Inject Title and Head Code
            const toolTitle = `XGENIA Tool: ${componentName.replace(/^\//, '')}`;
            injected = injected.replace('{{#title#}}', toolTitle);
            injected = injected.replace('{{#customHeadCode#}}', settings.headCode || '');

            // Add tool-specific configuration
            const toolConfig = `
              <script>
                // Early initialization of XGENIA globals to prevent "XGENIA is not defined" errors
                console.log('[Tools Viewer] Initializing XGENIA globals...');
                
                // Initialize comprehensive XGENIA object with all required properties
                if (typeof window.XGENIA === 'undefined') {
                  window.XGENIA = {};
                }
                
                // Essential properties that the viewer script expects
                window.XGENIA.deployed = false; // Prevent "XGENIA.deployed is not defined" error
                window.XGENIA.baseUrl = '/';
                window.XGENIA.Env = window.XGENIA.Env || { BaseUrl: '/' };
                
                // Ensure Events object exists with all required methods
                window.XGENIA.Events = window.XGENIA.Events || {
                  on: function() { console.log('[XGENIA.Events] on() called with args:', arguments); },
                  off: function() { console.log('[XGENIA.Events] off() called with args:', arguments); },
                  emit: function() { console.log('[XGENIA.Events] emit() called with args:', arguments); }
                };
                
                console.log('[Tools Viewer] Early XGENIA initialization completed with deployed:', window.XGENIA.deployed);
                
                // Initialize XgeniaViewerReact placeholder if not available
                if (typeof window.XgeniaViewerReact === 'undefined') {
                  window.XgeniaViewerReact = {
                    initialized: false,
                    placeholder: true
                  };
                  console.log('[Tools Viewer] XgeniaViewerReact placeholder initialized');
                }
                
                // Initialize XgeniaEditorAPI for tools iframe
                console.log('[Tools Viewer] Initializing XgeniaEditorAPI...');
                let _responseHandler = null;
                
                window.XgeniaEditorAPI = {
                  keyDown: function(event, cb) {
                    console.log('[Tools Viewer] XgeniaEditorAPI.keyDown called:', event);
                    // Send message to parent window to handle editor API calls
                    window.sendMessageToEditor('editor-api-call', {
                      api: 'keyDown',
                      args: event,
                      token: 'tool_' + Date.now() + '_' + Math.random()
                    });
                    if (cb) cb({ success: true });
                  },
                  
                  inspectNodes: function(nodeIds, cb) {
                    console.log('[Tools Viewer] XgeniaEditorAPI.inspectNodes called:', nodeIds);
                    // Send message to parent window to handle editor API calls
                    window.sendMessageToEditor('editor-api-call', {
                      api: 'inspectNodes',
                      args: { nodeIds },
                      token: 'tool_' + Date.now() + '_' + Math.random()
                    });
                    if (cb) cb({ success: true });
                  },
                  
                  setResponseHandler: function(callback) {
                    console.log('[Tools Viewer] XgeniaEditorAPI.setResponseHandler called');
                    _responseHandler = callback;
                    
                    // Set up message listener for API responses from parent
                    window.addEventListener('message', function(event) {
                      if (event.data && event.data.type === 'editor-api-response' && _responseHandler) {
                        console.log('[Tools Viewer] Received editor API response:', event.data);
                        _responseHandler(event.data.response);
                      }
                    });
                  }
                };
                
                console.log('[Tools Viewer] XgeniaEditorAPI initialized successfully');
                
                window.__XGENIA_TOOL_CONFIG = {
                  projectPath: ${JSON.stringify(toolsProjectPath)},
                  componentName: ${JSON.stringify(componentName)},
                  toolId: ${JSON.stringify(toolId || '')},
                  mode: ${JSON.stringify(mode)},
                  isToolMode: true
                };
                
                // Set the initial route to the specified component
                window.xgeniaEditorPreviewRoute = ${JSON.stringify(componentName)};
                

                
                // Set the URL hash to navigate to the component
                // The router matches against the page's urlPath, not the component name
                // For "/Generate Image" component, the urlPath is "generate-image"
                let routePath;
                if (${JSON.stringify(componentName)} === '/Generate Image') {
                  routePath = 'generate-image';
                } else if (${JSON.stringify(componentName)} === '/Generate Audio') {
                  routePath = 'generate-audio';
                } else if (${JSON.stringify(componentName)} === '/Start Page') {
                  routePath = 'start-page';
                } else {
                  // Fallback: convert component name to URL path format
                  routePath = ${JSON.stringify(
                    componentName.startsWith('/')
                      ? componentName.substring(1).toLowerCase().replace(/\s+/g, '-')
                      : componentName.toLowerCase().replace(/\s+/g, '-')
                  )};
                }
                
                console.log('[Tools Viewer] Setting URL hash to navigate to component:', routePath);
                window.location.hash = routePath;
                
                // Dispatch popstate event to trigger navigation
                setTimeout(() => {
                  window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
                }, 100);
                
                console.log('[Tools Viewer] Tool configuration set:', window.__XGENIA_TOOL_CONFIG);
                
                // Load the tools project data
                console.log('[Tools Viewer] Loading tools project data...');
                fetch('/project.json')
                  .then(response => response.json())
                  .then(projectData => {
                    console.log('[Tools Viewer] Tools project data loaded:', projectData);
                    
                    // Override the router's start page to navigate directly to the tool component
                    if (projectData && projectData.components) {
                      const appComponent = projectData.components.find(c => c.name === '/App');
                      if (appComponent && appComponent.graph && appComponent.graph.roots) {
                        appComponent.graph.roots.forEach(root => {
                          if (root.children) {
                            root.children.forEach(child => {
                              if (child.type === 'Router' && child.parameters && child.parameters.pages) {
                                console.log('[Tools Viewer] Setting router start page to:', ${JSON.stringify(
                                  componentName
                                )});
                                child.parameters.pages.startPage = ${JSON.stringify(componentName)};
                              }
                            });
                          }
                        });
                      }
                    }
                    
                    // Store project data globally for the viewer
                    window.projectData = projectData;
                    
                    // Set up the initial route for the viewer
                    window.xgeniaInitialRoute = ${JSON.stringify(componentName)};
                    
                    // Message passing to parent window
                    window.sendMessageToEditor = (type, data = {}) => {
                      const messagePayload = { type, toolId: window.__XGENIA_TOOL_CONFIG.toolId, ...data };
                      console.log('[Tools Viewer] Sending message to editor:', messagePayload);
                      window.parent.postMessage(messagePayload, '*');
                    };
                    
                    // Notify parent that tool is loaded
                    window.addEventListener('load', () => {
                      sendMessageToEditor('tool-html-loaded');
                    });
                  })
                  .catch(error => {
                    console.error('[Tools Viewer] Error loading tools project data:', error);
                    // Fallback to empty project data
                    window.projectData = { components: {}, settings: {} };
                  });
              </script>
            `;

            // Inject the tool config script right before the viewer script loads
            injected = injected.replace(
              '<script defer src="/xgenia.viewer.js"></script>',
              toolConfig + '\n    <script defer src="/xgenia.viewer.js"></script>'
            );

            // Replace the default viewer initialization with tools-specific initialization
            const toolsViewerInit = `
            <script type="application/javascript">
              document.addEventListener('DOMContentLoaded', function () {
                const root = document.getElementById('root');

                function attemptRender() {
                  // Check if React is ready AND the viewer code is loaded AND project data is loaded
                  if (window.__REACT_READY && typeof XgeniaViewerReact !== 'undefined' && XgeniaViewerReact.renderDeployed && window.projectData) {
                    console.log('[Tools Viewer] React ready, Viewer ready, and project data loaded. Calling XgeniaViewerReact.renderDeployed...');
                    console.log('[Tools Viewer] Project data:', window.projectData);
                    console.log('[Tools Viewer] Modules:', window.__xgenia_modules);
                    
                    // Use renderDeployed for tools (like deployed apps) with project data
                    XgeniaViewerReact.renderDeployed(root, window.__xgenia_modules, window.projectData);
                    console.log('[Tools Viewer] XgeniaViewerReact.renderDeployed call finished.');
                    
                    // Add debug styling to ensure content is visible
                    setTimeout(() => {
                      const rootElement = document.getElementById('root');
                      if (rootElement) {
                        console.log('[Tools Viewer] Root element after render - children count:', rootElement.children.length);
                        console.log('[Tools Viewer] Root element computed styles:', window.getComputedStyle(rootElement));
                        
                        // Ensure root element is visible and properly sized
                        rootElement.style.display = 'block';
                        rootElement.style.width = '100vw';
                        rootElement.style.height = '100vh';
                        rootElement.style.position = 'relative';
                        rootElement.style.overflow = 'auto';
                        
                        // Debug the first child
                        if (rootElement.children.length > 0) {
                          const firstChild = rootElement.children[0];
                          console.log('[Tools Viewer] First child element:', firstChild);
                          console.log('[Tools Viewer] First child computed styles:', window.getComputedStyle(firstChild));
                          
                          // Ensure the first child is also visible
                          firstChild.style.display = 'block';
                          firstChild.style.width = '100%';
                          firstChild.style.height = '100%';
                        }
                        
                        // Send a tool-ready message
                        window.sendMessageToEditor('tool-ready', {
                          componentName: window.__XGENIA_TOOL_CONFIG.componentName,
                          toolId: window.__XGENIA_TOOL_CONFIG.toolId
                        });
                      }
                    }, 500);
                  } else if (!window.__REACT_READY) {
                    console.log('[Tools Viewer] React not ready yet, will retry in 50ms...');
                    setTimeout(attemptRender, 50);
                  } else if (!window.projectData) {
                    console.log('[Tools Viewer] Project data not loaded yet, will retry in 50ms...');
                    setTimeout(attemptRender, 50);
                  } else {
                    // React is ready, but XgeniaViewerReact is not. Log error.
                    console.error('[Tools Viewer] React is ready, but XgeniaViewerReact global object or .renderDeployed function not found! Viewer script likely failed.');
                    root.innerHTML = '<div style="color:red; padding:20px;">Error: Viewer script failed to load correctly. XgeniaViewerReact not found.</div>';
                  }
                }

                // Start the check
                attemptRender();
              });
            </script>
            
            <!-- Tools HTML Generated at ${new Date().toISOString()} -->
            <style>
              /* Tools CSS - Generated at ${new Date().toISOString()} */
              html, body {
                margin: 0;
                padding: 0;
                width: 100%;
                height: 100%;
                overflow: hidden;
              }
              
              #root {
                width: 100vw;
                height: 100vh;
                position: relative;
                overflow: auto;
              }
              
              /* Debug styles to make sure content is visible */
              body > * {
                box-sizing: border-box;
              }
              
              /* Ensure any dark backgrounds are visible */
              .body-scroll > #root {
                position: relative;
                overflow: auto;
              }
            </style>`;

            // Replace the default initialization script with our tools-specific one
            const scriptRegex =
              /<script type="application\/javascript">\s*document\.addEventListener\('DOMContentLoaded'[\s\S]*?<\/script>\s*(?=\s*<\/head>)/;
            if (scriptRegex.test(injected)) {
              injected = injected.replace(scriptRegex, toolsViewerInit);
              console.log('[WebServer - handleToolsRequest] Successfully replaced initialization script');
            } else {
              console.warn('[WebServer - handleToolsRequest] Could not find initialization script to replace');
              // Fallback: inject before </head>
              injected = injected.replace('</head>', toolsViewerInit + '\n  </head>');
            }

            console.log(
              '[WebServer - handleToolsRequest] Final injection check - Does HTML contain minimal-module.js?',
              injected.includes('minimal-module.js')
            );
            console.log(
              '[WebServer - handleToolsRequest] Script replacement check - Does HTML contain tool-ready message?',
              injected.includes('tool-ready')
            );
            console.log(
              '[WebServer - handleToolsRequest] Script replacement check - Does HTML contain renderDeployed?',
              injected.includes('renderDeployed')
            );
            console.log('[WebServer - handleToolsRequest] HTML content length:', injected.length);
            console.log(
              '[WebServer - handleToolsRequest] HTML structure check - has <html>:',
              injected.includes('<html>')
            );
            console.log(
              '[WebServer - handleToolsRequest] HTML structure check - has <body>:',
              injected.includes('<body>')
            );
            console.log(
              '[WebServer - handleToolsRequest] HTML structure check - has <div id="root">:',
              injected.includes('<div id="root">')
            );

            // Debug: log a sample of the HTML content to see what's being served
            const htmlSample = injected.substring(0, 2000) + '...' + injected.substring(injected.length - 1000);
            console.log('[WebServer - handleToolsRequest] HTML sample (first 2000 + last 1000 chars):', htmlSample);

            // Check if the problematic text exists in the HTML
            if (injected.includes('Also add some CSS to ensure the body and html are properly styled for tools')) {
              console.error('[WebServer - handleToolsRequest] ❌ FOUND PROBLEMATIC TEXT IN HTML!');
              console.log(
                '[WebServer - handleToolsRequest] HTML contains the old comment text - this should not happen'
              );
            } else {
              console.log('[WebServer - handleToolsRequest] ✅ HTML does not contain problematic text');
            }

            response.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, private',
              Pragma: 'no-cache',
              Expires: '0'
            });
            response.end(injected);
          });
        });
      });
    });
  }

  function findToolsProjectPath(callback) {
    console.log('[WebServer - findToolsProjectPath] Starting tools project path search...');

    // Get project settings first
    projectGetSettings((projectSettings) => {
      console.log('[WebServer - findToolsProjectPath] Project settings received:', projectSettings);

      let toolsProjectPath = null;
      let foundPathSource = '';

      // 1. Check Project Settings (user override)
      if (projectSettings && projectSettings.toolsProjectPath) {
        let resolvedPathFromSettings = projectSettings.toolsProjectPath;

        // Handle relative paths
        if (!path.isAbsolute(resolvedPathFromSettings)) {
          projectGetInfo((projectInfo) => {
            if (projectInfo && projectInfo.projectDirectory) {
              resolvedPathFromSettings = path.resolve(projectInfo.projectDirectory, resolvedPathFromSettings);
              console.log('[WebServer - findToolsProjectPath] Resolved relative path to:', resolvedPathFromSettings);
            } else {
              console.warn('[WebServer - findToolsProjectPath] Cannot resolve relative path without project directory');
              resolvedPathFromSettings = '';
            }

            if (resolvedPathFromSettings && fs.existsSync(path.join(resolvedPathFromSettings, 'project.json'))) {
              callback(resolvedPathFromSettings);
            } else {
              findToolsProjectPathFallback(callback);
            }
          });
          return;
        } else {
          // Absolute path
          if (fs.existsSync(path.join(resolvedPathFromSettings, 'project.json'))) {
            console.log('[WebServer - findToolsProjectPath] Found via project settings:', resolvedPathFromSettings);
            callback(resolvedPathFromSettings);
            return;
          }
        }
      }

      // No valid path from settings, try fallbacks
      findToolsProjectPathFallback(callback);
    });
  }

  function findToolsProjectPathFallback(callback) {
    // Try environment variable
    if (process.env.XGENIA_TOOLS_PATH) {
      const envPath = process.env.XGENIA_TOOLS_PATH;
      if (fs.existsSync(path.join(envPath, 'project.json'))) {
        console.log('[WebServer - findToolsProjectPathFallback] Found via env var:', envPath);
        callback(envPath);
        return;
      }
    }

    console.error('[WebServer - findToolsProjectPathFallback] Could not find tools project path using any method');
    callback(null);
  }

  function continueToolsRequestHandling(resolvedPathFromSettings, projectSettings, requestPath, query, response) {
    // This function is no longer needed - keeping for compatibility but it should not be called
    console.warn('[WebServer - continueToolsRequestHandling] This function is deprecated and should not be called');
    response.writeHead(500, { 'Content-Type': 'text/plain' });
    response.end('Internal server error - deprecated function called');
  }

  function serveProjectBundle(path, response) {
    const idx = path.indexOf('/xgenia_bundles/') + '/xgenia_bundles/'.length;
    const name = decodeURI(path.substring(idx).replace('.json', ''));

    projectGetComponentBundleExport(name, (data) => {
      if (!data) {
        response.writeHead(404);
        response.end('component not found');
      } else {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(data);
      }
    });
  }

  function handleRequest(request, response) {
    var parsedUrl = URL.parse(request.url, true);
    let requestPath = decodeURI(parsedUrl.pathname);

    // console.log('Web server request:', requestPath); // Commented out to avoid EPIPE error

    // Add CORS headers for local development
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', '*');

    // Add specific Content-Security-Policy for React 19
    response.setHeader(
      'Content-Security-Policy',
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * 'unsafe-inline' ws: wss: data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * 'unsafe-inline' data: blob:; font-src * 'unsafe-inline' data: blob:; object-src * 'unsafe-inline' data: blob:; media-src * 'unsafe-inline' data: blob:; child-src * 'unsafe-inline' data: blob:;"
    );

    // Explicitly handle the root path first
    if (requestPath === '/') {
      serveIndexFile(appPath + '/src/external/viewer/index.html', response);
      return;
    }

    // Handle packages directory requests (for xgenia-runtime.js and other package files)
    if (requestPath.startsWith('/packages/')) {
      const packagePath = nodePath.join(appPath, '..', requestPath);
      console.log(`[WebServer] Serving package file: ${requestPath} -> ${packagePath}`);
      if (fs.existsSync(packagePath)) {
        serveFile(packagePath, request, response);
        return;
      } else {
        console.log(`[WebServer] Package file not found: ${packagePath}`);
        serve404(response);
        return;
      }
    }

    // Handle external tools viewer requests
    if (requestPath.startsWith('/external/tools/')) {
      console.log(`[WebServer - handleRequest] Routing to handleToolsRequest for path: ${requestPath}`);
      handleToolsRequest(requestPath, parsedUrl.query, response);
      return;
    }

    // Handle project.json requests from tools viewer
    if (
      requestPath === '/project.json' &&
      request.headers.referer &&
      request.headers.referer.includes('/external/tools/')
    ) {
      console.log(`[WebServer - handleRequest] Serving tools project.json with router index processing`);
      findToolsProjectPath((toolsProjectPath) => {
        if (!toolsProjectPath) {
          console.error('[WebServer] Could not find tools project path for project.json request');
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Tools project not found');
          return;
        }

        const projectJsonPath = nodePath.join(toolsProjectPath, 'project.json');
        console.log(`[WebServer] Processing tools project.json from: ${projectJsonPath}`);

        if (fs.existsSync(projectJsonPath)) {
          try {
            const stat = fs.statSync(projectJsonPath);
            // Load and parse the raw project.json
            const rawProjectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
            console.log(
              `[WebServer] Raw project data loaded, components count: ${
                Object.keys(rawProjectData.components || {}).length
              }`
            );

            // Build router index from components (similar to exportToJSON)
            const allComponents = Object.values(rawProjectData.components || {});
            console.log(`[WebServer] Building router index from ${allComponents.length} components`);

            // Inline router utility functions (converted from TypeScript)
            function getNodesWithType(type, allComponents) {
              let nodes = [];

              function traverseNodes(nodeArray) {
                if (!nodeArray) return;
                for (const node of nodeArray) {
                  if (node.type === type) {
                    nodes.push(node);
                  }
                  // Recursively traverse children
                  if (node.children && node.children.length > 0) {
                    traverseNodes(node.children);
                  }
                }
              }

              for (const component of allComponents) {
                if (component.graph && component.graph.roots) {
                  traverseNodes(component.graph.roots);
                }
              }
              return nodes;
            }

            function getRouterComponents(allComponents) {
              const routers = getNodesWithType('Router', allComponents);
              let pageComponents = [];
              for (const router of routers) {
                if (router.parameters && router.parameters.pages && router.parameters.pages.routes) {
                  pageComponents = pageComponents.concat(
                    router.parameters.pages.routes.map((componentName) =>
                      allComponents.find((c) => c.name === componentName)
                    )
                  );
                }
              }
              return pageComponents.filter((c) => c !== undefined);
            }

            function _getPageInfo(allComponents) {
              const pages = getNodesWithType('Page', allComponents);
              console.log(
                `[WebServer] Found ${pages.length} Page nodes:`,
                pages.map((p) => ({ type: p.type, dynamicports: p.dynamicports }))
              );

              return pages
                .map((page) => {
                  // Find the component that contains this page
                  const component = allComponents.find((c) => {
                    if (!c.graph || !c.graph.roots) return false;

                    function findNodeInComponent(nodeArray) {
                      if (!nodeArray) return false;
                      for (const node of nodeArray) {
                        if (node === page) return true;
                        if (node.children && findNodeInComponent(node.children)) return true;
                      }
                      return false;
                    }

                    return findNodeInComponent(c.graph.roots);
                  });

                  if (!component) {
                    console.log(`[WebServer] Could not find component for page node:`, page);
                    return null;
                  }

                  // Get page title and urlPath from dynamicports
                  let title = null;
                  let urlPath = null;

                  if (page.dynamicports) {
                    const titlePort = page.dynamicports.find((port) => port.name === 'title');
                    const urlPathPort = page.dynamicports.find((port) => port.name === 'urlPath');

                    title = titlePort ? titlePort.default : null;
                    urlPath = urlPathPort ? urlPathPort.default : null;
                  }

                  // Fallback to derive from component name if not found
                  if (!title) {
                    const titleParts = component.name.split('/');
                    title = titleParts[titleParts.length - 1];
                  }

                  if (!urlPath) {
                    urlPath = title.replace(/\s+/g, '-').toLowerCase();
                  }

                  console.log(`[WebServer] Page info for ${component.name}:`, {
                    component: component.name,
                    path: urlPath,
                    title
                  });

                  return {
                    component: component.name, // RouterHandler expects 'component' not 'name'
                    path: urlPath, // RouterHandler expects 'path' not 'urlPath'
                    title: title
                  };
                })
                .filter((p) => p !== null);
            }

            function getRouterIndex(allComponents) {
              const routers = getNodesWithType('Router', allComponents).filter(
                (router) => router.parameters && router.parameters.name
              );
              console.log(
                `[WebServer] Found ${routers.length} Router nodes:`,
                routers.map((r) => ({ name: r.parameters?.name, pages: r.parameters?.pages }))
              );

              const routerInfo = routers.map((router) => ({ ...router.parameters }));
              const pageInfo = _getPageInfo(allComponents);

              return {
                routers: routerInfo,
                pages: pageInfo
              };
            }

            // Build the router index
            const routerIndex = getRouterIndex(allComponents);
            console.log(`[WebServer] Router index built:`, routerIndex);

            // Add router index to project data
            const processedProjectData = {
              ...rawProjectData,
              routerIndex: routerIndex
            };

            console.log(`[WebServer] Serving processed project data with router index`);
            response.writeHead(200, {
              'Content-Type': 'application/json',
              'Last-Modified': stat.mtime.toUTCString(),
              ETag: '"' + stat.mtimeMs + '-' + stat.size + '"',
              'Cache-Control': 'no-cache, no-store, must-revalidate, private'
            });
            response.end(JSON.stringify(processedProjectData));
          } catch (error) {
            console.error(`[WebServer] Error processing tools project.json:`, error);
            response.writeHead(500, { 'Content-Type': 'text/plain' });
            response.end('Error processing tools project data');
          }
        } else {
          console.error(`[WebServer] Tools project.json not found at: ${projectJsonPath}`);
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Tools project.json not found');
        }
      });
      return;
    }

    // Handle xgenia_modules requests from tools viewer
    if (
      requestPath.startsWith('/xgenia_modules/') &&
      request.headers.referer &&
      request.headers.referer.includes('/external/tools/')
    ) {
      console.log(`[WebServer - handleRequest] Serving tools project module: ${requestPath}`);
      findToolsProjectPath((toolsProjectPath) => {
        if (!toolsProjectPath) {
          console.error('[WebServer] Could not find tools project path for module request');
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Tools project not found');
          return;
        }

        const modulePath = nodePath.join(toolsProjectPath, requestPath);
        console.log(`[WebServer] Serving tools project module from: ${modulePath}`);

        if (fs.existsSync(modulePath)) {
          serveFile(modulePath, request, response);
        } else {
          console.error(`[WebServer] Tools project module not found at: ${modulePath}`);
          response.writeHead(404, { 'Content-Type': 'text/plain' });
          response.end('Tools project module not found');
        }
      });
      return;
    }

    // Handle /config endpoint for ConfigService
    if (requestPath === '/config') {
      response.writeHead(200, { 'Content-Type': 'application/json' });

      // Return empty config object if no cloud services are configured
      // This prevents the HTML fallback and satisfies ConfigService expectations
      const configResponse = {
        params: {}
      };

      response.end(JSON.stringify(configResponse));
      return;
    }

    //previous versions of XGENIA will request /external/viewer/index.html or /external/viewer/index.htmlnull
    //new version can also do this if old requests are cached by electron
    if (requestPath === '/external/viewer/index.html' || requestPath.endsWith('viewer/index.htmlnull')) {
      serveIndexFile(appPath + '/src/external/viewer/index.html', response);
      return;
    }

    if (requestPath.startsWith('/external/canvas/')) {
      if (requestPath === '/external/canvas/index.html') {
        serveIndexFile(appPath + '/src' + requestPath, response);
        //all done
        return;
      }
      //look in canvas folder for static files
      const fullPath = appPath + '/src' + requestPath;
      if (fs.existsSync(fullPath)) {
        serveFile(fullPath, request, response);
        return;
      }

      //not done, strip away the index part of the path and continue
      requestPath = requestPath.replace('/external/canvas', '');
    } else if (requestPath.startsWith('/external/viewer')) {
      //we're in the viewer folder, just strip away and proceed (treat it as the regular root path)
      requestPath = requestPath.replace('/external/viewer', '');
    }

    //special bundle folder that requests dynamic data from editor
    if (requestPath.includes('/xgenia_bundles/')) {
      serveProjectBundle(requestPath, response);
      return;
    }

    //any folder, including root, serves the index (SPA app). Make any index.html just return the viewer
    //exclude xgenia module folder (shouldn't be any folder requests, but who knows)
    if (
      requestPath.includes('/xgenia_modules/') === false &&
      (requestPath.endsWith('index.html') || requestPath.includes('.') === false)
    ) {
      // Revert path calculation to point to the build output directory within the editor's structure
      const indexHtmlPath = appPath + '/src/external/viewer/index.html';
      serveIndexFile(indexHtmlPath, response);
      return;
    }

    // Serve a live uid→path asset manifest built from the project's .xgenia-assets.json so
    // the canvas runtime can resolve `uid://<id>` references (mirrors the static manifest
    // bundled into deployed exports).
    if (requestPath.endsWith('assets-manifest.json')) {
      projectGetInfo((info) => {
        const map = {};
        try {
          if (info && info.projectDirectory) {
            const metaPath = info.projectDirectory + '/.xgenia-assets.json';
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              for (const p in meta) {
                const uid = meta[p] && meta[p].uid;
                if (uid) map[uid] = p;
              }
            }
          }
        } catch (e) {
          console.warn('[WebServer] assets-manifest build failed:', e);
        }
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        response.end(JSON.stringify(map));
      });
      return;
    }

    //by this point it must be a static file in either the viewer folder or the project
    //check if it's a viewer file
    const viewerFilePath = appPath + '/src/external/viewer/' + requestPath;
    if (fs.existsSync(viewerFilePath)) {
      serveFile(viewerFilePath, request, response);
    } else {
      // Check if file exists in project directory
      projectGetInfo((info) => {
        // Guard against null or undefined info here as well before accessing projectDirectory
        if (typeof info === 'object' && info !== null && info.projectDirectory) {
          const projectPath = info.projectDirectory + requestPath;
          if (fs.existsSync(projectPath)) {
            serveFile(projectPath, request, response);
          } else {
            serve404(response);
          }
        } else {
          console.warn(
            '[WebServer] projectGetInfo returned invalid info when serving static file from project. Path:',
            requestPath,
            'Info:',
            info
          );
          serve404(response); // Serve 404 if project info is not available/valid
        }
      });
    }
  }

  var server;
  if (process.env.ssl) {
    console.log('Using SSL');

    const options = {
      key: fs.readFileSync(process.env.sslKey),
      cert: fs.readFileSync(process.env.sslCert)
    };
    server = https.createServer(options, handleRequest).listen(port);
  } else {
    server = http.createServer(handleRequest).listen(port);
  }

  server.on('error', (e) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { dialog } = require('electron');
    dialog
      .showMessageBox({
        type: 'error',
        message: `A problem was encountered while starting XGENIA's webserver\n\n${e.message}`
      })
      .then(() => {
        app.quit();
      });
  });

  server.on('listening', (e) => {
    console.log('webserver hustling bytes on port', port);
    process.env.XGENIAPORT = port;

    startWebSocketServer(server);
  });
}

function startWebSocketServer(server) {
  // Websocket server for sending updates and debugging
  var connectedSockets = [];
  var services = {};

  function broadcastMessage(msg, type) {
    var broadcastToType = type === 'viewer' ? 'editor' : 'viewer';
    for (var i = 0; i < connectedSockets.length; i++) {
      var s = connectedSockets[i];
      if (!type || s.type === broadcastToType) {
        s.ws.readyState === WebSocket.OPEN && s.ws.send(msg);
      }
    }
  }

  var wss = new WebSocketServer({
    server: server
  });

  wss.on('connection', function (ws) {
    var handle = {
      ws: ws
    };
    connectedSockets.push(handle);

    (function () {
      var _handle = handle;

      ws.on('message', function (message) {
        var request = JSON.parse(message);
        if (request.cmd === 'register') {
          _handle.type = request.type;
          _handle.clientId = request.clientId;

          // A viewer is connected, broadcast to editors
          if (request.type === 'viewer')
            broadcastMessage(
              JSON.stringify({
                cmd: 'registered',
                type: _handle.type,
                clientId: _handle.clientId
              }),
              _handle.type
            );

          if (_handle.type === 'service' && request.service)
            // A new serivce is registered
            services[request.service] = handle;
        }
        // If this is a request to a service, pass it along to the service
        else if (request.service) {
          var s = services[request.service];
          s && s.ws.send(message);
        } else {
          // If there is a target client, send the message to that client
          if (request.target) {
            for (var i = 0; i < connectedSockets.length; i++)
              if (connectedSockets[i].clientId === request.target) connectedSockets[i].ws.send(message);
          }
          // Broadcast message to other connected sockets
          // message from viewers should go to connected editors and vice versa
          else broadcastMessage(message, _handle.type);
        }
      });

      ws.on('error', (e) => {
        console.log('ws error', e);
      });

      ws.on('close', function () {
        const idx = connectedSockets.indexOf(_handle);
        const clientId = connectedSockets[idx].clientId;
        connectedSockets.splice(idx, 1);
        const msg = JSON.stringify({
          cmd: 'disconnect',
          clientId: clientId
        });
        broadcastMessage(msg, 'viewer'); // Notify editor that a viewer disconnected
      });
    })();
  });
}

function getContentType(request) {
  var extname = nodePath.extname(request.url);
  var contentType = 'text/html';
  switch (extname) {
    case '.js':
      contentType = 'text/javascript';
      break;
    case '.css':
      contentType = 'text/css';
      break;
    case '.json':
      contentType = 'application/json';
      break;
    case '.png':
      contentType = 'image/png';
      break;
    case '.webp':
      contentType = 'image/webp';
      break;
    case '.gif':
      contentType = 'image/gif';
      break;
    case '.jpg':
      contentType = 'image/jpeg';
      break;
    // (2026-08-27, export 1787803023693) THE MISSING CASES WERE SERVING text/html.
    // A generated reel-dog-win.webm reached the browser with the right bytes (valid EBML
    // magic, correct length) and content-type text/html — this switch's default — so the
    // <video> element fired `error` and every transparent-webm win animation "vanished".
    // Sessions across three days blamed alpha compositing, hide-latches, and the video
    // model for what was this switch all along; one session started base64-inlining a
    // 3MB clip into a node parameter to get around it. Sweep, not a one-extension fix:
    // every asset family the engine actually loads (video, audio for the Sound node,
    // fonts now that writes fetch them, modern image formats) gets its real type.
    // The .wav case also fell through into .mp4 (the eslint-disable was masking it),
    // so wav files were served as video/mp4.
    case '.wav':
      contentType = 'audio/wav';
      break;
    case '.mp3':
      contentType = 'audio/mpeg';
      break;
    case '.ogg':
      contentType = 'audio/ogg';
      break;
    case '.mp4':
    case '.m4v':
      contentType = 'video/mp4';
      break;
    case '.webm':
      contentType = 'video/webm';
      break;
    case '.jpeg':
      contentType = 'image/jpeg';
      break;
    case '.avif':
      contentType = 'image/avif';
      break;
    case '.woff':
      contentType = 'font/woff';
      break;
    case '.woff2':
      contentType = 'font/woff2';
      break;
    case '.otf':
      contentType = 'font/otf';
      break;
    case '.wasm':
      contentType = 'application/wasm';
      break;
    case '.svg':
      contentType = 'image/svg+xml';
      break;
    case '.ttf':
      contentType = 'font/ttf';
      break;
  }

  return contentType;
}

// A file that exists can still fail to open or read (a directory, EACCES/EPERM,
// an iCloud-evicted file that can't be materialized, ...). Once headers are out
// the status can't be changed anymore — calling writeHead again throws
// ERR_HTTP_HEADERS_SENT, which is an uncaught exception in the main process and
// takes down the whole app. Send an error status if we still can, otherwise kill
// the connection so the client sees a failed transfer instead of a truncated one.
function failResponse(response, err) {
  if (!response.headersSent) {
    response.writeHead(404);
    response.end(err.message);
  } else {
    response.destroy();
  }
}

function serveFile(filePath, request, response) {
  fs.stat(decodeURI(filePath), (error, stat) => {
    if (error) {
      response.writeHead(404);
      response.end(error.message);
      return null;
    }

    // Only regular files can be streamed. Directories pass the stat/existsSync
    // checks but error the read stream, so reject them here.
    if (!stat.isFile()) {
      serve404(response);
      return null;
    }

    const range = parseRangeHeader(request.headers.range, stat.size);
    if (range) {
      const start = range.start;
      const end = range.end;

      if (start >= stat.size || end >= stat.size) {
        response.writeHead(416, {
          'Content-Type': getContentType(request),
          'Content-Range': 'bytes */' + stat.size
        });
        response.end();

        return null;
      }

      const fileStream = fs.createReadStream(decodeURI(filePath), {
        start: range.start,
        end: range.end
      });

      fileStream.on('error', function (err) {
        failResponse(response, err);
      });

      // Wait for the file to actually open before sending headers, so open
      // failures still get a clean error status.
      fileStream.on('open', function () {
        const responseHeaders = {
          'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
          'Content-Length': start == end ? 0 : end - start + 1,
          'Content-Type': getContentType(request),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
          'Last-Modified': stat.mtime.toUTCString(),
          ETag: '"' + stat.mtimeMs + '-' + stat.size + '"'
        };

        response.writeHead(206, responseHeaders);
        fileStream.pipe(response);
      });
    } else {
      const fileStream = fs.createReadStream(decodeURI(filePath));
      fileStream.on('error', function (err) {
        failResponse(response, err);
      });

      fileStream.on('open', function () {
        response.writeHead(200, {
          'Content-Type': getContentType(request),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          'Last-Modified': stat.mtime.toUTCString(),
          ETag: '"' + stat.mtimeMs + '-' + stat.size + '"',
          'Cache-Control': 'no-cache'
        });

        fileStream.pipe(response);
      });
    }
  });
}

function serve404(response) {
  response.writeHead(404);
  response.end('file not found');
}

module.exports = startServer;
