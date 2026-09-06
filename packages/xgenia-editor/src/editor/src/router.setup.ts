import React from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { AppRegistry } from '@xgenia-models/app_registry';
import { SidebarModel } from '@xgenia-models/sidebar';

import {
  SideComponents, SideSearch, SideVersionControl, SideSettings, SideChatPanel, SideProjectStyles,
  SideNodeReferences, SideFeedback, SideImageEditor, SideMaths, SideAssets, SideAddNode
} from './views/SidePanel/SidebarIcons';
import { AddNodeAction } from './views/panels/componentspanel/AddNodeAction';

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
// Cloud Functions panel disabled — see the commented-out register() call below.
// import { CloudFunctionsPanel } from './views/panels/CloudFunctionsPanel/CloudFunctionsPanel';
// Cloud Services panel disabled — see the commented-out register() call below.
// import { CloudServicePanel } from './views/panels/CloudServicePanel/CloudServicePanel';
import { ComponentPortsComponent } from './views/panels/componentports';
import { ComponentsPanel } from './views/panels/componentspanel';
import { FeedbackPanel, FeedbackPanel_ID } from './views/panels/FeedbackPanel';
import MemoryPanel from './views/panels/MemoryPanel/MemoryPanel';
import { NodeReferencesPanel_ID } from './views/panels/NodeReferencesPanel';
import { NodeReferencesPanel } from './views/panels/NodeReferencesPanel/NodeReferencesPanel';
import { PropertyEditor } from './views/panels/propertyeditor';
import { SearchPanel } from './views/panels/search-panel/search-panel';
import { SettingsPanel, SettingsPanel_ID } from './views/panels/SettingsPanel/SettingsPanel';
import { VersionControlPanel_ID } from './views/panels/VersionControlPanel';
import { VersionControlPanel } from './views/panels/VersionControlPanel/VersionControlPanel';
import { ImageEditorPanel } from './views/panels/ImageEditorPanel';
import { ProjectStylesPanel } from './views/panels/ProjectStylesPanel/ProjectStylesPanel';
import { MathsPanel, MathsPanel_ID } from './views/panels/MathsPanel';
import { AssetPanel } from './views/panels/AssetPanel';



export interface SetupEditorOptions {
  isLesson: boolean;
}

// `isLesson` currently has no live reader: its only two uses were the
// `isDisabled` flags on the Cloud Services and Cloud Functions registrations,
// both commented out below. Kept destructured so uncommenting either one
// compiles as-is.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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
    headerAction: AddNodeAction,
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

  SidebarModel.instance.register({
    id: 'search',
    name: 'Search',
    fineType: Keybindings.SEARCH.label,
    order: 30,
    icon: SideSearch,
    panel: SearchPanel
  });

  SidebarModel.instance.register({
    id: FeedbackPanel_ID,
    name: 'Feedback',
    order: 20,
    placement: 'bottom',
    icon: SideFeedback,
    panel: FeedbackPanel
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
    chromeless: true,
    defaultWidth: 450,
    isDefaultDocked: true,
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

  // Cloud Services - Commented out (2026-08-06), together with Cloud Functions
  // below. The two go together: the environment this panel connects (a Supabase
  // cloud service) was what Cloud Functions deployed `/#__cloud__/` components
  // to, and the Maths RGS panel reaches the RGS backend by its own route
  // (operator key + maths-deployer), not through a cloud-service environment.
  //
  // Nothing else in the editor navigates here — no `SidebarModel.switch(
  // 'cloudservice')` anywhere — so withdrawing the sidebar entry is the whole
  // change. `'cloudservice'` is left in SidePanel.tsx's `bottomIds` set and
  // `iconMap`; both are keyed lookups over registered items, so a stale entry is
  // inert.
  //
  // What is no longer reachable while this is off: listing, creating (
  // CloudServiceCreateModal) and activating environments. Environments already
  // stored in a project still exist and are still listed by the "Connected cloud
  // services" dropdowns on DeployToFolderTab / DeployToStakeTab, and the
  // deploy-supabase-edge-functions compile pass still fires for whichever one is
  // active — this hides the management UI, it does not clear the setting.
  //
  // Publish (XgeniaDeployTab) is unaffected: its own "Connected cloud services"
  // picker was commented out earlier and its state pinned to
  // RGS_ENVIRONMENT_VALUE, so Publish takes the RGS path regardless of what any
  // cloud service says. Do not "fix" that pinning by restoring
  // NO_ENVIRONMENT_VALUE without also restoring that picker — see the comment at
  // XgeniaDeployTab.tsx:1887.
  //
  // SidebarModel.instance.register({
  //   id: 'cloudservice',
  //   name: 'Cloud Services',
  //   isDisabled: isLesson === true,
  //   order: 6,
  //   placement: 'bottom',
  //   icon: IconName.CloudData,
  //   panel: CloudServicePanel
  // });

  // Cloud Functions - Commented out (2026-08-06).
  //
  // Superseded by the Maths RGS panel: maths is authored in `/#__maths__/` and
  // shipped to the RGS from there, so the `/#__cloud__/` authoring surface this
  // panel provided is no longer part of the workflow. The panel itself
  // (CloudFunctionsPanel.tsx) and every `__cloud__` code path — the compile
  // passes, the converter, the search-panel labelling — are left intact; only
  // the sidebar entry is withdrawn, so re-enabling is a matter of uncommenting
  // this block (plus the import above and the switch in NodeGraphContext.tsx).
  //
  // Consequence while this is off: '__cloud__' stays in the `hideSheets` list of
  // the general Components panel above, and no other panel locks to that sheet,
  // so `/#__cloud__/` components have no UI surface at all. That is intended
  // here (the sheet is unused, and Publish's machine-generated
  // `/#__cloud__/__Component_N__` entries were never meant to be browsed), but
  // it is exactly the condition maths-sheet-mount.test.ts test 1 exists to
  // catch — that test reads source text, so it keeps passing on the
  // still-uncommented `lockCurrentSheetName: '__cloud__'` in the panel file. If
  // `/#__cloud__/` ever needs to be reachable again, either uncomment this
  // registration or drop '__cloud__' from that hideSheets list.
  //
  // SidebarModel.instance.register({
  //   id: 'cloud-functions',
  //   name: 'Cloud Functions',
  //   isDisabled: isLesson === true,
  //   order: 7,
  //   placement: 'bottom',
  //   icon: IconName.CloudFunction,
  //   panel: CloudFunctionsPanel
  // });

  // "Project settings" and "Editor settings" were merged into one entry
  // (2026-08-12). The two scopes live on as the panel's Project/Editor tabs —
  // see SettingsPanel for why they are tabs and not one flat section list.
  SidebarModel.instance.register({
    id: SettingsPanel_ID,
    name: 'Settings',
    order: 30,
    placement: 'bottom',
    icon: SideSettings,
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
    experimental: true,
    id: 'assets',
    name: 'Assets',
    description:
      'Asset browser (experimental): browse, search, sort and preview project assets. Drag-into-graph, rename and stable asset IDs are still in progress.',
    order: 40,
    icon: SideAssets,
    panel: AssetPanel
  });

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
