/**
 * AiProviderKeyVault — the OpenRouter key follows the Primora account.
 *
 * ─── WHY THIS EXISTS (2026-08-28, user report) ───────────────────────────────
 *
 *   "I manually restarted the entire app again, and once again received a
 *    pop-up asking me to enter the OpenRouter API key. After restarting the app
 *    one more time, the pop-up disappeared and the app worked normally."
 *
 * The key lived in ONE place: this machine's editorSettings.json, read by the AI
 * Chat panel across an async postMessage bridge. Two consequences, both of them
 * the report above:
 *
 *   1. A cold boot that lost the race read "no key" and raised "XGENIA AI Setup
 *      Required" for someone who had a perfectly good key on disk. Restarting
 *      re-rolled the race, which is why the third launch "worked normally".
 *   2. A second machine, a reinstall, or a cleared profile lost the key for
 *      good, and the user had to go and find it again.
 *
 * So the key now belongs to the ACCOUNT (public.user_ai_provider_keys in the
 * Primora project the editor already logs into). This service is the two-way
 * sync: pull on login and pre-fill the panel, push whenever the key changes
 * locally, and clear the local copy on sign-out so the next person to use this
 * machine does not inherit it.
 *
 * ─── WHY THE EDITOR AND NOT THE AI PANEL ─────────────────────────────────────
 *
 * The panel is an iframe served from Vercel, so panel-side changes only reach
 * users after a redeploy of `private/xgenia-ai-app`, and it has no Supabase
 * session of its own. The editor owns the session and owns EditorSettings,
 * which the panel already reads through the settings bridge. Seeding the
 * setting here means the panel is pre-filled with no panel change at all.
 *
 * ─── WHY IT IS NOT AIProviderSettingsManager ─────────────────────────────────
 *
 * That manager reads through `SettingsBridge`, whose editor-side fallbacks are
 * `window.EditorSettings` (never set) and `EditorProxy` (iframe only) — so in
 * the editor renderer it resolves to the MEMORY store and its writes are
 * discarded on reload. Anything the editor wants to persist must go to
 * EditorSettings.instance directly, which is what this file does.
 */

import { supabase } from '../supabaseInit';
import { EditorSettings } from '../utils/editorsettings';
import {
    isLocalKeyUsableBy,
    keyHint,
    reconcileOpenRouterKey,
    shouldClearLocalKeyOnSignOut,
    type LocalKeySnapshot,
    type RemoteKeySnapshot,
} from './AiProviderKeyReconcile';

const SETTINGS_KEY = 'aiProvider';
const PROVIDER = 'openrouter';
const TABLE = 'user_ai_provider_keys';

/** Local writes are debounced: the settings panel fires `updated` on every keystroke-adjacent save. */
const PUSH_DEBOUNCE_MS = 1500;

export interface SetKeyOptions {
    /** True only when OpenRouter's key-scoped endpoint accepted it. Never inferred. */
    verified?: boolean;
}

class AiProviderKeyVaultImpl {
    private started = false;
    private userId: string | null = null;
    /** The key we know the account holds. Gates the sign-out wipe — see shouldClearLocalKeyOnSignOut. */
    private syncedKey: string | null = null;
    /** The `verified` flag the account holds for syncedKey, so a local verification is uploaded once. */
    private syncedVerified = false;
    /** Set while we are writing the setting ourselves, so our own write does not bounce back as a push. */
    private applyingRemote = false;
    private pushTimer: ReturnType<typeof setTimeout> | null = null;
    private pulling: Promise<void> | null = null;
    private pullingUserId: string | null = null;

    // ── Local settings I/O ───────────────────────────────────────────────────

    /**
     * Read the OpenRouter slice of `aiProvider`.
     *
     * Returns null when the setting has never been written, which is different
     * from "the key is empty" and is why callers must not treat a missing
     * setting as an empty key.
     */
    readLocal(): LocalKeySnapshot | null {
        try {
            const stored: any = EditorSettings.instance?.get?.(SETTINGS_KEY);
            const or = stored?.providers?.[PROVIDER];
            if (!or) return null;
            return {
                apiKey: typeof or.apiKey === 'string' ? or.apiKey : '',
                verified: !!or.verified,
                keyUpdatedAt: typeof or.keyUpdatedAt === 'number' ? or.keyUpdatedAt : undefined,
                keyOwnerId: typeof or.keyOwnerId === 'string' && or.keyOwnerId ? or.keyOwnerId : undefined,
            };
        } catch (e: any) {
            console.warn('[AiProviderKeyVault] Could not read aiProvider settings:', e?.message || e);
            return null;
        }
    }

