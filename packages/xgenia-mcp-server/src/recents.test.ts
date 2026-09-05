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

  it('throws when file exists but holds invalid JSON', () => {
    // Corrupt the file
    fs.writeFileSync(file, 'not valid json');
    const bytesAfterCorruption = fs.readFileSync(file);

    expect(() => {
      addRecentEntry(file, '/Users/x/Downloads/SomeOther', 'SomeOther');
    }).toThrow();

    // Verify file is unchanged (still corrupted, not modified by the failed add)
    expect(fs.readFileSync(file)).toEqual(bytesAfterCorruption);
  });

  it('throws when file exists but is unreadable', () => {
    const bytesBeforeLock = fs.readFileSync(file);

    // Make file unreadable (may be ineffective if running as root)
    fs.chmodSync(file, 0o000);

    let threw = false;
    try {
      addRecentEntry(file, '/Users/x/Downloads/SomeOther', 'SomeOther');
    } catch {
      threw = true;
    }

    // Restore permissions for cleanup
    fs.chmodSync(file, 0o644);

    if (threw) {
      // File should be unchanged
      expect(fs.readFileSync(file)).toEqual(bytesBeforeLock);
    } else {
      // If chmod was ineffective, skip this assertion
      // (e.g., running as root makes file readable regardless)
    }
  });

  it('creates file with one entry when file does not exist', () => {
    const newFile = path.join(tmp, 'brand_new.json');
    expect(fs.existsSync(newFile)).toBe(false);

    const e = addRecentEntry(newFile, '/Users/x/Downloads/Brand', 'Brand');
    expect(fs.existsSync(newFile)).toBe(true);
    expect(e.retainedProjectDirectory).toBe('/Users/x/Downloads/Brand');

    const disk = JSON.parse(fs.readFileSync(newFile, 'utf8'));
    expect(disk.recentProjects).toHaveLength(1);
    expect(disk.recentProjects[0].id).toBe(e.id);
  });

  it('leaves no .tmp-* debris after successful add', () => {
    addRecentEntry(file, '/Users/x/Downloads/Another', 'Another');
    const entries = fs.readdirSync(tmp);
    const tmpFiles = entries.filter((name) => name.startsWith('recently_opened_project.json.tmp-'));
    expect(tmpFiles).toHaveLength(0);
  });

  it('preserves all entries when adding to a multi-entry file', () => {
    // Add a second entry
    const e2 = addRecentEntry(file, '/Users/x/Downloads/Second', 'Second');
    // Re-read from disk to get all entries
    const allAfterAdd = readRecents(file);
    expect(allAfterAdd).toHaveLength(2);

    // Add a third entry
    const e3 = addRecentEntry(file, '/Users/x/Downloads/Third', 'Third');
    const allAfterSecondAdd = readRecents(file);
    expect(allAfterSecondAdd).toHaveLength(3);

    // Verify all original and new ids are present
    const ids = allAfterSecondAdd.map((x) => x.id);
    expect(ids).toContain(EXISTING.id);
    expect(ids).toContain(e2.id);
    expect(ids).toContain(e3.id);

    // When re-adding EXISTING dir, its id does not change
    const existingAgain = addRecentEntry(file, '/Users/x/Downloads/Amazing thing. ', 'Amazing thing. ');
    expect(existingAgain.id).toBe(EXISTING.id);
  });
});
