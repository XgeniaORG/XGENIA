//shared config for regular (non-deploy) viewer

const path = require('path');
const { merge } = require('webpack-merge');
const { outPath, runtimeVersion } = require('./constants.js');
const common = require('./webpack.common.js');
const webpack = require('webpack');

const {CleanWebpackPlugin} = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const GenerateJsonPlugin = require('generate-json-webpack-plugin');

const xgeniaEditorExternalViewerPath = path.join(outPath, 'cloudruntime');

// function stripStartDirectories(targetPath, numDirs) {
//   const p = targetPath.split('/');
//   p.splice(0, numDirs);
//   return p.join(path.sep);
// }

function stripStartDirectories(targetPath) {
  return path.basename(targetPath);
}

const prefix = `const { ipcRenderer } = require('electron'); const _xgenia_cloud_runtime_version = "${runtimeVersion}";`;

module.exports = merge(common, {
  entry: {
    sandbox: './src/sandbox.viewer.js'
  },
  output: {
    filename: 'sandbox.viewer.bundle.js',
    path: xgeniaEditorExternalViewerPath
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: prefix,
      raw: true
    }),
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [xgeniaEditorExternalViewerPath],
      dangerouslyAllowCleanPatternsOutsideProject: true,
      dry: false
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'static/viewer/**/*',
          // to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        }
      ]
    }),
    new GenerateJsonPlugin('manifest.json', {
      version: runtimeVersion
    })
  ]
});
