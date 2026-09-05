import { describe, it, expect } from 'vitest';
import { isDevLauncher, pickKillRoot, descendantsOf } from './lifecycle.js';

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

  it('never returns the shell or pid 1', () => {
    expect(pickKillRoot(CHAIN)).not.toBe(1970);
    expect(pickKillRoot([{ pid: 1, command: 'init' }])).toBe(1);
  });
});
