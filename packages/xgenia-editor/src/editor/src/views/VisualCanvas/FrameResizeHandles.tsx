import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';

import { screenSizesWithDividers } from '../EditorTopbar/ScreenSizes';
import css from './FrameResizeHandles.module.scss';
import { dragSize, type DragAxis } from './frameSnap';

export interface FrameResizeHandlesProps {
  /** Device pixels of the current viewport; null = "Fit viewport" (handles hidden). */
  width: number | null;
  height: number | null;
  /** Visual scale the webview is rendered at (CanvasView's fitScale). */
  scale: number;
  deviceName?: string | null;
  /**
   * The webview's visual box, in the coordinate space these handles are positioned in:
   * offsets from the padding edge of the positioned parent (.WebviewContainer), before
   * its scroll offset is applied. Handles are placed from this rather than from CSS
   * offsets because the container is a centering flex box that is normally much larger
   * than the frame itself. Produced by useFrameRect, which explains the two ways this
   * measurement goes wrong if taken naively.
   */
  rect: { left: number; top: number; width: number; height: number } | null;
}

type Axis = DragAxis;

const CURSORS: Record<Axis, string> = { x: 'ew-resize', y: 'ns-resize', xy: 'nwse-resize' };

const PRESETS = screenSizesWithDividers.filter((s) => typeof s !== 'string') as {
  name: string;
  width: number | null;
  height: number | null;
}[];

