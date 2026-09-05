import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRecents, findRecent, addRecentEntry, type RecentEntry } from './recents.js';

let tmp: string;
let file: string;

const EXISTING: RecentEntry = {
  id: 'b3ccd0ea-3f19-273b-67cc-63503c43c2f7',
  name: 'Amazing thing. ',
  latestAccessed: 1788599944511,
  retainedProjectDirectory: '/Users/x/Downloads/Amazing thing. ',
  thumbURI: '',
  thumbPath: '/Users/x/thumbs/b3ccd0ea.jpg',
  thumbSource: 'title-card'
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recents-'));
  file = path.join(tmp, 'recently_opened_project.json');
  fs.writeFileSync(file, JSON.stringify({ recentProjects: [EXISTING], thumbsMigratedV1: true }));
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('readRecents', () => {
  it('reads the recentProjects array', () => {
    const entries = readRecents(file);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Amazing thing. ');
  });

  it('returns an empty list for a missing or corrupt file', () => {
    expect(readRecents(path.join(tmp, 'nope.json'))).toEqual([]);
    fs.writeFileSync(file, 'not json');
    expect(readRecents(file)).toEqual([]);
  });
});

describe('findRecent', () => {
  it('matches on exact directory', () => {
    const e = findRecent([EXISTING], { dir: '/Users/x/Downloads/Amazing thing. ' });
    expect(e?.id).toBe(EXISTING.id);
  });

  it('matches on exact name', () => {
    expect(findRecent([EXISTING], { name: 'Amazing thing. ' })?.id).toBe(EXISTING.id);
  });

  it('returns null when nothing matches', () => {
    expect(findRecent([EXISTING], { name: 'Other' })).toBeNull();
  });
});

describe('addRecentEntry', () => {
  it('returns the existing entry without changing its id', () => {
    const e = addRecentEntry(file, '/Users/x/Downloads/Amazing thing. ', 'Amazing thing. ');
    expect(e.id).toBe(EXISTING.id);
    expect(readRecents(file)).toHaveLength(1);
  });

  it('appends a new entry with a fresh id and preserves the others', () => {
    const e = addRecentEntry(file, '/Users/x/Downloads/New', 'New');
    expect(e.id).not.toBe(EXISTING.id);
    expect(e.thumbURI).toBe('');
    const all = readRecents(file);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === EXISTING.id)).toBeTruthy();
  });

  it('keeps other top-level keys in the file', () => {
    addRecentEntry(file, '/Users/x/Downloads/New', 'New');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(raw.thumbsMigratedV1).toBe(true);
  });
});
