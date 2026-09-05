import { useNodeGraphContext } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { useKeyboardCommands } from '@xgenia-hooks/useKeyboardCommands';
import usePrevious from '@xgenia-hooks/usePrevious';
import { OpenAiStore } from '@xgenia-store/AiAssistantStore';
import { ipcRenderer } from 'electron';
import React, { useCallback, useEffect, useState, useRef } from 'react';

import { IDocumentProvider } from '@xgenia-models/app_registry';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { EditorSettings } from '@xgenia-utils/editorsettings';
import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';
import { KeyboardCommand } from '@xgenia-utils/keyboardhandler';

import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { FrameDivider, FrameDividerOwner } from '@xgenia-core-ui/components/layout/FrameDivider';
import { MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { Frame } from '../../common/Frame';
import { PreviewSurface } from '../../VisualCanvas/PreviewSurface';
import { EditorTopbar } from '../../EditorTopbar';
import { HelpCenter } from '../../HelpCenter';
import { NodeGraphEditor } from '../../nodegrapheditor';
import { NodeGraphEditorNode } from '../../nodegrapheditor/NodeGraphEditorNode';
import { showContextMenuInPopup } from '../../ShowContextMenuInPopup';
import { useCanvasView } from './hooks/UseCanvasView';
import { useCaptureThumbnails } from './hooks/UseCaptureThumbnails';
import { useImportNodeset } from './hooks/UseImportNodeset';
import { useRouteInfos } from './hooks/UseRoutes';
import { useSetupNodeGraph } from './hooks/UseSetupNodeGraph';
import { TitleBar } from './titlebar';

type DocumentLayout = 'horizontal' | 'vertical' | 'detachedPreview';

function EditorDocument() {
  const titlebarViewInstance = TitleBar.instance;

  const { nodeGraph } = useNodeGraphContext();
  // this never changes, so saving it in a state
  // this way it doesnt have to check for it every render
  const [isLesson] = useState(ProjectModel.instance.isLesson());

  // EMERGENCY FIX: Add throttling to prevent runaway IPC loops
  const ipcThrottleRef = useRef({
    lastEventTimes: new Map(),
    THROTTLE_MS: 100,
    eventCount: 0,
    lastResetTime: Date.now(),
    MAX_EVENTS_PER_SECOND: 30, // REDUCED from 50
    isCircuitBreakerActive: false,
    totalBlockedEvents: 0,
    PERMANENT_DISABLE_THRESHOLD: 100 // Permanently disable after 100 blocked events
  });

  const throttledIpcSend = useCallback((eventName, ...args) => {
    const throttle = ipcThrottleRef.current;
    const now = Date.now();

    // If we've blocked too many events, permanently disable viewer IPC
    if (throttle.totalBlockedEvents > throttle.PERMANENT_DISABLE_THRESHOLD) {
      console.error(`[EditorDocument] VIEWER IPC PERMANENTLY DISABLED: Blocked ${throttle.totalBlockedEvents} events. Viewer functionality disabled to prevent crashes.`);
      return false;
    }

    // Reset counter every second
    if (now - throttle.lastResetTime > 1000) {
      throttle.eventCount = 0;
      throttle.lastResetTime = now;
      if (throttle.isCircuitBreakerActive) {
        console.log('[EditorDocument] IPC circuit breaker reset');
        throttle.isCircuitBreakerActive = false;
      }
    }

    // Circuit breaker
    if (throttle.eventCount > throttle.MAX_EVENTS_PER_SECOND) {
      if (!throttle.isCircuitBreakerActive) {
        console.error(`[EditorDocument] IPC CIRCUIT BREAKER: Too many events (${throttle.eventCount}/sec). Activating emergency protection.`);
        throttle.isCircuitBreakerActive = true;

        // Send emergency reset signal once
        try {
          ipcRenderer.send('emergency-reset-viewer');
        } catch (error: any) {
          console.error('[EditorDocument] Failed to send emergency reset:', error);
        }
      }
      throttle.totalBlockedEvents++;
      return false; // Event blocked
    }

    // Event-specific throttling
    const lastTime = throttle.lastEventTimes.get(eventName) || 0;
    if (now - lastTime < throttle.THROTTLE_MS) {
      console.log(`[EditorDocument] Throttling ${eventName}`);
      throttle.totalBlockedEvents++;
      return false; // Event blocked
    }

    throttle.lastEventTimes.set(eventName, now);
    throttle.eventCount++;

    // Send the event
    console.log(`[EditorDocument] Sending throttled IPC: ${eventName}`);
    try {
      ipcRenderer.send(eventName, ...args);
      return true; // Event sent
    } catch (error: any) {
      console.error(`[EditorDocument] Failed to send IPC ${eventName}:`, error);
      return false;
    }
  }, []);

  useKeyboardCommands(() => createKeyboardCommands(nodeGraph), [nodeGraph]);
  const routeInfos = useRouteInfos(ProjectModel.instance, EventDispatcher.instance);

  const [documentLayout, setDocumentLayout] = useState<DocumentLayout>(isLesson ? 'vertical' : 'horizontal');
  const previousDocumentLayout = usePrevious(documentLayout);

  const [zoomFactor, setZoomFactor] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: null, height: null, deviceName: null });
  const [frameDividerSize, setFrameDividerSize] = useState(undefined);

  const [enableAi, setEnableAi] = useState(OpenAiStore.getVersion() !== 'disabled');

  useEffect(() => {
    const group = {};
    EditorSettings.instance.on(
      'updated',
      () => {
        console.log('ai', OpenAiStore.getVersion());
        setEnableAi(OpenAiStore.getVersion() !== 'disabled');
      },
      group
    );
    return function () {
      EditorSettings.instance.off(group);
    };
  }, []);

  const [selectedNodeId, setSelectedNodeId] = useState(null); //The ID of the selected node, as highlighted by the viewer

  const [hasLoadedEditorSettings, setHasLoadedEditorSettings] = useState(false);



  const [navigationState, setNavigationState] = useState({
    canGoBack: false,
    canGoForward: false,
    route: '/'
  });

  const [previewMode, setPreviewMode] = useState(() => {
    console.log('[EditorDocument] Initializing previewMode = true');
    return true;
  });

  const viewerDetached = documentLayout === 'detachedPreview';

  const canvasView = useCanvasView(setNavigationState);

  useKeyboardCommands(() => [
    {
      handler: () => {
        console.log('[EditorDocument] Keyboard shortcut toggling previewMode');
        setPreviewMode((previewMode) => {
          const newMode = !previewMode;
          console.log(`[EditorDocument] Keyboard shortcut: previewMode ${previewMode} -> ${newMode}`);
          return newMode;
        });
      },
      keybinding: KeyMod.CtrlCmd | KeyCode.KEY_T
    }
  ]);

  useImportNodeset(nodeGraph);

  //close detached viewer when EditorDocmument unmounts
  useEffect(() => {
    return () => {
      throttledIpcSend('viewer-attach', {});
    };
  }, [throttledIpcSend]);

  useEffect(() => {
    if (!viewportSize.width && !zoomFactor) {
      setZoomFactor(1);
    }
  }, [zoomFactor, viewportSize]);

  useSetupNodeGraph(nodeGraph);

  //track which nodes is currently selected. A hack that relies on the side panel to tell us.
  useEffect(() => {
    const eventGroup = {};
    SidebarModel.instance.on(
      SidebarModelEvent.nodeSelected,
      (nodeId) => {
        setSelectedNodeId(nodeId);
      },
      eventGroup
    );

    SidebarModel.instance.on(
      SidebarModelEvent.activeChanged,
      (activeId) => {
        const isNodePanel = activeId === 'PropertyEditor' || activeId === 'PortEditor';
        if (isNodePanel === false) {
          setSelectedNodeId(null);
        }
      },
      eventGroup
    );

    return () => {
      SidebarModel.instance.off(eventGroup);
    };
  }, [nodeGraph]);

  useEffect(() => {
    // EMERGENCY: Skip viewer operations if IPC is disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      console.warn('[EditorDocument] Skipping viewer operations - IPC permanently disabled');
      return;
    }

    if (viewerDetached) {
      throttledIpcSend('viewer-detach', {
        zoomFactor,
        route: navigationState.route,
        viewportSize,
        inspectMode: previewMode ? false : true,
        selectedNodeId
      });

      const onViewerInspectNode = (_event, nodeId) => {
        EventDispatcher.instance.emit('inspectNodes', { nodeIds: [nodeId] });
      };

      ipcRenderer.on('viewer-inspect-node', onViewerInspectNode);
      return () => {
        ipcRenderer.off('viewer-inspect-node', onViewerInspectNode);
      };
    } else {
      throttledIpcSend('viewer-attach', {});
    }
  }, [viewerDetached, canvasView, throttledIpcSend]);

  useEffect(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    const inspectMode = previewMode ? false : true;
    console.log(`[EditorDocument] useEffect: previewMode=${previewMode}, inspectMode=${inspectMode}`);

    // Add a small delay to ensure webview APIs are ready after React 19 upgrade
    const timeoutId = setTimeout(() => {
      throttledIpcSend('viewer-set-inspect-mode', inspectMode);
      canvasView?.setInspectMode(inspectMode);

      if (previewMode) {
        canvasView?.setNodeSelected(null);
        throttledIpcSend('viewer-select-node', null);
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [previewMode, canvasView, throttledIpcSend]);

  useEffect(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    if (!previewMode) {
      // Add a small delay to ensure webview APIs are ready
      const timeoutId = setTimeout(() => {
        canvasView?.setNodeSelected(selectedNodeId);
        ipcRenderer.send('viewer-select-node', selectedNodeId);
      }, 100);

      return () => clearTimeout(timeoutId);
    }
  }, [selectedNodeId, canvasView, previewMode]);

  const onRouteChanged = useCallback(
    (route) => {
      // EMERGENCY: Skip if IPC disabled
      if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
        return;
      }

      canvasView?.setCurrentRoute(route);
      throttledIpcSend('viewer-set-route', route);
    },
    [canvasView, throttledIpcSend]
  );

  const onUrlNavigateBack = useCallback(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    throttledIpcSend('viewer-navigate-back');
    canvasView?.navigateBack();
  }, [canvasView, throttledIpcSend]);

  const onUrlNavigateForward = useCallback(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    throttledIpcSend('viewer-navigate-forward');
    canvasView?.navigateForward();
  }, [canvasView, throttledIpcSend]);

  const onPreviewSizeChanged = useCallback((width, height, deviceName) => {
    setViewportSize({ width, height, deviceName });
  }, []);

  useEffect(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    throttledIpcSend('viewer-set-zoom-factor', zoomFactor);
    canvasView?.setZoomFactor(zoomFactor);
  }, [zoomFactor, canvasView, throttledIpcSend]);

  useEffect(() => {
    // EMERGENCY: Skip if IPC disabled
    if (ipcThrottleRef.current.totalBlockedEvents > ipcThrottleRef.current.PERMANENT_DISABLE_THRESHOLD) {
      return;
    }

    canvasView?.setViewportSize(viewportSize);
    throttledIpcSend('viewer-set-viewport-size', viewportSize);
  }, [viewportSize, canvasView, throttledIpcSend]);

  useEffect(() => {
    const eventGroup = {};

    if (documentLayout === 'detachedPreview') {
      EventDispatcher.instance.on(
        'viewer-closed',
        () => {
          setDocumentLayout(previousDocumentLayout || 'horizontal');
        },
        eventGroup
      );
    }

    EventDispatcher.instance.on(
      'viewer-open-devtools',
      () => {
        if (documentLayout === 'detachedPreview') {
          ipcRenderer.send('viewer-open-devtools');
        } else {
          canvasView?.openDevTools();
        }
      },
      eventGroup
    );

    EventDispatcher.instance.on('viewer-refresh', () => canvasView?.refresh(), eventGroup);

    //drag handles on the preview frame ask for a new viewport size
    EventDispatcher.instance.on(
      'preview-size-request',
      ({ width, height, deviceName }: { width: number; height: number; deviceName: string | null }) => {
        onPreviewSizeChanged(width, height, deviceName);
      },
      eventGroup
    );

    //refresh viewer when cloud services are changed
    ProjectModel.instance.on(
      'cloudServicesChanged',
      () => {
        EventDispatcher.instance.notifyListeners('viewer-refresh');
      },
      eventGroup
    );

    // Listen for hover highlighting from inspector
    EventDispatcher.instance.on(
      'inspector-node-highlight',
      (message) => {
        if (message && message.nodeId && nodeGraph) {
          const node = nodeGraph.findNodeWithId(message.nodeId);
          if (node) {
            // Highlight the node - use the node's actual position
            nodeGraph.setHighlightedNode(node, { x: node.x + node.nodeSize.width / 2, y: node.y + node.nodeSize.height / 2 });
            nodeGraph.repaint();
          } else {
            // Clear highlight if node not found
            nodeGraph.setHighlightedNode(null, null);
            nodeGraph.repaint();
          }
        } else {
          // Clear highlight if no node ID
          nodeGraph.setHighlightedNode(null, null);
          nodeGraph.repaint();
        }
      },
      eventGroup
    );

    //this is sent by viewers in design mode, and lessons
    EventDispatcher.instance.on(
      'inspectNodes',
      (args) => {
        console.log('[EditorDocument] 🎯 RECEIVED inspectNodes event:', args);
        if (args.nodeIds.length === 1) {
          // Select node - use the node graph editor's findNodeWithId method which returns NodeGraphEditorNode
          const nodeId = args.nodeIds[0];
          console.log('[EditorDocument] Looking for node with ID:', nodeId);
          const allNodes: NodeGraphEditorNode[] = [];
          nodeGraph.forEachNode((node) => {
            allNodes.push(node);
          });
          console.log('[EditorDocument] Total nodes in graph:', allNodes.length);
          console.log('[EditorDocument] First 5 node IDs:', allNodes.slice(0, 5).map(n => n.id));
          const node = nodeGraph.findNodeWithId(nodeId);
          console.log('[EditorDocument] Node found:', !!node, 'Node details:', node ? { id: node.id, label: node.model?.label, type: node.model?.type } : 'null');

          if (node) {
            // Select the node in the current graph
            nodeGraph.clearSelection();
            nodeGraph.selectNode(node);
            console.log('[EditorDocument] Selected node in current graph:', node.id);

            // Show a brief notification that the node was selected
            console.log(`[Inspector] ✅ Node "${node.model.label || node.id}" selected in editor via visual inspector!`);
          } else {
            console.warn('[EditorDocument] Node not found with ID:', args.nodeIds[0]);
            // Show notification that node was not found
            setTimeout(() => {
              console.log(`[Inspector] ❌ Node "${args.nodeIds[0]}" not found in project. Make sure components are properly registered.`);
            }, 100);
          }
        } else {
          const nodes = args.nodeIds.map((id) => ProjectModel.instance.findNodeWithId(id)).filter((node) => !!node);

          const components = [nodes[0]];
          for (let i = 1; i < nodes.length; i++) {
            if (components[components.length - 1].owner.owner !== nodes[i].owner.owner) {
              components.push(nodes[i]);
            }
          }

          if (documentLayout === 'detachedPreview') {
            ipcRenderer.send(
              'viewer-show-inspect-menu',
              components.map((node) => ({
                label: node.owner.owner.name + ' - ' + node.label,
                nodeId: node.id
              }))
            );
          } else {
            const items = components.map((node) => ({
              label: node.owner.owner.name + ' - ' + node.label,
              onClick: () => {
                const component = node.owner.owner;
                nodeGraph.switchToComponent(component, { node: node, pushHistory: true });
              }
            }));
            showContextMenuInPopup({ title: 'Nodes behind cursor', items, width: MenuDialogWidth.Large });
          }
        }
      },
      eventGroup
    );

    //used by lessons
    EventDispatcher.instance.on(
      'setPreviewRoute',
      (args) => {
        onRouteChanged(args.url);
      },
      eventGroup
    );

    EventDispatcher.instance.on(
      'selectComponent',
      (args) => {
        const component = ProjectModel.instance.getComponentWithName(args.componentName);
        if (component) {
          nodeGraph.switchToComponent(component, { pushHistory: true });
        }
      },
      eventGroup
    );

    return () => {
      EventDispatcher.instance.off(eventGroup);
      if (ProjectModel.instance) {
        ProjectModel.instance.off(ProjectModel);
      }
    };
  }, [documentLayout, canvasView, previewMode, nodeGraph, onPreviewSizeChanged]);

  useEffect(() => {
    const onViewerNavigationState = (event, state) => {
      setNavigationState(state);
      //make sure canvas view is updated as well so the route matches if layout is changed
      canvasView?.setCurrentRoute(state.route);
    };

    ipcRenderer.on('viewer-navigation-state', onViewerNavigationState);

    return () => {
      ipcRenderer.off('viewer-navigation-state', onViewerNavigationState);
    };
  }, [canvasView]);

  // Save settings
  useEffect(() => {
    if (!hasLoadedEditorSettings) {
      return;
    }

    EditorSettings.instance.setMerge(ProjectModel.instance.id, {
      documentLayout,
      viewportSize,
      frameDividerSize,
      previewMode
    });

    const eventGroup = {};

    nodeGraph.on(
      'activeComponentChanged',
      ({ model }) =>
        EditorSettings.instance.setMerge(ProjectModel.instance.id, { selectedComponentName: model.fullName }),
      eventGroup
    );

    return () => {
      nodeGraph.off(eventGroup);
    };
  }, [hasLoadedEditorSettings, documentLayout, viewportSize, frameDividerSize, previewMode, nodeGraph]);

  // Apply settings
  useEffect(() => {
    setHasLoadedEditorSettings(true);

    const settings = EditorSettings.instance.get(ProjectModel.instance.id);

    if (!settings) {
      return;
    }

    if (settings.documentLayout) {
      setDocumentLayout(settings.documentLayout);
    }

    if (settings.viewportSize) {
      setViewportSize(settings.viewportSize);
    }

    if (settings.frameDividerSize) {
      setFrameDividerSize(settings.frameDividerSize);
    }

    // setEnableAi(settings[AI_ASSISTANT_ENABLED_KEY]);

    if (settings.selectedComponentName) {
      const component = ProjectModel.instance.getComponentWithName(settings.selectedComponentName);
      if (component) {
        nodeGraph.switchToComponent(component, { replaceHistory: true });
      }
    }

    if (settings.previewMode !== undefined) {
      setPreviewMode(settings.previewMode ? true : false);
    }
  }, [nodeGraph]);

  // useEffect(() => {
  //   const func = () => {
  //     setEnableAi(!!EditorSettings.instance.get(AI_ASSISTANT_ENABLED_KEY));
  //   };
  //
  //   func();
  //
  //   EditorSettings.instance.on('updated', func, group);
  //   return function () {
  //     EditorSettings.instance.off(group);
  //   };
  // }, []);

  useCaptureThumbnails(canvasView, viewerDetached);

  return (
    <Container direction={ContainerDirection.Vertical} isFill UNSAFE_style={{ position: 'relative' }}>
      <EditorTopbar
        instance={titlebarViewInstance}
        routeInfos={routeInfos}
        onRouteChanged={onRouteChanged}
        setDocumentLayout={setDocumentLayout}
        documentLayout={documentLayout}
        zoomFactor={zoomFactor}
        setZoomFactor={setZoomFactor}
        onUrlNavigateBack={onUrlNavigateBack}
        onUrlNavigateForward={onUrlNavigateForward}
        navigationState={navigationState}
        onPreviewSizeChanged={onPreviewSizeChanged}
        previewSize={viewportSize}
        onPreviewModeChanged={(newMode) => {
          console.log(`[EditorDocument] onPreviewModeChanged called: ${previewMode} -> ${newMode}`);
          setPreviewMode(newMode);
        }}
        previewMode={previewMode}
        nodeGraph={nodeGraph}
        deployIsDisabled={ProjectModel.instance.isLesson()}
      />
      {/* the topbar is position:absolute over this container, so the view area clears it with padding */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 'var(--topbar-height)'
        }}
      >
        {hasLoadedEditorSettings && (
          <ViewComponent
            documentLayout={documentLayout}
            canvasViewInstance={canvasView}
            nodeGraphEditorInstance={nodeGraph}
            frameDividerSize={frameDividerSize}
            onSizeUpdated={(size) => {
              setFrameDividerSize(size);
            }}
          />
        )}
      </div>

      <HelpCenter />

    </Container>
  );
}

