import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { userDataDirs } from './platform.js';

export interface RecentEntry {
  id: string;
  name: string;
  latestAccessed: number;
  retainedProjectDirectory: string;
  thumbURI: string;
  thumbPath?: string;
  thumbSource?: string;
  thumbAnchorId?: string;
}

const FILE_NAME = 'recently_opened_project.json';

/** The first userData directory that actually holds a recents file. */
export function recentsFilePath(dirs: string[] = userDataDirs()): string | null {
  for (const dir of dirs) {
    const file = path.join(dir, FILE_NAME);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

export function readRecents(file: string): RecentEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const list = raw?.recentProjects;
    return Array.isArray(list) ? (list as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

export function findRecent(
  entries: RecentEntry[],
  q: { dir?: string; name?: string }
): RecentEntry | null {
  if (q.dir) {
    const byDir = entries.find((e) => e.retainedProjectDirectory === q.dir);
    if (byDir) return byDir;
  }
  if (q.name) {
    const byName = entries.find((e) => e.name === q.name);
    if (byName) return byName;
  }
  return null;
}

/**
 * Ensure a directory has a recents entry, and return it.
 *
 * An existing entry is returned untouched. Its `id` is the only copy that
 * exists — `project.json` carries none, and every conversation in
 * `<project>/.xgenia/chat/index.json` is keyed by it — so replacing it would
 * orphan the project's chat history.
 *
 * The shape written here matches LocalProjectsModel._addProject.
 */
export function addRecentEntry(file: string, dir: string, name: string): RecentEntry {
  let raw: Record<string, unknown> = {};

  // Distinguish "file doesn't exist" (ENOENT) from "file exists but unreadable"
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      // File exists but cannot be read or parsed. Fail closed to avoid data loss.
      throw new Error(
        `Failed to read or parse recents file at ${file}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  // If file does not exist, raw stays as {}

  const list = Array.isArray(raw.recentProjects) ? (raw.recentProjects as RecentEntry[]) : [];

  const existing = list.find((e) => e.retainedProjectDirectory === dir);
  if (existing) return existing;

  const entry: RecentEntry = {
    retainedProjectDirectory: dir,
    latestAccessed: Date.now(),
    id: crypto.randomUUID(),
    name: name || 'Untitled',
    thumbURI: ''
  };
  list.push(entry);
  raw.recentProjects = list;

  // Atomic write: write to temp file then rename over target
  const tmpFile = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(raw));
    fs.renameSync(tmpFile, file);
  } catch (err) {
    // Clean up temp file on failure
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }

  return entry;
}
