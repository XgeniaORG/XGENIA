import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  projectNameFromDir,
  validateProjectDir,
  canonicalDir,
  escapeRegExp,
  resolveByName
} from './project.js';
import type { RecentEntry } from './recents.js';

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

describe('canonicalDir', () => {
  it('resolves a trailing slash to the same value as without one', () => {
    expect(canonicalDir('/Users/markfm/Downloads/Project/')).toBe(
      canonicalDir('/Users/markfm/Downloads/Project')
    );
  });

  it('keeps a trailing space in the directory name intact', () => {
    // Real project directories on this machine carry meaningful trailing
    // spaces, e.g. "/Users/markfm/Downloads/Amazing thing. ". A `.trim()`
    // anywhere in the canonicalisation path would break every one of them.
    const withTrailingSpace = '/Users/markfm/Downloads/Amazing thing. ';
    const resolved = canonicalDir(withTrailingSpace);
    expect(resolved.endsWith(' ')).toBe(true);
    expect(resolved).toBe(path.resolve(withTrailingSpace));
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so a literal name matches only itself', () => {
    const re = new RegExp(`^${escapeRegExp('Game (v2)')}$`);
    expect(re.test('Game (v2)')).toBe(true);
    expect(re.test('Game (v2) 2')).toBe(false);
    expect(re.test('Game X2)')).toBe(false);
  });
});

describe('resolveByName', () => {
  const entry = (over: Partial<RecentEntry>): RecentEntry => ({
    id: 'id',
    name: 'Untitled',
    latestAccessed: 0,
    retainedProjectDirectory: '/tmp/x',
    thumbURI: '',
    ...over
  });

  it('resolves an unambiguous name to its single directory', () => {
    const entries = [entry({ name: 'Solo Project', retainedProjectDirectory: '/tmp/solo' })];
    const r = resolveByName(entries, 'Solo Project');
    expect(r).toEqual({ ok: true, dir: canonicalDir('/tmp/solo') });
  });

  it('fails closed with kind "not-found" when nothing matches', () => {
    const r = resolveByName([], 'Nothing');
    expect(r).toEqual({ ok: false, kind: 'not-found' });
  });

  it('fails closed on an ambiguous name, naming both candidate directories', () => {
    const entries = [
      entry({ id: 'a', name: 'Dup', retainedProjectDirectory: '/tmp/one', latestAccessed: 1 }),
      entry({ id: 'b', name: 'Dup', retainedProjectDirectory: '/tmp/two', latestAccessed: 2 })
    ];
    const r = resolveByName(entries, 'Dup');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('ambiguous');
      if (r.kind === 'ambiguous') {
        expect(r.reason).toContain('/tmp/one');
        expect(r.reason).toContain('/tmp/two');
        expect(r.reason).toContain('1');
        expect(r.reason).toContain('2');
      }
    }
  });

  it('does not match by substring or trim trailing-space names', () => {
    const entries = [
      entry({ name: 'Amazing thing. ', retainedProjectDirectory: '/tmp/amazing' }),
      entry({ name: 'Amazing thing', retainedProjectDirectory: '/tmp/amazing2' })
    ];
    const r = resolveByName(entries, 'Amazing thing. ');
    expect(r).toEqual({ ok: true, dir: canonicalDir('/tmp/amazing') });
  });
});