function ViewComponent({
  canvasViewInstance,
  documentLayout,
  nodeGraphEditorInstance,
  onSizeUpdated,
  frameDividerSize
}: TSFixme) {
  const [frameBounds, setFrameBounds] = useState(undefined);

  const horizontal = documentLayout === 'horizontal';
  const totalSize = frameBounds ? (horizontal ? frameBounds.height : frameBounds.width) : undefined;

  // Canvas pane: viewport preview or the AI browser, switched from the status pill
  const canvasPane = (
    <PreviewSurface canvasViewInstance={canvasViewInstance} onResize={(bounds) => canvasViewInstance.resize(bounds)} />
  );

  // Node graph pane: plain Frame
  const nodeGraphPane = (
    <Frame instance={nodeGraphEditorInstance} onResize={(bounds) => nodeGraphEditorInstance.resize(bounds)} />
  );

  if (documentLayout === 'detachedPreview') {
    return nodeGraphPane;
  } else {
    const first = horizontal ? canvasPane : nodeGraphPane;
    const second = horizontal ? nodeGraphPane : canvasPane;

    return (
      <FrameDivider
        splitOwner={horizontal ? FrameDividerOwner.First : FrameDividerOwner.Second}
        horizontal={!horizontal}
        first={first}
        second={second}
        sizeMin={100}
        sizeMax={totalSize ? totalSize - 100 : undefined}
        size={frameDividerSize}
        onSizeChanged={(size) => {
          onSizeUpdated(size);
        }}
        onBoundsChanged={setFrameBounds}
      />
    );
  }
}

