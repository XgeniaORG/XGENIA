'use strict';

// Languages Dictionary
// --------------------
// Translation / localisation node. It holds one dictionary covering many
// languages and gives EVERY phrase its own output port, so a whole screen is
// translated by dropping in one node, filling the table and dragging the ports
// onto Text nodes. Change `Language` and every port switches at once. There is
// deliberately no "key in / text out" pair: the ports ARE the keys.
//
// The dictionary is edited as a table in the property panel (Open Table), and
// stored in the `dictionary` parameter in whichever of these shapes it arrived:
//
//   table (what the table editor writes, and the easiest to type by hand)
//     key,        en,      id
//     hello,      Hello,   Halo
//     home.title, Home,    Beranda
//
//   rows — a JSON array, one object per phrase. This is the shape meant for
//   tools that GENERATE or UPDATE translations (the AI chat panel, a script, an
//   import): appending a phrase is appending an object, and translating one more
//   language is one more field.
//     [{ "key": "hello", "en": "Hello", "id": "Halo" }]
//
//   json — a nested dictionary, as exported by most translation tools. Both
//   layouts are auto-detected:
//     { "en": { "hello": "Hi" }, "id": { ... } }      (language first)
//     { "hello": { "en": "Hi", "id": "Hai" } }        (key first)
//
// Whatever the shape, editing the table writes it back in the SAME shape, so a
// dictionary an AI keeps as a JSON array stays a JSON array.
//
// A dictionary can also arrive at runtime on the `Dictionary Data` port — from
// an Object node, `Import from JSON file`, or a REST response — as any of the
// object or array shapes above. Since the editor cannot know its keys ahead of
// time, list the ones you need in `Extra Keys` to get ports for them.
//
// Nested objects are addressed with dot paths ("home.title"). Placeholders
// written as {name} are filled from the `variables` input, matching the String
// Format node's syntax.
//
// The per-phrase ports are dynamic and follow the String Format / Convert Inputs
// into Record pattern: the editor side (setup) pushes the layout with
// editorConnection.sendDynamicPorts, the runtime side registers them on demand
// in registerOutputIfNeeded.
//
// parseDictionaryValue / dictionaryToGrid / serializeDictionary are exported for
// the property panel's table editor (xgenia-editor .../DataTypes/TranslationsTable),
// so the editor and the runtime always read and write the same formats.

// Output ports the node owns itself. A phrase key colliding with one of these
// gets no port of its own (it would shadow the static one) — it is still
// reachable through the `translations` object.
const RESERVED_OUTPUTS = {
  resolvedLanguage: true,
  languages: true,
  translations: true,
  Changed: true,
  Missing: true
};

// A dictionary big enough to bury the node in ports stops getting automatic
// ones; `Extra Keys` then picks out the handful actually wired up.
const MAX_AUTO_PORTS = 50;

const LANGUAGE_CODE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/;

const DEFAULT_DICTIONARY = ['key, en, id', 'hello, Hello, Halo', 'goodbye, Goodbye, Selamat tinggal'].join('\n');

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Unwrap an XGENIA Object/Record (a Model proxy) into its plain data. A Model
// answers to `.get()` and carries its properties on `.data`; a plain dictionary
// that happens to have a `data` key does not, so this never unwraps by accident.
function toPlainData(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.get === 'function' && value.data && typeof value.data === 'object') {
    return value.data;
  }
  return value;
}

// Follow a dot path ("home.title") through nested objects.
function resolvePath(obj, path) {
  if (!isPlainObject(obj)) return undefined;
  if (path.indexOf('.') === -1) return obj[path];

  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (!isPlainObject(current)) return undefined;
    current = current[parts[i]];
  }
  return current;
}

// How deep a dictionary may nest before the rest is left alone. Dictionaries are
// two or three levels deep in practice; the cap is what keeps a self-referencing
// object (an Object node's data can hold anything) from recursing forever.
const MAX_NESTING = 8;

// Flatten nested objects into { "home.title": "Home" } so a translation table is
// a flat lookup and keys can address any depth.
function flatten(obj, prefix, out, depth) {
  const level = depth || 0;

  Object.keys(obj).forEach(function (k) {
    const value = obj[k];
    const path = prefix ? prefix + '.' + k : k;
    if (isPlainObject(value) && level < MAX_NESTING) {
      flatten(value, path, out, level + 1);
    } else if (!isPlainObject(value)) {
      out[path] = value;
    }
  });
  return out;
}

