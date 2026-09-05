import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { projectNameFromDir, validateProjectDir } from './project.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('projectNameFromDir', () => {
  it('reads the name from project.json', () => {
    fs.writeFileSync(path.join(tmp, 'project.json'), JSON.stringify({ name: 'Amazing thing. ' }));
    expect(projectNameFromDir(tmp)).toBe('Amazing thing. ');
  });

  it('falls back to the directory name when project.json has no name', () => {
    fs.writeFileSync(path.join(tmp, 'project.json'), JSON.stringify({ version: '4' }));
    expect(projectNameFromDir(tmp)).toBe(path.basename(tmp));
  });

  it('returns null when there is no project.json', () => {
    expect(projectNameFromDir(tmp)).toBeNull();
  });
});

describe('validateProjectDir', () => {
  it('accepts a directory holding project.json', () => {
    fs.writeFileSync(path.join(tmp, 'project.json'), JSON.stringify({ name: 'X' }));
    expect(validateProjectDir(tmp)).toEqual({ ok: true, name: 'X' });
  });

  it('rejects a directory with no project.json', () => {
    const r = validateProjectDir(tmp);
    expect(r.ok).toBe(false);
  });

  it('rejects a path that does not exist', () => {
    const r = validateProjectDir(path.join(tmp, 'nope'));
    expect(r.ok).toBe(false);
  });
});
