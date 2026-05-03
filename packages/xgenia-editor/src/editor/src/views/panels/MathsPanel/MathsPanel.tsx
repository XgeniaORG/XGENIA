import React, { useState, useEffect, useCallback } from 'react';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import {
    PrimaryButton,
    PrimaryButtonSize,
    PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { ComponentsPanel } from '../componentspanel';
import { supabase } from '../../../supabaseInit';

import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel } from '@xgenia-models/nodegraphmodel';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { guid } from '@xgenia-utils/utils';


// ─── RGS Connection ─────────────────────────────────────────
// The XRGS endpoint is fixed — users only need to provide their API key
// generated from the RGS dashboard (API Keys page).

const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';
// Supabase anon key — required by verify_jwt on edge functions.
// This is NOT a secret; it's the publishable key used to pass gateway auth.
const XRGS_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdWJ6d3lkcmplbG1qZmtrcmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4ODA3NDcsImV4cCI6MjA4NzQ1Njc0N30.Hewc7WlLZuufC0trhCKKKc4AhLXk7jy7qG3irBQPykY';

/** Build headers for maths-deployer requests */
function rgsHeaders(apiKey: string): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-Operator-Key': apiKey,
        'apikey': XRGS_ANON_KEY,
        'Authorization': `Bearer ${XRGS_ANON_KEY}`,
    };
}

interface RgsSettings {
    apiKey: string;
}

function getRgsSettings(): RgsSettings | null {
    try {
        const settings = localStorage.getItem('xgenia_rgs_settings');
        if (settings) {
            const parsed = JSON.parse(settings);
            if (parsed.apiKey) return parsed;
        }
    } catch { }
    return null;
}

function saveRgsSettings(settings: RgsSettings | string): void {
    const s = typeof settings === 'string' ? { apiKey: settings, rgsUrl: XRGS_URL } : { ...settings, rgsUrl: XRGS_URL };
    localStorage.setItem('xgenia_rgs_settings', JSON.stringify(s));
}

function clearRgsSettings(): void {
    localStorage.removeItem('xgenia_rgs_settings');
}

// Expose for other panels / AI tools
(window as any).__xrgs = {
    getApiKey: () => getRgsSettings()?.apiKey || null,
    getUrl: () => XRGS_URL,

    /**
     * List all maths components in the current project.
     * Returns an array of { name, id } objects.
     */
    getMathsComponents: () => {
        try {
            const { ProjectModel } = require('@xgenia-models/projectmodel');
            const project = ProjectModel.instance;
            if (!project) return [];
            return (project.getComponents?.() || [])
                .filter((c: any) => c.name?.startsWith('/#__maths__/'))
                .map((c: any) => ({ name: c.name, id: c.id }));
        } catch (e: any) {
            console.error('[__xrgs] getMathsComponents error:', e);
            return [];
        }
    },

    /**
     * Generate an RGS evaluate(ctx) script from a maths component.
     * Uses the same CloudFunctionConverter as cloud deploy — same code, different wrapper.
     *
     * @param componentName - Full component name (e.g. '/#__maths__/Zeus Maths')
     *                        If omitted, uses the first maths component found.
     * @returns { script, configData } or { error }
     */
    generateRgsScript: (componentName?: string) => {
        try {
            const { ProjectModel } = require('@xgenia-models/projectmodel');
            const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');

            const project = ProjectModel.instance;
            if (!project) return { error: 'No project loaded' };

            // Find the maths component
            let component;
            if (componentName) {
                component = project.getComponentWithName?.(componentName);
            }
            if (!component) {
                // Auto-discover first maths component
                const allComponents = project.getComponents?.() || [];
                component = allComponents.find((c: any) => c.name?.startsWith('/#__maths__/'));
            }
            if (!component) {
                return { error: 'No maths component found. Create a maths component first.' };
            }

            // Build the project context — same pattern as handleExportFunctions in SupabaseEdgeFunctionsPanel
            const projectContext = {
                name: project.name,
                components: (project.getComponents?.() || []).map((c: any) => ({
                    name: c.name,
                    id: c.id,
                    graph: {
                        roots: c.graph?.roots || [],
                        connections: c.graph?.connections || [],
                        visualRoots: c.graph?.getVisualRootIds || [],
                    },
                    metadata: c.metadata || {},
                })),
            };

            // Use the same converter as cloud deploy
            const converter = new CloudFunctionConverter(
                {
                    name: component.name,
                    id: component.id,
                    graph: {
                        roots: component.graph?.roots || [],
                        connections: component.graph?.connections || [],
                    },
                    metadata: component.metadata || {},
                },
                projectContext
            );

            const result = converter.generateRgsScript();
            return {
                script: result.script,
                configData: result.configData,
                componentName: component.name,
                nodeCount: component.graph?.roots?.length || 0,
            };
        } catch (e: any) {
            console.error('[__xrgs] generateRgsScript error:', e);
            return { error: e.message || 'Failed to generate RGS script' };
        }
    },
};

// ─── Component ──────────────────────────────────────────────

export const MathsPanel_ID = 'maths-panel';

const mathsPanelOptions = {
    showSheetList: false,
    lockCurrentSheetName: '__maths__',
    componentTitle: 'Maths Components'
};

interface PortInfo { name: string; type: string }

