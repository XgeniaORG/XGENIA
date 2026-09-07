import React, { useRef } from 'react';

import { FilterCounts, InspectorFilterMode } from './model/inspectorFilter';

import css from './Inspector.module.scss';

export interface FilterBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  mode: InspectorFilterMode;
  onModeChange: (mode: InspectorFilterMode) => void;
  counts: FilterCounts;
}

/**
 * Search plus the All / Changed segment.
 *
 * "Changed" answers the question the old panel could not: on a node with sixty ports,
 * which ones has anyone actually touched? The count comes from the same `isDefault`
 * every row computes, so the number and the list can never disagree.
 */
export function FilterBar({ query, onQueryChange, mode, onModeChange, counts }: FilterBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={css.FilterBar}>
      <div className={css.SearchField}>
        <span className={css.SearchIcon} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className={css.SearchInput}
          placeholder="Search properties"
          value={query}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // Escape clears rather than closing the panel, and only blurs once the
            // field is already empty — so one press undoes the search and a second
            // gives the keyboard back to the editor.
            if (e.key === 'Escape') {
              e.stopPropagation();
              if (query !== '') onQueryChange('');
              else inputRef.current?.blur();
            }
          }}
        />
        {query !== '' && (
          <button
            type="button"
            className={css.SearchClear}
            title="Clear search"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
          />
        )}
      </div>

      <div className={css.Segment} role="group" aria-label="Property filter">
        <button
          type="button"
          className={css.SegmentButton}
          data-active={mode === 'all' || undefined}
          onClick={() => onModeChange('all')}
        >
          All<span className={css.SegmentCount}>{counts.all}</span>
        </button>
        <button
          type="button"
          className={css.SegmentButton}
          data-active={mode === 'changed' || undefined}
          // Nothing is changed: the filter would show an empty panel, so it is not
          // offered rather than being offered and disappointing.
          disabled={counts.changed === 0 && mode !== 'changed'}
          onClick={() => onModeChange('changed')}
        >
          Changed<span className={css.SegmentCount}>{counts.changed}</span>
        </button>
      </div>
    </div>
  );
}
