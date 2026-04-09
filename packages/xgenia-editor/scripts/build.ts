import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';
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
})();
