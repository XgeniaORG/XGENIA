import React, { useState } from 'react';

import { SORT_LABELS, type SortMode } from './assetFilter';
import type { AssetViewPrefs } from './AssetLibrary';
import css from './AssetLibrary.module.scss';

const SYNTAX: Array<[string, string]> = [
  ['t:image', 'kind — image, audio, video, font'],
  ['r:ui', 'role — slug or label'],
  ['l:hero', 'tag'],
  ['is:unused', 'unused · used · starred · cut · placed · guessed · versioned · lost-placement'],
  ['ext:png', 'extension'],
  ['in:assets/ui', 'folder and below'],
  ['from:key-art', 'cut from this art'],
  ['-l:old', 'a leading minus excludes'],
  ['"spin button"', 'exact phrase']
];

export function AssetToolbar({
  searchRef,
  text,
  onText,
  prefs,
  onPrefs,
  onImport,
  onNewFolder,
  destFolder,
  onSaveSearch,
  savedSearches,
  onOpenBoard
}: {
  searchRef: React.RefObject<HTMLInputElement>;
  text: string;
  onText: (t: string) => void;
  prefs: AssetViewPrefs;
  onPrefs: (p: Partial<AssetViewPrefs>) => void;
  onImport: () => void;
  onNewFolder: () => void;
  destFolder: string;
  onSaveSearch: (text: string) => void;
  savedSearches: string[];
  onOpenBoard?: () => void;
}) {
  const [help, setHelp] = useState(false);

  return (
    <div className={css.Toolbar}>
      <div className={css.SearchRow}>
        <input
          ref={searchRef}
          className={css.Search}
          placeholder="Search — name, prompt, tag, or t: r: l: is:"
          value={text}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && text) {
              e.preventDefault();
              onText('');
            }
          }}
          aria-label="Search assets"
        />
        {text.trim() && !savedSearches.includes(text.trim()) && (
          <button type="button" className={css.IconBtn} onClick={() => onSaveSearch(text)} title="Save this search as a chip">
            ☆
          </button>
        )}
        <button type="button" className={help ? `${css.IconBtn} ${css.IconBtnOn}` : css.IconBtn} onClick={() => setHelp((v) => !v)} title="Search syntax" aria-expanded={help}>
          ?
        </button>
      </div>

      {help && (
        <div className={css.SyntaxHelp}>
          {SYNTAX.map(([token, what]) => (
            <button key={token} type="button" className={css.SyntaxRow} onClick={() => onText(`${text} ${token}`.trim())}>
              <code>{token}</code>
              <span>{what}</span>
            </button>
          ))}
        </div>
      )}

      <div className={css.ControlRow}>
        <button
          type="button"
          className={prefs.folders ? `${css.IconBtn} ${css.IconBtnOn}` : css.IconBtn}
          onClick={() => onPrefs({ folders: !prefs.folders })}
          title="Show folders"
          aria-pressed={prefs.folders}
        >
          ▤
        </button>
        <div className={css.Seg} role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={prefs.view === 'grid'} className={prefs.view === 'grid' ? css.SegOn : ''} onClick={() => onPrefs({ view: 'grid' })} title="Grid">
            ▦
          </button>
          <button type="button" role="radio" aria-checked={prefs.view === 'list'} className={prefs.view === 'list' ? css.SegOn : ''} onClick={() => onPrefs({ view: 'list' })} title="List">
            ☰
          </button>
        </div>
        {prefs.view === 'grid' && (
          <input
            className={css.Zoom}
            type="range"
            min={64}
            max={220}
            step={4}
            value={prefs.thumb}
            onChange={(e) => onPrefs({ thumb: Number(e.target.value) })}
            aria-label="Thumbnail size"
            title="Thumbnail size"
          />
        )}
        <select className={css.SortSelect} value={prefs.sort} onChange={(e) => onPrefs({ sort: e.target.value as SortMode })} aria-label="Sort by">
          {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
            <option key={m} value={m}>
              {SORT_LABELS[m]}
            </option>
          ))}
        </select>
        <span className={css.FooterGrow} />
        {onOpenBoard && (
          <button type="button" className={css.IconBtn} onClick={onOpenBoard} title="Placement board: every piece of a key art on the screen, edited together">
            ⌖
          </button>
        )}
        <button type="button" className={css.IconBtn} onClick={onNewFolder} title={`New folder in ${destFolder}`}>
          +▢
        </button>
        <button type="button" className={css.Action} onClick={onImport} title={`Import files into ${destFolder}`}>
          Import
        </button>
      </div>
    </div>
  );
}
