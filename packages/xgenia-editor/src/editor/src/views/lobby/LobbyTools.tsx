/**
 * LobbyTools — the strip between the hero and the floor.
 *
 * Everything the old screen had no answer for at 319 games: where the groups are and how big
 * they are, how the list is ordered, how much of it fits on screen, and whether it is a grid or
 * a table. All of it stateless — the page owns the values, this renders them.
 *
 * The group jumps double as a legend: a count of zero is shown greyed rather than hidden, so the
 * shape of the list is legible even where it is empty.
 */

import React from 'react';

import { GROUP_LABELS, GROUP_ORDER, SORT_LABELS, type GroupId, type SortKey } from '../../models/lobby/lobbyGrouping';
import { Icon } from './LobbyIcons';
import css from './LobbyTools.module.scss';

export type Density = 's' | 'm' | 'l';

export interface LobbyToolsProps {
  counts: Record<GroupId, number>;
  sort: SortKey;
  density: Density;
  list: boolean;
  onJump(group: GroupId): void;
  onSort(sort: SortKey): void;
  onDensity(density: Density): void;
  onList(list: boolean): void;
}

const SORT_CYCLE: SortKey[] = ['recent', 'name', 'messages'];

export function LobbyTools({ counts, sort, density, list, onJump, onSort, onDensity, onList }: LobbyToolsProps) {
  return (
    <div className={css.Root}>
      <div className={css.Jumps}>
        {GROUP_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={counts[id] ? css.Jump : `${css.Jump} ${css.JumpEmpty}`}
            disabled={!counts[id]}
            onClick={() => onJump(id)}
          >
            {id === 'pinned' && <Icon name="star" filled />}
            {GROUP_LABELS[id]}
            <span className={css.Count}>{counts[id]}</span>
          </button>
        ))}
      </div>

      <div className={css.Grow} />

      {/* One control cycling three orders rather than a dropdown: there are only three, and a
          popover for three items is more chrome than the choice is worth. */}
      <button
        type="button"
        className={css.Chip}
        onClick={() => onSort(SORT_CYCLE[(SORT_CYCLE.indexOf(sort) + 1) % SORT_CYCLE.length])}
        title="Change the order"
      >
        {SORT_LABELS[sort]}
        <Icon name="chevron" />
      </button>

      <div className={css.Seg} role="group" aria-label="Card size">
        {(['s', 'm', 'l'] as Density[]).map((d) => (
          <button
            key={d}
            type="button"
            className={density === d ? css.SegOn : undefined}
            aria-pressed={density === d}
            onClick={() => onDensity(d)}
          >
            {d.toUpperCase()}
          </button>
        ))}
      </div>

      <div className={css.Seg} role="group" aria-label="View">
        <button type="button" className={list ? undefined : css.SegOn} aria-pressed={!list} onClick={() => onList(false)}>
          <Icon name="grid" />
        </button>
        <button type="button" className={list ? css.SegOn : undefined} aria-pressed={list} onClick={() => onList(true)}>
          <Icon name="list" />
        </button>
      </div>
    </div>
  );
}
