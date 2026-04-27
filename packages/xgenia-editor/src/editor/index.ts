// src/editor/index.ts

// Disable console.log globally - must be first!
const DISABLE_CONSOLE_LOGS = true;
if (DISABLE_CONSOLE_LOGS) {
    const noop = () => { };
    console.log = noop;
    console.debug = noop;
    console.info = noop;
    // Keep console.warn and console.error for important messages
}

import * as remote from '@electron/remote';
import { ipcRenderer } from 'electron';
import React from 'react';
import { createRoot } from 'react-dom/client';
// import './src/firebaseInit' // REMOVED: Firebase no longer used
import './process-setup';

// ── WEB_MODE filesystem bootstrap ────────────────────────
// Must run before any code that uses @xgenia/platform filesystem
if (process.env.WEB_MODE) {
    try {
        const { FileSystemWeb } = require('./src/utils/filesystem-web');
        const { setFileSystem } = require('@xgenia/platform');
        setFileSystem(new FileSystemWeb());
        console.warn('[WEB_MODE] In-memory filesystem initialised');
    } catch (e) {
        console.error('[WEB_MODE] Failed to initialise web filesystem:', e);
    }
}

import './src/styles/tailwind.css';

import { EventDispatcher } from '../shared/utils/EventDispatcher';
import { NodeLibrary } from './src/models/nodelibrary';
import { ProjectModel } from './src/models/projectmodel';

try {
  const { falService } = require('@xgenia/image-editor');
  falService.preloadModels().then(() => console.log('[Editor] Fal AI models preloading initiated'));
} catch {
  // @xgenia/image-editor not available (open-source build)
}

// CRITICAL FIX: Expose ProjectModel to window immediately for ChatPanel compatibility
// This ensures ProjectModel is available for chat history persistence
(window as any).ProjectModel = ProjectModel;
console.log('[Editor] ProjectModel exposed to window at startup for chat history compatibility');

// CSS imports
import '../editor/src/styles/custom-properties/animations.css';
import '../editor/src/styles/custom-properties/colors.css';
import '../editor/src/styles/custom-properties/fonts.css';

import { App } from './app';

// (Your existing IPC listeners can remain here.)
ipcRenderer.on('open-xgenia-uri', async (event, uri) => {
    if (uri.startsWith('xgenia:import/http')) {
        console.log('import: ', uri);
        EventDispatcher.instance.emit('importFromUrl', uri.substring('xgenia:import/'.length));
    }
});
ipcRenderer.on('import-projectmetadata', (event, data) => {
    ProjectModel.instance.mergeMetadata(data);
});

// Set up other viewer IPC events as needed…
function setupViewerIpc() {
    ipcRenderer.on('viewer-refreshed', () => {
        EventDispatcher.instance.emit('viewer-refreshed');
    });

    ipcRenderer.on('viewer-closed', () => {
        EventDispatcher.instance.emit('viewer-closed');
    });

    // Handle inspector node selection from webview
    ipcRenderer.on('inspector-select-node', (event, args) => {
        console.log('[Editor IPC] 🎯 RECEIVED inspector-select-node IPC:', args);
        console.log('[Editor IPC] Emitting inspectNodes EventDispatcher event');
        EventDispatcher.instance.emit('inspectNodes', args);
    });
}