// ── The table format ──────────────────────────────────────────────────────────
// Row one names the languages, every row after it is "key, translation, ...".
// Columns are separated by a tab, a pipe or a comma — whichever the header row
// uses — so a table pasted from a spreadsheet works as-is. A cell containing the
// separator is wrapped in double quotes, CSV style ("Halo, apa kabar").

function splitRow(line, separator) {
  const cells = [];
  let current = '';
  let quoted = false;
  let wasQuoted = false;

  for (let i = 0; i < line.length; i++) {
    const character = line.charAt(i);

    if (quoted) {
      if (character === '"') {
        if (line.charAt(i + 1) === '"') {
          current += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        current += character;
      }
    } else if (character === '"' && current.trim() === '') {
      quoted = true;
      wasQuoted = true;
      current = '';
    } else if (character === separator) {
      cells.push(wasQuoted ? current : current.trim());
      current = '';
      wasQuoted = false;
    } else {
      current += character;
    }
  }
  cells.push(wasQuoted ? current : current.trim());

  return cells;
}

function separatorFor(headerLine) {
  if (headerLine.indexOf('\t') !== -1) return '\t';
  if (headerLine.indexOf('|') !== -1) return '|';
  return ',';
}

function parseTable(text) {
  const lines = text
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line !== '' && line.charAt(0) !== '#' && line.indexOf('//') !== 0;
    });

  if (lines.length < 2) return null;

  const separator = separatorFor(lines[0]);

  // The first cell of the header is just a label for the key column ("key",
  // "name", or nothing at all) — the languages start at the second cell.
  const languages = splitRow(lines[0], separator).slice(1);
  if (languages.length === 0) return null;

  const dictionary = {};
  languages.forEach(function (language) {
    if (language !== '') dictionary[language] = {};
  });

  for (let i = 1; i < lines.length; i++) {
    const cells = splitRow(lines[i], separator);
    const key = cells[0];
    if (key === '') continue;

    languages.forEach(function (language, index) {
      const value = cells[index + 1];
      // An empty cell is left out so the fallback language fills the gap.
      if (language !== '' && value !== undefined && value !== '') {
        dictionary[language][key] = value;
      }
    });
  }

  return dictionary;
}

function quoteCell(value, separator) {
  const text = value === undefined || value === null ? '' : String(value);
  const needsQuotes =
    text.indexOf(separator) !== -1 || text.indexOf('"') !== -1 || text !== text.trim() || text.indexOf('\n') !== -1;

  return needsQuotes ? '"' + text.split('"').join('""') + '"' : text;
}

// ── The rows format ───────────────────────────────────────────────────────────
// A JSON array, either one object per phrase ({ key, en, id }) or one array per
// row with the languages in a header row ([["key","en"],["hello","Hello"]]).

function rowsToDictionary(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  let languages;
  let entries;

  if (Array.isArray(rows[0])) {
    const header = rows[0].map(function (cell) {
      return cell === undefined || cell === null ? '' : String(cell).trim();
    });
    languages = header.slice(1);
    entries = rows.slice(1).map(function (row) {
      const values = {};
      languages.forEach(function (language, index) {
        values[language] = Array.isArray(row) ? row[index + 1] : undefined;
      });
      return { key: Array.isArray(row) ? row[0] : undefined, values: values };
    });
  } else if (isPlainObject(rows[0])) {
    // The key column is the field called "key" if there is one, otherwise the
    // first field of the first row. Every other field is a language.
    const fields = Object.keys(rows[0]);
    const keyField =
      fields.filter(function (f) {
        return f.toLowerCase() === 'key';
      })[0] || fields[0];

    languages = [];
    rows.forEach(function (row) {
      if (!isPlainObject(row)) return;
      Object.keys(row).forEach(function (field) {
        if (field !== keyField && languages.indexOf(field) === -1) languages.push(field);
      });
    });

    entries = rows.map(function (row) {
      if (!isPlainObject(row)) return { key: undefined, values: {} };
      const values = {};
      languages.forEach(function (language) {
        values[language] = row[language];
      });
      return { key: row[keyField], values: values };
    });
  } else {
    return null;
  }

  if (languages.length === 0) return null;

  const dictionary = {};
  languages.forEach(function (language) {
    if (language !== '') dictionary[language] = {};
  });

  entries.forEach(function (entry) {
    const key = entry.key === undefined || entry.key === null ? '' : String(entry.key).trim();
    if (key === '') return;

    languages.forEach(function (language) {
      const value = entry.values[language];
      if (language !== '' && value !== undefined && value !== null && value !== '') {
        dictionary[language][key] = value;
      }
    });
  });

  return dictionary;
}

