const path = require('path');
const editorDir = path.join(__dirname, '../../xgenia-editor');
const coreLibDir = path.join(__dirname, '../');

module.exports = {
  stories: ['../src/**/*.stories.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-links',
    '@storybook/addon-essentials',
    '@storybook/addon-interactions',
    '@storybook/preset-create-react-app',
    '@storybook/addon-measure'
  ],
  framework: '@storybook/react',
  core: {
    builder: '@storybook/builder-webpack5'
  },
  webpackFinal: (config) => {
    const destinationPath = path.resolve(__dirname, '../../xgenia-editor');
    const addExternalPath = (rules) => {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i];
        if (rule.test && RegExp(rule.test).test('.tsx')) {
          if (rule.include?.length) rule.include.push(destinationPath);
          else rule.include = destinationPath;
        } else if (rule.test && RegExp(rule.test).test('.ts')) {
          if (rule.include?.length) rule.include.push(destinationPath);
          else rule.include = destinationPath;
        } else if (rule.oneOf) {
          addExternalPath(rule.oneOf);
        }
      }
    };

    addExternalPath(config.module.rules);

    config.module.rules.push({
      test: /\.ts$/,
      use: [
        {
          loader: require.resolve('ts-loader')
        }
      ]
    });

    config.resolve.alias = {
      ...config.resolve.alias,
      '@xgenia-core-ui': path.join(coreLibDir, 'src'),
      '@xgenia-hooks': path.join(editorDir, 'src/editor/src/hooks'),
      '@xgenia-utils': path.join(editorDir, 'src/editor/src/utils'),
      '@xgenia-models': path.join(editorDir, 'src/editor/src/models'),
      '@xgenia-constants': path.join(editorDir, 'src/editor/src/constants'),
      '@xgenia-contexts': path.join(editorDir, 'src/editor/src/contexts'),
      '@xgenia-types': path.join(editorDir, 'src/editor/src/types'),
      '@xgenia-views': path.join(editorDir, 'src/editor/src/views')
    };

    return config;
  }
};
