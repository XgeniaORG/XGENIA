const webpack = require('webpack');
const merge = require('webpack-merge').default;
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const shared = require('./shared/webpack.renderer.shared.js');
const getExternalModules = require('./helpers/get-externals-modules');

// A release build must never carry the developer's own service tokens. The shared config
// loads .env.local and DefinePlugin-inlines these into the renderer in plaintext; dotenv
// does not override a variable that is already set, so blanking them here keeps them out.
process.env.XGENIA_VERCEL_TOKEN = '';
process.env.XGENIA_GITHUB_TOKEN = '';

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
  // No sourcemaps in a release: they carry every original source file (sourcesContent),
  // including the private AI panel and pro nodes, into the packaged app.
  devtool: false,
  externals: getExternalModules({
    production: true
  }),
  output: {
    path: path.join(__dirname, '../dist'),
    filename: 'bundles/[name].bundle.js',
    assetModuleFilename: 'assets/[ext]/[name][ext]',
    publicPath: './'
  },
  plugins: [
    // The ProvidePlugin is already in webpack.renderer.shared.js
  ]
});
