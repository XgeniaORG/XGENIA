import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  appLaunchCandidates,
  killTreeCommand,
  parsePortOwnerPid,
  portOwnerCommand
} from './platform.js';
import { connect, discoverPort, resetConnection, DEFAULT_PORT, type Target } from './connection.js';
import { readProject, readChatState, type ChatState, type ProjectInfo } from './editor-state.js';
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
 *
 * Never fabricates a pid to kill. An empty chain — which happens whenever
 * `processChain` cannot read the port owner, e.g. because it exited between
 * `portOwner()` and `processChain()`, exactly the window a restart operates in
 * — or a chain that bottoms out at pid <= 1 (pid 1 is init/launchd) returns
 * `null` instead of falling back to `0`. `killTree(0)` would otherwise walk
 * every process whose ppid is 0 in the real process table (observed: 676
 * processes including pid 1 and the harness's own process) — the one defect
 * in this project that can take down the whole machine, not just a project.
 * Callers MUST abort the kill and report failure on `null`, never substitute
 * another pid.
 */
export function pickKillRoot(chain: { pid: number; command: string }[]): number | null {
  let root: number | null = null;
  for (const link of chain) {
    if (isDevLauncher(link.command)) root = link.pid;
  }
  const candidate = root ?? chain[0]?.pid ?? null;
  return candidate !== null && candidate > 1 ? candidate : null;
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
  // Refuse a root of 0 or 1 outright, independent of any caller's guard. Real
  // `ps -eo pid=,ppid=` output contains processes whose ppid is 0, so
  // descendantsOf(0, ...) would otherwise walk every one of those top-level
  // processes and everything beneath them — a machine-wide sweep, not a
  // process-tree kill. This is the last of three independent guards (the
  // others are in pickKillRoot and killTree) against that exact failure.
  if (pid <= 1) return [];
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
 * Which of `pids` are still present in `snapshot` — i.e. actually still alive.
 *
 * Used to escalate a force-kill against the pids that genuinely survived the
 * initial SIGTERM, instead of re-deriving descendants of the (by then, usually
 * already-reaped) original root from a fresh snapshot: `descendantsOf(root,
 * freshSnapshot)` taken several seconds after `root` was SIGTERMed typically
 * finds no trace of `root` in the snapshot at all, so the walk falls through
 * to returning just `[root]` again — never reaching a child, such as the
 * Electron process, that outlived its parent.
 */
export function stillAlive(pids: Iterable<number>, snapshot: { pid: number; ppid: number }[]): number[] {
  const alive = new Set(snapshot.map((row) => row.pid));
  return [...pids].filter((pid) => alive.has(pid));
}

/**
 * Kill a process tree rooted at `pid`. Returns whether anything was actually
 * signalled, so callers can distinguish "nothing to kill" from "kill attempted"
 * rather than assuming success from a `void` return.
 *
 * Refuses outright — signals nothing, returns `false` — unless `pid` is an
 * integer greater than 1. Pid 0 on POSIX targets the caller's own process
 * group, and pid 1 is init/launchd. This guard is independent of, and in
 * addition to, the ones in `pickKillRoot` and `descendantsOf`: three separate
 * checks (defense in depth) against the one defect in this project that can
 * take down the whole machine rather than just a project.
 *
 * Correction 2: win32 must never go through `processChain`/`pickKillRoot` at
 * all. `processChain` shells out to `ps`, which does not exist on Windows —
 * there it throws, `processChain` returns `[]`, and (pre-fix) `pickKillRoot([])`
 * yielded `0`, so `killTree(0)` would run. `taskkill /T` already walks the
 * child process tree itself, which is exactly what `pickKillRoot` +
 * `descendantsOf` exist to emulate on POSIX, so on win32 the port-owner pid is
 * passed straight to `killTreeCommand` and the ancestry walk is skipped
 * entirely.
 */
export function killTree(pid: number, force: boolean): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;

  if (process.platform === 'win32') {
    const { cmd, args } = killTreeCommand(pid, process.platform, force);
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
      return true;
    } catch {
      // Already gone, or taskkill itself failed.
      return false;
    }
  }

  // Children first, so a supervisor cannot respawn what we just killed.
  let signalled = false;
  for (const target of descendantsOf(pid, processSnapshot())) {
    if (killPid(target, force ? 'SIGKILL' : 'SIGTERM')) signalled = true;
  }
  return signalled;
}

/**
 * Signal a single pid directly, with the same integer-and->1 guard as
 * `killTree`. Used both by `killTree`'s POSIX loop and by `restart()`'s force
 * escalation, which signals specific still-alive survivors (see `stillAlive`)
 * rather than re-walking a tree from a root that's typically already dead.
 */
