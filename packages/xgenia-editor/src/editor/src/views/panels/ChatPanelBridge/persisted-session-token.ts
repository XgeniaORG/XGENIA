/**
 * persisted-session-token.ts — read the editor's stored Supabase session for a token that is
 * still worth handing to the AI panel.
 *
 * WHY (2026-09-16)
 *
 * The bridge's `auth.getJwt` falls back to the persisted session when `getSession()` is queued
 * behind a refresh for more than 3 s — on a first launch that is the boot-time refresh, every time.
 * Its comment said "a slightly-stale access token is a far better answer than none: the caller
 * already handles 401 by asking us to refresh". That held while the Supabase gateway stood in front
 * of the chat functions and refused an expired token with a coded 401 the panel recognised. Since
 * 2026-09-15 the chat functions run without the gateway check (`verify_jwt = false`), so an expired
 * token reaches check-entitlement itself, whose getUser() fails with a plain 401 — and the panel
 * build in production read that as "not entitled" and painted the upgrade wall for paying users.
 *
 * A token we can SEE is expired is therefore a worse answer than none: null makes the panel look
 * again or fail open; an expired token produced a paywall. The JWT's `exp` claim is enough to
 * decide, and it needs no secret to read.
 */

export interface PersistedTokenPick {
    token: string | null;
    reason: 'ok' | 'expired' | 'none' | 'unreadable';
}

/** Decode a JWT's `exp` (seconds since epoch) without verifying it. `null` when absent or unreadable. */
export function jwtExpiryMs(token: string): number | null {
    try {
        const parts = token.split('.');
        if (parts.length < 2) return null;
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = typeof atob === 'function'
            ? atob(padded)
            : Buffer.from(padded, 'base64').toString('utf8');
        const exp = JSON.parse(json)?.exp;
        return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
    } catch {
        return null;
    }
}

/**
 * Pick the access token out of a stored `sb-*-auth-token` entry, but only if it is still valid.
 *
 * Both shapes supabase-js has written are read: `{ access_token }` (current) and
 * `{ currentSession: { access_token } }` (older). A token whose `exp` lies within `marginMs` of
 * now is treated as expired — by the time the panel uses it, it would be.
 */
export function pickPersistedAccessToken(
    raw: string | null | undefined,
    nowMs = Date.now(),
    marginMs = 10_000,
): PersistedTokenPick {
    if (!raw) return { token: null, reason: 'none' };
    let token: unknown;
    try {
        const parsed = JSON.parse(raw);
        token = parsed?.access_token ?? parsed?.currentSession?.access_token;
    } catch {
        return { token: null, reason: 'unreadable' };
    }
    if (typeof token !== 'string' || !token) return { token: null, reason: 'none' };

    const expMs = jwtExpiryMs(token);
    if (expMs !== null && expMs - marginMs <= nowMs) return { token: null, reason: 'expired' };
    return { token, reason: 'ok' };
}
