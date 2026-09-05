import { describe, it, expect } from 'vitest';
import { isDevLauncher, pickKillRoot, descendantsOf, killTree } from './lifecycle.js';

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
