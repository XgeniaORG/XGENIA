// src/editor/src/models/publishStore.ts — pure; the editor-wired singleton lives in publishstate.ts.
export type PublishPhase = 'idle' | 'publishing' | 'live' | 'failed';

export interface PublishSnapshot {
  phase: PublishPhase;
  label?: string;
  url?: string;
  publishedAt?: number;
  publishCount: number;
  dirty: boolean;
  error?: string;
  changedAt: number;
}

export interface PublishStoreDeps {
  storage: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  now: () => number;
}

export interface PublishStore {
  getSnapshot(): PublishSnapshot;
  subscribe(fn: (s: PublishSnapshot) => void): () => void;
  load(projectKey: string): void;
  begin(): void;
  progress(label: string): void;
  succeed(url: string): void;
  fail(error: string): void;
  markDirty(): void;
}

const KEY_PREFIX = 'xgenia-publish-state:';
type Persisted = Pick<PublishSnapshot, 'url' | 'publishedAt' | 'publishCount' | 'dirty'>;

export function createPublishStore(deps: PublishStoreDeps): PublishStore {
  let key: string | null = null;
  let snap: PublishSnapshot = { phase: 'idle', publishCount: 0, dirty: false, changedAt: deps.now() };
  const subs = new Set<(s: PublishSnapshot) => void>();
  /**
   * An edit that lands WHILE a publish is running is not covered by that publish —
   * the bundle was already built from the earlier graph. Remember it and re-raise
   * `dirty` on success, otherwise the change is silently reported as live.
   */
  let dirtiedDuringPublish = false;

  function notify() {
    // One throwing subscriber must not starve the others, and must never propagate
    // into the deploy pipeline: a throw out of succeed() lands in the deploy tab's
    // outer catch, which then reports a SUCCESSFUL publish to the user as a failure.
    subs.forEach((fn) => {
      try {
        fn(snapshot());
      } catch (e) {
        console.error('[publishStore] subscriber threw; continuing', e);
      }
    });
  }

  /** Callers get a copy: the snapshot goes straight into React props, and an in-place
   *  edit there would rewrite this store's single source of truth and get persisted. */
  function snapshot(): PublishSnapshot {
    return { ...snap };
  }

  function set(patch: Partial<PublishSnapshot>) {
    snap = { ...snap, ...patch, changedAt: deps.now() };
    persist();
    notify();
  }

  function persist() {
    if (!deps.storage || !key) return;
    const p: Persisted = { url: snap.url, publishedAt: snap.publishedAt, publishCount: snap.publishCount, dirty: snap.dirty };
    try { deps.storage.setItem(KEY_PREFIX + key, JSON.stringify(p)); } catch { /* storage full or blocked: in-memory only */ }
  }

  /** Persisted values come from localStorage, which any earlier build or a user with
   *  devtools could have written. Reject anything of the wrong type rather than
   *  letting a string timestamp reach Date arithmetic and render as "NaNw". */
  function num(v: unknown): number | undefined {
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  }
  function str(v: unknown): string | undefined {
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  }

  return {
    getSnapshot: snapshot,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    load(projectKey) {
      key = projectKey;
      let raw: Record<string, unknown> = {};
      if (deps.storage) {
        try {
          const parsed = JSON.parse(deps.storage.getItem(KEY_PREFIX + key) || '{}');
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
        } catch { raw = {}; }
      }
      dirtiedDuringPublish = false;
      snap = {
        phase: 'idle',
        url: str(raw.url),
        publishedAt: num(raw.publishedAt),
        publishCount: num(raw.publishCount) ?? 0,
        dirty: raw.dirty === true,
        changedAt: deps.now()
      };
      notify();
    },
    begin() { dirtiedDuringPublish = false; set({ phase: 'publishing', label: undefined, error: undefined, dirty: false }); },
    progress(label) { if (snap.phase === 'publishing') set({ label }); },
    succeed(url) {
      // Edits made mid-publish are NOT in the bundle that just went live.
      const carried = dirtiedDuringPublish;
      dirtiedDuringPublish = false;
      set({ phase: 'live', url, publishedAt: deps.now(), publishCount: snap.publishCount + 1, dirty: carried, label: undefined, error: undefined });
    },
    fail(error) { dirtiedDuringPublish = false; set({ phase: 'failed', error, label: undefined }); },
    markDirty() {
      if (snap.phase === 'publishing') { dirtiedDuringPublish = true; return; }
      if (!snap.dirty) set({ dirty: true });
    }
  };
}
