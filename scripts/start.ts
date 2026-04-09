import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

import { ConsoleColor, attachStdio } from './utils/process';

// Constants
// Use realpath to normalize drive/folder casing on Windows to avoid mixed-case module paths in webpack
const CWD = fs.realpathSync.native(path.join(__dirname, '..'));
const LOCAL_GIT_DIRECTORY = path.join(CWD, 'node_modules', 'dugite', 'git');
const LOCAL_GIT_TRAMPOLINE_DIRECTORY = path.join(
  CWD,
  'node_modules',
  'desktop-trampoline/build/Release/desktop-trampoline'
);

// Debug logs
console.log('---');
console.log(`> CWD: ${CWD}`);
console.log(`> LOCAL_GIT_DIRECTORY: ${LOCAL_GIT_DIRECTORY}`);
console.log(`> LOCAL_GIT_TRAMPOLINE_DIRECTORY: ${LOCAL_GIT_TRAMPOLINE_DIRECTORY}`);
console.log('---');

// Process options
const processOptions = {
  cwd: CWD,
  env: {
    ...process.env,
    LOCAL_GIT_DIRECTORY,
    LOCAL_GIT_TRAMPOLINE_DIRECTORY
  }
};

// Process tracking
let cloudRuntimeProcess: ReturnType<typeof attachStdio> | null = null;
let mcpProxyProcess: ReturnType<typeof attachStdio> | null = null;
let editorProcess: ReturnType<typeof attachStdio> | null = null;
// let deepSearchProcess: ReturnType<typeof attachStdio> | null = null;

// Port check and kill if needed
function killPort(port: number) {
  const { execSync } = require('child_process');
  try {
    const result = execSync(`lsof -ti tcp:${port}`);
    if (result.length > 0) {
      const pid = result.toString().trim();
      console.log(`> Port ${port} is in use. Killing process ${pid}...`);
      execSync(`kill -9 ${pid}`);
    }
  } catch (err) {
    console.log(`> Port ${port} is free.`);
  }
}

// Cleanup handler
function cleanUpAndExit(code = 0) {
  console.log('\n> Cleaning up child processes...');
  if (cloudRuntimeProcess) cloudRuntimeProcess.kill();
  if (mcpProxyProcess) mcpProxyProcess.kill();
  if (editorProcess) editorProcess.kill();
  // if (deepSearchProcess) deepSearchProcess.kill();
  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('\n> Caught interrupt signal (Ctrl+C)');
  cleanUpAndExit(0);
});

// Step 1: Start Cloud Runtime immediately
cloudRuntimeProcess = attachStdio(
  exec('npx lerna exec --scope @xgenia/cloud-runtime -- npm run start', processOptions),
  {
    prefix: 'Cloud',
    color: ConsoleColor.FgBlue
  }
);
cloudRuntimeProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Cloud Runtime exited unexpectedly with code ${code}`);
    cleanUpAndExit(code);
  }
});

console.log('> MCP servers compiled successfully');

// Step 1.5: Kill port 3001 if in use (MCP Proxy port) and start MCP Proxy
killPort(3001);
console.log('> Starting MCP Proxy...');
mcpProxyProcess = attachStdio(exec('npx lerna exec --scope @xgenia/runtime -- npm run mcp-proxy', processOptions), {
  prefix: 'MCPProxy',
  color: ConsoleColor.FgYellow
});
mcpProxyProcess.on('exit', (code) => {
  if (code !== 0) {
    console.error(`MCP Proxy exited with code ${code}`);
    // Don't exit the whole app if MCP proxy fails, just log it
  }
});

// Step 2: Build Viewer
console.log('> Starting Viewer build...');
const viewerBuildProcess = attachStdio(
  exec('npx lerna exec --scope @xgenia/xgenia-viewer-react -- npm run build', processOptions),
  {
    prefix: 'ViewerBuild',
    color: ConsoleColor.FgMagenta
  }
);

viewerBuildProcess.on('exit', (code) => {
  if (code === 0 || code === null || code === undefined) {
    console.log('✅ Viewer build completed successfully. Starting Editor and DeepSearch...');

    // Step 3: Kill port 3051 if in use (DeepSearch port)
    killPort(3051);

    // Step 4: Start Editor
    editorProcess = attachStdio(exec('npx lerna exec --scope xgenia-editor -- npm run start', processOptions), {
      prefix: 'Editor',
      color: ConsoleColor.FgCyan
    });

    // Step 5: Start DeepSearch
    // deepSearchProcess = attachStdio(
    //   exec('npx lerna exec --scope open-deep-research -- npm run api', processOptions),
    //   {
    //     prefix: 'DeepSearch',
    //     color: ConsoleColor.FgGreen
    //   }
    // );

    // deepSearchProcess.on('exit', (code) => {
    //   if (code !== 0) {
    //     console.error(`DeepSearch exited with code ${code}`);
    //   }
    // });

    editorProcess.on('exit', (editorCode) => {
      console.log('Editor exited.');
      cleanUpAndExit(0);
    });
  } else {
    console.error(`❌ Viewer build failed with code ${code}. Aborting startup.`);
    cleanUpAndExit(code || 1);
  }
});