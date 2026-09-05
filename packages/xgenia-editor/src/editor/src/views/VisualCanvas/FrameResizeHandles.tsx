import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';

import { screenSizesWithDividers } from '../EditorTopbar/ScreenSizes';
import css from './FrameResizeHandles.module.scss';
import { snapSize } from './frameSnap';

export interface FrameResizeHandlesProps {
  /** Device pixels of the current viewport; null = "Fit viewport" (handles hidden). */
  width: number | null;
  height: number | null;
  /** Visual scale the webview is rendered at (CanvasView's fitScale). */
  scale: number;
  deviceName?: string | null;
  /**
   * The webview's visual box, in pixels relative to the positioned parent
   * (.WebviewContainer). Handles are placed from this, because the container is a
   * centering flex box that is normally much larger than the frame itself.
   */
  rect: { left: number; top: number; width: number; height: number } | null;
}

type Axis = 'x' | 'y' | 'xy';

/**
 * Minimum gap between size requests while dragging.
 *
 * EditorDocument throttles viewer IPC at 100ms per event name AND counts every
 * throttled call as "blocked"; 100 blocked events PERMANENTLY disable all viewer IPC
 * for the session (EditorDocument.tsx:46-65). A 60fps drag emitting per pointermove
 * burns that budget in under two seconds and takes route navigation, zoom, inspect
 * mode and detach down with it. Stay just above the throttle window so a drag never
 * contributes a single blocked event. The size chip still updates every frame — it is
 * local state and costs nothing.
 */
const EMIT_INTERVAL_MS = 120;
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
    last: { w: number; h: number; name: string | null };
    /** Timestamp of the last emitted size request, for the cadence above. */
    lastEmit: number;
    /** True when `last` has not been emitted yet, so release can flush it. */
    pending: boolean;
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
      // Always land on the size the user released at, even if the last move fell
      // inside the cadence window and was coalesced away.
      if (g && g.pending) emitSize(g.last);
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
      const dx = (e.clientX - g.startX) / g.scale;
      const dy = (e.clientY - g.startY) / g.scale;
      const w = g.axis === 'y' ? g.w0 : g.w0 + dx;
      const h = g.axis === 'x' ? g.h0 : g.h0 + dy;
      const r = snapSize(w, h, PRESETS, 24);
      const changed = r.width !== g.last.w || r.height !== g.last.h;
      g.last = { w: r.width, h: r.height, name: r.deviceName };
      showChip(r.width, r.height, r.deviceName, true);
      if (changed) {
        g.pending = true;
        const now = performance.now();
        if (now - g.lastEmit >= EMIT_INTERVAL_MS) {
          g.lastEmit = now;
          emitSize(g.last);
          g.pending = false;
        }
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      if (g && e.pointerId !== g.pointerId) return;
      endGesture();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // pointercancel fires when the browser takes over the gesture (a touch turning
    // into a scroll, a window losing focus mid-drag). Without it the frame keeps
    // resizing on button-less pointer movement.
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // Deliberately NOT dependent on the gesture data or on `scale`: the listeners read
    // both through the ref, so they attach once per drag and stay attached.
  }, [dragAxis, showChip]);

  if (width === null || height === null || !rect || rect.width <= 0) return null;

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
      last: { w: width, h: height, name: deviceName ?? null },
      lastEmit: 0,
      pending: false
    };
    setDragAxis(axis);
    showChip(width, height, deviceName ?? null, true);
  };

  // Anchor every handle to the measured visual box of the webview.
  const right = { left: rect.left + rect.width - 2, top: rect.top + rect.height / 2 - 15 };
  const bottom = { left: rect.left + rect.width / 2 - 15, top: rect.top + rect.height - 2 };
  const corner = { left: rect.left + rect.width - 4, top: rect.top + rect.height - 4 };

  return (
    <>
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
