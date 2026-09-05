import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { userDataDirs, userDataDirForTarget } from './platform.js';

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

/**
 * The recents file for a connected target — or, when the target is genuinely
 * unknown, the first userData directory that actually holds one.
 *
 * The "unknown target" branch exists only for callers with no connection yet
 * (there is none today, but it is a safe, honest fallback rather than an
 * error). It must never be reached when a target IS known: an installed
 * XGENIA and a dev checkout keep entirely separate recents files, and both
 * commonly exist on the same machine, so guessing between them there would
 * silently read the wrong profile's projects — exactly the bug this
 * function exists to close off. Every caller that has connected to an editor
 * has a target and must pass it.
 */
export function recentsFilePath(
  target?: 'app' | 'dev' | null,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir()
): string | null {
  if (target) {
    const file = path.join(userDataDirForTarget(target, platform, home), FILE_NAME);
    return fs.existsSync(file) ? file : null;
  }
  for (const dir of userDataDirs(platform, home)) {
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