function killPid(pid: number, signal: NodeJS.Signals): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    // Already gone.
    return false;
  }
}

/**
 * Where the recovery snapshot for a given CDP port lives.
 *
 * Qualified by port, not shared across all instances: two harness processes
 * driving two different editors (e.g. one on the default port, one on a
 * `XGENIA_CDP_PORT`-overridden port) would otherwise read and write the exact
 * same file, so instance A restarting could reopen instance B's project and
 * report it as its own. The port is what actually identifies which editor a
 * given harness call is driving, so it's what the recovery file is keyed on.
 */
export function recoveryFilePath(port: number = DEFAULT_PORT): string {
  return path.join(os.tmpdir(), 'xgenia-harness', `recovery-${port}.json`);
}

function writeRecovery(port: number, data: unknown): void {
  const file = recoveryFilePath(port);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export type RecoveryRead =
  | { ok: true; dir: string | null; target?: Target }
  | { ok: false; reason: 'missing' | 'parse-error' };

/**
 * Read back the recovery snapshot for `port`, distinguishing "there was
 * nothing open" (`ok: true, dir: null`) from "the snapshot could not be read
 * at all" (`ok: false`) — a failed read must not silently look identical to a
 * clean "nothing to recover", because a caller needs to know whether it can
 * trust the absence of a project as ground truth or as a read failure.
 */
export function readRecovery(port: number = DEFAULT_PORT): RecoveryRead {
  let raw: string;
  try {
    raw = fs.readFileSync(recoveryFilePath(port), 'utf8');
  } catch {
    return { ok: false, reason: 'missing' };
  }
  try {
    const data = JSON.parse(raw) as { dir?: string | null; target?: Target };
    return { ok: true, dir: data?.dir ?? null, target: data?.target };
  } catch {
    return { ok: false, reason: 'parse-error' };
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

/**
 * Spawn a detached child and wait a short grace window to see whether the OS
 * accepted it, capturing the failure instead of letting it surface later.
 *
 * `spawn()` throws synchronously only for a narrow set of option-validation
 * errors. The common failure — the executable does not exist (ENOENT), e.g.
 * `npm` not on PATH, common for a GUI-launched MCP client that did not inherit
 * a shell's PATH, or under nvm — is delivered asynchronously via the child's
 * `'error'` event. With no listener attached, Node's default behaviour for an
 * unhandled EventEmitter `'error'` is to throw, crashing this process — and
 * because the event fires on a later tick, that crash would land AFTER the
 * caller (`launch`/`restart`) already believed the spawn succeeded and moved
 * on, in `restart()`'s case after the previous editor was already killed. A
 * real ENOENT/EACCES surfaces within a few milliseconds of the spawn attempt,
 * so a short bounded wait is enough to catch it while adding negligible delay
 * to a real launch.
 */
export function spawnChildWithErrorCapture(
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  graceMs = 250
): Promise<{ child: ChildProcess | null; error: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, opts);
    } catch (e) {
      resolve({ child: null, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ child: null, error: err instanceof Error ? err.message : String(err) });
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolve({ child, error: null });
    }, graceMs);
  });
}

async function spawnApp(): Promise<{ started: boolean; error?: string }> {
  let lastError: string | undefined;
  for (const { cmd, args, probe } of appLaunchCandidates()) {
    if (cmd !== 'open' && !fs.existsSync(probe)) continue;
    const result = await spawnChildWithErrorCapture(cmd, args, {
      detached: true,
      stdio: 'ignore',
      env: childEnv()
    });
    if (!result.error) return { started: true };
    lastError = result.error;
  }
  return { started: false, error: lastError };
}

async function spawnDev(root: string): Promise<{ started: boolean; error?: string }> {
  const logDir = path.join(os.tmpdir(), 'xgenia-harness');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, 'dev.log'), 'a');
  const result = await spawnChildWithErrorCapture('npm', ['run', 'dev'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', log, log],
    env: childEnv()
  });
  return result.error ? { started: false, error: result.error } : { started: true };
}

function fail(code: string, tried: string, hint: string) {
  return { error: code, tried, hint };
}

/**
 * Decide whether `restart()` must refuse rather than proceed, given the
 * chat panel's read and whether `force` was passed.
 *
 * `readChatState` can report `busy: false` for two very different reasons:
 * the panel really is idle, or the read could not determine anything at all
 * (`unavailable` set — no chat iframe found, or the in-frame evaluate threw).
 * Treating the second case as "not busy" lets a momentarily-erroring or
 * navigating panel sail through the guard that exists specifically to protect
 * an in-flight AI turn, so "could not determine" must refuse exactly like
 * "definitely busy" does, unless the caller accepts the risk with `force`.
 */
