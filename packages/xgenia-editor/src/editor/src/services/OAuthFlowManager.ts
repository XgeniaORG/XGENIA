/**
 * OAuthFlowManager — OAuth2 Authorization Code + PKCE flow manager
 *
 * Handles OAuth flows for Vercel, GitHub, Supabase, and OpenRouter.
 * Leverages `window.mcpAPI.startOAuthServer()` for the callback server
 * (running locally in Electron) to receive auth codes.
 *
 * For fal.ai: no OAuth — uses a simple API key save to ConnectionStore.
 *
 * Usage:
 *   const manager = OAuthFlowManager.getInstance();
 *   await manager.startOAuthFlow('vercel');  // Opens browser
 *   // ... callback arrives automatically, token stored
 */

import { ConnectionStore, ServiceConnection, ServiceName } from './ConnectionStore';

// ─── Types ────────────────────────────────────────────────────────────

interface OAuthServiceConfig {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string[];
    /** Whether to use PKCE (recommended for public clients) */
    usePKCE: boolean;
    /** Vercel-specific: requires team selection */
    supportsTeamSelection?: boolean;
}

interface OAuthState {
    service: ServiceName;
    state: string;
    codeVerifier?: string;
    callbackUrl: string;
    startedAt: number;
}

// ─── Service Configs ──────────────────────────────────────────────────

/**
 * OAuth client IDs — these should come from environment or Supabase config.
 * For now they're placeholders that need to be set after OAuth app registration.
 *
 * SETUP:
 * 1. Register an OAuth app on each service
 * 2. Set the client IDs below (or load from a config endpoint)
 * 3. Client secrets stay server-side (or use PKCE for public clients)
 */
const OAUTH_CONFIGS: Partial<Record<ServiceName, OAuthServiceConfig>> = {
    vercel: {
        authorizationUrl: 'https://vercel.com/integrations/new',
        tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
        clientId: 'oac_ZfXYbz4d4dvh1fAE24lzffL4',
        clientSecret: '1vt3XULx2Yi0NbMpX092UR02',
        scopes: [],
        usePKCE: false,
        supportsTeamSelection: true,
    },
    github: {
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        clientId: 'Ov23cthJ8O6QqWISXYZH',
        clientSecret: '864bed96fcb5e86edb0c835015ccc79b6beccba9',
        scopes: ['repo', 'read:user'],
        usePKCE: false,
    },
    supabase: {
        authorizationUrl: 'https://api.supabase.com/v1/oauth/authorize',
        tokenUrl: 'https://api.supabase.com/v1/oauth/token',
        clientId: '3eeca3ca-dc8e-4992-aa37-881f01ad7279',
        clientSecret: '',
        scopes: ['all'],
        usePKCE: true,
    },
    openrouter: {
        authorizationUrl: 'https://openrouter.ai/auth',
        tokenUrl: 'https://openrouter.ai/api/v1/auth/keys',
        clientId: 'xgenia', // Not used in the standard sense — OR uses callback_url
        clientSecret: '',
        scopes: [],
        usePKCE: true,
    },
};

// ─── PKCE Helpers ─────────────────────────────────────────────────────

function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(36).padStart(2, '0')).join('').substring(0, length);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// ─── OAuthFlowManager ────────────────────────────────────────────────

export class OAuthFlowManager {
    private static instance: OAuthFlowManager | null = null;
    private pendingFlows: Map<string, OAuthState> = new Map();
    private connectionStore: ConnectionStore;

    private constructor() {
        this.connectionStore = ConnectionStore.getInstance();
    }

    static getInstance(): OAuthFlowManager {
        if (!OAuthFlowManager.instance) {
            OAuthFlowManager.instance = new OAuthFlowManager();
        }
        return OAuthFlowManager.instance;
    }

    // ─── Configuration ─────────────────────────────────────────────────