function extractPorts(config_data: any, script: string): { inputPorts: PortInfo[], outputPorts: PortInfo[] } {
    const defaultInputs: PortInfo[] = [{ name: 'bet', type: 'number' }]
    const defaultOutputs: PortInfo[] = [{ name: 'win', type: 'number' }]

    // 1. Prefer explicit _portManifest from config_data
    if (config_data?._portManifest) {
        const manifest = config_data._portManifest
        return {
            inputPorts: manifest.inputs?.length > 0 ? manifest.inputs : defaultInputs,
            outputPorts: manifest.outputs?.length > 0 ? manifest.outputs : defaultOutputs,
        }
    }

    // 2. Fallback: parse the compiled script to extract ports
    if (script) {
        const extractedInputs: PortInfo[] = []
        const extractedOutputs: PortInfo[] = []

        // Extract inputs from config.<name> references in function input objects
        const configRefRegex = /config\.(\w+)/g
        const seenInputs = new Set<string>()
        let m
        while ((m = configRefRegex.exec(script)) !== null) {
            const name = m[1]
            if (['bet', 'balance', 'state', 'round', '_portManifest', '_var_'].some(skip => name.startsWith(skip))) continue
            if (seenInputs.has(name)) continue
            seenInputs.add(name)
            const isSignal = /signal|do|trigger/i.test(name)
            extractedInputs.push({ name, type: isSignal ? 'signal' : 'number' })
        }

        // Extract outputs from inner function return statements like `return { result: ... }`
        const returnRegex = /return\s*\{([^}]+)\}/g
        const seenOutputs = new Set<string>()
        while ((m = returnRegex.exec(script)) !== null) {
            const body = m[1]
            const keyRegex = /(\w+)\s*:/g
            let km
            while ((km = keyRegex.exec(body)) !== null) {
                const name = km[1]
                if (['win', 'data', 'state', 'round', 'features'].includes(name)) continue
                if (seenOutputs.has(name)) continue
                seenOutputs.add(name)
                extractedOutputs.push({ name, type: 'number' })
            }
        }

        if (extractedInputs.length > 0 || extractedOutputs.length > 0) {
            return {
                inputPorts: extractedInputs.length > 0 ? extractedInputs : defaultInputs,
                outputPorts: extractedOutputs.length > 0 ? extractedOutputs : defaultOutputs,
            }
        }
    }

    return { inputPorts: defaultInputs, outputPorts: defaultOutputs }
}