export function busyRefusal(
  chat: Pick<ChatState, 'busy' | 'unavailable'>,
  force: boolean
): { refuse: true; unavailable: boolean } | { refuse: false } {
  if (force) return { refuse: false };
  if (chat.busy) return { refuse: true, unavailable: false };
  if (chat.unavailable) return { refuse: true, unavailable: true };
  return { refuse: false };
}

/** Whether an in-flight AI turn was lost — `'unknown'`, not a confident `false`, when the read that would tell us was itself unreliable. */
export type InFlightTurnLost = boolean | 'unknown';

export function inFlightTurnLostValue(chat: Pick<ChatState, 'busy' | 'unavailable'>): InFlightTurnLost {
  return chat.unavailable ? 'unknown' : chat.busy;
}

/**
 * Poll a port's owner until it's free (returns null) or the timeout elapses
 * (returns the pid still holding it). Used after a force-kill so a failed
 * kill (EPERM, e.g.) is reported honestly instead of assumed successful.
 */
async function pollPortFree(port: number, timeoutMs: number, pollMs = 500): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  let owner = portOwner(port);
  while (owner && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    owner = portOwner(port);
  }
  return owner;
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

  const started = chosen === 'app' ? await spawnApp() : await spawnDev(root!);
  if (!started.started) {
    return fail(
      'not-running',
      `target ${chosen}${started.error ? `: ${started.error}` : ''}`,
      started.error ? `Could not start XGENIA: ${started.error}` : 'Could not start XGENIA.'
    );
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

export interface DeclinedPort {
  port: number;
  pid: number;
  reason: 'outside-tree' | 'tree-membership-unknown-on-platform';
}

type SaveOutcomeOrNothingOpen =
  | Awaited<ReturnType<typeof saveOpenProject>>
  | { confirmed: true; reason: 'nothing-open' };

export type KillOutcome =
  | {
      killed: true;
      target: Target;
      port: number;
      project: ProjectInfo | null;
      saveOutcome: SaveOutcomeOrNothingOpen;
      declinedPorts: DeclinedPort[];
      inFlightTurnLost: InFlightTurnLost;
    }
  | ReturnType<typeof fail>;

/**
 * The sequence `restart()` and `quit()` share: refuse while an AI turn is in
 * flight (unless forced), save the open project (unless there is none),
 * kill the right process tree for the connected target — never a fabricated
 * or unverified pid — free the dev ports that tree owned, and confirm the
 * CDP port is actually free afterward.
 *
 * This is the safety-critical part (the pid guards, the tree-membership port
 * sweep, the busy/save refusal) and must not fork between the two callers.
 * What differs between them — relaunching afterward and reopening the
 * recovered project — stays entirely out of this function; `onReady` is the
 * only seam, used by `restart()` to snapshot the recovery file at the same
 * point in the sequence it always has: right after the busy check, before
 * the save.
 */
async function saveKillVerify(opts: {
  force?: boolean;
  action: 'restart' | 'quit';
  onReady?: (info: { target: Target; port: number; project: ProjectInfo | null }) => void;
}): Promise<KillOutcome> {
  const { action } = opts;
  const { page, target, port } = await connect();

  const project = await readProject(page);
  const chat = await readChatState(page);

  // R2 IMPORTANT 2: refuse when the chat state could not be determined at
  // all, not only when it's confirmed busy — see busyRefusal's doc comment.
  const refusal = busyRefusal(chat, !!opts.force);
  if (refusal.refuse) {
    return fail(
      'busy-refused',
      refusal.unavailable ? 'chat panel state could not be read' : 'chat is mid-generation',
      refusal.unavailable
        ? `Whether an AI turn is in flight could not be determined (${chat.unavailable}${
            chat.error ? `: ${chat.error}` : ''
          }). ${action === 'restart' ? 'Restarting' : 'Quitting'} could silently lose an in-flight turn. Wait and retry, or pass force to ${action} anyway.`
        : `An AI turn is in flight and would be lost. Wait, or pass force to ${action} anyway.`
    );
  }

  opts.onReady?.({ target, port, project });

  // R2 CRITICAL: ask the editor to save the way its own save does, and
  // require actual confirmation before proceeding to a kill — saveOpenProject
  // can no longer resolve as if it succeeded when it didn't (a read-only
  // project.json, a save slower than its own 5s ceiling, or a thrown evaluate
  // all used to look identical to a real save right before the tree was torn
  // down, silently destroying unsaved work while reporting success).
  let saveOutcome: Awaited<ReturnType<typeof saveOpenProject>> | null = null;
  if (project?.dir) {
    saveOutcome = await saveOpenProject(page);
    if (!saveOutcome.confirmed && !opts.force) {
      return fail(
        'save-unconfirmed',
        `save project '${project.name}' (dir: ${project.dir}) before ${action}`,
        `The editor's save could not be confirmed (${saveOutcome.reason}${
          'error' in saveOutcome ? `: ${saveOutcome.error}` : ''
        }). ${action === 'restart' ? 'Restarting' : 'Quitting'} would risk losing unsaved work. Wait and retry, or pass force to ${action} anyway (the report will note the save was unconfirmed).`
      );
    }
  }

  const owner = portOwner(port);
  if (!owner) {
    return fail('not-running', `no process owns port ${port}`, `Nothing to ${action}.`);
  }

  // Correction 2: win32 skips the ancestry walk entirely. `taskkill /T`
  // already walks the child tree — that's the Windows equivalent of what
  // pickKillRoot/descendantsOf do on POSIX by enumerating `ps` output, which
  // doesn't exist on win32.
  let root: number;
  if (process.platform === 'win32') {
    root = owner;
  } else {
    const picked = pickKillRoot(processChain(owner));
    // CRITICAL 1: pickKillRoot returns null, never a fabricated pid, when it
    // cannot justify one (empty chain, or a chain resolving to pid <= 1) —
    // e.g. the owner exited between portOwner() and processChain() above,
    // exactly the window this operates in. Abort rather than substitute any
    // other pid; killing an unverified/unknown root is how a machine-wide
    // sweep happens.
    if (picked === null) {
      return fail(
        'not-running',
        `process chain for port ${port} owner pid ${owner} could not be resolved to a safe root`,
        'The owning process may have already exited, or ps could not be read. Refusing to kill an unverified process tree; try again.'
      );
    }
    root = picked;
  }

  // CRITICAL 2: capture which pids belong to the tree we're about to kill
  // BEFORE killing it, so the dev-port sweep below can only ever touch a pid
  // provably in that set — never an unrelated user process that happens to
  // own one of those common dev ports (3001 and 8080 in particular are two of
  // the most common ports in existence). On win32, processSnapshot() has
  // nothing to enumerate (no `ps`), so this degrades to just `{root}`, which
  // is conservative rather than unsafe.
  const treePids = new Set(descendantsOf(root, processSnapshot()));

  killTree(root, false);
  await new Promise((r) => setTimeout(r, 5000));

  let stillOwner = portOwner(port);
  let forceSignalled = false;
  if (stillOwner) {
    // R2 IMPORTANT 1: escalate against the pids that are actually still alive,
    // not by re-deriving descendants of `root` from a fresh snapshot — by
    // this point (~5s after the SIGTERM) `root` itself is typically already
    // reaped, so `descendantsOf(root, freshSnapshot)` would find no trace of
    // it and fall through to returning just `[root]` again, leaving any
    // surviving child (the Electron process is the one that matters)
    // un-signalled. `treePids`, captured before anything was killed, is the
    // right set; filter it to who's still around and SIGKILL those directly.
    //
    // win32 has no broader tree to re-derive in the first place (Correction 2
    // routes it straight to `killTreeCommand`/`taskkill /T`, which re-walks
    // from `root` itself on the OS side) so it keeps using killTree(root, true).
    if (process.platform === 'win32') {
      forceSignalled = killTree(root, true);
    } else {
      const survivors = stillAlive(treePids, processSnapshot());
      forceSignalled = survivors.map((pid) => killPid(pid, 'SIGKILL')).some(Boolean);
    }
    stillOwner = await pollPortFree(port, 10_000);
  }

  // IMPORTANT 3: a failed kill must never be reported as a success. If the
  // port is still held after SIGTERM and a force SIGKILL (or the force kill
  // signalled nothing at all — EPERM, e.g.), stop here instead of continuing
  // on top of the still-running old process and claiming success.
  if (stillOwner) {
    return fail(
      'not-running',
      `port ${port} is still held by pid ${stillOwner} after SIGTERM${forceSignalled ? ' and SIGKILL' : ''}`,
      forceSignalled
        ? 'The force kill did not take (possibly EPERM). The old process is still running.'
        : "The force kill signalled nothing — the resolved root may already be gone from this process's view. The old process is still running."
    );
  }

  // Free the dev ports too — but only a port whose owner is provably part of
  // the tree just killed. A port owned by something outside that set is left
  // untouched and reported, never killed on the assumption that "it's
  // probably ours". On win32, `treePids` can only ever be `{root}` (no `ps`
  // there to enumerate a broader tree — see its capture above), so a decline
  // there means "we cannot tell", not "this definitely isn't ours"; the
  // reason field says which.
  const treeMembershipKnown = process.platform !== 'win32';
  const declinedPorts: DeclinedPort[] = [];
  if (target === 'dev') {
    for (const p of [8080, 8574, 3001, 3051]) {
      const pid = portOwner(p);
      if (!pid) continue;
      if (treePids.has(pid)) {
        killTree(pid, true);
      } else {
        declinedPorts.push({
          port: p,
          pid,
          reason: treeMembershipKnown ? 'outside-tree' : 'tree-membership-unknown-on-platform'
        });
      }
    }
  }

  resetConnection();

  return {
    killed: true,
    target,
    port,
    project,
    saveOutcome: saveOutcome ?? { confirmed: true, reason: 'nothing-open' },
    declinedPorts,
    inFlightTurnLost: inFlightTurnLostValue(chat)
  };
}

export async function restart(opts: { force?: boolean } = {}) {
  const result = await saveKillVerify({
    force: opts.force,
    action: 'restart',
    onReady: ({ target, port, project }) => {
      writeRecovery(port, { dir: project?.dir ?? null, target, savedAt: Date.now() });
    }
  });
  if ('error' in result) return result;

  const relaunched = await launch({ target: result.target });
  if ('error' in relaunched) {
    // R2 IMPORTANT 4: a relaunch timeout after a dev restart is very often
    // explained by exactly the ports this sweep declined to free (e.g.
    // webpack still holding :8080 blocks a clean `npm run dev`). Fold that
    // into the returned hint rather than discarding it — the error shape
    // stays {error, tried, hint}, just with a richer hint.
    const declinedNote = result.declinedPorts.length
      ? ` Also, ${result.declinedPorts.length} dev port(s) were left occupied and not freed: ${result.declinedPorts
          .map((d) => `${d.port} (pid ${d.pid}, ${d.reason})`)
          .join(', ')}.`
      : '';
    return { ...relaunched, hint: `${relaunched.hint}${declinedNote}` };
  }

  // R2 IMPORTANT 5: a failed or absent recovery read must not look identical
  // to "there was genuinely nothing open before the restart" — see readRecovery.
  const recovery = readRecovery(result.port);
  let reopened = null;
  // IMPORTANT 4 (round 1): carry the failure reason forward instead of
  // collapsing it to `project: null`, which is honest but useless for
  // diagnosing WHY the project didn't come back.
  let recoveryError: { error: string; tried: string; hint: string } | null = null;
  if (recovery.ok && recovery.dir) {
    const reopenedResult = await openProject({ dir: recovery.dir });
    if ('error' in reopenedResult) {
      recoveryError = reopenedResult;
    } else {
      reopened = reopenedResult.project;
    }
  } else if (!recovery.ok) {
    recoveryError = fail(
      'recovery-read-failed',
      `reading recovery snapshot for port ${result.port}`,
      recovery.reason === 'missing'
        ? 'The recovery snapshot written just before the kill is missing. Cannot tell what project, if any, was open before this restart.'
        : 'The recovery snapshot could not be parsed. Cannot tell what project, if any, was open before this restart.'
    );
  }
  // else: recovery.ok && !recovery.dir — nothing was open before the
  // restart, so there is genuinely nothing to reopen; not an error.

  const { page: page2 } = await connect();
  const chat2 = await readChatState(page2);

  return {
    restarted: true,
    target: result.target,
    project: reopened,
    recoveryError,
    declinedPorts: result.declinedPorts,
    save: result.saveOutcome,
    chat: { restored: chat2.mounted, messageCount: chat2.messageCount },
    inFlightTurnLost: result.inFlightTurnLost
  };
}

/**
 * Save, kill and verify — exactly `restart()`'s sequence up to the point of
 * relaunching — but never relaunch and never write a recovery snapshot.
 * Nothing will be running afterward; `launch()` is how XGENIA comes back,
 * with no project reopened automatically since none was recorded.
 */
export async function quit(opts: { force?: boolean } = {}) {
  const result = await saveKillVerify({ force: opts.force, action: 'quit' });
  if ('error' in result) return result;

  return {
    quit: true,
    target: result.target,
    port: result.port,
    project: result.project,
    save: result.saveOutcome,
    declinedPorts: result.declinedPorts,
    inFlightTurnLost: result.inFlightTurnLost
  };
}
