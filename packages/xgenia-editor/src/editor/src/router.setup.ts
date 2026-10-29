import React from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { AppRegistry } from '@xgenia-models/app_registry';
import { SidebarModel } from '@xgenia-models/sidebar';

import {
  SideComponents, SideSearch, SideVersionControl, SideSettings, SideChatPanel, SideProjectStyles,
  SideNodeReferences, SideImageEditor, SideMaths, SideAssets, SideAddNode, SideCloudFunctions, SideCloud
} from './views/SidePanel/SidebarIcons';

import { ComponentDiffDocumentProvider } from './views/documents/ComponentDiffDocument';
import { EditorDocumentProvider } from './views/documents/EditorDocument';
import { MathsComplianceDocumentProvider } from './views/documents/MathsComplianceDocument';
import { MathsComponentDocumentProvider } from './views/documents/MathsComponentDocument';
import { MathsSimulateDocumentProvider } from './views/documents/MathsSimulateDocument';
import { NodePickerPanel } from './views/NodePicker/NodePickerPanel';
// ChatPanel: proprietary AI module loaded via iframe (GPL-isolated) or symlink (legacy).
// Falls back to a GPL-3 shell if neither is available.
import ChatPanelShell, { ChatPanel_ID as ShellChatPanelID } from './views/panels/ChatPanelShell';
import { ChatPanelIframe, ChatPanelIframe_ID } from './views/panels/ChatPanelBridge/ChatPanelIframe';

let ChatPanel: React.ComponentType<any> = ChatPanelShell;
let ChatPanel_ID = ShellChatPanelID;
// Note: MCP Server Browser will be loaded via the iframe bridge in the future

// Determine loading strategy: 'iframe' (GPL-isolated) | 'shell' (OSS fallback)
const AI_LOAD_STRATEGY: 'iframe' | 'shell' = (() => {
  try {
    const { EditorSettings } = require('./utils/editorsettings');
    const pref = EditorSettings.instance?.get?.('aiLoadStrategy');
    if (pref === 'shell') return 'shell';
  } catch { }
  return 'iframe'; // Default to iframe (GPL-isolated)
})();

if (AI_LOAD_STRATEGY === 'iframe') {
  // Load AI plugin via iframe from separate origin (GPL-isolated)
  ChatPanel = ChatPanelIframe;
  ChatPanel_ID = ChatPanelIframe_ID;
  console.log('[XGENIA] AI Chat panel loading via iframe (GPL-isolated mode)');
} else {
  console.log('[XGENIA] AI Chat panel running in open-source mode (shell)');
}
import { CloudFunctionsPanel } from './views/panels/CloudFunctionsPanel/CloudFunctionsPanel';
import { CloudServicePanel } from './views/panels/CloudServicePanel/CloudServicePanel';
import { ComponentPortsComponent } from './views/panels/componentports';
import { ComponentsPanel } from './views/panels/componentspanel';
import MemoryPanel from './views/panels/MemoryPanel/MemoryPanel';
import { NodeReferencesPanel_ID } from './views/panels/NodeReferencesPanel';
import { NodeReferencesPanel } from './views/panels/NodeReferencesPanel/NodeReferencesPanel';
import { PropertyEditor } from './views/panels/propertyeditor';
import { SearchPanel } from './views/panels/search-panel/search-panel';
import { SettingsPanel, SettingsPanel_ID } from './views/panels/SettingsPanel/SettingsPanel';
import { VersionControlPanel_ID } from './views/panels/VersionControlPanel';
import { VersionControlPanel } from './views/panels/VersionControlPanel/VersionControlPanel';
import { ImageEditorPanel } from './views/panels/ImageEditorPanel';
import { installWebPluginPanels } from './views/panels/WebPluginPanel';
import { ProjectStylesPanel } from './views/panels/ProjectStylesPanel/ProjectStylesPanel';
import { MathsPanel, MathsPanel_ID } from './views/panels/MathsPanel';
import { AssetPanel } from './views/panels/AssetPanel';
import { GlassHierarchy, HierarchyPanel, HierarchyPanel_ID } from './views/panels/HierarchyPanel';
import { GlassHistory, HistoryPanel, HistoryPanel_ID } from './views/panels/HistoryPanel';



export interface SetupEditorOptions {
  isLesson: boolean;
}

