import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDevToolsActivePort, discoverPort, classifyTarget, isCacheHit } from './connection.js';

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
