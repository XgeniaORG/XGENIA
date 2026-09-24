import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRepoRootFrom } from './lifecycle.js';

// (2026-09-23) Claude Code starts this server in ~/Documents/GitHub — the folder above the repo —
// so a cwd-only walk found no checkout and xgenia_restart killed a dev editor it could not relaunch.
describe('findRepoRootFrom', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));

  it("finds the repo from this server's own location", () => {
    const root = findRepoRootFrom(here);
    expect(root).not.toBeNull();
    expect(path.join(root!, 'packages', 'xgenia-mcp-server')).toBe(path.resolve(here, '..'));
  });

  it('returns null from a folder outside any checkout', () => {
    expect(findRepoRootFrom(os.tmpdir())).toBeNull();
  });
});
