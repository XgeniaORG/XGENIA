const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.MCP_PROXY_PORT || 3001;

// Enable CORS for all origins (adjust as needed for security)
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'mcp-protocol-version']
  })
);

app.use(express.json());

// Alternative approach for remote MCP servers using direct HTTP
async function callRemoteMCPServer(serverUrl, toolName, parameters) {
  console.log(`[MCP Proxy V2] Direct HTTP call to ${serverUrl}`);

  // Try different approaches for remote.mcpservers.org
  if (serverUrl.includes('remote.mcpservers.org')) {
    return await callRemoteMCPServersDirect(serverUrl, toolName, parameters);
  }

  // For other servers, try standard HTTP POST
  const response = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'XGENIA-MCP-Proxy/1.0.0'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: parameters
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.json();
}

// Specific handler for remote.mcpservers.org
async function callRemoteMCPServersDirect(serverUrl, toolName, parameters) {
  console.log(`[MCP Proxy V2] Remote servers direct call`);

  // For fetch server specifically
  if (serverUrl.includes('/fetch/mcp') && toolName === 'fetch') {
    const fetchUrl = parameters.url;
    const maxLength = parameters.max_length || 5000;
    const startIndex = parameters.start_index || 0;
    const raw = parameters.raw || false;

    console.log(`[MCP Proxy V2] Fetching ${fetchUrl} directly`);

    try {
      const response = await fetch(fetchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; XGENIA-MCP-Proxy/1.0.0)'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${fetchUrl}: ${response.status} ${response.statusText}`);
      }

      let content = await response.text();

      // Apply start_index and max_length
      if (startIndex > 0) {
        content = content.substring(startIndex);
      }

      if (content.length > maxLength) {
        content = content.substring(0, maxLength);
      }

      return {
        success: true,
        content: raw ? content : content.replace(/<[^>]*>/g, ''), // Strip HTML if not raw
        url: fetchUrl,
        length: content.length,
        status: response.status
      };
    } catch (error) {
      console.error(`[MCP Proxy V2] Fetch error:`, error);
      throw error;
    }
  }

  // For other tools, return an error
  throw new Error(`Tool '${toolName}' not implemented for direct calls`);
}

// Proxy endpoint for MCP tool calls (V2)
app.post('/mcp/call-tool', async (req, res) => {
  try {
    const { serverUrl, toolName, parameters } = req.body;

    if (!serverUrl || !toolName) {
      return res.status(400).json({
        error: 'Missing required fields: serverUrl, toolName'
      });
    }

    console.log(`[MCP Proxy V2] Calling ${toolName} on ${serverUrl}`);
    console.log(`[MCP Proxy V2] Parameters:`, parameters);

    const result = await callRemoteMCPServer(serverUrl, toolName, parameters);

    console.log(`[MCP Proxy V2] Tool call successful`);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[MCP Proxy V2] Error:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Proxy endpoint for listing tools (V2)
app.post('/mcp/list-tools', async (req, res) => {
  try {
    const { serverUrl } = req.body;

    if (!serverUrl) {
      return res.status(400).json({
        error: 'Missing required field: serverUrl'
      });
    }

    console.log(`[MCP Proxy V2] Listing tools for ${serverUrl}`);

    // Hardcode known tools for remote.mcpservers.org
    let tools = [];

    if (serverUrl.includes('/fetch/mcp')) {
      tools = [
        {
          name: 'fetch',
          description: 'Fetch content from a URL',
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to fetch' },
              max_length: { type: 'number', description: 'Maximum content length' },
              start_index: { type: 'number', description: 'Starting index for content' },
              raw: { type: 'boolean', description: 'Return raw HTML' }
            },
            required: ['url']
          }
        }
      ];
    } else if (serverUrl.includes('/sequentialthinking/mcp')) {
      tools = [
        {
          name: 'thinking',
          description: 'Sequential thinking process',
          inputSchema: {
            type: 'object',
            properties: {
              thought: { type: 'string', description: 'Thought content' },
              thoughtNumber: { type: 'number', description: 'Thought number' }
            },
            required: ['thought']
          }
        }
      ];
    }

    console.log(`[MCP Proxy V2] Found ${tools.length} tools`);
    res.json({ success: true, tools });
  } catch (error) {
    console.error('[MCP Proxy V2] Error listing tools:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: 'v2', timestamp: new Date().toISOString() });
});

// Start the proxy server
app.listen(PORT, () => {
  console.log(`[MCP Proxy V2] Server running on port ${PORT}`);
});

module.exports = app;
