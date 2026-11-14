const path = require('path');
const fs = require('fs');
const { optionalAlias } = require('../helpers/optional-alias');

// NOTE: packagesDir will be resolved to packages by the build system too
const editorDir = path.join(__dirname, '../../');
const packagesDir = path.join(__dirname, '../../../');
const rootDir = path.join(__dirname, '../../../../');

console.log('--- Webpack Configuration');
console.log('> Editor path: ', editorDir);
console.log('> Packages path: ', packagesDir);
console.log('---');

const xgeniaAiSrcPath = path.join(rootDir, 'private/xgenia-ai/src');
const hasXgeniaAi = fs.existsSync(xgeniaAiSrcPath);
if (hasXgeniaAi) {
  console.log('[Webpack] @xgenia-ai detected, using:', xgeniaAiSrcPath);
} else {
  console.log('[Webpack] @xgenia-ai not found, using stubs for build compatibility');
}

// Optional project extensions: the stub keeps builds without the private checkout working.
const projectExtensionsPath = optionalAlias(
  path.join(rootDir, 'private/xgenia-puppet/editor-extension'),
  path.join(editorDir, 'src/stubs/project-extensions/index.js')
);
console.log('[Webpack] @xgenia/project-extensions:', projectExtensionsPath);

// The FX Studio (RevoltFX particle editor) is private; open-source builds get a stub that opens nothing.
const fxStudioPath = optionalAlias(
  path.join(rootDir, 'private/xgenia-fx-studio/src'),
  path.join(editorDir, 'src/stubs/fx-studio/index.js')
);
console.log('[Webpack] @xgenia/fx-studio:', fxStudioPath);

const alias = {
  '@xgenia-ai': hasXgeniaAi ? xgeniaAiSrcPath : path.join(editorDir, 'src/stubs/xgenia-ai'),
  '@scss-placeholders': path.join(editorDir, 'src/editor/src/styles/placeholders'),
  '@scss-mixins': path.join(editorDir, 'src/editor/src/styles/mixins'),
  '@scss-variables': path.join(editorDir, 'src/editor/src/styles/variables'),
  '@xgenia-core-ui': path.join(packagesDir, 'xgenia-core-ui/src'),
  '@xgenia-hooks': path.join(editorDir, 'src/editor/src/hooks'),
  '@xgenia-utils': path.join(editorDir, 'src/editor/src/utils'),
  '@xgenia-models': path.join(editorDir, 'src/editor/src/models'),
  '@xgenia-constants': path.join(editorDir, 'src/editor/src/constants'),
  '@xgenia-contexts': path.join(editorDir, 'src/editor/src/contexts'),
  '@xgenia-types': path.join(editorDir, 'src/editor/src/types'),
  '@xgenia-views': path.join(editorDir, 'src/editor/src/views'),
  '@xgenia-store': path.join(editorDir, 'src/editor/src/store'),
  // Additional aliases for ChatPanel decoupling (private/xgenia-ai)
  '@xgenia-shared': path.join(editorDir, 'src/shared'),
  '@xgenia-services': path.join(editorDir, 'src/editor/src/services'),
  '@xgenia-editor-views': path.join(editorDir, 'src/editor/src/views'),
  '@xgenia-editor': path.join(editorDir, 'src/editor/src'),
  '@xgenia/image-editor': path.join(rootDir, 'private/xgenia-image-editor/src'),
  '@xgenia/coach': path.join(rootDir, 'private/xgenia-coach/src'),
  '@xgenia/project-extensions': projectExtensionsPath,
  '@xgenia/fx-studio': fxStudioPath
};

console.log('> alias:');
console.log(JSON.stringify(alias, null, 2));
console.log('---');

module.exports = {
  output: {
    // https://github.com/webpack/webpack/issues/1114
    libraryTarget: 'commonjs2'
  },
  resolve: {
    extensions: ['.js', '.jsx', '.json', '.ts', '.tsx', '.ttf'],
    alias
  }
};