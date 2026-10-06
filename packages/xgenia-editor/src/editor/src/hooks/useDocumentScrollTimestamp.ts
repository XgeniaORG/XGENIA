import { RefObject, useEffect, useState } from 'react';

/**
 * Timestamp of the last scroll anywhere in the document, for things that must re-measure
 * when the page moves under them.
 *
 * `ignoreWithin` exists because the listener is on the document in CAPTURE, so it also
 * fires for scrolling INSIDE the element that is watching — a dialog that scrolls its own
 * content would otherwise re-run its placement maths on every wheel tick, for itself and
 * for every other dialog mounted at the time.
 */
export default function useDocumentScrollTimestamp(
  isEnabled = true,
  debounceMs = 0,
  ignoreWithin?: RefObject<HTMLElement>
) {
  const [timestamp, setTimestamp] = useState(Date.now());

  useEffect(() => {
    let debounceTimeoutId: ReturnType<typeof setTimeout>;

    function onResize(event: Event) {
      const target = event.target as Node | null;
      if (ignoreWithin?.current && target && ignoreWithin.current.contains(target)) return;

      clearTimeout(debounceTimeoutId);
      debounceTimeoutId = setTimeout(() => setTimestamp(Date.now()), debounceMs);
    }

    function cleanup() {
      document.removeEventListener('scroll', onResize, true);
      clearTimeout(debounceTimeoutId);
    }

    if (isEnabled) {
      document.addEventListener('scroll', onResize, true);
    } else {
      cleanup();
    }

    return () => {
      cleanup();
    };
  }, [isEnabled, debounceMs, ignoreWithin]);

  return timestamp;
}
