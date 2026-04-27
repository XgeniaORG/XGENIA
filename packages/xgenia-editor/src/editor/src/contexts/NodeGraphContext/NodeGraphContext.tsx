// src/editor/src/contexts/NodeGraphContext/NodeGraphContext.tsx
import React, {
    createContext,
    useContext,
    useCallback,
    useState,
    useEffect,
    ReactNode
} from 'react';

import { ComponentModel } from '@xgenia-models/componentmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { isComponentModel_CloudRuntime } from '@xgenia-utils/NodeGraph';

import { CenterToFitMode, NodeGraphEditor } from '../../views/nodegrapheditor';
import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary'; // Import the correct ErrorBoundary

type NodeGraphID = 'frontend' | 'backend';

interface NodeGraphControlSwitchOptions {
    pushHistory: boolean;
    selectSheet?: boolean;
    breadcrumbs?: boolean;
    node?: TSFixme;
}

export interface NodeGraphControlContext {
    active: NodeGraphID;
    nodeGraph: NodeGraphEditor;
    switchToComponent(component: ComponentModel, options: NodeGraphControlSwitchOptions): void;
}

const NodeGraphContext = createContext<NodeGraphControlContext>(
    {} as NodeGraphControlContext
);


export interface NodeGraphContextProviderProps {
    children?: ReactNode; // children is optional
}

export class NodeGraphContextTmp {
    public static active: NodeGraphControlContext['active'];
    public static nodeGraph: NodeGraphControlContext['nodeGraph'];
    public static switchToComponent: NodeGraphControlContext['switchToComponent'];
    // Webview is set by CanvasView._setupWebview() for AI tools like get_rendered_output
    public static webview: Electron.WebviewTag | null = null;
}

// ------------------------------
// NodeGraphContextProvider Component
// ------------------------------
export function NodeGraphContextProvider({ children }: NodeGraphContextProviderProps) {
    const [active, setActive] = useState<NodeGraphID>(null);
    const [nodeGraph, setNodeGraph] = useState<NodeGraphEditor>(null);

    // Create node graph and support hot reloading it
    useEffect(() => {
        function createNodeGraph() {
            const newNodeGraph = new NodeGraphEditor({});
            newNodeGraph.render();
            return newNodeGraph;
        }

        let currentInstance = createNodeGraph();
        setNodeGraph(currentInstance);

        // Defer hot update callback so it doesn't run synchronously during render.
        if (import.meta.webpackHot) {
            import.meta.webpackHot.accept('../../views/nodegrapheditor', () => {
                setTimeout(() => {
                    const activeComponent = currentInstance.activeComponent;
                    currentInstance.dispose();
                    const newInstance = createNodeGraph();
                    newInstance.switchToComponent(activeComponent);
                    setNodeGraph(newInstance);
                    currentInstance = newInstance;
                }, 0);
            });
        }

        return () => {
            currentInstance.dispose();
        };
    }, []);

    const switchToComponent: NodeGraphControlContext['switchToComponent'] = useCallback(
        (component, options) => {
            if (!component || !nodeGraph) return;
            nodeGraph.switchToComponent(component, options);
        },
        [nodeGraph]
    );

    // Switch sidebar panel when components are selected in the node graph
    useEffect(() => {
        if (!nodeGraph) return;

        function _update(model: ComponentModel) {
            if (isComponentModel_CloudRuntime(model)) {
                setActive('backend');
                if (SidebarModel.instance.ActiveId === 'components') {
                    SidebarModel.instance.switch('cloud-functions');
                }
            } else {
                setActive('frontend');
                if (SidebarModel.instance.ActiveId === 'cloud-functions') {
                    SidebarModel.instance.switch('components');
                }
            }
        }

        const eventGroup = {};
        nodeGraph.on(
            'activeComponentChanged',
            ({ model }: { model: ComponentModel }) => {
                _update(model);
            },
            eventGroup
        );

        _update(nodeGraph.activeComponent);

        return () => {
            nodeGraph.off(eventGroup);
        };
    }, [nodeGraph]);

    // Screenshot helper
    useEffect(() => {
        function setupScreenshot() {
            window.resizeTo(1920, 1080);
            // Allow the resize to do its thing first.
            setTimeout(() => {
                nodeGraph.centerToFit(CenterToFitMode.AllNodes);
            }, 50);
        }
        // @ts-expect-error setupScreenshot` is not a known window property, adding for debugging.
        window.setupScreenshot = setupScreenshot;
        return () => {
            // @ts-expect-error Removing `setupScreenshot` from `window` for cleanup.
            window.setupScreenshot = undefined;
        };
    }, [nodeGraph]);

    // Set global on a singleton for code that can't access the react context.
    useEffect(() => {
        if (!nodeGraph) return;
        NodeGraphContextTmp.switchToComponent = switchToComponent;
        NodeGraphContextTmp.nodeGraph = nodeGraph;
        return () => {
            NodeGraphContextTmp.active = null;
            NodeGraphContextTmp.nodeGraph = null;
            NodeGraphContextTmp.switchToComponent = null;
        };
    }, [nodeGraph]);

    NodeGraphContextTmp.active = active;

    return (
        <NodeGraphContext.Provider
            value={{
                active,
                nodeGraph,
                switchToComponent
            }}
        >
            {/* No type assertion */}
            <ErrorBoundary>{children}</ErrorBoundary>
        </NodeGraphContext.Provider>
    );
}

export function useNodeGraphContext() {
    const context = useContext(NodeGraphContext);
    if (context === undefined) {
        throw new Error('useNodeGraphContext must be a child of NodeGraphContextProvider');
    }
    return context;
}
