import { NodeGraphContextProvider } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { NodeReferencesContextProvider } from '@xgenia-contexts/NodeReferencesContext';
import { PluginContextProvider } from '@xgenia-contexts/PluginContext';
import { ProjectDesignTokenContextProvider } from '@xgenia-contexts/ProjectDesignTokenContext';
import { useKeyboardCommands } from '@xgenia-hooks/useKeyboardCommands';
import { useModel } from '@xgenia-hooks/useModel';
import { ipcRenderer } from 'electron';
import React, { useEffect, useState, Fragment } from 'react'; // Import Fragment
import { platform } from '@xgenia/platform';
import { App } from '@xgenia-models/app';
import { AppRegistry } from '@xgenia-models/app_registry';
import { CloudService } from '@xgenia-models/CloudServices';
import { NodeLibraryImporter } from '@xgenia-models/nodelibrary/NodeLibraryImporter';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { projectFromDirectory, unzipIntoDirectory } from '@xgenia-models/projectmodel.editor';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { GitStatus } from '@xgenia-models/gitstatus';
import { RailPresence } from '@xgenia-models/railpresence';
import { UndoQueue } from '@xgenia-models/undo-queue-model';
import { exportProjectComponents } from '@xgenia-utils/exportProjectComponets';
import FileSystem from '@xgenia-utils/filesystem';
import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';
import { LocalProjectsModel } from '@xgenia-utils/LocalProjectsModel';
import ParseDashboardServer from '@xgenia-utils/parsedashboardserver';
import ProjectImporter from '@xgenia-utils/projectimporter';
import ProjectValidator from '@xgenia-utils/projectvalidator';
import SchemaHandler from '@xgenia-utils/schemahandler';
import { guid } from '@xgenia-utils/utils';

import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';
import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary';
import { CommandPalette } from '../../views/CommandPalette/CommandPalette';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { installSidePanel, installDocuments } from '../../router.setup';
import { ViewerConnection } from '../../ViewerConnection';
import { Frame } from '../../views/common/Frame';
import ImportPopup from '../../views/importpopup';
import { LessonLayer } from '../../views/lessonlayer2';
import { NodePickerClearNews } from '../../views/NodePicker/NodePicker.hooks';
import PopupLayer from '../../views/popuplayer';
import { Rail } from '../../views/Rail';
import { LeftPanelCard } from '../../views/LeftPanelCard';
import { RightPropertyPanel } from '../../views/RightPropertyPanel';
import { ToastLayer } from '../../views/ToastLayer/ToastLayer';
import { BaseWindow } from '../../views/windows/BaseWindow';
import { whatsnewRender } from '../../whats-new';
import { IRouteProps } from '../AppRoute';
import { ToolsModel, ToolMetadata, ToolsModelEvent } from '../../models/ToolsModel';
import { ToolsModalViewer } from '../../views/ToolsModalViewer/ToolsModalViewer';
import { Keybindings } from '../../constants/Keybindings';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImportOverwritePopupTemplate = require('../../templates/importoverwritepopup.html');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ImportPopupTemplate = require('../../templates/importpopup.html');

if (import.meta.webpackHot) {
    import.meta.webpackHot.accept('../../router.setup', () => {
        // `reset()` wipes the layout back to its defaults, so the whole thing — active
        // panel, home panel and open state — is captured first and put back in a single
        // `restore` dispatch. Re-opening only the active id used to leave `homeId` pointing
        // at the default panel instead of the chat, so after any hot reload a second rail
        // click went "home" to the wrong panel. A restore naming a panel this build no
        // longer registers is refused by dispatch(), which leaves the defaults in place.
        const layout = SidebarModel.instance.Layout;

        SidebarModel.instance.reset();

        setupSidePanels();

        SidebarModel.instance.notifyListeners(SidebarModelEvent.HotReload);

        SidebarModel.instance.dispatch({ type: 'restore', ...layout });
    });
}

function setupSidePanels() {
    const isLesson = ProjectModel.instance.isLesson();

    installSidePanel({ isLesson });
}

export type EditorPageProps = IRouteProps;

// Define ToolInfo interface (or import if defined elsewhere)
interface ToolInfo {
    name: string;
    id: string;
    type?: 'tool' | 'action'; // This is for generic actions, not XGENIA tools from ToolsModel
    category?: string;
    description?: string;
}

