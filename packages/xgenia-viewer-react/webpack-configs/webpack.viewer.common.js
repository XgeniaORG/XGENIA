//shared config for regular (non-deploy) viewer

const path = require('path');
const { merge } = require('webpack-merge');
const { outPath } = require('./constants.js');
const common = require('./webpack.common.js');

// const CleanWebpackPlugin = require('clean-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const CopyWebpackPlugin = require('copy-webpack-plugin');

const xgeniaEditorExternalViewerPath = path.join(outPath, 'viewer');

// function stripStartDirectories(targetPath, numDirs) {
//   const p = targetPath.split('/');
//   p.splice(0, numDirs);
//   return p.join(path.sep);
// }

function stripStartDirectories(targetPath) {
  return path.basename(targetPath);
}

module.exports = merge(common, {
  entry: {
    viewer: './index.viewer.js'
  },
  output: {
    filename: 'xgenia.[name].js',
    path: xgeniaEditorExternalViewerPath,
    publicPath: '/'
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [xgeniaEditorExternalViewerPath],
      dangerouslyAllowCleanPatternsOutsideProject: true,
      dry: false
    }),

    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'static/shared/**/*',
          // to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        },
        {
          from: 'static/viewer/**/*',
          // to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        }
      ]
    })
  ]
});
