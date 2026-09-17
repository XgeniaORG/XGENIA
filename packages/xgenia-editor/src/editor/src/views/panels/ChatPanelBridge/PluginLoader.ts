/**
 * PluginLoader — Fetches plugin entitlements from XGENIA's server.
 *
 * Flow:
 * 1. Editor authenticates → gets Supabase session
 * 2. PluginLoader calls the plugin-entitlements edge function
 * 3. Server checks the account's tier → returns plugin URLs
 * 4. Editor loads each plugin into its iframe from the server-provided URL
 *
 * Caches the server's VERDICT in localStorage for an offline grace period.
 *
 * ─── a verdict is not the same thing as "we could not check" (2026-09-15) ──────
 * Paying users on the nightly builds saw "AI Chat requires a Pro subscription" on
 * their first visit to the panel after an update, and a restart made it go away.
 * Nothing had changed on their account — every plugin-entitlements call that day
 * returned 200 with the right tier. The loader itself manufactured the paywall,
 * on two paths:
 *
 *   • The server call raced a hard 5 s timer. The function runs near the caller
 *     but makes its reads against a database in eu-central-1, so from Indonesia
 *     it measured 1.9–5.8 s server-side (median 3.0 s) — and the same 5 s also
 *     had to cover a boot-time token refresh. When the timer won, the reply that
 *     landed a moment later was discarded, and with no stored verdict to fall
 *     back on the loader answered `unverified`, which the panel painted as the
 *     paywall.
 *   • `getSession()` answered null (a signed-in user whose expiring token failed
 *     to refresh over a flaky connection), and that was returned as
 *     `{plugins: [], tier: 'free'}` — a guess dressed as a verdict — then
 *     PERSISTED, so it also poisoned the 72 h fallback.
 *
 * Either answer was then held in memory for an hour, every panel read the same
 * object, and nothing re-asked when the session appeared. Hence: restart.
 *
 * The rules now:
 *   1. Only VERDICTS (an HTTP 200 from the server, or a stored one) are kept in
 *      memory or on disk. `unverified` is returned to the caller and forgotten,
 *      so the very next call asks again.
 *   2. A missing session is a failed check, not a free account.
 *   3. The deadline depends on what there is to show: 20 s when nothing is
 *      stored (a spinner beats a paywall that is a guess), 5 s when a stored
 *      verdict can be shown meanwhile. In both cases THE LATE ANSWER IS ADOPTED
 *      when it lands — persisted and pushed to every listener — so a slow
 *      network costs a delay, never a restart.
 *   4. One server fetch at a time; concurrent callers (chat, image editor,
 *      feedback) share it.
 *   5. Auth changes are watched: signing in, a token refresh or a switched
 *      account re-checks; signing out clears everything.
 *   6. Cache entries written by earlier builds carry no `source` and may hold
 *      the persisted no-session guess. They are discarded, never served.
 */

import { supabase } from '../../../supabaseInit';

export interface PluginEntitlement {
    id: string;
    name: string;
    description?: string;
    url: string;
    version: string;
}

/** Where an answer came from. Absent on cache entries written before 2026-09-15. */
export type EntitlementsSource = 'server' | 'cache' | 'dev' | 'unverified';

export interface EntitlementsResponse {
    plugins: PluginEntitlement[];
    tier: string;
    cachedAt?: number;
    source?: EntitlementsSource;
    /** The Supabase user the answer was computed for. */
    userId?: string;
}

/**
 * The tier that means "we do not know". It is not a plan: it is what the loader
 * returns when the server could not be reached in time (or there was no session
 * to ask with) and nothing stored can stand in. Consumers must treat it as
 * "still checking", never as "free" — see `isVerdict`.
 */
export const UNVERIFIED_TIER = 'unverified';

/** Did the server (or a stored copy of its answer) actually rule on this account? */
export function isVerdict(e: EntitlementsResponse | null | undefined): e is EntitlementsResponse {
    return !!e && e.tier !== UNVERIFIED_TIER;
}

