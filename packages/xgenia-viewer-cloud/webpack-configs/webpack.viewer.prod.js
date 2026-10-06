const { merge } = require('webpack-merge');
const TerserPlugin = require('terser-webpack-plugin');
const common = require('./webpack.viewer.common.js');

module.exports = merge(common, {
  mode: 'production',
  // No sourcemaps: the viewer ships in the app and the map would carry the private node source.
  devtool: false,
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
