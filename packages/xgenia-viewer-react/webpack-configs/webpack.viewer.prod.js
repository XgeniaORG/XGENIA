const { merge } = require('webpack-merge');
const common = require('./webpack.viewer.common.js');

module.exports = merge(common, {
  mode: 'production',
  // No sourcemaps: the viewer ships in the app and the map would carry the private node source.
  devtool: false,
  optimization: {
    minimize: false
  }
});
