#!/usr/bin/env node
/**
 * Launcher for the xgenia MCP server, used by this plugin's .mcp.json.
 *
 * The server lives in this repo at packages/xgenia-mcp-server and its `dist/` is gitignored, so a
 * fresh clone has source but nothing to run. Rather than make the plugin depend on someone having
 * built it first — which fails as a silent "MCP server did not start" — this builds on demand.
 *
 * STDOUT IS THE MCP PROTOCOL CHANNEL. A single stray byte written to it corrupts the stream and
 * the client drops the server. So every child process here gets stdout set to 'ignore' and only
 * stderr inherited: npm's progress output, tsc's diagnostics and any warning all go to stderr,
 * where the client shows them as logs instead of feeding them to the parser.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '..', '..', '..', 'packages', 'xgenia-mcp-server');
const entry = join(serverDir, 'dist', 'index.js');

/** Build output to stderr only — see the stdout note above. */
function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: serverDir,
    stdio: ['ignore', 'ignore', 'inherit'],
    shell: process.platform === 'win32',
  });
}

if (!existsSync(serverDir)) {
  console.error(
    `[xgenia-mcp] Cannot find the server at ${serverDir}.\n`
    + `This plugin expects to live inside an XGENIA checkout, at plugins/xgenia. If you installed `
    + `it some other way, add the server by hand instead: claude mcp add xgenia -- node `
    + `<checkout>/packages/xgenia-mcp-server/dist/index.js`
  );
  process.exit(1);
}

if (!existsSync(entry)) {
  console.error('[xgenia-mcp] dist/ is missing (it is gitignored) — building it once…');
  // The repo is an npm workspace, so deps normally hoist to the root. Only install when the
  // server genuinely cannot resolve them.
  if (!existsSync(join(serverDir, 'node_modules'))
      && !existsSync(resolve(serverDir, '..', '..', 'node_modules'))) {
    run('npm', ['install', '--no-audit', '--no-fund']);
  }
  const built = run('npm', ['run', 'build']);
  if (built.status !== 0 || !existsSync(entry)) {
    console.error(
      `[xgenia-mcp] Build failed. Run it by hand to see why:\n`
      + `  cd ${serverDir} && npm install && npm run build`
    );
    process.exit(1);
  }
  console.error('[xgenia-mcp] Built. Starting.');
}

// Imported rather than spawned so the server owns this process's stdio directly — one less hop
// for the protocol stream to cross.
await import(pathToFileURL(entry).href);