function createKeyboardCommands(nodeGraph: NodeGraphEditor) {
  const copy: KeyboardCommand = {
    handler: () => nodeGraph.copy(),
    keybinding: KeyMod.CtrlCmd | KeyCode.KEY_C
  };

  const paste: KeyboardCommand = {
    handler: () => nodeGraph.paste(),
    keybinding: KeyMod.CtrlCmd | KeyCode.KEY_V
  };

  const cut: KeyboardCommand = {
    handler: () => nodeGraph.cut(),
    keybinding: KeyMod.CtrlCmd | KeyCode.KEY_X
  };

  const undo: KeyboardCommand = {
    handler: () => nodeGraph.undo(),
    keybinding: KeyMod.CtrlCmd | KeyCode.KEY_Z
  };

  const redo: KeyboardCommand = {
    handler: () => nodeGraph.redo(),
    keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Z
  };

  const navBack: KeyboardCommand = {
    handler: () => nodeGraph.navigationHistory.goBack(),
    keybinding: KeyMod.CtrlCmd | KeyCode.US_OPEN_SQUARE_BRACKET
  };

  const navForward: KeyboardCommand = {
    handler: () => nodeGraph.navigationHistory.goForward(),
    keybinding: KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET
  };

  const deleteWithBackspace: KeyboardCommand = {
    handler: () => nodeGraph.delete(),
    keybinding: KeyCode.Backspace
  };

  const deleteWithDel: KeyboardCommand = {
    handler: () => nodeGraph.delete(),
    keybinding: KeyCode.Delete
  };

  const createComment: KeyboardCommand = {
    handler: () =>
      nodeGraph.activeComponent.graph.commentsModel.addComment(
        {
          text: '',
          fill: true,
          width: 150,
          height: 100,
          x: nodeGraph.latestMousePos.x,
          y: nodeGraph.latestMousePos.y
        },
        { undo: true, label: 'add comment', focusComment: true }
      ),
    keybinding: KeyMod.CtrlCmd | KeyCode.US_SLASH
  };

  return [copy, paste, cut, undo, redo, navBack, navForward, deleteWithBackspace, deleteWithDel, createComment];
}

export class EditorDocumentProvider implements IDocumentProvider {
  public static ID = 'EditorDocumentProvider';

  getComponent() {
    // React Component of the editor view (canvas, and node graph)
    return EditorDocument;
  }
}
