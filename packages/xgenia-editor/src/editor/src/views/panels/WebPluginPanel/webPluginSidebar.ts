/**
 * Which sidebar entries the account's web-panel plugins should have, kept in step with the
 * entitlements. No editor imports beyond PluginLoader, so it runs under Node's test runner:
 * the sidebar and the item factory are passed in.
 *
 * Rules:
 *   - a VERDICT lists exactly the entries: every entitled `kind: 'web-panel'` plugin
 *     (see webPanelPlugins) gets one, every other `web-plugin:*` entry is removed;
 *   - an `unverified` answer changes nothing (the panel itself shows "couldn't check");
 *   - null (signed out) removes them all.
 * Only ids under WEB_PLUGIN_PANEL_PREFIX are ever touched.
 */
import { isVerdict, webPanelPlugins, type EntitlementsResponse, type PluginEntitlement } from '../ChatPanelBridge/PluginLoader';

export const WEB_PLUGIN_PANEL_PREFIX = 'web-plugin:';

/** Sidebar order slot: after the AI Image Editor (70), before Node References (80). */
export const WEB_PLUGIN_PANEL_ORDER = 72;

export function webPluginPanelId(pluginId: string): string {
    return WEB_PLUGIN_PANEL_PREFIX + pluginId;
}

/** The slice of SidebarModel this module needs. */
export interface WebPluginSidebarHost<TItem extends { id: string }> {
    getItems(): readonly { id: string }[];
    register(item: TItem): void;
    unregister(id: string): void;
}

export function syncWebPluginPanels<TItem extends { id: string }>(
    host: WebPluginSidebarHost<TItem>,
    entitlements: EntitlementsResponse | null,
    makeItem: (plugin: PluginEntitlement, index: number) => TItem
): { added: string[]; removed: string[] } {
    const added: string[] = [];
    const removed: string[] = [];
    if (entitlements && !isVerdict(entitlements)) return { added, removed };

    const wanted = webPanelPlugins(entitlements);
    const wantedIds = new Set(wanted.map((p) => webPluginPanelId(p.id)));
    const present = new Set(host.getItems().map((x) => x.id));

    for (const id of present) {
        if (id.startsWith(WEB_PLUGIN_PANEL_PREFIX) && !wantedIds.has(id)) {
            host.unregister(id);
            removed.push(id);
        }
    }
    wanted.forEach((plugin, index) => {
        const id = webPluginPanelId(plugin.id);
        if (present.has(id)) return;
        host.register(makeItem(plugin, index));
        added.push(id);
    });
    return { added, removed };
}
