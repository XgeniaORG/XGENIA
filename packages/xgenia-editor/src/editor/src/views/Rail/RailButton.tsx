import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';

import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { railGuideId } from '../../utils/guideIds';
import css from './Rail.module.scss';

export interface RailButtonProps {
  id: string;
  /** Full name: the tooltip and the accessible name. */
  name: string;
  /** The short label printed under the icon. */
  label: string;
  /** A `Side*` wrapper from views/SidePanel/SidebarIcons (takes `size`, draws in currentColor). */
  icon?: React.ElementType;
  fineType?: string;
  isActive: boolean;
  isDisabled?: boolean;
  badge?: { count?: number; unseen?: boolean; ring?: boolean };
  digit?: number;
  tooltipSuffix?: string;
  showAfterMs: number;
  onTooltipClosed?: () => void;
  onClick: () => void;
  onPointerDownCapture?: (e: React.PointerEvent<HTMLDivElement>) => void;
  isDropTarget?: boolean;
  isDropDimmed?: boolean;
  onDrop?: (files: FileList) => void;
  /** `data-guide` override, for rail items that are not sidebar panels (the Add button). */
  guideId?: string;
  /** `data-test` override; default `<id>-panel`. */
  testId?: string;
  /** Tints the icon with the accent colour (the Add button). */
  isAccent?: boolean;
}

/** Icon above, one-line label below, inside a pill that fills when the item is active. */
export function RailButton(props: RailButtonProps) {
  const { badge } = props;
  const content = props.tooltipSuffix ? `${props.name} ${props.tooltipSuffix}` : props.name;
  const Icon = props.icon;

  // "Changed since you looked" ping: a 600ms pulse the moment the unseen dot appears
  // (false → true), not on every render while it stays true. Initialised from the
  // current value so a panel that mounts already-unseen (e.g. the AI wrote while the
  // rail was still loading) doesn't pulse on mount.
  const prevUnseenRef = useRef(!!badge?.unseen);
  const [isPinging, setIsPinging] = useState(false);
  useEffect(() => {
    const unseenNow = !!badge?.unseen;
    const wasUnseen = prevUnseenRef.current;
    prevUnseenRef.current = unseenNow;
    if (!unseenNow || wasUnseen) return;
    setIsPinging(true);
    const t = setTimeout(() => setIsPinging(false), 600);
    return () => clearTimeout(t);
  }, [badge?.unseen]);

  // Version control's count recount pulse: a 200ms pulse whenever the number itself
  // changes, initialised to the current count so mounting never counts as a change.
  const prevCountRef = useRef(badge?.count);
  const [isRecounting, setIsRecounting] = useState(false);
  useEffect(() => {
    const prevCount = prevCountRef.current;
    prevCountRef.current = badge?.count;
    if (badge?.count === undefined || prevCount === undefined || badge.count === prevCount) return;
    setIsRecounting(true);
    const t = setTimeout(() => setIsRecounting(false), 200);
    return () => clearTimeout(t);
  }, [badge?.count]);

  return (
    <div
      className={classNames(
        css.Item,
        props.isActive && css['is-active'],
        props.isAccent && css['is-accent'],
        props.isDropTarget && css['is-drop-target'],
        props.isDropDimmed && css['is-drop-dimmed'],
        isPinging && css['is-ping'],
        isRecounting && css['is-recount']
      )}
      data-rail-id={props.id}
      data-guide={props.guideId ?? railGuideId(props.id)}
      onPointerDownCapture={props.onPointerDownCapture}
      onMouseLeave={props.onTooltipClosed}
      onDragOver={props.onDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } : undefined}
      onDrop={props.onDrop ? (e) => { e.preventDefault(); e.stopPropagation(); props.onDrop!(e.dataTransfer.files); } : undefined}
    >
      <Tooltip content={content} fineType={props.fineType} renderDirection={DialogRenderDirection.Horizontal} showAfterMs={props.showAfterMs}>
        <button
          type="button"
          className={css.Button}
          disabled={props.isDisabled}
          onClick={props.onClick}
          data-test={props.testId ?? `${props.id}-panel`}
          aria-label={props.name}
          aria-current={props.isActive ? 'page' : undefined}
        >
          <span className={css.Glyph}>
            {Icon && <Icon size={20} color="currentColor" />}
            {badge?.ring && <span className={css.Ring} aria-hidden="true" />}
            {badge?.count !== undefined && badge.count > 0 && (
              <span className={css.Count} aria-label={`${badge.count}`}>{badge.count > 99 ? '99+' : badge.count}</span>
            )}
            {badge?.unseen && badge.count === undefined && <span className={css.Unseen} aria-hidden="true" />}
            {props.digit !== undefined && <span className={css.Digit} aria-hidden="true">{props.digit}</span>}
          </span>
          <span className={css.Label}>{props.label}</span>
        </button>
      </Tooltip>
    </div>
  );
}
