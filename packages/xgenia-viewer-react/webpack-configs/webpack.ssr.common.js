const path = require('path');
const { outPath } = require('./constants.js');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const CopyWebpackPlugin = require('copy-webpack-plugin');

const xgeniaEditorExternalSsrPath = path.join(outPath, 'ssr');

// function stripStartDirectories(targetPath, numDirs) {
//   const p = targetPath.split('/');
//   p.splice(0, numDirs);
//   return p.join(path.sep);
// }

function stripStartDirectories(targetPath) {
  return path.basename(targetPath);
}


module.exports = {
  entry: {
    deploy: './index.ssr.js'
  },
  output: {
    filename: 'xgenia.[name].js',
    path: xgeniaEditorExternalSsrPath
  },
  plugins: [
    new CleanWebpackPlugin({
      cleanOnceBeforeBuildPatterns: [xgeniaEditorExternalSsrPath],
      dangerouslyAllowCleanPatternsOutsideProject: true,
      dry: false
    }),
    
    new CopyWebpackPlugin({
      patterns: [
        {
          from: 'static/ssr/**/*',
          // to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename, 2)
          to: ({ absoluteFilename }) => stripStartDirectories(absoluteFilename)
        }
      ]
    })
    
  ],
  externals: {
    react: 'React',
    'react-dom': 'ReactDOM'
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
    fallback: {
      events: require.resolve('events/')
    }
  },
  module: {
    rules: [
      {
        test: /\.(jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            babelrc: false,
            cacheDirectory: true,
            presets: ['@babel/preset-react', '@babel/preset-env']
          }
        }
      },
      {
        test: /\.ts(x?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      },
      {
        test: /\.css$/i,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              url: false,
              modules: {
                exportOnlyLocals: true
              }
            }
          }
        ]
      }
    ]
  }
};
