const path = require('path');
const merge = require('webpack-merge').default;
const shared = require('./webpack.shared.js');
const sharedCore = require('./webpack.renderer.core.js');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

const editorPath = path.resolve(__dirname, '../../');
const rootPath = path.resolve(__dirname, '../../../../');

module.exports = merge(
  sharedCore,
  merge(shared, {
    entry: {
      './src/editor/index': './src/editor/index.ts',
      './src/frames/viewer-frame/index': './src/frames/viewer-frame/index.js'
    },
    output: {
      filename: '[name].bundle.js',
      // https://github.com/webpack/webpack/issues/1114
      libraryTarget: 'commonjs2'
    },
    // Add resolve.fallback for node built-ins that some ES modules depend on
    resolve: {
      alias: {
        '@xgenia-editor-views': path.resolve(__dirname, '../../src/editor/src/views/'),
        '@xgenia-editor': path.resolve(__dirname, '../../src/editor/src/'),
        react: path.resolve(__dirname, '../../../../node_modules/react'),
        'react-dom': path.resolve(__dirname, '../../../../node_modules/react-dom'),
        '@xgenia/image-editor': path.resolve(rootPath, 'private/xgenia-image-editor/src'),
      },
      fallback: {
        path: require.resolve('path-browserify'),
        fs: false,
        util: require.resolve('util/'),
        stream: require.resolve('stream-browserify'),
        buffer: require.resolve('buffer/'), // Adding back buffer
        process: require.resolve('process/browser'), // Adding back for 'process'
        'process/browser': require.resolve('process/browser'), // Adding back for 'process/browser'
        http: require.resolve('stream-http'),
        https: require.resolve('https-browserify'),
        url: require.resolve('url/'),
        assert: require.resolve('assert/'),
        zlib: require.resolve('browserify-zlib')
      }
      // extensionAlias: { // Removing this for now
      //   '.mjs': {
      //     'process/browser': ['process/browser.js']
      //   }
      // }
    },
    module: {
      rules: [
        // { // Removing imports-loader for now
        //   test: /\.(m?js|tsx?)$/,
        //   exclude: /node_modules[\\/](?!(@anthropic-ai[\\/]sdk))/,
        //   loader: 'imports-loader',
        //   options: {
        //     imports: [
        //       {
        //         syntax: 'default',
        //         moduleName: 'process/browser',
        //         name: 'process',
        //       },
        //     ],
        //   },
        // },
        {
          test: /\.mjs$/,
          resolve: {
            fullySpecified: false // Allow .mjs files to import without extensions
          }
        }
      ]
    },
    plugins: [
      new MonacoWebpackPlugin({
        languages: ['typescript', 'javascript', 'css']
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(editorPath, 'src/editor/index.html'),
        filename: 'src/editor/index.html',
        chunks: ['./src/editor/index'],
        inject: process.env.NODE_ENV === 'development',
        templateParameters: {
          devMode: process.env.devMode === 'yes' || process.env.NODE_ENV === 'development'
        }
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(editorPath, 'src/assets'),
            to: path.resolve(editorPath, 'dist/src/assets'),
            globOptions: {
              ignore: ['**/.*']
            }
          }
        ]
      }),
      // Add polyfill plugins for browser environment
      new webpack.ProvidePlugin({
        process: 'process/browser',
        Buffer: ['buffer', 'Buffer'],
      }),
      // Inject the real platform at build time so it survives the
      // process/browser polyfill (which sets process.platform to undefined).
      new webpack.DefinePlugin({
        'process.platform': JSON.stringify(process.platform)
      })
    ]
  })
);