/**
 * Read a dictionary out of anything the node accepts.
 *
 * @returns {{ dictionary: object|null, source: 'table'|'rows'|'json', error: string|null }}
 *          `source` is the shape it was written in, so an edit can be saved back
 *          the same way.
 */
function parseDictionaryValue(value) {
  const empty = { dictionary: null, source: 'table', error: null };
  if (value === undefined || value === null) return empty;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return empty;

    if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        return { dictionary: null, source: 'table', error: 'The dictionary is not valid JSON: ' + e.message };
      }
      return parseDictionaryValue(parsed);
    }

    const table = parseTable(trimmed);
    if (!table) {
      return {
        dictionary: null,
        source: 'table',
        error:
          'The dictionary needs a header row naming the languages and at least one phrase below it, ' +
          'for example:\nkey, en, id\nhello, Hello, Halo'
      };
    }
    return { dictionary: table, source: 'table', error: null };
  }

  const plain = toPlainData(value);

  if (Array.isArray(plain)) {
    const fromRows = rowsToDictionary(plain);
    if (!fromRows) {
      return {
        dictionary: null,
        source: 'rows',
        error:
          'A dictionary array needs one object per phrase, for example:\n' +
          '[{ "key": "hello", "en": "Hello", "id": "Halo" }]'
      };
    }
    return { dictionary: fromRows, source: 'rows', error: null };
  }

  if (isPlainObject(plain)) return { dictionary: plain, source: 'json', error: null };

  return empty;
}

/** Write a grid ({ languages, rows }) back out in the shape it came from. */
function serializeDictionary(grid, source) {
  const languages = grid.languages.filter(function (language) {
    return String(language).trim() !== '';
  });
  const rows = grid.rows.filter(function (row) {
    return String(row.key).trim() !== '';
  });

  if (source === 'rows') {
    return JSON.stringify(
      rows.map(function (row) {
        const entry = { key: String(row.key).trim() };
        languages.forEach(function (language) {
          entry[language] = row.values[language] === undefined ? '' : String(row.values[language]);
        });
        return entry;
      }),
      null,
      2
    );
  }

  // A nested dictionary is written back as a language-first object. Its phrase
  // keys keep the dot paths they were read with, so { home: { title } } comes
  // back as "home.title" — flat, but the same dictionary to every reader.
  if (source === 'json') {
    const dictionary = {};
    languages.forEach(function (language) {
      dictionary[language] = {};
    });
    rows.forEach(function (row) {
      const key = String(row.key).trim();
      languages.forEach(function (language) {
        const value = row.values[language];
        if (value !== undefined && value !== '') dictionary[language][key] = String(value);
      });
    });
    return JSON.stringify(dictionary, null, 2);
  }

  const separator = ',';
  const lines = [
    ['key']
      .concat(
        languages.map(function (language) {
          return quoteCell(language, separator);
        })
      )
      .join(', ')
  ];

  rows.forEach(function (row) {
    lines.push(
      [quoteCell(String(row.key).trim(), separator)]
        .concat(
          languages.map(function (language) {
            return quoteCell(row.values[language], separator);
          })
        )
        .join(', ')
    );
  });

  return lines.join('\n');
}

// key-first dictionaries hold { key: { lang: text } }; the languages are the
// union of the inner keys, one level below any nesting of the key itself.
function collectKeyFirstLanguages(obj, depth, out) {
  Object.keys(obj).forEach(function (k) {
    const value = obj[k];
    if (!isPlainObject(value)) return;

    const innerKeys = Object.keys(value);
    const allLeaves = innerKeys.every(function (ik) {
      return !isPlainObject(value[ik]);
    });

    if (allLeaves && innerKeys.length > 0) {
      innerKeys.forEach(function (ik) {
        out[ik] = true;
      });
    } else if (depth < 4) {
      collectKeyFirstLanguages(value, depth + 1, out);
    }
  });
  return out;
}