/**
 * The slice of the Supabase client this loader uses. Declared so a test can hand
 * in a fake; the real client satisfies it structurally.
 */
export interface EntitlementsBackend {
    auth: {
        getSession(): Promise<{ data: { session: { access_token: string; user?: { id: string } } | null } }>;
        onAuthStateChange(callback: (event: string, session: { user?: { id: string } } | null) => void): unknown;
    };
    functions: {
        invoke(name: string, options: { headers: Record<string, string> }): Promise<{ data: any; error: { message: string } | null }>;
    };
}

export interface PluginLoaderOptions {
    backend?: EntitlementsBackend;
    storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
    isOnline?: () => boolean;
    now?: () => number;
    /** How long a caller waits for the server. Overridable so tests need not wait 20 s. */
    deadlines?: { noCacheMs: number; withCacheMs: number };
}

const CACHE_KEY = 'xgenia_plugin_entitlements';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour — how long a verdict is reused before re-asking while online
/** How long a stored verdict stays usable while the server is UNREACHABLE. */
const GRACE_TTL = 72 * 60 * 60 * 1000; // 72 hours
/** Nothing stored to show: wait this long for the server before saying "could not check". */
const FETCH_DEADLINE_NO_CACHE_MS = 20_000;
/** A stored verdict exists: show it after this long; the real answer replaces it when it lands. */
const FETCH_DEADLINE_WITH_CACHE_MS = 5_000;

/** URL of the local image editor Vite dev server */
const LOCAL_IMAGE_EDITOR_URL = `http://localhost:${(globalThis as any)?.process?.env?.XGENIA_IMAGE_EDITOR_PORT || 3002}`;
/** Fallback Vercel deployment (used when local server is not running) */
const VERCEL_IMAGE_EDITOR_URL = 'https://xgenia-image-editor-plugin.vercel.app';

/** URL of the local AI chat Vite dev server */
const LOCAL_AI_CHAT_URL = `http://localhost:${(globalThis as any)?.process?.env?.XGENIA_AI_APP_PORT || 3010}`;
/** Fallback Vercel deployment */
const VERCEL_AI_CHAT_URL = 'https://xgenia-ai-app-xgenia.vercel.app';

/** The server did not answer inside the caller's deadline. The fetch itself is still running. */
class DeadlineError extends Error {
    constructor(readonly ms: number) {
        super(`Entitlements fetch: no answer after ${ms} ms`);
        this.name = 'DeadlineError';
    }
}

/** There was no Supabase session to ask with. A failed check — not a verdict, and never "free". */
export class NoSessionError extends Error {
    constructor() {
        super('No Supabase session at the moment of the entitlements check');
        this.name = 'NoSessionError';
    }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new DeadlineError(ms)), ms);
        work.then(
            (value) => { clearTimeout(timer); resolve(value); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });
}

