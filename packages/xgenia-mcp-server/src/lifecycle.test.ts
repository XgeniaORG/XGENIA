import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  isDevLauncher,
  pickKillRoot,
  descendantsOf,
  killTree,
  stillAlive,
  busyRefusal,
  inFlightTurnLostValue,
  recoveryFilePath,
  readRecovery,
  spawnChildWithErrorCapture
} from './lifecycle.js';

// Captured from a live `npm run dev`, leaf first.
const CHAIN = [
  { pid: 16268, command: '/repo/node_modules/electron/dist/Electron.app/.../Electron dev-main.js --dev' },
  { pid: 16267, command: 'node /repo/node_modules/.bin/electron dev-main.js --dev' },
  { pid: 16200, command: 'npm run start:_dev' },
  { pid: 16194, command: 'webpack' },
  { pid: 16137, command: 'npm run start' },
  { pid: 15815, command: 'node /repo/node_modules/.bin/ts-node --project tsconfig.json ./scripts/start.ts' },
  { pid: 15601, command: 'node /repo/node_modules/.bin/ts-node --project tsconfig.json ./scripts/start-with-private.ts' },
  { pid: 15560, command: 'node /repo/node_modules/.bin/ts-node --project tsconfig.json ./scripts/dev-launcher.ts' },
  { pid: 15511, command: 'npm run dev' },
  { pid: 1970, command: '-zsh' }
];

describe('isDevLauncher', () => {
  it('recognises the launcher scripts', () => {
    expect(isDevLauncher('node ... ./scripts/dev-launcher.ts')).toBe(true);
    expect(isDevLauncher('node ... ./scripts/start-with-private.ts')).toBe(true);
    expect(isDevLauncher('node ... ./scripts/start.ts')).toBe(true);
  });

  it('does not treat the shell or webpack as a launcher', () => {
    expect(isDevLauncher('-zsh')).toBe(false);
    expect(isDevLauncher('webpack')).toBe(false);
    expect(isDevLauncher('npm run start:_dev')).toBe(false);
  });
});

describe('descendantsOf', () => {
  // launcher 100 -> npm 200 -> webpack 300 -> electron 400; 999 is unrelated.
  const SNAPSHOT = [
    { pid: 100, ppid: 1 },
    { pid: 200, ppid: 100 },
    { pid: 300, ppid: 200 },
    { pid: 400, ppid: 300 },
    { pid: 999, ppid: 1 }
  ];

  it('returns the whole subtree including the root', () => {
    expect(descendantsOf(100, SNAPSHOT).sort()).toEqual([100, 200, 300, 400]);
  });

  it('orders children before their parent', () => {
    const order = descendantsOf(100, SNAPSHOT);
    expect(order.indexOf(400)).toBeLessThan(order.indexOf(300));
    expect(order.indexOf(300)).toBeLessThan(order.indexOf(200));
    expect(order[order.length - 1]).toBe(100);
  });

  it('excludes unrelated processes', () => {
    expect(descendantsOf(100, SNAPSHOT)).not.toContain(999);
  });

  it('returns just the pid when it has no children', () => {
    expect(descendantsOf(400, SNAPSHOT)).toEqual([400]);
  });

  // CRITICAL 1 guard 3: real `ps -eo pid=,ppid=` output on a live machine
  // contains entries whose ppid is 0 (kernel-adjacent processes). That shape
  // is exactly what made descendantsOf(0, snapshot) walk the WHOLE machine —
  // 676 processes, including pid 1 and the harness's own process — so the
  // test must reproduce that snapshot shape, not a sanitised one.
  it('refuses a root of 0 or 1 and returns empty, even given a snapshot containing ppid:0 entries', () => {
    const REAL_SHAPE_SNAPSHOT = [
      { pid: 1, ppid: 0 },
      { pid: 2, ppid: 0 },
      { pid: 100, ppid: 1 },
      { pid: 200, ppid: 100 },
      { pid: 999, ppid: 1 }
    ];
    expect(descendantsOf(0, REAL_SHAPE_SNAPSHOT)).toEqual([]);
    expect(descendantsOf(1, REAL_SHAPE_SNAPSHOT)).toEqual([]);
  });
});

