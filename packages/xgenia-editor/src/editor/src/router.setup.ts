import React from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { AppRegistry } from '@xgenia-models/app_registry';
import { SidebarModel } from '@xgenia-models/sidebar';

import { IconName } from '@xgenia-core-ui/components/common/Icon';

import config from '../../shared/config/config';
import { ComponentDiffDocumentProvider } from './views/documents/ComponentDiffDocument';
import { EditorDocumentProvider } from './views/documents/EditorDocument';
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
import { DesignTokenPanel } from './views/panels/DesignTokenPanel/DesignTokenPanel';
import { EditorSettingsPanel } from './views/panels/EditorSettingsPanel/EditorSettingsPanel';
import { FeedbackPanel, FeedbackPanel_ID } from './views/panels/FeedbackPanel';
import { FileExplorerPanel } from './views/panels/FileExplorerPanel';
import MemoryPanel from './views/panels/MemoryPanel/MemoryPanel';
import { NodeReferencesPanel_ID } from './views/panels/NodeReferencesPanel';
import { NodeReferencesPanel } from './views/panels/NodeReferencesPanel/NodeReferencesPanel';
import { ProjectSettingsPanel } from './views/panels/ProjectSettingsPanel/ProjectSettingsPanel';
import { PropertyEditor } from './views/panels/propertyeditor';
import { SearchPanel } from './views/panels/search-panel/search-panel';
import { UndoQueuePanel } from './views/panels/UndoQueuePanel/UndoQueuePanel';
import { VersionControlPanel_ID } from './views/panels/VersionControlPanel';
import { VersionControlPanel } from './views/panels/VersionControlPanel/VersionControlPanel';
import { ImageEditorPanel } from './views/panels/ImageEditorPanel';
import { ProjectStylesPanel } from './views/panels/ProjectStylesPanel/ProjectStylesPanel';
import { MathsPanel, MathsPanel_ID } from './views/panels/MathsPanel';



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
    order: 0.5,
    icon: IconName.Plus,
    panel: NodePickerPanel
  });

  SidebarModel.instance.register({
    id: 'components',
    name: 'Components',
    order: 1,
    icon: IconName.Components,
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
    order: 2,
    icon: IconName.Search,
    panel: SearchPanel
  });

  SidebarModel.instance.register({
    id: FeedbackPanel_ID,
    name: 'Feedback',
    order: 5.7,
    icon: IconName.Bug, // Using Bug icon since it's perfect for feedback/bug reports
    panel: FeedbackPanel
  });

  SidebarModel.instance.register({
    id: VersionControlPanel_ID,
    name: 'Version control',
    order: 5,
    placement: 'bottom',
    icon: IconName.StructureCircle,
    panel: VersionControlPanel
  });
  SidebarModel.instance.register({
    id: ChatPanel_ID,
    name: 'Chat',
    order: 5.6,
    icon: IconName.Chat,
    panel: ChatPanel
  });
  SidebarModel.instance.register({
    id: MathsPanel_ID,
    name: 'Maths RGS',
    order: 5.3,
    icon: IconName.Code,
    panel: MathsPanel
  });
  SidebarModel.instance.register({
    id: 'image-editor',
    name: 'AI Image Editor',
    order: 5.4,
    icon: IconName.Image,
    panel: ImageEditorPanel
  });

  SidebarModel.instance.register({
    id: 'project-styles',
    name: 'Project Styles',
    order: 5.45,
    icon: IconName.Palette,
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

  SidebarModel.instance.register({
    id: 'cloudservice',
    name: 'Cloud Services',
    isDisabled: isLesson === true,
    order: 6,
    placement: 'bottom',
    icon: IconName.CloudData,
    panel: CloudServicePanel
  });

  SidebarModel.instance.register({
    id: 'cloud-functions',
    name: 'Cloud Functions',
    isDisabled: isLesson === true,
    order: 7,
    placement: 'bottom',
    icon: IconName.CloudFunction,
    panel: CloudFunctionsPanel
  });

  SidebarModel.instance.register({
    id: 'settings',
    name: 'Project settings',
    order: 8,
    placement: 'bottom',
    icon: IconName.Setting,
    panel: ProjectSettingsPanel
  });

  if (config.devMode) {
    SidebarModel.instance.register({
      experimental: true,
      id: 'file-explorer',
      name: 'File Explorer',
      order: 19,
      icon: IconName.FolderOpen,
      panel: FileExplorerPanel
    });

    SidebarModel.instance.register({
      experimental: true,
      id: 'design-tokens',
      name: 'Design Tokens',
      order: 20,
      icon: IconName.Palette,
      panel: DesignTokenPanel
    });

    SidebarModel.instance.register({
      experimental: true,
      id: 'undo-queue',
      name: 'Undo Queue',
      order: 21,
      icon: IconName.Reset,
      panel: UndoQueuePanel
    });
  }

  SidebarModel.instance.register({
    experimental: true,
    id: NodeReferencesPanel_ID,
    name: 'Node References',
    description: 'Node References Panel is showing how many times each core node and component is used.',
    order: 23,
    icon: IconName.Component,
    panel: NodeReferencesPanel
  });

  SidebarModel.instance.register({
    id: 'editor-settings',
    name: 'Editor settings',
    order: 1,
    placement: 'bottom',
    icon: IconName.SlidersHorizontal,
    panel: EditorSettingsPanel
  });

  // TODO: Register MCP Server Browser panel via iframe bridge when available
}

export function installDocuments() {
  const appRegistry = AppRegistry.instance;

  // Register EditorDocumentProvider
  appRegistry.registerDocumentProvider(EditorDocumentProvider.ID, new EditorDocumentProvider());
  appRegistry.openDocument(EditorDocumentProvider.ID);

  appRegistry.registerDocumentProvider(ComponentDiffDocumentProvider.ID, new ComponentDiffDocumentProvider());

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
  }
}
