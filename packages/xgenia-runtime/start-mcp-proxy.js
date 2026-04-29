#!/usr/bin/env node

const path = require('path');
const { spawn } = require('child_process');

// Set environment variables
process.env.MCP_PROXY_PORT = process.env.MCP_PROXY_PORT || '3001';
process.env.USE_MCP_PROXY = 'true';

// Check if we should use V1 proxy (V2 is now default)
const useV1 = process.env.MCP_PROXY_V1 === 'true' || process.argv.includes('--v1');
const proxyFile = useV1 ? 'mcp-proxy-server.js' : 'mcp-proxy-server-v2.js';

console.log(`Starting MCP Proxy Server ${useV1 ? 'V1' : 'V2'}...`);
console.log(`Port: ${process.env.MCP_PROXY_PORT}`);
console.log(`File: ${proxyFile}`);
console.log('Press Ctrl+C to stop\n');

// Start the proxy server
const proxyServer = spawn('node', [path.join(__dirname, 'src', proxyFile)], {
  stdio: 'inherit',
  env: process.env
});

proxyServer.on('error', (error) => {
  console.error('Failed to start proxy server:', error);
  process.exit(1);
});

proxyServer.on('close', (code) => {
  console.log(`Proxy server exited with code ${code}`);
  process.exit(code);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down proxy server...');
  proxyServer.kill('SIGINT');
});

process.on('SIGTERM', () => {
  proxyServer.kill('SIGTERM');
});