describe('pickKillRoot', () => {
  it('climbs past webpack to the outermost launcher script', () => {
    expect(pickKillRoot(CHAIN)).toBe(15560);
  });

  it('falls back to the leaf when no launcher is in the chain', () => {
    const packaged = [
      { pid: 900, command: '/Applications/XGENIA.app/Contents/MacOS/XGENIA' },
      { pid: 1, command: '/sbin/launchd' }
    ];
    expect(pickKillRoot(packaged)).toBe(900);
  });

  it('never returns the shell, pid 1, or a fabricated pid 0', () => {
    expect(pickKillRoot(CHAIN)).not.toBe(1970);
    // CRITICAL 1 guard 1: a chain that bottoms out at pid 1 (init/launchd)
    // must refuse — return null — rather than return 1 or fall back to 0.
    expect(pickKillRoot([{ pid: 1, command: 'init' }])).toBeNull();
  });

  // CRITICAL 1 guard 1: an empty chain (the port owner died between
  // portOwner() and processChain() — exactly the window a restart operates
  // in) must return null, never the fabricated pid 0 that `chain[0]?.pid ?? 0`
  // used to produce.
  it('returns null for an empty chain', () => {
    expect(pickKillRoot([])).toBeNull();
  });
});

describe('killTree guard', () => {
  // CRITICAL 1 guard 2: killTree must refuse to signal anything for pid <= 1
  // or a non-integer pid, and report that nothing was signalled. These calls
  // must never reach execFileSync/process.kill, so this is safe to run for
  // real in any environment.
  it('refuses to signal pid <= 1 or a non-integer pid, and returns false', () => {
    expect(killTree(0, false)).toBe(false);
    expect(killTree(1, false)).toBe(false);
    expect(killTree(1, true)).toBe(false);
    expect(killTree(-5, true)).toBe(false);
    expect(killTree(1.5, false)).toBe(false);
  });
});

describe('stillAlive', () => {
  // R2 IMPORTANT 1: the force-kill escalation must signal survivors directly
  // rather than re-deriving descendants of a root that, by the time the force
  // kill runs, is typically already dead. This is the filtering that makes
  // that possible: which of the pids captured before the kill are still
  // present in a fresh snapshot.
  it('keeps only the pids present in the fresh snapshot', () => {
    const freshSnapshot = [
      { pid: 200, ppid: 100 },
      { pid: 300, ppid: 200 }
    ];
    expect(stillAlive([100, 200, 300, 400], freshSnapshot).sort()).toEqual([200, 300]);
  });

  it('returns empty when none of the set survived', () => {
    expect(stillAlive([100, 200], [{ pid: 999, ppid: 1 }])).toEqual([]);
  });

  it('reproduces the dead-root case: root itself absent from the fresh snapshot is correctly dropped', () => {
    // This is the exact shape that made the pre-fix escalation a no-op: root
    // (100) was SIGTERMed ~5s earlier and is gone from the fresh snapshot,
    // but a child (400, the Electron process stand-in) survived.
    const freshSnapshot = [{ pid: 400, ppid: 300 }];
    expect(stillAlive([100, 200, 300, 400], freshSnapshot)).toEqual([400]);
  });
});

describe('busyRefusal', () => {
  it('does not refuse when idle and readable', () => {
    expect(busyRefusal({ busy: false }, false)).toEqual({ refuse: false });
  });

  it('refuses when busy and not forced', () => {
    expect(busyRefusal({ busy: true }, false)).toEqual({ refuse: true, unavailable: false });
  });

  it('does not refuse when busy but forced', () => {
    expect(busyRefusal({ busy: true }, true)).toEqual({ refuse: false });
  });

  // R2 IMPORTANT 2: readChatState reports busy:false alongside `unavailable`
  // when it could not determine the real state at all (no chat iframe found,
  // or the in-frame evaluate threw) — that must refuse exactly like a
  // confirmed-busy read does, not be treated as "confirmed idle".
  it('refuses when the chat state is unavailable, even though busy reads false', () => {
    expect(busyRefusal({ busy: false, unavailable: 'no-frame' }, false)).toEqual({
      refuse: true,
      unavailable: true
    });
    expect(busyRefusal({ busy: false, unavailable: 'evaluate-failed' }, false)).toEqual({
      refuse: true,
      unavailable: true
    });
  });

  it('does not refuse when unavailable but forced', () => {
    expect(busyRefusal({ busy: false, unavailable: 'no-frame' }, true)).toEqual({ refuse: false });
  });
});

