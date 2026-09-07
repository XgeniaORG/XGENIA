/**
 * ConnectionStore — Encrypted service connection token storage
 *
 * Stores OAuth tokens for external services (Vercel, GitHub, Supabase, fal)
 * using AES-GCM encryption via the Web Crypto API. Tokens are keyed per
 * authenticated user so different accounts stay isolated.
 *
 * Usage:
 *   const store = ConnectionStore.getInstance();
 *   await store.saveConnection({ service: 'vercel', accessToken: '...' });
 *   const conn = await store.getConnection('vercel');
 */

// ─── Types ────────────────────────────────────────────────────────────

export type ServiceName = 'vercel' | 'github' | 'supabase' | 'fal' | 'openrouter';

export interface ServiceConnection {
    service: ServiceName;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;       // Unix timestamp (ms)
    scope?: string;
    serviceUserId?: string;   // The user's ID on the external service
    serviceUsername?: string;  // Display name / username on the service
    connectedAt: number;      // When the connection was established
}

export interface ConnectionStatus {
    service: ServiceName;
    connected: boolean;
    expired: boolean;
    serviceUsername?: string;
    connectedAt?: number;
    expiresAt?: number;
}

// ─── Constants ────────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'xgenia-service-connections';
const ENCRYPTION_KEY_NAME = 'xgenia-conn-key';

// Service metadata for UI display
export const SERVICE_METADATA: Record<ServiceName, {
    displayName: string;
    description: string;
    icon: string;          // Hugeicon name
    oauthSupported: boolean;
    requiredFor: string[];
}> = {
    vercel: {
        displayName: 'Vercel',
        description: 'Deploy your projects to the web',
        icon: 'cloud-upload',
        oauthSupported: true,
        requiredFor: ['deploy'],
    },
    github: {
        displayName: 'GitHub',
        description: 'Source code hosting for deployments',
        icon: 'github',
        oauthSupported: true,
        requiredFor: ['deploy'],
    },
    supabase: {
        displayName: 'Supabase',
        description: 'Backend database & edge functions',
        icon: 'database',
        oauthSupported: true,
        requiredFor: ['backend'],
    },
    fal: {
        displayName: 'fal.ai',
        description: 'AI image & video generation',
        icon: 'artificial-intelligence-04',
        oauthSupported: false, // API key only
        requiredFor: ['ai-generation'],
    },
    openrouter: {
        displayName: 'OpenRouter',
        description: 'AI model gateway for chat & code generation',
        icon: 'artificial-intelligence-06',
        oauthSupported: true, // PKCE-based flow
        requiredFor: ['ai-chat'],
    },
};

/**
 * Services that are treated as connected by default ("connected in the
 * background") without the user running the OAuth flow. The publish/deploy UI
 * hides their connection cards. An explicit stored connection (if the user ever
 * connects manually) always takes precedence over the default.
 */
export const DEFAULT_CONNECTED_SERVICES: ServiceName[] = ['vercel', 'github'];

/**
 * Resolve the access token for a default-connected service. Two sources, in order:
 *   1. window.__XGENIA_DEFAULT_TOKENS__ — the shared team tokens, fetched at editor
 *      startup from the RGS database via the get_deploy_tokens RPC (see
 *      utils/rgs/deployTokens.ts). This is the primary source and is what lets every
 *      collaborator publish out of the box without connecting their own accounts.
 *      The tokens live server-side as data, so they rotate with a single UPDATE and
 *      are never committed to git (committing them tripped GitHub push protection and
 *      got the secret auto-revoked — which is why this indirection exists).
 *   2. Build-time tokens from a git-ignored .env.local, injected via webpack
 *      DefinePlugin (XGENIA_VERCEL_TOKEN / XGENIA_GITHUB_TOKEN). A local-only
 *      fallback for maintainer builds; empty when absent.
 *
 * Deliberately NO hardcoded/committed tokens here.
 */
const BUILD_TIME_DEFAULT_TOKENS: Partial<Record<ServiceName, string>> = {
    vercel: process.env.XGENIA_VERCEL_TOKEN || '',
    github: process.env.XGENIA_GITHUB_TOKEN || '',
};