export function MathsPanel() {
    const [settings, setSettings] = useState(getRgsSettings());
    const [keyInput, setKeyInput] = useState('');
    const [showInput, setShowInput] = useState(false);
    const [validating, setValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [games, setGames] = useState<any[] | null>(null);
    const [selectedGame, setSelectedGame] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [generatingKey, setGeneratingKey] = useState(false);
    const [versions, setVersions] = useState<any[] | null>(null);
    const [versionsLoading, setVersionsLoading] = useState(false);
    const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
    const [versionCode, setVersionCode] = useState<Record<string, string>>({});
    const [actionStatus, setActionStatus] = useState<{ id: string; type: 'success' | 'error' | 'loading'; msg: string } | null>(null);

    // Simulation config modal state
    const [showTestConfigModal, setShowTestConfigModal] = useState(false);
    const [activeSimVersionId, setActiveSimVersionId] = useState<string | null>(null);
    const [simCount, setSimCount] = useState(1000);
    const [simBetPort, setSimBetPort] = useState('bet');
    const [simWinPort, setSimWinPort] = useState('win');
    const [simAvailablePorts, setSimAvailablePorts] = useState<{ inputPorts: PortInfo[], outputPorts: PortInfo[] } | null>(null);
    const [pipelineStep, setPipelineStep] = useState<string | null>(null);

    const connected = !!settings;

    // Load games when connected
    useEffect(() => {
        if (!settings?.apiKey) return;
        setGames(null); // reset to loading state
        fetch(`${XRGS_URL}/maths-deployer`, {
            method: 'POST',
            headers: rgsHeaders(settings.apiKey),
            body: JSON.stringify({ action: 'list-games' }),
        })
            .then(async r => {
                const data = await r.json();
                if (!r.ok || data.error) {
                    console.error('[MathsPanel] list-games failed:', data.error || r.statusText);
                    setGames([]);
                    return;
                }
                console.log('[MathsPanel] Loaded', data.games?.length || 0, 'games');
                setGames(data.games || []);
            })
            .catch(err => {
                console.error('[MathsPanel] list-games network error:', err);
                setGames([]);
            });
    }, [settings]);

    // Fetch versions when game selected
    const fetchVersions = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) { setVersions(null); return; }
        setVersionsLoading(true);
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'versions', game_id: selectedGame }),
            });
            const data = await res.json();
            setVersions(data.versions || []);
        } catch { setVersions([]); }
        setVersionsLoading(false);
    }, [settings, selectedGame]);

    useEffect(() => { fetchVersions(); }, [selectedGame, fetchVersions]);

    // Refresh versions after upload
    useEffect(() => {
        if (uploadStatus?.type === 'success') fetchVersions();
    }, [uploadStatus, fetchVersions]);

    // Fetch code for expanded version
    useEffect(() => {
        if (!expandedVersion || versionCode[expandedVersion] || !settings?.apiKey) return;
        fetch(`${XRGS_URL}/maths-deployer`, {
            method: 'POST',
            headers: rgsHeaders(settings.apiKey),
            body: JSON.stringify({ action: 'download', maths_config_id: expandedVersion }),
        }).then(async (res) => {
            const ct = res.headers.get('Content-Type') || '';
            const text = await res.text();
            let formatted = text;
            if (!ct.includes('javascript')) {
                try { formatted = JSON.stringify(JSON.parse(text), null, 2); } catch { /* use raw */ }
            }
            setVersionCode(prev => ({ ...prev, [expandedVersion]: formatted }));
        }).catch(() => {
            setVersionCode(prev => ({ ...prev, [expandedVersion]: '// Failed to load code' }));
        });
    }, [expandedVersion, versionCode, settings]);

    const handleImportFromRgs = useCallback(async (configId: string, version: number) => {
        if (!settings?.apiKey) return;
        setActionStatus({ id: configId, type: 'loading', msg: 'Importing remote component...' });
        try {
            // Find the game name for the component label
            const game = games?.find((g: any) => g.id === selectedGame);
            const gameName = game?.name || 'RGS';
            const componentName = `/#__maths__/${gameName} RGS v${version} (Remote)`;

            // Check if component already exists
            if (ProjectModel.instance.getComponentWithName(componentName)) {
                setActionStatus({ id: configId, type: 'error', msg: `Component "${gameName} RGS v${version} (Remote)" already exists` });
                return;
            }

            // Fetch config data to extract ports and check validity
            const configRes = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'get-config', maths_config_id: configId }),
            });
            const configData = await configRes.json();
            if (configData.error) {
                setActionStatus({ id: configId, type: 'error', msg: `RGS fetch config failed: ${configData.error}` });
                return;
            }

            const { inputPorts, outputPorts } = extractPorts(configData.config_data, configData.script);

            // Create dynamicports array
            const dynamicports = [
                ...inputPorts.map(p => ({
                    name: `in-${p.name}`,
                    plug: 'input' as const,
                    type: p.type === 'signal' ? 'signal' : 'number',
                    displayName: p.name
                })),
                ...outputPorts.map(p => ({
                    name: `out-${p.name}`,
                    plug: 'output' as const,
                    type: 'number',
                    displayName: p.name
                }))
            ];

            // Build the proxy script that calls XRGS evaluate endpoint remotely
            const proxyScript = `// ☁ RGS Remote Maths Proxy — ${gameName} v${version}
// This component executes math REMOTELY on the XRGS platform.
// The source code runs server-side — only results are returned.
// Do not edit this script — changes won't affect the deployed math.

const XRGS_URL = '${XRGS_URL}';
const MATHS_CONFIG_ID = '${configId}';
const XRGS_ANON_KEY = '${XRGS_ANON_KEY}';
const GAME_NAME = '${gameName.replace(/'/g, "\\'")}';
const VERSION = ${version};

// Internal state persisted between rounds
var _roundState = {};
var _roundCount = 0;

async function evaluateRemote(collectedInputs) {
  var settings = null;
  try { settings = JSON.parse(localStorage.getItem('xgenia_rgs_settings') || '{}'); } catch(e) {}
  var apiKey = settings && settings.apiKey;
  if (!apiKey) throw new Error('Not connected to XRGS — open Maths RGS panel and connect first');

  _roundCount++;

  var bet = collectedInputs.bet || 100;
  var configOverrides = {};
  for (var k in collectedInputs) {
    if (k !== 'bet') {
      configOverrides[k] = collectedInputs[k];
    }
  }

  var res = await fetch(XRGS_URL + '/maths-deployer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Operator-Key': apiKey,
      'apikey': XRGS_ANON_KEY,
      'Authorization': 'Bearer ' + XRGS_ANON_KEY,
    },
    body: JSON.stringify({
      action: 'evaluate',
      maths_config_id: MATHS_CONFIG_ID,
      ctx: {
        bet: bet,
        config: configOverrides,
        state: _roundState,
        round: _roundCount,
      }
    }),
  });

  var data = await res.json();
  if (data.error) throw new Error('RGS Error: ' + data.error);

  // Persist state for next round (bonus continuations etc.)
  _roundState = (data.result && data.result.state) || {};

  var resultData = data.result && data.result.data ? data.result.data : data.result;
  return resultData || data;
}

// Entry point — called by the editor runtime
var collectedInputs = {};
${inputPorts.map(p => `collectedInputs['${p.name}'] = typeof Inputs['${p.name}'] !== 'undefined' ? Inputs['${p.name}'] : Inputs['in-${p.name}'];`).join('\n')}
return evaluateRemote(collectedInputs);`;

            // Create the proxy component with a JavaScriptFunction node
            const jsFnNodeId = guid();
            const nodeGraph = NodeGraphModel.fromJSON({
                roots: [
                    {
                        id: jsFnNodeId,
                        type: 'JavaScriptFunction',
                        typename: 'JavaScriptFunction',
                        label: `☁ RGS v${version} (${gameName})`,
                        x: 200,
                        y: 200,
                        parameters: {
                            functionScript: proxyScript,
                            _rgsRemote: true,
                            _rgsConfigId: configId,
                            _rgsGameId: selectedGame,
                            _rgsVersion: version,
                            _rgsGameName: gameName,
                        },
                        dynamicports: dynamicports,
                    },
                ],
                connections: [],
            });

            const component = new ComponentModel({
                name: componentName,
                id: guid(),
                graph: nodeGraph,
            });

            ProjectModel.instance.addComponent(component, {
                label: `Import Remote RGS Maths v${version}`,
            });

            setActionStatus({ id: configId, type: 'success', msg: `☁ Imported v${version} as remote component` });
        } catch (e: any) {
            setActionStatus({ id: configId, type: 'error', msg: e.message });
        }
    }, [settings, games, selectedGame]);

    const handleConnect = useCallback(async () => {
        const key = keyInput.trim();
        if (!key) { setError('Enter your API key'); return; }
        setValidating(true);
        setError(null);

        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(key),
                body: JSON.stringify({ action: 'list-games' }),
            });
            const data = await res.json();
            if (data.error) {
                setError(data.error);
                setValidating(false);
                return;
            }
            // Key is valid
            saveRgsSettings(key);
            setSettings({ apiKey: key });
            setGames(data.games || []);
            setKeyInput('');
            setShowInput(false);
        } catch {
            setError('Failed to connect');
        }
        setValidating(false);
    }, [keyInput]);

    const handleDisconnect = useCallback(() => {
        clearRgsSettings();
        setSettings(null);
        setGames(null);
        setSelectedGame(null);
    }, []);

    const dispatchCommand = useCallback((command: string) => {
        const { SidebarModel } = require('@xgenia-models/sidebar');
        SidebarModel.instance.switch('chat-panel');
        window.dispatchEvent(new CustomEvent('xgenia-maths-command', {
            detail: { command, game_id: selectedGame }
        }));
    }, [selectedGame]);

    const handleUploadMathsComponent = useCallback(async (comp: any) => {
        if (!settings?.apiKey) {
            setUploadStatus({ type: 'error', message: 'Not connected to XRGS.' });
            return;
        }
        if (!selectedGame) {
            setUploadStatus({ type: 'error', message: 'No game selected.' });
            return;
        }

        setUploading(true);
        setUploadStatus(null);
        setPipelineStep('Exporting component...');
        try {
            const game = games?.find((g: any) => g.id === selectedGame);
            const xrgs = (window as any).__xrgs;
            if (!xrgs?.generateRgsScript) {
                setUploadStatus({ type: 'error', message: 'Maths bridge not ready.' });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            const result = xrgs.generateRgsScript(comp.name);
            if (result.error) {
                setUploadStatus({ type: 'error', message: result.error });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            if (!result.script || result.script.length < 50) {
                setUploadStatus({ type: 'error', message: 'Generated script is too short.' });
                setUploading(false); setPipelineStep(null); return;
            }

            try {
                new Function('ctx', result.script);
            } catch (compileErr: any) {
                setUploadStatus({ type: 'error', message: `Client-side compilation failed: ${compileErr.message}` });
                setUploading(false); setPipelineStep(null); return;
            }

            setPipelineStep('Uploading maths...');
            const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({
                    action: 'upload',
                    game_id: selectedGame,
                    maths_mode: 'script',
                    script: result.script,
                    config_data: result.configData,
                    declared_rtp: game?.default_rtp || '96.00',
                }),
            });
            const uploadData = await r.json();
            if (uploadData.error) {
                setUploadStatus({ type: 'error', message: `Upload failed: ${uploadData.error}` });
            } else {
                setUploadStatus({ type: 'success', message: `v${uploadData.version} uploaded as draft!` });
                fetchVersions();
            }
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e.message || 'Upload failed' });
        }
        setUploading(false);
        setPipelineStep(null);
    }, [settings, selectedGame, games, fetchVersions]);

    useEffect(() => {
        const handler = (e: any) => handleUploadMathsComponent(e.detail.component);
        document.addEventListener('upload-maths-component', handler);
        return () => document.removeEventListener('upload-maths-component', handler);
    }, [handleUploadMathsComponent]);

    const handleSimulationRun = async () => {
        if (!settings?.apiKey || !activeSimVersionId) return;
        setActionStatus({ id: activeSimVersionId, type: 'loading', msg: `Running simulation (${simCount} spins)...` });
        setShowTestConfigModal(false);

        try {
            const res = await fetch(`${XRGS_URL}/batch-spin`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({
                    maths_config_id: activeSimVersionId,
                    spins: simCount,
                    bet_input_port: simBetPort,
                    win_output_port: simWinPort,
                }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            const rtpStr = data.rtp ? `${data.rtp.toFixed(2)}%` : '';
            const hitStr = data.hit_rate != null ? `${(data.hit_rate * 100).toFixed(1)}%` : '';
            setActionStatus({ id: activeSimVersionId, type: 'success', msg: `Simulated: RTP ${rtpStr} · Hit ${hitStr}` });
        } catch (e: any) {
            setActionStatus({ id: activeSimVersionId, type: 'error', msg: `Simulation failed: ${e.message}` });
        }
    };

    const handleVersionAction = async (id: string, action: string) => {
        if (!settings?.apiKey) return;
        setActionStatus({ id, type: 'loading', msg: `${action}ing...` });

        try {
            // For approve, we must silently run the stress-test Gauntlet first to compile the bundle
            if (action === 'approve') {
                setActionStatus({ id, type: 'loading', msg: 'Running compliance checks...' });
                const stRes = await fetch(`${XRGS_URL}/maths-deployer`, {
                    method: 'POST',
                    headers: rgsHeaders(settings.apiKey),
                    body: JSON.stringify({ action: 'stress-test', maths_config_id: id }),
                });
                const stData = await stRes.json();
                if (stData.error) throw new Error(stData.error);
                setActionStatus({ id, type: 'loading', msg: 'Approving...' });
            }

            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action, maths_config_id: id }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            setActionStatus({ id, type: 'success', msg: data.message || `Action ${action} complete` });
            fetchVersions();
        } catch (e: any) {
            setActionStatus({ id, type: 'error', msg: e.message || 'Action failed' });
        }
    };


    return (
        <BasePanel title="Maths RGS" isFill>
            <Container direction={ContainerDirection.Vertical} isFill>
                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                <Box hasXSpacing hasYSpacing>
                    <VStack>
                        {/* Connection Status */}
                        <Box hasBottomSpacing>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                backgroundColor: connected ? 'rgba(103, 222, 146, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${connected ? 'rgba(103, 222, 146, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                            }}>
                                <div style={{
                                    width: '8px',
                                    height: '8px',
                                    borderRadius: '50%',
                                    backgroundColor: connected ? '#67DE92' : '#666',
                                }} />
                                <span style={{ fontSize: '13px', color: '#e0e0e0' }}>
                                    {connected ? 'Connected to XRGS' : 'Not connected'}
                                </span>
                            </div>
                        </Box>

                        {/* Connect / Disconnect */}
                        {connected ? (
                            <>
                                {/* Game selector dropdown — always visible when connected */}
                                <Box hasBottomSpacing>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <label style={{ fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                                            Target Game
                                        </label>
                                        <span
                                            onClick={async () => {
                                                if (!settings?.apiKey) return;
                                                setGames(null); // show loading
                                                try {
                                                    const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                                                        method: 'POST',
                                                        headers: rgsHeaders(settings.apiKey),
                                                        body: JSON.stringify({ action: 'list-games' }),
                                                    });
                                                    const data = await r.json();
                                                    if (!r.ok || data.error) {
                                                        console.error('[MathsPanel] refresh list-games failed:', data.error || r.statusText);
                                                        setGames([]);
                                                        return;
                                                    }
                                                    console.log('[MathsPanel] Refreshed', data.games?.length || 0, 'games');
                                                    setGames(data.games || []);
                                                } catch (err) {
                                                    console.error('[MathsPanel] refresh list-games error:', err);
                                                    setGames([]);
                                                }
                                            }}
                                            style={{ fontSize: '10px', color: '#666', cursor: 'pointer', userSelect: 'none' as const }}
                                            title="Refresh games list"
                                        >
                                            ↻ Refresh
                                        </span>
                                    </div>
                                    {games === null ? (
                                        <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>Loading games…</div>
                                    ) : games.length === 0 ? (
                                        <div style={{
                                            fontSize: '11px', color: '#a0a0b0', padding: '8px 12px',
                                            backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                        }}>
                                            No games found. Create a game in the XRGS Dashboard first.
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedGame || ''}
                                            onChange={(e) => setSelectedGame(e.target.value || null)}
                                            style={{
                                                width: '100%',
                                                padding: '8px 12px',
                                                backgroundColor: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)',
                                                borderRadius: '6px',
                                                color: '#fff',
                                                fontSize: '13px',
                                                outline: 'none',
                                                boxSizing: 'border-box' as const,
                                                appearance: 'none' as const,
                                                cursor: 'pointer',
                                            }}
                                        >
                                            <option value="" style={{ background: '#1a1a2e' }}>Select a game…</option>
                                            {games.map((g: any) => (
                                                <option key={g.id} value={g.id} style={{ background: '#1a1a2e' }}>
                                                    {g.name}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </Box>

                                {/* Selected game info */}
                                {selectedGame && games && (() => {
                                    const g = games.find((x: any) => x.id === selectedGame);
                                    if (!g) return null;
                                    return (
                                        <Box hasBottomSpacing>
                                            <div style={{
                                                padding: '8px 12px',
                                                fontSize: '11px',
                                                color: '#a0a0b0',
                                                backgroundColor: 'rgba(255,255,255,0.03)',
                                                borderRadius: '4px',
                                                display: 'flex',
                                                flexWrap: 'wrap' as const,
                                                gap: '8px',
                                            }}>
                                                <span>{g.reel_rows}×{g.reel_cols}</span>
                                                <span>RTP {(parseFloat(g.default_rtp) * 100).toFixed(1)}%</span>
                                                <span>{g.volatility}</span>
                                            </div>
                                        </Box>
                                    );
                                })()}

                                <Box hasBottomSpacing>
                                    <PrimaryButton
                                        icon={IconName.Close}
                                        label="Disconnect"
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.MutedOnLowBg}
                                        onClick={handleDisconnect}
                                        isGrowing
                                    />
                                </Box>
                            </>
                        ) : (
                            <>
                                {showInput ? (
                                    <>
                                        <Box hasBottomSpacing>
                                            <label style={{ display: 'block', fontSize: '11px', color: '#a0a0b0', marginBottom: '4px' }}>
                                                API Key (from RGS Dashboard → API Keys)
                                            </label>
                                            <input
                                                type="password"
                                                placeholder="xrgs_..."
                                                value={keyInput}
                                                onChange={(e) => { setKeyInput(e.target.value); setError(null); }}
                                                onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                                                style={{
                                                    width: '100%',
                                                    padding: '8px 12px',
                                                    backgroundColor: 'rgba(255,255,255,0.06)',
                                                    border: `1px solid ${error ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.12)'}`,
                                                    borderRadius: '6px',
                                                    color: '#fff',
                                                    fontSize: '13px',
                                                    outline: 'none',
                                                    boxSizing: 'border-box' as const,
                                                    fontFamily: 'monospace',
                                                }}
                                                autoFocus
                                            />
                                            {error && (
                                                <div style={{ fontSize: '11px', color: '#EF4444', marginTop: '4px' }}>
                                                    {error}
                                                </div>
                                            )}
                                        </Box>
                                        <Box hasBottomSpacing>
                                            <PrimaryButton
                                                icon={IconName.Play}
                                                label={validating ? 'Validating...' : 'Connect'}
                                                size={PrimaryButtonSize.Small}
                                                variant={PrimaryButtonVariant.MutedOnLowBg}
                                                onClick={handleConnect}
                                                isGrowing
                                                isDisabled={validating}
                                            />
                                        </Box>
                                        <div style={{ textAlign: 'center', fontSize: '11px', color: '#666', margin: '4px 0' }}>or</div>
                                        <Box hasBottomSpacing>
                                            <PrimaryButton
                                                icon={IconName.Plus}
                                                label={generatingKey ? 'Generating...' : 'Generate New Key'}
                                                size={PrimaryButtonSize.Small}
                                                variant={PrimaryButtonVariant.MutedOnLowBg}
                                                onClick={async () => {
                                                    setGeneratingKey(true);
                                                    setError(null);
                                                    try {
                                                        // Get user email from editor's Supabase session
                                                        const { data: { user } } = await supabase.auth.getUser();
                                                        const email = user?.email;
                                                        if (!email) {
                                                            setError('Not logged in — sign in to XGENIA first');
                                                            setGeneratingKey(false);
                                                            return;
                                                        }
                                                        const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({ action: 'generate-key', email }),
                                                        });
                                                        const data = await res.json();
                                                        if (!res.ok || !data.api_key) {
                                                            setError(data.error || 'Failed to generate key');
                                                            setGeneratingKey(false);
                                                            return;
                                                        }
                                                        // Auto-fill and connect
                                                        setKeyInput(data.api_key);
                                                        const s: RgsSettings = { apiKey: data.api_key };
                                                        saveRgsSettings(s);
                                                        setSettings(s);
                                                        setShowInput(false);
                                                    } catch (e: any) {
                                                        setError(e.message || 'Network error');
                                                    } finally {
                                                        setGeneratingKey(false);
                                                    }
                                                }}
                                                isGrowing
                                                isDisabled={generatingKey}
                                            />
                                        </Box>
                                    </>
                                ) : (
                                    <Box hasBottomSpacing>
                                        <PrimaryButton
                                            icon={IconName.CloudData}
                                            label="Connect to XRGS"
                                            size={PrimaryButtonSize.Small}
                                            variant={PrimaryButtonVariant.MutedOnLowBg}
                                            onClick={() => setShowInput(true)}
                                            isGrowing
                                        />
                                    </Box>
                                )}
                            </>
                        )}

                        {uploading && (
                            <Box hasBottomSpacing>
                                <div style={{ fontSize: '11px', color: '#67DE92', padding: '8px 12px', backgroundColor: 'rgba(103, 222, 146, 0.1)', borderRadius: '6px' }}>
                                    {pipelineStep || 'Processing...'}
                                </div>
                            </Box>
                        )}
                        {/* Upload status feedback */}
                        {uploadStatus && (
                            <Box hasBottomSpacing>
                                <div style={{
                                    padding: '6px 10px',
                                    borderRadius: '4px',
                                    fontSize: '11px',
                                    backgroundColor: uploadStatus.type === 'success'
                                        ? 'rgba(103, 222, 146, 0.1)'
                                        : 'rgba(239, 68, 68, 0.1)',
                                    border: `1px solid ${uploadStatus.type === 'success'
                                        ? 'rgba(103, 222, 146, 0.3)'
                                        : 'rgba(239, 68, 68, 0.3)'}`,
                                    color: uploadStatus.type === 'success' ? '#67DE92' : '#EF4444',
                                }}>
                                    {uploadStatus.type === 'success' ? '✓' : '✗'} {uploadStatus.message}
                                </div>
                            </Box>
                        )}

                        {/* Server Versions */}
                        {connected && selectedGame && (
                            <Box hasBottomSpacing>
                                <div style={{
                                    borderTop: '1px solid rgba(255,255,255,0.08)',
                                    marginTop: '4px',
                                    paddingTop: '12px',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#a0a0b0' }}>
                                            Server Versions
                                        </span>
                                        {versionsLoading && (
                                            <span style={{ fontSize: '10px', color: '#666' }}>Loading&#8230;</span>
                                        )}
                                    </div>

                                    {versions && versions.length === 0 && !versionsLoading && (
                                        <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>
                                            No maths uploaded yet.
                                        </div>
                                    )}

                                    {versions && versions.map((v: any) => {
                                        const isExpanded = expandedVersion === v.id;
                                        const statusColors: Record<string, string> = {
                                            live: '#67DE92', approved: '#67DE92', testing: '#FFC107',
                                            draft: '#a0a0b0', failed: '#EF4444', archived: '#666',
                                        };
                                        const statusColor = statusColors[v.status] || '#a0a0b0';

                                        // Extract simulation data from stress_results
                                        const sr = v.stress_results;
                                        const rtpComp = sr?.tests?.rtp_compliance;
                                        const measuredRtp = rtpComp?.measured_rtp;
                                        const hitRate = rtpComp?.hit_rate;
                                        const maxWin = rtpComp?.max_win || rtpComp?.max_multiplier;
                                        const hasSimData = measuredRtp != null;
                                        const declaredRtpNorm = v.declared_rtp ? (parseFloat(v.declared_rtp) > 1 ? parseFloat(v.declared_rtp) : parseFloat(v.declared_rtp) * 100) : null;
                                        const rtpDisplay = hasSimData ? `${measuredRtp.toFixed(2)}%` : (declaredRtpNorm != null ? `${declaredRtpNorm.toFixed(2)}%` : null);

                                        return (
                                            <div key={v.id} style={{ marginBottom: '4px' }}>
                                                <div
                                                    onClick={() => setExpandedVersion(isExpanded ? null : v.id)}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '6px',
                                                        padding: '6px 8px', borderRadius: '4px', cursor: 'pointer',
                                                        backgroundColor: isExpanded ? 'rgba(255,255,255,0.06)' : 'transparent',
                                                        transition: 'background-color 0.15s',
                                                    }}
                                                    onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                                                    onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                                                >
                                                    <span style={{
                                                        fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                                                        color: '#e0e0e0', minWidth: '24px',
                                                    }}>v{v.version}</span>

                                                    <span style={{
                                                        fontSize: '10px', padding: '1px 6px', borderRadius: '3px',
                                                        backgroundColor: `${statusColor}20`, color: statusColor,
                                                        fontWeight: 600, textTransform: 'uppercase' as const,
                                                    }}>{v.status}</span>

                                                    {rtpDisplay && (
                                                        <span style={{
                                                            fontSize: '10px', color: hasSimData ? '#67DE92' : '#a0a0b0',
                                                            fontFamily: 'monospace',
                                                        }}>
                                                            RTP {rtpDisplay}
                                                        </span>
                                                    )}

                                                    {hasSimData && hitRate != null && (
                                                        <span style={{
                                                            fontSize: '10px', color: '#60A5FA',
                                                            fontFamily: 'monospace',
                                                        }}>
                                                            Hit {(hitRate * 100).toFixed(1)}%
                                                        </span>
                                                    )}

                                                    {hasSimData && maxWin != null && (
                                                        <span style={{
                                                            fontSize: '10px', color: '#FFC107',
                                                            fontFamily: 'monospace',
                                                        }}>
                                                            Max {maxWin}×
                                                        </span>
                                                    )}

                                                    <span style={{ flex: 1 }} />
                                                    <span style={{ fontSize: '10px', color: '#555' }}>
                                                        {new Date(v.created_at).toLocaleDateString()}
                                                    </span>
                                                    <span style={{ fontSize: '10px', color: '#555' }}>{isExpanded ? '\u25BE' : '\u25B8'}</span>
                                                </div>

                                                {isExpanded && (
                                                    <div style={{
                                                        padding: '8px', marginLeft: '4px',
                                                        borderLeft: `2px solid ${statusColor}30`,
                                                    }}>
                                                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                                            {(v.status === 'draft' || v.status === 'failed') && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleVersionAction(v.id, 'activate'); }}
                                                                    disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                    style={{
                                                                        fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                        border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)',
                                                                        color: '#e0e0e0', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    {v.status === 'failed' ? 'Re-activate' : 'Activate for Testing'}
                                                                </button>
                                                            )}
                                                            {v.status === 'testing' && (
                                                                <>
                                                                    <button
                                                                        onClick={async (e) => { 
                                                                            e.stopPropagation(); 
                                                                            if (!settings?.apiKey) return;
                                                                            setActionStatus({ id: v.id, type: 'loading', msg: 'Fetching configuration...' });
                                                                            try {
                                                                                const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                                                                                    method: 'POST',
                                                                                    headers: rgsHeaders(settings.apiKey),
                                                                                    body: JSON.stringify({ action: 'get-config', maths_config_id: v.id }),
                                                                                });
                                                                                const configData = await res.json();
                                                                                if (configData.error) throw new Error(configData.error);
                                                                                const { inputPorts, outputPorts } = extractPorts(configData.config_data, configData.script);
                                                                                setSimAvailablePorts({ inputPorts, outputPorts });
                                                                                if (inputPorts.length > 0) setSimBetPort(inputPorts[0].name);
                                                                                if (outputPorts.length > 0) setSimWinPort(outputPorts[0].name);
                                                                                setActiveSimVersionId(v.id);
                                                                                setShowTestConfigModal(true);
                                                                                setActionStatus(null);
                                                                            } catch (err: any) {
                                                                                setActionStatus({ id: v.id, type: 'error', msg: `Failed to load config: ${err.message}` });
                                                                            }
                                                                        }}
                                                                        disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                        style={{
                                                                            fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                            border: '1px solid rgba(96,165,250,0.3)', backgroundColor: 'rgba(96,165,250,0.1)',
                                                                            color: '#60A5FA', cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        Simulation Test
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleVersionAction(v.id, 'approve'); }}
                                                                        disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                        style={{
                                                                            fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                            border: '1px solid rgba(255,193,7,0.3)', backgroundColor: 'rgba(255,193,7,0.1)',
                                                                            color: '#FFC107', cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        Approve for Production
                                                                    </button>
                                                                </>
                                                            )}
                                                            {v.status === 'approved' && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleVersionAction(v.id, 'deploy'); }}
                                                                    disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                    style={{
                                                                        fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                        border: '1px solid rgba(103,222,146,0.3)', backgroundColor: 'rgba(103,222,146,0.1)',
                                                                        color: '#67DE92', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    Launch Live
                                                                </button>
                                                            )}
                                                            {v.status === 'live' && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleImportFromRgs(v.id, v.version); }}
                                                                    disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                    style={{
                                                                        fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                        border: '1px solid rgba(160,160,176,0.3)', backgroundColor: 'rgba(160,160,176,0.1)',
                                                                        color: '#a0a0b0', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    ☁ Import Remote
                                                                </button>
                                                            )}
                                                        </div>

                                                        {actionStatus?.id === v.id && (
                                                            <div style={{
                                                                fontSize: '10px', padding: '4px 8px', borderRadius: '3px', marginBottom: '6px',
                                                                backgroundColor: actionStatus.type === 'success' ? 'rgba(103,222,146,0.1)'
                                                                    : actionStatus.type === 'error' ? 'rgba(239,68,68,0.1)'
                                                                    : 'rgba(255,255,255,0.05)',
                                                                color: actionStatus.type === 'success' ? '#67DE92'
                                                                    : actionStatus.type === 'error' ? '#EF4444' : '#a0a0b0',
                                                            }}>
                                                                {actionStatus.msg}
                                                            </div>
                                                        )}

                                                        <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>
                                                            {v.maths_mode === 'config' ? 'Config Mode' : 'Script Mode'}
                                                        </div>
                                                        <pre style={{
                                                            fontSize: '10px', fontFamily: 'monospace', color: '#c0c0c0',
                                                            backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: '4px',
                                                            padding: '8px', maxHeight: '200px', overflow: 'auto',
                                                            whiteSpace: 'pre-wrap', wordBreak: 'break-all' as const,
                                                            margin: 0,
                                                        }}>
                                                            {versionCode[v.id] || 'Loading code\u2026'}
                                                        </pre>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </Box>
                        )}
                    </VStack>
                </Box>
                </div>

                {/* Maths Components — locked to __maths__ sheet */}
                <div style={{ flex: '1', overflow: 'hidden' }}>
                    <ComponentsPanel options={mathsPanelOptions} />
                </div>
            </Container>

            {/* ═══ Test Configuration Modal ═══ */}
            {showTestConfigModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => setShowTestConfigModal(false)}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '420px',
                            backgroundColor: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            padding: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{
                                fontSize: '15px', fontWeight: 700, color: '#fff',
                                marginBottom: '4px',
                            }}>Test Configuration</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Configure the simulation parameters for batch-spin execution.
                            </div>
                        </div>

                        {/* Bet/Win Ports */}
                        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Bet Input Port</label>
                                {simAvailablePorts ? (
                                    <select
                                        value={simBetPort}
                                        onChange={(e) => setSimBetPort(e.target.value)}
                                        style={{
                                            width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                            fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box'
                                        }}
                                    >
                                        {simAvailablePorts.inputPorts.map(p => (
                                            <option key={p.name} value={p.name} style={{ color: '#000' }}>{p.name} ({p.type})</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={simBetPort}
                                        onChange={(e) => setSimBetPort(e.target.value)}
                                        style={{
                                            width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                            fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box'
                                        }}
                                    />
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>Win Output Port</label>
                                {simAvailablePorts ? (
                                    <select
                                        value={simWinPort}
                                        onChange={(e) => setSimWinPort(e.target.value)}
                                        style={{
                                            width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                            fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box'
                                        }}
                                    >
                                        {simAvailablePorts.outputPorts.map(p => (
                                            <option key={p.name} value={p.name} style={{ color: '#000' }}>{p.name} ({p.type})</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={simWinPort}
                                        onChange={(e) => setSimWinPort(e.target.value)}
                                        style={{
                                            width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                            fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box'
                                        }}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Simulation Count */}
                        <div style={{ marginBottom: '24px' }}>
                            <label style={{
                                display: 'block', fontSize: '11px', color: '#a0a0b0',
                                textTransform: 'uppercase' as const, letterSpacing: '0.5px',
                                marginBottom: '6px',
                            }}>Simulation Count</label>
                            <input
                                type="number"
                                min={1000}
                                max={1000000}
                                value={simCount}
                                onChange={(e) => setSimCount(Math.max(1000, Math.min(1000000, Number(e.target.value) || 1000)))}
                                style={{
                                    width: '100%',
                                    padding: '10px 12px',
                                    backgroundColor: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    color: '#fff',
                                    fontSize: '14px',
                                    fontFamily: 'monospace',
                                    outline: 'none',
                                    boxSizing: 'border-box' as const,
                                }}
                            />
                            <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                1,000 – 1,000,000 spins
                            </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setShowTestConfigModal(false)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    backgroundColor: 'transparent',
                                    color: '#a0a0b0',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={handleSimulationRun}
                                disabled={simCount < 1000}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    backgroundColor: simCount >= 1000 ? '#67DE92' : '#444',
                                    color: simCount >= 1000 ? '#1a1a2e' : '#888',
                                    fontSize: '13px',
                                    fontWeight: 700,
                                    cursor: simCount >= 1000 ? 'pointer' : 'not-allowed',
                                }}
                            >Run Simulation</button>
                        </div>
                    </div>
                </div>
            )}
        </BasePanel>
    );
}