export function EditorPage({ route }: EditorPageProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
    const [availableTools, setAvailableTools] = useState<ToolInfo[]>([]);
    const [xgeniaToolsList, setXgeniaToolsList] = useState<ToolMetadata[]>([]);
    const [selectedTool, setSelectedTool] = useState<ToolMetadata | null>(null);
    const [isToolsModalVisible, setIsToolsModalVisible] = useState(false);

    const appRegistry = useModel(AppRegistry.instance, ['documentChanged']);

    const Document = appRegistry.getActiveDocument();

    const [lesson, setLesson] = useState(null);
    const [isRightPanelActive, setIsRightPanelActive] = useState(false);

    useEffect(() => {
        whatsnewRender();
        NodePickerClearNews();
        SchemaHandler.instance = new SchemaHandler();

        if (!ProjectModel.instance.isLesson()) {
            CloudService.instance.prefetch();
        }

        setupSidePanels();
        installDocuments();

        const eventGroup = {};

        App.instance.off(this).on(
            'exitEditor',
            () => {
                route.router.route({ to: 'projects' });
                ipcRenderer.send('project-closed');
            },
            this
        );

        EventDispatcher.instance.on('projectChangedOnDisk', () => reloadProjectFromDisk(), eventGroup);
        EventDispatcher.instance.on('importFromUrl', (url) => importFromUrl(url), eventGroup);
        EventDispatcher.instance.on(
            'ProjectModel.saveFailedRetryScheduled',
            () => {
                ToastLayer.showError('Failed to save project, retrying...', 3000);
            },
            eventGroup
        );

        // `restoreLayout` applies the stored layout synchronously before it awaits anything,
        // so the model is already correct here and the editor's first frame paints the right
        // panel. Do NOT await it before releasing the loading gate: settings live in a file
        // under Electron, so awaiting holds the ENTIRE editor on the spinner behind a disk
        // read, which trades a panel that flashes for a whole window that does.
        void SidebarModel.instance
            .restoreLayout()
            .catch((err) => console.error('[EditorPage] Failed to restore the panel layout:', err));
        setIsLoading(false);
        void GitStatus.refresh();
        ipcRenderer.send('project-opened', ProjectModel.instance.name);

        // Initialize the ToolsModel and listen for tool updates
        console.log('[EditorPage] Initializing ToolsModel integration.');

        const toolsModelListener = (loadedTools: readonly ToolMetadata[]) => {
            const toolsArray = loadedTools ? [...loadedTools] : [];
            console.log(`[EditorPage] ToolsModelEvent.ToolsLoaded received. ${toolsArray.length} tools. Attempting to setXgeniaToolsList.`);
            setXgeniaToolsList(toolsArray);
        };
        // Use eventGroup for proper cleanup - Model base class uses group-based listeners
        ToolsModel.instance.on(ToolsModelEvent.ToolsLoaded, toolsModelListener, eventGroup);
        console.log('[EditorPage] ToolsModelEvent.ToolsLoaded listener registered.');

        // Listen for errors from ToolsModel
        const toolsModelErrorListener = (errorMessage: string) => {
            console.error(`[EditorPage] ToolsModelEvent.Error received: ${errorMessage}`);
            // ToastLayer.showError(`Tools Error: ${errorMessage}`, 5000);
        };
        ToolsModel.instance.on(ToolsModelEvent.Error, toolsModelErrorListener, eventGroup);
        console.log('[EditorPage] ToolsModelEvent.Error listener registered.');

        const attemptScanToolsProject = () => {
            if (ProjectModel.instance && ProjectModel.instance._retainedProjectDirectory) {
                console.log('[EditorPage] ProjectModel instance and _retainedProjectDirectory are available. Scanning for tools.');
                ToolsModel.instance.scanToolsProject();
            } else {
                console.warn('[EditorPage] Attempted to scan tools, but ProjectModel instance or _retainedProjectDirectory is not yet available.');
                // Optionally, you could set a state here to retry or wait, but ToolsModel itself logs an error if path isn't found.
            }
        };

        // Listen for when ProjectModel.instance changes
        const projectModelInstanceChangedListener = () => {
            console.log('[EditorPage] ProjectModel.instanceHasChanged event received.');
            attemptScanToolsProject();
        };
        EventDispatcher.instance.on('ProjectModel.instanceHasChanged', projectModelInstanceChangedListener, eventGroup);
        console.log('[EditorPage] ProjectModel.instanceHasChanged listener registered.');

        // Initial check: If project is already loaded when EditorPage mounts
        console.log('[EditorPage] Performing initial check for ProjectModel readiness.');
        attemptScanToolsProject();

        return function () {
            EventDispatcher.instance.off(eventGroup);
            ToolsModel.instance.off(eventGroup); // Clean up ToolsModel listeners

            if (SchemaHandler.instance) {
                SchemaHandler.instance.dispose();
                SchemaHandler.instance = null;
            }
            ParseDashboardServer.instance.stop();
            CloudService.instance.reset();
            SidebarModel.instance.reset();
            UndoQueue.instance.clear();
            GitStatus.reset();
            RailPresence.reset();
        };
    }, []); // Empty dependency array: runs once on mount

    // Version control badge: recheck on an undo-history change (debounced) and whenever the
    // window regains focus (a commit or push made outside the editor, e.g. from a terminal).
    useEffect(() => {
        const group = {};
        EventDispatcher.instance.on('Model.undoHistoryChanged', () => GitStatus.scheduleRefresh(5000), group);
        const onFocus = () => void GitStatus.refresh();
        window.addEventListener('focus', onFocus);
        return () => { EventDispatcher.instance.off(group); window.removeEventListener('focus', onFocus); };
    }, []);

    // Track when right-side panel changes (independent of left sidebar)
    useEffect(() => {
        const eventGroup = {};
        SidebarModel.instance.on(
            SidebarModelEvent.rightPanelChanged,
            (panelId: string | null) => {
                setIsRightPanelActive(!!panelId);
            },
            eventGroup
        );
        // Check initial state
        setIsRightPanelActive(!!SidebarModel.instance.RightPanelId);
        return () => {
            SidebarModel.instance.off(eventGroup);
        };
    }, []);

    // New useEffect to log xgeniaToolsList changes
    useEffect(() => {
        console.log('[EditorPage] xgeniaToolsList state changed. Current count:', xgeniaToolsList.length);
        if (xgeniaToolsList.length > 0) {
            console.log('[EditorPage] xgeniaToolsList content:', xgeniaToolsList.map(t => t.name));
        }
    }, [xgeniaToolsList]);

    useKeyboardCommands(() => [
        {
            handler: () => SidebarModel.instance.switch('search'),
            keybinding: KeyMod.CtrlCmd | KeyCode.KEY_F
        },
        {
            handler: () => EventDispatcher.instance.emit('viewer-open-devtools'),
            keybinding: KeyMod.CtrlCmd | KeyCode.KEY_D
        },
        {
            handler: () => ipcRenderer.send('cloud-runtime-open-devtools'),
            keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_R
        },
        {
            handler: () => EventDispatcher.instance.emit('viewer-refresh'),
            keybinding: KeyMod.CtrlCmd | KeyCode.KEY_R
        },
        {
            handler: () => {
                NodeLibraryImporter.instance.clear();
                EventDispatcher.instance.emit('viewer-refresh');
                ipcRenderer.send('cloud-runtime-refresh');
                ToastLayer.showInteraction('Refresh Node Library and viewers');
            },
            keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_X
        },
        {
            handler: () => exportProjectComponents(),
            keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_E
        },
        {
            handler: async () => {
                const environment = await CloudService.instance.getActiveEnvironment(ProjectModel.instance);
                if (environment) {
                    ParseDashboardServer.instance.openInWindow(environment);
                }
            },
            keybinding: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_P
        },
        {
            handler: async () => {
                const environment = await CloudService.instance.getActiveEnvironment(ProjectModel.instance);
                if (environment) {
                    ParseDashboardServer.instance.openInBrowser(environment);
                }
            },
            keybinding: KeyMod.CtrlCmd | KeyCode.KEY_P
        },
        {
            handler: () => {
                console.log('[EditorPage] CMD+K handler triggered.');
                const currentModelTools = ToolsModel.instance.tools;
                const modelToolsArray = currentModelTools ? [...currentModelTools] : [];

                console.log(`[EditorPage] CMD+K: Forcing update of xgeniaToolsList with current model tools (count: ${modelToolsArray.length}).`);
                setXgeniaToolsList(modelToolsArray);

                // Use setTimeout to allow React to process the setXgeniaToolsList update
                // and re-render EditorPage before CommandPalette is opened.
                setTimeout(() => {
                    console.log('[EditorPage] CMD+K (in setTimeout): Setting isCommandPaletteOpen to true.');
                    setIsCommandPaletteOpen(true);
                }, 0);
            },
            keybinding: KeyMod.CtrlCmd | KeyCode.KEY_K,
        },
        {
            handler: () => SidebarModel.instance.toggleCard(),
            keybinding: Keybindings.TOGGLE_LEFT_PANEL.hash
        },
        ...Keybindings.RAIL_ITEMS.map((kb, i) => ({
            handler: () => EventDispatcher.instance.emit('rail-shortcut', i),
            keybinding: kb.hash
        })),
    ], [xgeniaToolsList]); // Keep dependency to ensure handler has access to latest xgeniaToolsList if needed for other logic (though we fetch directly now)

    // Effect to open the command palette *after* xgeniaToolsList might have been updated by CMD+K handler
    useEffect(() => {
        // This effect runs when isCommandPaletteOpen is true OR when xgeniaToolsList changes *if* we intend to open it.
        // To specifically handle the CMD+K case, we check if it was *meant* to be opened.
        // However, the CMD+K handler itself now directly calls setIsCommandPaletteOpen or relies on a re-render.
        // For now, just log the change to isCommandPaletteOpen as before.
        console.log('[EditorPage] isCommandPaletteOpen state changed to:', isCommandPaletteOpen);
    }, [isCommandPaletteOpen]);

    useEffect(() => {
        if (!ProjectModel.instance.isLesson()) return;
        const lessonLayer = new LessonLayer();
        const projectModel = ProjectModel.instance;
        const element = lessonLayer.startLesson(projectModel.getLessonModel());
        setLesson({ el: element });
        return () => {
            lessonLayer.dispose();
        };
    }, []);

    const handleToolSelected = (tool: ToolInfo) => {
        console.log('[EditorPage] Generic action selected from CommandPalette:', tool);
        // Handle generic palette actions here if needed (e.g., from a static list passed to CommandPalette)
    };

    const handleXgeniaToolSelected = (tool: ToolMetadata) => {
        console.log('[EditorPage] XGENIA tool selected from CommandPalette:', tool);
        setSelectedTool(tool);
        setIsToolsModalVisible(true);
    };

    const handleToolsModalClose = () => {
        setIsToolsModalVisible(false);
        setSelectedTool(null);
    };

    const handleToolResult = (result: any) => {
        console.log('[EditorPage] Tool result received:', result);
        // TODO: Handle tool results (e.g., add to project, save files, etc.)
    };

    return (
        <NodeGraphContextProvider>
            <NodeReferencesContextProvider>
                <ProjectDesignTokenContextProvider>
                    <PluginContextProvider>
                        <BaseWindow>
                            <Fragment>
                                {isLoading ? (
                                    <ActivityIndicator />
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
                                            <Rail />
                                            {/*
                                              `position: relative` here is what the editor top bar anchors to. The bar is
                                              absolutely positioned inside EditorDocument; its nearest positioned ancestor
                                              is this row, so it spans the left card + document + inspector and never moves
                                              when either card opens or closes. Both cards clear it with a 46px top margin.
                                            */}
                                            <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', position: 'relative' }}>
                                                <LeftPanelCard />
                                                <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                                                    <ErrorBoundary>{Boolean(Document) && <Document />}</ErrorBoundary>
                                                </div>
                                                {isRightPanelActive && <RightPropertyPanel />}
                                            </div>
                                        </div>

                                        {Boolean(lesson) && <Frame instance={lesson} isContentSize isFitWidth />}

                                        <CommandPalette
                                            isOpen={isCommandPaletteOpen}
                                            onClose={() => setIsCommandPaletteOpen(false)}
                                            tools={availableTools}
                                            xgeniaTools={xgeniaToolsList}
                                            onToolSelected={handleToolSelected}
                                            onXgeniaToolSelected={handleXgeniaToolSelected}
                                        />

                                        <ToolsModalViewer
                                            tool={selectedTool}
                                            isVisible={isToolsModalVisible}
                                            onClose={handleToolsModalClose}
                                            onToolResult={handleToolResult}
                                        />
                                    </>
                                )}
                            </Fragment>
                        </BaseWindow>
                    </PluginContextProvider>
                </ProjectDesignTokenContextProvider>
            </NodeReferencesContextProvider>
        </NodeGraphContextProvider>
    );
}