    /**
     * Patch the OpenRouter slice in place.
     *
     * EditorSettings.set REPLACES the whole `aiProvider` object, so this is a
     * read-modify-write: model, visionModel, uiModel, nitro, topP/topK,
     * customHeaders and `_modelDefaultsVersion` all have to survive, or every
     * sync would silently reset the user's model choices.
     */
    private writeLocal(patch: Record<string, any>): void {
        try {
            const stored: any = EditorSettings.instance?.get?.(SETTINGS_KEY) || {};
            const next = {
                ...stored,
                selectedProvider: stored.selectedProvider || PROVIDER,
                providers: {
                    ...(stored.providers || {}),
                    [PROVIDER]: { ...(stored.providers?.[PROVIDER] || {}), ...patch },
                },
            };
            this.applyingRemote = true;
            EditorSettings.instance.set(SETTINGS_KEY, next);
            // Release on the next macrotask: EditorSettings notifies listeners
            // synchronously, so the flag only has to outlive this call stack.
            setTimeout(() => { this.applyingRemote = false; }, 0);
        } catch (e: any) {
            this.applyingRemote = false;
            console.warn('[AiProviderKeyVault] Could not write aiProvider settings:', e?.message || e);
        }
    }

    // ── Remote I/O ───────────────────────────────────────────────────────────

    private async fetchRemote(userId: string): Promise<RemoteKeySnapshot | null> {
        const { data, error } = await supabase
            .from(TABLE)
            .select('api_key, verified, updated_at')
            .eq('user_id', userId)
            .eq('provider', PROVIDER)
            .maybeSingle();

        if (error) {
            // PGRST205 = table missing from the schema cache: the migration has
            // not been applied to this project yet. Say so once, plainly, rather
            // than letting it read as an auth problem.
            const code = (error as any)?.code;
            if (code === 'PGRST205' || code === '42P01') {
                console.warn(
                    `[AiProviderKeyVault] public.${TABLE} does not exist on this Supabase project — `
                    + 'account-bound OpenRouter keys are inactive until the migration is applied. '
                    + 'The local key still works.',
                );
            } else {
                console.warn('[AiProviderKeyVault] Could not read the stored key:', error.message);
            }
            return null;
        }
        if (!data?.api_key) return null;
        return {
            apiKey: data.api_key,
            verified: !!data.verified,
            updatedAt: Date.parse(data.updated_at) || Date.now(),
        };
    }

    private rememberSynced(apiKey: string | null, verified: boolean): void {
        this.syncedKey = apiKey;
        this.syncedVerified = verified;
    }

    /** Upsert the key onto the account. Returns the server's updated_at, or null on failure. */
    private async pushRemote(userId: string, apiKey: string, verified: boolean): Promise<number | null> {
        const { data, error } = await supabase
            .from(TABLE)
            .upsert(
                {
                    user_id: userId,
                    provider: PROVIDER,
                    api_key: apiKey,
                    verified,
                    key_hint: keyHint(apiKey),
                },
                { onConflict: 'user_id,provider' },
            )
            .select('updated_at')
            .maybeSingle();

        if (error) {
            // Never log the key itself, only whether the write landed.
            console.warn('[AiProviderKeyVault] Could not save the key to the account:', error.message);
            return null;
        }
        this.rememberSynced(apiKey, verified);
        return Date.parse(data?.updated_at || '') || Date.now();
    }

    private async deleteRemote(userId: string): Promise<void> {
        const { error } = await supabase
            .from(TABLE)
            .delete()
            .eq('user_id', userId)
            .eq('provider', PROVIDER);
        if (error) {
            console.warn('[AiProviderKeyVault] Could not remove the key from the account:', error.message);
            return;
        }
        this.rememberSynced(null, false);
    }

    // ── Sync ─────────────────────────────────────────────────────────────────

