/**
 * EditorBridge — Host-side message handler for the AI Plugin iframe.
 *
 * Lives in the GPL editor codebase. Listens for postMessage commands
 * from the plugin iframe and executes them on the real GPL models.
 * Also pushes events to the iframe when the editor state changes.
 *
 * This file is GPL-licensed — it's part of the editor, not the plugin.
 */

// GPL model imports (this file intentionally lives in GPL code)
import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { NodeLibrary } from '@xgenia-models/nodelibrary';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';
import { guid } from '@xgenia-utils/utils';
import { platform } from '@xgenia/platform';
import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { supabase } from '../../../supabaseInit';
import {
    addProjectPalette,
    clearProjectBaseStyle,
    getProjectBaseStyleUrl,
    getProjectGlobalStylePrompt,
    getProjectPalettes,
    setProjectBaseStyle,
    setProjectGlobalStylePrompt
} from '../ProjectStylesPanel/ProjectStylesPanel';

interface PluginCommand {
    id: string;
    type: 'command';
    command: string;
    args?: any[];
}

type CommandExecutor = (args: any[]) => any;

export class EditorBridge {
    private iframes = new Map<string, HTMLIFrameElement>(); // pluginId -> iframe
    private iframe: HTMLIFrameElement | null = null; // Legacy: primary (AI chat) iframe
    private pluginOrigin = '*'; // Will be locked to plugin origin after handshake
    private commandHandlers = new Map<string, CommandExecutor>();
    private eventListeners = new Map<string, Set<(data: any) => void>>();
    private connected = false;
    private cachedActiveComponent: any = null;
    /** AI-locked component: when set, getActiveGraph() uses this instead of cachedActiveComponent.
     *  Prevents editor UI events from overriding the AI's intended target component. */
    private aiLockedComponent: any = null;
    private aiLockTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly AI_LOCK_TTL_MS = 120_000; // 2 minutes auto-expiry

    constructor() {
        this.registerCommands();
        window.addEventListener('message', this.handleMessage.bind(this));
        // Listen for active component changes from the NodeGraphEditor
        this.listenForComponentChanges();
        // Listen for settings changes (API keys) to push to plugins
        this.listenForSettingChanges();
    }

    /** Listen for NodeGraphEditor active component changes via EventDispatcher */
    private listenForComponentChanges() {
        try {
            EventDispatcher.instance.on(
                'activeComponentChanged',
                ({ component }: any) => {
                    console.log('[EditorBridge] Component switched to:', component?.name,
                        this.aiLockedComponent ? `(AI lock active on: ${this.aiLockedComponent.name})` : '(no AI lock)');

                    // Always update the editor-side cache for UI awareness
                    this.cachedActiveComponent = component || null;

                    // Notify the plugin iframe about the switch
                    if (this.connected && component) {
                        this.pushEvent('componentSwitched', {
                            name: component.name,
                            fullName: component.fullName,
                            aiLockActive: !!this.aiLockedComponent,
                        });
                    }
                    // NOTE: aiLockedComponent is NOT cleared here — getActiveGraph()
                    // will continue to use the AI-locked component until explicitly unlocked
                },
                this
            );
        } catch (e: any) {
            console.warn('[EditorBridge] Could not listen for component changes:', e);
        }
    }

    /** Listen for settings changes and push to plugin iframes */
    private listenForSettingChanges() {
        try {
            const { EditorSettings } = require('../../../utils/editorsettings');
            if (EditorSettings?.instance?.on) {
                EditorSettings.instance.on('updated', ({ key }: any) => {
                    if (key === 'fal.apiKey' || key === 'gemini.apiKey') {
                        const value = EditorSettings.instance.get(key);
                        console.log(`[EditorBridge] Setting updated: ${key}, pushing to plugins`);

                        this.pushEvent('settingChanged', { key, value });
                    }
                }, this);
            }
        } catch (e: any) {
            console.warn('[EditorBridge] Could not listen for setting changes:', e);
        }
    }

    /** Set or refresh the AI component lock with auto-expiry */
    private setAiLock(component: any) {
        this.aiLockedComponent = component;
        // Reset expiry timer
        if (this.aiLockTimer) clearTimeout(this.aiLockTimer);
        this.aiLockTimer = setTimeout(() => {
            console.log('[EditorBridge] AI lock expired after TTL, clearing lock on:', this.aiLockedComponent?.name);
            this.aiLockedComponent = null;
            this.aiLockTimer = null;
        }, EditorBridge.AI_LOCK_TTL_MS);
        console.log('[EditorBridge] AI lock set on:', component?.name);
    }

    /** Clear the AI component lock */
    private clearAiLock() {
        if (this.aiLockedComponent) {
            console.log('[EditorBridge] AI lock cleared (was on:', this.aiLockedComponent?.name, ')');
        }
        this.aiLockedComponent = null;
        if (this.aiLockTimer) {
            clearTimeout(this.aiLockTimer);
            this.aiLockTimer = null;
        }
    }

    /** Set the iframe reference (called when iframe mounts) */
    setIframe(iframe: HTMLIFrameElement, pluginId: string = 'xgenia-ai') {
        this.iframe = iframe; // Legacy compatibility
        this.iframes.set(pluginId, iframe);
    }

    /** Check if plugin is connected */
    isConnected(): boolean {
        return this.connected;
    }

    /** Push an event to the plugin */
    pushEvent(event: string, data?: any) {
        if (this.iframe?.contentWindow) {
            this.safePostMessage(this.iframe.contentWindow, { type: 'event', event, data }, this.pluginOrigin);
        } else {
            console.warn(`[EditorBridge] Cannot push event "${event}": iframe or contentWindow missing`);
        }
    }

    /** Robustly send a message handling potential TargetOrigin mismatch exceptions */
    private safePostMessage(windowProxy: WindowProxy, message: any, origin: string) {
        try {
            windowProxy.postMessage(message, origin);
        } catch (err) {
            console.warn(`[EditorBridge] Failed to postMessage with origin '${origin}', falling back to '*'`);
            try {
                windowProxy.postMessage(message, '*');
            } catch (err2) {
                console.error(`[EditorBridge] Critical failure sending postMessage even with '*' origin`, err2);
            }
        }
    }

