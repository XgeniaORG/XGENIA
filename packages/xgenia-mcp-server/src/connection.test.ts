import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readDevToolsActivePort,
  discoverPort,
  classifyTarget,
  isCacheHit,
  connectFailureCode,
  connect,
  resetConnection
} from './connection.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('readDevToolsActivePort', () => {
  it('reads the port from the first line', () => {
    fs.writeFileSync(
      path.join(tmp, 'DevToolsActivePort'),
      '9223\n/devtools/browser/2048b284-b6db-4a8a-8857-1c1ec89488f4\n'
    );
    expect(readDevToolsActivePort(tmp)).toBe(9223);
  });

  it('returns null when the file is absent', () => {
    expect(readDevToolsActivePort(tmp)).toBeNull();
  });

  it('returns null when the first line is not a port', () => {
    fs.writeFileSync(path.join(tmp, 'DevToolsActivePort'), 'garbage\n');
    expect(readDevToolsActivePort(tmp)).toBeNull();
  });
});

describe('discoverPort', () => {
  it('prefers the first directory that has a port file', () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(b, 'DevToolsActivePort'), '9333\n/x\n');
    expect(discoverPort([a, b])).toBe(9333);
  });

  it('falls back to the default port when nothing is found', () => {
    expect(discoverPort([path.join(tmp, 'missing')])).toBe(9223);
  });
});

describe('classifyTarget', () => {
  it('calls a localhost page a dev build', () => {
    expect(classifyTarget('http://localhost:8080/src/editor/index.html')).toBe('dev');
  });

  it('calls a file page a packaged app', () => {
    expect(classifyTarget('file:///Applications/XGENIA.app/.../src/editor/index.html')).toBe('app');
  });
});

describe('isCacheHit', () => {
  it('returns false when cached is null', () => {
    expect(isCacheHit(null, 9223)).toBe(false);
  });

  it('returns false when port does not match', () => {
    const mockConnection = {
      browser: { isConnected: () => true } as any,
      page: { isClosed: () => false } as any,
      target: 'dev' as const,
      port: 9223,
    };
    expect(isCacheHit(mockConnection, 9224)).toBe(false);
  });

  it('returns false when browser is not connected', () => {
    const mockConnection = {
      browser: { isConnected: () => false } as any,
      page: { isClosed: () => false } as any,
      target: 'dev' as const,
      port: 9223,
    };
    expect(isCacheHit(mockConnection, 9223)).toBe(false);
  });

  it('returns false when page is closed', () => {
    const mockConnection = {
      browser: { isConnected: () => true } as any,
      page: { isClosed: () => true } as any,
      target: 'dev' as const,
      port: 9223,
    };
    expect(isCacheHit(mockConnection, 9223)).toBe(false);
  });

  it('returns true when all conditions are met', () => {
    const mockConnection = {
      browser: { isConnected: () => true } as any,
      page: { isClosed: () => false } as any,
      target: 'dev' as const,
      port: 9223,
    };
    expect(isCacheHit(mockConnection, 9223)).toBe(true);
  });
});

// Defect 3: `connect()` used to report `not-running` whenever `connectOverCDP`
// failed for any reason, even when the editor was genuinely up but wedged
// (its main thread never finishing the page-target handshake `connectOverCDP`
// waits for). A caller told "not running" when the editor is actually
// unresponsive would reasonably try to launch a second instance rather than
// kill and restart the stuck one -- exactly backwards. connectFailureCode is
// the pure decision `connect()`'s catch block makes from a single fact --
// whether anything is listening on the port at all -- pinned here
// independent of any real port lookup or CDP handshake.
describe('connectFailureCode', () => {
  it('reports not-running when nothing is listening on the port', () => {
    expect(connectFailureCode(false)).toBe('not-running');
  });

  it('reports editor-unresponsive when something is listening but the connect still failed', () => {
    expect(connectFailureCode(true)).toBe('editor-unresponsive');
  });
});

describe('connect against a definitely-empty port', () => {
  // A high, unlikely-to-collide port distinct from the ones other test files
  // use for recovery-file tests, so a parallel test run cannot cross wires.
  const port = 65533;

  afterEach(() => resetConnection());

  // Real, light I/O (an actual TCP connect attempt that gets refused
  // immediately) rather than a mock -- matches this suite's existing
  // preference for real filesystem/process calls over a mocking framework.
  // Nothing is listening on `port`, so this exercises the exact `not-running`
  // path `connect()`'s catch block takes in production, not just the pure
  // decision above, and must resolve near-instantly (ECONNREFUSED), never
  // waiting out the full CONNECT_TIMEOUT_MS bound.
  it('throws a not-running error quickly instead of waiting out the connect timeout', async () => {
    const start = Date.now();
    await expect(connect(port)).rejects.toMatchObject({ code: 'not-running' });
    expect(Date.now() - start).toBeLessThan(5000);
  });
});
