/**
 * LobbyGrid — the floor: grouped sections of cards, or rows in list view.
 *
 * The grouping is the readability fix. 319 games in one flat run is a wall; the same 319 under
 * Pinned / Today / Yesterday / This week / Earlier is four short lists and one long one you can
 * skip. Section headers stick under the bar while you scroll, so you always know which run you
 * are in.
 *
 * Empty groups render nothing here — `arrangeLobby` has already dropped them — but their counts
 * survive in the jump strip above, so the shape of the list is legible even where it is empty.
 */

import React from 'react';

import type { ProjectItem } from '@xgenia-utils/LocalProjectsModel';

import type { LobbyGroup, LobbyItem } from '../../models/lobby/lobbyGrouping';
import { GameCard } from './GameCard';
import { Icon } from './LobbyIcons';
import css from './LobbyGrid.module.scss';

export interface LobbyGridProps {
  groups: LobbyGroup[];
  entriesById: Record<string, ProjectItem>;
  selectedIds: Set<string>;
  focusedId: string | null;
  list: boolean;
  /** Empty-state copy differs for "no games at all" and "nothing matched". */
  query: string;
  onOpen(item: LobbyItem): void;
  onTogglePin(id: string): void;
  onRename(id: string, name: string): void;
  onRemove(id: string): void;
  onReveal(id: string): void;
  onDuplicate(id: string): void;
  onRemix(id: string): void;
  onSelect(id: string, additive: boolean, range: boolean): void;
  onFocus(id: string): void;
  onNewGame(): void;
}

export function LobbyGrid({
  groups,
  entriesById,
  selectedIds,
  focusedId,
  list,
  query,
  onOpen,
  onTogglePin,
  onRename,
  onRemove,
  onReveal,
  onDuplicate,
  onRemix,
  onSelect,
  onFocus,
  onNewGame
}: LobbyGridProps) {
  if (!groups.length) {
    return (
      <div className={css.Empty}>
        {query ? (
          <>
            <b>Nothing matches “{query}”</b>
            <span>Search looks at names and at what each game is.</span>
          </>
        ) : (
          <>
            <b>No games yet</b>
            <span>Describe one and the AI builds the first version, or start from a template.</span>
            <button type="button" className={css.EmptyAction} onClick={onNewGame}>
              <Icon name="plus" />
              New game
            </button>
          </>
        )}
      </div>
    );
  }

  // Counts the cards rendered so far across every group, so the deal-in stagger runs down the
  // whole grid rather than restarting at each header.
  let dealIndex = 0;

  return (
    <div className={list ? css.ListRoot : css.Root}>
      {groups.map((group) => (
        <section key={group.id} className={css.Section} data-group={group.id}>
          <header className={css.Header}>
            {group.id === 'pinned' && (
              <span className={css.PinIcon}>
                <Icon name="star" filled />
              </span>
            )}
            {group.label}
            <span className={css.Count}>{group.items.length}</span>
          </header>

          <div className={list ? css.Rows : css.Cards}>
            {group.items.map((item) => {
              const entry = entriesById[item.id];
              if (!entry) return null;

              return (
                <GameCard
                  key={item.id}
                  item={item}
                  entry={entry}
                  list={list}
                  selected={selectedIds.has(item.id)}
                  focused={focusedId === item.id}
                  dealIndex={dealIndex++}
                  onOpen={() => onOpen(item)}
                  onTogglePin={() => onTogglePin(item.id)}
                  onRename={(name) => onRename(item.id, name)}
                  onRemove={() => onRemove(item.id)}
                  onReveal={() => onReveal(item.id)}
                  onDuplicate={() => onDuplicate(item.id)}
                  onRemix={() => onRemix(item.id)}
                  onSelect={(additive, range) => onSelect(item.id, additive, range)}
                  onFocus={() => onFocus(item.id)}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
