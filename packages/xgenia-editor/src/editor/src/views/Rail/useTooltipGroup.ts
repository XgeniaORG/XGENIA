import { useCallback, useRef, useState } from 'react';

const COLD_MS = 300;
const WARM_WINDOW_MS = 500;

/**
 * The first tooltip in a cluster waits; the next one within 500ms shows at once. core-ui's
 * Tooltip has only `showAfterMs`, so the group tracks when the last one closed and hands
 * each button the delay to use.
 */
export function useTooltipGroup() {
  const lastClosedAt = useRef(0);
  const [, force] = useState(0);
  const noteClosed = useCallback(() => {
    lastClosedAt.current = Date.now();
    force((n) => n + 1);
  }, []);
  const showAfterMs = Date.now() - lastClosedAt.current < WARM_WINDOW_MS ? 0 : COLD_MS;
  return { showAfterMs, noteClosed };
}
