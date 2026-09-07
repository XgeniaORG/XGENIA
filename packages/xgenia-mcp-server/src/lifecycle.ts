import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright-core';
import { spawn, execFileSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import {
  appLaunchCandidates,
  killTreeCommand,
  portOwner,
  classifyTargetForPid
} from './platform.js';
import {
  connect,
  discoverPort,
  resetConnection,
  DEFAULT_PORT,
  CONNECT_TIMEOUT_MS,
  type Target
} from './connection.js';
import {
  readProject,
  readChatState,
  isLoginScreen,
  type ChatState,
  type ProjectInfo
} from './editor-state.js';
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

/**
 * How the pre-kill `target` was actually determined.
 *
 * `'connect'` is the normal, most-trustworthy case: the page itself answered
 * and was classified by URL. The other three only ever apply when `connect()`
 * failed outright (a wedged editor) — `'process'` (the pid that owns the CDP
 * port, classified by its command line) is preferred over `'recovery'` (the
 * target the last restart that DID know it wrote to disk) because it
 * reflects who is holding the port right now rather than a possibly-stale
 * breadcrumb; `'unknown'` means neither source could tell.
 */
export type TargetSource = 'connect' | 'process' | 'recovery' | 'unknown';

export interface TargetDetermination {
  target: Target | null;
  source: TargetSource;
}

/**
 * Decide the pre-kill target from already-looked-up candidates, in
 * preference order — pure, so the preference order itself (not the I/O that
 * produces the candidates) is directly testable.
 *
 * This is Defect 1's fix: a wedged editor's `connect()` fails, so the target
 * used to be reported `null` and `restart()` fell back to a best-effort
 * `'auto'` relaunch — which prefers the installed app — silently switching
 * a dev user's build to the packaged one on exactly the restart that most
 * needs to restore their environment exactly. `connected` wins outright when
 * available (it needs no guessing at all); `fromProcess` and `fromRecovery`
 * only ever get consulted when it's null.
 */
export function determineTarget(
  connected: Target | null,
  fromProcess: Target | null,
  fromRecovery: Target | null
): TargetDetermination {
  if (connected) return { target: connected, source: 'connect' };
  if (fromProcess) return { target: fromProcess, source: 'process' };
  if (fromRecovery) return { target: fromRecovery, source: 'recovery' };
  return { target: null, source: 'unknown' };
}

export type EditorWaitOutcome = 'ready' | 'login-screen' | 'timeout';

/**
 * Decide what a poll of the editor page found, given its two independent
 * DOM signals.
 *
 * Pure and stub-testable on purpose: `window.ProjectModel` is defined by the
 * router before the app decides whether anyone is signed in (see
 * `isLoginScreen`'s doc comment), so "ProjectModel is defined" was never
 * sufficient on its own to mean "the editor is usable" — it also matches
 * the login screen, which is exactly what let `launch()` report success
 * while the editor sat unusable in front of a real person. Returns `null`
 * while the app has not booted far enough to define `ProjectModel` yet, so
 * the caller keeps polling.
 */
export function classifyEditorReadiness(
  projectModelDefined: boolean,
  loginScreen: boolean
): 'ready' | 'login-screen' | null {
  if (!projectModelDefined) return null;
  return loginScreen ? 'login-screen' : 'ready';
}

async function waitForEditor(port: number, timeoutMs: number): Promise<EditorWaitOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    resetConnection();
    try {
      const { page } = await connect(port);
      const projectModelDefined = await page.evaluate(
        () => typeof (window as unknown as Record<string, unknown>).ProjectModel !== 'undefined'
      );
      const outcome = classifyEditorReadiness(
        projectModelDefined,
        projectModelDefined ? await isLoginScreen(page) : false
      );
      if (outcome) return outcome;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return 'timeout';
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

/** How long a single pre-kill in-page read may take before it's treated as a wedged renderer. */
const PRE_KILL_READ_TIMEOUT_MS = 5000;
/**
 * `saveOpenProject`'s own in-page ceiling is 5000ms, but that ceiling is a
 * `setTimeout` running INSIDE the page — it cannot fire once the renderer's
 * main thread is blocked, which is exactly the state this exists to guard
 * against. This Node-side backstop is deliberately looser than the in-page
 * one so a save that is merely slow (not wedged) still gets to finish and
 * report a real outcome.
 */
const SAVE_READ_TIMEOUT_MS = 7000;

/** Sentinel returned by `withReadTimeout` when the Node-side timer wins the race. */
export const TIMED_OUT = Symbol('xgenia-mcp:pre-kill-read-timed-out');

/**
 * Race an in-page read against a Node-side timer, the same pattern
 * `health()`'s `pageResponsive` check already uses.
 *
 * Playwright's `page.evaluate`/`frame.evaluate` have no default timeout of
 * their own, and on a truly wedged renderer the promise they return never
 * settles at all — not slowly, never. `restart()`/`quit()` used to run three
 * such unbounded reads (`readProject`, `readChatState`, `saveOpenProject`)
 * before ever checking `force`, so the documented escape hatch for a stuck
 * editor was unreachable on exactly the editor state it exists to unwedge.
 * This does not cancel the underlying promise — Node has no way to do that —
 * it just stops waiting on it, which is all a caller needs to move on.
 */
export function withReadTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), ms))
  ]);
}

