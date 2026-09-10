import useDocumentScrollTimestamp from '@xgenia-hooks/useDocumentScrollTimestamp';
import useWindowSize from '@xgenia-hooks/useWindowSize';
import classNames from 'classnames';
import React, { useRef, useEffect, CSSProperties, RefObject, useState, useMemo, useLayoutEffect } from 'react';

import { Collapsible } from '@xgenia-core-ui/components/layout/Collapsible';
import { Portal } from '@xgenia-core-ui/components/layout/Portal';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { Slot, UnsafeStyleProps } from '@xgenia-core-ui/types/global';

import css from './BaseDialog.module.scss';
import { placeDialog, PlacementDirection } from './dialogPlacement';

export enum DialogRenderDirection {
  Vertical,
  Horizontal,
  Above,
  Below
}

export enum BaseDialogVariant {
  Default = 'is-variant-default',
  Select = 'is-variant-select'
}

export enum DialogBackground {
  Default = 'is-background-default',
  Bg1 = 'is-background-bg-1',
  Bg2 = 'is-background-bg-2',
  Bg3 = 'is-background-bg-3',
  Secondary = 'is-background-secondary',
  Transparent = 'is-background-transparent'
}

export interface BaseDialogProps extends UnsafeStyleProps {
  triggerRef?: RefObject<HTMLElement>;
  renderDirection?: DialogRenderDirection;
  background?: DialogBackground;
  variant?: BaseDialogVariant;
  title?: string;

  isLockingScroll?: boolean;
  isVisible?: boolean;
  hasBackdrop?: boolean;
  hasArrow?: boolean;
  alwaysMounted?: boolean;

  children?: Slot;

  onClose?: () => void;
}

export function BaseDialog(props: BaseDialogProps) {
  const [portalRoot] = useState(document.querySelector('.dialog-layer-portal-target'));

  return (
    <Portal portalRoot={portalRoot}>
      <CoreBaseDialog {...props} />
    </Portal>
  );
}