    /** Pull the account's key and reconcile it with this install's copy. */
    async sync(userId: string): Promise<void> {
        // De-duplicate by USER, not merely "a sync is running". Returning an
        // in-flight sync for the previous account would mean a user who signed
        // in while it was running never got synced at all — and would sit in
        // front of the setup prompt this whole change exists to remove.
        if (this.pulling && this.pullingUserId === userId) return this.pulling;
        const prior = this.pulling;

        this.pullingUserId = userId;
        const run = (async () => {
            if (prior) await prior.catch(() => undefined);
            try {
                // Under Electron the settings live in a file, so reading before
                // the load lands would report "this install has no key" and
                // upload nothing — or, worse, treat a stored key as absent. Both
                // sides of the reconcile have to be real values.
                await EditorSettings.instance.ready.catch(() => undefined);

                const remote = await this.fetchRemote(userId);
                if (remote) this.rememberSynced(remote.apiKey, remote.verified);

                const local = this.readLocal();
                const decision = reconcileOpenRouterKey({ userId, local, remote });
                console.log(`[AiProviderKeyVault] ${decision.action}: ${decision.reason}`);

                if (decision.action === 'adopt-remote') {
                    this.writeLocal({
                        apiKey: decision.apiKey,
                        verified: decision.verified,
                        keyUpdatedAt: decision.keyUpdatedAt,
                        keyOwnerId: userId,
                    });
                    this.rememberSynced(decision.apiKey, decision.verified);
                } else if (decision.action === 'push-local') {
                    const updatedAt = await this.pushRemote(userId, decision.apiKey, decision.verified);
                    if (updatedAt !== null) {
                        this.writeLocal({
                            apiKey: decision.apiKey,
                            verified: decision.verified,
                            keyUpdatedAt: updatedAt,
                            keyOwnerId: userId,
                        });
                    }
                } else if (decision.action === 'clear-local') {
                    this.writeLocal({ apiKey: '', verified: false, keyUpdatedAt: undefined, keyOwnerId: undefined });
                }
                // Deliberately nothing on 'noop'. It is tempting to "just stamp
                // the owner while we are here", but a key that really is this
                // account's has already been stamped by the branches above.
            } catch (e: any) {
                console.warn('[AiProviderKeyVault] Sync failed:', e?.message || e);
            }
        })();

        this.pulling = run;
        try {
            await run;
        } finally {
            // Only clear if a newer sync has not already taken over.
            if (this.pulling === run) {
                this.pulling = null;
                this.pullingUserId = null;
            }
        }
    }

    /**
     * Store a key from the editor side (OAuth exchange, Connected Services) and
     * push it to the account. Writing locally is enough on its own — the change
     * watcher would upload it a moment later — but doing it here means the
     * caller can await the upload and report a real result.
     */
    async setOpenRouterKey(apiKey: string, opts: SetKeyOptions = {}): Promise<void> {
        const key = (apiKey || '').trim();
        const verified = !!opts.verified;
        const userId = this.userId;

        if (!key) {
            this.writeLocal({ apiKey: '', verified: false, keyUpdatedAt: Date.now() });
            if (userId) await this.deleteRemote(userId);
            return;
        }

        if (!userId) {
            // Signed out (or the session has not resolved yet): keep it locally,
            // unclaimed, so the next successful login uploads it.
            this.writeLocal({ apiKey: key, verified, keyUpdatedAt: Date.now() });
            return;
        }

        const updatedAt = await this.pushRemote(userId, key, verified);
        this.writeLocal({
            apiKey: key,
            verified,
            keyUpdatedAt: updatedAt ?? Date.now(),
            keyOwnerId: userId,
        });
    }

    /** The key this install currently holds, or '' — for callers that need it synchronously. */
    getOpenRouterKey(): string {
        return this.readLocal()?.apiKey || '';
    }

    // ── Watchers ─────────────────────────────────────────────────────────────