/** The honest, nothing-actually-known shape reported when the page turned out to be unresponsive. */
const UNRESPONSIVE_CHAT: ChatState = {
  mounted: false,
  busy: false,
  messageCount: 0,
  unavailable: 'evaluate-failed'
};

export interface PreKillReads {
  pageUnresponsive: boolean;
  project: ProjectInfo | null;
  chat: ChatState;
}

/**
 * Combine the two bounded pre-kill reads into what `saveKillVerify` acts on.
 *
 * Pure and stub-testable independent of a real Playwright page: pass plain
 * values (or `TIMED_OUT`) in, get the resulting state out. Either read
 * timing out — including `chatRead` never having been attempted at all,
 * because `readProject` itself already timed out and the caller skipped the
 * remaining read rather than risk it hanging too — degrades the WHOLE
 * bundle to the honest "unknown" shape: a caller cannot trust a project read
 * from a page that turned out to be unresponsive moments later, so this
 * does not report partial data.
 */
export function combinePreKillReads(
  projectRead: ProjectInfo | null | typeof TIMED_OUT,
  chatRead: ChatState | typeof TIMED_OUT
): PreKillReads {
  const pageUnresponsive = projectRead === TIMED_OUT || chatRead === TIMED_OUT;
  return {
    pageUnresponsive,
    project: pageUnresponsive ? null : (projectRead as ProjectInfo | null),
    chat: pageUnresponsive ? UNRESPONSIVE_CHAT : (chatRead as ChatState)
  };
}

/**
 * Whether `saveKillVerify` must refuse outright because the page is
 * unresponsive and the caller did not accept that risk with `force`.
 */