export function installSidePanel({ isLesson }: SetupEditorOptions) {
  const appRegistry = AppRegistry.instance;

  SidebarModel.instance.register({
    transient: true,
    id: 'PropertyEditor',
    name: 'Properties',
    // @ts-expect-error
    panel: PropertyEditor
  });

  SidebarModel.instance.register({
    transient: true,
    id: 'PortEditor',
    name: 'Ports',
    panel: ComponentPortsComponent
  });

  // New: transient Node Picker panel opened via green header button
  SidebarModel.instance.register({
    transient: true,
    id: 'node-picker',
    name: 'Add node',
    order: 5,
    icon: SideAddNode,
    panel: NodePickerPanel
  });

  SidebarModel.instance.register({
    id: 'components',
    name: 'Components',
    order: 20,
    icon: SideComponents,
    onOpen: () => {
      if (appRegistry.CurrentDocumentId !== EditorDocumentProvider.ID) {
        appRegistry.openDocument(EditorDocumentProvider.ID);
      }
    },
    panelProps: {
      // This is a temporary solution so we can keep the state of open folder etc
      options: {
        showSheetList: true,
        hideSheets: ['__cloud__', '__maths__']
      }
    },
    panel: ComponentsPanel
  });

  // Unity-style tree of the active component's nodes: selection mirrors the graph, eye/lock
  // drive EditorSceneVisibility, drag to reparent. Sits right under Components.
  SidebarModel.instance.register({
    id: HierarchyPanel_ID,
    name: 'Hierarchy',
    order: 21,
    icon: GlassHierarchy,
    panel: HierarchyPanel
  });

  // The undo queue as a clickable list (jump back or forward to any step).
  SidebarModel.instance.register({
    id: HistoryPanel_ID,
    name: 'History',
    order: 90,
    icon: GlassHistory,
    panel: HistoryPanel
  });

  SidebarModel.instance.register({
    id: 'search',
    name: 'Search',
    fineType: Keybindings.SEARCH.label,
    order: 30,
    icon: SideSearch,
    panel: SearchPanel
  });

  SidebarModel.instance.register({
    id: VersionControlPanel_ID,
    name: 'Version control',
    order: 10,
    placement: 'bottom',
    icon: SideVersionControl,
    panel: VersionControlPanel
  });
  SidebarModel.instance.register({
    id: ChatPanel_ID,
    name: 'Chat',
    order: 10,
    icon: SideChatPanel,
    defaultWidth: 450,
    isDefaultDocked: true,
    showsAiActivity: true,
    panel: ChatPanel
  });
  SidebarModel.instance.register({
    id: MathsPanel_ID,
    name: 'Maths RGS',
    order: 60,
    icon: SideMaths,
    panel: MathsPanel
  });
  SidebarModel.instance.register({
    id: 'image-editor',
    name: 'AI Image Editor',
    order: 70,
    icon: SideImageEditor,
    panel: ImageEditorPanel
  });

  SidebarModel.instance.register({
    id: 'project-styles',
    name: 'Project Styles',
    order: 50,
    icon: SideProjectStyles,
    panel: ProjectStylesPanel
  });

  // Memory Panel - Commented out
  // SidebarModel.instance.register({
  //   id: 'memory-panel',
  //   name: 'Memory',
  //   order: 5.5,
  //   placement: 'bottom',
  //   icon: IconName.Bug,
  //   panel: MemoryPanel
  // });

  // Cloud Services - lists, creates (CloudServiceCreateModal) and activates the
  // project's cloud-service environments (a Supabase cloud service). The active one
  // is what Cloud Functions (below) deploys `/#__cloud__/` components to and what
  // the deploy-supabase-edge-functions compile pass targets; the two panels go
  // together. The Maths RGS panel reaches the RGS backend by its own route
  // (operator key + maths-deployer), not through a cloud-service environment.
  //
  // Withdrawn 2026-08-06 (#37) together with Cloud Functions, restored with it
  // 2026-10-29. Bottom cluster, as before the rail redesign: it manages a setting,
  // it is not somewhere you author.
  //
  // Publish (XgeniaDeployTab) is unaffected either way: its own "Connected cloud
  // services" picker is commented out and its state pinned to
  // RGS_ENVIRONMENT_VALUE, so Publish takes the RGS path regardless of which
  // environment is active here. Do not "fix" that pinning by restoring
  // NO_ENVIRONMENT_VALUE without also restoring that picker — see the comment above
  // `environmentId` in XgeniaDeployTab.tsx.
  SidebarModel.instance.register({
    id: 'cloudservice',
    name: 'Cloud Services',
    isDisabled: isLesson === true,
    order: 20,
    placement: 'bottom',
    icon: SideCloud,
    panel: CloudServicePanel
  });

  // Cloud Functions - the `/#__cloud__/` sheet's own panel. It owns that sheet the
  // way Maths RGS owns `/#__maths__/`, which is why '__cloud__' is in the
  // Components panel's `hideSheets` above. NodeGraphContext.tsx swaps
  // Components <-> Cloud Functions as the active component crosses the sheet
  // boundary, so keep this id in step with it.
  //
  // Withdrawn 2026-08-06 (#37) as superseded by Maths RGS, restored 2026-10-29.
  // While it was off, `/#__cloud__/` components had no UI surface at all. It sat
  // in the bottom cluster before the rail redesign; it is an authoring panel, so
  // it now sits in the top cluster next to Maths RGS.
  SidebarModel.instance.register({
    id: 'cloud-functions',
    name: 'Cloud Functions',
    isDisabled: isLesson === true,
    order: 65,
    icon: SideCloudFunctions,
    panel: CloudFunctionsPanel
  });

  // "Project settings" and "Editor settings" were merged into one entry
  // (2026-08-12). The two scopes live on as the panel's Project/Editor tabs —
  // see SettingsPanel for why they are tabs and not one flat section list.
  // Not rendered as a rail button — reachable only from the identity chip's project menu
  // (ProjectMenu.tsx). Still fully registered and dispatchable: `railHidden` only affects
  // the rail's own rendering (see Rail.tsx), not `SidebarModel.switch`/`dispatch`.
  SidebarModel.instance.register({
    id: SettingsPanel_ID,
    name: 'Settings',
    order: 30,
    placement: 'bottom',
    icon: SideSettings,
    railHidden: true,
    panel: SettingsPanel
  });

  // Removed (2026-08-12): the three `config.devMode` experimental panels —
  // File Explorer, Design Tokens and Undo Queue. All three were unfinished
  // mockups rather than features: File Explorer rendered the literal string
  // "Files"; Design Tokens listed colours read-only behind a placeholder
  // context menu ("Another Action" / "Success" / "Danger") and dumped
  // `JSON.stringify(textStyle)` for typography; Undo Queue rendered history
  // entries as buttons with no onClick and never marked the current position.
  //
  // They were `devMode`-only (config-dev.js, loaded by dev-main.js), so they
  // never appeared in packaged builds and nothing outside these registrations
  // referenced them. The shared infrastructure they leaned on is untouched and
  // still used elsewhere: UndoQueue/UndoActionGroup (@xgenia-models/undo-queue-model)
  // back the editor's real undo, and ProjectDesignTokenContext is still
  // provided by EditorPage.

  SidebarModel.instance.register({
    experimental: true,
    id: NodeReferencesPanel_ID,
    name: 'Node References',
    description: 'Node References Panel is showing how many times each core node and component is used.',
    order: 80,
    icon: SideNodeReferences,
    panel: NodeReferencesPanel
  });

  // Asset browser (experimental). Hidden by default; enable via
  // Settings → Editor → Experimental panels → "Enable Assets".
  SidebarModel.instance.register({
    id: 'assets',
    name: 'Assets',
    description:
      "Everything this project has, grouped by what each thing is: key art, backgrounds, sprites, UI, audio. Shows the prompt that made an image, the art it was cut from, its earlier versions and which nodes use it.",
    order: 40,
    icon: SideAssets,
    panel: AssetPanel
  });

  // Web plugins the server marks `kind: 'web-panel'` in plugin-entitlements: one entry each,
  // added and removed as the account's entitlements change. Plugins without that marker,
  // and the two above with dedicated panels, are never touched.
  installWebPluginPanels();

  // TODO: Register MCP Server Browser panel via iframe bridge when available
}

