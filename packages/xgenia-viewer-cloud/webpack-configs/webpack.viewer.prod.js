const { merge } = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const common = require('./webpack.viewer.common.js');

module.exports = merge(common, {
  mode: 'production',
  devtool: 'source-map',
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
});
