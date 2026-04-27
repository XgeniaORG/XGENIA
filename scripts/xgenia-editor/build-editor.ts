import { execSync } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

// import { gitSimpleDownload } from "./git/download-git";

// HACK :)
import { FileSystemNode } from '../../packages/xgenia-platform-node/src/filesystem-node';
import { getCurrentPlatform } from '../helper';

function withNodeHeap(env: NodeJS.ProcessEnv, maxOldSpaceSizeMb = 8192): NodeJS.ProcessEnv {
  const desiredFlag = `--max-old-space-size=${maxOldSpaceSizeMb}`;
  const existing = env.NODE_OPTIONS ?? '';
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
  const filesystem = new FileSystemNode();

  // Inputs
  const WORKSPACE_PATH = path.resolve(__dirname, '../..');
  const DISABLE_SIGNING = process.env.DISABLE_SIGNING;
  const TARGET_PLATFORM = process.env.TARGET_PLATFORM || getCurrentPlatform();
  const CSC_NAME = process.env.CSC_NAME;

  // Variables
  const xgeniaEditorPath = path.join(WORKSPACE_PATH, 'packages', 'xgenia-editor');
  const pkgPath = path.join(xgeniaEditorPath, 'package.json');
  const configPath = path.join(xgeniaEditorPath, 'src/shared/config/config.js');
  const configDistPath = path.join(xgeniaEditorPath, 'src/shared/config/config-dist.js');

  const [platform, arch] = TARGET_PLATFORM.trim().split('-');
  // @ts-expect-error TODO: Add validation on the input.
  const target: BuildTarget = { platform, arch };

  // Debug Configuration
  console.log('--- Configuration');
  console.log('> WORKSPACE_PATH: ', WORKSPACE_PATH);
  console.log('> TARGET_PLATFORM: ', TARGET_PLATFORM);
  console.log('---');
  console.log('> xgeniaEditorPath: ', xgeniaEditorPath);
  console.log('> pkgPath: ', pkgPath);
  console.log('> configPath: ', configPath);
  console.log('> configDistPath: ', configDistPath);
  console.log('---');

  // Update "package.json"
  console.log("--- Update 'package.json' ...");
  {
    // const rawGitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    //   env: process.env
    // });
    // const gitBranch = rawGitBranch.toString().trim().replace(/\//, '-');

    const pkg = await filesystem.readJson(pkgPath);
    pkg.main = 'src/main/main.bundle.js';
    // TODO: Set our own new versionTag
    pkg.versionTag = undefined;
    // pkg.build.publish.url = getPublishUrl() + `/${TARGET_PLATFORM}`;
    // console.log('> Auto update URL:', pkg.build.publish.url);

    await filesystem.writeJson(pkgPath, pkg);
  }

  // Replace `config.js`
  await filesystem.removeFile(configPath);
  await filesystem.copyFile(configDistPath, configPath);

  // Yup, arm64 vs x64 battle going on here ...
  console.log("--- Delete 'node_modules' ...");
  execSync('npx rimraf ./node_modules', {
    stdio: 'inherit',
    env: {
      ...withNodeHeap(process.env)
    }
  });

  // Install dependencies
  // NOTE: Getting error "Cannot set properties of null (setting 'dev')" here,
  //       It basically means that some package is not relative to this path.
  console.log("--- Run 'npm install' ...");

  if (platform === 'darwin') {
    execSync(`npm install electron-notarize`, {
      stdio: 'inherit',
      env: withNodeHeap(process.env)
    });
  }

  execSync(`npm install --arch=${arch} --scope xgenia-editor`, {
    stdio: 'inherit',
    env: withNodeHeap(process.env)
  });
  console.log("--- 'npm install' done!");

  // NOTE: npm install --arch=  does this too
  // // Download git natives for the targeted platform
  // const gitDir = path.resolve("../../node_modules/dugite/git");
  // await gitSimpleDownload({
  //   outputPath: gitDir,
  //   architecture: target.arch,
  //   platform: target.platform,
  // });

  // Build
  // Build: Replace "dugite"
  // Build: Replace "desktop-trampoline"
  console.log("--- Run 'npm run build' ...");
  execSync('npx lerna exec --scope xgenia-editor -- npm run build', {
    stdio: 'inherit',
    env: {
      ...withNodeHeap(process.env),
      TARGET_PLATFORM,
      DISABLE_SIGNING,
      CSC_NAME
    }
  });
  console.log("--- 'npm run build' done!");

  // TODO: Create a JSON with metadata example data updated in package.json
  // TODO: Create a dump of all npm packages + sizes
})();
