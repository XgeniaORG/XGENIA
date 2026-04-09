const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.COINGECKO_MCP_PORT || 3002;

// Enable CORS for all origins
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'mcp-protocol-version']
}));

// Parse JSON bodies
app.use(express.json());

// CoinGecko API base URL
const COINGECKO_API_BASE = 'https://api.coingecko.com/api/v3';

// Helper function to make CoinGecko API calls
async function callCoinGeckoAPI(endpoint, params = {}) {
  const url = new URL(`${COINGECKO_API_BASE}${endpoint}`);
  
  // Add query parameters
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  console.log(`[CoinGecko MCP] Calling API: ${url.toString()}`);
  
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'XGENIA-CoinGecko-MCP/1.0.0'
    }
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Available tools
const availableTools = [
  {
    name: 'getCoinPrice',
    description: 'Get current cryptocurrency price',
    inputSchema: {
      type: 'object',
      properties: {
        coinId: {
          type: 'string',
          description: 'The coin ID (e.g., bitcoin, ethereum)'
        },
        vsCurrency: {
          type: 'string',
          description: 'The target currency (default: usd)',
          default: 'usd'
        }
      },
      required: ['coinId']
    }
  },
  {
    name: 'getTrendingCoins',
    description: 'Get currently trending cryptocurrencies',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getCoinHistory',
    description: 'Get historical price data for a cryptocurrency',
    inputSchema: {
      type: 'object',
      properties: {
        coinId: {
          type: 'string',
          description: 'The coin ID (e.g., bitcoin, ethereum)'
        },
        days: {
          type: 'number',
          description: 'Number of days of historical data (default: 7)',
          default: 7
        },
        vsCurrency: {
          type: 'string',
          description: 'The target currency (default: usd)',
          default: 'usd'
        }
      },
      required: ['coinId']
    }
  },
  {
    name: 'searchCoins',
    description: 'Search for cryptocurrencies',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'getGlobalStats',
    description: 'Get global cryptocurrency market statistics',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'getExchanges',
    description: 'Get list of cryptocurrency exchanges',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

// Tool execution function
async function executeTool(toolName, args) {
  try {
    switch (toolName) {
      case 'getCoinPrice':
        const { coinId, vsCurrency = 'usd' } = args;
        if (!coinId) {
          throw new Error('coinId is required');
        }
        
        const priceData = await callCoinGeckoAPI('/simple/price', {
          ids: coinId,
          vs_currencies: vsCurrency
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(priceData, null, 2)
            }
          ]
        };

      case 'getTrendingCoins':
        const trendingData = await callCoinGeckoAPI('/search/trending');
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(trendingData, null, 2)
            }
          ]
        };

      case 'getCoinHistory':
        const { coinId: historyCoinId, days = 7, vsCurrency: historyVsCurrency = 'usd' } = args;
        if (!historyCoinId) {
          throw new Error('coinId is required');
        }
        
        const historyData = await callCoinGeckoAPI(`/coins/${historyCoinId}/market_chart`, {
          vs_currency: historyVsCurrency,
          days: days
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(historyData, null, 2)
            }
          ]
        };

      case 'searchCoins':
        const { query } = args;
        if (!query) {
          throw new Error('query is required');
        }
        
        const searchData = await callCoinGeckoAPI('/search', {
          query: query
        });
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(searchData, null, 2)
            }
          ]
        };

      case 'getGlobalStats':
        const globalData = await callCoinGeckoAPI('/global');
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(globalData, null, 2)
            }
          ]
        };

      case 'getExchanges':
        const exchangesData = await callCoinGeckoAPI('/exchanges');
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(exchangesData, null, 2)
            }
          ]
        };

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    console.error(`[CoinGecko MCP] Error in tool ${toolName}:`, error);
    throw error;
  }
}

// HTTP endpoint for MCP over HTTP
app.post('/mcp', async (req, res) => {
  try {
    const { method, params, id } = req.body;
    
    console.log(`[CoinGecko MCP] HTTP request: ${method}`);
    
    let result;
    switch (method) {
      case 'tools/list':
        result = {
          jsonrpc: '2.0',
          id,
          result: {
            tools: availableTools
          }
        };
        break;
        
      case 'tools/call':
        const { name, arguments: args } = params;
        const toolResult = await executeTool(name, args);
        result = {
          jsonrpc: '2.0',
          id,
          result: toolResult
        };
        break;
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    res.json(result);
  } catch (error) {
    console.error('[CoinGecko MCP] HTTP error:', error);
    res.status(500).json({
      jsonrpc: '2.0',
      id: req.body.id,
      error: {
        code: -32603,
        message: error.message
      }
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'coingecko-mcp' });
});

// Start HTTP server
app.listen(PORT, () => {
  console.log(`[CoinGecko MCP] HTTP server running on port ${PORT}`);
  console.log(`[CoinGecko MCP] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[CoinGecko MCP] Health check: http://localhost:${PORT}/health`);
});

// Export for use in other modules
module.exports = { app }; 