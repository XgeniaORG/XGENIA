/**
 * Content Security Policy configurations
 * 
 * This file defines the CSP settings for both development and production environments
 */

module.exports = {
  // Development CSP - fully permissive for easier debugging
  developmentCSP: "default-src * 'self' blob: data: ws: wss: http: https: 'unsafe-inline' 'unsafe-eval'; script-src * 'self' blob: data: 'unsafe-inline' 'unsafe-eval'; style-src * 'self' blob: data: 'unsafe-inline'; img-src * 'self' blob: data: http: https:; connect-src * 'self' blob: data: ws: wss: http: https:;",

  // Production CSP - still permissive enough to allow external APIs
  productionCSP: "default-src * 'self' blob: data: ws: wss: http: https: 'unsafe-inline' 'unsafe-eval'; script-src * 'self' blob: data: 'unsafe-inline' 'unsafe-eval'; style-src * 'self' blob: data: 'unsafe-inline'; img-src * 'self' blob: data: http: https:; connect-src * 'self' blob: data: ws: wss: http: https:;"
}; 