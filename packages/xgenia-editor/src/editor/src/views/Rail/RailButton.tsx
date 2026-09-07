import classNames from 'classnames';
import React, { useEffect, useRef, useState } from 'react';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonState, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import css from './Rail.module.scss';

export interface RailButtonProps {
  id: string;
  name: string;
  icon: React.ElementType | IconName;
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
}

export function RailButton(props: RailButtonProps) {
  const { badge } = props;
  const content = props.tooltipSuffix ? `${props.name} ${props.tooltipSuffix}` : props.name;

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
        props.isDropTarget && css['is-drop-target'],
        props.isDropDimmed && css['is-drop-dimmed'],
        isPinging && css['is-ping'],
        isRecounting && css['is-recount']
      )}
      data-rail-id={props.id}
      onPointerDownCapture={props.onPointerDownCapture}
      onMouseLeave={props.onTooltipClosed}
      onDragOver={props.onDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } : undefined}
      onDrop={props.onDrop ? (e) => { e.preventDefault(); e.stopPropagation(); props.onDrop!(e.dataTransfer.files); } : undefined}
    >
      <Tooltip content={content} fineType={props.fineType} renderDirection={DialogRenderDirection.Horizontal} showAfterMs={props.showAfterMs}>
        <IconButton
          icon={props.icon}
          size={IconSize.Small}
          selfPaintedIcon
          variant={IconButtonVariant.Transparent}
          state={props.isActive ? IconButtonState.Active : IconButtonState.Default}
          isDisabled={props.isDisabled}
          onClick={props.onClick}
          testId={`${props.id}-panel`}
          aria-label={props.name}
          UNSAFE_className={css.Button}
        />
      </Tooltip>
      {badge?.ring && <span className={css.Ring} aria-hidden="true" />}
      {badge?.count !== undefined && badge.count > 0 && (
        <span className={css.Count} aria-label={`${badge.count}`}>{badge.count > 99 ? '99+' : badge.count}</span>
      )}
      {badge?.unseen && badge.count === undefined && <span className={css.Unseen} aria-hidden="true" />}
      {props.digit !== undefined && <span className={css.Digit} aria-hidden="true">{props.digit}</span>}
    </div>
  );
}
