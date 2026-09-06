import React from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import { DescribedGroup } from './model/portRowMeta';
import { PortRow } from './PortRow';

import css from './Inspector.module.scss';

export interface PortGroupProps {
  group: DescribedGroup;
  node: NodeGraphNode;
  isCollapsed: boolean;
  /** Undefined when the group cannot be collapsed. */
  onToggle?: () => void;
  /**
   * A node whose ports all fall into the single unnamed "Other" bucket has nothing
   * to group by — it gets a plain list, the way the old panel rendered it, rather
   * than one header wrapping the entire node.
   */
  hideHeader?: boolean;
}

export function PortGroup({ group, node, isCollapsed, onToggle, hideHeader }: PortGroupProps) {
  const changedCount = group.rows.reduce((total, row) => total + (row.isDefault ? 0 : 1), 0);
  const isToggleable = onToggle !== undefined;

  return (
    <section className={css.Group} data-collapsed={isCollapsed || undefined}>
      {!hideHeader && (
        <header className={css.GroupHeader}>
          {isToggleable ? (
            <button
              type="button"
              className={css.GroupToggle}
              onClick={onToggle}
              aria-expanded={!isCollapsed}
            >
              <span className={css.GroupCaret} aria-hidden="true" />
              <span className={css.GroupName}>{group.name}</span>
              {changedCount > 0 && (
                <span className={css.GroupChangedCount} title={`${changedCount} changed in this group`}>
                  {changedCount}
                </span>
              )}
            </button>
          ) : (
            <span className={css.GroupName}>{group.name}</span>
          )}
        </header>
      )}

      {/*
        The 0fr → 1fr grid row is what makes the expand animate without anyone having
        to measure the content first. A max-height guess would either clip a long
        group or make a short one ease out against empty space.
      */}
      <div className={css.GroupBodyClip}>
        <div className={css.GroupBody}>
          {group.rows.map((row) => (
            <PortRow key={row.key} row={row} node={node} />
          ))}
        </div>
      </div>
    </section>
  );
}
