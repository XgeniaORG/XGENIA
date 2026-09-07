/**
 * AiProviderKeyReconcile — deciding whose OpenRouter key wins.
 *
 * Pure, dependency-free, and deliberately separate from AiProviderKeyVault: the
 * vault does I/O (Supabase, EditorSettings, timers) and this file holds the one
 * part that is easy to get subtly wrong, so it can be unit-tested on its own.
 *
 * THE RULE THAT MATTERS MOST is not "newest wins" — it is `keyOwnerId`.
 * The key is bound to a Primora ACCOUNT, so a key left in editorSettings.json by
 * whoever last used this machine must never be treated as the current user's,
 * and must never be pushed into their account. A local key counts only when it
 * is unclaimed (written before this feature existed, hence migratable) or
 * already stamped with the signed-in user's id.
 */

/** The OpenRouter key as it sits in this install's editorSettings.json. */
export interface LocalKeySnapshot {
    apiKey: string;
    verified: boolean;
    /** ms epoch of the last local change. Absent on a key stored before this feature. */
    keyUpdatedAt?: number;
    /** Primora user id this key was synced for. Absent = unclaimed (legacy install). */
    keyOwnerId?: string;
}

/** The OpenRouter key as it sits in public.user_ai_provider_keys for this user. */
export interface RemoteKeySnapshot {
    apiKey: string;
    verified: boolean;
    /** ms epoch — the row's server-maintained updated_at. */
    updatedAt: number;
}

export type KeyReconcileAction =
    /** Nothing to do; both sides already agree (or neither has a key). */
    | { action: 'noop'; reason: string }
    /** Write these values into editorSettings.json. */
    | { action: 'adopt-remote'; reason: string; apiKey: string; verified: boolean; keyUpdatedAt: number }
    /** Upsert these values into the account, then stamp them locally. */
    | { action: 'push-local'; reason: string; apiKey: string; verified: boolean; keyUpdatedAt: number }
    /** Wipe the local key: it is someone else's and this account has nothing to put there. */
    | { action: 'clear-local'; reason: string };

export interface ReconcileInput {
    /** The signed-in Primora user id. */
    userId: string;
    local: LocalKeySnapshot | null;
    remote: RemoteKeySnapshot | null;
    /** Injectable clock, for tests. */
    now?: number;
}

/**
 * Is the local key one this account may use and claim?
 *
 * Unclaimed keys are migratable on purpose: everyone who already pasted a key
 * before this feature shipped should keep it and have it uploaded on their next
 * login, rather than being asked for it again — that is the whole point of the
 * change. Once claimed, the stamp makes the answer unambiguous forever after.
 */
export function isLocalKeyUsableBy(local: LocalKeySnapshot | null, userId: string): boolean {
    if (!local || !local.apiKey || !local.apiKey.trim()) return false;
    if (!local.keyOwnerId) return true;
    return local.keyOwnerId === userId;
}

export function reconcileOpenRouterKey(input: ReconcileInput): KeyReconcileAction {
    const now = input.now ?? Date.now();
    const { userId, remote } = input;
    const local = input.local;
    const localUsable = isLocalKeyUsableBy(local, userId);

    // ── Neither side has anything usable ─────────────────────────────────────
    if (!remote?.apiKey && !localUsable) {
        // A stamped key can only have been stamped by a successful sync, so it
        // is safe on ITS owner's account and wiping it here destroys nothing.
        // Leaving it would hand the previous user's credential to whoever signs
        // in next on a shared machine — which is the thing "bound to the user"
        // is supposed to prevent.
        if (local?.apiKey) {
            return {
                action: 'clear-local',
                reason: 'the local key belongs to a different account; removing it from this install',
            };
        }
        return { action: 'noop', reason: 'neither this install nor the account has an OpenRouter key' };
    }

    // ── Only the account has one → the panel gets pre-filled ─────────────────
    if (remote?.apiKey && !localUsable) {
        return {
            action: 'adopt-remote',
            reason: local?.apiKey
                ? 'the local key belongs to a different account; using this account\'s key'
                : 'this install has no key; using the one stored on the account',
            apiKey: remote.apiKey,
            verified: remote.verified,
            keyUpdatedAt: remote.updatedAt,
        };
    }

    // ── Only this install has one → claim it for the account ─────────────────
    if (!remote?.apiKey && localUsable) {
        return {
            action: 'push-local',
            reason: 'the account has no key yet; uploading the one already stored here',
            apiKey: local!.apiKey,
            verified: local!.verified,
            keyUpdatedAt: local!.keyUpdatedAt ?? now,
        };
    }

    // ── Both sides have a key ────────────────────────────────────────────────
    const l = local!;
    const r = remote!;

    if (l.apiKey === r.apiKey) {
        // Same secret. The only thing left to settle is the `verified` flag and
        // the local bookkeeping fields.
        if (l.verified && !r.verified) {
            return {
                action: 'push-local',
                reason: 'same key, verified here but not yet recorded on the account',
                apiKey: l.apiKey,
                verified: true,
                keyUpdatedAt: l.keyUpdatedAt ?? now,
            };
        }
        if (l.verified !== r.verified || l.keyOwnerId !== userId || l.keyUpdatedAt !== r.updatedAt) {
            return {
                action: 'adopt-remote',
                reason: 'same key; aligning local bookkeeping with the account',
                apiKey: r.apiKey,
                verified: r.verified,
                keyUpdatedAt: r.updatedAt,
            };
        }
        return { action: 'noop', reason: 'this install and the account already hold the same key' };
    }

    // Different keys. Newest wins. A local key with no stamp predates this
    // feature and cannot claim to be newer than a row the account wrote with a
    // real timestamp, so the account wins that tie by construction.
    const localStamp = l.keyUpdatedAt ?? 0;
    if (localStamp > r.updatedAt) {
        return {
            action: 'push-local',
            reason: 'this install holds a newer key than the account',
            apiKey: l.apiKey,
            verified: l.verified,
            keyUpdatedAt: localStamp,
        };
    }
    return {
        action: 'adopt-remote',
        reason: 'the account holds a newer key than this install',
        apiKey: r.apiKey,
        verified: r.verified,
        keyUpdatedAt: r.updatedAt,
    };
}

/**
 * Should sign-out wipe the local copy of the key?
 *
 * Yes — that is what "bound to the user" means; the next person to sign in on
 * this machine must not inherit it. But ONLY when we know the account actually
 * has it, because otherwise signing out (or an offline session that never got
 * to upload) would destroy the user's only copy. A key we never managed to
 * sync stays put and gets uploaded on the next successful login instead.
 */
export function shouldClearLocalKeyOnSignOut(
    local: LocalKeySnapshot | null,
    syncedKey: string | null,
): boolean {
    if (!local?.apiKey) return false;
    return !!syncedKey && syncedKey === local.apiKey;
}

/** Last 4 characters of a key — enough for support to identify it, never enough to use it. */
export function keyHint(apiKey: string): string {
    const trimmed = (apiKey || '').trim();
    return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}
