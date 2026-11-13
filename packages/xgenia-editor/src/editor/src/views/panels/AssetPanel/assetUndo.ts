// Asset edits on the editor's ONE undo history, so ⌘Z undoes a rename or a placement drag the same
// way it undoes a node move — in order with them.
//
// The editor's UndoQueue is synchronous; file operations are not. Each step is therefore queued on a
// serial chain: undo, redo, undo pressed back to back run in exactly that order, and a failing step
// is reported and skipped instead of wedging everything after it. Pure: the queue is injected.

export interface UndoGroupLike {
  label: string;
  do: () => void;
  undo: () => void;
}

export function createAsyncUndo(
  queue: { push: (group: any) => void },
  onChanged: () => void,
  onError: (message: string) => void,
  makeGroup: (g: UndoGroupLike) => any = (g) => g
) {
  let chain: Promise<void> = Promise.resolve();
  const run = (step: () => Promise<void>) => {
    chain = chain.then(async () => {
      try {
        await step();
      } catch (e: any) {
        onError(e?.message || String(e));
      } finally {
        onChanged();
      }
    });
    return chain;
  };
  return {
    /** The do/undo pair for a step, for callers composing one undo group out of several edits. */
    actions(redo: () => Promise<void>, undo: () => Promise<void>) {
      return { do: () => void run(redo), undo: () => void run(undo) };
    },
    /** Record an edit that has ALREADY been applied. */
    record(label: string, redo: () => Promise<void>, undo: () => Promise<void>) {
      queue.push(makeGroup({ label, do: () => void run(redo), undo: () => void run(undo) }));
    },
    /** Apply an edit and record it. */
    async perform(label: string, redo: () => Promise<void>, undo: () => Promise<void>) {
      await redo();
      this.record(label, redo, undo);
    },
    idle: () => chain
  };
}

/**
 * Build an editor UndoActionGroup that actually runs its step. The group's constructor accepts
 * do/undo but leaves its internal pointer at 0, and `undo()` walks back from that pointer — so a
 * group built that way undoes nothing. `push` moves the pointer past the action.
 */
export function makeUndoGroup<G extends { push: (a: { do?: () => void; undo?: () => void }) => void }>(
  Group: new (args: { label: string }) => G,
  g: UndoGroupLike
): G {
  const group = new Group({ label: g.label });
  group.push({ do: g.do, undo: g.undo });
  return group;
}

// ─── row diffs ───────────────────────────────────────────────────────────────
//
// Undo of a metadata edit must restore only what THAT edit changed. Writing whole rows back erased
// anything written to the same asset in between — an AI re-split's new layout, a scanner uid.

const NESTED = new Set(['ai', 'sprite', 'version']);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Key paths that differ between two rows; one level deep inside ai / sprite / version. */
export function diffRowPaths(before: Record<string, any> | null, after: Record<string, any> | null): string[][] {
  const a = before || {};
  const b = after || {};
  const out: string[][] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (same(a[k], b[k])) continue;
    const bothObjects = NESTED.has(k) && a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object';
    if (!bothObjects) {
      out.push([k]);
      continue;
    }
    for (const sub of new Set([...Object.keys(a[k]), ...Object.keys(b[k])])) {
      if (!same(a[k][sub], b[k][sub])) out.push([k, sub]);
    }
  }
  return out;
}

/** `current` with each path set to its value in `source` (removed where `source` has none). */
export function applyRowPaths(current: Record<string, any> | null, source: Record<string, any> | null, paths: string[][]): Record<string, any> {
  const out: Record<string, any> = JSON.parse(JSON.stringify(current || {}));
  const src = source || {};
  for (const [k, sub] of paths) {
    if (sub === undefined) {
      if (src[k] === undefined) delete out[k];
      else out[k] = JSON.parse(JSON.stringify(src[k]));
      continue;
    }
    const value = src[k]?.[sub];
    if (value === undefined) {
      if (out[k]) delete out[k][sub];
    } else {
      out[k] = { ...(out[k] || {}), [sub]: JSON.parse(JSON.stringify(value)) };
    }
    if (out[k] && typeof out[k] === 'object' && Object.keys(out[k]).length === 0) delete out[k];
  }
  return out;
}
