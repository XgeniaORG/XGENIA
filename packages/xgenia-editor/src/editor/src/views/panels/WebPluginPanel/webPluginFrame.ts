/**
 * What a web panel's iframe should load. Pure (beyond the loader passed in) so it runs under
 * Node's test runner. See the ticket note at the top of PluginLoader.ts.
 */
import {
    isVerdict,
    stableUrl,
    TICKET_PARAM,
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
 * How often an open panel fetches a fresh ticket for its plugin. The plugin host turns a ticket
 * into a session that ends on its own (Character Studio: 2 hours) and the mounted URL keeps its
 * first ticket, so a panel left open longer would start failing on whatever it loads later.
 */
export const TICKET_RENEW_MS = 45 * 60 * 1000;

function ticketOf(url: string): string | null {
    try {
        return new URL(url).searchParams.get(TICKET_PARAM);
    } catch {
        return null;
    }
}

/**
 * The fresh ticket to hand the plugin already mounted at `mounted`, or null: only when the
 * entitled URL is that same plugin page and carries a ticket the mounted URL does not. The panel
 * posts it to the plugin as `{ type: 'plugin-ticket', ticket }`; the plugin renews its session
 * with it, without a reload.
 */
export function renewedTicket(mounted: string | null, entitled: string): string | null {
    if (!mounted || stableUrl(mounted) !== stableUrl(entitled)) return null;
    const ticket = ticketOf(entitled);
    return ticket && ticket !== ticketOf(mounted) ? ticket : null;
}

/** Whether a frame URL carries a ticket (and so a session the panel must keep renewing). */
export function hasTicket(url: string | null): boolean {
    return !!url && !!ticketOf(url);
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
