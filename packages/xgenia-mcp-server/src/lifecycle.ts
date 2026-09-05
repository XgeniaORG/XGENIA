import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import {
  appLaunchCandidates,
  killTreeCommand,
  parsePortOwnerPid,
  portOwnerCommand
} from './platform.js';
import { connect, discoverPort, resetConnection, DEFAULT_PORT, type Target } from './connection.js';
import { readProject, readChatState } from './editor-state.js';
import { openProject, saveOpenProject } from './project.js';

/** Scripts that root a `npm run dev` tree. Ordered outermost-last is irrelevant; presence is what matters. */
export const DEV_LAUNCHER_MARKERS = [
  'scripts/dev-launcher.ts',
  'scripts/start-with-private.ts',
  'scripts/start.ts'
];

export function isDevLauncher(command: string): boolean {
  return DEV_LAUNCHER_MARKERS.some((m) => command.includes(m));
}

/**
 * Choose which process's tree to kill, given the ancestry leaf-first.
 *
 * For a dev run the Electron process is a great-grandchild of the launcher, and
 * webpack-dev-server sits between them holding :8080. Killing the leaf leaves
 * webpack alive and the next launch collides on that port, so climb to the
 * outermost launcher script in the chain. A packaged app has no launcher above
 * it, so the leaf is correct there.
 *
 * POSIX only: on win32 the caller must never reach this (see killTree) because
 * `processChain` shells out to `ps`, which does not exist there.
 */
export function pickKillRoot(chain: { pid: number; command: string }[]): number {
  let root: number | null = null;
  for (const link of chain) {
    if (isDevLauncher(link.command)) root = link.pid;
  }
  return root ?? chain[0]?.pid ?? 0;
}

function processChain(pid: number): { pid: number; command: string }[] {
  const chain: { pid: number; command: string }[] = [];
  let current = pid;
  for (let i = 0; i < 24 && current > 1; i += 1) {
    try {
      const out = execFileSync('ps', ['-o', 'ppid=,command=', '-p', String(current)], {
        encoding: 'utf8'
      }).trim();
      if (!out) break;
      const match = out.match(/^\s*(\d+)\s+(.*)$/s);
      if (!match) break;
      chain.push({ pid: current, command: match[2] });
      current = Number(match[1]);
    } catch {
      break;
    }
  }
  return chain;
}

function portOwner(port: number): number | null {
  const { cmd, args } = portOwnerCommand(port);
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8' });
    // The port is passed through so netstat's unfiltered TCP table (win32) is
    // matched to the right listener instead of returning whichever row is
    // first — see the Correction 1 note on parsePortOwnerPid.
    return parsePortOwnerPid(out, process.platform, port);
  } catch {
    return null;
  }
}

/**
 * Every descendant of `pid`, deepest first.
 *
 * POSIX `kill` signals one process, and signalling the process *group* is not a
 * substitute: the launcher was started from an interactive shell and is not a
 * group leader, so `kill(-pid)` either throws or hits the shell's group. The
 * only reliable way to take down npm -> ts-node -> npm -> webpack -> electron is
 * to enumerate the tree and signal each member.
 */
export function descendantsOf(
  pid: number,
  snapshot: { pid: number; ppid: number }[]
): number[] {
  const children = new Map<number, number[]>();
  for (const row of snapshot) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid)!.push(row.pid);
  }
  const out: number[] = [];
  const walk = (p: number) => {
    for (const child of children.get(p) ?? []) walk(child);
    out.push(p);
  };
  walk(pid);
  return out;
}

function processSnapshot(): { pid: number; ppid: number }[] {
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' });
    return out
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^(\d+)\s+(\d+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]) }));
  } catch {
    return [];
  }
}

/**
 * Kill a process tree rooted at `pid`.
 *
 * Correction 2: win32 must never go through `processChain`/`pickKillRoot` at
 * all. `processChain` shells out to `ps`, which does not exist on Windows —
 * there it throws, `processChain` returns `[]`, and `pickKillRoot([])` yields
 * `0`, so `killTree(0)` would run. `taskkill /T` already walks the child
 * process tree itself, which is exactly what `pickKillRoot` + `descendantsOf`
 * exist to emulate on POSIX, so on win32 the port-owner pid is passed straight
 * to `killTreeCommand` and the ancestry walk is skipped entirely.
 */
function killTree(pid: number, force: boolean): void {
  if (process.platform === 'win32') {
    const { cmd, args } = killTreeCommand(pid, process.platform, force);
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
    } catch {
      // Already gone.
    }
    return;
  }

  // Children first, so a supervisor cannot respawn what we just killed.
  for (const target of descendantsOf(pid, processSnapshot())) {
    try {
      process.kill(target, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      // Already gone.
    }
  }
}

export function recoveryFilePath(): string {
  return path.join(os.tmpdir(), 'xgenia-harness', 'recovery.json');
}