function defaultStorage(): PluginLoaderOptions['storage'] {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

function defaultIsOnline(): boolean {
    try {
        return typeof navigator === 'undefined' || navigator.onLine !== false;
    } catch {
        return true;
    }
}

export class PluginLoader {
    private static instance_: PluginLoader;

    /** The current VERDICT (or the dev fallback). Never an `unverified` answer. */
    private entitlements: EntitlementsResponse | null = null;
    /** The one server fetch in flight, shared by every caller that arrives while it runs. */
    private inflight: Promise<EntitlementsResponse> | null = null;
    /** Fetches that already have a late-answer handler attached, so a shared fetch adopts once. */
    private lateAdopters = new WeakSet<Promise<EntitlementsResponse>>();
    private listeners: Array<(e: EntitlementsResponse | null) => void> = [];
    private watchingAuth = false;

    private readonly backend: EntitlementsBackend;
    private readonly storage: PluginLoaderOptions['storage'];
    private readonly isOnline: () => boolean;
    private readonly now: () => number;
    private readonly deadlines: { noCacheMs: number; withCacheMs: number };

    constructor(options: PluginLoaderOptions = {}) {
        this.backend = options.backend ?? (supabase as unknown as EntitlementsBackend);
        this.storage = options.storage === undefined ? defaultStorage() : options.storage;
        this.isOnline = options.isOnline ?? defaultIsOnline;
        this.now = options.now ?? (() => Date.now());
        this.deadlines = options.deadlines ?? { noCacheMs: FETCH_DEADLINE_NO_CACHE_MS, withCacheMs: FETCH_DEADLINE_WITH_CACHE_MS };
    }

    static get instance(): PluginLoader {
        if (!PluginLoader.instance_) {
            PluginLoader.instance_ = new PluginLoader();
        }
        return PluginLoader.instance_;
    }

    /**
     * AM I IN DEVELOPMENT? — asked of the BUILD, not of the URL.
     *
     * (2026-08-04 pre-release audit) This used to answer yes for `window.location.protocol === 'file:'`
     * — and main.js loads the renderer from `file://` in EVERY PACKAGED BUILD (`Config.devMode ?
     * 'http://localhost:8080/…' : 'file:///' + appPath + '/…'`). So every real install was classified
     * as dev, with three consequences on a machine that has never run this repo:
     *   • the plugin control-plane was bypassed — `mergeDev` overwrites the server's URLs, so the
     *     entitlements server can no longer pin a version or roll back a bad deploy for anyone;
     *   • the "not entitled" upgrade screen could never render, because plugins are injected even
     *     when the server replies `{plugins: [], tier: 'free'}` — a free user gets the full chat UI;
     *   • the loader probes localhost:3002 on a stranger's machine and will iframe whatever answers
     *     into a renderer that holds the privileged bridge.
     *
     * The dev signal is the environment the MAIN process sets before Electron starts
     * (dev-main.js: `process.env.devMode = 'yes'`), which a packaged app never has. The
     * webpack-dev-server host/port check is kept because that IS genuinely dev; the `file:`
     * protocol check is gone, because that is genuinely production.
     */
    static isDevEnvironment(): boolean {
        try {
            const env: any = (typeof process !== 'undefined' && (process as any)?.env) || {};
            if (env.devMode === 'yes' || env.NODE_ENV === 'development') return true;
        } catch { /* no process in this context — fall through to the URL check */ }
        try {
            if (typeof window === 'undefined') return false;
            const { hostname, port } = window.location;
            // webpack-dev-server only. NOT `file:` — that is how a packaged build loads.
            return (hostname === 'localhost' || hostname === '127.0.0.1') && (port === '8080' || port === '9080');
        } catch { return false; }
    }

    /**
     * Fetch entitled plugins from the server.
     *
     * Returns the in-memory verdict while it is fresh. Otherwise asks the server, bounded by a
     * deadline; on a miss, serves the stored verdict if one is inside the grace window, and
     * only when there is nothing to show answers `unverified` — which is not remembered, so
     * the next call asks again. A server answer that arrives after the deadline is still
     * adopted (persisted + pushed to listeners).
     *
     * In dev mode (editor started from dev-main.js / webpack-dev-server):
     *   - Probes localhost:3002. If reachable → loads local image editor (HMR).
     *   - If localhost:3002 is NOT reachable → falls back to Vercel (no blank screen).
     */
    async getEntitledPlugins(): Promise<EntitlementsResponse> {
        const isDev = PluginLoader.isDevEnvironment();
        this.watchAuth();

        // In dev mode skip the in-memory cache so we re-probe localhost on
        // every call (the local server may have started since the last check).
        // Only verdicts ever live in `this.entitlements`, so "fresh" here can never describe
        // a "could not check" answer.
        if (!isDev && this.entitlements && this.isCacheFresh(this.entitlements)) {
            return this.entitlements;
        }

        // Probe the local image editor dev server (fast, 1.5 s timeout).
        // This determines whether mergeDev() should override to localhost or
        // leave the Vercel URL in place.
        const localImageEditorReachable = isDev
            ? await this.probeLocalServer(LOCAL_IMAGE_EDITOR_URL)
            : false;

        // FIX (2026-04-20): Always load AI chat from Vercel — never from localhost.
        // The local dev server was masking cache issues and deploy-vs-local drift;
        // forcing Vercel guarantees the iframe matches what's deployed.
        //
        // (2026-09-16) EXPLICIT OPT-IN ONLY: XGENIA_LOCAL_AI_CHAT=1 in the environment that starts
        // the dev editor. AI test runs need to exercise panel fixes before they can be deployed
        // (and while a deploy path is down); the default stays Vercel so ordinary dev never
        // drifts. A dev build only — isDevEnvironment() is false in every packaged install.
        let localAiChatOptIn = false;
        try {
            // NOT the lexical `process`: inside this webpack bundle that is the browser polyfill,
            // whose env holds only DefinePlugin keys. The renderer runs with nodeIntegration, so the
            // real Node process — with the environment the dev editor was started in — is on window.
            const w: any = globalThis as any;
            const nodeEnv: any = (w.process && w.process.env)
                || (typeof w.require === 'function' ? w.require('process').env : null)
                || {};
            localAiChatOptIn = nodeEnv.XGENIA_LOCAL_AI_CHAT === '1';
        } catch { /* no Node process in this context — stay on Vercel */ }
        // The dev launcher starts the panel's Vite server in parallel with the editor, so on a cold
        // start the first probe can land before :3010 is listening. An explicit opt-in means "use the
        // local panel", so wait for it (bounded) rather than silently falling back to Vercel.
        let localAiChatReachable = false;
        if (isDev && localAiChatOptIn) {
            const deadline = Date.now() + 90_000;
            do {
                localAiChatReachable = await this.probeLocalServer(LOCAL_AI_CHAT_URL);
                if (localAiChatReachable) break;
                await new Promise((r) => setTimeout(r, 3000));
            } while (Date.now() < deadline);
            if (!localAiChatReachable) {
                console.warn('[PluginLoader] XGENIA_LOCAL_AI_CHAT=1 but localhost:3010 never answered in 90s — falling back to Vercel');
            }
        }
        // console.log is silenced in the editor renderer, so the dev decision is also left where a
        // CDP session or DevTools can read it.
        try {
            (globalThis as any).__xgeniaPluginLoaderDecision = { isDev, localAiChatOptIn, localAiChatReachable, localImageEditorReachable, at: new Date().toISOString() };
        } catch { /* diagnostics only */ }

        if (isDev) {
            console.log(
                localImageEditorReachable
                    ? '[PluginLoader] Local image editor found at :3002 — using localhost'
                    : '[PluginLoader] Local image editor NOT reachable — falling back to Vercel'
            );
            console.log(
                localAiChatReachable
                    ? '[PluginLoader] Local AI chat found at :3010 — using localhost'
                    : '[PluginLoader] Local AI chat NOT reachable — falling back to Vercel'
            );
        }

        // What is there to show if the server is slow? A stored verdict inside the grace
        // window means we can afford to fall back quickly and let the late answer replace it.
        const stored = this.loadCache();
        const fallback = stored && this.isWithinGrace(stored) ? stored : null;

        if (this.isOnline()) {
            const attempt = this.fetchShared();
            const deadlineMs = fallback ? this.deadlines.withCacheMs : this.deadlines.noCacheMs;
            try {
                const response = await withDeadline(attempt, deadlineMs);
                return this.adopt(response, isDev, localImageEditorReachable, localAiChatReachable);
            } catch (err: any) {
                if (err instanceof DeadlineError) {
                    console.warn(`[PluginLoader] No entitlements answer after ${err.ms / 1000}s — falling back for now; the server's answer is adopted when it arrives.`);
                    // THE LATE ANSWER IS NOT THROWN AWAY. The fetch is still running; when it
                    // resolves, store it and tell every panel, so a slow network costs a delay
                    // rather than a restart. One handler per fetch, however many callers timed out.
                    if (!this.lateAdopters.has(attempt)) {
                        this.lateAdopters.add(attempt);
                        attempt.then(
                            (late) => { this.adopt(late, isDev, localImageEditorReachable, localAiChatReachable); },
                            () => { /* the failure is reported by whichever caller owns the deadline */ }
                        );
                    }
                } else if (err instanceof NoSessionError) {
                    console.warn('[PluginLoader] No Supabase session at the moment of the check — not a verdict; re-checked when the session appears.');
                } else {
                    console.warn('[PluginLoader] Failed to fetch entitlements from server:', err);
                }
            }
        }

        // Fall back to the last GOOD answer the server gave us, but only for a
        // bounded window. This is the offline grace period: a paying user on a
        // plane, or behind a slow link, keeps working. It is not open-ended.
        if (fallback) {
            const ageMin = Math.round((this.now() - (fallback.cachedAt || 0)) / 60000);
            console.log(`[PluginLoader] Server not answering — using the stored entitlements (${ageMin}m old, grace ${GRACE_TTL / 3600000}h)`);
            const served: EntitlementsResponse = { ...fallback, source: 'cache' };
            if (isDev) this.mergeDev(served, localImageEditorReachable, localAiChatReachable);
            // Kept in memory so panels agree with each other, but its cachedAt is the original
            // one, so the next call asks the server again rather than trusting it for an hour.
            this.entitlements = served;
            return served;
        }
        if (stored) {
            console.warn('[PluginLoader] Stored entitlements are past the offline grace period — discarding.');
        }

        // (2026-08-28) FAIL CLOSED.
        //
        // This used to return getDevFallback() here — BOTH plugins, tier 'dev' —
        // for any user whose entitlements fetch threw. A 5s timeout, a DNS blip
        // or a Supabase outage therefore granted the full paid product to
        // everyone, silently, in production. There is no path on which "we could
        // not verify" should mean "yes".
        //
        // Dev keeps its fallback, because dev is a claim about THIS BUILD
        // (see isDevEnvironment) and not something an installed copy can assert.
        if (isDev) {
            console.log('[PluginLoader] Dev build, no entitlements — using dev defaults');
            const devFallback = this.getDevFallback(localImageEditorReachable, localAiChatReachable);
            this.entitlements = devFallback;
            return devFallback;
        }

        // Closed, but not decided. Nothing is unlocked, and nothing is remembered either:
        // this answer is not stored in memory or on disk, so the next call asks the server
        // again, and the auth watcher asks as soon as a session appears.
        console.warn('[PluginLoader] Could not verify entitlements — nothing is unlocked until a check succeeds.');
        const unverified: EntitlementsResponse = { plugins: [], tier: UNVERIFIED_TIER, cachedAt: this.now(), source: 'unverified' };
        this.notifyListeners(unverified);
        return unverified;
    }

    /**
     * Is a cached entitlement still usable offline?
     *
     * Separate from isCacheFresh (1h) on purpose: CACHE_TTL decides when to
     * bother re-fetching while the server is reachable, GRACE_TTL decides how
     * long we will trust a stale answer when it is NOT. A cache with no
     * cachedAt is not trusted at all — that is the shape a hand-written
     * localStorage entry takes.
     */
    private isWithinGrace(cache: EntitlementsResponse): boolean {
        if (typeof cache.cachedAt !== 'number' || !Number.isFinite(cache.cachedAt)) return false;
        const age = this.now() - cache.cachedAt;
        if (age < 0) return false; // clock moved, or a forged future timestamp
        return age < GRACE_TTL;
    }

    /** Get the URL for a specific plugin by ID */
    getPluginUrl(pluginId: string): string | null {
        if (!this.entitlements) return null;
        const plugin = this.entitlements.plugins.find(p => p.id === pluginId);
        return plugin?.url || null;
    }

    /** Check if the user is entitled to a specific plugin */
    isEntitled(pluginId: string): boolean {
        if (!this.entitlements) return false;
        return this.entitlements.plugins.some(p => p.id === pluginId);
    }

    /** Get the user's subscription tier */
    getTier(): string {
        return this.entitlements?.tier || 'free';
    }

    /**
     * The tier we can name RIGHT NOW, without waiting for the network.
     *
     * `getTier()` answers 'free' before the first fetch resolves, which is
     * indistinguishable from a genuine free account — harmless for logging,
     * wrong for deciding what to paint on a panel's first frame. This returns
     * null when nothing is known yet, so a caller can tell "not loaded yet"
     * apart from "not entitled" and show a checking state instead of guessing.
     *
     * The localStorage copy may be past its TTL; that is deliberate. It is only
     * ever used to pick the first frame, and every caller confirms against
     * `getEntitledPlugins()` immediately after.
     */
    getCachedTier(): string | null {
        return this.entitlements?.tier || this.loadCache()?.tier || null;
    }

    /** Listen for entitlement changes */
    onChange(listener: (e: EntitlementsResponse | null) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    /** Force refresh from server */
    async refresh(): Promise<EntitlementsResponse> {
        this.entitlements = null;
        return this.getEntitledPlugins();
    }

    // --- Internal ---

    /** Store a verdict, persist it (production only), and tell every listener. */
    private adopt(
        response: EntitlementsResponse,
        isDev: boolean,
        localImageEditorReachable: boolean,
        localAiChatReachable: boolean
    ): EntitlementsResponse {
        // A shared fetch resolves the same object for every caller; adopt it once.
        if (this.entitlements === response) return response;
        if (isDev) {
            // Override URLs with local equivalents only when the local
            // server is actually running. Don't persist to localStorage
            // so production-mode cache is never polluted with localhost URLs.
            this.mergeDev(response, localImageEditorReachable, localAiChatReachable);
            this.entitlements = response;
            this.notifyListeners(response);
            return response;
        }
        this.entitlements = response;
        this.persistCache(response);
        this.notifyListeners(response);
        return response;
    }

    /** One server fetch at a time; callers that arrive while one runs share its outcome. */
    private fetchShared(): Promise<EntitlementsResponse> {
        if (this.inflight) return this.inflight;
        const run = this.fetchFromServer();
        this.inflight = run;
        const release = () => { if (this.inflight === run) this.inflight = null; };
        run.then(release, release);
        return run;
    }

    private async fetchFromServer(): Promise<EntitlementsResponse> {
        const { data: { session } } = await this.backend.auth.getSession();

        if (!session) {
            // Not authenticated right now. For a signed-in user this is what getSession()
            // answers when an expiring token could not be refreshed (a transient); for a
            // signed-out one the panel is never mounted. Neither is a free account.
            throw new NoSessionError();
        }

        const { data, error } = await this.backend.functions.invoke('plugin-entitlements', {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        });

        if (error) {
            throw new Error(`Entitlements fetch failed: ${error.message}`);
        }
        if (!data || !Array.isArray(data.plugins) || typeof data.tier !== 'string') {
            throw new Error('Entitlements fetch returned an unexpected payload');
        }

        return {
            plugins: data.plugins,
            tier: data.tier,
            cachedAt: this.now(),
            source: 'server',
            userId: session.user?.id,
        };
    }

    /**
     * Re-check when the account changes underneath us. Registered on first use.
     *
     * Nothing used to listen here, which is why a bad first answer lasted until restart:
     * the session could appear, refresh or change hands and every panel kept whatever the
     * loader said at mount. The callback defers its work with setTimeout because supabase-js
     * runs it while holding the auth lock, and calling back into the client from inside it
     * can deadlock.
     */
    private watchAuth(): void {
        if (this.watchingAuth) return;
        this.watchingAuth = true;
        try {
            this.backend.auth.onAuthStateChange((event, session) => {
                setTimeout(() => this.onAuthChange(event, session), 0);
            });
        } catch (e) {
            console.warn('[PluginLoader] Could not watch auth changes:', e);
        }
    }

    private onAuthChange(event: string, session: { user?: { id: string } } | null): void {
        if (event === 'SIGNED_OUT') {
            this.entitlements = null;
            this.clearCache();
            this.notifyListeners(null);
            return;
        }
        if (!session) return;
        if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED' && event !== 'INITIAL_SESSION' && event !== 'USER_UPDATED') return;

        const current = this.entitlements;
        // The stored verdict belongs to an account. A different account signing in on this
        // machine must not inherit it, not even for the offline grace window.
        const switchedAccount = !!(current?.userId && session.user?.id && current.userId !== session.user.id);
        if (switchedAccount) {
            this.entitlements = null;
            this.clearCache();
        }
        if (!current || switchedAccount || !this.isCacheFresh(current)) {
            void this.getEntitledPlugins().catch((e) => console.warn('[PluginLoader] Re-check after auth change failed:', e));
        }
    }

    /**
     * Quick health-check: can we reach a local dev server?
     * Uses mode:'no-cors' so cross-origin restrictions don't block the probe.
     * Returns true if the server responds within timeoutMs.
     */
    private async probeLocalServer(url: string, timeoutMs = 1500): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            // mode:'no-cors' lets us probe without CORS preflight — we only
            // care whether the server is up, not about the response body.
            await fetch(url, { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
            clearTimeout(timer);
            return true;
        } catch {
            return false;
        }
    }

    private isCacheFresh(cache: EntitlementsResponse): boolean {
        if (!cache.cachedAt) return false;
        return (this.now() - cache.cachedAt) < CACHE_TTL;
    }

    /** Only a verdict straight from the server is written down. */
    private persistCache(data: EntitlementsResponse) {
        if (!isVerdict(data) || data.source !== 'server') return;
        try {
            this.storage?.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (e: any) {
            console.warn('[PluginLoader] Failed to persist cache:', e);
        }
    }

    private loadCache(): EntitlementsResponse | null {
        try {
            const raw = this.storage?.getItem(CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as EntitlementsResponse;
            if (!parsed || parsed.source !== 'server' || !isVerdict(parsed) || !Array.isArray(parsed.plugins)) {
                // Written by a build before 2026-09-15 (no `source`), or not a verdict at all.
                // Such an entry may be the persisted no-session guess — the one that made a
                // paying user's fallback say "free". Drop it rather than serve it.
                this.storage?.removeItem(CACHE_KEY);
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    }

    private clearCache(): void {
        try {
            this.storage?.removeItem(CACHE_KEY);
        } catch { /* nothing to clear */ }
    }

    /**
     * Build the dev fallback entitlements.
     * Both AI Chat and Image Editor dynamically fall back to local dev servers if reachable.
     */
    private getDevFallback(localImageEditorReachable = false, localAiChatReachable = false): EntitlementsResponse {
        return {
            plugins: [
                {
                    id: 'ai-chat',
                    name: 'AI Chat',
                    url: localAiChatReachable ? LOCAL_AI_CHAT_URL : VERCEL_AI_CHAT_URL,
                    version: 'dev',
                },
                {
                    id: 'ai-image-editor',
                    name: 'AI Image Editor',
                    url: localImageEditorReachable ? LOCAL_IMAGE_EDITOR_URL : VERCEL_IMAGE_EDITOR_URL,
                    version: 'dev',
                },
            ],
            tier: 'dev',
            cachedAt: this.now(),
            source: 'dev',
        };
    }

    /**
     * Override plugin URLs with local dev server equivalents when those
     * servers are actually running. If a local server is not reachable the
     * Vercel URL is kept so the panel never shows a blank screen.
     */
    private mergeDev(response: EntitlementsResponse, localImageEditorReachable: boolean, localAiChatReachable: boolean) {
        const devPlugins = this.getDevFallback(localImageEditorReachable, localAiChatReachable).plugins;
        for (const dp of devPlugins) {
            const existing = response.plugins.find(p => p.id === dp.id);
            if (existing) {
                // Override the URL to point at the local dev server
                existing.url = dp.url;
            } else {
                response.plugins.push(dp);
            }
        }
        if (response.tier === 'free' || !response.tier) {
            response.tier = 'dev';
        }
    }

    private notifyListeners(data: EntitlementsResponse | null) {
        for (const listener of this.listeners) {
            try { listener(data); } catch { /* one listener's failure must not stop the others */ }
        }
    }
}
