/**
 * What a web panel's iframe should load. Pure (beyond the loader passed in) so it runs under
 * Node's test runner. See the ticket note at the top of PluginLoader.ts.
 */
import {
    isVerdict,
    stableUrl,
    TICKET_REFRESH_MS,
    type EntitlementsResponse,
    type PluginLoader,
} from '../ChatPanelBridge/PluginLoader';

/**
 * The URL the iframe should have, given the one it has now and the one the entitlements give.
 * A change in the ticket alone keeps the mounted URL — the plugin already has its session,
 * and reloading it would lose whatever the user has not saved. Any other change reloads.
 */
export function nextFrameUrl(mounted: string | null, entitled: string): string {
    if (mounted && stableUrl(mounted) === stableUrl(entitled)) return mounted;
    return entitled;
}

/**
 * The entitlements to open a web panel with. An answer older than TICKET_REFRESH_MS may hold
 * an expired ticket, so the server is asked again first. If that does not produce a verdict,
 * the answer already held in memory (with its older URL) is used rather than nothing.
 */
export async function entitlementsForPanelOpen(
    loader: Pick<PluginLoader, 'getEntitledPlugins' | 'getCurrent'>
): Promise<EntitlementsResponse> {
    const e = await loader.getEntitledPlugins({ maxAgeMs: TICKET_REFRESH_MS });
    if (isVerdict(e)) return e;
    return loader.getCurrent() ?? e;
}
