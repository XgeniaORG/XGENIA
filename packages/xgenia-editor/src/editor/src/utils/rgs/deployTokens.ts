// Shared deploy-token loader.
//
// Fetches the shared Vercel + GitHub tokens from XGENIA RGS and installs them on
// `window.__XGENIA_DEFAULT_TOKENS__` — the runtime override that
// ConnectionStore.getInjectedDefaultToken() reads first. This is what lets every
// collaborator's editor publish out of the box without connecting their own
// Vercel/GitHub accounts.
//
// Why this exists: the tokens used to be committed into the editor bundle, where
// GitHub secret scanning kept auto-revoking them. They now live server-side as data
// (public.platform_deploy_tokens), are rotated with a single UPDATE, and are never
// in git.
//
// WHY THIS GOES THROUGH maths-deployer AND NOT PostgREST
//
// It used to POST /rest/v1/rpc/get_deploy_tokens directly, carrying only the
// publishable anon key, because get_deploy_tokens() was granted to `anon`. That
// anon key ships inside every studio bundle and every published game, so the
// tokens it returned — a classic, non-expiring GitHub PAT with `repo` scope and a
// Vercel token for the team hosting the platform — were readable by anyone who
// opened a published game. XRGS migration 20260807140000 revoked that grant
// (service_role only) and named this route as the replacement, which is why the
// old call started coming back 403 and publishing broke with the misleading
// "Deployment failed: Project compilation error".
//
// So the tokens now cost an operator credential: the same X-Operator-Key the
// Maths RGS panel already holds, validated server-side. An editor that has not
// been connected to XGENIA RGS cannot fetch them — by design, and the reason
// callers must surface `reason` rather than leave the user at a null token.

import { XRGS_URL, getRgsSettings, rgsHeaders } from './rgsClient';

/** Why a load attempt produced no tokens — surfaced by the Deploy panel. */
export type DeployTokenFailure =
    | 'not-connected'   // no operator key stored; connect in the Maths RGS panel
    | 'unauthorized'    // key rejected (revoked, or wrong platform)
    | 'not-configured'  // platform has no tokens set
    | 'network'         // offline / request failed
    | 'unknown';

export interface DeployTokenResult {
    ok: boolean;
    reason?: DeployTokenFailure;
    /** Ready to show in a toast. Empty when ok. */
    message: string;
}

const OK: DeployTokenResult = { ok: true, message: '' };

const NOT_CONNECTED: DeployTokenResult = {
    ok: false,
    reason: 'not-connected',
    message:
        'Not connected to XGENIA RGS, so the shared Vercel/GitHub deploy tokens could not be' +
        ' fetched. Connect in the Maths RGS panel, then try again.',
};

// Resolved only on success, so a failure never becomes permanent for the session:
// the user can connect their RGS key and press Deploy again without restarting
// the editor (which the previous unconditional memoisation forced them to do).
let loaded: Promise<DeployTokenResult> | null = null;

async function doLoad(): Promise<DeployTokenResult> {
    const apiKey = getRgsSettings()?.apiKey;
    if (!apiKey) {
        console.warn('[deployTokens] No XGENIA RGS operator key — cannot fetch shared deploy tokens');
        return NOT_CONNECTED;
    }

    try {
        const res = await fetch(`${XRGS_URL}/maths-deployer`, {
            method: 'POST',
            headers: rgsHeaders(apiKey),
            body: JSON.stringify({ action: 'deploy-tokens' }),
        });

        if (!res.ok) {
            const detail = await res.json().catch(() => ({} as any));
            console.warn('[deployTokens] deploy-tokens failed:', res.status, detail?.error);

            if (res.status === 401 || res.status === 403) {
                return {
                    ok: false,
                    reason: 'unauthorized',
                    message:
                        'XGENIA RGS rejected this operator key, so the shared Vercel/GitHub deploy' +
                        ' tokens could not be fetched. Reconnect in the Maths RGS panel.',
                };
            }
            if (res.status === 404) {
                return {
                    ok: false,
                    reason: 'not-configured',
                    message:
                        `XGENIA RGS has no shared deploy tokens configured (${detail?.error || 'not found'}).`,
                };
            }
            return {
                ok: false,
                reason: 'unknown',
                message: `Could not fetch the shared deploy tokens from XGENIA RGS (HTTP ${res.status}).`,
            };
        }

        const tokens = await res.json();
        if (!tokens || (!tokens.vercel && !tokens.github)) {
            console.warn('[deployTokens] deploy-tokens returned no tokens');
            return {
                ok: false,
                reason: 'not-configured',
                message: 'XGENIA RGS returned no shared deploy tokens.',
            };
        }

        const w = globalThis as any;
        w.__XGENIA_DEFAULT_TOKENS__ = { ...(w.__XGENIA_DEFAULT_TOKENS__ || {}), ...tokens };
        console.log('[deployTokens] Shared deploy tokens installed');
        return OK;
    } catch (e: any) {
        console.warn('[deployTokens] Could not load shared deploy tokens:', e);
        return {
            ok: false,
            reason: 'network',
            message: `Could not reach XGENIA RGS to fetch the shared deploy tokens: ${e?.message || e}`,
        };
    }
}

/**
 * Fetch-and-install the shared deploy tokens.
 *
 * Idempotent on success: the network request runs at most once per session and
 * concurrent callers await the same promise. A FAILURE is not cached — the usual
 * cause is a missing operator key, which the user can fix without restarting, so
 * the next call retries.
 */
export function loadSharedDeployTokens(): Promise<DeployTokenResult> {
    if (!loaded) {
        const attempt = doLoad();
        loaded = attempt;
        attempt
            .then((result) => {
                if (!result.ok && loaded === attempt) loaded = null;
            })
            .catch(() => {
                if (loaded === attempt) loaded = null;
            });
    }
    return loaded;
}