export function CoreBaseDialog({
  triggerRef,
  renderDirection = DialogRenderDirection.Vertical,
  background = DialogBackground.Default,
  variant = BaseDialogVariant.Default,
  title,

  isLockingScroll,
  isVisible,
  hasBackdrop,
  hasArrow,
  alwaysMounted,

  children,

  onClose,

  UNSAFE_className,
  UNSAFE_style
}: BaseDialogProps) {
  const [isSelectOpen, setIsSelectOpen] = useState(false);

  useEffect(() => {
    if (!BaseDialogVariant.Select) return;
    // quick n dirty solution to make sure the
    // select doesnt render in an open state
    // without showing the animation
    setTimeout(() => {
      setIsSelectOpen(isVisible);
    }, 50);
  }, [isVisible]);

  const dialogRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [dialogPosition, setDialogPosition] = useState({
    x: 0,
    y: 0,
    arrowX: 0,
    arrowY: 0,
    animationStartOffsetX: 0,
    animationStartOffsetY: 0,
    width: 'auto',
    speed: 250,
    maxHeight: null as number | null
  });

  const windowSize = useWindowSize();
  const lastScroll = useDocumentScrollTimestamp(isVisible, 0, rootRef);

  const arrowCompensationOffset = variant === BaseDialogVariant.Select ? 0 : 12;
  const edgeOffset = 10;

  // calculate where to render the dialog
  useLayoutEffect(() => {
    if (!triggerRef?.current || !dialogRef?.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    // dialogRef points at the MEASURING copy, which is never capped — so this is the
    // dialog's natural height, which is what the placement needs in order to decide
    // whether a cap is required at all.
    const dialogRect = dialogRef.current.getBoundingClientRect();

    const directions: Record<DialogRenderDirection, PlacementDirection> = {
      [DialogRenderDirection.Vertical]: 'above',
      [DialogRenderDirection.Above]: 'above',
      [DialogRenderDirection.Below]: 'below',
      [DialogRenderDirection.Horizontal]: 'horizontal'
    };

    const placement = placeDialog({
      trigger: triggerRect,
      dialog: { width: dialogRect.width, height: dialogRect.height },
      viewport: { width: windowSize.width, height: windowSize.height },
      direction: directions[renderDirection],
      gap: arrowCompensationOffset,
      edge: edgeOffset
    });

    setDialogPosition({
      ...placement,
      width: variant === BaseDialogVariant.Select ? triggerRect.width + 'px' : 'auto',
      speed: Math.max(150, dialogRect.height)
    });
  }, [isVisible, windowSize, lastScroll, renderDirection, variant, triggerRef?.current, dialogRef?.current]);

  const backgroundColor = useMemo(() => {
    switch (background) {
      case DialogBackground.Bg1:
        return 'var(--theme-color-bg-1)';
      case DialogBackground.Bg2:
        return 'var(--theme-color-bg-2)';
      case DialogBackground.Bg3:
        return 'var(--theme-color-bg-3)';
      case DialogBackground.Transparent:
        return 'transparent';
      case DialogBackground.Secondary:
        return 'var(--theme-color-secondary)';
      default:
        return 'var(--theme-color-bg-4)';
    }
  }, [background]);

  const backgroundContrastColor = useMemo(() => {
    switch (background) {
      case DialogBackground.Bg1:
        return 'var(--theme-color-bg-0)';
      case DialogBackground.Bg2:
        return 'var(--theme-color-bg-1)';
      case DialogBackground.Bg3:
        return 'var(--theme-color-bg-2)';
      case DialogBackground.Transparent:
        return 'transparent';
      case DialogBackground.Secondary:
        return 'var(--theme-color-secondary)';
      default:
        return 'var(--theme-color-bg-2)';
    }
  }, [background]);

  if (!isVisible && !alwaysMounted) return null;

  return (
    <div
      ref={rootRef}
      className={classNames(
        css['Root'],
        hasBackdrop && css['has-backdrop'],
        isLockingScroll && css['is-locking-scroll'],
        typeof triggerRef === 'undefined' && css['is-centered'],
        !isVisible && css['is-hidden'],
        css[variant]
      )}
      onClick={onClose}
      style={
        {
          '--offsetY': `${Math.floor(dialogPosition.y)}px`,
          '--offsetX': `${Math.floor(dialogPosition.x)}px`,
          '--animationStartOffsetX': `${dialogPosition.animationStartOffsetX}px`,
          '--animationStartOffsetY': `${dialogPosition.animationStartOffsetY}px`,
          '--background': backgroundColor,
          '--backgroundContrast': backgroundContrastColor,
          '--width': dialogPosition.width,
          '--maxHeight': dialogPosition.maxHeight === null ? 'none' : `${Math.floor(dialogPosition.maxHeight)}px`
        } as CSSProperties
      }
    >
      <div
        className={classNames(css['VisibleDialog'], UNSAFE_className, isVisible && css['is-visible'], css[variant])}
        style={UNSAFE_style}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={css['MeasuringContainer']}>
          <div ref={dialogRef} style={{}} className={css['ChildContainer']}>
            {children}
          </div>
        </div>

        {hasArrow && (
          <div
            className={classNames(css['Arrow'], title && dialogPosition.arrowY === 0 && css['is-contrast'])}
            style={
              {
                '--arrow-top': `${dialogPosition.arrowY}px`,
                '--arrow-left': `${dialogPosition.arrowX}px`
              } as CSSProperties
            }
          />
        )}

        {variant === BaseDialogVariant.Select ? (
          <Collapsible isCollapsed={!isSelectOpen} transitionMs={dialogPosition.speed}>
            <div className={classNames(css['ChildContainer'], css['is-scrollable'])}>
              {title && (
                <div className={css['Title']}>
                  <Label size={LabelSize.Medium}>{title}</Label>
                </div>
              )}
              {children}
            </div>
          </Collapsible>
        ) : (
          <div className={classNames(css['ChildContainer'], css['is-scrollable'])}>
            {title && (
              <div className={css['Title']}>
                <Label size={LabelSize.Medium}>{title}</Label>
              </div>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
