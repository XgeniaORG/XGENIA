/**
 * PluginLoader — Fetches plugin entitlements from XGENIA's server.
 *
 * Flow:
 * 1. Editor authenticates → gets Supabase session
 * 2. PluginLoader calls the plugin-entitlements edge function
 * 3. Server checks subscription_status → returns plugin URLs
 * 4. Editor loads each plugin into its iframe from the server-provided URL
 *
 * Caches results in localStorage for offline grace period.
 */

import { supabase } from '../../../supabaseInit';

export interface PluginEntitlement {
    id: string;
    name: string;
    description?: string;
    url: string;
    version: string;
}

export interface EntitlementsResponse {
    plugins: PluginEntitlement[];
    tier: string;
    cachedAt?: number;
}

const CACHE_KEY = 'xgenia_plugin_entitlements';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/** URL of the local image editor Vite dev server */
const LOCAL_IMAGE_EDITOR_URL = 'http://localhost:3002';
/** Fallback Vercel deployment (used when local server is not running) */
const VERCEL_IMAGE_EDITOR_URL = 'https://xgenia-image-editor-plugin.vercel.app';

/** URL of the local AI chat Vite dev server */
const LOCAL_AI_CHAT_URL = 'http://localhost:3010';
/** Fallback Vercel deployment */
const VERCEL_AI_CHAT_URL = 'https://xgenia-ai-app-xgenia.vercel.app';

export class PluginLoader {
    private static instance_: PluginLoader;
    private entitlements: EntitlementsResponse | null = null;
    private loading = false;
    private listeners: Array<(e: EntitlementsResponse | null) => void> = [];

    static get instance(): PluginLoader {
        if (!PluginLoader.instance_) {
            PluginLoader.instance_ = new PluginLoader();
        }
        return PluginLoader.instance_;
    }

    /**
     * Fetch entitled plugins from the server.
     * Returns cached data if within TTL. Falls back to localStorage cache offline.
     *
     * In dev mode (editor running on localhost / electron file:// protocol):
     *   - Probes localhost:3002. If reachable → loads local image editor (HMR).
     *   - If localhost:3002 is NOT reachable → falls back to Vercel (no blank screen).
     */

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

    async getEntitledPlugins(): Promise<EntitlementsResponse> {
        const isDev = PluginLoader.isDevEnvironment();

        // In dev mode skip the in-memory cache so we re-probe localhost on
        // every call (the local server may have started since the last check).
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
        const localAiChatReachable = false;

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

        // Try fetching from server
        if (navigator.onLine) {
            try {
                this.loading = true;
                const response = await Promise.race([
                    this.fetchFromServer(),
                    new Promise<never>((_, reject) =>
                        setTimeout(() => reject(new Error('Entitlements fetch timed out after 5s')), 5000)
                    ),
                ]);
                if (isDev) {
                    // Override URLs with local equivalents only when the local
                    // server is actually running. Don't persist to localStorage
                    // so production-mode cache is never polluted with localhost URLs.
                    this.mergeDev(response, localImageEditorReachable, localAiChatReachable);
                    this.entitlements = response;
                    this.loading = false;
                    this.notifyListeners(response);
                    return response;
                }
                this.entitlements = response;
                this.persistCache(response);
                this.loading = false;
                this.notifyListeners(response);
                return response;
            } catch (err: any) {
                console.warn('[PluginLoader] Failed to fetch entitlements from server:', err);
                this.loading = false;
            }
        }

        // Fall back to localStorage cache
        const cached = this.loadCache();
        if (cached) {
            console.log('[PluginLoader] Using cached entitlements (offline or server error)');
            if (isDev) this.mergeDev(cached, localImageEditorReachable, localAiChatReachable);
            this.entitlements = cached;
            return cached;
        }

        // No entitlements available — use dev defaults
        console.log('[PluginLoader] No entitlements available, using dev defaults');
        const devFallback = this.getDevFallback(localImageEditorReachable, localAiChatReachable);
        this.entitlements = devFallback;
        return devFallback;
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

    private async fetchFromServer(): Promise<EntitlementsResponse> {
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
            // Not authenticated — return empty entitlements
            return { plugins: [], tier: 'free', cachedAt: Date.now() };
        }

        const { data, error } = await supabase.functions.invoke('plugin-entitlements', {
            headers: {
                Authorization: `Bearer ${session.access_token}`,
            },
        });

        if (error) {
            throw new Error(`Entitlements fetch failed: ${error.message}`);
        }

        return {
            ...data,
            cachedAt: Date.now(),
        };
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
        return (Date.now() - cache.cachedAt) < CACHE_TTL;
    }

    private persistCache(data: EntitlementsResponse) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch (e: any) {
            console.warn('[PluginLoader] Failed to persist cache:', e);
        }
    }

    private loadCache(): EntitlementsResponse | null {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) return null;
            return JSON.parse(raw) as EntitlementsResponse;
        } catch {
            return null;
        }
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
            cachedAt: Date.now(),
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
            try { listener(data); } catch { }
        }
    }
}
