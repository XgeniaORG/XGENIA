import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The preview frame's visual box, in the coordinate space of the handles' containing block. */
export interface FrameRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const same = (a: FrameRect | null, b: FrameRect | null) =>
  a === b ||
  (!!a && !!b && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);

/**
 * Measure `elRef`'s visual box the way an absolutely positioned sibling inside
 * `containerRef` is actually laid out, so overlays anchored to it land on the frame.
 *
 * Two things make the naive `elBounds.left - containerBounds.left` wrong here.
 *
 * **Scroll is counted twice.** `.WebviewContainer` is `overflow: auto`, and a difference
 * of two viewport-relative rects already carries `-scrollLeft/-scrollTop` in it. An
 * absolutely positioned child of that same container is then shifted by the scroll a
 * SECOND time at paint, because it sits in the scrollable overflow area — so the overlay
 * ends up off by twice the scroll offset. Whenever the frame outgrew the panel, the
 * handles drifted out into the background. Resolving against the container's padding
 * edge and adding the scroll offset back cancels it: as the container scrolls, `left`
 * falls by exactly what `scrollLeft` gains, so the result is scroll-invariant.
 *
 * **A transform fires no ResizeObserver.** CanvasView.updateViewportSize() keeps the
 * frame's layout box at the device size and fits it with `transform: scale(fitScale)`.
 * ResizeObserver watches the border box, which a transform never touches, so every
 * re-fit that left the device size alone — dragging the panel divider, toggling a side
 * panel, resizing the window — resized the frame on screen while the observer stayed
 * silent and the overlay kept the previous fit's geometry. The measure-on-every-commit
 * pass below is what covers that case: CanvasView writes the new `scale()` and then
 * re-renders this tree, so the new geometry is in the DOM by the time a layout effect
 * runs. `getBoundingClientRect()` is transform-aware, so width/height are the scaled
 * visual size rather than the device-pixel layout size.
 *
 * @returns the frame's box, or null while it has no layout (the preview surface is
 *   hidden, or the frame is being recreated).
 */
export function useFrameRect(
  elRef: RefObject<HTMLElement | null>,
  containerRef: RefObject<HTMLElement | null>
): FrameRect | null {
  const [rect, setRect] = useState<FrameRect | null>(null);
  // The last value we published. Compared against before every setState, so an
  // unchanged measurement cannot commit — see the loop note on the layout effect.
  const published = useRef<FrameRect | null>(null);
  const frame = useRef<number | null>(null);

  const measure = useCallback(() => {
    const el = elRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const box = el.getBoundingClientRect();
    const containerBox = container.getBoundingClientRect();

    let next: FrameRect | null = null;
    if (box.width > 0 && box.height > 0) {
      // clientLeft/clientTop are the border widths: adding them to the container's
      // border-box origin gives its padding edge, which is both the origin an
      // absolutely positioned child resolves `left`/`top` against and the origin the
      // scroll offset is measured from.
      next = {
        left: box.left - containerBox.left - container.clientLeft + container.scrollLeft,
        top: box.top - containerBox.top - container.clientTop + container.scrollTop,
        width: box.width,
        height: box.height
      };
    }

    if (same(published.current, next)) return;
    published.current = next;
    setRect(next);
  }, [elRef, containerRef]);

  // Runs after every commit, deliberately without a dependency array: a re-fit changes
  // only the transform, so there is no prop or observable box change to key off.
  // Terminating because `measure` bails on an unchanged rect — without that guard this
  // would setState on every commit and spin.
  useLayoutEffect(measure);

  useEffect(() => {
    const el = elRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    // Coalesce onto one frame: a panel drag delivers both observer callbacks and a
    // window resize together, and each would otherwise force its own layout read.
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    observer.observe(container);
    window.addEventListener('resize', schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [elRef, containerRef, measure]);

  return rect;
}