function looksLikeLanguageFirst(dict) {
  const keys = Object.keys(dict);
  if (keys.length === 0) return true;

  // Every top level entry must be a container, and the majority must read as a
  // language code — "en"/"id"/"pt-BR" at the top means language-first.
  const containers = keys.filter(function (k) {
    return isPlainObject(dict[k]);
  });
  const codes = keys.filter(function (k) {
    return LANGUAGE_CODE.test(k);
  });

  return containers.length === keys.length && codes.length * 2 > keys.length;
}

function isLanguageFirstDictionary(dict, format) {
  if (format === 'languageFirst') return true;
  if (format === 'keyFirst') return false;
  return looksLikeLanguageFirst(dict);
}

function availableLanguages(dict, languageFirst) {
  if (!isPlainObject(dict)) return [];
  if (languageFirst) return Object.keys(dict);
  return Object.keys(collectKeyFirstLanguages(dict, 0, {}));
}

// Flat { key: text } table for one language, whichever layout is in use.
function tableForLanguage(dict, languageFirst, language) {
  if (!language || !isPlainObject(dict)) return {};

  if (languageFirst) {
    const branch = dict[language];
    return isPlainObject(branch) ? flatten(branch, '', {}) : {};
  }

  // In a key-first dictionary the flattened path ENDS with the language code, so
  // "greeting.en" becomes table["greeting"] for language "en".
  const table = {};
  const flat = flatten(dict, '', {});
  Object.keys(flat).forEach(function (path) {
    const parts = path.split('.');
    const last = parts.pop();
    if (last === language && parts.length > 0) {
      table[parts.join('.')] = flat[path];
    }
  });
  return table;
}

// Every phrase key in the dictionary, whichever layout it uses. Drives the
// automatic output ports.
function keysOfDictionary(dict, format) {
  if (!isPlainObject(dict)) return [];

  const set = {};
  if (isLanguageFirstDictionary(dict, format)) {
    Object.keys(dict).forEach(function (language) {
      const branch = dict[language];
      if (!isPlainObject(branch)) return;
      Object.keys(flatten(branch, '', {})).forEach(function (key) {
        set[key] = true;
      });
    });
  } else {
    Object.keys(flatten(dict, '', {})).forEach(function (path) {
      const parts = path.split('.');
      parts.pop();
      if (parts.length > 0) set[parts.join('.')] = true;
    });
  }
  return Object.keys(set);
}

/** Turn a dictionary into the { languages, rows } grid the table editor shows. */
function dictionaryToGrid(dictionary, format) {
  if (!isPlainObject(dictionary)) return { languages: [], rows: [] };

  const languageFirst = isLanguageFirstDictionary(dictionary, format);
  const languages = availableLanguages(dictionary, languageFirst);
  const tables = {};
  languages.forEach(function (language) {
    tables[language] = tableForLanguage(dictionary, languageFirst, language);
  });

  const rows = keysOfDictionary(dictionary, format).map(function (key) {
    const values = {};
    languages.forEach(function (language) {
      const value = tables[language][key];
      values[language] = value === undefined ? '' : String(value);
    });
    return { key: key, values: values };
  });

  return { languages: languages, rows: rows };
}

// Match a requested language against what the dictionary actually carries:
// exact, then case-insensitive, then base language ("id-ID" -> "id"), then any
// regional variant of the base ("en" -> "en-US").
function matchLanguage(requested, available) {
  if (!requested) return null;

  const wanted = String(requested).trim();
  if (wanted === '') return null;
  if (available.indexOf(wanted) !== -1) return wanted;

  const lower = wanted.toLowerCase().replace('_', '-');
  for (let i = 0; i < available.length; i++) {
    if (available[i].toLowerCase().replace('_', '-') === lower) return available[i];
  }

  const base = lower.split('-')[0];
  for (let i = 0; i < available.length; i++) {
    if (available[i].toLowerCase().replace('_', '-') === base) return available[i];
  }
  for (let i = 0; i < available.length; i++) {
    if (available[i].toLowerCase().replace('_', '-').split('-')[0] === base) return available[i];
  }

  return null;
}

function parseKeyList(value) {
  if (!value) return [];

  return String(value)
    .split(/[\n,;]/)
    .map(function (k) {
      return k.trim();
    })
    .filter(function (k, index, self) {
      return k !== '' && self.indexOf(k) === index;
    });
}

function prettifyKey(key) {
  const last = key.split('.').pop();
  return last
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, function (c) {
      return c.toUpperCase();
    });
}

