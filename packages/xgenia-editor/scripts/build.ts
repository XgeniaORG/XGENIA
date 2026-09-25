import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';

import { valueToBoolean } from '../../../scripts/helper';
import { BuildTarget, getDistPlatform } from './platform/build-platforms';

function withNodeHeap(env: NodeJS.ProcessEnv, maxOldSpaceSizeMb = 8192): NodeJS.ProcessEnv {
  const desiredFlag = `--max-old-space-size=${maxOldSpaceSizeMb}`;
  const existing = env.NODE_OPTIONS ?? '';

  // Replace any existing heap setting; otherwise append.
  const replaced = existing.replace(/--max-old-space-size=\d+/g, '').trim();
  const next = `${replaced} ${desiredFlag}`.trim();

  return {
    ...env,
    NODE_OPTIONS: next
  };
}

// Load environment variables from .env file
dotenv.config();

(async function () {
  // Inputs
  const DISABLE_SIGNING = valueToBoolean(process.env.DISABLE_SIGNING);
  const TARGET_PLATFORM = process.env.TARGET_PLATFORM;
  const CSC_NAME = process.env.CSC_NAME;

  // Clean dist directory
  const distPath = path.join(__dirname, '../dist');
  rmSync(distPath, { recursive: true, force: true });

  if (!TARGET_PLATFORM) throw new Error('TARGET_PLATFORM is falsy');

  // Variables
  const [platform, arch] = TARGET_PLATFORM.trim().split('-');
  // @ts-expect-error TODO: Add validation on the input.
  const target: BuildTarget = { platform, arch };

  // Debug Configuration
  console.log('@ -> packages/xgenia-editor/scripts/build.ts');
  console.log('--- Configuration');
  console.log('> DISABLE_SIGNING: ', DISABLE_SIGNING);
  console.log('> TARGET_PLATFORM: ', TARGET_PLATFORM);
  console.log('---');

  // Build Renderer
  console.log("--- Run webpack 'webpack.renderer.production.js' ...");
  execSync('npx webpack --config=webpackconfigs/webpack.renderer.production.js', {
    stdio: 'inherit',
    env: withNodeHeap(process.env)
  });
  console.log('--- done!');

  // Copy the generated bundle to the expected location
  console.log('--- Copying bundles to src/editor/ ...');

  // 1. Copy the main entry bundle
  execSync('cp dist/bundles/src/editor/index.bundle.js src/editor/', {
    stdio: 'inherit',
    env: process.env
  });

  // 2. Copy all other bundles (workers, shared chunks) from dist/bundles/ root to src/editor/bundles/
  try {
    // Ensure src/editor/bundles exists
    mkdirSync('src/editor/bundles', { recursive: true });

    // Copy all .js files from dist/bundles/ to src/editor/bundles/
    // This catches worker bundles (*.worker.bundle.js) and any split chunks.
    if (process.platform === 'win32') {
      // Windows fallback (simplified)
      execSync('copy dist\\bundles\\*.js src\\editor\\bundles\\', { stdio: 'inherit', env: process.env });
    } else {
      execSync('find dist/bundles -maxdepth 1 -name "*.js" -exec cp {} src/editor/bundles/ \\;', {
        stdio: 'inherit',
        env: process.env
      });
    }
  } catch (e: any) {
    console.warn('Warning: Failed to copy additional bundles. Syntax highlighting or lazy loading might fail.');
    console.error(e);
  }

  console.log('--- done!');

  // Build Main
  console.log("--- Run webpack 'webpack.main.production.js' ...");
  execSync('npx webpack --config=webpackconfigs/webpack.main.production.js', {
    stdio: 'inherit',
    env: withNodeHeap(process.env)
  });
  console.log('--- done!');

  // Ensure the packaged app loads the fresh main bundle
  // Copy dist/main/main.bundle.js -> src/main/
  console.log('--- Copying main.bundle.js to src/main/ ...');
  execSync('cp dist/main/main.bundle.js src/main/', {
    stdio: 'inherit',
    env: process.env
  });
  console.log('--- done!');

  const platformName = getDistPlatform(target.platform);
  const args = [`--${platformName}`, `--${target.arch}`, '--publish', 'never'].join(' ');

  // The game viewer carries the pro-node runtime (it has to run it), and is built unminified with
  // comments for development and the engine drift tests. A release ships it minified instead:
  // mangled locals, no comments. Function and class names are kept (engine code reads them). The
  // readable copy is restored afterwards, so dev and tests never see the minified one.
  // Opt-in (XGENIA_MINIFY_VIEWER=1) and NOT recommended for releases (tested 2026-09-25): node
  // scripts are matched against the built-in functions' source text to decide which functions a
  // user changed. Minified built-ins never match, so every script function gets applied, the
  // untouched ones fail on build-time identifiers (external_window_React_default, ...) and fall
  // back with a warning on every node. The game still plays, but the warnings mislead users and
  // the AI. (Measured: 19.9 MB → 7.6 MB, readable pro-node lines 2,002 → 62.)
  const viewerPath = path.join(__dirname, '../src/external/viewer/xgenia.viewer.js');
  const viewerBackup = viewerPath + '.readable';
  const minifyViewer = process.env.XGENIA_MINIFY_VIEWER === '1' && existsSync(viewerPath);
  if (minifyViewer) {
    console.log('--- Minifying xgenia.viewer.js for the release ...');
    copyFileSync(viewerPath, viewerBackup);
    const { minify } = require('terser');
    const out = await minify(readFileSync(viewerBackup, 'utf8'), {
      ecma: 2020,
      compress: { passes: 1 },
      mangle: { keep_fnames: true, keep_classnames: true },
      keep_fnames: true,
      keep_classnames: true,
      format: { comments: false }
    });
    if (!out.code) throw new Error('terser produced no output for xgenia.viewer.js');
    writeFileSync(viewerPath, out.code);
    console.log(`--- done! (${statSync(viewerBackup).size} → ${statSync(viewerPath).size} bytes)`);
  }

  try {
    console.log(`--- Run: 'npx electron-builder ${args}' ...`);
    execSync('npx electron-builder ' + args, {
      stdio: [0, 1, 2],
      env: Object.assign(
        DISABLE_SIGNING
          ? {}
          : {
              CSC_NAME
            },
        withNodeHeap(process.env)
      )
    });
  } finally {
    if (minifyViewer && existsSync(viewerBackup)) {
      copyFileSync(viewerBackup, viewerPath);
      rmSync(viewerBackup);
      console.log('--- Restored the readable xgenia.viewer.js');
    }
  }
})();
