/**
 * Keeps one sidebar entry per entitled web-panel plugin (see webPluginSidebar for the rules).
 * Called from installSidePanel; the previous subscription is dropped on every call, so a
 * project re-open or a hot reload never leaves two listeners registering into the sidebar.
 */
import type React from 'react';

import { SidebarModel, type SidebarItem } from '@xgenia-models/sidebar';

import {
    SideAssets, SideComponents, SideImageEditor, SideMaths, SideProjectStyles, SideWebPlugin
} from '../../SidePanel/SidebarIcons';
import { PluginLoader, type EntitlementsResponse, type PluginEntitlement } from '../ChatPanelBridge/PluginLoader';
import { WebPluginPanel } from './WebPluginPanel';
import { syncWebPluginPanels, webPluginPanelId, WEB_PLUGIN_PANEL_ORDER } from './webPluginSidebar';

/** Icon keys a server may send as `icon`. Anything else gets the generic plugin icon. */
const ICONS: Record<string, React.ElementType> = {
    plugin: SideWebPlugin,
    image: SideImageEditor,
    components: SideComponents,
    maths: SideMaths,
    assets: SideAssets,
    styles: SideProjectStyles,
};

export function webPluginIcon(key: string | undefined): React.ElementType {
    return (key && Object.prototype.hasOwnProperty.call(ICONS, key) && ICONS[key]) || SideWebPlugin;
}

function makeItem(plugin: PluginEntitlement, index: number): SidebarItem<{ pluginId: string }> {
    return {
        id: webPluginPanelId(plugin.id),
        name: plugin.name || plugin.id,
        description: plugin.description,
        order: WEB_PLUGIN_PANEL_ORDER + index / 100,
        icon: webPluginIcon(plugin.icon),
        panel: WebPluginPanel,
        panelProps: { pluginId: plugin.id },
    };
}

let unsubscribe: (() => void) | null = null;

export function installWebPluginPanels(): void {
    uninstallWebPluginPanels();
    const loader = PluginLoader.instance;
    const sidebar = SidebarModel.instance;
    const sync = (e: EntitlementsResponse | null) => {
        try {
            syncWebPluginPanels(sidebar, e, makeItem);
        } catch (err) {
            console.warn('[WebPluginPanel] Could not update plugin panels:', err);
        }
    };
    const current = loader.getCurrent();
    if (current) sync(current);
    unsubscribe = loader.onChange(sync);
    loader.getEntitledPlugins().then(sync, () => { /* the panels report their own failures */ });
}

export function uninstallWebPluginPanels(): void {
    unsubscribe?.();
    unsubscribe = null;
}
