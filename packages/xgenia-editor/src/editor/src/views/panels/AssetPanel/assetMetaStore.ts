/**
 * assetMetaStore.ts — the disk half of `.xgenia-assets.json`, kept free of React and
 * ProjectModel so it can be tested.
 *
 * WHY (2026-09-07, export 1788803211511 / NeonReelsSlot). `persist()` was
 * `filesystem.writeFile(path, JSON.stringify(cache))`, fired un-awaited by every commit().
 * The asset scanner commits once per inferred role and once per assigned uid, so opening a
 * 17-asset project issued 17+ overlapping non-atomic writes of different snapshots. Two of
 * them interleaved (open+truncate, open+truncate, write long, write short) and left
 * `<older snapshot><tail of the newer one>` on disk: 1786 bytes that parse, 150 that do not.
 * On the next open, loadAssetMeta() treated the parse failure as an empty project, and the
 * next commit rewrote the file from that empty cache — eight key-art split rectangles, every
 * AI prompt and every authored role gone, then torn again by the same burst.
 *
 * Three rules, each testable on its own:
 *   - Never two writes in flight. A burst coalesces to "write the newest snapshot once".
 *   - Never a partial file. Write a temp file, rename it over the target.
 *   - Never adopt an empty cache over a corrupt file. Salvage the longest valid prefix
 *     (a torn file's prefix IS a complete earlier snapshot) and keep the raw bytes.
 */

export type SalvageStatus = 'ok' | 'empty' | 'salvaged' | 'unrecoverable';

export interface SalvageResult {
  status: SalvageStatus;
  /** The parsed object. `{}` for 'empty' and 'unrecoverable'. */
  value: Record<string, any>;
  /** Length of the prefix that parsed, when status === 'salvaged'. */
  validPrefixChars?: number;
  /** The parse error for the whole text, when status is 'salvaged' or 'unrecoverable'. */
  error?: string;
}

function isPlainObject(v: any): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Parse a path→entry map, recovering the longest valid prefix of a torn file. */
export function salvageJsonObject(raw: string): SalvageResult {
  const text = typeof raw === 'string' ? raw : '';
  if (!text.trim()) return { status: 'empty', value: {} };

  let error = '';
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) return { status: 'ok', value: parsed };
    error = `top-level value is ${Array.isArray(parsed) ? 'an array' : typeof parsed}, not an object`;
    return { status: 'unrecoverable', value: {}, error };
  } catch (e: any) {
    error = e?.message || String(e);
  }

  // The parser names the seam ("… after JSON at position N"); try it first, then every
  // closing brace from the end. Bounded so a huge garbage file cannot spin here.
  const candidates: number[] = [];
  const m = /position (\d+)/.exec(error);
  if (m) candidates.push(Number(m[1]));
  let i = text.lastIndexOf('}');
  while (i > 0 && candidates.length < 64) {
    candidates.push(i + 1);
    i = text.lastIndexOf('}', i - 1);
  }
  for (const end of candidates) {
    if (!(end > 1 && end <= text.length)) continue;
    try {
      const parsed = JSON.parse(text.slice(0, end));
      if (isPlainObject(parsed)) return { status: 'salvaged', value: parsed, validPrefixChars: end, error };
    } catch {
      /* shorter */
    }
  }
  return { status: 'unrecoverable', value: {}, error };
}

export interface SerializedWriter<T> {
  /** Queue the newest payload. While a write is in flight only the latest payload is kept. */
  schedule(payload: T): Promise<void>;
  /** Resolves once every scheduled write has landed or failed. */
  idle(): Promise<void>;
}

export function createSerializedWriter<T>(
  write: (payload: T) => Promise<void>,
  onError?: (e: unknown) => void
): SerializedWriter<T> {
  let pending: { payload: T } | null = null;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    try {
      while (pending) {
        const next = pending;
        pending = null;
        try {
          // Always yield before writing so `running` is assigned before this loop can end,
          // even when `write` throws synchronously.
          await Promise.resolve().then(() => write(next.payload));
        } catch (e) {
          if (onError) onError(e);
        }
      }
    } finally {
      // Same microtask as the last `while (pending)` check: nothing can schedule in between.
      running = null;
    }
  }

  return {
    schedule(payload: T): Promise<void> {
      pending = { payload };
      if (!running) running = drain();
      return running;
    },
    idle(): Promise<void> {
      return running || Promise.resolve();
    }
  };
}

export interface AtomicTextFs {
  writeFile(path: string, text: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

let tmpSequence = 0;

/** Write to a sibling temp file, then rename over the target. A reader sees the old file or
 *  the new one, never a partial. */
export async function atomicWriteText(fs: AtomicTextFs, path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${Date.now()}-${++tmpSequence}`;
  try {
    await fs.writeFile(tmp, text);
    await fs.renameFile(tmp, path);
  } catch (e) {
    await fs.removeFile(tmp).catch(() => {});
    throw e;
  }
}
