/**
 * GameCard — one cabinet on the lobby floor.
 *
 * The card is the whole redesign in miniature. The old tile cropped a 16:9 title card into a
 * 160px 4:3 window and put a name and a timestamp under it; this one shows the art uncropped,
 * says in one line what the game actually is, and keeps every destructive control behind a
 * hover strip and a confirm.
 *
 * ─── the harness contract ──────────────────────────────────────────────────
 * `packages/xgenia-mcp-server/src/selectors.ts` finds project tiles with `.projects-item` and
 * reads their names from `.projects-item-label span`. Those are the OLD template's class names,
 * and `xgenia_open_project`, `xgenia_close_project` and the authentication probe in
 * `editor-state.ts` all depend on them. CSS Modules hash their class names at build time, so the
 * two globals below are carried deliberately, as contract, alongside the module classes. Do not
 * remove them without updating that selector file in the same commit.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import { resolveThumbSrc } from '../../utils/thumbnails/thumbnail-store';
import { monogramFor, monogramHue } from '../../utils/thumbnails/thumbnail-weak';
import type { LobbyItem } from '../../models/lobby/lobbyGrouping';
import { timeSince } from '../../utils/utils';
import { Icon } from './LobbyIcons';
import css from './GameCard.module.scss';

export interface GameCardProps {
  item: LobbyItem;
  entry: ProjectItem;
  selected: boolean;
  focused: boolean;
  /** Renders as a row rather than a tile. Same data, same actions. */
  list?: boolean;
  /** Cards past this index skip the deal-in animation. */
  dealIndex: number;
  onOpen(): void;
  onTogglePin(): void;
  onRename(name: string): void;
  onRemove(): void;
  onReveal(): void;
  onDuplicate(): void;
  onRemix(): void;
  onSelect(additive: boolean, range: boolean): void;
  onFocus(): void;
}

/**
 * A compact age. The card has room for "9 min", not for "9 minutes ago", and the tabular figures
 * in the stylesheet keep a column of these from jittering.
 */
function shortAge(latestAccessed: number): string {
  const full = timeSince(latestAccessed);
  const [value, unit] = full.split(' ');

  const short: Record<string, string> = {
    seconds: 's',
    minutes: 'min',
    hours: 'h',
    days: 'd',
    months: 'mo',
    years: 'y'
  };

  return short[unit] ? `${value} ${short[unit]}` : full;
}

