const path = require('path');
const merge = require('webpack-merge').default;
const TerserPlugin = require('terser-webpack-plugin');
const shared = require('./shared/webpack.shared.js');
const getExternalModules = require('./helpers/get-externals-modules');

module.exports = merge(shared, {
  mode: 'production',
  target: 'electron-main',
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          ecma: 2020,
          compress: {
            drop_console: true,
          },
        },
      }),
    ],
  },
  externals: getExternalModules({
    production: true
  }),
  entry: {
    'main/main': './src/main/main.js'
  },
  output: {
    path: path.join(__dirname, '../dist'),
    filename: '[name].bundle.js',
    // https://github.com/webpack/webpack/issues/1114
    libraryTarget: 'commonjs2'
  }
});
