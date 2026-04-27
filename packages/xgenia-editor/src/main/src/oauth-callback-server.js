const http = require('http');

class OAuthCallbackServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.callback = null;
  }

  async start(callback) {
    if (this.server) {
      console.log('[OAuth Server] Server already running on port', this.port);
      return this.port;
    }

    this.callback = callback;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${this.port}`);
        
        console.log('[OAuth Server] Received request:', req.url);

        if (url.pathname === '/oauth/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');
          const errorDescription = url.searchParams.get('error_description');

          // Check for MCP OAuth tokens (direct token flow)
          const accessToken = url.searchParams.get('access_token');
          const refreshToken = url.searchParams.get('refresh_token');
          const expiresIn = url.searchParams.get('expires_in');
          const tokenType = url.searchParams.get('token_type');

          // Send response to browser
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
              <head>
                <title>OAuth Authentication</title>
                <style>
                  body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                  }
                  .container {
                    text-align: center;
                    padding: 2rem;
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 16px;
                    backdrop-filter: blur(10px);
                  }
                  .success { color: #4ade80; }
                  .error { color: #f87171; }
                  h1 { margin-bottom: 1rem; }
                  p { font-size: 1.1rem; }
                </style>
              </head>
              <body>
                <div class="container">
                  ${error ? `
                    <h1 class="error">❌ Authentication Failed</h1>
                    <p>${errorDescription || error}</p>
                  ` : `
                    <h1 class="success">✅ Authentication Successful</h1>
                    <p>You can close this window and return to the app.</p>
                  `}
                </div>
              </body>
            </html>
          `);

          // Call the callback with the data
          if (this.callback) {
            if (error) {
              this.callback({ error, error_description: errorDescription });
            } else if (accessToken) {
              // MCP OAuth flow - tokens provided directly
              this.callback({
                tokens: {
                  access_token: accessToken,
                  refresh_token: refreshToken,
                  expires_in: expiresIn ? parseInt(expiresIn) : undefined,
                  token_type: tokenType
                },
                state: state
              });
            } else if (code) {
              // Authorization code flow (state is optional — OpenRouter doesn't send it)
              this.callback({ code, state: state || '' });
            }
          }
        } else {
          res.writeHead(404);
          res.end('Not Found');
        }
      });

      // Find available port starting from 3333
      const tryPort = (port) => {
        this.server.listen(port, 'localhost', () => {
          this.port = port;
          console.log(`[OAuth Server] Started on http://localhost:${port}`);
          resolve(port);
        }).on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`[OAuth Server] Port ${port} in use, trying ${port + 1}`);
            tryPort(port + 1);
          } else {
            reject(err);
          }
        });
      };

      tryPort(3000);
    });
  }

  getCallbackUrl() {
    if (!this.port) {
      throw new Error('OAuth server not started');
    }
    return `http://localhost:${this.port}/oauth/callback`;
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = null;
      this.callback = null;
      console.log('[OAuth Server] Stopped');
    }
  }
}

let oauthServerInstance = null;

function getOAuthServer() {
  if (!oauthServerInstance) {
    oauthServerInstance = new OAuthCallbackServer();
  }
  return oauthServerInstance;
}

module.exports = { getOAuthServer };