function importFromUrl(url: string): void {
    const activityId = 'import-from-url';

    PopupLayer.instance.hidePopup();

    ToastLayer.showActivity('Importing from url', activityId);

    const tmp = platform.getUserDataPath() + '/tmp/' + guid();
    FileSystem.instance.makeDirectory(tmp, function (r) {
        if (r.result !== 'success') {
            ToastLayer.hideActivity(activityId);
            ToastLayer.showError('Import failed');
            return;
        }

        unzipIntoDirectory(
            url,
            tmp,
            function (r) {
                ToastLayer.hideActivity(activityId);

                if (r.result !== 'success') {
                    ToastLayer.showError("Couldn't load project from URL");
                    return;
                }

                const validator = new ProjectValidator();
                validator.validateProjectDirectory(tmp);
                if (validator.hasErrors()) {
                    ToastLayer.showError('This is not a valid XGENIA project');
                    return;
                }

                _importProject(tmp);
            },
            { skipLoad: true, noAuth: true }
        );
    });
}

function _importProject(dirEntry: string): void {
    const activityId = 'import-project';
    ToastLayer.showActivity('Importing...', activityId);
    let selectedImports = {};

    ProjectImporter.instance.listComponentsAndDependencies(dirEntry, function (imports: any) {
        if (!imports) {
            ToastLayer.hideActivity(activityId);
            ToastLayer.showError('Could not load import project');
            return;
        }

        // Pre check all imports
        if (imports.components)
            imports.components.forEach((i: any) => {
                i.import = true;
            });

        if (imports.resources)
            imports.resources.forEach((r: any) => {
                r.import = true;
            });

        // Show popup and allow the user to choose which components to import
        const chooseImportsPopup = new ImportPopup({
            template: ImportPopupTemplate,
            imports: imports,
            onOk: () => {
                // User have made choice of what to import, check if there are any collisions
                selectedImports = chooseImportsPopup.getSelectedImports();
                ProjectImporter.instance.checkForCollisions(selectedImports, function (collisions: any) {
                    ToastLayer.hideActivity(activityId);
                    if (collisions === undefined) {
                        // No collisions
                        PopupLayer.instance.hideAllModalsAndPopups();
                        doImport(selectedImports);
                    } else {
                        // There is a collision for import, promt user if we should overwrite
                        const overwritePopup = new ImportPopup({
                            template: ImportOverwritePopupTemplate,
                            imports: collisions,
                            onOk: () => {
                                PopupLayer.instance.hideAllModalsAndPopups();
                                doImport(selectedImports);
                            },
                            onCancel: () => {
                                PopupLayer.instance.hideAllModalsAndPopups();
                            }
                        });
                        overwritePopup.render();
                        overwritePopup.el.css('width', '500px'); // Make it a little bit wider as a modal

                        PopupLayer.instance.showModal({
                            content: overwritePopup
                        });
                    }
                });
            },
            onCancel: () => {
                PopupLayer.instance.hideModal();
            }
        });
        chooseImportsPopup.render();
        chooseImportsPopup.el.css('width', '500px'); // Make it a little bit wider as a modal

        ToastLayer.hideActivity(activityId);
        PopupLayer.instance.showModal({
            content: chooseImportsPopup
        });
    });

    function doImport(imports: any): void {
        ToastLayer.showActivity('Importing...', activityId);

        ViewerConnection.instance.setWatchModelChangesEnabled(false);
        ProjectImporter.instance.import(dirEntry, imports, (r: any) => {
            ViewerConnection.instance.setWatchModelChangesEnabled(true);
            ToastLayer.hideActivity(activityId);

            if (r.result !== 'success') {
                ToastLayer.showError(r.message);
                return;
            }

            ToastLayer.showSuccess('Import successful');

            // Reload the viewer
            EventDispatcher.instance.emit('ProjectModel.importComplete');
            EventDispatcher.instance.emit('viewer-refresh');
        });
    }
}