export function GameCard({
  item,
  entry,
  selected,
  focused,
  list = false,
  dealIndex,
  onOpen,
  onTogglePin,
  onRename,
  onRemove,
  onReveal,
  onDuplicate,
  onRemix,
  onSelect,
  onFocus
}: GameCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const thumb = resolveThumbSrc(entry);
  // `weakThumb` is only ever true after a measurement; an unmeasured card shows its art. See
  // thumbnail-weak.ts — "not measured" and "measured and empty" must never be the same state.
  const showArt = !!thumb && !item.meta.weakThumb;

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  // The keyboard owner is the grid, which moves focus onto the card element itself. Anything
  // typed while a rename input or the confirm is up belongs to that control instead.
  useEffect(() => {
    if (focused && !renaming && !confirming) rootRef.current?.focus({ preventScroll: true });
  }, [focused, renaming, confirming]);

  const commitRename = useCallback(
    (value: string) => {
      setRenaming(false);
      onRename(value);
    },
    [onRename]
  );

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleClick = (e: React.MouseEvent) => {
    if (renaming || confirming) return;

    // Modifier clicks build a selection instead of opening. Without this, the only way to act on
    // more than one game is to repeat every action once per card, which at 319 games is why the
    // junk projects never get cleaned up.
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      stop(e);
      onSelect(e.metaKey || e.ctrlKey, e.shiftKey);
      return;
    }

    onOpen();
  };

  const action = (fn: () => void) => (e: React.MouseEvent) => {
    stop(e);
    setMenuOpen(false);
    fn();
  };

  const classes = [
    css.Root,
    // Harness contract; see the file header.
    'projects-item',
    list ? css.List : '',
    selected ? css.Selected : '',
    focused ? css.Focused : '',
    dealIndex < 12 ? css.Deal : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={rootRef}
      className={classes}
      style={{ '--deal-delay': `${Math.min(dealIndex, 11) * 30}ms` } as React.CSSProperties}
      tabIndex={-1}
      role="button"
      aria-label={item.name}
      data-test="project-card"
      data-project-id={item.id}
      onClick={handleClick}
      onFocus={onFocus}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) stop(e);
      }}
      onContextMenu={(e) => {
        stop(e);
        setMenuOpen(true);
      }}
    >
      {/* A blurred copy of the art, behind the card, revealed on hover. The game lights its own
          patch of the floor. Decorative, so it is hidden from assistive tech. */}
      {showArt && <div className={css.Glow} style={{ backgroundImage: `url(${thumb})` }} aria-hidden="true" />}

      <div className={css.Art}>
        {showArt ? (
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        ) : (
          <div
            className={css.Monogram}
            style={{ '--mono-hue': `${monogramHue(item.name)}` } as React.CSSProperties}
            aria-hidden="true"
          >
            {monogramFor(item.name)}
          </div>
        )}

        {item.pinned && !selected && (
          <div className={css.Pin} aria-hidden="true">
            <Icon name="star" filled />
          </div>
        )}

        {selected && (
          <div className={css.Check} aria-hidden="true">
            <Icon name="check" />
          </div>
        )}

        <div className={css.Actions}>
          <button
            type="button"
            title={item.pinned ? 'Unpin' : 'Pin'}
            aria-label={item.pinned ? 'Unpin' : 'Pin'}
            onClick={action(onTogglePin)}
          >
            <Icon name="star" filled={item.pinned} />
          </button>
          <button type="button" title="Reveal folder" aria-label="Reveal folder" onClick={action(onReveal)}>
            <Icon name="folder" />
          </button>
          <button type="button" title="Rename" aria-label="Rename" onClick={action(() => setRenaming(true))}>
            <Icon name="pen" />
          </button>
          <button type="button" title="More" aria-label="More" onClick={action(() => setMenuOpen(true))}>
            <Icon name="more" />
          </button>
        </div>
      </div>

      {/* Harness contract: `.projects-item-label span` is how the MCP server reads a game's name. */}
      <div className={`${css.Footer} projects-item-label`}>
        {renaming ? (
          <input
            ref={inputRef}
            className={css.RenameInput}
            defaultValue={item.name}
            aria-label="Game name"
            onClick={stop}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename(e.currentTarget.value);
              // Escape reverts by blurring a field whose value was never read.
              if (e.key === 'Escape') {
                e.currentTarget.value = item.name;
                setRenaming(false);
              }
            }}
          />
        ) : (
          <div className={css.Text}>
            <span className={css.Name} data-test="project-card-label" title={item.name}>
              {item.name}
            </span>
            <span className={css.Tagline}>{item.meta.tagline || 'No description yet'}</span>
          </div>
        )}

        <div className={css.Stats}>
          <span className={css.Age}>{shortAge(item.latestAccessed)}</span>
          {!!item.meta.messageCount && (
            <span className={css.Messages} title={`${item.meta.messageCount} messages`}>
              <Icon name="chat" />
              {item.meta.messageCount}
            </span>
          )}
        </div>
      </div>

      {menuOpen && (
        <>
          <div className={css.MenuScrim} onClick={action(() => undefined)} />
          <div className={css.Menu} role="menu">
            <button type="button" role="menuitem" onClick={action(onOpen)}>
              <Icon name="play" />
              Open
              <kbd>↵</kbd>
            </button>
            <button type="button" role="menuitem" onClick={action(onTogglePin)}>
              <Icon name="star" filled={item.pinned} />
              {item.pinned ? 'Unpin' : 'Pin'}
              <kbd>Space</kbd>
            </button>
            <button type="button" role="menuitem" onClick={action(() => setRenaming(true))}>
              <Icon name="pen" />
              Rename
              <kbd>F2</kbd>
            </button>
            <button type="button" role="menuitem" onClick={action(onDuplicate)}>
              <Icon name="copy" />
              Duplicate
            </button>
            <button type="button" role="menuitem" onClick={action(onRemix)}>
              <Icon name="spark" />
              Remix with AI…
            </button>
            <button type="button" role="menuitem" onClick={action(onReveal)}>
              <Icon name="folder" />
              Reveal in Finder
            </button>
            <div className={css.MenuSep} />
            <button
              type="button"
              role="menuitem"
              className={css.Danger}
              onClick={action(() => setConfirming(true))}
            >
              <Icon name="trash" />
              Remove from list
              <kbd>⌫</kbd>
            </button>
          </div>
        </>
      )}

      {confirming && (
        <div className={css.Confirm} onClick={stop}>
          {/* The wording is the whole reason this is a confirm and not a dialog: `removeProject`
              drops the entry and never touches the folder, and the card should say so. */}
          <span className={css.ConfirmText}>
            <Icon name="warn" />
            Remove from the list? <b>Files stay on disk.</b>
          </span>
          <button type="button" onClick={action(() => setConfirming(false))}>
            Keep
          </button>
          <button type="button" className={css.ConfirmRemove} onClick={action(onRemove)}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