    /** Set OAuth client ID for a service (call during app initialization) */
    setClientId(service: ServiceName, clientId: string): void {
        const config = OAUTH_CONFIGS[service];
        if (config) {
            config.clientId = clientId;
            console.log(`[OAuthFlowManager] Client ID set for ${service}`);
        }
    }

    /** Check if a service has OAuth configured */
    isOAuthConfigured(service: ServiceName): boolean {
        if (service === 'fal') return false; // fal uses API key
        const config = OAUTH_CONFIGS[service];
        return !!config && !!config.clientId;
    }

    // ─── OAuth Flow ────────────────────────────────────────────────────

    /**
     * Start the OAuth flow for a service.
     * Opens the authorization URL in an external browser window.
     * Returns a promise that resolves when the user completes auth.
     */
    async startOAuthFlow(service: ServiceName): Promise<{
        success: boolean;
        message: string;
        connection?: ServiceConnection;
    }> {
        if (service === 'fal') {
            return {
                success: false,
                message: 'fal.ai uses API key authentication, not OAuth. Use saveApiKey() instead.',
            };
        }

        // OpenRouter doesn't need a clientId check—it uses a callback_url flow
        const config = OAUTH_CONFIGS[service];
        if (!config) {
            return { success: false, message: `No OAuth config for ${service}` };
        }

        if (service !== 'openrouter' && !config.clientId) {
            return {
                success: false,
                message: `OAuth not configured for ${service}. Please register an OAuth app and set the client ID.`,
            };
        }

        try {
            // Start the local callback server via MCP API
            let callbackUrl: string;
            if (window.mcpAPI?.startOAuthServer) {
                const result = await window.mcpAPI.startOAuthServer();
                callbackUrl = result.callbackUrl;
            } else {
                // Fallback: use a localhost URL (user will need to paste the code)
                callbackUrl = 'http://localhost:3000/oauth/callback';
            }

            // Generate state for CSRF protection
            const state = generateRandomString(32);

            // Generate PKCE if supported
            let codeVerifier: string | undefined;
            let codeChallenge: string | undefined;
            if (config.usePKCE) {
                codeVerifier = generateRandomString(64);
                codeChallenge = await generateCodeChallenge(codeVerifier);
            }

            // Track this pending flow
            const oauthState: OAuthState = {
                service,
                state,
                codeVerifier,
                callbackUrl,
                startedAt: Date.now(),
            };
            this.pendingFlows.set(state, oauthState);

            // Build the authorization URL
            let authUrl: string;

            if (service === 'openrouter') {
                // OpenRouter uses a simpler auth URL: callback_url + code_challenge
                const orParams = new URLSearchParams({
                    callback_url: callbackUrl,
                });
                if (codeChallenge) {
                    orParams.set('code_challenge', codeChallenge);
                    orParams.set('code_challenge_method', 'S256');
                }
                authUrl = `${config.authorizationUrl}?${orParams.toString()}`;
            } else {
                // Standard OAuth2 URL
                const params = new URLSearchParams({
                    client_id: config.clientId,
                    redirect_uri: callbackUrl,
                    state,
                    response_type: 'code',
                });

                if (config.scopes.length > 0) {
                    params.set('scope', config.scopes.join(' '));
                }

                if (codeChallenge) {
                    params.set('code_challenge', codeChallenge);
                    params.set('code_challenge_method', 'S256');
                }

                authUrl = `${config.authorizationUrl}?${params.toString()}`;
            }

            // Open in external browser
            console.log(`[OAuthFlowManager] Opening OAuth URL for ${service}:`, authUrl);
            window.open(authUrl, '_blank');

            // Wait for the callback
            return await this.waitForCallback(state, service);
        } catch (error: any) {
            console.error(`[OAuthFlowManager] OAuth flow error for ${service}:`, error);
            return { success: false, message: `OAuth flow failed: ${error.message}` };
        }
    }