export function FrameResizeHandles({ width, height, scale, deviceName, rect }: FrameResizeHandlesProps) {
  const [dragAxis, setDragAxis] = useState<Axis | null>(null);
  const [chip, setChip] = useState<{ w: number; h: number; name: string | null } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Everything the in-flight gesture reads lives in a ref, not in state.
   *
   * The first version kept the drag origin AND the live chip in state and listed both
   * in the effect's dependency array. Because `onMove` writes a new chip object on
   * every `pointermove`, the effect tore down and re-attached the window listeners —
   * and re-rendered the component — once per move event. It also re-read `scale` mid
   * gesture while the origin stayed frozen at pointerdown, so a scale change
   * retroactively re-divided the whole accumulated delta and the cursor-to-size
   * mapping jumped.
   */
  const gesture = useRef<{
    axis: Axis;
    startX: number;
    startY: number;
    w0: number;
    h0: number;
    /** Captured once at pointerdown: the mapping must not change mid-gesture. */
    scale: number;
    pointerId: number;
    /** The size at pointerdown, restored if the drag is cancelled with Escape. */
    origin: { w: number; h: number; name: string | null };
    last: { w: number; h: number; name: string | null };
  } | null>(null);

  const showChip = useCallback((w: number, h: number, name: string | null, sticky: boolean) => {
    setChip({ w, h, name });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    if (!sticky) hideTimer.current = setTimeout(() => setChip(null), 1200);
  }, []);

  // The chip's fade-out timer outlives the component otherwise: release a handle and
  // close the document inside 1200ms and it fires against an unmounted tree.
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!dragAxis) return;

    const emitSize = (size: { w: number; h: number; name: string | null }) => {
      EventDispatcher.instance.emit('preview-size-request', {
        width: size.w,
        height: size.h,
        deviceName: size.name || 'Custom'
      });
    };

    const endGesture = () => {
      const g = gesture.current;
      gesture.current = null;
      setDragAxis(null);
      // Read the final size from the gesture, not from `chip`: pointermove is a
      // continuous event that React 18 commits at normal priority, while pointerup is
      // discrete and flushes synchronously, so the last move's state may not have
      // landed yet and `chip` can still hold the previous size.
      if (g) showChip(g.last.w, g.last.h, g.last.name, false);
    };

    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g || e.pointerId !== g.pointerId) return;
      // A mouse whose button was released outside the window never delivers pointerup.
      // `buttons === 0` is the only reliable signal that the gesture is already over.
      if (e.buttons === 0) {
        endGesture();
        return;
      }
      const r = dragSize(g, e.clientX - g.startX, e.clientY - g.startY, PRESETS, 24);
      const changed = r.width !== g.last.w || r.height !== g.last.h;
      g.last = { w: r.width, h: r.height, name: r.deviceName };
      showChip(r.width, r.height, r.deviceName, true);
      // Emit every distinct size. pointermove is already coalesced to one event per
      // frame, and EditorDocument now resizes the frame locally on each one while
      // debouncing the viewer IPC to the size the drag settles on — so this costs a
      // re-fit, not an IPC event, and the frame stays under the cursor instead of
      // catching up in visible steps.
      if (changed) emitSize(g.last);
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (g && e.pointerId !== g.pointerId) return;
      endGesture();
    };

    // Escape abandons the drag and puts the frame back to the size it started at.
    const onKey = (e: KeyboardEvent) => {
      const g = gesture.current;
      if (!g || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      g.last = g.origin;
      emitSize(g.origin);
      endGesture();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // pointercancel fires when the browser takes over the gesture (a touch turning
    // into a scroll, a window losing focus mid-drag). Without it the frame keeps
    // resizing on button-less pointer movement.
    window.addEventListener('pointercancel', onUp);
    // Capture phase, so an Escape meant for the drag does not also close a panel.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKey, true);
    };
    // Deliberately NOT dependent on the gesture data or on `scale`: the listeners read
    // both through the ref, so they attach once per drag and stay attached.
  }, [dragAxis, showChip]);

  const shield = dragAxis && (
    // Transparent full-window cover while dragging, so the iframe never gets the
    // pointer. Carries the drag cursor, otherwise it flickers to the preview's.
    <div className={css.Shield} style={{ cursor: CURSORS[dragAxis] }} onPointerDown={(e) => e.preventDefault()} />
  );

  // A drag in flight keeps its shield even if the frame loses its box mid-gesture (the
  // preview being recreated): the handle holding pointer capture unmounts with the
  // frame, and without the shield the release could land on the new iframe and the
  // drag would never end.
  if (width === null || height === null || !rect || rect.width <= 0) return shield || null;

  const start = (axis: Axis) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    gesture.current = {
      axis,
      startX: e.clientX,
      startY: e.clientY,
      w0: width,
      h0: height,
      // Frozen for the whole gesture, so a re-fit part-way through cannot re-scale
      // the delta that was already accumulated.
      scale: Math.max(scale, 0.05),
      pointerId: e.pointerId,
      origin: { w: width, h: height, name: deviceName ?? null },
      last: { w: width, h: height, name: deviceName ?? null }
    };
    // Dragging inward moves the cursor over the preview <iframe>, and an iframe's
    // document swallows pointer events: the window listeners below go silent the
    // moment the cursor crosses the frame edge, so the frame could only ever grow.
    // Capturing the pointer on the handle keeps every move and the release routed to
    // our document; the shield rendered during the drag covers the case where capture
    // is refused or lost.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released: nothing to capture, the shield still applies.
    }
    setDragAxis(axis);
    showChip(width, height, deviceName ?? null, true);
  };

  // Anchor every handle to the measured visual box of the webview.
  const right = { left: rect.left + rect.width - 2, top: rect.top + rect.height / 2 - 15 };
  const bottom = { left: rect.left + rect.width / 2 - 15, top: rect.top + rect.height - 2 };
  const corner = { left: rect.left + rect.width - 4, top: rect.top + rect.height - 4 };

  return (
    <>
      {shield}
      <div
        style={{ position: 'absolute', ...right }}
        className={classNames(css.Handle, css.Right, dragAxis === 'x' && css.isActive)}
        onPointerDown={start('x')}
      />
      <div
        style={{ position: 'absolute', ...bottom }}
        className={classNames(css.Handle, css.Bottom, dragAxis === 'y' && css.isActive)}
        onPointerDown={start('y')}
      />
      <div
        style={{ position: 'absolute', ...corner }}
        className={classNames(css.Handle, css.Corner, dragAxis === 'xy' && css.isActive)}
        onPointerDown={start('xy')}
      />
      <div style={{ left: rect.left + 12, top: rect.top + 12 }} className={classNames(css.Chip, !chip && css.isHidden)}>
        <span className={classNames(css.Strong, chip?.name && css.Snap)}>{chip?.name || 'Custom'}</span>
        <span>·</span>
        <span>{chip ? `${chip.w} × ${chip.h}` : ''}</span>
      </div>
    </>
  );
}
