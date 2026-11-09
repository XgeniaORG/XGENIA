/**
 * How long to wait for the chat panel's handshake before loading it again.
 *
 * An iframe that fails to load (no network yet, say just after the computer wakes) still fires
 * `load` on Chromium's error page, so the only sign of failure is that no handshake ever comes.
 * The first wait is long enough for a slow link to finish a working load.
 */
export function panelReloadDelayMs(attempt: number): number {
    return Math.min(20_000 * 2 ** Math.max(0, attempt), 60_000);
}