    /**
     * Upload a key the user changed somewhere else in the app — most often in
     * the AI panel's own settings, which writes back through the bridge into
     * this same EditorSettings key.
     */
    private onLocalSettingsChanged = ({ key }: { key?: string } = {}): void => {
        if (key !== SETTINGS_KEY) return;
        if (this.applyingRemote) return;          // our own write
        if (!this.userId) return;                 // nothing to bind it to yet

        if (this.pushTimer) clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => {
            this.pushTimer = null;
            const local = this.readLocal();
            const userId = this.userId;
            if (!userId || !local) return;

            if (!local.apiKey) {
                // The user cleared it. Clearing it on the account too is what
                // makes "remove my key" mean the same thing on every machine.
                if (this.syncedKey) void this.deleteRemote(userId);
                return;
            }

            // Belt and braces against uploading someone else's credential: the
            // reconcile clears a foreign key at login, but an unrelated settings
            // write could land before that finishes.
            if (!isLocalKeyUsableBy(local, userId)) return;

            // The panel rewrites this whole settings object for unrelated
            // reasons (model choice, nitro, sampling), so only an actual change
            // to the credential or its verification is worth a round-trip.
            if (local.apiKey === this.syncedKey && local.verified === this.syncedVerified) {
                if (local.keyOwnerId !== userId) this.writeLocal({ keyOwnerId: userId });
                return;
            }

            void (async () => {
                const updatedAt = await this.pushRemote(userId, local.apiKey, local.verified);
                if (updatedAt !== null) {
                    this.writeLocal({ keyUpdatedAt: updatedAt, keyOwnerId: userId });
                }
            })();
        }, PUSH_DEBOUNCE_MS);
    };

    private onSignedOut(): void {
        const local = this.readLocal();
        if (shouldClearLocalKeyOnSignOut(local, this.syncedKey)) {
            // Only the secret and its stamps. Model choices are a preference,
            // not a credential, and survive a sign-out.
            this.writeLocal({ apiKey: '', verified: false, keyUpdatedAt: undefined, keyOwnerId: undefined });
            console.log('[AiProviderKeyVault] Cleared the local OpenRouter key on sign-out (it is safe on the account).');
        } else if (local?.apiKey) {
            console.warn(
                '[AiProviderKeyVault] Keeping the local OpenRouter key on sign-out: it was never confirmed saved '
                + 'to the account, and clearing it would be the only copy gone.',
            );
        }
        this.userId = null;
        this.rememberSynced(null, false);
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────

    /** Idempotent. Safe to call before anyone has logged in. */
    start(): void {
        if (this.started) return;
        this.started = true;

        try {
            EditorSettings.instance?.on?.('updated', this.onLocalSettingsChanged, this);
        } catch (e: any) {
            console.warn('[AiProviderKeyVault] Could not watch settings changes:', e?.message || e);
        }

        // The session may already exist (persistSession) — onAuthStateChange
        // fires INITIAL_SESSION for that case in supabase-js v2, but asking
        // directly costs nothing and removes the dependency on that behaviour.
        void supabase.auth
            .getSession()
            .then(({ data }) => {
                const id = data?.session?.user?.id;
                if (id && !this.userId) {
                    this.userId = id;
                    void this.sync(id);
                }
            })
            .catch((e: any) => console.warn('[AiProviderKeyVault] getSession failed:', e?.message || e));

        // NOTE: supabase-js holds its auth lock for the duration of this
        // callback, and anything that reads the session (every PostgREST call)
        // queues behind it. So this handler only ever records state and hands
        // the work to a later task — see EditorBridge's auth.getJwt for what a
        // 30s deadlock behind that lock looks like from the other side.
        supabase.auth.onAuthStateChange((event, session) => {
            const id = session?.user?.id || null;

            if (!id) {
                if (event === 'SIGNED_OUT') this.onSignedOut();
                return;
            }
            if (id === this.userId) return;   // token refresh, not a new user

            if (this.userId && this.userId !== id) {
                // Account switch on the same machine: forget what we knew about
                // the previous account before reconciling, or its key could be
                // pushed into the new one. (The `keyOwnerId` stamp is the real
                // guard — see AiProviderKeyReconcile — this is belt and braces.)
                this.rememberSynced(null, false);
            }
            this.userId = id;
            setTimeout(() => { void this.sync(id); }, 0);
        });

        console.log('[AiProviderKeyVault] Started — OpenRouter key follows the signed-in account.');
    }
}

export const AiProviderKeyVault = new AiProviderKeyVaultImpl();
export default AiProviderKeyVault;
