const webpack = require('webpack');

module.exports = {
  target: 'electron-renderer',
  module: {
    rules: [
      //run babel on .jsx to transform the jsx
      //not doing it on all .js files speeds up the bundling by a lot
      {
        test: /\.(jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            babelrc: false,
            cacheDirectory: true,
            presets: ['@babel/preset-react']
          }
        }
      },
      {
        test: /\.ts(x?)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                resolveJsonModule: true
              }
            }
          }
        ]
      },
      {
        // Setup to match what we have in Storybook
        test: /\.svg$/,
        use: [
          {
            loader: '@svgr/webpack',
            options: {
              prettier: false,
              svgo: false,
              svgoConfig: {
                plugins: [
                  {
                    removeViewBox: false
                  }
                ]
              },
              titleProp: true,
              ref: true
            }
          },
          {
            loader: 'file-loader'
          }
        ]
      },
      //requiring html-files will return a string of the html
      {
        test: /\.(html)$/,
        exclude: /node_modules/,
        use: {
          loader: 'html-loader',
          options: {
            sources: false,
            esModule: false
          }
        }
      },
      {
        test: /(\.module)?.(sass|scss)$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              url: false,
              modules: {
                localIdentName: '[name]__[local]--[hash:base64:5]'
              },
              sourceMap: true
            }
          },
          'sass-loader'
        ]
      },
      {
        test: /\.css$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              url: false
            }
          },
          'postcss-loader'
        ]
      },
      {
        test: /\.(txt)$/,
        exclude: /node_modules/,
        use: {
          loader: 'raw-loader',
          options: {
            esModule: false
          }
        }
      },
      {
        test: /\.(png|jpe?g|gif|ico)$/i,
        use: [
          {
            loader: 'file-loader',
            options: {
              name: '[name].[ext]',
              outputPath: 'src/assets/images',
              publicPath: '../assets/images/'
            }
          }
        ]
      }
    ]
  },
  externals: {
    'pixi.js': 'PIXI',
    jquery: '$'
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.ttf']
  },
  plugins: [
    new webpack.HotModuleReplacementPlugin({
      // Add configuration to make HMR more stable
      multiStep: false, // Disable multi-step updates
      requestTimeout: 10000 // Increase timeout to prevent premature reloads
    })
  ]
};
