import { addAll } from './core/add';
import { MergeConflictItem, MergeHandler, mergeHandlers, readBlob, readConflicts, writeConflicts } from './merge-handlers';
import { IMergeTreeEntry, MergeTreeError } from './core/models/merge';

import fs from 'fs';
import path from 'path';

function tryParseJson(str: string) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

type JSON_OBJECT = {
  [key: string]: any;
};

/** Merge the project.json file */
export type MergeStrategyFunc = (ancestors: JSON_OBJECT, ours: JSON_OBJECT, theirs: JSON_OBJECT) => JSON_OBJECT;

/**
 * Defines the XGENIA custom merge strategy.
 */
export class MergeStrategy {
  constructor(
    public readonly repositoryDir: string,
    private readonly mergeProject: MergeStrategyFunc,
    public readonly strategy: 'our' | 'their' = 'our',
    /** The commit the other side ("their" in the merge tree) comes from, passed on to handlers. */
    private readonly theirsRev: string | null = null
  ) {}

  public async solveConflicts(tree: MergeTreeError) {
    const handlers: MergeHandler[] = [this.projectJsonHandler(), ...mergeHandlers()];
    const resolved: IMergeTreeEntry[] = [];
    const found: MergeConflictItem[] = [];
    const solvedPaths = new Set<string>();

    for (const entry of tree.conflictedEntries) {
      if (!entry.hasConflicts) continue;
      const parent = entry.base || entry.our || entry.their;
      solvedPaths.add(parent.path);
      const handler = handlers.find((h) => h.match(parent.path));
      const items = handler ? await this.resolveWithHandler(handler, entry) : await this.resolveFileConflict(entry);
      found.push(...items);
      resolved.push(entry);
    }

    // Mark all the file as resolved resolution
    await addAll(this.repositoryDir);

    // Keep what is still open from earlier merges, replace what this merge decided about.
    if (solvedPaths.size > 0) {
      const previous = (await readConflicts(this.repositoryDir)).filter((x) => !solvedPaths.has(x.path));
      await writeConflicts(this.repositoryDir, [...previous, ...found]);
    }

    // Return all files that were resolved
    return resolved;
  }

  private async readSide(side?: { sha: string }): Promise<Buffer | null> {
    return side ? readBlob(this.repositoryDir, side.sha) : null;
  }

  private async resolveWithHandler(handler: MergeHandler, entry: IMergeTreeEntry): Promise<MergeConflictItem[]> {
    const parent = entry.base || entry.our || entry.their;
    const [base, ours, theirs] = await Promise.all([
      this.readSide(entry.base),
      this.readSide(entry.our),
      this.readSide(entry.their)
    ]);
    const result = await handler.merge(base, ours, theirs, parent.path, this.repositoryDir, this.theirsRev);
    await this.writeResult(parent.path, result.merged);
    return result.conflicts.map((c) => (c.path === parent.path ? this.withTheirSide(c, entry) : c));
  }

  private theirSide(entry: IMergeTreeEntry): Pick<MergeConflictItem, 'theirsBlob' | 'theirsDeleted'> {
    return entry.their ? { theirsBlob: entry.their.sha } : { theirsDeleted: true };
  }

  private withTheirSide(item: MergeConflictItem, entry: IMergeTreeEntry): MergeConflictItem {
    return item.theirsBlob !== undefined || item.theirsDeleted !== undefined ? item : { ...item, ...this.theirSide(entry) };
  }

  private async writeResult(relativePath: string, content: Buffer | null) {
    const absolutePath = path.join(this.repositoryDir, relativePath);
    if (content === null) {
      await fs.promises.rm(absolutePath, { force: true });
    } else {
      await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.promises.writeFile(absolutePath, content);
    }
  }

  /**
   * No handler wants this file. The kept side stays on disk, but the conflict is
   * returned so it is listed for the user instead of being lost silently.
   */
  private async resolveFileConflict(entry: IMergeTreeEntry): Promise<MergeConflictItem[]> {
    const parent = entry.base || entry.our || entry.their;
    const target = entry[this.strategy];
    console.log('vcs: resolving file conflict', parent.path, 'using', this.strategy);
    await this.writeResult(parent.path, await this.readSide(target));
    return [
      {
        path: parent.path,
        label: parent.path,
        preview: `Changed on both sides; kept ${this.strategy === 'our' ? 'your' : 'the other'} version`,
        ...this.theirSide(entry)
      }
    ];
  }

  /** The built-in handler for project.json files. It always runs before the registered ones. */
  private projectJsonHandler(): MergeHandler {
    return {
      id: 'project.json',
      match: (p) => p === 'project.json' || p.slice(-13) === '/project.json',
      merge: async (base, ours, theirs) => {
        const text = (b: Buffer | null) => (b ? b.toString() : '{}');
        const ancestor = tryParseJson(text(base));
        const ourJson = tryParseJson(text(ours));
        const theirJson = tryParseJson(text(theirs));

        if (!ancestor) {
          throw new Error("Failed to solve project.json conflict. Couldn't parse ancestor: " + text(base));
        }
        if (!ourJson) {
          throw new Error("Failed to solve project.json conflict. Couldn't parse ours: " + text(ours));
        } else if (!theirJson) {
          throw new Error("Failed to solve project.json conflict. Couldn't parse theirs: " + text(theirs));
        }

        const mergedResult = this.mergeProject(ancestor, ourJson, theirJson);
        return { merged: Buffer.from(JSON.stringify(mergedResult)), conflicts: [] };
      }
    };
  }
}
