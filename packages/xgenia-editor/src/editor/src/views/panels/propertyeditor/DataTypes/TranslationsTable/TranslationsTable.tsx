import { useDragHandler } from '@xgenia-hooks/useDragHandler';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  DEFAULT_DICTIONARY,
  DictionarySource,
  dictionaryToGrid,
  parseDictionaryValue,
  serializeDictionary,
  TranslationsRow
} from '@xgenia/runtime/src/nodes/std-library/languagesdictionary';

import { windowTitleBarHeight } from '@xgenia-utils/utils';

import { ToolbarGrip } from '@xgenia-core-ui/components/toolbar/ToolbarGrip';

import './TranslationsTable.css';

export interface TranslationsTableProps {
  /** The dictionary parameter: a table, a JSON array of rows, or a JSON object. */
  value: unknown;
  /** Called on every edit with the dictionary written back in its original shape. */
  onChange: (value: string) => void;
  /**
   * Called when the user takes the panel over by moving or resizing it, so the
   * popup layer stops re-anchoring it to the property row on every size change.
   */
  onFreezePosition?: () => void;
  /** Closes the popout. */
  onClose?: () => void;
}

const MIN_WIDTH = 420;
const MIN_HEIGHT = 260;
const DEFAULT_SIZE = { width: 720, height: 420 };
const SIZE_STORAGE_KEY = 'translations_table_size';

// Distance kept between the panel and the window edges. Anything past an edge is
// simply cut off by the window, so both the move and the resize stay inside it.
const WINDOW_MARGIN = 8;

function maxPanelWidth() {
  return Math.max(MIN_WIDTH, window.innerWidth - WINDOW_MARGIN * 2);
}

function maxPanelHeight() {
  return Math.max(MIN_HEIGHT, window.innerHeight - windowTitleBarHeight() - WINDOW_MARGIN);
}

// Offered one at a time when a language column is added, so a click always
// produces a usable column instead of an empty one that has to be named first.
const SUGGESTED_LANGUAGES = [
  'en',
  'id',
  'es',
  'pt',
  'fr',
  'de',
  'ja',
  'ko',
  'zh',
  'ar',
  'hi',
  'ru',
  'it',
  'th',
  'vi',
  'ms',
  'tr',
  'nl'
];

function readStoredSize(): { width: number; height: number } {
  try {
    const stored = JSON.parse(localStorage[SIZE_STORAGE_KEY] || 'null');
    if (stored && typeof stored.width === 'number' && typeof stored.height === 'number') {
      return {
        width: Math.max(MIN_WIDTH, Math.min(stored.width, maxPanelWidth())),
        height: Math.max(MIN_HEIGHT, Math.min(stored.height, maxPanelHeight()))
      };
    }
  } catch (e) {
    // A corrupt entry is not worth a broken panel.
  }
  return DEFAULT_SIZE;
}

function nextLanguageCode(existing: string[]): string {
  const taken = existing.map((language) => language.trim().toLowerCase());
  const suggestion = SUGGESTED_LANGUAGES.find((language) => taken.indexOf(language) === -1);
  if (suggestion) return suggestion;

  let index = 2;
  while (taken.indexOf('lang' + index) !== -1) index++;
  return 'lang' + index;
}

function nextKey(rows: TranslationsRow[]): string {
  const taken = rows.map((row) => row.key.trim());
  let index = taken.length + 1;
  while (taken.indexOf('phrase' + index) !== -1) index++;
  return 'phrase' + index;
}

/** A pasted spreadsheet selection: rows of cells, split on newlines and tabs. */
function parsePastedGrid(text: string): string[][] | null {
  if (text.indexOf('\t') === -1 && text.indexOf('\n') === -1) return null;

  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line, index, all) => line.trim() !== '' || index < all.length - 1)
    .map((line) => line.split('\t'));
}

/** Reading the dictionary must never take the panel down with it. */
function readGrid(value: unknown) {
  try {
    const parsed = parseDictionaryValue(value);
    return { grid: dictionaryToGrid(parsed.dictionary, 'auto'), source: parsed.source, error: parsed.error };
  } catch (e) {
    return {
      grid: { languages: [], rows: [] },
      source: 'table' as DictionarySource,
      error: e instanceof Error ? e.message : 'The dictionary could not be read.'
    };
  }
}