    /**
     * Handle the OAuth callback (called when the callback server receives the code).
     * This can be called from useMCPServerBrowser or from a custom callback handler.
     */
    async handleCallback(code: string, state: string): Promise<{
        success: boolean;
        message: string;
        connection?: ServiceConnection;
    }> {
        const pendingFlow = this.pendingFlows.get(state);
        if (!pendingFlow) {
            return { success: false, message: 'Invalid or expired OAuth state' };
        }

        this.pendingFlows.delete(state);

        const config = OAUTH_CONFIGS[pendingFlow.service];
        if (!config) {
            return { success: false, message: `No config for ${pendingFlow.service}` };
        }

        try {
            let connection: ServiceConnection;

            if (pendingFlow.service === 'openrouter') {
                // OpenRouter special path: exchange code for an API key
                const body: Record<string, string> = { code };
                if (pendingFlow.codeVerifier) {
                    body.code_verifier = pendingFlow.codeVerifier;
                    body.code_challenge_method = 'S256';
                }

                const response = await fetch(config.tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`OpenRouter key exchange failed (${response.status}): ${errorText}`);
                }

                const { key } = await response.json();
                if (!key) throw new Error('No API key returned from OpenRouter');

                connection = {
                    service: 'openrouter',
                    accessToken: key,
                    connectedAt: Date.now(),
                };

                // Sync to AIProviderSettingsManager so ChatPanel picks it up
                try {
                    const { AIProviderSettingsManager } = await import('@xgenia-ai/ChatPanel/AIProviderSettings');
                    AIProviderSettingsManager.setProviderApiKey('openrouter', key);
                    console.log('[OAuthFlowManager] OpenRouter key synced to AIProviderSettingsManager');
                } catch (e: any) {
                    console.warn('[OAuthFlowManager] Could not sync key to AIProviderSettings:', e);
                }
            } else {
                // Standard OAuth2 token exchange
                const tokenParams: Record<string, string> = {
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: pendingFlow.callbackUrl,
                    client_id: config.clientId,
                    client_secret: config.clientSecret,
                };

                if (pendingFlow.codeVerifier) {
                    tokenParams.code_verifier = pendingFlow.codeVerifier;
                }

                const response = await fetch(config.tokenUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Accept': 'application/json',
                    },
                    body: new URLSearchParams(tokenParams).toString(),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Token exchange failed (${response.status}): ${errorText}`);
                }

                const tokenData = await response.json();

                connection = {
                    service: pendingFlow.service,
                    accessToken: tokenData.access_token,
                    refreshToken: tokenData.refresh_token,
                    expiresAt: tokenData.expires_in
                        ? Date.now() + (tokenData.expires_in * 1000)
                        : undefined,
                    scope: tokenData.scope,
                    serviceUserId: tokenData.user_id || tokenData.team_id,
                    connectedAt: Date.now(),
                };

                // Fetch user info to get the username
                const userInfo = await this.fetchUserInfo(pendingFlow.service, connection.accessToken);
                if (userInfo) {
                    connection.serviceUsername = userInfo.username;
                    connection.serviceUserId = connection.serviceUserId || userInfo.userId;
                }
            }

            // Save to ConnectionStore
            await this.connectionStore.saveConnection(connection);

            return {
                success: true,
                message: `Successfully connected to ${pendingFlow.service}`,
                connection,
            };
        } catch (error: any) {
            console.error(`[OAuthFlowManager] Token exchange error:`, error);
            return { success: false, message: `Token exchange failed: ${error.message}` };
        }
    }

    /** Save an API key for services that don't support OAuth (e.g. fal) */
    async saveApiKey(service: ServiceName, apiKey: string): Promise<void> {
        const connection: ServiceConnection = {
            service,
            accessToken: apiKey,
            connectedAt: Date.now(),
        };
        await this.connectionStore.saveConnection(connection);
        console.log(`[OAuthFlowManager] API key saved for ${service}`);
    }

    /** Disconnect a service */
    async disconnect(service: ServiceName): Promise<void> {
        await this.connectionStore.removeConnection(service);
        console.log(`[OAuthFlowManager] Disconnected ${service}`);
    }

    // ─── Private Helpers ───────────────────────────────────────────────

    /** Wait for the OAuth callback to arrive */
    private waitForCallback(state: string, service: ServiceName): Promise<{
        success: boolean;
        message: string;
        connection?: ServiceConnection;
    }> {
        return new Promise((resolve) => {
            const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
            const POLL_INTERVAL_MS = 1000;

            const startTime = Date.now();

            // Listen for OAuth callback from preload.js IPC bridge
            // (preload forwards 'oauth-callback' IPC → window.__oauthCallbackHandler)
            const originalHandler = (window as any).__oauthCallbackHandler;
            (window as any).__oauthCallbackHandler = async (callbackData: any) => {
                console.log('[OAuthFlowManager] __oauthCallbackHandler invoked with:', JSON.stringify(callbackData));
                // Handle error responses
                if (callbackData.error) {
                    (window as any).__oauthCallbackHandler = originalHandler;
                    clearInterval(pollInterval);
                    this.pendingFlows.delete(state);
                    resolve({
                        success: false,
                        message: callbackData.error_description || callbackData.error || 'OAuth flow failed',
                    });
                    return;
                }
                // Handle success — accept any callback with a code
                // (OpenRouter doesn't use a traditional state parameter)
                if (callbackData.code) {
                    console.log('[OAuthFlowManager] Exchanging code for API key...');
                    (window as any).__oauthCallbackHandler = originalHandler;
                    clearInterval(pollInterval);
                    const result = await this.handleCallback(
                        callbackData.code,
                        callbackData.state || state
                    );
                    console.log('[OAuthFlowManager] handleCallback result:', JSON.stringify(result));
                    resolve(result);
                }
            };

            // Also poll the pending flows to see if callback was handled externally
            const pollInterval = setInterval(async () => {
                // Check if flow was already completed (callback handler resolved it)
                if (!this.pendingFlows.has(state)) {
                    clearInterval(pollInterval);
                    // Check if the connection was saved
                    const connected = await this.connectionStore.isConnected(service);
                    if (connected) {
                        const conn = await this.connectionStore.getConnection(service);
                        resolve({
                            success: true,
                            message: `Connected to ${service}`,
                            connection: conn || undefined,
                        });
                    }
                    return;
                }

                // Check timeout
                if (Date.now() - startTime > TIMEOUT_MS) {
                    clearInterval(pollInterval);
                    this.pendingFlows.delete(state);
                    resolve({
                        success: false,
                        message: `OAuth flow timed out for ${service}. Please try again.`,
                    });
                }
            }, POLL_INTERVAL_MS);
        });
    }

    /** Fetch user info after OAuth to get username/display name */
    private async fetchUserInfo(
        service: ServiceName,
        token: string
    ): Promise<{ username: string; userId: string } | null> {
        try {
            switch (service) {
                case 'vercel': {
                    const res = await fetch('https://api.vercel.com/v2/user', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const data = await res.json();
                        return {
                            username: data.user?.username || data.user?.name || 'Unknown',
                            userId: data.user?.uid || '',
                        };
                    }
                    break;
                }
                case 'github': {
                    const res = await fetch('https://api.github.com/user', {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (res.ok) {
                        const data = await res.json();
                        return {
                            username: data.login || data.name || 'Unknown',
                            userId: String(data.id || ''),
                        };
                    }
                    break;
                }
                case 'supabase': {
                    // Supabase Management API doesn't have a /me endpoint
                    // but the token grants are sufficient
                    return null;
                }
                default:
                    return null;
            }
        } catch (error: any) {
            console.warn(`[OAuthFlowManager] Could not fetch user info for ${service}:`, error);
        }
        return null;
    }
}

// Export singleton for convenience
export const oauthFlowManager = OAuthFlowManager.getInstance();
