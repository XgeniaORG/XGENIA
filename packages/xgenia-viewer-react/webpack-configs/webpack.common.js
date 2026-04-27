//config shared for both regular viewer and deploy versions

const webpack = require('webpack');
const path = require('path');
const fs = require('fs');
const NormalModuleReplacementPlugin = webpack.NormalModuleReplacementPlugin;

// Get the real path with correct casing
// const projectRoot = fs.realpathSync.native ? fs.realpathSync.native(path.resolve(__dirname, '../../../')) : fs.realpathSync(path.resolve(__dirname, '../../../'));

// Check if private directory and pro-nodes package exist
// From webpack-configs/ we need to go up 3 levels to reach project root
const projectRoot = path.resolve(__dirname, '../../..');
const privateDir = path.join(projectRoot, 'private');
const proNodesDir = path.join(privateDir, 'xgenia-pro-nodes');
const proNodesPath = path.join(proNodesDir, 'dist', 'index.js');
const proNodesSrcPath = path.join(proNodesDir, 'src', 'index.js');

// Agent Nodes paths
const agentNodesDir = path.join(privateDir, 'xgenia-agent-nodes');
const agentNodesSrcPath = path.join(agentNodesDir, 'src', 'index.js');

// Only check for pro-nodes / agent-nodes if private directory exists
const hasPrivateDir = fs.existsSync(privateDir);
const hasProNodes = hasPrivateDir && (fs.existsSync(proNodesPath) || fs.existsSync(proNodesSrcPath));
const hasAgentNodes = hasPrivateDir && fs.existsSync(agentNodesSrcPath);

// Build alias object conditionally
const alias = {};
if (hasProNodes) {
  // Always use src instead of dist to avoid broken import paths
  // The source files have correct relative paths that webpack can resolve
  const proNodesSrcDir = path.join(projectRoot, 'private', 'xgenia-pro-nodes', 'src');
  const proNodesUtilsDir = path.join(proNodesSrcDir, 'utils');
  alias['@xgenia/pro-nodes'] = proNodesSrcDir;

  // Fix pixi.js import - babel transforms pixi.js to pixi.js/dist/pixi.js in dist
  // but we're using src, so we need to alias it back
  alias['pixi.js/dist/pixi.js'] = 'pixi.js';

  console.log('[Webpack] Pro-nodes detected, using src:', alias['@xgenia/pro-nodes']);
} else {
  // Create a dummy file path so webpack doesn't fail
  // The require will fail at runtime but won't break the build
  const dummyPath = path.join(__dirname, '..', 'src', 'dummy-pro-nodes.js');
  alias['@xgenia/pro-nodes'] = dummyPath;
  console.log('[Webpack] Pro-nodes not found, using dummy alias for build compatibility');
}

// Agent Nodes alias
if (hasAgentNodes) {
  const agentNodesSrcDir = path.join(projectRoot, 'private', 'xgenia-agent-nodes', 'src');
  alias['@xgenia/agent-nodes'] = agentNodesSrcDir;
  console.log('[Webpack] Agent-nodes detected, using src:', alias['@xgenia/agent-nodes']);
} else {
  const dummyPath = path.join(__dirname, '..', 'src', 'dummy-agent-nodes.js');
  alias['@xgenia/agent-nodes'] = dummyPath;
  console.log('[Webpack] Agent-nodes not found, using dummy alias for build compatibility');
}

module.exports = {
  cache: false, // Explicitly disable webpack caching
  externals: function ({ context, request }, callback) {
    if (request === 'react') {
      // Tell Webpack to find React on window.React
      // console.log(`Webpack Externals: Mapping '${request}' to global 'React'`);
      return callback(null, 'window.React');
    }
    if (request === 'react-dom') {
      // Tell Webpack to find ReactDOM on window.ReactDOM
      // console.log(`Webpack Externals: Mapping '${request}' to global 'ReactDOM'`);
      return callback(null, 'window.ReactDOM');
    }
    if (request === 'react-dom/client') {
      // Handle react-dom/client specifically - critical for React 18+ createRoot/hydrateRoot
      // console.log(`Webpack Externals: Mapping '${request}' to global 'ReactDOM'`);
      return callback(null, 'window.ReactDOM');
    }
    // Note: We're now bundling Pixi libraries instead of using them as externals

    // Continue without externalizing other requests
    callback();
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    alias: alias,
    fallback: {
      events: require.resolve('events/'),
      // fs: false,
      // path: require.resolve('path-browserify')
    }
  },
  plugins: [
    // Fix broken relative imports in pro-nodes
    ...(hasProNodes ? [
      new NormalModuleReplacementPlugin(
        /^\.\.\/\.\.\/layout$/,
        path.join(projectRoot, 'private', 'xgenia-pro-nodes', 'src', 'utils', 'layout.js')
      ),
      new NormalModuleReplacementPlugin(
        /^\.\.\/\.\.\/utils\/node-shared-port-definitions$/,
        path.join(projectRoot, 'private', 'xgenia-pro-nodes', 'src', 'utils', 'node-shared-port-definitions.js')
      ),
      new NormalModuleReplacementPlugin(
        /utils\/PixiPerformanceMonitor$/,
        path.join(__dirname, '..', 'src', 'utils', 'PixiPerformanceMonitor.js')
      ),
      new NormalModuleReplacementPlugin(
        /^\.\.\/\.\.\/node-shared-port-definitions$/,
        path.join(projectRoot, 'private', 'xgenia-pro-nodes', 'src', 'utils', 'node-shared-port-definitions.js')
      ),
      new NormalModuleReplacementPlugin(
        /^\.\.\/\.\.\/nodes\/pixi\/utils\/filterUtils$/,
        path.join(projectRoot, 'private', 'xgenia-pro-nodes', 'src', 'pixi', 'nodes', 'utils', 'filterUtils.js')
      ),
      // Deduplicate: redirect pro-nodes fontloader to the canonical viewer fontloader
      new NormalModuleReplacementPlugin(
        /xgenia-pro-nodes\/src\/utils\/fontloader(\.js)?$/,
        path.join(__dirname, '..', 'src', 'fontloader.js')
      )
    ] : [])
  ],
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            sourceType: 'unambiguous'
          }
        }
      },
      {
        test: /\.ts(x?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true, // Skip type checking to prevent TS errors from blocking HMR
              compilerOptions: {
                module: 'esnext',
                moduleResolution: 'node',
                target: 'es5',
                jsx: 'react',
                noEmit: false // Ensure output is generated
              }
            }
          }
        ]
      },
      {
        test: /\.css$/i,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              url: false
              // modules: {
              //   exportOnlyLocals: true
              // }
            }
          }
        ]
      }
    ]
  }
};