export function TranslationsTable({ value, onChange, onFreezePosition, onClose }: TranslationsTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // The dictionary is read once; from then on this component owns the state and
  // pushes every edit out through onChange.
  const [initial] = useState(() => readGrid(value));

  const [languages, setLanguages] = useState<string[]>(initial.grid.languages);
  const [rows, setRows] = useState<TranslationsRow[]>(initial.grid.rows);
  const [mode, setMode] = useState<'table' | 'text'>('table');
  const [error, setError] = useState<string | null>(initial.error);
  const [text, setText] = useState(() =>
    typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value, null, 2)
  );
  const [size, setSize] = useState(readStoredSize);

  const source = useRef<DictionarySource>(initial.source);

  // Moving or resizing hands the panel to the user; the popup layer must stop
  // pulling it back to the property row every time its size changes.
  const frozen = useRef(false);
  const freezePosition = useCallback(() => {
    if (frozen.current) return;
    frozen.current = true;
    onFreezePosition && onFreezePosition();
  }, [onFreezePosition]);

  /** The popout box the panel is rendered into; it carries the position. */
  const popoutElement = useCallback(
    () => (rootRef.current ? (rootRef.current.closest('.popup-layer-popout') as HTMLElement | null) : null),
    []
  );

  // Put the panel back inside the window. Whatever hangs past an edge is cut off
  // by the window itself, which is what made a panel dragged towards the right
  // (where the property panel lives) lose its last columns.
  const clampIntoWindow = useCallback((popout: HTMLElement, left: number, top: number) => {
    const panel = rootRef.current;
    const width = panel ? panel.offsetWidth : 0;
    const height = panel ? panel.offsetHeight : 0;

    const minTop = windowTitleBarHeight();
    const maxLeft = Math.max(WINDOW_MARGIN, window.innerWidth - width - WINDOW_MARGIN);
    const maxTop = Math.max(minTop, window.innerHeight - height - WINDOW_MARGIN);

    popout.style.left = Math.min(Math.max(WINDOW_MARGIN, left), maxLeft) + 'px';
    popout.style.top = Math.min(Math.max(minTop, top), maxTop) + 'px';
  }, []);

  // The drag handler registers its listeners once per drag, so its callbacks see
  // the size from that render — the ref is what actually holds the latest one.
  const sizeRef = useRef(size);

  const { startDrag } = useDragHandler({
    root: rootRef,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    onStartDrag: freezePosition,
    onDrag(width, height) {
      // Growing past the window would only push the panel under its own edge.
      sizeRef.current = {
        width: Math.min(width, maxPanelWidth()),
        height: Math.min(height, maxPanelHeight())
      };
      setSize(sizeRef.current);
    },
    onEndDrag() {
      try {
        localStorage[SIZE_STORAGE_KEY] = JSON.stringify(sizeRef.current);
      } catch (e) {
        // Storage being unavailable is not worth interrupting an edit.
      }
    }
  });

  // A panel resized near an edge has to be pulled back in, since the popup layer
  // no longer repositions it once the user has taken it over.
  useLayoutEffect(() => {
    if (!frozen.current) return;

    const popout = popoutElement();
    if (popout) clampIntoWindow(popout, popout.offsetLeft, popout.offsetTop);
  }, [size, clampIntoWindow, popoutElement]);

  // Same when the editor window itself shrinks under the panel.
  useEffect(() => {
    function onWindowResize() {
      if (!frozen.current) return;

      const popout = popoutElement();
      if (popout) clampIntoWindow(popout, popout.offsetLeft, popout.offsetTop);
    }

    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [clampIntoWindow, popoutElement]);

  // Dragging the header moves the popout itself, so the panel can be parked
  // wherever there is room to work.
  const moveCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => moveCleanup.current && moveCleanup.current(), []);

  const startMove = (event: React.MouseEvent) => {
    if (event.button !== 0) return;
    // Buttons and fields in the header keep their own behaviour.
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;

    const popout = popoutElement();
    if (!popout) return;

    event.preventDefault();
    freezePosition();

    // The arrow points at the property row; once the panel is moved away it
    // would be pointing at nothing.
    const arrow = popout.querySelector('.popup-layer-popout-arrow') as HTMLElement | null;
    if (arrow) arrow.style.display = 'none';

    const startX = event.pageX;
    const startY = event.pageY;
    const startLeft = popout.offsetLeft;
    const startTop = popout.offsetTop;

    function move(moveEvent: MouseEvent) {
      clampIntoWindow(popout, startLeft + moveEvent.pageX - startX, startTop + moveEvent.pageY - startY);
    }

    function end() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('mouseup', end, true);
      moveCleanup.current = null;
    }

    moveCleanup.current = end;
    document.addEventListener('mousemove', move, true);
    document.addEventListener('mouseup', end, true);
  };

  const commit = useCallback(
    (nextLanguages: string[], nextRows: TranslationsRow[]) => {
      setLanguages(nextLanguages);
      setRows(nextRows);
      setError(null);

      const serialized = serializeDictionary({ languages: nextLanguages, rows: nextRows }, source.current);
      setText(serialized);
      onChange(serialized);
    },
    [onChange]
  );

  const renameLanguage = (index: number, code: string) => {
    const previous = languages[index];
    const nextLanguages = languages.slice();
    nextLanguages[index] = code;

    const nextRows = rows.map((row) => {
      const values = { ...row.values };
      values[code] = values[previous] === undefined ? '' : values[previous];
      if (previous !== code) delete values[previous];
      return { key: row.key, values };
    });

    commit(nextLanguages, nextRows);
  };

  const removeLanguage = (index: number) => {
    const removed = languages[index];
    const nextRows = rows.map((row) => {
      const values = { ...row.values };
      delete values[removed];
      return { key: row.key, values };
    });

    commit(
      languages.filter((_, i) => i !== index),
      nextRows
    );
  };

  const addLanguage = () => {
    const code = nextLanguageCode(languages);
    commit(
      languages.concat(code),
      rows.map((row) => ({ key: row.key, values: { ...row.values, [code]: '' } }))
    );
  };

  const setKey = (rowIndex: number, key: string) => {
    const nextRows = rows.slice();
    nextRows[rowIndex] = { key, values: nextRows[rowIndex].values };
    commit(languages, nextRows);
  };

  const setCell = (rowIndex: number, language: string, cellValue: string) => {
    const nextRows = rows.slice();
    nextRows[rowIndex] = {
      key: nextRows[rowIndex].key,
      values: { ...nextRows[rowIndex].values, [language]: cellValue }
    };
    commit(languages, nextRows);
  };

  const addRow = () => {
    const values: Record<string, string> = {};
    languages.forEach((language) => (values[language] = ''));
    commit(languages, rows.concat({ key: nextKey(rows), values }));
  };

  const removeRow = (rowIndex: number) => {
    commit(
      languages,
      rows.filter((_, i) => i !== rowIndex)
    );
  };

  const useExample = () => {
    const example = readGrid(DEFAULT_DICTIONARY).grid;
    commit(example.languages, example.rows);
  };

  // Pasting a block from a spreadsheet fills the grid from the cell it was
  // dropped on, growing the row count as needed. Columns beyond the languages
  // that exist are ignored — add the language first, then paste again.
  const onPaste = (event: React.ClipboardEvent, rowIndex: number, columnIndex: number) => {
    if (!event.clipboardData) return;

    const pasted = parsePastedGrid(event.clipboardData.getData('text/plain'));
    if (!pasted) return;

    event.preventDefault();

    const nextRows = rows.slice();
    pasted.forEach((cells, pastedRow) => {
      const targetRow = rowIndex + pastedRow;
      if (!nextRows[targetRow]) {
        const values: Record<string, string> = {};
        languages.forEach((language) => (values[language] = ''));
        nextRows[targetRow] = { key: '', values };
      }

      const row = { key: nextRows[targetRow].key, values: { ...nextRows[targetRow].values } };
      cells.forEach((cell, pastedColumn) => {
        const targetColumn = columnIndex + pastedColumn;
        if (targetColumn === -1) row.key = cell.trim();
        else if (languages[targetColumn] !== undefined) row.values[languages[targetColumn]] = cell;
      });
      nextRows[targetRow] = row;
    });

    commit(languages, nextRows);
  };

  const onTextChange = (raw: string) => {
    setText(raw);
    onChange(raw);

    // Keep the grid in step so switching back to the table shows what was typed.
    const next = readGrid(raw);
    source.current = next.source;
    setLanguages(next.grid.languages);
    setRows(next.grid.rows);
    setError(raw.trim() === '' ? null : next.error);
  };

  // A phrase key used twice only keeps its last translation, so say so rather
  // than letting a row quietly do nothing.
  const duplicateKeys = rows
    .map((row) => row.key.trim().toLowerCase())
    .filter((key, index, all) => key !== '' && all.indexOf(key) !== index);

  // A column with no language code cannot be saved — it would have no name to
  // store the translations under. Say so instead of dropping it silently.
  const hasUnnamedLanguage = languages.some((language) => language.trim() === '');

  return (
    <div className="translations-table" ref={rootRef} style={{ width: size.width, height: size.height }}>
      <div className="translations-table__toolbar" onMouseDown={startMove} title="Drag to move">
        <span className="translations-table__title">Translations</span>

        <div className="translations-table__toolbar-actions">
          {mode === 'table' && (
            <>
              <button type="button" onClick={addRow}>
                + Phrase
              </button>
              <button type="button" onClick={addLanguage}>
                + Language
              </button>
            </>
          )}
          <button
            type="button"
            className="translations-table__mode"
            onClick={() => setMode(mode === 'table' ? 'text' : 'table')}
          >
            {mode === 'table' ? 'Edit as text' : 'Back to table'}
          </button>
          {onClose && (
            <button type="button" className="translations-table__close" title="Close" onClick={onClose}>
              ×
            </button>
          )}
        </div>
      </div>

      {mode === 'text' ? (
        <textarea
          className="translations-table__textarea"
          value={text}
          spellCheck={false}
          onChange={(event) => onTextChange(event.target.value)}
        />
      ) : (
        <div className="translations-table__scroll">
          <table>
            {/* Both delete buttons sit next to the field they belong to, in a flex
                cell. A button placed after a full-width input gets pushed out of
                its cell and clipped, which is how the first version ended up with
                columns that could not be removed. The row's delete lives in the
                key column so it stays reachable in a table too wide to fit. */}
            <thead>
              <tr>
                <th className="translations-table__key-column">
                  <div className="translations-table__cell">Key</div>
                </th>
                {languages.map((language, index) => (
                  <th key={index}>
                    <div className="translations-table__cell">
                      <input
                        value={language}
                        spellCheck={false}
                        placeholder="en"
                        onChange={(event) => renameLanguage(index, event.target.value)}
                      />
                      <button
                        type="button"
                        className="translations-table__remove"
                        title={'Remove the ' + (language || 'empty') + ' column'}
                        onClick={() => removeLanguage(index)}
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <td className="translations-table__key-column">
                    <div className="translations-table__cell">
                      <input
                        value={row.key}
                        spellCheck={false}
                        placeholder="welcome"
                        onChange={(event) => setKey(rowIndex, event.target.value)}
                        onPaste={(event) => onPaste(event, rowIndex, -1)}
                      />
                      <button
                        type="button"
                        className="translations-table__remove"
                        title={'Remove the ' + (row.key.trim() || 'empty') + ' phrase'}
                        onClick={() => removeRow(rowIndex)}
                      >
                        ×
                      </button>
                    </div>
                  </td>

                  {languages.map((language, columnIndex) => (
                    <td key={columnIndex}>
                      <div className="translations-table__cell">
                        <input
                          value={row.values[language] === undefined ? '' : row.values[language]}
                          spellCheck={false}
                          onChange={(event) => setCell(rowIndex, language, event.target.value)}
                          onPaste={(event) => onPaste(event, rowIndex, columnIndex)}
                        />
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>

          {rows.length === 0 && (
            <div className="translations-table__empty">
              No phrases yet.{' '}
              <button type="button" onClick={useExample}>
                Start from an example
              </button>
            </div>
          )}
        </div>
      )}

      <div className="translations-table__footer">
        <span className="translations-table__hint">
          {error ? (
            <span className="translations-table__error">{error.split('\n')[0]}</span>
          ) : hasUnnamedLanguage ? (
            <span className="translations-table__error">
              A language column has no code — name it (id, en, ja …) or remove it with ×.
            </span>
          ) : duplicateKeys.length > 0 ? (
            <span className="translations-table__error">
              Repeated key: {duplicateKeys[0]} — only the last row of a key is used.
            </span>
          ) : (
            <>
              Every phrase becomes an output on the node. Use <code>{'{name}'}</code> for values filled in at runtime.
            </>
          )}
        </span>

        {/* Same resize grip the code editor uses, so the gesture is the one
            people already know from this panel. */}
        <span className="translations-table__resize" title="Drag to resize">
          <ToolbarGrip onMouseDown={startDrag} />
        </span>
      </div>
    </div>
  );
}
