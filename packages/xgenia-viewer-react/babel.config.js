//babel.config.js
module.exports = function (api) {
  api.cache(false); // Explicitly disable Babel caching

  const isProduction = process.env.NODE_ENV === 'production';

  const presets = [
    [
      "@babel/preset-env",
      {
        targets: {
          esmodules: false,
          browsers: ["> 0.25%", "not dead", "ie 11"],
        },
        useBuiltIns: "usage",
        corejs: { version: 3, proposals: true },
      },
    ],
    ["@babel/preset-react", { "runtime": "automatic" }],
  ];

  const plugins = [
    "@babel/plugin-proposal-object-rest-spread",
    "@babel/plugin-proposal-class-properties",
    "@babel/plugin-transform-arrow-functions",
    "@babel/plugin-transform-destructuring",
    // Remove console.log in production builds
    ...(isProduction ? ["transform-remove-console"] : []),
  ];

  return {
    presets,
    plugins
  };
};