const LanguagesDictionaryNode = {
  name: 'Languages Dictionary',
  displayNodeName: 'Languages Dictionary',
  docs: 'https://docsapp.xgenia.com/nodes/utilities/localization/languages-dictionary',
  shortDesc: 'Fill in a table of phrases and get every one of them as an output, in any language.',
  category: 'Utilities',
  color: 'data',
  usePortAsLabel: 'language',
  searchTags: [
    'i18n',
    'l10n',
    'translate',
    'translation',
    'translator',
    'language',
    'languages',
    'locale',
    'localization',
    'localisation',
    'dictionary',
    'multilanguage',
    'bahasa',
    'terjemah'
  ],

  initialize: function () {
    const internal = this._internal;

    internal.dictionaryData = null;
    internal.dictionaryValue = DEFAULT_DICTIONARY;
    internal.parsedValue = parseDictionaryValue(DEFAULT_DICTIONARY).dictionary;
    internal.dictionaryFormat = 'auto';
    internal.language = '';
    internal.fallbackLanguage = 'en';
    internal.autoDetectLanguage = false;
    internal.extraKeys = [];
    internal.variables = null;
    internal.missingBehavior = 'key';
    internal.missingText = '';

    internal.resolvedLanguage = '';
    internal.languages = [];
    internal.translations = {};
    internal.byKey = {};
    internal.hasScheduledTranslate = false;
  },

  getInspectInfo: function () {
    const internal = this._internal;
    if (!internal.resolvedLanguage) return '[No dictionary]';

    return {
      type: 'value',
      value: {
        language: internal.resolvedLanguage,
        languages: internal.languages,
        translations: internal.translations
      }
    };
  },

  inputs: {
    dictionary: {
      type: { name: 'translations-table', allowEditOnly: true },
      displayName: 'Dictionary',
      group: 'Dictionary',
      default: DEFAULT_DICTIONARY,
      index: 1,
      set: function (value) {
        this.applyDictionary(value);
      }
    },
    language: {
      type: 'string',
      displayName: 'Language',
      group: 'Language',
      default: '',
      index: 2,
      set: function (value) {
        this._internal.language = value === undefined || value === null ? '' : String(value);
        this.scheduleTranslate();
      }
    },
    fallbackLanguage: {
      type: 'string',
      displayName: 'Fallback Language',
      group: 'Language',
      default: 'en',
      index: 3,
      set: function (value) {
        this._internal.fallbackLanguage = value === undefined || value === null ? '' : String(value);
        this.scheduleTranslate();
      }
    },
    autoDetectLanguage: {
      type: 'boolean',
      displayName: 'Use Device Language',
      group: 'Language',
      default: false,
      index: 4,
      set: function (value) {
        this._internal.autoDetectLanguage = !!value;
        this.scheduleTranslate();
      }
    },
    variables: {
      type: 'object',
      displayName: 'Variables',
      group: 'Translation',
      index: 5,
      set: function (value) {
        const plain = toPlainData(value);
        this._internal.variables = isPlainObject(plain) ? plain : null;
        this.scheduleTranslate();
      }
    },
    dictionaryData: {
      type: '*',
      displayName: 'Dictionary Data',
      group: 'Advanced',
      index: 10,
      set: function (value) {
        this.applyDictionaryData(value);
      }
    },
    extraKeys: {
      type: { name: 'string', multiline: true },
      displayName: 'Extra Keys',
      group: 'Advanced',
      default: '',
      index: 11,
      set: function (value) {
        this._internal.extraKeys = parseKeyList(value);
        this.scheduleTranslate();
      }
    },
    dictionaryFormat: {
      type: {
        name: 'enum',
        enums: [
          { label: 'Auto detect', value: 'auto' },
          { label: 'Language first { en: { key: text } }', value: 'languageFirst' },
          { label: 'Key first { key: { en: text } }', value: 'keyFirst' }
        ],
        allowEditOnly: true
      },
      displayName: 'Dictionary Format',
      group: 'Advanced',
      default: 'auto',
      index: 12,
      set: function (value) {
        this._internal.dictionaryFormat = value || 'auto';
        this.scheduleTranslate();
      }
    },
    missingBehavior: {
      type: {
        name: 'enum',
        enums: [
          { label: 'Show the key', value: 'key' },
          { label: 'Show nothing', value: 'empty' },
          { label: 'Show missing text', value: 'custom' }
        ],
        allowEditOnly: true
      },
      displayName: 'When Missing',
      group: 'Advanced',
      default: 'key',
      index: 13,
      set: function (value) {
        this._internal.missingBehavior = value || 'key';
        this.scheduleTranslate();
      }
    },
    missingText: {
      type: 'string',
      displayName: 'Missing Text',
      group: 'Advanced',
      default: '',
      index: 14,
      set: function (value) {
        this._internal.missingText = value === undefined || value === null ? '' : String(value);
        this.scheduleTranslate();
      }
    },
    Translate: {
      type: 'signal',
      displayName: 'Translate',
      group: 'Advanced',
      index: 15,
      valueChangedToTrue: function () {
        this.scheduleTranslate();
      }
    },

    // ── Ports from the first iteration of this node ──────────────────────────
    // A project saved while those ports existed still carries their parameters.
    // Without somewhere for them to land, loading it logs "node doesn't have
    // input ..." and silently drops the dictionary, so they are kept as hidden
    // aliases of the ports that replaced them.
    dictionaryJson: {
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        if (value === undefined || value === null || String(value).trim() === '') return;
        this.applyDictionary(value);
      }
    },
    dictionaryObject: {
      type: '*',
      exportToEditor: false,
      set: function (value) {
        if (value === undefined || value === null) return;
        this.applyDictionaryData(value);
      }
    },
    keys: {
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        this._internal.extraKeys = parseKeyList(value);
        this.scheduleTranslate();
      }
    },
    key: {
      // The single lookup key became one port per phrase; keeping it as an extra
      // key means the phrase it named still has an output to connect to.
      type: 'string',
      exportToEditor: false,
      set: function (value) {
        const key = value === undefined || value === null ? '' : String(value).trim();
        if (key === '') return;

        const internal = this._internal;
        if (internal.extraKeys.indexOf(key) === -1) internal.extraKeys = internal.extraKeys.concat(key);
        this.scheduleTranslate();
      }
    }
  },

  outputs: {
    resolvedLanguage: {
      type: 'string',
      displayName: 'Resolved Language',
      group: 'Result',
      getter: function () {
        return this._internal.resolvedLanguage;
      }
    },
    languages: {
      type: 'array',
      displayName: 'Languages',
      group: 'Result',
      getter: function () {
        return this._internal.languages;
      }
    },
    translations: {
      type: 'object',
      displayName: 'Translations',
      group: 'Result',
      getter: function () {
        return this._internal.translations;
      }
    },
    Changed: {
      type: 'signal',
      displayName: 'Changed',
      group: 'Events'
    },
    Missing: {
      type: 'signal',
      displayName: 'Missing',
      group: 'Events'
    }
  },

  prototypeExtensions: {
    // One output per phrase. They are registered lazily so a connection made in
    // the editor always finds its port.
    registerOutputIfNeeded: function (name) {
      if (this.hasOutput(name) || RESERVED_OUTPUTS[name]) return;

      this.registerOutput(name, {
        type: 'string',
        displayName: prettifyKey(name),
        group: 'Translations',
        // Output getters are called with the owning node as `this`.
        getter: function () {
          const value = this._internal.byKey[name];
          return value === undefined ? '' : value;
        }
      });
    },

    // Warnings only exist when running against the editor; the viewer and the
    // cloud runtime have no editor connection. Inputs are also set while the node
    // is still being attached, before it has a scope to name a component with, so
    // everything here is checked rather than assumed.
    warningTarget: function () {
      if (!this.context || !this.context.editorConnection) return null;
      if (!this.nodeScope || !this.nodeScope.componentOwner) return null;

      return {
        connection: this.context.editorConnection,
        componentName: this.nodeScope.componentOwner.name
      };
    },

    setDictionaryWarning: function (message) {
      const target = this.warningTarget();
      if (!target) return;

      target.connection.sendWarning(target.componentName, this.id, 'languages-dictionary-parse', {
        message: message,
        showGlobally: true
      });
    },

    clearDictionaryWarning: function () {
      const target = this.warningTarget();
      if (!target) return;

      target.connection.clearWarning(target.componentName, this.id, 'languages-dictionary-parse');
    },

    applyDictionary: function (value) {
      const internal = this._internal;
      internal.dictionaryValue = value;

      const result = parseDictionaryValue(value);
      internal.parsedValue = result.dictionary;

      if (result.error) this.setDictionaryWarning(result.error);
      else this.clearDictionaryWarning();

      this.scheduleTranslate();
    },

    applyDictionaryData: function (value) {
      const result = parseDictionaryValue(value);
      this._internal.dictionaryData = result.dictionary;

      if (result.error) this.setDictionaryWarning(result.error);
      else this.clearDictionaryWarning();

      this.scheduleTranslate();
    },

    // A dictionary arriving on the port wins over the one in the table, so a
    // project can ship phrases in the node and still load translations at runtime.
    currentDictionary: function () {
      const internal = this._internal;
      if (isPlainObject(internal.dictionaryData)) return internal.dictionaryData;
      if (isPlainObject(internal.parsedValue)) return internal.parsedValue;
      return null;
    },

    // The language actually used: the requested one, the device one, or the
    // fallback — each matched loosely against the dictionary. If none of them is
    // in the dictionary the FIRST language of the dictionary is used, so a typo
    // in the Language field still shows readable text instead of bare keys.
    resolveLanguage: function (available) {
      const internal = this._internal;

      let requested = internal.language;
      if ((!requested || requested.trim() === '') && internal.autoDetectLanguage) {
        requested = this.detectBrowserLanguage();
      }

      return (
        matchLanguage(requested, available) ||
        matchLanguage(internal.fallbackLanguage, available) ||
        (available.length > 0 ? available[0] : null)
      );
    },

    detectBrowserLanguage: function () {
      if (typeof navigator === 'undefined') return '';
      if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages[0];
      return navigator.language || '';
    },

    // Keys are matched exactly first, then ignoring case and surrounding spaces —
    // "Hello" finds the "hello" row instead of showing a missing translation.
    lookup: function (table, key) {
      const direct = table[key];
      if (direct !== undefined) return direct;

      const trimmed = key.trim();
      if (trimmed !== key && table[trimmed] !== undefined) return table[trimmed];

      const wanted = trimmed.toLowerCase();
      const names = Object.keys(table);
      for (let i = 0; i < names.length; i++) {
        if (names[i].toLowerCase() === wanted) return table[names[i]];
      }
      return undefined;
    },

    // {name} placeholders, same syntax as the String Format node. An unknown
    // placeholder is left untouched rather than blanked, so a missing variable
    // is visible instead of silently eating part of the sentence.
    interpolate: function (text) {
      const variables = this._internal.variables;
      if (typeof text !== 'string' || text.indexOf('{') === -1) return text;

      return text.replace(/\{([A-Za-z0-9_.]+)\}/g, function (match, name) {
        if (!isPlainObject(variables)) return match;
        const value = resolvePath(variables, name);
        return value === undefined || value === null ? match : String(value);
      });
    },

    // What to show for a phrase with no translation in either language.
    missingValueFor: function (key) {
      const internal = this._internal;
      if (internal.missingBehavior === 'empty') return '';
      if (internal.missingBehavior === 'custom') return internal.missingText;
      return key;
    },

    // Every key that gets a port: the dictionary's own keys (up to the port cap)
    // plus anything listed in Extra Keys.
    portKeys: function (dict) {
      const internal = this._internal;
      const autoKeys = keysOfDictionary(dict, internal.dictionaryFormat);
      const keys = autoKeys.length > MAX_AUTO_PORTS ? [] : autoKeys;

      internal.extraKeys.forEach(function (key) {
        if (keys.indexOf(key) === -1) keys.push(key);
      });
      return keys.filter(function (key) {
        return !RESERVED_OUTPUTS[key];
      });
    },

    translate: function () {
      const internal = this._internal;
      internal.hasScheduledTranslate = false;

      const dict = this.currentDictionary();

      if (!dict) {
        internal.languages = [];
        internal.translations = {};
        internal.resolvedLanguage = '';

        internal.byKey = {};
        this.portKeys(null).forEach((key) => {
          internal.byKey[key] = this.missingValueFor(key);
          this.registerOutputIfNeeded(key);
        });

        this.flagResultsDirty();
        this.sendSignalOnOutput('Changed');
        if (internal.extraKeys.length > 0) this.sendSignalOnOutput('Missing');
        return;
      }

      const languageFirst = isLanguageFirstDictionary(dict, internal.dictionaryFormat);
      const available = availableLanguages(dict, languageFirst);
      const language = this.resolveLanguage(available);
      const table = tableForLanguage(dict, languageFirst, language);

      // The fallback language backs up individual PHRASES too, not just a missing
      // language: a half-translated dictionary still renders the rest.
      const fallbackLanguage = matchLanguage(internal.fallbackLanguage, available);
      const fallbackTable =
        fallbackLanguage && fallbackLanguage !== language
          ? tableForLanguage(dict, languageFirst, fallbackLanguage)
          : null;

      let anyMissing = false;

      const textFor = (key) => {
        let value = this.lookup(table, key);
        if (value === undefined && fallbackTable) value = this.lookup(fallbackTable, key);

        if (value === undefined) {
          anyMissing = true;
          return this.interpolate(this.missingValueFor(key));
        }
        return this.interpolate(typeof value === 'string' ? value : String(value));
      };

      internal.languages = available;
      internal.resolvedLanguage = language || '';

      const translations = {};
      Object.keys(table).forEach((key) => {
        translations[key] = this.interpolate(String(table[key]));
      });
      internal.translations = translations;

      internal.byKey = {};
      this.portKeys(dict).forEach((key) => {
        internal.byKey[key] = textFor(key);
        this.registerOutputIfNeeded(key);
      });

      this.flagResultsDirty();
      this.sendSignalOnOutput('Changed');
      if (anyMissing) this.sendSignalOnOutput('Missing');
    },

    flagResultsDirty: function () {
      ['resolvedLanguage', 'languages', 'translations'].forEach((name) => {
        this.flagOutputDirty(name);
      });
      Object.keys(this._internal.byKey).forEach((key) => {
        if (this.hasOutput(key)) this.flagOutputDirty(key);
      });
    },

    scheduleTranslate: function () {
      const internal = this._internal;
      if (internal.hasScheduledTranslate) return;

      internal.hasScheduledTranslate = true;
      this.scheduleAfterInputsHaveUpdated(this.translate.bind(this));
    }
  }
};