window.addEventListener('DOMContentLoaded', () => {
    // (Optionally, register your node adapters here.)
    require('./src/models/NodeTypeAdapters/registeradapters');

    if ((window as any).$) {
        (window as any).$('body').on('contextmenu', () => false);
    }

    ipcRenderer.on('showAutoUpdatePopup', () => {
        (window as any)._hasNewAutoUpdateAvailable = true;
    });

    // Setup auto-update status display
    (function setupAutoUpdateStatusDisplay() {
        let statusEl: HTMLElement | null = null;

        function ensureStatusElement() {
            if (statusEl) return statusEl;
            const el = document.createElement('div');
            el.id = 'auto-update-status';
            el.style.position = 'fixed';
            el.style.top = '12px';
            el.style.left = '12px';
            el.style.zIndex = '999998';
            el.style.background = 'rgba(17,17,17,0.92)';
            el.style.color = '#eee';
            el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            el.style.fontSize = '14px';
            el.style.border = '1px solid rgba(255,255,255,0.1)';
            el.style.borderRadius = '8px';
            el.style.padding = '10px 16px';
            el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.35)';
            el.style.backdropFilter = 'blur(6px)';
            el.style.display = 'none';
            document.body.appendChild(el);
            statusEl = el;
            return el;
        }

        function showStatus(message: string) {
            const el = ensureStatusElement();
            el.textContent = message;
            el.style.display = 'block';

            // Auto-hide after 5 seconds
            setTimeout(() => {
                if (el) {
                    el.style.display = 'none';
                }
            }, 5000);
        }

        ipcRenderer.on('autoUpdateStatus', (event, message: string) => {
            console.log('[AutoUpdate] Status:', message);
            showStatus(message);
        });
    })();

    setupViewerIpc();

    ipcRenderer.on('window-focused', () => {
        EventDispatcher.instance.notifyListeners('window-focused');
    });

    document.addEventListener('mousedown', () => {
        remote.getCurrentWindow().focus();
    });

    let lastActiveTime = Date.now();
    document.addEventListener('mousedown', () => {
        const now = Date.now();
        if (now > lastActiveTime + 10 * 60 * 1000) {
            EventDispatcher.instance.notifyListeners('wakeup');
        }
        lastActiveTime = now;
    });

    EventDispatcher.instance.on('ProjectModel.instanceWillChange', () => {
        window.NodeLibraryData = undefined;
        NodeLibrary.instance.reload();
    }, null);

    const rootElement = document.getElementById('root');
    if (rootElement) {
        const root = createRoot(rootElement);
        // Use React.createElement to render App without TSX.
        root.render(React.createElement(App, null));
    }

    // Lightweight renderer memory sampler with toggle (Cmd+Alt+M)
    (function setupRendererMemorySampler() {
        const hasPerfMemory = typeof (performance as any).memory !== 'undefined';
        let enabled = false;
        const samples: Array<{ t: number; used?: number; dom?: number; ua?: number }> = [];
        const recentResources: Array<{ t: number; name: string; type: string; bytes: number }> = [];
        let timer: any = null;

        // Small overlay panel UI
        let panelEl: HTMLElement | null = null;
        let panelVisible = false;
        function humanBytes(n?: number) {
            if (typeof n !== 'number') return 'n/a';
            const mb = n / 1048576;
            return `${mb.toFixed(2)} MB`;
        }
        function ensurePanel() {
            if (panelEl) return panelEl;
            const el = document.createElement('div');
            el.style.position = 'fixed';
            el.style.top = '12px';
            el.style.right = '12px';
            el.style.zIndex = '999999';
            el.style.background = 'rgba(17,17,17,0.92)';
            el.style.color = '#eee';
            el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
            el.style.fontSize = '12px';
            el.style.border = '1px solid rgba(255,255,255,0.1)';
            el.style.borderRadius = '8px';
            el.style.padding = '10px 12px';
            el.style.width = '320px';
            el.style.maxHeight = '60vh';
            el.style.overflow = 'auto';
            el.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
            el.style.backdropFilter = 'blur(6px)';
            el.innerHTML = '<div>Memory Panel</div>';
            document.body.appendChild(el);
            panelEl = el;
            return el;
        }
        function showPanel() {
            ensurePanel();
            if (panelEl) panelEl.style.display = 'block';
            panelVisible = true;
            renderPanel();
        }
        function hidePanel() {
            if (panelEl) panelEl.style.display = 'none';
            panelVisible = false;
        }
        function togglePanel() { panelVisible ? hidePanel() : showPanel(); }
        function renderPanel() {
            if (!panelVisible) return;
            const el = ensurePanel();
            const last = samples[samples.length - 1];
            const first = samples[0];
            const used = last?.used;
            const ua = last?.ua;
            const dom = last?.dom;
            const delta = used != null && first?.used != null ? used - first.used : undefined;
            const loads = recentLoads().slice(0, 8);
            const status = enabled ? '<span style="color:#86efac">RUNNING</span>' : '<span style="color:#fca5a5">STOPPED</span>';
            const btnLabel = enabled ? 'Stop' : 'Start';
            const loadsHtml = loads.map(l => `<div style="display:flex;justify-content:space-between;gap:8px"><span style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${l.name}">${l.type || 'res'}: ${l.name}</span><span>${humanBytes(l.bytes)}</span></div>`).join('');
            el.innerHTML = `
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                  <div style="font-weight:600;color:#fff">Memory Panel</div>
                  <div>${status}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
                  <div><div style="opacity:.7">JS Heap</div><div>${humanBytes(used)}</div></div>
                  <div><div style="opacity:.7">Δ Heap</div><div>${humanBytes(delta)}</div></div>
                  <div><div style="opacity:.7">UA Memory</div><div>${humanBytes(ua)}</div></div>
                  <div><div style="opacity:.7">DOM Nodes</div><div>${typeof dom === 'number' ? dom : 'n/a'}</div></div>
                </div>
                <div style="display:flex;gap:6px;margin-bottom:8px">
                  <button data-action="toggle" style="padding:4px 8px;border-radius:6px;background:${enabled ? '#7f1d1d' : '#064e3b'};color:#fff;border:0">${btnLabel}</button>
                  <button data-action="reveal" style="padding:4px 8px;border-radius:6px;background:#1f2937;color:#fff;border:0">Reveal Reports</button>
                  <button data-action="close" style="padding:4px 8px;border-radius:6px;background:#111827;color:#ddd;border:0">Hide</button>
                </div>
                <div style="opacity:.8;margin-bottom:4px">Recent loads (10s)</div>
                <div>${loadsHtml || '<div style="opacity:.6">None</div>'}</div>
            `;
            try {
                el.querySelector('[data-action="toggle"]')?.addEventListener('click', () => toggle());
                el.querySelector('[data-action="reveal"]')?.addEventListener('click', async () => {
                    try { await ipcRenderer.invoke('memprof:reveal'); } catch { }
                });
                el.querySelector('[data-action="close"]')?.addEventListener('click', () => hidePanel());
            } catch { }
        }

        try {
            const po = new (window as any).PerformanceObserver((list: any) => {
                const entries = list.getEntries ? list.getEntries() : [];
                for (const e of entries) {
                    if (!e) continue;
                    const name = (e as any).name || '';
                    const type = (e as any).initiatorType || '';
                    const bytes = (e as any).transferSize || (e as any).encodedBodySize || 0;
                    recentResources.push({ t: performance.now(), name, type, bytes });
                    if (recentResources.length > 2000) recentResources.shift();
                }
            });
            po.observe({ type: 'resource', buffered: true } as any);
        } catch { }

        async function sampleOnce() {
            const s: any = { t: performance.now() };
            try {
                if ((performance as any).memory) s.used = (performance as any).memory.usedJSHeapSize;
            } catch { }
            try {
                if ((performance as any).measureUserAgentSpecificMemory) {
                    const r = await (performance as any).measureUserAgentSpecificMemory();
                    s.ua = r && r.bytes ? r.bytes : undefined;
                }
            } catch { }
            try { s.dom = document.getElementsByTagName('*').length; } catch { }
            samples.push(s);
            if (samples.length > 3600) samples.shift();
            if (panelVisible) renderPanel();
        }

        function recentLoads(windowMs = 10000) {
            const now = performance.now();
            return recentResources.filter(r => now - r.t < windowMs).sort((a, b) => b.bytes - a.bytes).slice(0, 20);
        }

        function getMemoryBreakdown() {
            const breakdown: Array<{ category: string; size: number; details: string[] }> = [];

            try {
                // Analyze DOM memory
                const domNodes = document.getElementsByTagName('*').length;
                const domSize = domNodes * 64; // Rough estimate: 64 bytes per DOM node
                breakdown.push({
                    category: 'DOM Nodes',
                    size: domSize,
                    details: [`${domNodes} nodes`, `~${(domSize / 1024).toFixed(1)} KB estimated`]
                });

                // Analyze event listeners (rough estimate)
                const eventTargets = [window, document, document.body];
                let listenerCount = 0;
                eventTargets.forEach(target => {
                    try {
                        // This is a rough approximation since we can't directly count listeners
                        listenerCount += 10; // Assume ~10 listeners per major target
                    } catch { }
                });
                const listenerSize = listenerCount * 128; // ~128 bytes per listener
                breakdown.push({
                    category: 'Event Listeners',
                    size: listenerSize,
                    details: [`~${listenerCount} listeners`, `~${(listenerSize / 1024).toFixed(1)} KB estimated`]
                });

                // Analyze recent resource loads
                const recentLoads = recentResources.slice(-50); // Last 50 resources
                const totalResourceSize = recentLoads.reduce((sum, r) => sum + r.bytes, 0);
                breakdown.push({
                    category: 'Recent Resources',
                    size: totalResourceSize,
                    details: [
                        `${recentLoads.length} resources`,
                        `~${(totalResourceSize / 1024).toFixed(1)} KB total`
                    ]
                });

                // Analyze memory leaks (compare samples)
                if (samples.length > 10) {
                    const recent = samples.slice(-10);
                    const older = samples.slice(-20, -10);
                    const recentAvg = recent.reduce((sum, s) => sum + (s.used || 0), 0) / recent.length;
                    const olderAvg = older.reduce((sum, s) => sum + (s.used || 0), 0) / older.length;
                    const leak = recentAvg - olderAvg;
                    if (leak > 1024 * 1024) { // > 1MB
                        breakdown.push({
                            category: 'Potential Memory Leak',
                            size: leak,
                            details: [
                                `+${(leak / 1024 / 1024).toFixed(2)} MB`,
                                'Recent samples show growth'
                            ]
                        });
                    }
                }

                // Sort by size descending
                breakdown.sort((a, b) => b.size - a.size);

            } catch (e: any) {
                console.warn('[MemoryBreakdown] Error analyzing memory:', e);
            }

            return breakdown;
        }

        // Helper functions for heap analysis
        function analyzeNode(node: any, depth: number) {
            const indent = '  '.repeat(depth);
            const sizeMB = (node.selfSize / 1024 / 1024).toFixed(2);
            const callFrame = node.callFrame;

            if (callFrame) {
                const name = callFrame.functionName || callFrame.url || 'Unknown';
                const location = callFrame.url ? ` (${callFrame.url}:${callFrame.lineNumber})` : '';
                console.log(`${indent}${name}${location} - ${sizeMB} MB`);

                // Highlight suspicious patterns
                if (node.selfSize > 1024 * 1024) { // > 1MB
                    console.warn(`${indent}⚠️  LARGE ALLOCATION: ${sizeMB} MB`);
                }
                if (callFrame.url && callFrame.url.includes('projectmodules.js')) {
                    console.warn(`${indent}🚨 FILE OPERATIONS: ${sizeMB} MB in project modules`);
                }
                if (callFrame.url && callFrame.url.includes('node:events')) {
                    console.warn(`${indent}🚨 EVENT EMITTER: ${sizeMB} MB in event handling`);
                }
            }

            if (node.children && Array.isArray(node.children)) {
                for (const child of node.children) {
                    analyzeNode(child, depth + 1);
                }
            }
        }

        function analyzeSamples(samples: any[]) {
            const nodeStats = new Map<number, { count: number; totalSize: number; avgSize: number }>();

            for (const sample of samples) {
                const nodeId = sample.nodeId;
                if (!nodeStats.has(nodeId)) {
                    nodeStats.set(nodeId, { count: 0, totalSize: 0, avgSize: 0 });
                }

                const stats = nodeStats.get(nodeId)!;
                stats.count++;
                stats.totalSize += sample.size;
                stats.avgSize = stats.totalSize / stats.count;
            }

            return Array.from(nodeStats.entries()).map(([nodeId, stats]) => ({
                'Node ID': nodeId,
                'Sample Count': stats.count,
                'Total Size (KB)': (stats.totalSize / 1024).toFixed(1),
                'Avg Size (KB)': (stats.avgSize / 1024).toFixed(1)
            }));
        }

        function findSuspiciousPatterns(heapData: any) {
            // Look for V8 API usage
            if (heapData.head && heapData.head.children) {
                const v8Node = heapData.head.children.find((child: any) =>
                    child.callFrame && child.callFrame.functionName === '(V8 API)'
                );
                if (v8Node && v8Node.selfSize > 1024 * 1024) {
                    console.warn(`🚨 V8 API consuming ${(v8Node.selfSize / 1024 / 1024).toFixed(2)} MB`);
                    console.log('   This suggests heavy JavaScript execution or memory pressure');
                }
            }

            // Look for file operation patterns
            const fileOps = heapData.samples?.filter((s: any) =>
                s.nodeId === 157 // Based on your profile
            );
            if (fileOps && fileOps.length > 0) {
                console.warn(`🚨 File operations detected: ${fileOps.length} samples`);
                console.log('   Check for unclosed file handles or excessive file I/O');
            }

            // Look for event emitter patterns
            const eventOps = heapData.samples?.filter((s: any) =>
                s.nodeId === 73 // Based on your profile
            );
            if (eventOps && eventOps.length > 0) {
                console.warn(`🚨 Event emitter operations: ${eventOps.length} samples`);
                console.log('   Check for event listener leaks or excessive event emission');
            }
        }

        // Deep instrumentation to catch the real culprits
        let functionCallCounts = new Map<string, number>();
        let eventListenerCounts = new Map<string, number>();
        let componentLifecycleCounts = new Map<string, number>();
        let memoryAllocationPatterns: Array<{ time: number; size: number; stack: string; type: string }> = [];
        let functionCallStacks = new Map<string, Array<{ stack: string; count: number; lastSeen: number }>>();

        // Hook into function calls to detect loops
        function instrumentFunctionCalls() {
            try {
                // Hook into common XGENIA functions that might be looping
                const originalFunctions = new Map();

                // Hook into Model.notifyListeners (common source of loops)
                if ((window as any).Model && (window as any).Model.prototype && (window as any).Model.prototype.notifyListeners) {
                    const original = (window as any).Model.prototype.notifyListeners;
                    originalFunctions.set('Model.notifyListeners', original);

                    (window as any).Model.prototype.notifyListeners = function (...args: any[]) {
                        const key = `Model.notifyListeners:${args[0]}`;
                        functionCallCounts.set(key, (functionCallCounts.get(key) || 0) + 1);

                        // Check for excessive calls
                        const count = functionCallCounts.get(key) || 0;
                        if (count > 100) {
                            console.warn(`🚨 EXCESSIVE CALLS: ${key} called ${count} times`);
                        }

                        return original.apply(this, args);
                    };
                }

                // Hook into EventDispatcher (another common source)
                if ((window as any).EventDispatcher && (window as any).EventDispatcher.instance && (window as any).EventDispatcher.instance.emit) {
                    const original = (window as any).EventDispatcher.instance.emit;
                    originalFunctions.set('EventDispatcher.emit', original);

                    (window as any).EventDispatcher.instance.emit = function (...args: any[]) {
                        const key = `EventDispatcher.emit:${args[0]}`;
                        functionCallCounts.set(key, (functionCallCounts.get(key) || 0) + 1);

                        const count = functionCallCounts.get(key) || 0;
                        if (count > 50) {
                            console.warn(`🚨 EXCESSIVE EVENTS: ${key} emitted ${count} times`);
                        }

                        return original.apply(this, args);
                    };
                }

                // Hook into DOM manipulation with stack trace capture
                const originalCreateElement = document.createElement;
                document.createElement = function (...args: any[]) {
                    const key = `DOM.createElement:${args[0]}`;
                    const count = (functionCallCounts.get(key) || 0) + 1;
                    functionCallCounts.set(key, count);

                    // Capture stack trace for analysis
                    if (count % 100 === 0 || count > 500) { // Sample every 100 calls or if excessive
                        const stack = new Error().stack || '';
                        const stackLines = stack.split('\n').slice(2, 8); // Skip Error constructor lines
                        const cleanStack = stackLines.map(line => {
                            // Extract file:line:col from stack trace
                            const match = line.match(/\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
                            if (match) {
                                const [, func, file, line, col] = match;
                                const shortFile = file.split('/').pop() || file;
                                return `${func} (${shortFile}:${line}:${col})`;
                            }
                            return line.trim();
                        }).join('\n');

                        // Store stack trace
                        if (!functionCallStacks.has(key)) {
                            functionCallStacks.set(key, []);
                        }
                        const stacks = functionCallStacks.get(key)!;

                        // Check if we've seen this stack before
                        const existingStack = stacks.find(s => s.stack === cleanStack);
                        if (existingStack) {
                            existingStack.count++;
                            existingStack.lastSeen = Date.now();
                        } else {
                            stacks.push({ stack: cleanStack, count: 1, lastSeen: Date.now() });
                        }

                        // Warn with stack trace for excessive calls
                        if (count > 500) {
                            console.group(`🚨 EXCESSIVE DOM CREATION: ${key} called ${count} times`);
                            console.log('📍 Call Stack (most recent):');
                            console.log(cleanStack);

                            // Try to identify XGENIA component
                            const xgeniaMatch = cleanStack.match(/(\w+Component|\w+Model|\w+View|\w+Panel)/);
                            if (xgeniaMatch) {
                                console.warn(`🎯 Likely culprit: ${xgeniaMatch[1]}`);
                            }

                            console.groupEnd();
                        }
                    }

                    return originalCreateElement.apply(this, args);
                };

                // Hook into memory allocation
                const originalSetTimeout = window.setTimeout;
                (window as any).setTimeout = function (...args: any[]) {
                    const key = `setTimeout`;
                    functionCallCounts.set(key, (functionCallCounts.get(key) || 0) + 1);

                    const count = functionCallCounts.get(key) || 0;
                    if (count > 100) {
                        console.warn(`🚨 EXCESSIVE TIMEOUTS: ${count} setTimeout calls`);
                    }

                    return originalSetTimeout.apply(this, args);
                };

                console.log('🔧 Function instrumentation active - monitoring for loops');

            } catch (e: any) {
                console.warn('[Instrumentation] Error setting up hooks:', e);
            }
        }

        // Enhanced loop detection with deep instrumentation
        function detectLoops() {
            const loopDetections: Array<{ type: string; count: number; details: string; severity: 'low' | 'medium' | 'high' }> = [];

            try {
                // Check for rapid DOM changes
                if (samples.length > 10) {
                    const recent = samples.slice(-10);
                    const domChanges = recent.filter((s, i) => {
                        if (i === 0) return false;
                        const prev = recent[i - 1];
                        return s.dom && prev.dom && Math.abs(s.dom - prev.dom) > 10;
                    });

                    if (domChanges.length > 5) {
                        loopDetections.push({
                            type: 'DOM Mutation Loop',
                            count: domChanges.length,
                            details: `${domChanges.length} rapid DOM changes in last 10 samples`,
                            severity: 'high'
                        });
                    }
                }

                // Check for memory growth patterns
                if (samples.length > 20) {
                    const recent = samples.slice(-20);
                    const growthCount = recent.filter((s, i) => {
                        if (i === 0) return false;
                        const prev = recent[i - 1];
                        return s.used && prev.used && (s.used - prev.used) > 1024 * 1024; // > 1MB growth
                    }).length;

                    if (growthCount > 3) {
                        loopDetections.push({
                            type: 'Memory Growth Loop',
                            count: growthCount,
                            details: `${growthCount} memory spikes >1MB in last 20 samples`,
                            severity: 'high'
                        });
                    }
                }

                // Check for resource loading loops
                if (recentResources.length > 50) {
                    const lastMinute = recentResources.filter(r => Date.now() - r.t < 60000);
                    const uniqueResources = new Set(lastMinute.map(r => r.name));
                    const duplicateCount = lastMinute.length - uniqueResources.size;

                    if (duplicateCount > 20) {
                        loopDetections.push({
                            type: 'Resource Loading Loop',
                            count: duplicateCount,
                            details: `${duplicateCount} duplicate resource loads in last minute`,
                            severity: 'medium'
                        });
                    }
                }

                // Check for excessive function calls (instrumentation data)
                for (const [key, count] of functionCallCounts.entries()) {
                    if (count > 100) {
                        loopDetections.push({
                            type: 'Function Call Loop',
                            count: count,
                            details: `${key} called ${count} times - possible infinite loop`,
                            severity: 'high'
                        });
                    } else if (count > 50) {
                        loopDetections.push({
                            type: 'High Function Calls',
                            count: count,
                            details: `${key} called ${count} times - monitor closely`,
                            severity: 'medium'
                        });
                    }
                }

                // Check for XGENIA-specific loops
                try {
                    const projectModel = (window as any).ProjectModel?.instance;
                    if (projectModel && projectModel.components) {
                        // Look for components with excessive node counts
                        const heavyComponents = projectModel.components.filter((comp: any) => {
                            if (!comp.nodeGraph || !comp.nodeGraph.roots) return false;
                            let totalNodes = 0;
                            function countNodes(nodes: any[]) {
                                for (const node of nodes) {
                                    if (node) {
                                        totalNodes++;
                                        if (node.children && Array.isArray(node.children)) {
                                            countNodes(node.children);
                                        }
                                    }
                                }
                            }
                            countNodes(comp.nodeGraph.roots);
                            return totalNodes > 1000; // Suspicious if >1000 nodes
                        });

                        if (heavyComponents.length > 0) {
                            loopDetections.push({
                                type: 'Heavy Component Loop',
                                count: heavyComponents.length,
                                details: `${heavyComponents.length} components with >1000 nodes each`,
                                severity: 'medium'
                            });
                        }
                    }
                } catch (e: any) {
                    // Ignore XGENIA analysis errors
                }

            } catch (e: any) {
                console.warn('[LoopDetection] Error detecting loops:', e);
            }

            return loopDetections;
        }

        // Enhanced XGENIA-specific memory analysis
        function getXgeniaMemoryBreakdown() {
            const breakdown: Array<{ category: string; size: number; details: string[]; items?: Array<{ name: string; size: number; details: string[] }> }> = [];

            try {
                // Get ProjectModel instance
                const projectModel = (window as any).ProjectModel?.instance;
                if (!projectModel) {
                    breakdown.push({
                        category: 'XGENIA Project',
                        size: 0,
                        details: ['Project not loaded']
                    });
                    return breakdown;
                }

                // Analyze components and their memory usage
                let totalComponentSize = 0;
                const componentDetails: Array<{ name: string; size: number; details: string[] }> = [];

                if (projectModel.components && Array.isArray(projectModel.components)) {
                    for (const component of projectModel.components) {
                        if (!component) continue;

                        let componentSize = 0;
                        const componentDetail: Array<string> = [];

                        // Estimate component memory based on nodes
                        if (component.nodeGraph && component.nodeGraph.roots) {
                            const nodeCount = component.nodeGraph.roots.length;
                            componentSize += nodeCount * 1024; // ~1KB per node
                            componentDetail.push(`${nodeCount} root nodes`);

                            // Count all nodes recursively
                            let totalNodes = 0;
                            function countNodes(nodes: any[]) {
                                for (const node of nodes) {
                                    if (node) {
                                        totalNodes++;
                                        if (node.children && Array.isArray(node.children)) {
                                            countNodes(node.children);
                                        }
                                    }
                                }
                            }
                            countNodes(component.nodeGraph.roots);
                            componentSize += totalNodes * 512; // ~512 bytes per child node
                            componentDetail.push(`${totalNodes} total nodes`);
                        }

                        // Estimate based on component name (some components are heavier)
                        if (component.name && component.name.includes('Tool_')) {
                            componentSize += 1024 * 1024; // Tools are typically heavier
                            componentDetail.push('Tool component (heavy)');
                        }

                        if (componentSize > 0) {
                            componentDetails.push({
                                name: component.name || 'Unnamed',
                                size: componentSize,
                                details: componentDetail
                            });
                            totalComponentSize += componentSize;
                        }
                    }
                }

                breakdown.push({
                    category: 'XGENIA Components',
                    size: totalComponentSize,
                    details: [`${componentDetails.length} components`, `~${(totalComponentSize / 1024 / 1024).toFixed(2)} MB total`],
                    items: componentDetails.sort((a, b) => b.size - a.size).slice(0, 10) // Top 10
                });

                // Analyze connections
                let totalConnectionSize = 0;
                if (projectModel.components) {
                    for (const component of projectModel.components) {
                        if (component.nodeGraph && component.nodeGraph.connections) {
                            const connectionCount = component.nodeGraph.connections.length;
                            totalConnectionSize += connectionCount * 256; // ~256 bytes per connection
                        }
                    }
                }

                if (totalConnectionSize > 0) {
                    breakdown.push({
                        category: 'Node Connections',
                        size: totalConnectionSize,
                        details: [`~${(totalConnectionSize / 1024).toFixed(1)} KB total`]
                    });
                }

                // Analyze project metadata and settings
                let metadataSize = 0;
                if (projectModel.settings) {
                    metadataSize += JSON.stringify(projectModel.settings).length;
                }
                if (projectModel.metadata) {
                    metadataSize += JSON.stringify(projectModel.metadata).length;
                }

                if (metadataSize > 0) {
                    breakdown.push({
                        category: 'Project Metadata',
                        size: metadataSize,
                        details: [`~${(metadataSize / 1024).toFixed(1)} KB`]
                    });
                }

                // Sort by size descending
                breakdown.sort((a, b) => b.size - a.size);

            } catch (e: any) {
                console.warn('[XgeniaMemoryBreakdown] Error analyzing XGENIA memory:', e);
                breakdown.push({
                    category: 'XGENIA Analysis Error',
                    size: 0,
                    details: [String(e)]
                });
            }

            return breakdown;
        }

        function start() {
            if (enabled) return;
            enabled = true;
            timer = setInterval(sampleOnce, 2000);
            console.log('[RendererMem] Sampler started');
            try { ipcRenderer.invoke('memprof:start'); } catch { }

            // Start deep instrumentation to catch loops
            instrumentFunctionCalls();

            showPanel();
        }
        async function stop() {
            if (!enabled) return;
            enabled = false;
            clearInterval(timer);
            timer = null;
            console.log('[RendererMem] Sampler stopped');
            try { await ipcRenderer.invoke('memprof:stop'); } catch { }
            try { await ipcRenderer.invoke('memprof:reveal'); } catch { }
            // Print quick summary
            const last = samples[samples.length - 1];
            const first = samples[0];
            const delta = last && first && last.used != null && first.used != null ? (last.used - first.used) : undefined;
            const loads = recentLoads();
            console.log('[RendererMem] usedJSHeap delta:', typeof delta === 'number' ? `${(delta / 1048576).toFixed(2)} MB` : 'n/a');
            console.table(loads);
            renderPanel();
        }

        function toggle() { if (enabled) { stop(); } else { start(); } }

        window.addEventListener('keydown', (e: KeyboardEvent) => {
            // Cmd+Alt+M (Mac) or Ctrl+Alt+M (Win/Linux)
            if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'm' || e.key === 'M')) {
                e.preventDefault();
                toggle();
            }
        }, { capture: true });

        // Expose minimal API for programmatic control
        (window as any).__RendererMem = {
            start,
            stop,
            toggle,
            samples,
            recentLoads,
            hasPerfMemory,
            showPanel,
            hidePanel,
            togglePanel,
            getMemoryBreakdown,
            getXgeniaMemoryBreakdown,
            detectLoops,
            enabled: () => enabled,
            isRunning: () => enabled
        };

        // Add console commands for debugging
        (window as any).__memDebug = {
            breakdown: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');
                const breakdown = api.getMemoryBreakdown();
                console.table(breakdown.map(item => ({
                    Category: item.category,
                    Size: `${(item.size / 1024 / 1024).toFixed(2)} MB`,
                    Details: item.details.join(', ')
                })));
            },
            xgenia: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');
                const breakdown = api.getXgeniaMemoryBreakdown();

                console.group('🔍 XGENIA Memory Breakdown');
                for (const item of breakdown) {
                    console.group(`${item.category} - ${(item.size / 1024 / 1024).toFixed(2)} MB`);
                    console.log('Details:', item.details.join(', '));

                    if (item.items && item.items.length > 0) {
                        console.table(item.items.map(subItem => ({
                            Name: subItem.name,
                            Size: `${(subItem.size / 1024).toFixed(1)} KB`,
                            Details: subItem.details.join(', ')
                        })));
                    }
                    console.groupEnd();
                }
                console.groupEnd();
            },
            samples: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');
                console.table(api.samples.slice(-10).map(s => ({
                    Time: new Date(s.t).toLocaleTimeString(),
                    'JS Heap (MB)': s.used ? (s.used / 1024 / 1024).toFixed(2) : 'n/a',
                    'UA Memory (MB)': s.ua ? (s.ua / 1024 / 1024).toFixed(2) : 'n/a',
                    'DOM Nodes': s.dom || 'n/a'
                })));
            },
            resources: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');
                const loads = api.recentLoads(30000); // Last 30 seconds
                console.table(loads.map(r => ({
                    Type: r.type || 'unknown',
                    Name: r.name,
                    Size: `${(r.bytes / 1024).toFixed(1)} KB`
                })));
            },
            hunt: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');

                console.group('🔍 Memory Hunt - Finding Memory Hogs');

                // Get current memory state
                const current = api.samples[api.samples.length - 1];
                if (current && current.used) {
                    console.log(`Current JS Heap: ${(current.used / 1024 / 1024).toFixed(2)} MB`);
                }

                // Get XGENIA breakdown
                const xgeniaBreakdown = api.getXgeniaMemoryBreakdown();
                const heavyComponents = xgeniaBreakdown.find(item => item.category === 'XGENIA Components');

                if (heavyComponents && heavyComponents.items) {
                    console.log('\n🚨 TOP MEMORY HOGS:');
                    heavyComponents.items.slice(0, 5).forEach((comp, i) => {
                        console.log(`${i + 1}. ${comp.name}: ${(comp.size / 1024).toFixed(1)} KB`);
                        console.log(`   Details: ${comp.details.join(', ')}`);
                    });
                }

                // Check for memory leaks
                if (api.samples.length > 20) {
                    const recent = api.samples.slice(-10);
                    const older = api.samples.slice(-20, -10);
                    const recentAvg = recent.reduce((sum, s) => sum + (s.used || 0), 0) / recent.length;
                    const olderAvg = older.reduce((sum, s) => sum + (s.used || 0), 0) / older.length;
                    const leak = recentAvg - olderAvg;

                    if (leak > 1024 * 1024) {
                        console.warn(`⚠️  MEMORY LEAK DETECTED: +${(leak / 1024 / 1024).toFixed(2)} MB`);
                        console.log('Recent samples show memory growth - check for detached DOM or event listeners');
                    } else {
                        console.log(`✅ Memory stable: ${(leak / 1024 / 1024).toFixed(2)} MB change`);
                    }
                }

                console.groupEnd();
            },
            analyzeHeap: (heapData?: any) => {
                if (!heapData) {
                    console.log('💡 Usage: __memDebug.analyzeHeap(heapProfileData)');
                    console.log('   Paste your heap profile JSON here to analyze it');
                    return;
                }

                console.group('🔍 Heap Profile Analysis');

                try {
                    // Analyze the head structure
                    if (heapData.head) {
                        console.log('📊 Memory Allocation Tree:');
                        analyzeNode(heapData.head, 0);
                    }

                    // Analyze samples for patterns
                    if (heapData.samples && Array.isArray(heapData.samples)) {
                        console.log('\n📈 Sample Analysis:');
                        const sampleStats = analyzeSamples(heapData.samples);
                        console.table(sampleStats);
                    }

                    // Look for suspicious patterns
                    console.log('\n🚨 Suspicious Patterns:');
                    findSuspiciousPatterns(heapData);

                } catch (e: any) {
                    console.error('Error analyzing heap data:', e);
                }

                console.groupEnd();
            },
            findLoops: () => {
                const api = (window as any).__RendererMem;
                if (!api) return console.warn('Memory API not available');

                console.group('🔄 Loop Detection - Finding What\'s Running Wild');

                const loops = api.detectLoops();

                if (loops.length === 0) {
                    console.log('✅ No obvious loops detected');
                } else {
                    console.warn(`🚨 Found ${loops.length} potential loops:`);

                    for (const loop of loops) {
                        const emoji = loop.severity === 'high' ? '🚨' : loop.severity === 'medium' ? '⚠️' : 'ℹ️';
                        console.group(`${emoji} ${loop.type} (${loop.severity.toUpperCase()})`);
                        console.log(`Count: ${loop.count}`);
                        console.log(`Details: ${loop.details}`);
                        console.groupEnd();
                    }
                }

                // Additional loop hunting
                console.log('\n🔍 Additional Loop Hunting:');

                // Check for rapid function calls
                const api2 = (window as any).__RendererMem;
                if (api2 && api2.samples && api2.samples.length > 10) {
                    const recent = api2.samples.slice(-10);
                    const timeSpan = recent[recent.length - 1].t - recent[0].t;
                    const samplesPerSecond = (recent.length / (timeSpan / 1000));

                    if (samplesPerSecond > 2) { // More than 2 samples per second
                        console.warn(`⚠️  High sampling rate: ${samplesPerSecond.toFixed(1)} samples/sec`);
                        console.log('   This suggests rapid memory changes - possible loop');
                    }
                }

                console.groupEnd();
            },
            instrumentation: () => {
                console.group('🔧 Deep Instrumentation Data - What\'s Actually Running');

                // Show function call counts with stack traces
                console.log('📊 Function Call Counts with Stack Traces:');
                if (functionCallCounts.size === 0) {
                    console.log('No function calls tracked yet');
                } else {
                    const sortedCalls = Array.from(functionCallCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10);

                    for (const [key, count] of sortedCalls) {
                        const status = count > 100 ? '🚨 EXCESSIVE' : count > 50 ? '⚠️ HIGH' : '✅ NORMAL';

                        console.group(`${status} ${key}: ${count} calls`);

                        // Show stack traces for this function
                        const stacks = functionCallStacks.get(key);
                        if (stacks && stacks.length > 0) {
                            const sortedStacks = stacks.sort((a, b) => b.count - a.count);

                            for (const stackInfo of sortedStacks.slice(0, 3)) { // Top 3 call sites
                                console.group(`📍 Call site (${stackInfo.count} times):`);
                                console.log(stackInfo.stack);

                                // Try to identify XGENIA components
                                const xgeniaMatch = stackInfo.stack.match(/(\w+Component|\w+Model|\w+View|\w+Panel|\w+Tool)/);
                                if (xgeniaMatch) {
                                    console.warn(`🎯 XGENIA component: ${xgeniaMatch[1]}`);
                                }

                                // Extract file and line for clickable links
                                const fileMatches = stackInfo.stack.match(/\(([^:]+):(\d+):(\d+)\)/g);
                                if (fileMatches) {
                                    console.log('🔗 Files involved:');
                                    fileMatches.slice(0, 3).forEach(match => {
                                        const [, file, line] = match.match(/\(([^:]+):(\d+):(\d+)\)/) || [];
                                        if (file && line) {
                                            console.log(`   ${file}:${line}`);
                                        }
                                    });
                                }

                                console.groupEnd();
                            }
                        } else {
                            console.log('No stack trace data available');
                        }

                        console.groupEnd();
                    }
                }

                // Show memory allocation patterns
                console.log('\n💰 Memory Allocation Patterns:');
                if (memoryAllocationPatterns.length === 0) {
                    console.log('No memory allocation data yet');
                } else {
                    const recent = memoryAllocationPatterns.slice(-20);
                    console.table(recent.map(p => ({
                        Time: new Date(p.time).toLocaleTimeString(),
                        Size: `${(p.size / 1024).toFixed(1)} KB`,
                        Type: p.type,
                        Stack: p.stack.substring(0, 100) + '...'
                    })));
                }

                // Show XGENIA-specific data
                console.log('\n🎯 XGENIA-Specific Monitoring:');
                try {
                    const projectModel = (window as any).ProjectModel?.instance;
                    if (projectModel) {
                        console.log(`Project: ${projectModel.name || 'Unknown'}`);
                        console.log(`Components: ${projectModel.components?.length || 0}`);

                        if (projectModel.components) {
                            const heavyComponents = projectModel.components
                                .filter((comp: any) => {
                                    if (!comp.nodeGraph || !comp.nodeGraph.roots) return false;
                                    let totalNodes = 0;
                                    function countNodes(nodes: any[]) {
                                        for (const node of nodes) {
                                            if (node) {
                                                totalNodes++;
                                                if (node.children && Array.isArray(node.children)) {
                                                    countNodes(node.children);
                                                }
                                            }
                                        }
                                    }
                                    countNodes(comp.nodeGraph.roots);
                                    return totalNodes > 100;
                                })
                                .map((comp: any) => {
                                    let totalNodes = 0;
                                    function countNodes(nodes: any[]) {
                                        for (const node of nodes) {
                                            if (node) {
                                                totalNodes++;
                                                if (node.children && Array.isArray(node.children)) {
                                                    countNodes(node.children);
                                                }
                                            }
                                        }
                                    }
                                    countNodes(comp.nodeGraph.roots);
                                    return { name: comp.name, nodes: totalNodes };
                                })
                                .sort((a, b) => b.nodes - a.nodes)
                                .slice(0, 10);

                            if (heavyComponents.length > 0) {
                                console.log('🚨 Heavy Components:');
                                console.table(heavyComponents);
                            }
                        }
                    } else {
                        console.log('Project not loaded');
                    }
                } catch (e: any) {
                    console.log('Error analyzing project:', e);
                }

                console.groupEnd();
            },
            huntCulprit: (functionKey?: string) => {
                console.group('🎯 Hunt the Culprit - Find Exact Source');

                // If no specific function, show top culprits
                if (!functionKey) {
                    console.log('🚨 Top Function Call Culprits:');
                    const sortedCalls = Array.from(functionCallCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5);

                    sortedCalls.forEach(([key, count], i) => {
                        console.log(`${i + 1}. ${key}: ${count} calls`);
                    });

                    console.log('\n💡 Usage: __memDebug.huntCulprit("DOM.createElement:div")');
                    console.groupEnd();
                    return;
                }

                // Hunt specific function
                const count = functionCallCounts.get(functionKey) || 0;
                const stacks = functionCallStacks.get(functionKey) || [];

                console.log(`🔍 Hunting: ${functionKey} (${count} calls)`);

                if (stacks.length === 0) {
                    console.warn('No stack trace data available for this function');
                    console.groupEnd();
                    return;
                }

                // Find the most frequent call stack
                const topStack = stacks.sort((a, b) => b.count - a.count)[0];

                console.group('🎯 PRIMARY CULPRIT:');
                console.log(`Called ${topStack.count} times from this location:`);
                console.log(topStack.stack);

                // Extract actionable information
                const lines = topStack.stack.split('\n');
                const firstLine = lines[0];

                // Try to extract component/function name
                const componentMatch = firstLine.match(/(\w+Component|\w+Model|\w+View|\w+Panel|\w+Tool|\w+Editor)/);
                if (componentMatch) {
                    console.warn(`🚨 CULPRIT COMPONENT: ${componentMatch[1]}`);
                }

                // Extract file location
                const fileMatch = firstLine.match(/\(([^:]+):(\d+):(\d+)\)/);
                if (fileMatch) {
                    const [, file, line, col] = fileMatch;
                    console.warn(`📍 LOCATION: ${file} at line ${line}, column ${col}`);
                    console.log(`🔗 Navigate to: ${file}:${line}:${col}`);
                }

                // Look for patterns that suggest the type of loop
                if (functionKey.includes('createElement')) {
                    console.log('\n🔧 DOM CREATION LOOP DETECTED:');
                    console.log('Likely causes:');
                    console.log('• Infinite render loop in React/component');
                    console.log('• Missing dependency in useEffect/useMemo');
                    console.log('• State update causing re-render loop');
                    console.log('• DOM manipulation in render function');
                }

                if (functionKey.includes('notifyListeners')) {
                    console.log('\n🔧 MODEL EVENT LOOP DETECTED:');
                    console.log('Likely causes:');
                    console.log('• Model property change triggering itself');
                    console.log('• Circular dependency between models');
                    console.log('• Event listener updating the same property');
                }

                // Show related stacks if any
                if (stacks.length > 1) {
                    console.log(`\n📊 Other call sites (${stacks.length - 1} more):`);
                    stacks.slice(1, 4).forEach((stack, i) => {
                        const firstLine = stack.stack.split('\n')[0];
                        console.log(`${i + 2}. ${firstLine} (${stack.count} calls)`);
                    });
                }

                console.groupEnd();
                console.groupEnd();
            }
        };

        // Add WebGL error suppression to clean up console
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;
            if (gl && 'getError' in gl) {
                const originalGetError = gl.getError;
                let errorCount = 0;
                gl.getError = function () {
                    const error = originalGetError.call(this);
                    if (error !== (gl as any).NO_ERROR && errorCount < 10) {
                        errorCount++;
                        console.warn(`[WebGL] Suppressed error ${error} (${errorCount}/10)`);
                    }
                    return error;
                };
            }
        } catch { }

        ipcRenderer.on('mempanel:toggle', () => togglePanel());
    })();
});