function reloadProjectFromDisk(): void {
    const hasActiveProject =
        ProjectModel.instance && ProjectModel.instance._retainedProjectDirectory;
    if (!hasActiveProject) {
        return;
    }
    ViewerConnection.instance.setWatchModelChangesEnabled(false);
    ProjectModel.setSaveOnModelChange(false);

    console.log('[EditorPage] Reloading project from disk...');

    ProjectModel.instance.dispose(); // Unload current project

    projectFromDirectory(ProjectModel.instance._retainedProjectDirectory, (reloaded: any) => {
        ViewerConnection.instance.setWatchModelChangesEnabled(true);

        if (reloaded) {
            reloaded.id = ProjectModel.instance.id;

            console.log('[EditorPage] Project reloaded, setting new instance...');
            console.log('[EditorPage] Reloaded project metadata:', reloaded.metadata?.cloudservices);

            ProjectModel.instance = reloaded;

            // Make sure the correct projects model tracks changes
            LocalProjectsModel.instance.bindProject(reloaded);

            // CRITICAL FIX: Transfer cloud services metadata to runtime after reload
            const cloudServicesMetadata = reloaded.getMetaData('cloudservices');
            if (cloudServicesMetadata) {
                console.log('[EditorPage] Transferring cloud services metadata to runtime...');
                console.log('[EditorPage] Cloud services config:', JSON.stringify(cloudServicesMetadata, null, 2));

                // Transfer to runtime so CloudStore can access it
                const xgeniaRuntime = (window as any).XGENIA;
                if (xgeniaRuntime && typeof xgeniaRuntime.setMetaData === 'function') {
                    xgeniaRuntime.setMetaData('cloudservices', cloudServicesMetadata);
                    console.log('[EditorPage] ✅ Metadata transferred to XGENIA runtime');
                } else {
                    console.warn('[EditorPage] ❌ Xgenie runtime not available for metadata transfer');
                }

                // Also transfer other related metadata
                const dbVersionMajor = reloaded.getMetaData('dbVersionMajor');
                if (dbVersionMajor && xgeniaRuntime) {
                    xgeniaRuntime.setMetaData('dbVersionMajor', dbVersionMajor);
                }

                // Force CloudStore to reinitialize with new metadata
                try {
                    const cloudStoreClass = (window as any).CloudStore;
                    if (cloudStoreClass && cloudStoreClass.instance && typeof cloudStoreClass.instance._initCloudServices === 'function') {
                        console.log('[EditorPage] Forcing CloudStore to reinitialize...');
                        cloudStoreClass.instance._initCloudServices();
                        console.log('[EditorPage] ✅ CloudStore reinitialized with restored metadata');

                        // CRITICAL FIX: Refresh database collections after CloudStore reinitialization
                        // This ensures Create New Record nodes can see available tables
                        setTimeout(async () => {
                            try {
                                console.log('[EditorPage] Refreshing database collections after CloudStore reinitialization...');

                                // If Supabase is configured, rediscover tables to refresh the collections metadata
                                if (cloudServicesMetadata.supabase && cloudServicesMetadata.supabase.enabled) {
                                    console.log('[EditorPage] Triggering Supabase table discovery to refresh collections...');

                                    if (typeof cloudStoreClass.instance.discoverSupabaseTablesWithSchema === 'function') {
                                        const tables = await cloudStoreClass.instance.discoverSupabaseTablesWithSchema();
                                        console.log('[EditorPage] ✅ Supabase tables rediscovered:', tables?.length || 0, 'tables');

                                        // The CloudStore will automatically update the nodeGraph metadata with new collections
                                        // This will make collection dropdowns work properly in Create New Record nodes

                                        // Force all nodes to refresh their port definitions (collection dropdowns)
                                        if (reloaded && reloaded.graphModel) {
                                            reloaded.graphModel.emit('forceNodePortsUpdate');
                                            console.log('[EditorPage] ✅ Forced node ports update to refresh collection dropdowns');
                                        }
                                    }
                                }
                            } catch (error: any) {
                                console.warn('[EditorPage] Could not refresh database collections:', error.message);
                            }
                        }, 100); // Small delay to ensure CloudStore is fully initialized
                    }
                } catch (error: any) {
                    console.warn('[EditorPage] Could not reinitialize CloudStore:', error.message);
                }
            } else {
                console.log('[EditorPage] No cloud services metadata found in reloaded project');
            }

            ProjectModel.setSaveOnModelChange(true);

            console.log('[EditorPage] Project reload complete, Supabase config should be restored');
        }
    });
}