function writeRecovery(data: unknown): void {
  const file = recoveryFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function readRecovery(): { dir?: string; target?: Target } | null {
  try {
    return JSON.parse(fs.readFileSync(recoveryFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

async function waitForEditor(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    resetConnection();
    try {
      const { page } = await connect(port);
      const ready = await page.evaluate(
        () => typeof (window as unknown as Record<string, unknown>).ProjectModel !== 'undefined'
      );
      if (ready) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function repoRoot(): string | null {
  const override = process.env.XGENIA_REPO_DIR;
  if (override) return fs.existsSync(path.join(override, 'packages/xgenia-editor')) ? override : null;
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'packages', 'xgenia-editor'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/**
 * Build the child environment for a spawned XGENIA process.
 *
 * Correction 3: this session's shell can inherit `ELECTRON_RUN_AS_NODE=1`
 * from an Electron-based IDE's extension host (VS Code, Cursor, Antigravity,
 * and similar all export it for their own embedded Node use). With that set,
 * the `electron` binary runs as plain Node instead of Electron: `require('electron')`
 * then returns a path string rather than the API, so anything destructuring
 * `.app` off it gets `undefined` — the observed real failure was
 * `TypeError: Cannot read properties of undefined (reading 'getVersion')`
 * inside electron-updater on launch. `ELECTRON_NO_ATTACH_CONSOLE` is stripped
 * alongside it for the same class of inherited-Electron-env problem. Do not
 * remove this stripping "to simplify" — without it, the harness's own spawn
 * reproduces the exact failure that motivated it.
 */
function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function spawnApp(): boolean {
  for (const { cmd, args, probe } of appLaunchCandidates()) {
    if (cmd !== 'open' && !fs.existsSync(probe)) continue;
    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: childEnv() });
      child.unref();
      return true;
    } catch {
      // Try the next candidate.
    }
  }
  return false;
}

function spawnDev(root: string): boolean {
  const logDir = path.join(os.tmpdir(), 'xgenia-harness');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'dev.log'), 'a');
  const child = spawn('npm', ['run', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: childEnv()
  });
  child.unref();
  return true;
}

function fail(code: string, tried: string, hint: string) {
  return { error: code, tried, hint };
}

export async function launch(opts: { target?: Target | 'auto' } = {}) {
  const requested = opts.target ?? 'auto';

  // Already up?
  try {
    const { page, target, port } = await connect();
    return { launched: false, attached: true, target, port, project: await readProject(page) };
  } catch {
    // Not running; fall through.
  }

  const root = repoRoot();
  let chosen: Target;
  if (requested === 'app') chosen = 'app';
  else if (requested === 'dev') chosen = 'dev';
  else chosen = appLaunchCandidates().some(({ probe }) => fs.existsSync(probe)) ? 'app' : 'dev';

  if (chosen === 'dev' && !root) {
    return fail(
      'not-running',
      `app candidates: ${appLaunchCandidates().map((c) => c.probe).join(', ')}; repo: ${process.cwd()}`,
      'No installed XGENIA and no repo checkout found. Set XGENIA_APP_PATH or XGENIA_REPO_DIR.'
    );
  }

  const started = chosen === 'app' ? spawnApp() : spawnDev(root!);
  if (!started) {
    return fail('not-running', `target ${chosen}`, 'Could not start XGENIA.');
  }

  const timeout = chosen === 'app' ? 90_000 : 240_000;
  const port = process.env.XGENIA_CDP_PORT ? discoverPort() : DEFAULT_PORT;
  const ready = await waitForEditor(port, timeout);
  if (!ready) {
    return fail(
      'timeout',
      `waited ${timeout}ms for the editor page on ${port}`,
      chosen === 'dev' ? 'Check the dev log in the temp directory.' : 'Is XGENIA installed?'
    );
  }

  const { page, target } = await connect(port);
  return { launched: true, attached: false, target, port, project: await readProject(page) };
}

export async function restart(opts: { force?: boolean } = {}) {
  const { page, target, port } = await connect();

  const project = await readProject(page);
  const chat = await readChatState(page);

  if (chat.busy && !opts.force) {
    return fail(
      'busy-refused',
      'chat is mid-generation',
      'An AI turn is in flight and would be lost. Wait, or pass force to restart anyway.'
    );
  }

  writeRecovery({ dir: project?.dir ?? null, target, savedAt: Date.now() });

  // Ask the editor to save the way its own save does.
  if (project?.dir) await saveOpenProject(page);

  const owner = portOwner(port);
  if (!owner) {
    return fail('not-running', `no process owns port ${port}`, 'Nothing to restart.');
  }

  // Correction 2: win32 skips the ancestry walk entirely. `taskkill /T`
  // already walks the child tree — that's the Windows equivalent of what
  // pickKillRoot/descendantsOf do on POSIX by enumerating `ps` output, which
  // doesn't exist on win32.
  const root = process.platform === 'win32' ? owner : pickKillRoot(processChain(owner));

  killTree(root, false);
  await new Promise((r) => setTimeout(r, 5000));
  if (portOwner(port)) killTree(root, true);

  // Free the dev ports too, so a relaunch cannot collide.
  if (target === 'dev') {
    for (const p of [8080, 8574, 3001, 3051]) {
      const pid = portOwner(p);
      if (pid) killTree(pid, true);
    }
  }

  resetConnection();

  const relaunched = await launch({ target });
  if ('error' in relaunched) return relaunched;

  const recovery = readRecovery();
  let reopened = null;
  if (recovery?.dir) {
    const result = await openProject({ dir: recovery.dir });
    reopened = 'error' in result ? null : result.project;
  }

  const { page: page2 } = await connect();
  const chat2 = await readChatState(page2);

  return {
    restarted: true,
    target,
    project: reopened,
    chat: { restored: chat2.mounted, messageCount: chat2.messageCount },
    inFlightTurnLost: chat.busy
  };
}
