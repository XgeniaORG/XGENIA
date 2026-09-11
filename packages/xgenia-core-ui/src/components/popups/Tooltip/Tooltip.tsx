import useTimeout from '@xgenia-hooks/useTimeout';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ReactNode } from 'react';
import { BaseDialog, DialogBackground, DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { TextType } from '@xgenia-core-ui/components/typography/Text';
import { SingleSlot, Slot, UnsafeStyleProps } from '@xgenia-core-ui/types/global';

import css from './Tooltip.module.scss';

/**
 * Pointing devices only. Nothing is ever `:hover` on a touch screen, so the hover
 * cross-check below would stop every tooltip from showing at all there.
 */
const CAN_HOVER = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

export interface TooltipProps extends UnsafeStyleProps {
  content: SingleSlot;
  fineType?: string | string[];
   children: ReactNode;
  showAfterMs?: number;

  renderDirection?: DialogRenderDirection;

  isInline?: boolean;
  isNotHiddenOnClick?: boolean;

  /**
   * HACK: Temporary solution to get a wider tooltip.
   */
  UNSAFE_tooltipMaxWidth?: string;
  UNSAFE_triggerClassName?: string;
}

export function Tooltip({
  content,
  fineType,
  children,
  renderDirection,
  isNotHiddenOnClick,
  isInline,

  showAfterMs = 900,

  UNSAFE_tooltipMaxWidth,
  UNSAFE_style,
  UNSAFE_className,
  UNSAFE_triggerClassName
}: TooltipProps) {
  const [isTooltipVisible, setIsTooltipVisible] = useState(false);
  const [isTimeoutRunning, setIsTimeoutRunning] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setIsTimeoutRunning(false);
    setIsTooltipVisible(false);
  }, []);

  /** Is the pointer genuinely still inside the trigger? `contains`, not `===`, because the
   *  event target is whichever child the pointer actually sits over. */
  const holdsPointer = useCallback((target: EventTarget | null) => {
    const trigger = triggerRef.current;
    return !!trigger && target instanceof Node && trigger.contains(target);
  }, []);

  // hovering the trigger sets triggers a timeout flag and not
  // tooltip visibility flag. this way we can cancel the timeout
  // if the user has stopped hovering before 500ms has passed
  //
  // The browser's own :hover state is re-checked when the timer fires: a leave event that
  // never arrived (the trigger was moved, disabled or re-rendered out from under a still
  // pointer, or something else had captured the pointer) must not be allowed to pop a
  // tooltip up next to a cursor that is long gone.
  useTimeout(() => {
    const trigger = triggerRef.current;
    if (CAN_HOVER && trigger && !trigger.matches(':hover')) {
      setIsTimeoutRunning(false);
      return;
    }
    setIsTooltipVisible(true);
  }, isTimeoutRunning ? showAfterMs : null);

  // Safety net for every way the trigger's own pointerleave can go missing: another
  // element holding a pointer capture (the left rail's press-and-hold reorder takes one,
  // and capture suppresses boundary events everywhere else), the trigger sliding out from
  // under a stationary pointer, the pointer leaving the window, the app losing focus.
  // Nothing else ever hides a tooltip, so a single missed leave used to strand one on
  // screen for the rest of the session — and one per button the pointer had swept past.
  // Armed only while a tooltip is pending or up, so the listeners cost nothing at rest.
  const isArmed = isTimeoutRunning || isTooltipVisible;
  useEffect(() => {
    if (!isArmed) return;

    const hide = () => reset();
    const onMove = (e: PointerEvent) => {
      if (!holdsPointer(e.target)) reset();
    };
    const onDown = (e: PointerEvent) => {
      if (!isNotHiddenOnClick || !holdsPointer(e.target)) reset();
    };
    const onVisibilityChange = () => {
      if (document.hidden) reset();
    };

    // Capture phase throughout: a handler further down that stops propagation (the visual
    // canvas and the node graph both do) must not be able to strand a tooltip.
    window.addEventListener('pointermove', onMove, { capture: true, passive: true });
    window.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointercancel', hide, { capture: true });
    window.addEventListener('blur', hide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    // Pointer left the document entirely — no pointermove follows it out, so the move
    // handler above would never see it go.
    document.documentElement.addEventListener('pointerleave', hide);

    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointercancel', hide, { capture: true });
      window.removeEventListener('blur', hide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, [isArmed, isNotHiddenOnClick, holdsPointer, reset]);

  if (!content) return <>{children}</>;

  return (
    <>
      <BaseDialog
        isVisible={isTooltipVisible}
        triggerRef={triggerRef}
        renderDirection={renderDirection}
        hasArrow
        background={DialogBackground.Secondary}
      >
        <div className={css['Root']} style={{ maxWidth: UNSAFE_tooltipMaxWidth }}>
          {typeof content === 'string' ? (
            <Label variant={TextType.Proud} size={LabelSize.Medium}>
              {content}
            </Label>
          ) : (
            content
          )}
        </div>

        {fineType && (
          <div className={css['FineType']}>
            {Array.isArray(fineType) ? (
              fineType.map((x) => (
                <Label size={LabelSize.Small} variant={TextType.Secondary}>
                  {x}
                </Label>
              ))
            ) : (
              <Label size={LabelSize.Small} variant={TextType.Secondary}>
                {fineType}
              </Label>
            )}
          </div>
        )}
      </BaseDialog>

      <div
        ref={triggerRef}
        className={classNames(
          css['Trigger'],
          isInline && css['is-inline'],
          !isInline && css['is-block'],
          UNSAFE_triggerClassName,
          UNSAFE_className
        )}
        style={UNSAFE_style}
        // pointerenter/pointerleave rather than mouseover/mouseout: the latter bubble, so
        // every crossing between the trigger's own children read as a leave followed by a
        // fresh enter, restarting the show delay mid-hover.
        onPointerEnter={() => setIsTimeoutRunning(true)}
        onPointerLeave={reset}
        onClick={() => !isNotHiddenOnClick && reset()}
      >
        {children}
      </div>
    </>
  );
}