function getInjectedDefaultToken(service: ServiceName): string {
    // 1. Runtime tokens fetched from the RGS DB at startup take precedence.
    try {
        const injected = (globalThis as any).__XGENIA_DEFAULT_TOKENS__;
        const token = injected?.[service];
        if (typeof token === 'string' && token) return token;
    } catch {
        // ignore
    }

    // 2. Build-time token from .env.local (maintainer local builds only).
    return BUILD_TIME_DEFAULT_TOKENS[service] || '';
}

/** Build a synthetic "connected by default" connection for a background service. */
function buildDefaultConnection(service: ServiceName): ServiceConnection {
    return {
        service,
        accessToken: getInjectedDefaultToken(service),
        connectedAt: 0, // 0 marks an auto/default connection (no real OAuth handshake)
    };
}

// ─── Encryption Helpers ───────────────────────────────────────────────

async function getOrCreateEncryptionKey(): Promise<CryptoKey> {
    // Try to load existing key from IndexedDB
    try {
        const existingKey = await loadKeyFromIDB();
        if (existingKey) return existingKey;
    } catch (e: any) {
        console.warn('[ConnectionStore] Could not load encryption key, generating new one');
    }

    // Generate a new AES-GCM key
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable so we can persist it
        ['encrypt', 'decrypt']
    );

    // Persist to IndexedDB
    await saveKeyToIDB(key);
    return key;
}

function openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('xgenia-crypto', 1);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('keys');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveKeyToIDB(key: CryptoKey): Promise<void> {
    const db = await openIDB();
    const exported = await crypto.subtle.exportKey('jwk', key);
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put(exported, ENCRYPTION_KEY_NAME);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadKeyFromIDB(): Promise<CryptoKey | null> {
    const db = await openIDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('keys', 'readonly');
        const request = tx.objectStore('keys').get(ENCRYPTION_KEY_NAME);
        request.onsuccess = async () => {
            if (!request.result) {
                resolve(null);
                return;
            }
            try {
                const key = await crypto.subtle.importKey(
                    'jwk',
                    request.result,
                    { name: 'AES-GCM', length: 256 },
                    true,
                    ['encrypt', 'decrypt']
                );
                resolve(key);
            } catch (e: any) {
                resolve(null);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

async function encrypt(data: string, key: CryptoKey): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(data);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoded
    );
    // Combine IV + ciphertext and encode as base64
    const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    return btoa(String.fromCharCode(...combined));
}

async function decrypt(data: string, key: CryptoKey): Promise<string> {
    const combined = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext
    );
    return new TextDecoder().decode(decrypted);
}

// ─── ConnectionStore ──────────────────────────────────────────────────

type ChangeListener = (connections: ConnectionStatus[]) => void;

export class ConnectionStore {
    private static instance: ConnectionStore | null = null;
    private encryptionKey: CryptoKey | null = null;
    private cache: Map<ServiceName, ServiceConnection> = new Map();
    private listeners: Set<ChangeListener> = new Set();
    private initialized = false;

    private constructor() { }

    static getInstance(): ConnectionStore {
        if (!ConnectionStore.instance) {
            ConnectionStore.instance = new ConnectionStore();
        }
        return ConnectionStore.instance;
    }

    /** Initialize the store — must be called before any read/write */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        try {
            this.encryptionKey = await getOrCreateEncryptionKey();
            await this.loadAll();
            this.initialized = true;
            console.log('[ConnectionStore] Initialized with', this.cache.size, 'connections');
        } catch (error: any) {
            console.error('[ConnectionStore] Initialization failed:', error);
            // Fallback: work without encryption (tokens in plaintext localStorage)
            this.encryptionKey = null;
            await this.loadAll();
            this.initialized = true;
            console.warn('[ConnectionStore] Running in unencrypted fallback mode');
        }
    }

    /** Get the current user ID for scoping storage */
    private getUserId(): string {
        try {
            const supabase = (window as any).supabase;
            if (supabase?.auth) {
                // Synchronous check — getSession is cached
                const sessionData = JSON.parse(
                    localStorage.getItem('sb-pcrghrjikkcmelflwiys-auth-token') || '{}'
                );
                return sessionData?.user?.id || 'anonymous';
            }
        } catch (e: any) {
            // Ignore
        }
        return 'anonymous';
    }

    private getStorageKey(): string {
        return `${STORAGE_KEY_PREFIX}-${this.getUserId()}`;
    }

    /** Load all connections from localStorage */
    private async loadAll(): Promise<void> {
        try {
            const raw = localStorage.getItem(this.getStorageKey());
            if (!raw) return;

            let data: Record<string, ServiceConnection>;
            if (this.encryptionKey) {
                const decrypted = await decrypt(raw, this.encryptionKey);
                data = JSON.parse(decrypted);
            } else {
                data = JSON.parse(raw);
            }

            this.cache.clear();
            for (const [key, conn] of Object.entries(data)) {
                this.cache.set(key as ServiceName, conn);
            }
        } catch (error: any) {
            console.error('[ConnectionStore] Failed to load connections:', error);
            this.cache.clear();
        }
    }

    /** Persist all connections to localStorage */
    private async saveAll(): Promise<void> {
        try {
            const data: Record<string, ServiceConnection> = {};
            for (const [key, conn] of this.cache.entries()) {
                data[key] = conn;
            }

            const serialized = JSON.stringify(data);
            if (this.encryptionKey) {
                const encrypted = await encrypt(serialized, this.encryptionKey);
                localStorage.setItem(this.getStorageKey(), encrypted);
            } else {
                localStorage.setItem(this.getStorageKey(), serialized);
            }
        } catch (error: any) {
            console.error('[ConnectionStore] Failed to save connections:', error);
        }
    }

    // ─── Public API ───────────────────────────────────────────────────

    /** Save or update a service connection */
    async saveConnection(conn: ServiceConnection): Promise<void> {
        await this.initialize();
        this.cache.set(conn.service, conn);
        await this.saveAll();
        this.notifyListeners();
        console.log(`[ConnectionStore] Saved connection for ${conn.service}`);
    }

    /** Get a service connection (null if not connected or expired) */
    async getConnection(service: ServiceName): Promise<ServiceConnection | null> {
        await this.initialize();
        const conn = this.cache.get(service);
        if (!conn) {
            // Auto-connect default services in the background (no OAuth required).
            if (DEFAULT_CONNECTED_SERVICES.includes(service)) {
                return buildDefaultConnection(service);
            }
            return null;
        }

        // Check expiry
        if (conn.expiresAt && conn.expiresAt < Date.now()) {
            console.log(`[ConnectionStore] Token for ${service} has expired`);
            return null;
        }

        return conn;
    }

    /** Get the access token for a service (convenience method) */
    async getToken(service: ServiceName): Promise<string | null> {
        const conn = await this.getConnection(service);
        return conn?.accessToken || null;
    }

    /** Check if a service is connected and token is valid */
    async isConnected(service: ServiceName): Promise<boolean> {
        const conn = await this.getConnection(service);
        return conn !== null;
    }

    /** Remove a service connection */
    async removeConnection(service: ServiceName): Promise<void> {
        await this.initialize();
        this.cache.delete(service);
        await this.saveAll();
        this.notifyListeners();
        console.log(`[ConnectionStore] Removed connection for ${service}`);
    }

    /** Get status of all services */
    async getAllStatuses(): Promise<ConnectionStatus[]> {
        await this.initialize();
        const services: ServiceName[] = ['vercel', 'github', 'supabase', 'fal', 'openrouter'];
        return services.map(service => {
            // Fall back to the default-connected state for background services.
            const conn = this.cache.get(service)
                ?? (DEFAULT_CONNECTED_SERVICES.includes(service)
                    ? buildDefaultConnection(service)
                    : undefined);
            const expired = conn?.expiresAt ? conn.expiresAt < Date.now() : false;
            return {
                service,
                connected: !!conn && !expired,
                expired,
                serviceUsername: conn?.serviceUsername,
                connectedAt: conn?.connectedAt,
                expiresAt: conn?.expiresAt,
            };
        });
    }

    /** Check if all required services for deployment are connected */
    async isReadyToDeploy(): Promise<{ ready: boolean; missing: ServiceName[] }> {
        const missing: ServiceName[] = [];
        for (const service of ['vercel', 'github'] as ServiceName[]) {
            if (!(await this.isConnected(service))) {
                missing.push(service);
            }
        }
        return { ready: missing.length === 0, missing };
    }

    // ─── Listener Pattern ────────────────────────────────────────────

    onChange(listener: ChangeListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notifyListeners(): void {
        this.getAllStatuses().then(statuses => {
            for (const listener of this.listeners) {
                try {
                    listener(statuses);
                } catch (e: any) {
                    console.error('[ConnectionStore] Listener error:', e);
                }
            }
        });
    }
}

// Export singleton for convenience
export const connectionStore = ConnectionStore.getInstance();
