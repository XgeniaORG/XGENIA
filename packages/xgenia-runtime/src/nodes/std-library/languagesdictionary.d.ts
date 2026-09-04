/**
 * Types for the parts of the Languages Dictionary node that the editor uses:
 * the property panel's table editor reads and writes the dictionary through
 * these, so both sides always agree on the formats.
 *
 * The implementation lives in languagesdictionary.js.
 */

export type TranslationsRow = {
  /** Phrase key. Dot paths ("home.title") address nested dictionaries. */
  key: string;
  /** Translation per language code. */
  values: Record<string, string>;
};

export type TranslationsGrid = {
  languages: string[];
  rows: TranslationsRow[];
};

/** The shape a dictionary was written in, so an edit can be saved back the same way. */
export type DictionarySource = 'table' | 'rows' | 'json';

export type ParsedDictionary = {
  dictionary: Record<string, unknown> | null;
  source: DictionarySource;
  error: string | null;
};

/** The table every new node starts with. */
export declare const DEFAULT_DICTIONARY: string;

/** Read a dictionary from a table string, a JSON string, an array of rows or an object. */
export declare function parseDictionaryValue(value: unknown): ParsedDictionary;

/** Turn a parsed dictionary into the grid the table editor shows. */
export declare function dictionaryToGrid(dictionary: unknown, format?: string): TranslationsGrid;

/** Write a grid back out in the given shape. */
export declare function serializeDictionary(grid: TranslationsGrid, source: DictionarySource): string;
