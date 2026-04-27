const { merge } = require('webpack-merge');
const path = require('path'); // Need path for resolving static dir
const common = require('./webpack.viewer.common.js');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'inline-source-map',
  watch: true,
  devServer: {
    port: 8576,
    host: 'localhost',
    // Serve static files directly from the source static/viewer directory
    // Webpack will serve the bundled JS ('/xgenia.viewer.js') from memory
    static: {
      // Use path.resolve to get the absolute path to static/viewer
      directory: path.resolve(__dirname, '../static/viewer'), 
      publicPath: '/', // Serve static files from the root
    },
    // Ensure requests to the root path serve index.html
    historyApiFallback: {
      index: '/index.html' 
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    hot: true,
    proxy: {
      '/': {
        target: 'http://localhost:8080',
        secure: false,
        bypass: function(req, res, opt) {
          if (req.originalUrl.startsWith('/xgenia.viewer.js') || req.originalUrl.startsWith('/ndl_assets')) {
            return req.originalUrl;
          }
          return null;
        }
      }
    }
  },
});
