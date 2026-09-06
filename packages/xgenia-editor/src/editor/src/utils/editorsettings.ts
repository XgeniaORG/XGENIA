import { JSONStorage } from '@xgenia/platform';
import Model from '../../../shared/model';
import _ from 'underscore';

function deepMerge(dest, source) {
  for (const prop in source) {
    const sourceVal = source[prop];
    const destVal = dest[prop];
    if (prop in dest && _.isObject(sourceVal) && _.isObject(destVal)) {
      deepMerge(destVal, sourceVal);
    } else {
      dest[prop] = sourceVal;
    }
  }
  return dest;
}

function debounce(func, timeout = 300) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(func, timeout);
  };
}

export class EditorSettings extends Model {
  public static instance = new EditorSettings();

  private settings: TSFixme;
  private debouncedStore: () => void;
  private initializedFromLocalStorage: boolean = false;

  /**
   * Resolves once the persisted settings have been loaded.
   *
   * WHY (2026-08-28, "restarting the app made the OpenRouter key prompt go
   * away"): under Electron, JSONStorage is StorageNode — editorSettings lives in
   * a FILE, so the synchronous localStorage bootstrap below finds nothing and
   * every `get()` returns undefined until this async fetch lands. The AI panel
   * asks the host for `aiProvider` over the postMessage bridge as soon as it
   * boots; when that landed inside the window, the host answered "undefined",
   * the panel concluded there was no API key, and raised "XGENIA AI Setup
   * Required" at a user who had a key on disk the whole time. Restarting
   * re-rolled the timing, which is exactly what was reported.
   *
   * Anything answering a question ABOUT a setting (rather than reacting to a
   * change) should await this first. Note also that `fetch()` deep-merges with
   * the DISK value winning for scalars, so a write issued before this resolves
   * is silently reverted — one more reason to wait.
   */
  public readonly ready: Promise<void>;

  constructor() {
    super();
    this.settings = {};

    // Synchronously bootstrap from localStorage to avoid race conditions with async fetch
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('editorSettings');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && parsed.settings) {
            this.settings = parsed.settings || {};
            this.initializedFromLocalStorage = true;
          }
        }
      }
    } catch (err: any) {
      console.error('[EditorSettings] Failed synchronous localStorage init:', err);
    }

    // Continue with async fetch (will merge instead of overwrite)
    this.ready = this.fetch().then(
      () => undefined,
      (err: any) => {
        // A failed load must not leave `ready` pending forever — callers would
        // hang on a question that storage is never going to answer. Resolve and
        // let them work with whatever is in memory.
        console.error('[EditorSettings] Initial load failed; continuing with in-memory settings:', err);
      }
    );

    this.debouncedStore = debounce(() => this.store(), 1000);
  }

  async fetch() {
    const local = await JSONStorage.get('editorSettings');
    // Merge into current settings to prevent overwriting values set before fetch completes
    const incoming = local.settings || {};
    this.settings = deepMerge(this.settings || {}, incoming);
    // Prime the synchronous mirror as soon as the real settings land, so the NEXT launch
    // can answer get() before its first paint instead of waiting for this read.
    this.writeLocalStorageMirror();
  }

  async store() {
    await JSONStorage.set('editorSettings', { settings: this.settings });
    this.writeLocalStorageMirror();
  }

  /**
   * Mirror the settings into localStorage, which is synchronous and therefore readable
   * before the first paint.
   *
   * This is the write half of the bootstrap in the constructor and the lazy read in
   * `get()`. Both look for `editorSettings` in localStorage and nothing had ever put it
   * there, so under Electron — where JSONStorage is a FILE — all three read sites always
   * missed, and `get()` returned undefined for every caller that could not await `ready`.
   * That is what the WHY note on `ready` describes as unavoidable; it was not, the mirror
   * was simply never written.
   *
   * Written after the real store, never before, so the mirror can only lag the file and
   * never claim a value the file rejected. A full or unavailable localStorage is logged
   * and ignored: it must not fail the write that actually persists.
   */
  private writeLocalStorageMirror() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('editorSettings', JSON.stringify({ settings: this.settings }));
      this.initializedFromLocalStorage = true;
    } catch (err: any) {
      console.error('[EditorSettings] Failed to mirror settings to localStorage:', err);
    }
  }

  // @ts-expect-error Property 'set' in type 'EditorSettings' is not assignable to the same property in base type 'Model'.
  set(key: string, data) {
    this.settings[key] = data;
    this.debouncedStore();

    this.notifyListeners(`updated`, { key });
  }

  setMerge(key: string, data) {
    this.settings[key] = deepMerge(this.settings[key] || {}, data);
    this.debouncedStore();
  }

  get(key: string) {
    // Fast-path if present in memory
    if (Object.prototype.hasOwnProperty.call(this.settings, key)) {
      return this.settings[key];
    }

    // Lazy-load from localStorage if available to avoid empty reads before async fetch completes
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem('editorSettings');
        if (raw) {
          const parsed = JSON.parse(raw);
          const stored = parsed && parsed.settings ? parsed.settings[key] : undefined;
          if (typeof stored !== 'undefined') {
            this.settings[key] = stored;
            return stored;
          }
        }
      }
    } catch (err: any) {
      console.error('[EditorSettings] Failed lazy localStorage get:', err);
    }

    return this.settings[key];
  }
}
