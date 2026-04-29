const webpack = require('webpack'); //this must be included for webpack to work
const child_process = require('child_process');
const merge = require('webpack-merge').default;
const shared = require('./shared/webpack.renderer.shared.js');
const getExternalModules = require('./helpers/get-externals-modules');
const path = require('path');

module.exports = merge(shared, {
  mode: 'development',
  devtool: 'eval-source-map',
  externals: process.env.WEB_MODE
    ? {
      // Electron
      'electron': 'electron',
      '@electron/remote': '@electron/remote',
      'electron-store': 'electron-store',
      // Node.js built-in modules
      'fs': 'fs',
      'path': 'path',
      'os': 'os',
      'net': 'net',
      'http': 'http',
      'https': 'https',
      'child_process': 'child_process',
      'crypto': 'crypto',
      'stream': 'stream',
      'url': 'url',
      'util': 'util',
      'zlib': 'zlib',
      'tls': 'tls',
      'dgram': 'dgram',
      'dns': 'dns',
      'tty': 'tty',
      'assert': 'assert',
      'constants': 'constants',
      'querystring': 'querystring',
      'string_decoder': 'string_decoder',
      // node: prefixed imports (e.g. import path from 'node:path')
      'node:fs': 'fs',
      'node:path': 'path',
      'node:os': 'os',
      'node:net': 'net',
      'node:http': 'http',
      'node:https': 'https',
      'node:child_process': 'child_process',
      'node:crypto': 'crypto',
      'node:stream': 'stream',
      'node:url': 'url',
      'node:util': 'util',
      'node:zlib': 'zlib',
      'node:events': 'events',
      // Node-only npm packages
      '@fal-ai/client': '@fal-ai/client',
      'fs-extra': 'fs-extra',
      'mkdirp': 'mkdirp',
      'mkdirp-sync': 'mkdirp-sync',
      'md5-file': 'md5-file',
      'archiver': 'archiver',
      'glob': 'glob',
      'rimraf': 'rimraf',
      'env-paths': 'env-paths',
      'express': 'express',
      'jquery': 'jquery',
    }
    : ['electron', '@electron/remote', 'fs', 'path', '@fal-ai/client', 'archiver', 'glob', ...getExternalModules({ production: false })],
  // Add main process entry point for dev mode
  entry: {
    './src/editor/index': './src/editor/index.ts',
    './src/frames/viewer-frame/index': './src/frames/viewer-frame/index.js',
    './src/main/main': './src/main/main.js' // Add main process entry
  },
  output: {
    publicPath: `http://localhost:8080/`
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env.devMode': JSON.stringify('yes'),
      'process.env.WEB_MODE': JSON.stringify(process.env.WEB_MODE || '')
    })
  ],
  devServer: {
    static: [
      {
        directory: path.resolve(__dirname, '../src/frames/viewer-frame'),
        publicPath: '/viewercontent'
      },
      {
        directory: path.resolve(__dirname, '../src/external/viewer'),
        publicPath: '/viewer'
      },
      {
        directory: path.resolve(__dirname, '../src/assets'),
        publicPath: '/src/assets'
      },
      {
        directory: path.resolve(__dirname, '../src/editor'),
        publicPath: '/src/editor'
      }
    ],
    headers: {
      'Content-Security-Policy':
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src * 'unsafe-inline' ws: wss: data: blob:; style-src * 'unsafe-inline' data: blob:; img-src * 'unsafe-inline' data: blob:; font-src * 'unsafe-inline' data: blob:; frame-src * 'unsafe-inline' data: blob:; object-src * 'unsafe-inline' data: blob:; media-src * 'unsafe-inline' data: blob:; child-src * 'unsafe-inline' data: blob:;"
    },
    client: {
      logging: 'warn',
      // Disable overlay to prevent `ansi_html_community` crashes in standard browsers
      overlay: false,
      // Add HMR stability settings
      webSocketTransport: 'ws',
      reconnect: 3 // Limit reconnection attempts
    },
    hot: true,
    host: 'localhost', // Default: '0.0.0.0' that is causing issues on some OS / net interfaces
    port: 8080,
    onListening(devServer) {
      if (process.env.WEB_MODE) {
        console.log('🌐 Web Mode Active. Skipping Electron spawn...');
        return;
      }

      // Start electron directly - webpack dev server handles all bundling from memory
      console.log('🚀 Starting Electron with webpack dev server...');
      child_process
        .spawn('npm', ['run', 'start:_dev'], {
          shell: true,
          env: process.env,
          stdio: 'inherit'
        })
        .on('close', (code) => {
          devServer.stop();
        })
        .on('error', (spawnError) => {
          console.error(spawnError);
          devServer.stop();
        });
    }
  },
  // Add optimization settings to reduce HMR churn
  optimization: {
    moduleIds: 'named', // Use named module IDs for better HMR
    runtimeChunk: false // Don't extract runtime to separate chunk to avoid reload loops
  }
});
