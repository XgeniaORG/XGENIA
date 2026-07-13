// Shared deploy-token loader.
//
// Fetches the shared Vercel + GitHub tokens from the RGS database via the
// anon-granted `get_deploy_tokens` SECURITY DEFINER RPC, and installs them on
// `window.__XGENIA_DEFAULT_TOKENS__` — the runtime override that
// ConnectionStore.getInjectedDefaultToken() reads first. This is what lets every
// collaborator's editor publish out of the box without connecting their own
// Vercel/GitHub accounts.
//
// Why this exists: the tokens used to be committed into the editor bundle, where
// GitHub secret scanning kept auto-revoking them. They now live server-side as data
// (public.platform_deploy_tokens), are rotated with a single UPDATE, and are never
// in git.

import { XRGS_URL, XRGS_ANON_KEY } from './rgsClient';

// REST/RPC base, derived from the functions base so there is one source of truth.
const XRGS_REST_URL = XRGS_URL.replace('/functions/v1', '/rest/v1');

let inflight: Promise<void> | null = null;

async function doLoad(): Promise<void> {
    try {
        const res = await fetch(`${XRGS_REST_URL}/rpc/get_deploy_tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: XRGS_ANON_KEY,
                Authorization: `Bearer ${XRGS_ANON_KEY}`,
            },
            body: '{}',
        });
        if (!res.ok) {
            console.warn('[deployTokens] get_deploy_tokens RPC failed:', res.status);
            return;
        }
        const tokens = await res.json();
        if (tokens && (tokens.vercel || tokens.github)) {
            const w = globalThis as any;
            w.__XGENIA_DEFAULT_TOKENS__ = { ...(w.__XGENIA_DEFAULT_TOKENS__ || {}), ...tokens };
            console.log('[deployTokens] Shared deploy tokens installed');
        } else {
            console.warn('[deployTokens] get_deploy_tokens returned no tokens');
        }
    } catch (e: any) {
        // Non-fatal: the Publish flow will fall back to any build-time .env.local token.
        console.warn('[deployTokens] Could not load shared deploy tokens:', e);
    }
}

/**
 * Fetch-and-install the shared deploy tokens. Idempotent: the network request runs
 * at most once per session; concurrent/repeat callers await the same promise. Safe to
 * call early at startup (to warm) and again from the Deploy panel (to guarantee the
 * tokens are present before a publish).
 */
export function loadSharedDeployTokens(): Promise<void> {
    if (!inflight) inflight = doLoad();
    return inflight;
}
