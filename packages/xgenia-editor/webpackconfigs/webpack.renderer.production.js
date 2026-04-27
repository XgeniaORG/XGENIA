const webpack = require('webpack');
const merge = require('webpack-merge').default;
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const shared = require('./shared/webpack.renderer.shared.js');
const getExternalModules = require('./helpers/get-externals-modules');

module.exports = merge(shared, {
  mode: 'production',
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          ecma: 2020,
          compress: {
            drop_console: true, // Removes all console.* statements
          },
        },
      }),
    ],
  },
  devtool: 'source-map',
  externals: getExternalModules({
    production: true
  }),
  output: {
    path: path.join(__dirname, '../dist'),
    filename: 'bundles/[name].bundle.js',
    assetModuleFilename: 'assets/[ext]/[name][ext]',
    sourceMapFilename: 'maps/[name].[contenthash].map',
    publicPath: './'
  },
  plugins: [
    // The ProvidePlugin is already in webpack.renderer.shared.js
  ]
});
