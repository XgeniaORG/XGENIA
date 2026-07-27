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
import { ProjectModel } from '@xgenia-models/projectmodel';
import ThumbnailCache from '@xgenia-utils/thumbnailcache';
import { isBloatPort, isTooLargeToSerialize, unwrapValueUnit } from './serialize-param-guard';
import { NodeLibrary } from '@xgenia-models/nodelibrary';
import { UndoQueue, UndoActionGroup } from '@xgenia-models/undo-queue-model';
import { SidebarModel } from '@xgenia-models/sidebar';
import { recordAssetProvenance, loadAssetMeta, migrateAssetMeta } from '../AssetPanel/assetMeta';
import { reconcileGraphAssetRefs } from '../AssetPanel/assetGraphRefs';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { guid } from '@xgenia-utils/utils';
import {
    getProjectBaseStyleUrl,
    setProjectBaseStyle,
    clearProjectBaseStyle,
    getProjectGlobalStylePrompt,
    setProjectGlobalStylePrompt,
    getProjectPalettes,
    addProjectPalette
} from '../ProjectStylesPanel/ProjectStylesPanel';
import { supabase } from '../../../supabaseInit';
import { platform } from '@xgenia/platform';

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
        // Forward viewer console output into the plugin iframe
        this.forwardViewerConsole();
    }

    /**
     * Forward viewer console logs to the plugin iframe.
     *
     * WHY (trace 1785095779892 / 1785106018235): every debug export showed
     * `bySource: {editor: 500, viewer: 0}` — the AI has NEVER seen a viewer log, so when
     * the viewer crashed there was no stack, no error, nothing to diagnose with. It looked
     * like the viewer "produces no logs"; in fact the chain was broken at the last hop.
     *
     * ViewerConnection receives `viewerConsole` over the socket and re-emits it as
     * `Viewer.consoleLog` on the EDITOR's EventDispatcher. ConsoleLogBuffer subscribes to
     * that event — but it runs in the plugin IFRAME, where `EventDispatcher.instance` is a
     * different object from this one, so the subscription can never fire. (Same parent-vs-
     * iframe singleton split that CodeApprovalService already documents.)
     *
     * ConsoleLogBuffer ALSO listens for a postMessage of shape
     * `{ type: 'xgenia-viewer-console', level, message, stack }` and nothing ever sent it.
     * This sends it — the receiving end already exists and needs no change.
     */
    private forwardViewerConsole() {
        try {
            EventDispatcher.instance.on('Viewer.consoleLog', (data: any) => {
                const win = this.iframe?.contentWindow;
                if (!win) return; // panel not mounted yet — nothing to forward to
                this.safePostMessage(win, {
                    type: 'xgenia-viewer-console',
                    level: data?.level || 'log',
                    message: typeof data?.message === 'string' ? data.message : String(data?.message ?? ''),
                    stack: data?.stack,
                    timestamp: data?.timestamp || Date.now(),
                }, this.pluginOrigin);
            }, this);
        } catch (e: any) {
            console.warn('[EditorBridge] Could not subscribe to viewer console logs:', e?.message || e);
        }
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
        } catch (err: any) {
            // 2026-06-10: a DataCloneError (command result contains a
            // function / Proxy / circular graph object — not structured-
            // clone-able) used to be misread as an origin mismatch: the
            // fallback resent the SAME non-cloneable payload to '*', threw
            // again, and the iframe's pending promise hung into a fake
            // 30s timeout. Distinguish the two: on DataCloneError,
            // JSON-sanitize the payload (drops functions/proxies, breaks
            // cycles) and resend; if even that fails, send an error-shaped
            // reply with the same id so the iframe REJECTS FAST instead of
            // timing out.
            if (err?.name === 'DataCloneError') {
                try {
                    const sanitized = JSON.parse(JSON.stringify(message, (_k, v) =>
                        typeof v === 'function' ? undefined : v));
                    sanitized._sanitized = true;
                    windowProxy.postMessage(sanitized, origin);
                    console.warn('[EditorBridge] Message contained non-cloneable values — sent JSON-sanitized copy (_sanitized: true)');
                    return;
                } catch (sanitizeErr: any) {
                    try {
                        windowProxy.postMessage({
                            type: message?.type,
                            id: message?.id,
                            error: `Result not transferable across the bridge: ${sanitizeErr?.message || 'circular or non-serializable value'}`,
                        }, origin);
                        return;
                    } catch { /* fall through to origin fallback below */ }
                }
            }
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

        // Like html.translate but also reports every style/element the
        // translator DROPPED — the ChatPanel surfaces `translationWarnings`
        // to the model so it can restyle instead of silently losing fidelity.
        h('html.translateWithReport', ([html, options]: [string, { omitRootWrapper?: boolean }?]) => {
            try {
                const { translateHtmlToXgeniaXmlWithReport } = require('../../EditorTopbar/html-translator');
                const { xml, warnings } = translateHtmlToXgeniaXmlWithReport(html, options);
                return { xml, translationWarnings: warnings };
            } catch (err: any) {
                console.error('[EditorBridge] html.translateWithReport failed:', err.message);
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

                // 2026-05-23 (BUG 76 fix, bridge half): refuse to create a
                // ComponentInstance whose target is the currently active
                // component. That produces a graph where the component
                // contains itself; every getPorts()/forEachNode pass on it
                // then recurses forever and crashes the editor with a
                // stack overflow. Trace 2026-05-23 13:25 hit this when an
                // AI passed `componentName: "/#__maths__/WildDoomMaths"`
                // as the node type while the active component WAS
                // /#__maths__/WildDoomMaths.
                if (typeof nodeType === 'string' && nodeType.startsWith('/')) {
                    const activeName = (graph as any)?.name || (graph as any)?.path || (graph as any)?.fullName;
                    if (activeName && nodeType === activeName) {
                        const msg = `Refusing to create ComponentInstance of "${nodeType}" inside itself — would produce a circular component reference that crashes the editor with a stack overflow on the next port lookup.`;
                        console.error('[EditorBridge] graph.createNode SELF-INSTANCE BLOCKED:', msg);
                        throw new Error(msg);
                    }
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

        // 2026-05-23 (BUG 65 fix): bridge had no reparent handler, so
        // change_node_parent in bridge mode always fell through to the
        // legacy `NodeGraphModel.attachNode` path which can't see bridge-
        // proxied nodes — every call returned "Could not determine a valid
        // NodeGraphModel to perform reparenting." (trace 2026-05-23 07:39
        // tried 3× to move @ReelStage into @ReelArea, all failed). This
        // handler does the work directly: detach from old parent (or roots),
        // re-attach as a child of the new parent.
        h('graph.reparent', ([nodeId, newParentId, index]: [string, string, number?]) => {
            const graph = this.getActiveGraph();
            if (!graph) throw new Error('No active graph');
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            const newParent = this.findNode(newParentId);
            if (!newParent) throw new Error(`New parent not found: ${newParentId}`);
            if (typeof newParent.addChild !== 'function') {
                throw new Error(`Target parent (id=${newParentId}, type=${newParent.type?.name || newParent.typename}) is not a container — cannot accept children.`);
            }
            // 2026-05-25: defensive detach. The previous implementation only
            // checked `node.parent` and called `oldParent.removeChild(node)`.
            // When create_nodes_batch sets up parent-child via addChild but
            // doesn't synchronize `node.parent` (or sets `node.parent` to a
            // stale ref), the removeChild is a silent no-op and the node ends
            // up in BOTH the old parent's children array AND the new parent
            // — a true duplicate visible in get_app_xml under two roots.
            // Trace 2026-05-25 22:39: AI created @Lost with parent:@WrongParent
            // via batch, then change_node_parent to @RightParent — get_app_xml
            // showed @Lost as child of both groups.
            //
            // Fix: regardless of what node.parent says, walk ALL nodes in the
            // graph (via nodeMap), find any node that has this node in its
            // children array, and remove it there. This guarantees the node
            // exits ALL old containers before being added to the new one.
            try {
                const stalePathTried: string[] = [];
                const declaredOldParent: any = (node as any).parent;
                if (declaredOldParent && typeof declaredOldParent.removeChild === 'function') {
                    try { declaredOldParent.removeChild(node); stalePathTried.push('declaredOldParent.removeChild'); }
                    catch (e: any) { console.warn('[EditorBridge] removeChild from declared parent failed:', e?.message); }
                }
                // Defensive sweep: find any other parent still holding the node.
                const graphModel: any = (graph as any).model || graph;
                const nodeMap: any = graphModel?.nodeMap;
                const allNodes: any[] = [];
                if (nodeMap) {
                    if (typeof nodeMap.values === 'function') {
                        for (const n of nodeMap.values()) allNodes.push(n);
                    } else if (typeof nodeMap === 'object') {
                        for (const k of Object.keys(nodeMap)) allNodes.push(nodeMap[k]);
                    }
                }
                if (Array.isArray(graphModel?.roots)) {
                    for (const r of graphModel.roots) if (!allNodes.includes(r)) allNodes.push(r);
                }
                for (const candidate of allNodes) {
                    if (!candidate || candidate === node) continue;
                    const children = candidate.children;
                    if (!Array.isArray(children) || children.length === 0) continue;
                    if (!children.includes(node)) continue;
                    if (typeof candidate.removeChild === 'function') {
                        try {
                            candidate.removeChild(node);
                            stalePathTried.push(`sweep(${candidate.id || candidate.label})`);
                        } catch (e: any) {
                            console.warn(`[EditorBridge] sweep removeChild from ${candidate.id || candidate.label} failed:`, e?.message);
                        }
                    } else {
                        // Last resort: splice out of the array directly.
                        try {
                            const idx = children.indexOf(node);
                            if (idx >= 0) {
                                children.splice(idx, 1);
                                stalePathTried.push(`sweep-splice(${candidate.id || candidate.label})`);
                            }
                        } catch { /* defensive */ }
                    }
                }
                // 2026-06-02 (R35): NodeGraphModel has addRoot() but NO
                // removeRoot() method. The previous code checked `typeof ===
                // 'function'` and silently skipped when absent — leaving the
                // node BOTH in graph.roots AND inserted as a child of the
                // new parent below. Every change_node_parent call on a
                // root-level node produced a duplicate that get_app_xml
                // surfaced as two nodes with the same label.
                //
                // Trace 1780349709 (the GTA reparent attempt) showed all 7
                // reparented nodes ending up doubled, then the AI tried 8
                // undos. The "verified: true" in the response was a lie —
                // only addChild's lack-of-throw was checked, not the actual
                // hierarchy.
                //
                // Fix: directly splice from graph.roots if the node is
                // there. Try removeRoot first (in case a future model adds
                // it), then fall through to the array splice.
                let detachedFromRoots = false;
                try {
                    const graphModelForRoots: any = (graph as any).model || graph;
                    if (typeof graphModelForRoots.removeRoot === 'function') {
                        try {
                            graphModelForRoots.removeRoot(node);
                            stalePathTried.push('removeRoot');
                            detachedFromRoots = true;
                        } catch { /* fall through to splice */ }
                    }
                    if (!detachedFromRoots && Array.isArray(graphModelForRoots.roots)) {
                        const rootIdx = graphModelForRoots.roots.indexOf(node);
                        if (rootIdx >= 0) {
                            graphModelForRoots.roots.splice(rootIdx, 1);
                            stalePathTried.push(`roots-splice(idx=${rootIdx})`);
                            detachedFromRoots = true;
                        }
                    }
                    // Defensive: if roots stores by id rather than object, try a second pass
                    if (!detachedFromRoots && Array.isArray(graphModelForRoots.roots)) {
                        const rootIdById = graphModelForRoots.roots.findIndex((r: any) => r?.id === node.id);
                        if (rootIdById >= 0) {
                            graphModelForRoots.roots.splice(rootIdById, 1);
                            stalePathTried.push(`roots-splice-by-id(idx=${rootIdById})`);
                            detachedFromRoots = true;
                        }
                    }
                } catch (rootDetachErr: any) {
                    console.warn('[EditorBridge] root detach failed (non-fatal):', rootDetachErr?.message);
                }
                if (stalePathTried.length === 0) {
                    console.warn(`[EditorBridge] reparent ${nodeId}: no detach path executed (node may already be free).`);
                }
            } catch (detachErr: any) {
                console.warn('[EditorBridge] reparent detach phase non-fatal error:', detachErr?.message);
            }
            try {
                if (typeof index === 'number' && index >= 0) {
                    // (2026-06-23, trace 1782197236224 issue #16) NodeGraphNode's real
                    // index-insert method is `insertChild(child, index)` — there is NO
                    // `addChildAt`. The old probe checked for the non-existent addChildAt
                    // and ALWAYS fell through to addChild (append), silently dropping the
                    // index. That's why change_node_parent's position_index was a no-op
                    // ("only gives end of list") and why reorder had no working bridge path.
                    // Prefer insertChild; keep addChildAt for any alternate model that has it.
                    if (typeof (newParent as any).insertChild === 'function') {
                        (newParent as any).insertChild(node, index);
                    } else if (typeof (newParent as any).addChildAt === 'function') {
                        (newParent as any).addChildAt(node, index);
                    } else {
                        newParent.addChild(node);
                    }
                } else {
                    newParent.addChild(node);
                }
            } catch (e: any) {
                throw new Error(`addChild on new parent failed: ${e?.message || e}`);
            }
            // Also update the node.parent backref if the framework didn't.
            try { (node as any).parent = newParent; } catch { /* read-only in some models */ }

            // 2026-06-02 (R35): real verification. The previous code returned
            // { success: true } based on addChild not throwing. That missed
            // the duplicate-root bug entirely. Walk the graph now and confirm:
            //   (a) node is in newParent.children EXACTLY ONCE
            //   (b) node is NOT in graph.roots
            //   (c) no other parent's children array contains node
            const verification = (() => {
                try {
                    const graphModelV: any = (graph as any).model || graph;
                    const inNewParent = Array.isArray(newParent.children) && newParent.children.filter((c: any) => c === node || c?.id === node.id).length;
                    const stillInRoots = Array.isArray(graphModelV.roots) && graphModelV.roots.some((r: any) => r === node || r?.id === node.id);
                    const otherParents: string[] = [];
                    const nodeMapV: any = graphModelV.nodeMap;
                    const allV: any[] = [];
                    if (nodeMapV?.values) for (const n of nodeMapV.values()) allV.push(n);
                    else if (nodeMapV) for (const k of Object.keys(nodeMapV)) allV.push(nodeMapV[k]);
                    for (const cand of allV) {
                        if (!cand || cand === node || cand === newParent) continue;
                        const children = cand.children;
                        if (Array.isArray(children) && children.some((c: any) => c === node || c?.id === node.id)) {
                            otherParents.push(cand.id || cand.label || 'unknown');
                        }
                    }
                    return {
                        ok: inNewParent === 1 && !stillInRoots && otherParents.length === 0,
                        inNewParentCount: inNewParent,
                        stillInRoots,
                        otherParents,
                    };
                } catch (vErr: any) {
                    return { ok: false, verificationError: vErr?.message };
                }
            })();

            console.log(`[EditorBridge] Reparented ${nodeId} → ${newParentId}`, verification);
            if (!verification.ok) {
                // Don't silently lie about success. The AI needs to know.
                throw new Error(
                    `Reparent verification FAILED: ${JSON.stringify(verification)}. ` +
                    `Node may now be duplicated in graph state. Use find_nodes_by_label to check, ` +
                    `then delete the orphan copies before continuing.`
                );
            }
            return { success: true, verified: true, verification };
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
            // Pass through whatever the underlying model returns. Callers
            // already detect success via post-create connection-existence
            // checks (see safe_connection_workflow); changing the shape here
            // would break those existing flows.
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

            // Strategy 2: Parse semantic format "fromId:fromProperty→toId:toProperty".
            // 2026-06-01 (xgenia-debug-export-1779795859929 fix): also accept the
            // ASCII "->" arrow. The edit_js_function_node ghost-cleanup path uses
            // `conn.id` first (line 1748), and many GPL-side connection.id strings
            // are built with "->", so the previous "→"-only branch rejected them
            // outright and we threw "Connection not found" for connections that
            // genuinely existed. Trace 2026-05-26 11:44 had four SpinResult /
            // WinAmount / SpecialReel / CashCollect ghost-removals all fall here.
            const arrowIdx = connectionId.indexOf('→') >= 0
                ? connectionId.indexOf('→')
                : connectionId.indexOf('->');
            const arrowLen = connectionId.includes('→') ? 1 : 2;
            if (!conn && arrowIdx > 0) {
                const fromPart = connectionId.substring(0, arrowIdx);
                const toPart = connectionId.substring(arrowIdx + arrowLen);
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
            if (!conn && (connectionId === 'undefined:undefined→undefined:undefined'
                       || connectionId === 'undefined:undefined->undefined:undefined')) {
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

        // COMMENTS (sticky notes) — a SEPARATE canvas layer from nodes, held in
        // graph.commentsModel, NOT walked by any node/XML serializer. The AI was
        // blind to them (trace 1784753612441: an empty component with two comments
        // read as "nothing here"). These handlers surface + edit them.
        h('graph.getComments', () => {
            const cm = this.getActiveGraph()?.commentsModel;
            return cm && Array.isArray(cm.comments) ? cm.comments.map((c: any) => ({ ...c })) : [];
        });
        h('graph.addComment', ([comment]: [any]) => {
            const cm = this.getActiveGraph()?.commentsModel;
            if (!cm || typeof cm.addComment !== 'function') return null;
            const c: any = {
                text: comment?.text ?? '',
                x: comment?.x ?? 0, y: comment?.y ?? 0,
                width: comment?.width ?? 150, height: comment?.height ?? 100,
                fill: comment?.fill ?? 'transparent',
                ...(comment?.color ? { color: comment.color } : {}),
                ...(comment?.id ? { id: comment.id } : {}),
            };
            cm.addComment(c); // assigns c.id if absent
            return { ...c };
        });
        h('graph.updateComment', ([id, patch]: [string, any]) => {
            const cm = this.getActiveGraph()?.commentsModel;
            if (!cm) return false;
            const existing = (cm.comments || []).find((c: any) => c.id === id);
            if (!existing) return false;
            cm.setComment(id, { ...existing, ...(patch || {}) });
            return true;
        });
        h('graph.deleteComment', ([id]: [string]) => {
            const cm = this.getActiveGraph()?.commentsModel;
            if (!cm) return false;
            const before = (cm.comments || []).length;
            cm.removeComment(id);
            return (cm.comments || []).length < before;
        });

        // --- Node commands ---
        h('node.setParameter', ([nodeId, name, value]: [string, string, any]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            // 2026-05-29 (Round 9 Fix): return success boolean so the iframe
            // caller can distinguish "setter accepted the value" from "setter
            // was missing or rejected". Previously the handler returned
            // undefined and the caller had no way to detect silent rejections.
            if (typeof node.setParameter !== 'function') return false;
            node.setParameter(name, value);
            return true;
        });

        h('node.getParameter', ([nodeId, name]: [string, string]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            return node.getParameter?.(name);
        });

        // LAYOUT-3: batch-apply node positions (auto_organize_nodes / apply_graph_diff)
        // THROUGH the editor's undo system so a single Undo reverts the whole reposition.
        // The iframe previously set x/y on the bridge proxy directly — that moved the nodes
        // but pushed an EMPTY undo group (the proxy is not the editor's UndoQueue, and the
        // setParameter calls were not registered with any group), so Undo did nothing.
        h('node.setPositionsUndoable', ([changes]: [Array<{ nodeId: string; x: number; y: number }>]) => {
            if (!Array.isArray(changes) || changes.length === 0) return { applied: 0, total: 0 };
            const group = new UndoActionGroup({ label: 'Auto-organize Nodes' });
            let applied = 0;
            for (const change of changes) {
                const node = this.findNode(change.nodeId);
                if (!node || typeof node.setParameter !== 'function') continue;
                node.setParameter('x', change.x, { undo: group });
                node.setParameter('y', change.y, { undo: group });
                applied++;
            }
            if (applied > 0) UndoQueue.instance?.push?.(group);
            return { applied, total: changes.length };
        });

        h('node.setLabel', ([nodeId, label]: [string, string]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            // 2026-05-29 (Round 9 Fix): same as setParameter — return true on
            // successful assignment, false if the property setter was rejected.
            try {
                node.label = label;
                // Re-read to verify the setter wasn't a no-op getter (computed property).
                return node.label === label;
            } catch {
                return false;
            }
        });

        // BRAIN: merge AI/user annotations under node.metadata.ai. metadata
        // round-trips through NodeGraphNode.toJSON, so this persists into
        // project.json. We fire a Model.* change event so the 1s autosave
        // debounce (projectmodel.ts) writes it to disk. Best-effort mirror of
        // the .xgenia/brain.json sidecar, which stays authoritative.
        h('node.setMetadata', ([nodeId, patch]: [string, Record<string, any>]) => {
            const node = this.findNode(nodeId);
            if (!node) throw new Error(`Node not found: ${nodeId}`);
            try {
                const meta = ((node as any).metadata && typeof (node as any).metadata === 'object')
                    ? (node as any).metadata : ((node as any).metadata = {});
                meta.ai = { ...(meta.ai || {}), ...(patch || {}), updatedAt: new Date().toISOString() };
                // Trigger autosave without disturbing parameter/port listeners.
                if (typeof (node as any).notifyListeners === 'function') {
                    (node as any).notifyListeners('metadataChanged', { model: node, key: 'ai' });
                }
                return true;
            } catch {
                return false;
            }
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

        // --- Git commands ---
        // 2026-06-06 (Option B): bridge dugite git through the EditorProxy so
        // the AI chat panel (iframed from Vercel) can checkpoint/commit/revert.
        // The iframe has no window.require / no dugite binary; the parent
        // (Electron editor) has both. All git ops route here.
        //
        // Security:
        //   - checkpoint / status / history are READ-ONLY (no remote side-effects)
        //   - commit / revert are LOCAL mutations (no remote side-effects)
        //   - push talks to a USER-CONFIGURED remote — the user has already
        //     authorized that remote via the Version Control panel; AI-initiated
        //     push is treated as an authorized action under that prior consent.
        h('git.isAvailable', async () => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) {
                    return { available: false, reason: 'No project directory' };
                }
                const { LocalProjectsModel } = await import('@xgenia-utils/LocalProjectsModel');
                const isGit = await (LocalProjectsModel as any).instance?.isGitProject?.(pm);
                return { available: !!isGit };
            } catch (e: any) {
                return { available: false, reason: e?.message || String(e) };
            }
        });

        h('git.ensureInitialized', async () => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) {
                    return { success: false, action: 'skipped', error: 'No project directory available' };
                }
                const projectDir = pm._retainedProjectDirectory;
                const { LocalProjectsModel } = await import('@xgenia-utils/LocalProjectsModel');
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const isGit = await (LocalProjectsModel as any).instance?.isGitProject?.(pm);
                if (!isGit) {
                    const g = new Git(mergeProject);
                    await g.initNewRepo(projectDir);
                    try {
                        const st = await g.status();
                        if (st && st.length > 0) {
                            await g.commit('Initial AI checkpoint');
                        }
                    } catch { /* repo initialised; baseline commit failed; still usable */ }
                    return { success: true, action: 'initialized' };
                }
                const g = new Git(mergeProject);
                await g.openRepository(projectDir);
                const st = await g.status();
                if (st && st.length > 0) {
                    await g.commit('AI session baseline');
                    return { success: true, action: 'baseline_committed' };
                }
                return { success: true, action: 'already_clean' };
            } catch (e: any) {
                return { success: false, action: 'failed', error: e?.message || String(e) };
            }
        });

        h('git.getHead', async () => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { sha: null, error: 'No project directory' };
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                const sha = await g.getHeadCommitId();
                return { sha: sha || null };
            } catch (e: any) {
                return { sha: null, error: e?.message || String(e) };
            }
        });

        h('git.status', async () => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { files: [], error: 'No project directory' };
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                const raw = await g.status();
                const files = Array.isArray(raw)
                    ? raw.map((f: any) => ({
                        path: f?.path ?? f?.file ?? String(f),
                        status: f?.status ?? f?.workingTreeStatus ?? '?',
                    }))
                    : [];
                return { files };
            } catch (e: any) {
                return { files: [], error: e?.message || String(e) };
            }
        });

        h('git.commit', async ([message]: [string]) => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { success: false, error: 'No project directory' };
                if (!message || typeof message !== 'string') {
                    return { success: false, error: 'Commit message required' };
                }
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                const sha = await g.commit(message);
                return { success: true, sha, message };
            } catch (e: any) {
                return { success: false, error: e?.message || String(e) };
            }
        });

        h('git.revert', async ([sha]: [string]) => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { success: false, error: 'No project directory' };
                if (!sha || typeof sha !== 'string') return { success: false, error: 'Target SHA required' };
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                // Prefer a dedicated revert API when available; fall back to reset-hard.
                const anyG: any = g as any;
                if (typeof anyG.revertToCommit === 'function') {
                    await anyG.revertToCommit(sha);
                } else if (typeof anyG.resetHard === 'function') {
                    await anyG.resetHard(sha);
                } else if (typeof anyG.checkout === 'function') {
                    await anyG.checkout(sha);
                } else {
                    return { success: false, error: 'No revert API available on Git instance' };
                }
                return { success: true, sha };
            } catch (e: any) {
                return { success: false, error: e?.message || String(e) };
            }
        });

        h('git.getHistory', async ([limit]: [number?]) => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { commits: [], error: 'No project directory' };
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                const anyG: any = g as any;
                const cap = Math.max(1, Math.min(50, Number(limit) || 10));
                // 2026-06-10 (workflow wdym5rje7 #3): the previous probe list
                // (getCommitHistory / log / history) contained ZERO methods
                // that exist on the Git class — raw was unconditionally []
                // and the handler returned {commits: []} with no error for
                // every repository. The real method is getCommitsCurrentBranch
                // (caps at 100 internally, takes no args; our slice keeps the
                // bridge cap). Probes kept as fallbacks for future builds.
                let raw: any = [];
                if (typeof anyG.getCommitsCurrentBranch === 'function') raw = await anyG.getCommitsCurrentBranch();
                else if (typeof anyG.getCommitHistory === 'function') raw = await anyG.getCommitHistory(cap);
                else if (typeof anyG.log === 'function') raw = await anyG.log(cap);
                else if (typeof anyG.history === 'function') raw = await anyG.history(cap);
                const commits = (Array.isArray(raw) ? raw : []).slice(0, cap).map((c: any) => ({
                    sha: c?.sha ?? c?.commit ?? c?.id ?? '',
                    shortSha: c?.shortSha ?? (typeof c?.sha === 'string' ? c.sha.slice(0, 7) : ''),
                    message: c?.message ?? c?.summary ?? '',
                    author: c?.author?.name ?? c?.author ?? '',
                    // Date → ISO keeps the payload structured-clone- and JSON-safe.
                    timestamp: c?.date instanceof Date ? c.date.toISOString() : (c?.timestamp ?? c?.date ?? c?.committedAt ?? null),
                }));
                return { commits };
            } catch (e: any) {
                return { commits: [], error: e?.message || String(e) };
            }
        });

        h('git.push', async () => {
            try {
                const pm = ProjectModel.instance as any;
                if (!pm?._retainedProjectDirectory) return { success: false, error: 'No project directory' };
                // 2026-06-10 (workflow wdym5rje7 #4): the previous handler
                // called the MODULE-level getRemote(g) / push(g) with the
                // Git INSTANCE where those functions expect a directory
                // string — getRemote treated the instance as a filesystem
                // path, the catch swallowed the throw, remote stayed null,
                // and the handler returned "No git remote configured" for
                // EVERY repository (including ones with remotes). git.push
                // through the bridge has never worked. Use the INSTANCE
                // methods (g.getRemoteName / g.push) which resolve the
                // repo from the opened baseDir.
                const { Git } = await import('@xgenia/git');
                const { mergeProject } = await import('@xgenia-utils/projectmerger');
                const g = new Git(mergeProject);
                await g.openRepository(pm._retainedProjectDirectory);
                // Confirm a remote exists before pushing — refuse silent setup.
                let remoteName: string | undefined;
                try { remoteName = await g.getRemoteName(); } catch { /* treat as no remote */ }
                if (!remoteName) {
                    return {
                        success: false,
                        error: 'No git remote configured. Set one up in the Version Control panel first.',
                        requiresUserAction: true,
                    };
                }
                const ok = await g.push();
                return { success: !!ok };
            } catch (e: any) {
                return { success: false, error: e?.message || String(e) };
            }
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
            // 2026-06-10 (workflow wdym5rje7 #5): previously a nonexistent
            // component name SILENTLY no-op'd — the handler resolved with
            // undefined, the AI's switch_component_safely read it as
            // success, cachedActiveComponent + the AI lock stayed on the
            // PREVIOUS component, and every subsequent mutation landed in
            // the wrong graph. This is the bridge-side root of the
            // wrong-component family of bugs (Cell duplication, orphan
            // wires). Throw with the available list — PluginBridge
            // surfaces the message via msg.error → pending.reject, and
            // NodeGraphUtils already catches + logs it, so existing
            // callers degrade to an explicit error instead of silence.
            if (!comp) {
                const available = components.slice(0, 30).map((c: any) => c.fullName || c.name).join(', ');
                throw new Error(`component.switchTo: no component named "${componentName}". Available: ${available || '(none — is a project open?)'}`);
            }
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
            return { success: true, name: comp.name, fullName: comp.fullName };
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

            // CLIFE-6: full-path/name match wins. Only fall back to basename when it is
            // UNAMBIGUOUS — the old code matched by basename across ALL folders and deleted
            // EVERY match in the loop, so deleting "Reels" silently destroyed both
            // /Pages/Reels and /Components/Reels. Never auto-delete multiple components.
            const exactMatches = allComponents.filter((c: any) => {
                const cn = c?.name || c?.fullName || '';
                return cn === wanted;
            });
            let matches: any[];
            if (exactMatches.length >= 1) {
                matches = exactMatches;
            } else {
                const basenameMatches = allComponents.filter((c: any) => {
                    const cn = c?.name || c?.fullName || '';
                    return stripPath(cn) === wantedStripped || stripPath(cn).toLowerCase() === wantedStripped.toLowerCase();
                });
                if (basenameMatches.length === 0) {
                    return { success: false, error: `No component matches "${nameOrFullName}"`, deletedCount: 0 };
                }
                if (basenameMatches.length > 1) {
                    return {
                        success: false,
                        ambiguous: true,
                        error: `"${nameOrFullName}" is ambiguous across ${basenameMatches.length} components — pass the full path to delete a specific one`,
                        candidates: basenameMatches.map((c: any) => c?.name || c?.fullName || 'unknown'),
                        deletedCount: 0,
                    };
                }
                matches = basenameMatches;
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

        h('component.createWithTemplate', ([name, templateJSON, switchTo]: [string, any, boolean?]) => {
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

            // Only move the AI's active scope (cache + lock) onto the new component
            // when the caller explicitly asked. A default create_component must NOT
            // relocate the mutation target to the new empty component while the UI
            // still shows the original one — that is silent wrong-component drift.
            if (switchTo) {
                this.cachedActiveComponent = newComponent;
                this.setAiLock(newComponent);
                this.pushEvent('componentSwitched', {
                    name: newComponent.name,
                    fullName: newComponent.fullName || newComponent.name,
                });
            }

            // Return the REAL created structure (roots), not just a stripped serialization,
            // so the tool can verify what was actually created instead of asserting its
            // own local template. Mirrors project.getComponentsWithGraph.
            const result: any = this.serializeComponent(newComponent);
            const graph = newComponent.graph;
            if (graph) {
                const graphModel = graph.model || graph;
                const roots = graphModel.roots || [];
                result.graph = { roots: roots.map((n: any) => this.serializeNode(n)) };
            }
            return result;
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

        // --- XRGS (maths/RGS) bridge ---
        // The AI plugin runs in an iframe and cannot reach `window.__xrgs` (it lives on the editor
        // window, defined at MathsPanel module load — eagerly imported by router.setup.ts). These
        // passthroughs let the iframe reach the RGS API key, the maths compiler, and the shared
        // test config (active game + settings). Without them the AI's RGS tools are dead in prod.
        // Key + config use the `xgenia_rgs_settings` localStorage key directly (single source of
        // truth, independent of whether the Maths panel is mounted); compile/list go through __xrgs.
        const XRGS_DEFAULT_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';
        const readRgs = (): any => {
            try { return JSON.parse(localStorage.getItem('xgenia_rgs_settings') || '{}'); } catch { return {}; }
        };
        const writeRgs = (patch: Record<string, any>): void => {
            try { localStorage.setItem('xgenia_rgs_settings', JSON.stringify({ ...readRgs(), ...patch })); } catch { /* ignore */ }
        };
        h('xrgs.getSettings', () => {
            const s = readRgs();
            return s.apiKey ? { apiKey: s.apiKey, url: s.rgsUrl || XRGS_DEFAULT_URL } : null;
        });
        h('xrgs.getActiveGame', () => readRgs().activeGame ?? null);
        h('xrgs.setActiveGame', ([game]: [any]) => { writeRgs({ activeGame: game ?? null }); return true; });
        h('xrgs.getTestSettings', () => readRgs().testSettings ?? null);
        h('xrgs.setTestSettings', ([s]: [any]) => {
            const next = { ...(readRgs().testSettings || {}), ...(s || {}) };
            writeRgs({ testSettings: next });
            return next;
        });
        h('xrgs.generateScript', ([componentName]: [string?]) => {
            try {
                const xrgs = (window as any).__xrgs;
                return xrgs?.generateRgsScript
                    ? xrgs.generateRgsScript(componentName)
                    : { error: 'Maths bridge not available — open the Maths panel once to initialise it.' };
            } catch (e: any) {
                return { error: e?.message || 'generateScript failed' };
            }
        });
        h('xrgs.getMathsComponents', () => {
            try { return (window as any).__xrgs?.getMathsComponents?.() ?? []; } catch { return []; }
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
            const path = require('path');
            // Resolve relative paths against the project dir (same bug class as fs.readDirDetailed) — a raw
            // relative path here would unlink from the editor's OWN bundle dir, a real footgun.
            const projectDir = ProjectModel.instance?._retainedProjectDirectory;
            const isAbsolute = filePath.startsWith('/') || filePath.includes(':');
            if (!isAbsolute && !projectDir) return false;
            const fullPath = isAbsolute ? filePath : path.join(projectDir, filePath);
            if (fs.existsSync(fullPath)) {
                fs.unlinkSync(fullPath);
            }
            return true;
        });

        h('fs.readDir', ([dirPath]: [string]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance?._retainedProjectDirectory;
            const isAbsolute = dirPath.startsWith('/') || dirPath.includes(':');
            if (!isAbsolute && !projectDir) return [];
            const fullPath = isAbsolute ? dirPath : path.join(projectDir, dirPath);
            if (!fs.existsSync(fullPath)) return [];
            return fs.readdirSync(fullPath);
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

        // Record AI provenance (prompt/model/params) for a saved asset, keyed by its
        // project-relative path ('assets/...'). The AI calls this right after saving a
        // generated image so the asset carries "what the AI did" (shown in the Inspector).
        h('assetMeta.set', async ([assetPath, entry]: [string, { ai?: any; tags?: string[]; favorite?: boolean }]) => {
            if (!assetPath || !entry) return false;
            try {
                if (entry.ai) await recordAssetProvenance(assetPath, entry.ai);
                return true;
            } catch (e) {
                console.warn('[EditorBridge] assetMeta.set failed:', e);
                return false;
            }
        });

        // Migrate asset metadata (tags/provenance) when the AI renames/moves an asset,
        // so it isn't orphaned. Prefix-aware (a folder move carries its inner files).
        h('assetMeta.migrate', async ([oldPath, newPath]: [string, string]) => {
            if (!oldPath || !newPath) return false;
            try {
                await loadAssetMeta();
                migrateAssetMeta(oldPath, newPath);
                try {
                    reconcileGraphAssetRefs(oldPath, newPath);
                } catch {
                    /* graph reconciliation is best-effort */
                }
                return true;
            } catch (e) {
                console.warn('[EditorBridge] assetMeta.migrate failed:', e);
                return false;
            }
        });

        h('fs.stat', ([filePath]: [string]) => {
            const fs = require('fs');
            const path = require('path');
            const projectDir = ProjectModel.instance?._retainedProjectDirectory;
            const isAbsolute = filePath.startsWith('/') || filePath.includes(':');
            if (!isAbsolute && !projectDir) return null;
            const fullPath = isAbsolute ? filePath : path.join(projectDir, filePath);
            if (!fs.existsSync(fullPath)) return null;
            const stat = fs.statSync(fullPath);
            return { size: stat.size, modified: stat.mtime.toISOString(), isFile: stat.isFile(), isDirectory: stat.isDirectory() };
        });

        h('fs.readDirDetailed', ([dirPath]: [string]) => {
            const fs = require('fs');
            const path = require('path');
            // BUG (trace 1781972390362): a relative dirPath like 'assets' was passed straight to
            // fs.readdirSync, so it resolved against the EDITOR's process CWD — its own bundle dir, which
            // ships packages/xgenia-editor/assets/{cherry.png, videos/LogoIntroXGENIA.mp4}. The ChatPanel's
            // list-project-assets walks 'assets' via this bridge, so it read the editor's TEMPLATE SEED as
            // the project's inventory: reported 2 phantom assets (cherry + the XGENIA intro), MISSED all the
            // real ones, and the AI regenerated symbols it already had. Resolve relative paths against the
            // loaded project directory, exactly like fs.readFile / fs.exists / fs.mkdir already do.
            const projectDir = ProjectModel.instance?._retainedProjectDirectory;
            const isAbsolute = dirPath.startsWith('/') || dirPath.includes(':');
            if (!isAbsolute && !projectDir) return [];
            const fullPath = isAbsolute ? dirPath : path.join(projectDir, dirPath);
            if (!fs.existsSync(fullPath)) return [];
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
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

                // ═══ MULTI-CLIENT EVAL SELECTION (trace 1785088922912) ═══
                // sendRuntimeEval BROADCASTS — it carries no client id, so every connected
                // client runs it and every one replies with the same evalId. The old handler
                // took the FIRST reply and unsubscribed, discarding the rest. When both the
                // real viewer (localhost:8574, "XGENIA Viewer", 10 body children) and the
                // cloud-runtime shell (cloudruntime/index.html, 0 body children, 6 elements)
                // are connected, the EMPTY one wins the race for DOM-heavy code because it has
                // almost nothing to walk. That is why simulate_interaction could never find the
                // SPIN button while execute_code, one call later, enumerated it fine — and why
                // it looked intermittent (execute_code hit the shell too, on other calls).
                //
                // Fix: score each reply by whether its document actually has content, and
                // prefer a real one. Zero added latency in the healthy case — a good reply
                // resolves immediately; only an empty-document reply waits briefly to see if a
                // real viewer answers too. Falls back to first-reply behaviour if no client
                // reports a document (older viewers), so this can only ever improve selection.
                let settled = false;
                let graceTimer: any = null;
                let best: any = null;

                const scoreOf = (m: any): number => {
                    if (!m?.success) return -10;
                    const raw = m.result;
                    const doc = raw && typeof raw === 'object' ? (raw as any).__doc : null;
                    if (!doc) return 0; // unknown shape — neutral, never worse than a known-empty
                    const kids = typeof doc.kids === 'number' ? doc.kids : -1;
                    if (kids > 0) return 1000 + (typeof doc.els === 'number' ? doc.els : 0);
                    return -1; // answered from an empty shell
                };

                const emit = (message: any) => {
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

                const finishWith = (message: any) => {
                    if (settled) return;
                    settled = true;
                    if (graceTimer) clearTimeout(graceTimer);
                    EventDispatcher.instance.off(evalId);
                    clearTimeout(timer);
                    emit(message);
                };

                const resultHandler = (response: any) => {
                    const message = response.args || response;
                    if (message.id !== evalId) return;
                    if (settled) return;

                    if (best === null || scoreOf(message) > scoreOf(best)) best = message;

                    // Take it now unless we KNOW it is bad: a real document (>0) is
                    // authoritative, and an unscoreable reply (0 — no __doc, e.g. a
                    // non-object result) must not pay the grace penalty on every call.
                    // Only a known-empty shell (-1) or a failure (-10) waits.
                    if (scoreOf(message) >= 0) { finishWith(message); return; }

                    // Empty-shell or error reply: wait for a better answer before accepting it.
                    //
                    // (trace 1785091702991) This was 300ms and that was far too short. The shell
                    // BAILS fast — empty scope, one 500ms retry, give up at ~500ms — while a real
                    // viewer deliberately waits out the caller's settle time before replying
                    // (simulate_interaction clicks, then waits settleMs — 2500ms in that run).
                    // So the good answer landed ~2s after the window had already closed, and the
                    // shell's useless reply won anyway. A known-bad reply carries NO information,
                    // so waiting for a better one costs nothing but latency, and only in the case
                    // where no better client exists. Bound it by the caller's own timeout — they
                    // already agreed to wait that long — capped so a genuinely dead preview still
                    // fails promptly rather than hanging for the full 15s+.
                    if (!graceTimer) graceTimer = setTimeout(() => finishWith(best), Math.min(cappedTimeout, 5000));
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
                            // (trace 1783290828056) A closing-only line like `})();` or `})()` is the
                            // TAIL of a multi-line expression — prepending return produces `return })();`,
                            // a SyntaxError that kills the whole eval. Leave such code untouched
                            // (callers that need the value must return it explicitly).
                            const closingOnly = /^[)\]}\s;]*$/.test(trimmed);
                            // (trace 1783519124189 / 1783535424256) The auto-return is
                            // LINE-based, so when the last statement is a MULTI-LINE
                            // expression — `return JSON.stringify({\n  a: 1,\n  b: 2\n});`
                            // — the last non-closing line is a PROPERTY still inside the
                            // open `({`, and prepending `return` ("return b: 2") corrupts
                            // the object literal (SyntaxError: Unexpected identifier). Only
                            // auto-return when the last line is a COMPLETE top-level
                            // statement: nothing before it may have an unclosed ( [ {.
                            // Naive bracket count (can miscount inside strings/comments) but
                            // FAILS SAFE — a false "continuation" just skips the convenience
                            // return; it never corrupts valid code.
                            const before = lines.slice(0, lastIdx).join('\n');
                            const openDepth = (before.match(/[([{]/g) || []).length - (before.match(/[)\]}]/g) || []).length;
                            if (openDepth <= 0 && !noAutoReturn.test(trimmed) && !trimmed.endsWith('{') && !closingOnly) {
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
})().then(function(r) {
  // __doc lets the editor tell WHICH connected client answered (see MULTI-CLIENT EVAL
  // SELECTION above). runtimeEval is broadcast, so the empty cloud-runtime shell replies
  // too — and fastest. Consumers ignore __doc; only reply-scoring reads it.
  var __d = null;
  try {
    __d = {
      url: String((typeof location !== 'undefined' && location.href) || ''),
      kids: (typeof document !== 'undefined' && document.body && document.body.children) ? document.body.children.length : -1,
      els: (typeof document !== 'undefined' && document.getElementsByTagName) ? document.getElementsByTagName('*').length : -1
    };
  } catch (e) { __d = null; }
  return { __result: r, __logs: __logs, __doc: __d };
});`;
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
            // BRAIN: surface the AI/user annotation (purpose/notes) written into
            // node.metadata.ai so on-node knowledge round-trips back to the AI on
            // inspection — nodes carry data, not just the .xgenia/brain.json sidecar.
            ...(node.metadata?.ai ? { aiKnowledge: node.metadata.ai } : {}),
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

        // FIX (2026-05-25): Pixi pro nodes (pixi.MatterPhysics, pixi.Camera2D,
        // pixi.CollisionDetector, pixi.Graphics, pixi.Sprite, etc.) store
        // input port values via setter -> this._internal.X. getParameters()
        // typically does NOT enumerate those — only params explicitly tracked
        // in the model's parameter list show up. Result: AI calls
        // set_node_parameters({ enabled: true }) which succeeds (setter runs,
        // _internal.enabled = true), but the bridge then serializes
        // parameters: {} and tools like verify_logic_correctness see the node
        // as if `enabled` were never set. Trace 2026-05-25: CHECK 23 falsely
        // reported `visual_render_blank` on 3 MatterPhysics nodes whose
        // enabled was actually true at runtime.
        //
        // Fix: for any node, walk its declared input ports and explicitly
        // call getParameter(portName) for each one not already in params.
        // This catches every port the node type declares, regardless of
        // whether getParameters() exposes it.
        //
        // FIX (2026-05-25 — same trace, second issue): the editor model wraps
        // some dimension params (width/height/fontSize/padding/margin) as
        // {value, unit} objects for its property-editor UI. When we surface
        // the wrap to the AI side via getParameter, tools like
        // verify_logic_correctness's malformed_dimension_param check trip on
        // it as if the AI passed bad input. Flatten via unwrapValueUnit
        // (serialize-param-guard.ts) — which, since traces 1784010250453 /
        // 1784051747260 (the "width: 100" phantom), preserves responsive units
        // (%/vw/vh/em/rem) as CSS strings instead of collapsing everything to
        // a bare number. Exotic units (deg, vmin, …) intentionally stay bare
        // numbers — see the export's doc comment and the shared regression
        // lock (unwrap-value-unit.test.ts) that pins both this and the
        // xgenia-ai twin preserveDimensionUnit to the same unit set.
        // 2026-06-22: serialize every declared input port, skipping only the known
        // bloat pseudo-port (see isBloatPort) + a size backstop. The earlier
        // inputFormatHints allowlist (2026-05-25) over-corrected the pixi
        // functionScript bloat by also dropping PRIMARY params (Text.text,
        // button.label) — trace 1782150899325.
        try {
            let rawPorts: any[] = [];
            if (typeof node.getPorts === 'function') {
                rawPorts = node.getPorts() || [];
            }
            if (!rawPorts.length) {
                rawPorts = node.ports || [];
            }
            if (!rawPorts.length) {
                const typeName2 = node.type?.name || node.typename;
                if (typeName2) {
                    const type = (NodeLibrary.instance as any)?.getNodeTypeWithName?.(typeName2);
                    if (type?.ports && Array.isArray(type.ports)) {
                        rawPorts = type.ports;
                    }
                }
            }
            const typeName3 = node.type?.name || node.typename || '';
            const isJSFunction = (typeName3 || '').toLowerCase() === 'javascriptfunction'
                || (typeName3 || '').toLowerCase() === 'javascript2';
            for (const p of rawPorts) {
                if (!p?.name) continue;
                // Skip output ports — those are computed, not stored.
                if (p.plug === 'output') continue;
                // Skip signal ports — they're triggers, not values.
                const portTypeName = (p.type?.name || p.type || '').toString().toLowerCase();
                if (portTypeName === 'signal') continue;
                if (params[p.name] !== undefined && params[p.name] !== null) continue;
                // GATE: serialize EVERY declared input port except the known bloat
                // pseudo-port (functionScript on pixi.* returns the whole ~98KB
                // node-type def). The previous allowlist (compiled-docs
                // inputFormatHints) was partial and dropped PRIMARY params like
                // Text.text and button.label — so inspect_node, verify_logic_correctness
                // and the debug export saw empty content and a button with params:[]
                // (trace 1782150899325, the phantom "empty text"). A size backstop
                // catches any other pathologically-large value.
                if (isBloatPort(p.name, isJSFunction)) continue;
                try {
                    const v = typeof node.getParameter === 'function' ? node.getParameter(p.name) : undefined;
                    if (v !== undefined && v !== null && !isTooLargeToSerialize(v)) {
                        params[p.name] = unwrapValueUnit(v, portTypeName);
                    }
                } catch { /* skip ports that error on read */ }
            }
            // Also unwrap any pre-existing params (from getParameters()) that
            // arrived in {value,unit} form for number ports.
            for (const p of rawPorts) {
                if (!p?.name || p.plug === 'output') continue;
                const portTypeName = (p.type?.name || p.type || '').toString().toLowerCase();
                if (portTypeName === 'signal') continue;
                if (params[p.name] !== undefined && params[p.name] !== null) {
                    params[p.name] = unwrapValueUnit(params[p.name], portTypeName);
                }
            }
        } catch { /* defensive: never let serializer throw */ }

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