export function unresponsiveRefusal(pageUnresponsive: boolean, force: boolean): boolean {
  return pageUnresponsive && !force;
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

/**
 * How long `saveKillVerify` waits after SIGTERM before concluding the
 * process needs a harder push and escalating to SIGKILL.
 *
 * Deliberately long. On receiving SIGTERM, an Electron renderer needs to
 * flush pending `localStorage`/IndexedDB writes to disk before it actually
 * exits, and that flush is asynchronous, not instantaneous. The previous 5s
 * grace period was measured to be too aggressive in exactly the way that
 * matters: after a `quit()` followed by `launch()`, the editor came back to
 * a login screen with NO auth token in `localStorage` at all, forcing a
 * fresh manual sign-in. Whether that specific loss was caused by the kill
 * truncating a pending flush, or by the Supabase session simply expiring on
 * its own in the hours in between, cannot be proven either way from here —
 * but escalating this fast is too aggressive regardless of which
 * explanation is true, so shutdown now defaults to patient. This does not
 * slow down the common case: `pollPortFree` below returns the moment the
 * port actually frees up, so only a process that is genuinely still alive
 * after the full window pays for it.
 */
const SIGTERM_GRACE_MS = 30_000;

/**
 * Whether the extended SIGTERM grace period expired without the process
 * exiting — i.e. whether SIGKILL escalation is needed.
 *
 * Pure so the escalation decision itself, not the process polling around
 * it, is directly testable: `stillOwnerAfterGrace` is whatever
 * `pollPortFree` returned after waiting out `SIGTERM_GRACE_MS` (the pid
 * still holding the port, or `null` once it freed on its own).
 */
export function shouldEscalateToSigkill(stillOwnerAfterGrace: number | null): boolean {
  return stillOwnerAfterGrace !== null;
}

/**
 * The one message explaining the `not-authenticated` outcome, shared by
 * every path that can produce it: this harness must never type, store, read
 * or transmit credentials, so the only correct response to finding the
 * login screen is to say so and stop.
 */
const NOT_AUTHENTICATED_HINT =
  'The editor launched fine, but nobody is signed in. A human must sign in once — this harness cannot and must not handle credentials.';

export async function launch(opts: { target?: Target | 'auto' } = {}) {
  const requested = opts.target ?? 'auto';

  // Already up?
  try {
    const { page, target, port } = await connect();
    if (await isLoginScreen(page)) {
      return fail('not-authenticated', `attached to ${target} on port ${port}`, NOT_AUTHENTICATED_HINT);
    }
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
  const outcome = await waitForEditor(port, timeout);
  if (outcome === 'timeout') {
    return fail(
      'timeout',
      `waited ${timeout}ms for the editor page on ${port}`,
      chosen === 'dev' ? 'Check the dev log in the temp directory.' : 'Is XGENIA installed?'
    );
  }
  if (outcome === 'login-screen') {
    return fail(
      'not-authenticated',
      `waited for the editor page on ${port}; it launched and rendered the login screen`,
      NOT_AUTHENTICATED_HINT
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

export type SaveOutcomeOrNothingOpen =
  | Awaited<ReturnType<typeof saveOpenProject>>
  | { confirmed: true; reason: 'nothing-open' }
  | { confirmed: false; reason: 'unresponsive' };

/**
 * What to report as the save outcome when no real save was even attempted —
 * either because there was genuinely nothing open, or because the pre-kill
 * reads that would tell us that were skipped or timed out.
 *
 * Defect 2: `confirmed: true, reason: 'nothing-open'` must only ever be
 * reported when the pre-kill reads actually ran and genuinely found no
 * project open. Reported unconditionally whenever `saveOutcome` was `null`,
 * it used to collide with the wedged-editor case too — reproduced live as
 * `restart({force:true})` returning `{confirmed: true, reason:
 * 'nothing-open'}` from a page that was never actually read, a confident
 * wrong answer about the exact thing that determines whether the user just
 * lost work. `reason: 'unresponsive'` is not a new value invented for this:
 * it's the same one `saveOpenProject`'s own timeout path
 * (`SAVE_READ_TIMEOUT_MS`) already reports for "a save was attempted but
 * could not be confirmed" — reused here for "no save could even be
 * attempted," the same honest vocabulary rather than a parallel one.
 */
export function nothingOpenOrUnresponsive(pageUnresponsive: boolean): SaveOutcomeOrNothingOpen {
  return pageUnresponsive
    ? { confirmed: false, reason: 'unresponsive' }
    : { confirmed: true, reason: 'nothing-open' };
}

export type KillOutcome =
  | {
      killed: true;
      /**
       * Best-known target before the kill. `null` only when NONE of the
       * three sources in `determineTarget` could tell — see `targetSource`
       * for which source, if any, actually supplied this value.
       * `restart()` falls back to `'auto'` for the relaunch only in the
       * `null` case, and reports what `'auto'` actually chose so a caller
       * can see whether a switch happened.
       */
      target: Target | null;
      /** How `target` was determined — see `determineTarget`'s doc comment. */
      targetSource: TargetSource;
      port: number;
      project: ProjectInfo | null;
      saveOutcome: SaveOutcomeOrNothingOpen;
      declinedPorts: DeclinedPort[];
      inFlightTurnLost: InFlightTurnLost;
      /**
       * Whether the extended SIGTERM grace period expired and SIGKILL had to
       * be sent. This is the case where an unflushed `localStorage`/IndexedDB
       * write (e.g. an auth session) could plausibly have been lost — see
       * SIGTERM_GRACE_MS's doc comment.
       */
      hardKilled: boolean;
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
 *
 * Every pre-kill in-page read (`readProject`, `readChatState`,
 * `saveOpenProject`) is bounded with `withReadTimeout`, because a truly
 * wedged renderer never settles the promise `page.evaluate` returns — not
 * eventually, never — and `force` used to be consulted only after these
 * reads, making it unreachable on exactly the editor state it exists to
 * unwedge. The first read to time out means the page is unresponsive: every
 * read after it is skipped rather than attempted (see
 * `combinePreKillReads`), and when `force` is set the function proceeds
 * straight to the port-owner/kill sequence below, which touches no page at
 * all, reporting the honest gaps that leaves (`project: null`, the save
 * unconfirmed, `inFlightTurnLost` as `'unknown'`) rather than guessing.
 *
 * That bounding used to start one layer too low: it protected the three
 * in-page reads, but the `connect()` call in front of them — which opens a
 * fresh CDP session and waits for the browser's page targets to attach —
 * was still made as an unguarded precondition. Reproduced live: a wedged
 * renderer's main thread never finishes initialising, so `connectOverCDP`
 * sat for its full 30s default and then *threw*, and that throw happened
 * before `force` was ever consulted — the kill path this exists to reach
 * needs only a port number and a process table, nothing from the page at
 * all, and yet it was unreachable on exactly the editor state it exists to
 * rescue. `connect()` itself is now bounded (`CONNECT_TIMEOUT_MS`, in
 * connection.ts) and its failure is handled here as data
 * (`attemptConnect`), not as an exception: with `force` unset, a failed
 * connect fails this call closed with an explanation instead of hanging or
 * throwing; with `force` set, it degrades straight to the same
 * `combinePreKillReads(TIMED_OUT, TIMED_OUT)` bundle a mid-flight timeout
 * produces, so it flows through every guard below exactly like the
 * page-went-unresponsive-mid-read case already did.
 */
type ConnectAttempt =
  | { ok: true; page: Page; target: Target }
  | { ok: false; error: Error & { code?: string } };

async function attemptConnect(port: number): Promise<ConnectAttempt> {
  try {
    const { page, target } = await connect(port);
    return { ok: true, page, target };
  } catch (e) {
    return { ok: false, error: e as Error & { code?: string } };
  }
}

async function saveKillVerify(opts: {
  force?: boolean;
  action: 'restart' | 'quit';
  onReady?: (info: { target: Target | null; port: number; project: ProjectInfo | null }) => void;
}): Promise<KillOutcome> {
  const { action } = opts;
  const port = discoverPort();
  const attempt = await attemptConnect(port);
  let target: Target | null = attempt.ok ? attempt.target : null;
  let targetSource: TargetSource = attempt.ok ? 'connect' : 'unknown';

  // Once `force` is set, a connect failure is treated exactly like every
  // pre-kill read timing out mid-flight: no page ever became available, so
  // every read is skipped rather than attempted (`combinePreKillReads`'s own
  // TIMED_OUT/TIMED_OUT case — reused, not reimplemented) instead of being
  // retried against a page that was never reached in the first place.
  let pageUnresponsive: boolean;
  let project: ProjectInfo | null;
  let chat: ChatState;
  if (attempt.ok) {
    const projectRead = await withReadTimeout(readProject(attempt.page), PRE_KILL_READ_TIMEOUT_MS);
    // Skip the remaining read entirely once the page has already proven
    // unresponsive — attempting it too would just add another hang.
    const chatRead =
      projectRead === TIMED_OUT
        ? TIMED_OUT
        : await withReadTimeout(readChatState(attempt.page), PRE_KILL_READ_TIMEOUT_MS);
    ({ pageUnresponsive, project, chat } = combinePreKillReads(projectRead, chatRead));
  } else {
    ({ pageUnresponsive, project, chat } = combinePreKillReads(TIMED_OUT, TIMED_OUT));
  }

  // The exact same `unresponsiveRefusal(pageUnresponsive, force)` decision
  // now governs both ways the editor can turn out to be unreachable: a
  // connect failure (`!attempt.ok`) and a page that connected fine but then
  // wedged mid-read. Only the code and wording of the resulting failure
  // differ, and only for one sub-case: a connect failure that turns out to
  // mean "nothing is running at all" gets its own faithful `not-running`,
  // because promising "pass force to kill it anyway" when there is nothing
  // to kill would be actively misleading.
  if (unresponsiveRefusal(pageUnresponsive, !!opts.force)) {
    if (!attempt.ok && attempt.error.code === 'not-running') {
      return fail(
        'not-running',
        `connect to the editor before ${action} (bounded at ${CONNECT_TIMEOUT_MS}ms)`,
        `${attempt.error.message} Nothing to ${action}.`
      );
    }
    const tried = attempt.ok
      ? `read project/chat state before ${action} (bounded at ${PRE_KILL_READ_TIMEOUT_MS}ms)`
      : `connect to the editor before ${action} (bounded at ${CONNECT_TIMEOUT_MS}ms)`;
    const detail = attempt.ok ? '' : ` (${attempt.error.message})`;
    return fail(
      'editor-unresponsive',
      tried,
      `The editor is not responding${detail}, so the pre-${action} save and busy-check cannot be performed safely. ${action === 'restart' ? 'Restarting' : 'Quitting'} anyway would risk losing unsaved work and any in-flight AI turn. Pass force to ${action} anyway — it will kill the editor without confirming a save.`
    );
  }

  // Defect 1: reaching here with `!attempt.ok` means `force` was set on a
  // connect failure (the only way `unresponsiveRefusal` above lets that
  // through) — a wedged editor. `connect()`'s page-URL classification was
  // never available, so ask the two page-free sources instead of leaving
  // `target` (and the recovery snapshot `onReady` is about to write) as
  // `null`: the pid that owns the CDP port right now, classified by its
  // command line, and — if even that comes back empty (owner already gone,
  // or an unrecognised command line) — the target the last restart that DID
  // know it wrote to the recovery file. Skipped entirely when `attempt.ok`,
  // since `target` is already known there with certainty and neither lookup
  // would be used anyway (see `determineTarget`'s preference order).
  if (!attempt.ok) {
    const owner = portOwner(port);
    const fromProcess = owner !== null ? classifyTargetForPid(owner) : null;
    const recovery = readRecovery(port);
    const fromRecovery = recovery.ok ? recovery.target ?? null : null;
    ({ target, source: targetSource } = determineTarget(null, fromProcess, fromRecovery));
  }

  // R2 IMPORTANT 2: refuse when the chat state could not be determined at
  // all, not only when it's confirmed busy — see busyRefusal's doc comment.
  // This already covers the pageUnresponsive+force case correctly: `chat`
  // there is UNRESPONSIVE_CHAT (unavailable set), and busyRefusal treats
  // `force` as bypassing every refusal regardless of why chat is unavailable.
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
  // down, silently destroying unsaved work while reporting success). The
  // call itself is also bounded (SAVE_READ_TIMEOUT_MS): a wedged renderer
  // means the in-page 5s ceiling above can never fire either, so without an
  // external bound this was the third of the three unbounded pre-kill reads.
  // `project` is already null whenever `pageUnresponsive` was true — which
  // includes the connect-itself-failed case (`!attempt.ok`) — so this
  // naturally does not run in that case; `attempt.ok` is checked too so
  // TypeScript knows `attempt.page` is actually there.
  let saveOutcome: SaveOutcomeOrNothingOpen | null = null;
  if (attempt.ok && project?.dir) {
    const saveRead = await withReadTimeout(saveOpenProject(attempt.page), SAVE_READ_TIMEOUT_MS);
    saveOutcome =
      saveRead === TIMED_OUT ? { confirmed: false, reason: 'unresponsive' as const } : saveRead;
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

  // Poll for the port to free up during the grace period rather than
  // sleeping the whole window — a process that exits promptly is reported
  // promptly; only a process that is genuinely still alive after the full
  // SIGTERM_GRACE_MS pays for it. See SIGTERM_GRACE_MS's doc comment for why
  // that window is now generous rather than the previous flat 5s.
  let stillOwner = await pollPortFree(port, SIGTERM_GRACE_MS);
  const hardKilled = shouldEscalateToSigkill(stillOwner);
  let forceSignalled = false;
  if (hardKilled) {
    // R2 IMPORTANT 1: escalate against the pids that are actually still alive,
    // not by re-deriving descendants of `root` from a fresh snapshot — by
    // this point (SIGTERM_GRACE_MS after the SIGTERM) `root` itself is
    // typically already reaped, so `descendantsOf(root, freshSnapshot)` would
    // find no trace of it and fall through to returning just `[root]` again,
    // leaving any surviving child (the Electron process is the one that
    // matters) un-signalled. `treePids`, captured before anything was killed,
    // is the right set; filter it to who's still around and SIGKILL those
    // directly.
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
  //
  // `target` is `null` when the connect attempt above never succeeded at
  // all (a wedged editor killed with `force`), so it's unknown whether this
  // was a dev run or a packaged app — sweep anyway rather than skip: the
  // treePids membership check right above is what actually keeps this safe,
  // never "it's probably ours", so checking a few extra ports that a
  // packaged app never touches costs nothing beyond a handful of harmless
  // `portOwner` lookups that all come back empty.
  const treeMembershipKnown = process.platform !== 'win32';
  const declinedPorts: DeclinedPort[] = [];
  if (target !== 'app') {
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
    targetSource,
    port,
    project,
    // Defect 2: `saveOutcome` is still `null` here in two very different
    // cases — genuinely nothing was open (a real read said so), or the
    // reads that would tell us were skipped/timed out (`pageUnresponsive`).
    // See `nothingOpenOrUnresponsive`'s doc comment for why these must not
    // collapse to the same report.
    saveOutcome: saveOutcome ?? nothingOpenOrUnresponsive(pageUnresponsive),
    declinedPorts,
    inFlightTurnLost: inFlightTurnLostValue(chat),
    hardKilled
  };
}

/**
 * `saveKillVerify` never throws (see its doc comment), but `restart()` still
 * does real I/O after it returns — relaunching, reopening a recovered
 * project, reconnecting to read the post-relaunch chat state — none of
 * which is expected to fail once a relaunch has been confirmed, but "not
 * expected to" is not the same guarantee as "cannot". Every tool is
 * supposed to return `{error, tried, hint}` rather than throw; `guard()` in
 * index.ts catches an escaping exception too, but that is a safety net for
 * the MCP surface, not a substitute for this function honouring its own
 * contract in a direct-call context. This is exactly the gap the live wedge
 * test caught: `restart({force:true})` threw instead of returning, from
 * `connect()` inside what was then an unguarded precondition.
 */
export async function restart(opts: { force?: boolean } = {}) {
  try {
    const result = await saveKillVerify({
      force: opts.force,
      action: 'restart',
      onReady: ({ target, port, project }) => {
        writeRecovery(port, { dir: project?.dir ?? null, target, savedAt: Date.now() });
      }
    });
    if ('error' in result) return result;

    // Defect 1: `result.target` is `null` only when NONE of `determineTarget`'s
    // three sources (the live connect, the CDP port owner's command line, the
    // last-written recovery snapshot) could tell — see its doc comment.
    // `'auto'` is exactly the value `launch()` already defines for "figure
    // out which build to start", so this is not a new guess, just reusing
    // the existing one for the one case where the target genuinely could not
    // be determined at all. When `result.target` IS known (`targetSource !==
    // 'unknown'`), it's passed through explicitly, so `launch()` starts that
    // exact build rather than applying its own 'auto' preference for the
    // installed app — this is what stops a wedged dev editor's restart from
    // silently coming back as the packaged app.
    const relaunched = await launch({ target: result.target ?? 'auto' });
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
      // The build actually relaunched — equal to `result.target` whenever
      // that was known (launch() honours an explicit target exactly), and
      // otherwise whatever launch()'s own 'auto' preference chose. Reporting
      // this rather than `result.target` verbatim means a caller sees the
      // real post-restart state even in the 'unknown' case, instead of a
      // `null` that masks a build switch.
      target: relaunched.target,
      // How confidently the PRE-kill target was known — 'unknown' is the
      // signal that 'auto' had to guess above, so `target` may not match
      // whatever build was running before this restart.
      targetSource: result.targetSource,
      project: reopened,
      recoveryError,
      declinedPorts: result.declinedPorts,
      save: result.saveOutcome,
      chat: { restored: chat2.mounted, messageCount: chat2.messageCount },
      inFlightTurnLost: result.inFlightTurnLost,
      hardKilled: result.hardKilled
    };
  } catch (e) {
    const err = e as Error & { code?: string };
    return fail(err.code ?? 'page-unresponsive', 'restart', err.message ?? String(e));
  }
}

/**
 * Save, kill and verify — exactly `restart()`'s sequence up to the point of
 * relaunching — but never relaunch and never write a recovery snapshot.
 * Nothing will be running afterward; `launch()` is how XGENIA comes back,
 * with no project reopened automatically since none was recorded.
 *
 * Wrapped the same way `restart()` is: `saveKillVerify` itself never throws,
 * but this still honours the {result}-or-{error,tried,hint} contract for
 * itself rather than leaning on `guard()` in index.ts to paper over an
 * escaping exception.
 */
export async function quit(opts: { force?: boolean } = {}) {
  try {
    const result = await saveKillVerify({ force: opts.force, action: 'quit' });
    if ('error' in result) return result;

    return {
      quit: true,
      target: result.target,
      targetSource: result.targetSource,
      port: result.port,
      project: result.project,
      save: result.saveOutcome,
      declinedPorts: result.declinedPorts,
      inFlightTurnLost: result.inFlightTurnLost,
      hardKilled: result.hardKilled
    };
  } catch (e) {
    const err = e as Error & { code?: string };
    return fail(err.code ?? 'page-unresponsive', 'quit', err.message ?? String(e));
  }
}
