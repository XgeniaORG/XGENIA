/**
 * lobbyMeta.ts — what a game is, read off disk without stalling the lobby.
 *
 * `ProjectItem` knows a name, a folder, a timestamp and a thumbnail. It does not know that
 * "Amazing thing." is a blackjack table, and that is the single biggest reason the old projects
 * screen was unreadable: a profile here holds `Amazing`, `AmazingSlot`, `amazingSlot.`,
 * `Amazing thing.`, `Amazing Slot System`, `sdsds` and `mmmmmmmm`.
 *
 * The projects themselves already know. `<project>/.xgenia/chat/index.json` carries one entry per
 * conversation with a `title` written from the opening prompt — "Build a polished 5-reel, 3-row
 * slot game called…" — plus a `messageCount` and a `lastActivity`. That is a description of the
 * game, on disk, free.
 *
 * The cost is a file read per project, and there can be 319 of them. So: nothing is read until
 * the card is on screen, reads are queued at idle a few at a time, every result is cached for the
 * session, and every failure is silent. A tagline is decoration; it must never delay a list or
 * take one down.
 */

import { filesystem } from '@xgenia/platform';

import Model from '../../../../shared/model';
import type { LobbyMeta } from './lobbyGrouping';
import { summariseChatIndex } from './lobbyMeta.core';

export { taglineFromTitle, summariseChatIndex, TAGLINE_MAX } from './lobbyMeta.core';

/** How many disk reads may be in flight. Enough to fill a screen, few enough to stay invisible. */
const CONCURRENCY = 8;

/**
 * Metadata for the lobby, read lazily and cached for the session.
 *
 * A Model rather than a plain cache so the grid can re-render when a read lands, using the same
 * `on(evt, fn, group)` / `off(group)` plumbing every other editor model uses.
 */
export class LobbyMetaModel extends Model {
  public static instance = new LobbyMetaModel();

  private cache = new Map<string, LobbyMeta>();
  private inFlight = new Set<string>();
  private queue: Array<{ id: string; dir: string; wantComponents: boolean }> = [];
  private running = 0;

  /** What is known right now. Never blocks; an unread project simply has nothing yet. */
  get(id: string): LobbyMeta | undefined {
    return this.cache.get(id);
  }

  /** Everything known, in the shape `arrangeLobby` takes. */
  all(): Record<string, LobbyMeta> {
    return Object.fromEntries(this.cache);
  }

  /** Merge a field in from elsewhere — the weak-thumbnail measurement arrives this way. */
  patch(id: string, meta: LobbyMeta): void {
    const next = { ...(this.cache.get(id) || {}), ...meta };
    this.cache.set(id, next);
    this.notifyListeners('lobby-meta-changed', { id });
  }

  /**
   * Ask for a project's metadata. Cheap to call on every render.
   *
   * `wantComponents` costs a second, larger read (`project.json` can be megabytes), so only the
   * hero asks for it.
   */
  request(id: string, dir: string, wantComponents = false): void {
    if (!id || !dir) return;

    const known = this.cache.get(id);
    if (known && (!wantComponents || known.componentCount !== undefined)) return;
    if (this.inFlight.has(id)) return;

    this.inFlight.add(id);
    this.queue.push({ id, dir, wantComponents });
    this.pump();
  }

  /** Forget everything. Called when the project list itself is replaced. */
  reset(): void {
    this.cache.clear();
    this.inFlight.clear();
    this.queue = [];
  }

  private pump(): void {
    while (this.running < CONCURRENCY && this.queue.length) {
      const job = this.queue.shift()!;
      this.running++;

      // Idle rather than immediate: the first paint of the grid matters more than any tagline,
      // and on a cold start there are 319 of these queued behind it.
      onIdle(() => {
        void this.read(job)
          .catch(() => undefined)
          .then(() => {
            this.running--;
            this.inFlight.delete(job.id);
            this.pump();
          });
      });
    }
  }

  private async read(job: { id: string; dir: string; wantComponents: boolean }): Promise<void> {
    const meta: LobbyMeta = { ...(this.cache.get(job.id) || {}) };
    let changed = false;

    if (meta.tagline === undefined && meta.messageCount === undefined) {
      const chatIndex = await readJsonOrNull(filesystem.join(job.dir, '.xgenia', 'chat', 'index.json'));
      const summary = summariseChatIndex(chatIndex);

      meta.messageCount = summary.messageCount;
      if (summary.tagline) meta.tagline = summary.tagline;
      changed = true;
    }

    if (job.wantComponents && meta.componentCount === undefined) {
      const project = await readJsonOrNull(filesystem.join(job.dir, 'project.json'));
      const components = (project as any)?.components;
      if (Array.isArray(components)) {
        meta.componentCount = components.length;
        changed = true;
      }
    }

    if (!changed) return;

    this.cache.set(job.id, meta);
    this.notifyListeners('lobby-meta-changed', { id: job.id });
  }
}

/**
 * Read JSON, or null.
 *
 * `filesystem.readJson` throws for a missing file and for malformed content alike, and neither is
 * exceptional here: most projects predate the chat panel, and a half-written index is a normal
 * consequence of quitting mid-save.
 */
async function readJsonOrNull(path: string): Promise<unknown> {
  try {
    if (!filesystem.exists(path)) return null;
    return await filesystem.readJson(path);
  } catch {
    return null;
  }
}

/** `requestIdleCallback` where it exists, a macrotask where it does not. */
function onIdle(fn: () => void): void {
  const ric = (globalThis as any).requestIdleCallback;
  if (typeof ric === 'function') ric(fn, { timeout: 2000 });
  else setTimeout(fn, 0);
}
