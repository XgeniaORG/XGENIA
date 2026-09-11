import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';

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

  // The body clips only while the collapse is MOVING, never while it sits open.
  //
  // A permanent `overflow: hidden` here is what made the legacy dropdowns unusable: they
  // open as an absolutely-positioned child of their row, so the group's box cut a 501px
  // Blend Mode list down to whatever was left of that group — measured in the running
  // editor as 69px of 501, and nothing at all for a row near the panel's bottom edge.
  const [isAnimating, setIsAnimating] = useState(false);
  const previousCollapsed = useRef(isCollapsed);

  useEffect(() => {
    if (previousCollapsed.current === isCollapsed) return;
    previousCollapsed.current = isCollapsed;
    setIsAnimating(true);

    // transitionend is not guaranteed: under prefers-reduced-motion the transition is
    // `none` and never fires one, which would leave the clip on forever — the very bug
    // this is removing. The timer is the authority; the event just ends it sooner.
    const settle = setTimeout(() => setIsAnimating(false), 400);
    return () => clearTimeout(settle);
  }, [isCollapsed]);

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
      <div
        className={css.GroupBodyClip}
        onTransitionEnd={(event) => {
          if (event.propertyName === 'grid-template-rows') setIsAnimating(false);
        }}
      >
        <div className={classNames(css.GroupBody, isAnimating && css['is-animating'])}>
          {group.rows.map((row) => (
            <PortRow key={row.key} row={row} node={node} />
          ))}
        </div>
      </div>
    </section>
  );
}
