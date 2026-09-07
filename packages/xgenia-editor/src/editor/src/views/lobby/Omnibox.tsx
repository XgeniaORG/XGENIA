/**
 * Omnibox — one input for finding a game and for starting one.
 *
 * The old screen had a search box that matched project names. On a profile whose names are
 * `Amazing`, `AmazingSlot`, `amazingSlot.` and `sdsds`, matching names is close to useless — so
 * this matches the tagline too, and "blackjack" finds the game actually called "Amazing thing.".
 *
 * The second half is the part that matters. Typing a sentence into a box and getting a game is
 * the product's whole promise, and until now that promise started with a dialog. Here a query
 * that reads like a description grows a Create row: Enter opens the top match, ⌘Enter builds
 * what you just described.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import { looksLikeCreateIntent, rankMatches, type LobbyItem } from '../../models/lobby/lobbyGrouping';
import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { timeSince } from '../../utils/utils';
import { Icon } from './LobbyIcons';
import css from './Omnibox.module.scss';

export interface OmniboxProps {
  items: LobbyItem[];
  entriesById: Record<string, ProjectItem>;
  onClose(): void;
  onOpen(item: LobbyItem): void;
  onCreate(description: string): void;
  onOpenFolder(): void;
}

/** How many matches to show. Enough to scan, few enough to keep the sheet a fixed size. */
const MAX_RESULTS = 6;

/** The name and tagline with matched terms wrapped, so it is obvious why a row is here. */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length || !text) return <>{text}</>;

  // Longest first: with "neon" and "neonreels" both present, matching the short one first would
  // leave the rest of the long one unmarked.
  const ordered = [...terms].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${ordered.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');

  return (
    <>
      {text.split(pattern).map((part, i) =>
        ordered.some((t) => t.toLowerCase() === part.toLowerCase()) ? <mark key={i}>{part}</mark> : part
      )}
    </>
  );
}

export function Omnibox({ items, entriesById, onClose, onOpen, onCreate, onOpenFolder }: OmniboxProps) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const terms = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // Ranked, not filtered: a query whose every term must match answered "No game matches" for
  // "slot game with" while fifty taglines on the screen behind it said "Amazing slot game about".
  const results = useMemo(() => rankMatches(items, query, MAX_RESULTS), [items, query]);

  const showCreate = looksLikeCreateIntent(query);

  // One flat list of rows so the keyboard has a single index to move through, whatever mix of
  // games, create and actions is showing.
  const rows = useMemo(() => {
    const out: Array<{ kind: 'game'; item: LobbyItem } | { kind: 'create' } | { kind: 'folder' }> = results.map(
      (item) => ({ kind: 'game' as const, item })
    );
    if (showCreate) out.push({ kind: 'create' });
    out.push({ kind: 'folder' });
    return out;
  }, [results, showCreate]);

  useEffect(() => setCursor(0), [query]);

  const run = (index: number) => {
    const row = rows[index];
    if (!row) return;

    if (row.kind === 'game') onOpen(row.item);
    else if (row.kind === 'create') onCreate(query.trim());
    else onOpenFolder();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % Math.max(rows.length, 1));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      // ⌘Enter always means "build this", wherever the cursor happens to be sitting.
      if ((e.metaKey || e.ctrlKey) && query.trim()) onCreate(query.trim());
      else run(cursor);
    }
  };

  let index = -1;

  return (
    <div className={css.Scrim} onClick={onClose}>
      <div
        className={css.Root}
        role="dialog"
        aria-label="Search games or describe a new one"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={css.Field}>
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search games, or describe one to build"
            aria-label="Search games, or describe one to build"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>esc</kbd>
        </div>

        <div className={css.Results}>
          {results.length > 0 && <div className={css.Group}>Games</div>}

          {results.map((item) => {
            index++;
            const rowIndex = index;
            const entry = entriesById[item.id];
            const thumb = entry ? resolveThumbSrc(entry) : '';

            return (
              <button
                key={item.id}
                type="button"
                className={rowIndex === cursor ? `${css.Row} ${css.RowOn}` : css.Row}
                onMouseEnter={() => setCursor(rowIndex)}
                onClick={() => onOpen(item)}
              >
                {thumb && !item.meta.weakThumb ? (
                  <img src={thumb} alt="" loading="lazy" />
                ) : (
                  <span className={css.Sym}>
                    <Icon name="layout" />
                  </span>
                )}
                <span className={css.Text}>
                  <b>
                    <Highlight text={item.name} terms={terms} />
                  </b>
                  <small>
                    <Highlight text={item.meta.tagline || 'No description yet'} terms={terms} />
                    {' · '}
                    {timeSince(item.latestAccessed)} ago
                  </small>
                </span>
                <span className={css.Hint}>Open</span>
              </button>
            );
          })}

          {query.trim() && !results.length && <div className={css.None}>No game matches “{query.trim()}”</div>}

          {showCreate &&
            (() => {
              index++;
              const rowIndex = index;
              return (
                <>
                  <div className={css.Group}>Create</div>
                  <button
                    type="button"
                    className={rowIndex === cursor ? `${css.Row} ${css.RowOn} ${css.Create}` : `${css.Row} ${css.Create}`}
                    onMouseEnter={() => setCursor(rowIndex)}
                    onClick={() => onCreate(query.trim())}
                  >
                    <span className={css.Sym}>
                      <Icon name="spark" />
                    </span>
                    <span className={css.Text}>
                      <b>Build a new game: “{query.trim()}”</b>
                      <small>Opens the New game sheet with this as the description</small>
                    </span>
                    <kbd>⌘↵</kbd>
                  </button>
                </>
              );
            })()}

          {(() => {
            index++;
            const rowIndex = index;
            return (
              <>
                <div className={css.Group}>Actions</div>
                <button
                  type="button"
                  className={rowIndex === cursor ? `${css.Row} ${css.RowOn}` : css.Row}
                  onMouseEnter={() => setCursor(rowIndex)}
                  onClick={onOpenFolder}
                >
                  <span className={css.Sym}>
                    <Icon name="folder" />
                  </span>
                  <span className={css.Text}>
                    <b>Open folder…</b>
                  </span>
                  <kbd>⌘O</kbd>
                </button>
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
