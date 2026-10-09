import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { scrollTopToReveal, visibleWindow } from './virtualRows';

/**
 * Window a fixed-height list inside a scrolling element. The element can be `display: none`
 * (a hidden panel): it measures 0 and draws a handful of rows until it is shown again.
 */
export function useVirtualRows(count: number, rowHeight: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, []);

  // A shorter list can leave scrollTop past the end; the browser clamps the element, keep ours in step.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  }, [count]);

  const { start, end } = visibleWindow(scrollTop, viewportHeight, rowHeight, count);

  /** Scroll so row `index` is on screen, if it is not already. */
  const reveal = useCallback(
    (index: number) => {
      const el = scrollRef.current;
      if (!el) return;
      const next = scrollTopToReveal(index, rowHeight, el.scrollTop, el.clientHeight, rowHeight);
      if (next !== null) {
        el.scrollTop = next;
        setScrollTop(el.scrollTop);
      }
    },
    [rowHeight]
  );

  return { scrollRef, start, end, totalHeight: count * rowHeight, reveal };
}
