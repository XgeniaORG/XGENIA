const webpack = require('webpack');
const { merge } = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const common = require('./webpack.deploy.common.js');

module.exports = merge(common, {
  mode: 'production',
  devtool: false,
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        test: /xgenia\.deploy\.js$/,
        parallel: true,
        extractComments: false,
        terserOptions: {
          ecma: 2020,
          parse: {
            ecma: 2020
          },
          compress: {
            ecma: 2020,
            passes: 2
          },
          mangle: true,
          format: {
            ecma: 2020,
            comments: false
          }
        }
      })
    ],
    moduleIds: 'deterministic',
    splitChunks: false,
    runtimeChunk: false,
    chunkIds: 'deterministic',
    mergeDuplicateChunks: true,
    removeEmptyChunks: true,
    removeAvailableModules: false,
    sideEffects: false,
    usedExports: false,
    concatenateModules: true,
    innerGraph: false,
    mangleExports: false
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      filename: 'xgenia.[name].js.map',
      noSources: true,
      columns: false,
      module: true
    })
  ],
  output: {
    filename: 'xgenia.[name].js',
    // Use chunk ID for unnamed dynamic imports (prevents missing file names like 'undefined')
    chunkFilename: 'xgenia.[name].js',
    chunkLoadingGlobal: undefined,
    chunkLoadTimeout: undefined,
    crossOriginLoading: false,
    globalObject: 'this',
    // Use 'auto' so Webpack derives the publicPath from the script URL (respects %baseUrl%)
    publicPath: '',
    library: {
      type: 'umd'
    },
    iife: true,
    uniqueName: 'xgenia'
  },
  experiments: {
    topLevelAwait: false,
    asyncWebAssembly: false,
    lazyCompilation: false
  },
  resolve: {
    fallback: {
      fs: false,
      path: false,
      crypto: false
    }
  }
});
