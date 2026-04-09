const express = require('express');
const cors = require('cors');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

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

// MCP client instances cache
const mcpClients = new Map();

// Get or create MCP client for a server
async function getMCPClient(serverUrl) {
  if (!mcpClients.has(serverUrl)) {
    console.log(`[MCP Proxy] Creating new client for ${serverUrl}`);

    const client = new Client({
      name: 'XGENIA-proxy',
      version: '0.1.1'
    });

    // Create transport with proper configuration
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }
      }
    });

    console.log(`[MCP Proxy] Connecting to ${serverUrl}...`);
    await client.connect(transport);
    console.log(`[MCP Proxy] Connected successfully to ${serverUrl}`);

    mcpClients.set(serverUrl, client);
  }

  return mcpClients.get(serverUrl);
}

// Proxy endpoint for MCP tool calls
app.post('/mcp/call-tool', async (req, res) => {
  try {
    const { serverUrl, toolName, parameters } = req.body;

    if (!serverUrl || !toolName) {
      return res.status(400).json({
        error: 'Missing required fields: serverUrl, toolName'
      });
    }

    console.log(`[MCP Proxy] Calling ${toolName} on ${serverUrl}`);
    console.log(`[MCP Proxy] Parameters:`, parameters);

    const client = await getMCPClient(serverUrl);

    // First, let's list available tools to make sure the tool exists
    console.log(`[MCP Proxy] Listing available tools...`);
    const toolsList = await client.listTools();
    console.log(`[MCP Proxy] Available tools:`, toolsList.tools?.map((t) => t.name) || []);

    const tool = toolsList.tools?.find((t) => t.name === toolName);
    if (!tool) {
      throw new Error(
        `Tool '${toolName}' not found. Available tools: ${toolsList.tools?.map((t) => t.name).join(', ') || 'none'}`
      );
    }

    console.log(`[MCP Proxy] Found tool ${toolName}, calling with arguments:`, parameters);
    const result = await client.callTool({
      name: toolName,
      arguments: parameters || {}
    });

    console.log(`[MCP Proxy] Tool call successful, result:`, result);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[MCP Proxy] Error:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Proxy endpoint for listing tools
app.post('/mcp/list-tools', async (req, res) => {
  try {
    const { serverUrl } = req.body;

    if (!serverUrl) {
      return res.status(400).json({
        error: 'Missing required field: serverUrl'
      });
    }

    console.log(`[MCP Proxy] Listing tools for ${serverUrl}`);

    const client = await getMCPClient(serverUrl);
    const result = await client.listTools();

    console.log(`[MCP Proxy] Found ${result.tools?.length || 0} tools:`, result.tools?.map((t) => t.name) || []);
    res.json({ success: true, tools: result.tools });
  } catch (error) {
    console.error('[MCP Proxy] Error listing tools:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Cleanup endpoint to reset MCP clients
app.post('/mcp/cleanup', (req, res) => {
  console.log('[MCP Proxy] Cleaning up MCP clients...');
  mcpClients.clear();
  res.json({ success: true, message: 'All MCP clients cleared' });
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\n[MCP Proxy] Shutting down gracefully...');
  mcpClients.clear();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[MCP Proxy] Received SIGTERM, shutting down...');
  mcpClients.clear();
  process.exit(0);
});

// Start the proxy server
app.listen(PORT, () => {
  console.log(`[MCP Proxy] Server running on port ${PORT}`);
});

module.exports = app;
