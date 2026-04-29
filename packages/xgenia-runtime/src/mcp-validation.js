'use strict';

/**
 * 🔒 MCP Validation Utilities
 *
 * Provides validation for MCP server URLs, authentication, and configurations
 * to ensure security and prevent common mistakes.
 */

/**
 * Validate MCP server URL
 * @param {string} url - The MCP server URL to validate
 * @returns {Object} Validation result with { valid: boolean, error?: string, warnings?: string[] }
 */
function validateMCPServerUrl(url) {
  const result = {
    valid: false,
    warnings: []
  };

  // Basic URL validation
  if (!url || typeof url !== 'string') {
    result.error = 'URL is required and must be a string';
    return result;
  }

  url = url.trim();
  if (!url) {
    result.error = 'URL cannot be empty';
    return result;
  }

  // Check for valid URL format
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    result.error = 'Invalid URL format';
    return result;
  }

  // Check protocol - Allow common protocols for MCP servers
  const allowedProtocols = ['http:', 'https:', 'ws:', 'wss:', 'mcp:', 'stdio:', 'sse:'];
  if (!allowedProtocols.includes(parsedUrl.protocol)) {
    result.error = `Invalid protocol. Allowed: ${allowedProtocols.join(', ')}`;
    return result;
  }

  // Security warnings
  if (
    parsedUrl.protocol === 'http:' &&
    parsedUrl.hostname !== 'localhost' &&
    !parsedUrl.hostname.startsWith('192.168.')
  ) {
    result.warnings.push('Using HTTP instead of HTTPS may expose sensitive data');
  }

  // Check for suspicious patterns
  if (parsedUrl.hostname.includes('..') || parsedUrl.pathname.includes('..')) {
    result.error = 'URL contains suspicious path traversal patterns';
    return result;
  }

  // Check for localhost development vs production
  const isLocalhost =
    parsedUrl.hostname === 'localhost' ||
    parsedUrl.hostname === '127.0.0.1' ||
    parsedUrl.hostname.startsWith('192.168.') ||
    parsedUrl.hostname.startsWith('10.') ||
    parsedUrl.hostname.endsWith('.local');

  if (isLocalhost) {
    result.warnings.push('This appears to be a local development server');
  }

  result.valid = true;
  return result;
}

/**
 * Validate MCP authentication configuration
 * @param {Object} authConfig - Authentication configuration object
 * @returns {Object} Validation result
 */
function validateMCPAuthConfig(authConfig) {
  const result = {
    valid: true,
    warnings: []
  };

  if (!authConfig || typeof authConfig !== 'object') {
    return result; // Auth is optional
  }

  const { type, token, apiKey, username, password } = authConfig;

  // Validate auth type
  const supportedTypes = ['bearer', 'basic', 'api-key', 'none'];
  if (type && !supportedTypes.includes(type)) {
    result.valid = false;
    result.error = `Unsupported auth type. Supported: ${supportedTypes.join(', ')}`;
    return result;
  }

  // Validate token-based auth
  if (type === 'bearer') {
    if (!token || typeof token !== 'string') {
      result.valid = false;
      result.error = 'Bearer token is required for bearer authentication';
      return result;
    }
    if (token.length < 10) {
      result.warnings.push('Bearer token seems unusually short');
    }
  }

  // Validate API key auth
  if (type === 'api-key') {
    if (!apiKey || typeof apiKey !== 'string') {
      result.valid = false;
      result.error = 'API key is required for api-key authentication';
      return result;
    }
  }

  // Validate basic auth
  if (type === 'basic') {
    if (!username || !password) {
      result.valid = false;
      result.error = 'Username and password are required for basic authentication';
      return result;
    }
  }

  // Security warnings
  if (token && token.includes(' ')) {
    result.warnings.push('Token contains spaces, which may cause issues');
  }

  return result;
}

/**
 * Validate complete MCP server configuration
 * @param {Object} config - Complete MCP server configuration
 * @returns {Object} Validation result
 */
function validateMCPServerConfig(config) {
  const result = {
    valid: true,
    warnings: [],
    errors: []
  };

  if (!config || typeof config !== 'object') {
    result.valid = false;
    result.errors.push('Configuration object is required');
    return result;
  }

  const { serverUrl, serverName, authConfig, selectedTool } = config;

  // Validate server URL
  const urlValidation = validateMCPServerUrl(serverUrl);
  if (!urlValidation.valid) {
    result.valid = false;
    result.errors.push(`URL: ${urlValidation.error}`);
  } else {
    result.warnings.push(...urlValidation.warnings.map((w) => `URL: ${w}`));
  }

  // Validate server name
  if (!serverName || typeof serverName !== 'string') {
    result.errors.push('Server name is required');
    result.valid = false;
  } else if (serverName.trim().length < 2) {
    result.errors.push('Server name must be at least 2 characters');
    result.valid = false;
  }

  // Validate auth config
  const authValidation = validateMCPAuthConfig(authConfig);
  if (!authValidation.valid) {
    result.valid = false;
    result.errors.push(`Auth: ${authValidation.error}`);
  } else {
    result.warnings.push(...authValidation.warnings.map((w) => `Auth: ${w}`));
  }

  // Validate selected tool (if provided)
  if (selectedTool) {
    if (typeof selectedTool !== 'string' || selectedTool.trim().length === 0) {
      result.warnings.push('Selected tool should be a non-empty string');
    }
  }

  return result;
}

/**
 * Sanitize MCP server URL for safe usage
 * @param {string} url - Raw URL input
 * @returns {string} Sanitized URL
 */
function sanitizeMCPServerUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  // Trim whitespace
  url = url.trim();

  // Remove multiple slashes (except in protocol)
  url = url.replace(/([^:]\/)\/+/g, '$1');

  // Ensure protocol is present
  if (!url.match(/^https?:\/\//)) {
    // Default to HTTPS for security
    url = 'https://' + url.replace(/^\/+/, '');
  }

  return url;
}

/**
 * Get security recommendations for MCP server configuration
 * @param {Object} config - MCP server configuration
 * @returns {Array} Array of security recommendations
 */
function getMCPSecurityRecommendations(config) {
  const recommendations = [];

  if (!config || typeof config !== 'object') {
    return recommendations;
  }

  const { serverUrl, authConfig } = config;

  // URL recommendations
  if (serverUrl) {
    try {
      const url = new URL(serverUrl);
      if (url.protocol === 'http:') {
        recommendations.push('Use HTTPS instead of HTTP for secure communication');
      }
      if (!url.hostname.includes('.')) {
        recommendations.push('Verify the server hostname is correct');
      }
    } catch (e) {
      // URL parsing failed, already handled by validation
    }
  }

  // Auth recommendations
  if (!authConfig || !authConfig.type) {
    recommendations.push('Consider adding authentication for better security');
  } else if (authConfig.type === 'basic') {
    recommendations.push('Consider using bearer token or API key instead of basic auth');
  }

  // General recommendations
  recommendations.push('Only connect to trusted MCP servers');
  recommendations.push("Review the server's documentation and privacy policy");
  recommendations.push('Monitor usage and revoke access if needed');

  return recommendations;
}

// Export functions
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    validateMCPServerUrl,
    validateMCPAuthConfig,
    validateMCPServerConfig,
    sanitizeMCPServerUrl,
    getMCPSecurityRecommendations
  };
} else if (typeof window !== 'undefined') {
  window.mcpValidation = {
    validateMCPServerUrl,
    validateMCPAuthConfig,
    validateMCPServerConfig,
    sanitizeMCPServerUrl,
    getMCPSecurityRecommendations
  };
}