export function installDocuments() {
  const appRegistry = AppRegistry.instance;

  // Register EditorDocumentProvider
  appRegistry.registerDocumentProvider(EditorDocumentProvider.ID, new EditorDocumentProvider());
  appRegistry.openDocument(EditorDocumentProvider.ID);

  appRegistry.registerDocumentProvider(ComponentDiffDocumentProvider.ID, new ComponentDiffDocumentProvider());
  appRegistry.registerDocumentProvider(MathsComponentDocumentProvider.ID, new MathsComponentDocumentProvider());
  appRegistry.registerDocumentProvider(MathsSimulateDocumentProvider.ID, new MathsSimulateDocumentProvider());
  appRegistry.registerDocumentProvider(MathsComplianceDocumentProvider.ID, new MathsComplianceDocumentProvider());

  if (import.meta.webpackHot) {
    import.meta.webpackHot.accept('./views/documents/EditorDocument', () => {
      AppRegistry.instance.registerDocumentProvider(EditorDocumentProvider.ID, new EditorDocumentProvider());
    });
    import.meta.webpackHot.accept('./views/documents/ComponentDiffDocument', () => {
      AppRegistry.instance.registerDocumentProvider(
        ComponentDiffDocumentProvider.ID,
        new ComponentDiffDocumentProvider()
      );
    });
    import.meta.webpackHot.accept('./views/documents/MathsComponentDocument', () => {
      AppRegistry.instance.registerDocumentProvider(
        MathsComponentDocumentProvider.ID,
        new MathsComponentDocumentProvider()
      );
    });
    import.meta.webpackHot.accept('./views/documents/MathsSimulateDocument', () => {
      AppRegistry.instance.registerDocumentProvider(
        MathsSimulateDocumentProvider.ID,
        new MathsSimulateDocumentProvider()
      );
    });
    import.meta.webpackHot.accept('./views/documents/MathsComplianceDocument', () => {
      AppRegistry.instance.registerDocumentProvider(
        MathsComplianceDocumentProvider.ID,
        new MathsComplianceDocumentProvider()
      );
    });
  }
}