// Editor side: one output port per phrase in the dictionary, plus whatever is
// listed in Extra Keys. Both come from parameters, so the ports appear as the
// table is filled in rather than only once the app runs.
function updatePorts(nodeId, parameters, editorConnection) {
  const params = parameters || {};

  // `dictionaryJson` / `keys` are the first iteration's parameter names; a graph
  // saved against those still has to get its phrase ports.
  const stored = params.dictionary !== undefined ? params.dictionary : params.dictionaryJson;
  const parsed = parseDictionaryValue(stored === undefined ? DEFAULT_DICTIONARY : stored);

  const autoKeys = keysOfDictionary(parsed.dictionary, params.dictionaryFormat || 'auto');
  const keys = autoKeys.length > MAX_AUTO_PORTS ? [] : autoKeys;

  parseKeyList(params.extraKeys !== undefined ? params.extraKeys : params.keys).forEach(function (key) {
    if (keys.indexOf(key) === -1) keys.push(key);
  });

  if (params.key !== undefined && String(params.key).trim() !== '' && keys.indexOf(String(params.key).trim()) === -1) {
    keys.push(String(params.key).trim());
  }

  const ports = keys
    .filter(function (key) {
      return !RESERVED_OUTPUTS[key];
    })
    .map(function (key) {
      return {
        type: 'string',
        plug: 'output',
        group: 'Translations',
        name: key,
        displayName: prettifyKey(key)
      };
    });

  editorConnection.sendDynamicPorts(nodeId, ports);
}

module.exports = {
  node: LanguagesDictionaryNode,
  setup: function (context, graphModel) {
    if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
      return;
    }

    // The table editor writes on every keystroke; debounce so the port layout is
    // rebuilt once the user pauses.
    const pendingUpdates = new Map();

    graphModel.on('nodeAdded.Languages Dictionary', function (node) {
      updatePorts(node.id, node.parameters, context.editorConnection);

      node.on('parameterUpdated', function (event) {
        if (event.name !== 'dictionary' && event.name !== 'extraKeys' && event.name !== 'dictionaryFormat') {
          return;
        }

        if (pendingUpdates.has(node.id)) clearTimeout(pendingUpdates.get(node.id));

        const timeoutId = setTimeout(function () {
          pendingUpdates.delete(node.id);
          updatePorts(node.id, node.parameters, context.editorConnection);
        }, 300);
        pendingUpdates.set(node.id, timeoutId);
      });
    });
  },

  // Shared with the property panel's table editor.
  DEFAULT_DICTIONARY: DEFAULT_DICTIONARY,
  parseDictionaryValue: parseDictionaryValue,
  dictionaryToGrid: dictionaryToGrid,
  serializeDictionary: serializeDictionary
};
