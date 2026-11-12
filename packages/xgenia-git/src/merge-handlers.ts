import fs from 'fs';
import path from 'path';

import { git } from './core/client';

/** One thing a merge could not settle by itself, kept for the user to look at. */
export interface MergeConflictItem {
  /** Repository-relative path of the file. */
  path: string;
  /** Optional id of the part inside the file (for handlers that merge below file level). */
  item?: string;
  /** Short text for the user. */
  label: string;
  /** Optional short text describing the two sides. */
  preview?: string;
  /** Blob sha of the other side's version, recorded when the conflict was found. */
  theirsBlob?: string;
  /** True when the other side deleted the file (then there is no theirsBlob). */
  theirsDeleted?: boolean;
}

/**
 * Merges the files whose path it matches. Gets the three versions of the file
 * (null = the file does not exist on that side) and returns the merged content
 * (`null` = delete the file) plus anything it could not settle.
 */
export interface MergeHandler {
  id: string;
  match(path: string): boolean;
  merge(
    base: Buffer | null,
    ours: Buffer | null,
    theirs: Buffer | null,
    path: string
  ): Promise<{ merged: Buffer | null; conflicts: MergeConflictItem[] }>;
}

// Module-level on purpose: `Git` is constructed in many places and they all share this list.
const handlers: MergeHandler[] = [];

/** Register a handler. A handler with the same id replaces the earlier one. */
export function registerMergeHandler(h: MergeHandler): void {
  const i = handlers.findIndex((x) => x.id === h.id);
  if (i >= 0) handlers[i] = h;
  else handlers.push(h);
}

export function mergeHandlers(): readonly MergeHandler[] {
  return handlers;
}

// ---- Unresolved conflicts, stored in the git dir so they are never committed ----

const CONFLICTS_FILE = 'xgenia-conflicts.json';

async function gitDir(repoDir: string): Promise<string> {
  const { output } = await git(['rev-parse', '--absolute-git-dir'], repoDir, 'gitDir');
  return output.toString().trim();
}

export async function readConflicts(repoDir: string): Promise<MergeConflictItem[]> {
  try {
    const text = await fs.promises.readFile(path.join(await gitDir(repoDir), CONFLICTS_FILE), 'utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeConflicts(repoDir: string, items: MergeConflictItem[]): Promise<void> {
  const file = path.join(await gitDir(repoDir), CONFLICTS_FILE);
  if (items.length === 0) {
    await fs.promises.rm(file, { force: true });
    return;
  }
  await fs.promises.writeFile(file, JSON.stringify(items, null, 2));
}

/** Read a file's bytes at a revision (`rev:path`) or a blob sha. Throws if it does not resolve. */
export async function readBlob(repoDir: string, spec: string): Promise<Buffer> {
  const { output, exitCode } = await git(['cat-file', 'blob', spec], repoDir, 'readBlob', {
    successExitCodes: new Set([0, 1, 128]),
    spawn: false,
    processCallback: (cb) => {
      // Binary encoding keeps every byte; Buffer.from(..., 'binary') gets them back exactly.
      if (cb.stdout) cb.stdout.setEncoding('binary');
    }
  });
  if (exitCode !== 0) throw new Error(`Could not read ${spec} from the repository`);
  return Buffer.from(output.toString(), 'binary');
}

async function otherSideRevision(repoDir: string): Promise<string> {
  const mergeHead = await git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], repoDir, 'mergeHead', {
    successExitCodes: new Set([0, 1])
  });
  if (mergeHead.exitCode === 0) return 'MERGE_HEAD';
  return 'HEAD^2';
}

/**
 * Settle a listed conflict. 'ours' keeps the file as it is and forgets the item.
 * 'theirs' writes the other side's version of the file (the second parent of the
 * merge commit, or MERGE_HEAD while the merge is not committed yet) and stages it.
 */
export async function settleConflict(
  repoDir: string,
  item: MergeConflictItem,
  side: 'ours' | 'theirs'
): Promise<void> {
  if (side === 'theirs') {
    const absolutePath = path.join(repoDir, item.path);
    let theirs: Buffer | null;
    if (item.theirsDeleted) {
      theirs = null;
    } else if (item.theirsBlob) {
      theirs = await readBlob(repoDir, item.theirsBlob);
    } else {
      // Items without a recorded side: fall back to the merge in progress or the merge commit.
      // A lookup that does not resolve throws; it is never read as "deleted on their side".
      const rev = await otherSideRevision(repoDir);
      theirs = await readBlob(repoDir, `${rev}:${item.path}`);
    }
    if (theirs === null) {
      await fs.promises.rm(absolutePath, { force: true });
    } else {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, theirs);
    }
    await git(['add', '-A', '--', item.path], repoDir, 'settleConflict');
  }

  const remaining = (await readConflicts(repoDir)).filter((x) => !(x.path === item.path && x.item === item.item));
  await writeConflicts(repoDir, remaining);
}
