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

    // Upload, Test & Deploy modal state
    const [showTestConfigModal, setShowTestConfigModal] = useState(false);
    const [simCount, setSimCount] = useState(10000);
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

    // Quick actions on versions
    const handleVersionAction = useCallback(async (configId: string, action: 'deploy' | 'activate') => {
        if (!settings?.apiKey) return;
        const labels = { deploy: 'Deploying...', activate: 'Activating...' };
        setActionStatus({ id: configId, type: 'loading', msg: labels[action] });
        try {
            const body: Record<string, any> = action === 'deploy'
                ? { action: 'deploy', maths_config_id: configId }
                : { action: 'activate', maths_config_id: configId };
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (data.error) {
                setActionStatus({ id: configId, type: 'error', msg: data.error });
            } else {
                setActionStatus({ id: configId, type: 'success', msg: data.message || 'Done' });
                fetchVersions();
            }
        } catch (e: any) {
            setActionStatus({ id: configId, type: 'error', msg: e.message });
        }
    }, [settings, fetchVersions]);

    const handleImportFromRgs = useCallback(async (configId: string, version: number) => {
        if (!settings?.apiKey) return;
        setActionStatus({ id: configId, type: 'loading', msg: 'Downloading...' });
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'download', maths_config_id: configId }),
            });
            const data = await res.json();
            if (data.error) {
                setActionStatus({ id: configId, type: 'error', msg: data.error });
                return;
            }
            // Build a downloadable edge-function file
            const script = data.script || data.compiled_bundle || '';
            const configData = data.config_data ? JSON.stringify(data.config_data, null, 2) : '{}';
            const edgeFnContent = [
                '// RGS Math Version v' + version + ' — imported from XRGS',
                '// Config Data:',
                '// ' + configData.split('\n').join('\n// '),
                '',
                script,
            ].join('\n');
            const blob = new Blob([edgeFnContent], { type: 'text/javascript' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rgs_math_v${version}.js`;
            a.click();
            URL.revokeObjectURL(url);
            setActionStatus({ id: configId, type: 'success', msg: `Downloaded v${version} as edge function` });
        } catch (e: any) {
            setActionStatus({ id: configId, type: 'error', msg: e.message });
        }
    }, [settings]);

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



    // Upload, Test & Deploy — full pipeline handler
    const handleUploadTestDeploy = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) return;

        setUploading(true);
        setUploadStatus(null);
        setShowTestConfigModal(false);

        const game = games?.find((g: any) => g.id === selectedGame);

        try {
            // 1. Extract & sanitize the maths script
            setPipelineStep('Extracting maths script...');
            const xrgs = (window as any).__xrgs;
            if (!xrgs?.generateRgsScript) {
                setUploadStatus({ type: 'error', message: 'Maths bridge not ready. Open a maths component first.' });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            const result = xrgs.generateRgsScript();
            (window as any).__xrgsLastScript = result.script;
            console.log('[__xrgs] Script saved to window.__xrgsLastScript, length:', result.script?.length);
            if (result.error) {
                setUploadStatus({ type: 'error', message: result.error });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            if (!result.script || result.script.length < 50) {
                setUploadStatus({ type: 'error', message: 'Generated script is too short. Check your maths component.' });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Client-side compilation check
            try {
                new Function('ctx', result.script);
                console.log('[__xrgs] ✅ Client-side compilation check passed');
            } catch (compileErr: any) {
                console.error('[__xrgs] ❌ Client-side compilation FAILED:', compileErr.message);
                setUploadStatus({ type: 'error', message: `Client-side compilation failed: ${compileErr.message}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // 2. Sequential pipeline: upload → activate → stress-test → approve → deploy
            const callAction = async (payload: any) => {
                const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                    method: 'POST',
                    headers: rgsHeaders(settings.apiKey),
                    body: JSON.stringify(payload),
                });
                return r.json();
            };

            // Step 1: Upload
            setPipelineStep('Uploading maths...');
            const uploadData = await callAction({
                action: 'upload',
                game_id: selectedGame,
                maths_mode: 'script',
                script: result.script,
                config_data: result.configData,
                declared_rtp: game?.default_rtp || '96.00',
            });
            if (uploadData.error) {
                setUploadStatus({ type: 'error', message: `Upload failed: ${uploadData.error}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }
            const mathsConfigId = uploadData.maths_config_id;
            const version = uploadData.version;

            // Step 2: Activate (draft → testing)
            setPipelineStep('Activating for testing...');
            const activateData = await callAction({ action: 'activate', maths_config_id: mathsConfigId });
            if (activateData.error) {
                setUploadStatus({ type: 'error', message: `Activate failed: ${activateData.error}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Step 3: Stress Test
            setPipelineStep(`Running stress test (${(simCount / 1000).toFixed(0)}k spins)...`);
            const stressData = await callAction({ action: 'stress-test', maths_config_id: mathsConfigId, num_spins: simCount });
            if (stressData.error) {
                setUploadStatus({ type: 'error', message: `Stress test failed: ${stressData.error}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Step 4: Approve (testing → approved)
            setPipelineStep('Approving...');
            const approveData = await callAction({ action: 'approve', maths_config_id: mathsConfigId });
            if (approveData.error) {
                setUploadStatus({ type: 'error', message: `Approve failed: ${approveData.error}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Step 5: Deploy (approved → live)
            setPipelineStep('Deploying to live...');
            const deployData = await callAction({ action: 'deploy', maths_config_id: mathsConfigId });
            if (deployData.error) {
                setUploadStatus({ type: 'error', message: `Deploy failed: ${deployData.error}` });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Success — extract simulation metrics
            const rtpComp = stressData.tests?.rtp_compliance || {};
            const rtpStr = rtpComp.measured_rtp ? `${(rtpComp.measured_rtp * 100).toFixed(2)}%` : '';
            const hitStr = rtpComp.hit_rate != null ? `${(rtpComp.hit_rate * 100).toFixed(1)}%` : '';
            const maxStr = (rtpComp.max_win || rtpComp.max_multiplier) != null ? `${rtpComp.max_win || rtpComp.max_multiplier}×` : '';
            setUploadStatus({
                type: 'success',
                message: `v${version} deployed live! RTP ${rtpStr} · Hit ${hitStr} · Max ${maxStr}`,
            });
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e.message || 'Pipeline failed' });
        }

        setUploading(false);
        setPipelineStep(null);
    }, [settings, selectedGame, games, simCount]);

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
                                                    {g.name} ({g.status})
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
                                                <span style={{
                                                    padding: '2px 8px',
                                                    borderRadius: '3px',
                                                    backgroundColor: g.status === 'active' ? 'rgba(103, 222, 146, 0.15)' :
                                                        g.status === 'draft' ? 'rgba(255, 193, 7, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                                                    color: g.status === 'active' ? '#67DE92' :
                                                        g.status === 'draft' ? '#FFC107' : '#a0a0b0',
                                                    fontWeight: 600,
                                                }}>
                                                    {g.status}
                                                </span>
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

                        <Tooltip content="Upload, test, approve, and deploy maths to RGS in one click">
                            <Box hasBottomSpacing>
                                <PrimaryButton
                                    icon={IconName.CloudUpload}
                                    label={uploading ? (pipelineStep || 'Processing...') : 'Upload, Test & Deploy'}
                                    size={PrimaryButtonSize.Small}
                                    variant={PrimaryButtonVariant.MutedOnLowBg}
                                    onClick={() => setShowTestConfigModal(true)}
                                    isGrowing
                                    isDisabled={!connected || !selectedGame || uploading}
                                />
                            </Box>
                        </Tooltip>

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
                                        const rtpDisplay = hasSimData ? `${(measuredRtp * 100).toFixed(2)}%` : (v.declared_rtp ? `${v.declared_rtp}%` : null);

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
                                                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px' }}>
                                                            {v.status === 'failed' && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleVersionAction(v.id, 'activate'); }}
                                                                    disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                    style={{
                                                                        fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                        border: '1px solid rgba(255,255,255,0.15)', backgroundColor: 'rgba(255,255,255,0.05)',
                                                                        color: '#e0e0e0', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    Re-activate
                                                                </button>
                                                            )}
                                                            {v.status === 'live' && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleImportFromRgs(v.id, v.version); }}
                                                                    disabled={actionStatus?.id === v.id && actionStatus.type === 'loading'}
                                                                    style={{
                                                                        fontSize: '10px', padding: '3px 8px', borderRadius: '3px',
                                                                        border: '1px solid rgba(96,165,250,0.3)', backgroundColor: 'rgba(96,165,250,0.1)',
                                                                        color: '#60A5FA', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    ↓ Import as Edge Function
                                                                </button>
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
                                                                    Deploy Live
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
                                Configure the simulation before uploading. The math will be automatically tested, approved, and deployed.
                            </div>
                        </div>

                        {/* Simulation Count */}
                        <div style={{ marginBottom: '16px' }}>
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
                                onChange={(e) => setSimCount(Math.max(1000, Math.min(1000000, Number(e.target.value) || 10000)))}
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

                        {/* Pipeline steps preview */}
                        <div style={{
                            padding: '12px',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            marginBottom: '20px',
                        }}>
                            <div style={{ fontSize: '10px', color: '#888', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>
                                Pipeline Steps
                            </div>
                            {[
                                { icon: '①', label: 'Upload to RGS', desc: 'Draft status' },
                                { icon: '②', label: 'Run Simulation', desc: `${simCount.toLocaleString()} spins` },
                                { icon: '③', label: 'Auto-Approve', desc: 'Bypass compliance' },
                                { icon: '④', label: 'Deploy Live', desc: 'Exportable' },
                            ].map((step, i) => (
                                <div key={i} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '4px 0',
                                    fontSize: '12px', color: '#c0c0c0',
                                }}>
                                    <span style={{ color: '#67DE92', fontWeight: 700 }}>{step.icon}</span>
                                    <span>{step.label}</span>
                                    <span style={{ flex: 1 }} />
                                    <span style={{ fontSize: '10px', color: '#666' }}>{step.desc}</span>
                                </div>
                            ))}
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
                                onClick={handleUploadTestDeploy}
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
                            >Upload</button>
                        </div>
                    </div>
                </div>
            )}
        </BasePanel>
    );
}