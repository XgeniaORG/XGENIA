/**
 * SelectionBar — one action, many games.
 *
 * The reason this exists: a real profile carries 319 projects, dozens of which are `sdsds`,
 * `mmmmmmmm` and two-message blank canvases from an afternoon of testing. The old screen could
 * only remove them one confirm dialog at a time, so nobody ever did, and every future list was
 * longer than the one before it.
 *
 * Floats over the floor rather than pushing it down, so selecting something does not reflow the
 * grid you are selecting from.
 */

import React, { useState } from 'react';

import { Icon } from './LobbyIcons';
import css from './SelectionBar.module.scss';

export interface SelectionBarProps {
  count: number;
  /** True when every selected game is already pinned, so the button can say Unpin. */
  allPinned: boolean;
  onPin(): void;
  onReveal(): void;
  onRemove(): void;
  onClear(): void;
}

export function SelectionBar({ count, allPinned, onPin, onReveal, onRemove, onClear }: SelectionBarProps) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={css.Root} role="toolbar" aria-label={`${count} games selected`}>
      {confirming ? (
        <>
          <b>
            Remove {count} game{count === 1 ? '' : 's'} from the list?
          </b>
          <span className={css.Note}>Files stay on disk.</span>
          <button type="button" onClick={() => setConfirming(false)}>
            Keep
          </button>
          <button
            type="button"
            className={css.Danger}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
          >
            Remove
          </button>
        </>
      ) : (
        <>
          <b>{count} selected</b>
          <button type="button" onClick={onPin}>
            <Icon name="star" filled={allPinned} />
            {allPinned ? 'Unpin' : 'Pin'}
          </button>
          {/* Revealing many folders at once opens many windows, so this is capped by the page. */}
          <button type="button" onClick={onReveal}>
            <Icon name="folder" />
            Reveal
          </button>
          <button type="button" className={css.Danger} onClick={() => setConfirming(true)}>
            <Icon name="trash" />
            Remove from list
          </button>
          <button type="button" className={css.Close} onClick={onClear} aria-label="Clear selection">
            <Icon name="close" />
          </button>
        </>
      )}
    </div>
  );
}
