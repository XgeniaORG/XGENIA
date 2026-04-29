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
    this.fetch();

    this.debouncedStore = debounce(() => this.store(), 1000);
  }

  async fetch() {
    const local = await JSONStorage.get('editorSettings');
    // Merge into current settings to prevent overwriting values set before fetch completes
    const incoming = local.settings || {};
    this.settings = deepMerge(this.settings || {}, incoming);
  }

  async store() {
    await JSONStorage.set('editorSettings', { settings: this.settings });
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