    /** Register for events from the plugin */
    on(event: string, callback: (data: any) => void) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)?.add(callback);
    }

    /** Unregister from events from the plugin */
    off(event: string, callback: (data: any) => void) {
        this.eventListeners.get(event)?.delete(callback);
    }

    private dispatchEvent(event: string, data: any) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error(`[EditorBridge] Error in event listener for "${event}":`, e);
                }
            });
        }
    }

    /** Destroy the bridge */
    destroy() {
        window.removeEventListener('message', this.handleMessage.bind(this));
        this.iframe = null;
        this.connected = false;
    }

    // --- Internal ---

    private handleMessage = (event: MessageEvent) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object') return;

        // Handshake from plugin (AI chat or Image Editor)
        if (msg.type === 'handshake' && (msg.plugin === 'xgenia-ai' || msg.plugin === 'xgenia-image-editor')) {
            console.log(`[EditorBridge] Plugin handshake received from '${msg.plugin}':`, msg.version);
            this.connected = true;
            this.pluginOrigin = event.origin || '*';

            // Send handshake acknowledgment to the source iframe
            const sourceWindow = event.source as WindowProxy;
            if (sourceWindow) {
                this.safePostMessage(sourceWindow, { type: 'handshake-ack' }, this.pluginOrigin);
            }

            // Push initial state
            this.pushInitialState();
            return;
        }

        // Command from plugin
        if (msg.type === 'command' && msg.id && msg.command) {
            this.executeCommand(msg as PluginCommand, event);
            return;
        }

        // Event from plugin
        if (msg.type === 'event' && msg.event) {
            this.dispatchEvent(msg.event, msg.data);
            return;
        }
    };

    private async executeCommand(cmd: PluginCommand, event: MessageEvent) {
        const handler = this.commandHandlers.get(cmd.command);

        let response: any;
        if (!handler) {
            response = { id: cmd.id, type: 'response', error: `Unknown command: ${cmd.command}` };
        } else {
            try {
                const result = await handler(cmd.args || []);
                response = { id: cmd.id, type: 'response', result };
            } catch (err: any) {
                response = { id: cmd.id, type: 'response', error: err.message || String(err) };
            }
        }

        // Send response back to the originating plugin iframe
        const sourceWindow = (event.source as WindowProxy) || this.iframe?.contentWindow;
        const targetOrigin = event.origin || this.pluginOrigin || '*';
        
        if (sourceWindow) {
            this.safePostMessage(sourceWindow, response, targetOrigin);
        } else if (this.iframe?.contentWindow) {
            this.safePostMessage(this.iframe.contentWindow, response, targetOrigin);
        }
    }

    private pushInitialState() {
        // Push current project info when plugin connects
        try {
            const project = ProjectModel.instance as any;
            if (project) {
                this.pushEvent('projectLoaded', {
                    id: project.id,
                    name: project.name,
                    hasProject: true,
                });

                // Push active component (from cache, set by EventDispatcher listener)
                const activeComponent = this.cachedActiveComponent;
                if (activeComponent) {
                    console.log('[EditorBridge] Pushing active component:', activeComponent.name);
                    this.pushEvent('componentSwitched', {
                        name: activeComponent.name,
                        fullName: activeComponent.fullName,
                    });
                } else {
                    console.warn('[EditorBridge] No active component cached yet during initial state push');
                }

                // Check for a pending AI prompt from project creation (set by ProjectsView)
                const pendingPrompt = (window as any).__xgenia_pendingAIPrompt;
                if (pendingPrompt?.prompt) {
                    console.log('[EditorBridge] Found pending AI prompt, will forward to ChatPanel');
                    // Clear immediately to prevent re-delivery
                    delete (window as any).__xgenia_pendingAIPrompt;
                    // Delay slightly to let the plugin fully initialize its message handlers
                    setTimeout(() => {
                        this.pushEvent('initialPrompt', {
                            prompt: pendingPrompt.prompt,
                            images: pendingPrompt.images || [],
                            selectedModel: pendingPrompt.selectedModel,
                        });
                        console.log('[EditorBridge] Pushed initialPrompt event to ChatPanel');
                    }, 1000);
                }
            }
        } catch (e: any) {
            console.warn('[EditorBridge] Could not push initial state:', e);
        }
    }

    private registerCommands() {
        const h = (name: string, handler: CommandExecutor) => {
            this.commandHandlers.set(name, handler);
        };

        // --- Project commands ---
        h('project.getComponents', () => {
            const components = (ProjectModel.instance as any)?.getComponents?.() || [];
            return components.map((c: any) => this.serializeComponent(c));
        });

        h('project.getActiveComponent', () => {
            // Use AI-locked component when active (same priority as getActiveGraph)
            const comp = this.aiLockedComponent || this.cachedActiveComponent;
            return comp ? this.serializeComponent(comp) : null;
        });

        h('project.getId', () => {
            return (ProjectModel.instance as any)?.id || null;
        });

        h('project.getDirectory', () => {
            return (ProjectModel.instance as any)?._retainedProjectDirectory || null;
        });

        h('project.getComponentByName', ([name]: [string]) => {
            const components = (ProjectModel.instance as any)?.getComponents?.() || [];
            const found = components.find((c: any) => c.name === name || c.fullName === name);
            return found ? this.serializeComponent(found) : null;
        });

        h('project.getSettings', () => {
            const project = ProjectModel.instance;
            if (!project) return {};
            return {
                headCode: (project as any).getSettings?.()?.headCode || '',
                styles: (project as any).getSettings?.()?.styles || null
            };
        });

        h('project.setSetting', ([key, value]: [string, any]) => {
            const project = ProjectModel.instance;
            if (!project) throw new Error('No project instance');
            (project as any).setSetting?.(key, value);
        });

        h('project.saveFile', async ([args]: [{ filename: string, data: string, mimeType: string }]) => {
            if (!args?.filename || !args?.data) throw new Error('Missing filename or data');
            return await platform.saveFile(args.filename, args.data, args.mimeType || 'application/octet-stream');
        });

        h('project.importImage', async () => {
            const { ipcRenderer } = require('electron');
            return await ipcRenderer.invoke('image-editor:open-file');
        });

        h('project.listImages', async () => {
            return new Promise((resolve) => {
                const project = ProjectModel.instance as any;
                const projectDir = project?._retainedProjectDirectory;
                
                console.log('[EditorBridge] project.listImages requested. ProjectDir:', projectDir);

                if (!project || !projectDir) {
                    console.warn('[EditorBridge] project.listImages unreachable: project directory missing.');
                    resolve([]);
                    return;
                }

                project.listFilesInProjectDirectory(
                    (files: any[]) => {
                        try {
                            const results = (files || []).map(f => {
                                const relativePath = (f.fullPath && f.fullPath.startsWith(projectDir))
                                    ? f.fullPath.substring(projectDir.length).replace(/^[\\\/]+/, '')
                                    : f.fullPath || '';
                                return {
                                    fullPath: f.fullPath,
                                    relativePath: relativePath,
                                    name: f.name
                                };
                            });
                            console.log(`[EditorBridge] project.listImages returning ${results.length} images.`);
                            resolve(results);
                        } catch (e) {
                            console.error('[EditorBridge] listImages mapping error:', e);
                            resolve([]);
                        }
                    },
                    ['png', 'jpeg', 'jpg', 'svg', 'gif', 'webp']
                );
            });
        });

        h('project.getImageThumbnail', async ([filePath]: [string]) => {
            return new Promise((resolve) => {
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const project = ProjectModel.instance as any;
                    const projectDir = project?._retainedProjectDirectory;
                    
                    if (!projectDir) {
                        resolve(null);
                        return;
                    }

                    // Handle both absolute and relative paths
                    const fullPath = (filePath.startsWith('/') || filePath.includes(':'))
                        ? filePath 
                        : path.join(projectDir, filePath);

                    if (!fs.existsSync(fullPath)) {
                        resolve(null);
                        return;
                    }

                    // Directly read and return as Base64 to bypass ThumbnailCache's broken XHR
                    const buffer = fs.readFileSync(fullPath);
                    const ext = path.extname(fullPath).toLowerCase().substring(1) || 'png';
                    const mimeType = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
                    
                    resolve({
                        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`
                    });
                } catch (e) {
                    console.error('[EditorBridge] getImageThumbnail error:', e);
                    resolve(null);
                }
            });
        });


        h('html.translate', ([html, options]: [string, { omitRootWrapper?: boolean }?]) => {
            try {
                const { translateHtmlToXgeniaXml } = require('../../EditorTopbar/html-translator');
                return translateHtmlToXgeniaXml(html, options);
            } catch (err: any) {
                console.error('[EditorBridge] html.translate failed:', err.message);
                throw err;
            }
        });

        // --- Graph commands ---
        h('graph.getNodes', () => {
            const graph = this.getActiveGraph();
            if (!graph) return [];
            // NodeGraphModel has getRoots(), NOT getNodes()
            // Recursively collect all nodes (roots + their children)
            const allNodes: any[] = [];
            const collectNodes = (nodes: any[]) => {
                for (const node of nodes) {
                    allNodes.push(node);
                    if (node.children && Array.isArray(node.children)) {
                        collectNodes(node.children);
                    }
                }
            };
            const roots = graph.roots || [];
            collectNodes(roots);
            return allNodes.map((n: any) => this.serializeNode(n));
        });

        h('graph.getRoots', () => {
            const graph = this.getActiveGraph();
            if (!graph) {
                console.warn('[EditorBridge] graph.getRoots: no active graph');
                return [];
            }
            // roots may be on graph directly or on graph.model (NodeGraphEditor wrapper)
            const roots = graph.roots || graph.model?.roots || [];
            console.log('[EditorBridge] graph.getRoots:', roots.length, 'roots found');
            return roots.map((n: any) => this.serializeNode(n));
        });

        h('graph.createNode', ([data]: [any]) => {
            try {
                console.log('[EditorBridge] graph.createNode called with:', JSON.stringify(data, null, 2));

                const graph = this.getActiveGraph();
                if (!graph) {
                    console.error('[EditorBridge] graph.createNode: No active graph!');
                    throw new Error('No active graph');
                }

                const nodeType = data.type || data.typename;
                if (!nodeType) {
                    console.error('[EditorBridge] graph.createNode: No type provided!', data);
                    throw new Error('Node type is required');
                }

                // Use the canonical NodeGraphNode.fromJSON() pattern
                // This is how XGENIA itself creates nodes (see NodeGraphModel.fromJSON)
                const nodeId = guid();
                const nodeJSON: any = {
                    id: nodeId,
                    type: nodeType,  // CRITICAL: must be 'type' not 'typename' - triggers the setter
                    x: data.x ?? 100,
                    y: data.y ?? 100,
                    parameters: data.parameters || {},
                    ports: [],
                    dynamicports: [],
                    children: []
                };

                // Apply label via parameters
                if (data.label || data.name) {
                    nodeJSON.parameters.nodeLabel = data.label || data.name;
                }

                console.log('[EditorBridge] Creating node from JSON:', nodeJSON);
                const node = NodeGraphNode.fromJSON(nodeJSON);

                // FIX (2026-04-21 R37): Force-initialize static ports from the type definition.
                // For certain node types (notably the Logic family: And, Or, Not, Xor) the ports
                // exposed by `node.getPorts()` / `node.ports` come back empty immediately after
                // fromJSON. The subsequent port existence check in create_connection then fails
                // every attempt with "port 'a' does not exist". Pulling the type.ports up front
                // and calling node.addPort for each missing port closes the gap.
                try {
                    const typeName = node.type?.name || node.typename || nodeType;
                    const type = (NodeLibrary.instance as any)?.getNodeTypeWithName?.(typeName);
                    const typePorts = Array.isArray(type?.ports) ? type.ports : [];
                    const currentPorts = (typeof node.getPorts === 'function' ? node.getPorts() : node.ports) || [];
                    if (typePorts.length > 0 && currentPorts.length < typePorts.length && typeof node.addPort === 'function') {
                        const have = new Set(currentPorts.map((p: any) => `${p.plug}:${p.name}`));
                        for (const p of typePorts) {
                            const key = `${p.plug}:${p.name}`;
                            if (!have.has(key)) {
                                try { node.addPort({ name: p.name, plug: p.plug, type: p.type }); } catch { /* some nodes reject duplicates silently */ }
                            }
                        }
                    }

                    // FIX (2026-05-04): Hydrate PARAMETER DEFAULTS from the type's inputs schema.
                    // Without this, hand-built pixi.ReelColumn / pixi.ReelCell nodes come out missing
                    // animation params (spinSpeed, stopStyle, motionBlur, cellWidth, etc) — the
                    // defaults are declared on type.inputs[key].default but fromJSON doesn't apply
                    // them. The reel only animates correctly when a PixiReelController with
                    // autoLayout cascades these values, which the AI doesn't always set up.
                    // Apply any default that the node doesn't already have a value for.
                    try {
                        const inputs = type?.inputs;
                        if (inputs && typeof inputs === 'object') {
                            for (const paramName of Object.keys(inputs)) {
                                const def = inputs[paramName];
                                if (!def || def.default === undefined) continue;
                                // Only set when the node doesn't already carry a value for this param
                                const existing = (node as any).parameters?.[paramName];
                                if (existing !== undefined && existing !== null) continue;
                                try {
                                    if (typeof (node as any).setParameter === 'function') {
                                        (node as any).setParameter(paramName, def.default);
                                    } else if ((node as any).parameters) {
                                        (node as any).parameters[paramName] = def.default;
                                    }
                                } catch (perParamErr) {
                                    // Some setters validate input strictly — skip on rejection
                                    console.debug(`[EditorBridge] Default for ${typeName}.${paramName} rejected:`, (perParamErr as any)?.message);
                                }
                            }
                        }
                    } catch (paramHydrateErr: any) {
                        console.warn('[EditorBridge] Parameter default hydration failed (non-fatal):', paramHydrateErr?.message);
                    }
                } catch (initErr: any) {
                    console.warn('[EditorBridge] Port hydration from type definition failed (non-fatal):', initErr?.message);
                }

                // FIX: Always set label when an explicit label/name is provided.
                // CRITICAL: Do NOT gate on !node.label — the getter falls back to
                // type.labelForNode(this) which returns text content for Text nodes
                // (e.g., "$1,000.00" instead of the intended "BalanceValue").
                const nodeLabel = data.label || data.name || data.parameters?.label || data.parameters?.name;
                if (nodeLabel) {
                    node.label = nodeLabel;
                    console.log(`[EditorBridge] Set node.label = "${nodeLabel}" after fromJSON`);
                }
                // Add as child of parent or as root
                if (data.parentId) {
                    const parent = this.findNode(data.parentId);
                    if (parent && typeof parent.addChild === 'function') {
                        parent.addChild(node);
                        console.log(`[EditorBridge] Added node ${nodeId} as child of ${data.parentId}`);
                    } else {
                        graph.addRoot(node);
                        console.log(`[EditorBridge] Parent ${data.parentId} not found, added as root`);
                    }
                } else {
                    graph.addRoot(node);
                    console.log(`[EditorBridge] Added node ${nodeId} as root`);
                }

                const serialized = this.serializeNode(node);
                console.log('[EditorBridge] Created node successfully:', serialized);
                return serialized;
            } catch (err: any) {
                console.error('[EditorBridge] graph.createNode FAILED:', err.message, err.stack);
                throw err;
            }
        });

        h('graph.deleteNode', ([nodeId]: [string]) => {
            const graph = this.getActiveGraph();
            if (!graph) throw new Error('No active graph');
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            // NodeGraphModel uses removeNode(), not deleteNode()
            graph.removeNode(node);
            console.log(`[EditorBridge] Deleted node: ${nodeId}`);
        });

        h('graph.getConnections', () => {
            const graph = this.getActiveGraph();
            if (!graph) return [];
            // connections may be on graph directly or on graph.model
            const connections = graph.connections || graph.model?.connections || [];
            console.log('[EditorBridge] graph.getConnections:', connections.length, 'connections found');
            return connections.map((c: any) => ({
                id: c.id,
                fromId: c.fromId || c.sourceId || (c.sourceNode ? c.sourceNode.id : undefined),
                fromPort: c.fromPort || c.fromProperty || (c.sourcePort ? (c.sourcePort.name || c.sourcePort) : undefined),
                toId: c.toId || c.targetId || (c.targetNode ? c.targetNode.id : undefined),
                toPort: c.toPort || c.toProperty || (c.targetPort ? (c.targetPort.name || c.targetPort) : undefined),
            }));
        });

        h('graph.addConnection', ([from, fromPort, to, toPort]: [string, string, string, string]) => {
            const graph = this.getActiveGraph();
            if (!graph) throw new Error('No active graph');
            // CRITICAL FIX: NodeGraphModel.addConnection(model) expects a connection object,
            // NOT 4 individual string arguments. The old code passed the fromId string as `model`,
            // which got pushed raw into connections[] — causing fromId/toId to be undefined.
            const connection = {
                fromId: from,
                fromProperty: fromPort,
                toId: to,
                toProperty: toPort
            };
            return graph.addConnection?.(connection);
        });

        h('graph.removeConnection', ([connectionId]: [string]) => {
            const graph = this.getActiveGraph();
            if (!graph) throw new Error('No active graph');
            // FIX: GPL removeConnection() uses indexOf(object) — it needs the object reference, not a string.
            // The proxy constructs "fromId:fromProperty→toId:toProperty" strings which indexOf can never match.
            const connections: any[] = graph.connections || [];
            let conn: any = null;

            // Strategy 1: UUID match
            conn = connections.find((c: any) => c.id === connectionId);

            // Strategy 2: Parse semantic format "fromId:fromProperty→toId:toProperty"
            if (!conn && connectionId.includes('→')) {
                const arrowIdx = connectionId.indexOf('→');
                const fromPart = connectionId.substring(0, arrowIdx);
                const toPart = connectionId.substring(arrowIdx + 1);
                const fColonIdx = fromPart.indexOf(':');
                const tColonIdx = toPart.indexOf(':');
                if (fColonIdx > 0 && tColonIdx > 0) {
                    const fId = fromPart.substring(0, fColonIdx);
                    const fProp = fromPart.substring(fColonIdx + 1);
                    const tId = toPart.substring(0, tColonIdx);
                    const tProp = toPart.substring(tColonIdx + 1);
                    conn = connections.find((c: any) =>
                        String(c.fromId) === fId && String(c.fromProperty || c.fromPort) === fProp &&
                        String(c.toId) === tId && String(c.toProperty || c.toPort) === tProp
                    );
                }
            }

            // Fallback for corrupted connections (e.g., from old addConnection bug)
            if (!conn && connectionId === 'undefined:undefined→undefined:undefined') {
                const corruptIdx = connections.findIndex((c: any) => !c || typeof c === 'string' || (!c.fromId && !c.id));
                if (corruptIdx !== -1) {
                    conn = connections[corruptIdx];
                    console.warn(`[EditorBridge] Found corrupted connection object at index ${corruptIdx}. Targeting for removal.`);
                }
            }

            if (!conn) {
                console.warn(`[EditorBridge] removeConnection: no matching connection found for "${connectionId}". Available: ${connections.length}`);
                throw new Error(`Connection not found: ${connectionId}`);
            }
            graph.removeConnection?.(conn);
        });

        h('graph.getAppXml', ([scope]: [string?]) => {
            // Delegate to however the editor exports XML
            const graph = this.getActiveGraph();
            if (!graph) return '';
            if (typeof graph.toXML === 'function') return graph.toXML(scope);
            return '';
        });

        // --- Node commands ---
        h('node.setParameter', ([nodeId, name, value]: [string, string, any]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            node.setParameter?.(name, value);
        });

        h('node.getParameter', ([nodeId, name]: [string, string]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            return node.getParameter?.(name);
        });

        h('node.setLabel', ([nodeId, label]: [string, string]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            node.label = label;
        });

        h('node.findByLabel', ([label]: [string]) => {
            const graph = this.getActiveGraph();
            if (!graph) return null;
            const nodes = graph.getNodes?.() || [];
            // XGENIA nodes use nodeLabel or parameters.nodeLabel, not .label
            const found = nodes.find((n: any) =>
                n.label === label ||
                n.nodeLabel === label ||
                n.parameters?.nodeLabel === label ||
                n.name === label
            );
            return found ? this.serializeNode(found) : null;
        });

        h('node.findById', ([nodeId]: [string]) => {
            const node = this.findNode(nodeId);
            return node ? this.serializeNode(node) : null;
        });

        // --- Port management commands ---
        // These call the REAL NodeGraphNode.addPort/removePortWithName methods
        // which emit 'portAdded'/'portRemoved' events and sync to the runtime.
        h('node.addPort', ([nodeId, portSpec]: [string, { name: string; plug: string; type: { name: string } }]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            if (typeof node.addPort !== 'function') {
                throw new Error(`Node ${nodeId} (${node.type?.name || 'unknown'}) does not support addPort`);
            }
            // Check if port already exists
            const existing = (node.ports || []).find((p: any) => p.name === portSpec.name);
            if (existing) {
                console.log(`[EditorBridge] node.addPort: port '${portSpec.name}' already exists on ${nodeId}`);
                return { success: true, alreadyExists: true, port: existing };
            }
            node.addPort(portSpec);
            console.log(`[EditorBridge] node.addPort: added '${portSpec.name}' (plug: ${portSpec.plug}) to ${nodeId}`);
            return { success: true, port: portSpec };
        });

        h('node.removePort', ([nodeId, portName, force]: [string, string, boolean?]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            if (typeof node.removePortWithName !== 'function') {
                throw new Error(`Node ${nodeId} does not support removePortWithName`);
            }
            const result = node.removePortWithName(portName, { force: !!force });
            console.log(`[EditorBridge] node.removePort: removed '${portName}' from ${nodeId}: ${result}`);
            return { success: !!result, portName };
        });

        h('node.getPorts', ([nodeId]: [string]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            // FIX (2026-03-07): Use getPorts() method (static + dynamic) instead of .ports property (dynamic only)
            let rawPorts: any[] = [];
            try {
                if (typeof node.getPorts === 'function') {
                    rawPorts = node.getPorts() || [];
                }
            } catch { /* getPorts() not available */ }
            if (!rawPorts.length) {
                rawPorts = node.ports || [];
            }
            return rawPorts.map((p: any) => ({
                name: p.name,
                plug: p.plug,
                type: p.type?.name || p.type || '*'
            }));
        });

        // --- Node library commands ---
        h('nodelibrary.getNodeTypes', () => {
            const lib = NodeLibrary.instance as any;
            const seen = new Set<string>();
            const result: any[] = [];

            const addType = (name: string, meta?: any) => {
                if (!name || seen.has(name)) return;
                seen.add(name);
                result.push({
                    name,
                    displayName: meta?.displayName || meta?.localName || name,
                    category: meta?.category,
                    color: meta?.color,
                    docs: meta?.docs || meta?.shortDocs,
                });
            };

            // 1. Core types from NodeLibraryData
            const types = lib?.getNodeTypes?.() || [];
            for (const t of types) {
                addType(t.name, t);
            }

            // 2. Component types (registered modules)
            try {
                const components = lib?.getComponents?.() || [];
                for (const c of components) {
                    addType(c.name, c);
                }
            } catch { /* ignore */ }

            // 3. Types from coreNodes index (nodelibraryexport.js)
            // This is where pixi, maths, and other plugin types are catalogued
            try {
                const nodeIndex = lib?.library?.nodeIndex?.coreNodes;
                if (Array.isArray(nodeIndex)) {
                    for (const group of nodeIndex) {
                        const groupCategory = group.type || group.name;
                        if (Array.isArray(group.subCategories)) {
                            for (const sub of group.subCategories) {
                                if (Array.isArray(sub.items)) {
                                    for (const itemName of sub.items) {
                                        if (typeof itemName === 'string') {
                                            addType(itemName, { category: groupCategory });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch { /* ignore */ }

            return result;
        });

        h('nodelibrary.getNodeType', ([name]: [string]) => {
            const type = (NodeLibrary.instance as any)?.getNodeTypeWithName?.(name);
            if (!type) return null;
            return {
                name: type.name,
                displayName: type.displayName || type.name,
                category: type.category,
                color: type.color,
                ports: type.ports,
            };
        });

        // --- Undo commands ---
        h('undo.push', ([group]: [any]) => {
            UndoQueue.instance?.push?.(group);
        });

        h('undo.undo', () => {
            UndoQueue.instance?.undo?.();
        });

        h('undo.getLocation', () => {
            return UndoQueue.instance?.getHistoryLocation?.() || 0;
        });

        // --- Sidebar commands ---
        h('sidebar.switchToNode', ([nodeId]: [string]) => {
            const node = this.findNode(nodeId);
            if (node) SidebarModel.instance?.switchToNode?.(node);
        });

        // --- Component commands ---
        h('component.switchTo', ([componentName]: [string]) => {
            const pm = ProjectModel.instance as any;
            const components = pm?.getComponents?.() || [];
            const comp = components.find((c: any) => c.name === componentName || c.fullName === componentName);
            if (comp) {
                // Prefer NodeGraphContextTmp.switchToComponent for full UI + model switch
                // (same API used by ComponentsPanel and property editor clicks)
                const NodeGraphContextTmp = (window as any).NodeGraphContextTmp;
                if (NodeGraphContextTmp?.switchToComponent && typeof NodeGraphContextTmp.switchToComponent === 'function') {
                    NodeGraphContextTmp.switchToComponent(comp, { pushHistory: true });
                } else if (NodeGraphContextTmp?.nodeGraph?.switchToComponent && typeof NodeGraphContextTmp.nodeGraph.switchToComponent === 'function') {
                    NodeGraphContextTmp.nodeGraph.switchToComponent(comp, { pushHistory: true });
                } else if (typeof pm?.setActiveComponent === 'function') {
                    // Fallback: model-only switch (no UI update)
                    pm.setActiveComponent(comp);
                }
                this.cachedActiveComponent = comp;
                // AI explicitly requested this component — lock it to prevent drift
                this.setAiLock(comp);
            }
        });

        h('component.unlockContext', () => {
            this.clearAiLock();
            return { success: true };
        });

        h('component.create', ([name, path, type]: [string, string, string]) => {
            const pm = ProjectModel.instance as any;
            if (typeof pm?.createComponent === 'function') {
                return pm.createComponent(name, path, type);
            }
            throw new Error('Component creation not available');
        });

        // FIX (2026-04-21 R36): component.delete bridge endpoint.
        // Previously the iframe-side create_component tool attempted `ProjectModel.instance.deleteComponent`
        // directly, which doesn't exist in iframe context — every forceRecreate silently no-opped, and the
        // "Component already exists" error still fired because the ghost component remained. This handler
        // tries the real editor-side deletion methods with undo support and reports what actually happened.
        h('component.delete', ([nameOrFullName]: [string]) => {
            const pm = ProjectModel.instance as any;
            if (!pm) throw new Error('ProjectModel not available');

            const allComponents = pm.getComponents?.() || [];
            const stripPath = (s: string) => (s || '').replace(/^\/+|\/+$/g, '').split('/').pop() || '';
            const wanted = nameOrFullName;
            const wantedStripped = stripPath(wanted);

            const matches = allComponents.filter((c: any) => {
                const cn = c?.name || c?.fullName || '';
                return cn === wanted || stripPath(cn) === wantedStripped || stripPath(cn).toLowerCase() === wantedStripped.toLowerCase();
            });

            if (matches.length === 0) {
                return { success: false, error: `No component matches "${nameOrFullName}"`, deletedCount: 0 };
            }

            const undoGroup = new UndoActionGroup({ label: `delete component ${nameOrFullName}` });
            const deleted: string[] = [];
            const failed: { name: string; error: string }[] = [];

            for (const comp of matches) {
                const compName = comp?.name || comp?.fullName || 'unknown';
                // If the component being deleted is currently active, clear the AI lock and cache first
                // so downstream state doesn't hold a dangling reference.
                if (this.cachedActiveComponent?.id === comp?.id) {
                    this.clearAiLock();
                    this.cachedActiveComponent = null;
                }
                try {
                    if (typeof pm.removeComponent === 'function') {
                        pm.removeComponent(comp, { undo: undoGroup });
                        deleted.push(compName);
                    } else if (typeof pm.deleteComponent === 'function') {
                        pm.deleteComponent(comp, { undo: undoGroup });
                        deleted.push(compName);
                    } else if (typeof comp.delete === 'function') {
                        comp.delete();
                        deleted.push(compName);
                    } else {
                        failed.push({ name: compName, error: 'No supported deletion method on ProjectModel or Component' });
                    }
                } catch (e: any) {
                    failed.push({ name: compName, error: e?.message || String(e) });
                }
            }

            if (deleted.length > 0) {
                UndoQueue.instance.push(undoGroup);
                this.pushEvent('componentDeleted', { names: deleted });
            }

            return {
                success: failed.length === 0 && deleted.length > 0,
                deletedCount: deleted.length,
                deleted,
                failed: failed.length > 0 ? failed : undefined
            };
        });

        h('component.createWithTemplate', ([name, templateJSON]: [string, any]) => {
            const pm = ProjectModel.instance as any;
            if (!pm) throw new Error('ProjectModel not available');

            // Create component from template JSON (same as tool-side ComponentModel creation)
            const Utils = (window as any).Utils || { guid: () => crypto.randomUUID() };
            const undoGroup = new UndoActionGroup({ label: 'create component' });

            const newComponent = new ComponentModel({
                name: name,
                graph: NodeGraphModel.fromJSON(JSON.parse(JSON.stringify(templateJSON))),
                id: Utils.guid?.() || crypto.randomUUID()
            });

            newComponent.rekeyAllIds();
            UndoQueue.instance.push(undoGroup);
            pm.addComponent(newComponent, { undo: undoGroup });

            // Cache, lock, and broadcast
            this.cachedActiveComponent = newComponent;
            this.setAiLock(newComponent);
            this.pushEvent('componentSwitched', {
                name: newComponent.name,
                fullName: newComponent.fullName || newComponent.name,
            });

            return this.serializeComponent(newComponent);
        });

        // --- Manifest / inspection commands ---
        h('project.getManifest', ([opts]: [any]) => {
            const scope = opts?.scope || 'project';
            const includeCode = opts?.includeCode !== false;
            const includeConnections = opts?.includeConnections !== false;

            const pm = ProjectModel.instance as any;
            if (!pm) throw new Error('ProjectModel not available');

            const allComponents = pm.getComponents?.() || [];
            const componentsToProcess = scope === 'active'
                ? [this.cachedActiveComponent || pm.getRootComponent?.()].filter(Boolean)
                : allComponents;

            const manifest: any = {
                components: {},
                cloudFunctions: [],
                summary: { componentCount: 0, labeledNodeCount: 0, functionCount: 0, connectionCount: 0 }
            };

            const processNode = (node: any, componentData: any) => {
                const label = node.label || node.parameters?.nodeLabel || node.parameters?.label;
                if (label) {
                    componentData.labels.push(label);
                    manifest.summary.labeledNodeCount++;
                }
                if (includeCode) {
                    const nodeType = node.typename || node.type?.name || node.type;
                    if (nodeType === 'JavaScriptFunction' || nodeType === 'javascriptfunction') {
                        const funcName = label || (node.id?.substring(0, 8)) || 'anonymous';
                        const code = node.parameters?.functionScript
                            || node.parameters?.code
                            || (typeof node.getParameter === 'function' ? node.getParameter('functionScript') : null);
                        if (code && typeof code === 'string') {
                            const lines = code.split('\n');
                            const firstComment = lines.find((l: string) => l.trim().startsWith('//') && l.trim().length > 5);
                            const summary = firstComment ? firstComment.trim().substring(0, 80) : `${lines.length} lines`;
                            componentData.functions[funcName] = `${summary} (${lines.length} lines)`;
                            manifest.summary.functionCount++;
                        }
                    }
                }
                for (const prop of ['children', 'childNodes', 'nodes']) {
                    if (Array.isArray(node[prop])) {
                        for (const child of node[prop]) processNode(child, componentData);
                    }
                }
            };

            for (const component of componentsToProcess) {
                const compName = component.name || component.fullName || component.id;
                const componentData: any = { labels: [], functions: {}, connectionSummary: [] };
                const graph = component.graph;
                if (!graph) continue;
                const graphModel = graph.model || graph;

                // FIX (2026-03-19): Must traverse nodeMap (Priority 1) + roots (Priority 2)
                // nodeMap is the primary data source in NodeGraphModel — nodes like
                // PixiReelController live ONLY in nodeMap, not in roots/nodes arrays.
                const seenIds = new Set<string>();
                const processNodeDeduped = (node: any) => {
                    if (!node || !node.id || seenIds.has(node.id)) return;
                    seenIds.add(node.id);
                    processNode(node, componentData);
                };

                // Priority 1: nodeMap (the ACTUAL data source)
                if (graphModel.nodeMap) {
                    if (typeof graphModel.nodeMap.values === 'function') {
                        for (const node of graphModel.nodeMap.values()) processNodeDeduped(node);
                    } else if (typeof graphModel.nodeMap === 'object') {
                        Object.values(graphModel.nodeMap).forEach((node: any) => processNodeDeduped(node));
                    }
                }
                // Priority 2: roots (tree structure)
                if (Array.isArray(graphModel.roots)) {
                    for (const root of graphModel.roots) processNodeDeduped(root);
                }
                // Priority 3: nodes array (fallback)
                if (Array.isArray(graphModel.nodes)) {
                    for (const node of graphModel.nodes) processNodeDeduped(node);
                }

                if (includeConnections) {
                    const connections = graphModel.connections || [];
                    for (const conn of connections) {
                        try {
                            const fromId = conn.fromId || conn.sourceId;
                            const toId = conn.toId || conn.targetId;
                            const fromPort = conn.fromProperty || conn.sourcePort?.name || '';
                            const toPort = conn.toProperty || conn.targetPort?.name || '';
                            if (fromId && toId) {
                                const fromNode = graphModel.nodeMap?.get(fromId);
                                const toNode = graphModel.nodeMap?.get(toId);
                                const fromLabel = fromNode?.label || fromId.substring(0, 8);
                                const toLabel = toNode?.label || toId.substring(0, 8);
                                componentData.connectionSummary.push(`${fromLabel}.${fromPort} → ${toLabel}.${toPort}`);
                                manifest.summary.connectionCount++;
                            }
                        } catch { /* skip malformed connections */ }
                    }
                }

                manifest.components[compName] = componentData;
                manifest.summary.componentCount++;
            }

            // Cloud functions
            manifest.cloudFunctions = allComponents
                .filter((c: any) => c.name?.startsWith('/#__cloud__/') || c.fullName?.startsWith('/#__cloud__/'))
                .map((c: any) => (c.name || c.fullName || '').replace('/#__cloud__/', ''));

            return manifest;
        });

        h('project.getComponentsWithGraph', () => {
            const pm = ProjectModel.instance as any;
            if (!pm) return [];
            const components = pm.getComponents?.() || [];
            return components.map((c: any) => {
                const result: any = this.serializeComponent(c);
                const graph = c.graph;
                if (graph) {
                    const graphModel = graph.model || graph;
                    const roots = graphModel.roots || [];
                    result.graph = {
                        roots: roots.map((n: any) => this.serializeNode(n)),
                        connections: (graphModel.connections || []).map((conn: any) => ({
                            id: conn.id,
                            fromId: conn.fromId,
                            fromPort: conn.fromProperty || conn.fromPort,
                            toId: conn.toId,
                            toPort: conn.toProperty || conn.toPort,
                        })),
                    };
                }
                return result;
            });
        });

        // --- Settings commands ---
        h('settings.get', ([key]: [string]) => {
            try {
                const { EditorSettings } = require('../../../utils/editorsettings');
                return EditorSettings.instance?.get?.(key);
            } catch {
                return null;
            }
        });

        h('settings.set', ([key, value]: [string, any]) => {
            try {
                const { EditorSettings } = require('../../../utils/editorsettings');
                EditorSettings.instance?.set?.(key, value);
            } catch {
                // Silently fail
            }
        });

        // --- Auth commands (for AI proxy mode) ---
        h('auth.getJwt', async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) {
                    console.warn('[EditorBridge] auth.getJwt: getSession error:', error.message);
                    return null;
                }
                return session?.access_token || null;
            } catch (e: any) {
                console.warn('[EditorBridge] auth.getJwt failed:', e.message);
                return null;
            }
        });

        // --- Filesystem commands ---
        h('fs.readFile', async ([filePath, encoding]: [string, string?]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance._retainedProjectDirectory;
            
            if (!projectDir && !(filePath.startsWith('/') || filePath.includes(':'))) {
                throw new Error('FileSystem.readFile failed: Missing project repository context.');
            }

            const fullPath = (filePath.startsWith('/') || filePath.includes(':'))
                ? filePath 
                : path.join(projectDir || '', filePath);

            if (encoding === 'binary' || encoding === 'base64') {
                // Return base64-encoded binary data for image files etc.
                const buffer = fs.readFileSync(fullPath);
                return buffer.toString('base64');
            }
            return fs.readFileSync(fullPath, encoding || 'utf-8');
        });

        h('fs.writeFile', async ([filePath, content, encoding]: [string, string, string?]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance._retainedProjectDirectory;
            const fullPath = (filePath.startsWith('/') || filePath.includes(':'))
                ? filePath 
                : path.join(projectDir, filePath);

            // Ensure parent directory exists
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(fullPath, content, encoding || 'utf-8');
            return true;
        });

        h('fs.exists', ([filePath]: [string]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance._retainedProjectDirectory;
            const fullPath = (filePath.startsWith('/') || filePath.includes(':'))
                ? filePath 
                : path.join(projectDir, filePath);
            return fs.existsSync(fullPath);
        });

        h('fs.mkdir', ([dirPath]: [string]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance._retainedProjectDirectory;
            const fullPath = (dirPath.startsWith('/') || dirPath.includes(':'))
                ? dirPath 
                : path.join(projectDir, dirPath);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
            }
            return true;
        });

        h('fs.remove', ([filePath]: [string]) => {
            const fs = require('fs');
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
            return true;
        });

        h('fs.readDir', ([dirPath]: [string]) => {
            const fs = require('fs');
            if (!fs.existsSync(dirPath)) return [];
            return fs.readdirSync(dirPath);
        });

        h('fs.readJson', async ([filePath]: [string]) => {
            const fs = require('fs');
            const content = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(content);
        });

        h('fs.writeJson', async ([filePath, data]: [string, any]) => {
            const fs = require('fs');
            const path = require('path');
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            return true;
        });

        h('fs.rename', ([oldPath, newPath]: [string, string]) => {
            const fs = require('fs');
            fs.renameSync(oldPath, newPath);
            return true;
        });

        h('fs.writeFileBinary', async ([filePath, base64Data]: [string, string]) => {
            const fs = require('fs');
            const path = require('path');
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(filePath, buffer);
            return true;
        });

        h('fs.stat', ([filePath]: [string]) => {
            const fs = require('fs');
            if (!fs.existsSync(filePath)) return null;
            const stat = fs.statSync(filePath);
            return { size: stat.size, modified: stat.mtime.toISOString(), isFile: stat.isFile(), isDirectory: stat.isDirectory() };
        });

        h('fs.readDirDetailed', ([dirPath]: [string]) => {
            const fs = require('fs');
            if (!fs.existsSync(dirPath)) return [];
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            return entries
                .filter((e: any) => !e.name.startsWith('.'))
                .map((e: any) => ({
                    name: e.name,
                    isFile: e.isFile(),
                    isDirectory: e.isDirectory()
                }));
        });

        // --- Project directory ---
        h('project.getDirectory', () => {
            try {
                return (ProjectModel.instance as any)?._retainedProjectDirectory || null;
            } catch {
                return null;
            }
        });

        // --- Warnings model ---
        h('warnings.get', () => {
            try {
                const { WarningsModel } = require('@xgenia-models/warningsmodel');
                return WarningsModel.instance || null;
            } catch {
                return null;
            }
        });

        // --- Project Style commands ---
        h('style.getBaseUrl', () => {
            return getProjectBaseStyleUrl();
        });

        h('style.setBase', ([id, dataUrl]: [string, string]) => {
            setProjectBaseStyle(id, dataUrl);
            console.log(`[EditorBridge] style.setBase: set reference image (${id})`);
        });

        h('style.clearBase', () => {
            clearProjectBaseStyle();
            console.log('[EditorBridge] style.clearBase: cleared reference image');
        });

        h('style.getPrompt', () => {
            return getProjectGlobalStylePrompt();
        });

        h('style.setPrompt', ([prompt]: [string]) => {
            setProjectGlobalStylePrompt(prompt);
            console.log(`[EditorBridge] style.setPrompt: "${prompt.substring(0, 60)}..."`);
        });

        h('style.getPalettes', () => {
            return getProjectPalettes();
        });

        h('style.addPalette', ([palette]: [string[]]) => {
            addProjectPalette(palette);
            console.log(`[EditorBridge] style.addPalette: ${palette.join(', ')}`);
        });

        // --- Viewer commands (screenshots, HTML) ---
        h('viewer.captureScreenshot', ([fullPage]: [boolean]) => {
            return new Promise((resolve) => {
                try {
                    const { ipcRenderer } = require('electron');
                    const requestChannel = fullPage ? 'viewer-capture-fullpage' : 'viewer-capture-thumb';
                    const replyChannel = fullPage ? 'viewer-capture-fullpage-reply' : 'viewer-capture-thumb-reply';
                    const timeoutMs = fullPage ? 30000 : 10000;

                    ipcRenderer.send(requestChannel);

                    const timeout = setTimeout(() => {
                        ipcRenderer.removeListener(replyChannel, handler);
                        resolve(JSON.stringify({ success: false, message: `Screenshot timed out (${fullPage ? 'full-page' : 'viewport'})` }));
                    }, timeoutMs);

                    const handler = (_event: any, data: any) => {
                        clearTimeout(timeout);
                        ipcRenderer.removeListener(replyChannel, handler);
                        if (data) {
                            resolve(JSON.stringify({ success: true, image: data, fullPage, timestamp: Date.now() }));
                        } else {
                            resolve(JSON.stringify({ success: false, message: 'Screenshot capture returned no data' }));
                        }
                    };
                    ipcRenderer.on(replyChannel, handler);
                } catch (e: any) {
                    resolve(JSON.stringify({ success: false, message: `Screenshot error: ${e.message}` }));
                }
            });
        });

        h('viewer.getFullHtml', () => {
            return new Promise((resolve) => {
                try {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.send('viewer-get-full-html');

                    const timeout = setTimeout(() => {
                        ipcRenderer.removeListener('viewer-get-full-html-reply', handler);
                        resolve(JSON.stringify({ success: false, error: 'HTML extraction timed out (IPC)' }));
                    }, 10000);

                    const handler = (_event: any, result: any) => {
                        clearTimeout(timeout);
                        ipcRenderer.removeListener('viewer-get-full-html-reply', handler);
                        resolve(JSON.stringify(result));
                    };
                    ipcRenderer.on('viewer-get-full-html-reply', handler);
                } catch (e: any) {
                    resolve(JSON.stringify({ success: false, error: `HTML extraction error: ${e.message}` }));
                }
            });
        });

        // --- Editor warnings ---
        h('warnings.get', () => {
            try {
                const { WarningsModel } = require('@xgenia-models/warningsmodel');
                const warnings = WarningsModel.instance;
                if (!warnings) return [];
                return warnings.getWarnings?.() || [];
            } catch {
                return [];
            }
        });

        // --- ViewerConnection bridge (runtime signal triggering) ---
        h('viewer.triggerSignal', ([nodeId, portName, data, isInput]: [string, string, any?, boolean?]) => {
            try {
                const { ViewerConnection } = require('../../../ViewerConnection');
                const vc = ViewerConnection.instance;
                if (!vc) throw new Error('ViewerConnection instance not available');
                vc.sendTriggerSignal(nodeId, portName, data, isInput);
                console.log(`[EditorBridge] viewer.triggerSignal: sent to ${nodeId}.${portName} (isInput=${!!isInput})`);
                return { success: true, nodeId, portName };
            } catch (e: any) {
                console.error('[EditorBridge] viewer.triggerSignal failed:', e.message);
                throw e;
            }
        });

        // --- ViewerConnection bridge (code execution in Viewer game engine) ---
        h('viewer.executeCode', async ([code, timeout_ms]: [string, number?]) => {
            const { ViewerConnection } = require('../../../ViewerConnection');
            const vc = ViewerConnection.instance;
            if (!vc) {
                throw new Error('Cannot execute code: The game preview is not running (ViewerConnection unavailable). Start the preview first.');
            }

            const cappedTimeout = Math.min(timeout_ms || 30000, 120000);
            const evalId = `eval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            return new Promise<any>((resolve, reject) => {
                const timer = setTimeout(() => {
                    EventDispatcher.instance.off(evalId);
                    reject(new Error(`Code execution timed out after ${cappedTimeout}ms`));
                }, cappedTimeout);

                const resultHandler = (response: any) => {
                    const message = response.args || response;
                    if (message.id !== evalId) return;

                    EventDispatcher.instance.off(evalId);
                    clearTimeout(timer);

                    if (message.success) {
                        // Extract structured result with logs if available
                        const raw = message.result;
                        const hasStructured = raw && typeof raw === 'object' && '__logs' in raw;
                        const returnVal = hasStructured ? raw.__result : raw;
                        const logs: Array<{level: string; message: string}> = hasStructured ? (raw.__logs || []) : [];

                        const parts: string[] = [];
                        if (logs.length > 0) {
                            parts.push('Console output:');
                            for (const entry of logs) {
                                const prefix = entry.level === 'log' ? '' : `[${entry.level.toUpperCase()}] `;
                                parts.push(`  ${prefix}${entry.message}`);
                            }
                        }
                        const returnStr = returnVal === undefined ? 'undefined'
                            : typeof returnVal === 'object' ? JSON.stringify(returnVal, null, 2)
                            : String(returnVal);
                        parts.push(`Return value: ${returnStr}`);
                        resolve({ success: true, output: parts.join('\n') });
                    } else {
                        resolve({ success: false, error: `Viewer Execution Error:\n${message.error}` });
                    }
                };

                EventDispatcher.instance.on('Viewer.runtimeEvalResult', resultHandler, evalId);

                try {
                    // Auto-return: prepend 'return' to the last non-empty statement
                    // if it doesn't already start with return/if/for/while/try/class/function/switch/throw
                    const autoReturnCode = (() => {
                        const lines = code.split('\n');
                        let lastIdx = -1;
                        for (let i = lines.length - 1; i >= 0; i--) {
                            const trimmed = lines[i].trim();
                            if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && trimmed !== '}' && trimmed !== '});') {
                                lastIdx = i;
                                break;
                            }
                        }
                        if (lastIdx >= 0) {
                            const trimmed = lines[lastIdx].trim();
                            const noAutoReturn = /^(return|if|for|while|try|class|function|switch|throw|const|let|var|async\s+function)\b/;
                            if (!noAutoReturn.test(trimmed) && !trimmed.endsWith('{')) {
                                const indent = lines[lastIdx].match(/^(\s*)/)?.[1] || '';
                                lines[lastIdx] = `${indent}return ${trimmed}`;
                            }
                        }
                        return lines.join('\n');
                    })();

                    // Wrap with console interceptor to capture logs during execution
                    const wrappedCode = `var __logs = [];
return (async () => {
  var __oc = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
  ['log','warn','error','info','debug'].forEach(function(m) {
    console[m] = function() {
      var args = Array.prototype.slice.call(arguments);
      __logs.push({ level: m, message: args.map(function(a) { return typeof a === 'string' ? a : JSON.stringify(a); }).join(' ') });
      __oc[m].apply(console, arguments);
    };
  });
  try {
${autoReturnCode}
  } finally {
    console.log = __oc.log; console.warn = __oc.warn; console.error = __oc.error;
    console.info = __oc.info; console.debug = __oc.debug;
  }
})().then(function(r) { return { __result: r, __logs: __logs }; });`;
                    vc.sendRuntimeEval(wrappedCode, evalId);
                } catch (syncError: any) {
                    clearTimeout(timer);
                    EventDispatcher.instance.off(evalId);
                    reject(syncError);
                }
            });
        });

        // --- ViewerConnection bridge (status check for iframe-side tools) ---
        h('viewer.getStatus', () => {
            try {
                const { ViewerConnection } = require('../../../ViewerConnection');
                const vc = ViewerConnection.instance;
                const hasED = !!EventDispatcher?.instance;
                const wsReady = vc?.ws?.readyState === 1; // WebSocket.OPEN
                return {
                    viewerAvailable: !!vc,
                    eventDispatcherAvailable: hasED,
                    webSocketConnected: wsReady,
                    previewRunning: !!vc && hasED && wsReady,
                };
            } catch (e: any) {
                return {
                    viewerAvailable: false,
                    eventDispatcherAvailable: false,
                    webSocketConnected: false,
                    previewRunning: false,
                    error: e.message,
                };
            }
        });

        // --- Image Editor bridge commands ---
        h('imageEditor.toast', ([level, msg]: string[]) => {
            try {
                const { ToastLayer } = require('../../ToastLayer/ToastLayer');
                if (level === 'success') {
                    ToastLayer.showSuccess(msg);
                } else {
                    ToastLayer.showInteraction(msg);
                }
            } catch (e: any) {
                console.warn('[EditorBridge] Toast error:', e);
            }
        });

        h('imageEditor.getFalApiKey', () => {
            try {
                const { EditorSettings } = require('../../../utils/editorsettings');
                return EditorSettings?.instance?.get?.('fal.apiKey') || null;
            } catch {
                return null;
            }
        });

        h('imageEditor.getGeminiApiKey', () => {
            try {
                const { EditorSettings } = require('../../../utils/editorsettings');
                return EditorSettings?.instance?.get?.('gemini.apiKey') || null;
            } catch {
                return null;
            }
        });

        h('imageEditor.getSettings', () => {
            try {
                const { EditorSettings } = require('../../../utils/editorsettings');
                const instance = EditorSettings?.instance;
                if (!instance) return {};
                return {
                    falApiKey: instance.get?.('fal.apiKey') || null,
                    geminiApiKey: instance.get?.('gemini.apiKey') || null,
                };
            } catch {
                return {};
            }
        });
    }

    // --- Helpers ---

    private getActiveGraph(): any {
        try {
            // PRIORITY 1: If the AI has locked a component, use it regardless of editor UI state.
            // This prevents editor re-renders (componentAdded, useSwitchToDefaultComponent, etc.)
            // from overriding the AI's intended target component.
            let comp = this.aiLockedComponent;
            if (comp) {
                // Refresh the lock timer on every access (active use = keep alive)
                this.setAiLock(comp);
                const graph = comp.graph;
                if (graph) {
                    console.log('[EditorBridge] getActiveGraph: using AI-locked component:', comp.name,
                        '{ roots:', graph.roots?.length ?? '?',
                        ', connections:', graph.connections?.length ?? '?', '}');
                }
                return graph;
            }

            // PRIORITY 2: Use the cached active component (set by EventDispatcher listener)
            comp = this.cachedActiveComponent;

            // Fallback: if no component change event has fired yet, try root component
            if (!comp) {
                comp = (ProjectModel.instance as any)?.getRootComponent?.();
                if (comp) {
                    console.log('[EditorBridge] getActiveGraph: no cached component, falling back to root component:', comp.name);
                    this.cachedActiveComponent = comp; // Cache it for next time
                }
            }

            if (comp) {
                // component.graph is a NodeGraphModel — roots/connections live directly on it
                const graph = comp.graph;
                if (graph) {
                    console.log('[EditorBridge] getActiveGraph: found graph for', comp.name,
                        '{ roots:', graph.roots?.length ?? '?',
                        ', connections:', graph.connections?.length ?? '?', '}');
                }
                return graph;
            } else {
                console.warn('[EditorBridge] getActiveGraph: no active component cached and no root component.',
                    'Has the user opened a project?');
            }
        } catch (e: any) {
            console.warn('[EditorBridge] getActiveGraph error:', e);
        }
        return null;
    }

    private findNode(idOrLabel: string): any {
        const graph = this.getActiveGraph();
        if (!graph) return null;

        // PRIORITY 1: Use native findNodeWithId for ID lookup (uses nodeMap, O(1))
        if (graph.findNodeWithId) {
            const byId = graph.findNodeWithId(idOrLabel);
            if (byId) return byId;
        }

        // PRIORITY 2: Also try nodeMap directly
        if (graph.nodeMap && graph.nodeMap.get) {
            const byMap = graph.nodeMap.get(idOrLabel);
            if (byMap) return byMap;
        }

        // PRIORITY 3: Search by label recursively through roots + children
        const searchByLabel = (nodes: any[]): any => {
            for (const n of nodes) {
                // Check both label property and nodeLabel parameter
                const nodeLabel = n.label || n._label || n.parameters?.nodeLabel;
                if (nodeLabel === idOrLabel) return n;
                if (n.children && Array.isArray(n.children)) {
                    const found = searchByLabel(n.children);
                    if (found) return found;
                }
            }
            return null;
        };
        const roots = graph.roots || [];
        return searchByLabel(roots);
    }

    private serializeNode(node: any, depth = 0): any {
        const serialized: any = {
            id: node.id,
            label: node.label,
            nodeLabel: node.nodeLabel || node.parameters?.nodeLabel,
            type: node.type?.name || node.typename,
            typename: node.typename || node.type?.name,
            x: node.x,
            y: node.y,
            parameters: this.serializeParameters(node),
            // Include ports for live proxy caching — tools call node.getPorts()/getPort()
            // FIX (2026-03-07): Use getPorts() METHOD (returns static + dynamic ports from type system)
            // instead of .ports PROPERTY (only dynamic/user-added ports).
            // Without this, bridge nodes lack static ports (text, visible, value, etc.)
            // and getPort() returns null, breaking port type detection in validate_connection.
            ports: (() => {
                let rawPorts: any[] = [];
                try {
                    if (typeof node.getPorts === 'function') {
                        rawPorts = node.getPorts() || [];
                    }
                } catch { /* getPorts() not available on this node */ }
                if (!rawPorts.length) {
                    rawPorts = node.ports || [];
                }
                // FIX (2026-04-21 R37): If the live node reports no ports, fall back to
                // the NodeLibrary type definition. Freshly-created logic nodes (And/Or/…)
                // sometimes finish creation before their port list is populated — the
                // iframe-side existence check then sees an empty `ports` array on the
                // serialized payload and rejects every connection as "port does not exist".
                // Reading the authoritative type.ports here ensures the serialized node
                // always carries its full static port surface.
                if (!rawPorts.length) {
                    try {
                        const typeName = node.type?.name || node.typename;
                        if (typeName) {
                            const type = (NodeLibrary.instance as any)?.getNodeTypeWithName?.(typeName);
                            if (type?.ports && Array.isArray(type.ports)) {
                                rawPorts = type.ports;
                            }
                        }
                    } catch { /* NodeLibrary not available in this context */ }
                }
                return rawPorts.map((p: any) => ({
                    name: p.name,
                    plug: p.plug,
                    type: p.type?.name || p.type || '*',
                    index: p.index
                }));
            })(),
        };
        // Recursively serialize children (cap depth to prevent infinite loops)
        if (depth < 30 && node.children && Array.isArray(node.children) && node.children.length > 0) {
            serialized.children = node.children.map((child: any) => this.serializeNode(child, depth + 1));
        }
        return serialized;
    }

    private serializeParameters(node: any): Record<string, any> {
        const params: Record<string, any> = {};
        try {
            if (typeof node.getParameters === 'function') {
                const paramList = node.getParameters();
                for (const p of paramList) {
                    params[p.name] = p.value;
                }
            }
        } catch { }

        // FIX (2026-03-10): JavaScript function nodes store functionScript, scriptInputs,
        // and scriptOutputs as internal parameters NOT enumerated by getParameters().
        // Without this, the bridge copy has empty parameters and the iframe side falls back
        // to a lossy scriptInputs/scriptOutputs-only reconstruction.
        const nodeType = (node.typename || node.type?.name || '').toLowerCase();
        if (nodeType === 'javascriptfunction' || nodeType === 'javascript2' || nodeType === 'xgenia.javascript') {
            const jsParamKeys = ['functionScript', 'scriptInputs', 'scriptOutputs'];
            for (const key of jsParamKeys) {
                if (params[key] === undefined || params[key] === null) {
                    try {
                        const val = typeof node.getParameter === 'function' ? node.getParameter(key) : undefined;
                        if (val !== undefined && val !== null) {
                            params[key] = val;
                        }
                    } catch { /* skip inaccessible params */ }
                }
            }
        }

        return params;
    }

    private serializeComponent(comp: any): any {
        return {
            name: comp.name,
            fullName: comp.fullName,
            id: comp.id,
            path: comp.path,
            isRoot: comp.isRoot,
        };
    }
}

/** Singleton bridge instance */
export const editorBridge = new EditorBridge();