describe('inFlightTurnLostValue', () => {
  it('reports the real busy value when the chat state was readable', () => {
    expect(inFlightTurnLostValue({ busy: true })).toBe(true);
    expect(inFlightTurnLostValue({ busy: false })).toBe(false);
  });

  // R2 IMPORTANT 2: a restart report must not claim inFlightTurnLost: false
  // with false confidence when the read that would tell us was unreliable.
  it('reports "unknown" rather than a confident false when the chat state could not be read', () => {
    expect(inFlightTurnLostValue({ busy: false, unavailable: 'no-frame' })).toBe('unknown');
    expect(inFlightTurnLostValue({ busy: false, unavailable: 'evaluate-failed' })).toBe('unknown');
  });
});

describe('recoveryFilePath', () => {
  // R2 IMPORTANT 5: two harness instances driving two different editors (two
  // different CDP ports) must not collide on the same recovery file.
  it('qualifies the path by CDP port so different instances cannot collide', () => {
    const a = recoveryFilePath(9223);
    const b = recoveryFilePath(9333);
    expect(a).not.toBe(b);
    expect(a).toContain('9223');
    expect(b).toContain('9333');
  });

  it('defaults to DEFAULT_PORT when no port is given', () => {
    expect(recoveryFilePath()).toContain('9223');
  });
});

describe('readRecovery', () => {
  // A port unlikely to collide with a real CDP port or another test run.
  const port = 65535;
  const file = recoveryFilePath(port);

  afterEach(() => {
    try {
      fs.unlinkSync(file);
    } catch {
      // Not there; fine.
    }
  });

  it('reports ok:false reason "missing" when the file does not exist', () => {
    expect(readRecovery(port)).toEqual({ ok: false, reason: 'missing' });
  });

  it('reports ok:false reason "parse-error" when the file is corrupt', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{not valid json');
    expect(readRecovery(port)).toEqual({ ok: false, reason: 'parse-error' });
  });

  it('reports ok:true with the recorded dir when the file is valid', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ dir: '/tmp/some-project', target: 'dev' }));
    expect(readRecovery(port)).toEqual({ ok: true, dir: '/tmp/some-project', target: 'dev' });
  });

  // R2 IMPORTANT 5: "nothing was open before the restart" (dir: null) must be
  // distinguishable from "the read itself failed" (ok: false) — both must not
  // collapse to the same downstream behaviour.
  it('reports ok:true with dir:null when nothing was open, distinct from a failed read', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ dir: null, target: 'dev' }));
    const result = readRecovery(port);
    expect(result).toEqual({ ok: true, dir: null, target: 'dev' });
    expect(result.ok).toBe(true);
  });
});

describe('spawnChildWithErrorCapture', () => {
  // R2 IMPORTANT 3: spawn's ENOENT for a nonexistent executable is delivered
  // asynchronously via the child's 'error' event. With no listener attached,
  // that used to crash the whole harness process well after the caller had
  // already moved on. This must be captured and returned as a normal result
  // instead of throwing.
  it('captures a spawn failure (nonexistent executable) instead of throwing', async () => {
    const result = await spawnChildWithErrorCapture(
      '/definitely/does/not/exist/xgenia-test-binary-xyz',
      [],
      { stdio: 'ignore' },
      50
    );
    expect(result.child).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('resolves with a live child and no error for a real, valid spawn', async () => {
    const result = await spawnChildWithErrorCapture(process.execPath, ['-e', 'process.exit(0)'], {
      stdio: 'ignore'
    });
    expect(result.error).toBeNull();
    expect(result.child).not.toBeNull();
  });
});
