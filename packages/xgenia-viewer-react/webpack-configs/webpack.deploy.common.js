const path = require('path');
const { merge } = require('webpack-merge');
const { outPath } = require('./constants.js');
const common = require('./webpack.common.js');

const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');

const xgeniaEditorExternalDeployPath = path.join(outPath, 'deploy');

function stripStartDirectories(targetPath) {
  return path.basename(targetPath);
}

module.exports = merge(common, {
  entry: {
    deploy: './index.deploy.js'
  },
  output: {
    filename: 'xgenia.[name].js',
    path: xgeniaEditorExternalDeployPath
  },
  externals: {
    react: 'React',
    'react-dom': 'ReactDOM',
    'react-dom/client': 'ReactDOM'
  },
  // performance: {
  //   maxEntrypointSize: 16384000,
  //   maxAssetSize: 16384000
  // },
  plugins: [
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [xgeniaEditorExternalDeployPath],
      dangerouslyAllowCleanPatternsOutsideProject: true,
      dry: false
    }),

    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'static/shared/**/*',
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        },
        {
          from: 'static/deploy/**/*',
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        }
      ]
    })
  ]
});

// const path = require('path');
// const { merge } = require('webpack-merge');
// const { outPath } = require('./constants.js');
// const common = require('./webpack.common.js');

// const { CleanWebpackPlugin } = require('clean-webpack-plugin');

// const CopyWebpackPlugin = require('copy-webpack-plugin');

// const xgeniaEditorExternalDeployPath = path.join(outPath, 'deploy');

// function stripStartDirectories(targetPath, numDirs) {
//   const p = targetPath.split('/');
//   p.splice(0, numDirs);
//   return p.join(path.sep);
// }

// module.exports = merge(common, {
//   entry: {
//     deploy: './index.deploy.js'
//   },
//   output: {
//     filename: 'xgenia.[name].js',
//     path: xgeniaEditorExternalDeployPath
//   },
//   plugins: [
//     new CleanWebpackPlugin({
//       cleanOnceBeforeBuildPatterns: [xgeniaEditorExternalDeployPath]
//     }),
//     new CopyWebpackPlugin({
//       patterns: [
//         {
//           from: 'static/shared/**/*',
//           to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
//         },
//         {
//           from: 'static/deploy/**/*',
//           to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
//         }
//       ]
//     })

//   ]
// });
