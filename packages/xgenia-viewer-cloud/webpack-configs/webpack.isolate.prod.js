const path = require('path');
const { runtimeVersion } = require('./constants.js');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

const prefix = `const _xgenia_cloud_runtime_version = "${runtimeVersion}";`;

module.exports = {
  mode: 'production',
  entry: './src/sandbox.isolate.js',
  target: 'node',
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
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  output: {
    path: path.resolve(__dirname, '../dist')
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: prefix,
      raw: true
    })
  ]
};
