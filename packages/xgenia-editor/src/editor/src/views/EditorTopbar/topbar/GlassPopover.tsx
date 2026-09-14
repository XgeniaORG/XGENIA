import classNames from 'classnames';
import React, { RefObject, useEffect, useRef } from 'react';

import { BaseDialog, DialogBackground, DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';

import css from './GlassPopover.module.scss';

export interface GlassPopoverProps {
  triggerRef: RefObject<HTMLElement>;
  isVisible: boolean;
  onClose: () => void;
  width?: number;
  renderDirection?: DialogRenderDirection;
  children: React.ReactNode;
  UNSAFE_className?: string;
}

/**
 * A glass panel anchored under a top bar control.
 *
 * Dismissal is handled HERE, not by each caller. BaseDialog only closes on an outside
 * click when it has a backdrop or locks scroll — `BaseDialog.module.scss` sets
 * `.Root:not(.has-backdrop):not(.is-locking-scroll) { pointer-events: none }` on the
 * full-screen overlay that carries the `onClick={onClose}` handler. A glass popover
 * wants neither a dimmed backdrop nor a scroll lock, so that overlay is click-through
 * and `onClose` is unreachable. Without the listeners below, a popover opened from the
 * bar stays on screen forever: the first build of this component shipped that way in
 * two of its three callers, and the third grew a private copy of this workaround.
 */
export function GlassPopover({
  triggerRef,
  isVisible,
  onClose,
  width = 320,
  renderDirection = DialogRenderDirection.Below,
  children,
  UNSAFE_className
}: GlassPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Read the latest onClose from the listeners without re-registering them.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The blur handler below resolves a tick late; by then the popover may already be gone.
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  useEffect(() => {
    if (!isVisible) return;

    const isInside = (target: Element | null) =>
      !!target &&
      ((panelRef.current !== null && panelRef.current.contains(target)) ||
        (triggerRef.current !== null && triggerRef.current.contains(target)));

    // Capture phase: a click that opens some other menu must still close this one,
    // even if that handler stops propagation on the way up.
    const onPointerDown = (e: PointerEvent) => {
      if (!isInside(e.target as Element | null)) onCloseRef.current();
    };

    // On the window, so Escape works whether focus is in the panel, on the trigger,
    // or nowhere at all (the common case right after the panel opens).
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    // The click that most needs to dismiss a top bar popover is a click on the PREVIEW,
    // and the preview is an <iframe> (IframeViewer). A pointer event inside a child
    // document never reaches this one, so the listener above cannot see it: before this,
    // a popover opened over the canvas could only be closed by clicking editor chrome.
    // Focus does cross the boundary — clicking into a frame blurs this window and leaves
    // document.activeElement pointing at the frame element — so that is what we watch.
    // Deferred a tick because activeElement is not guaranteed to be updated yet when
    // blur fires, and checked for an actual frame so that switching to another app
    // (window blurs, activeElement unchanged) leaves the popover open.
    const onWindowBlur = () => {
      setTimeout(() => {
        if (!isVisibleRef.current) return;
        const active = document.activeElement;
        if (!active) return;
        const tag = active.tagName;
        if (tag !== 'IFRAME' && tag !== 'WEBVIEW') return;
        if (isInside(active)) return;
        onCloseRef.current();
      }, 0);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isVisible, triggerRef]);

  // The panel is anchored to its trigger. If the trigger unmounts while the panel is
  // open (a chip that swaps for another control, a bar that re-lays out), the panel
  // would float at its last measured position with nothing to dismiss it.
  useEffect(() => {
    if (isVisible && !triggerRef.current) onCloseRef.current();
  }, [isVisible, triggerRef]);

  return (
    <BaseDialog
      triggerRef={triggerRef}
      isVisible={isVisible}
      onClose={onClose}
      renderDirection={renderDirection}
      background={DialogBackground.Transparent}
      UNSAFE_className={css.Host}
    >
      <div ref={panelRef} className={classNames(css.Glass, UNSAFE_className)} style={{ width }} data-glass-popover="">
        {children}
      </div>
    </BaseDialog>
  );
}

export const glassCss = css;
