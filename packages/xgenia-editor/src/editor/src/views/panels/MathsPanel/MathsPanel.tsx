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
// Shared XGENIA RGS settings/helpers live in utils/rgs/rgsClient so the Deploy
// flow can reuse them. Panel-local helpers (getRgsExtra / mergeRgsSettings) for the
// shared `xgenia_rgs_settings` localStorage key (read/written by both this panel and
// the AI via __xrgs) are kept below — rgsClient does not provide them.
import {
    XRGS_URL,
    rgsHeaders,
    getRgsSettings,
    saveRgsSettings,
    clearRgsSettings,
    createOperator,
    RgsSettings
} from '@xgenia-utils/rgs/rgsClient';

// ─── Shared RGS test config (game + settings) ───────────────
// One localStorage key (`xgenia_rgs_settings`) is the single source of truth, read/written by
// BOTH this panel and the AI (the AI reaches it via EditorBridge `xrgs.*` → EditorProxy.xrgs).
// `activeGame` = the "set project" to test against; `testSettings` = declared RTP / volatility / etc.
function getRgsExtra(): { activeGame?: any; testSettings?: any } {
    try {
        const p = JSON.parse(localStorage.getItem('xgenia_rgs_settings') || '{}');
        return { activeGame: p.activeGame, testSettings: p.testSettings };
    } catch { return {}; }
}

function mergeRgsSettings(patch: Record<string, any>): void {
    let cur: any = {};
    try { cur = JSON.parse(localStorage.getItem('xgenia_rgs_settings') || '{}'); } catch { /* ignore */ }
    localStorage.setItem('xgenia_rgs_settings', JSON.stringify({ ...cur, ...patch }));
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

    // ─── Persisted test config (shared with the AI via the bridge) ───
    /** The game ("project") to test maths against: { id, slug, name, status } or null. */
    getActiveGame: () => getRgsExtra().activeGame || null,
    setActiveGame: (game: any) => { mergeRgsSettings({ activeGame: game || null }); return true; },
    /** Test settings: { declaredRtp, volatility, maxWin, numSpins }. */
    getTestSettings: () => getRgsExtra().testSettings || null,
    setTestSettings: (s: any) => {
        const cur = getRgsExtra().testSettings || {};
        const next = { ...cur, ...(s || {}) };
        mergeRgsSettings({ testSettings: next });
        return next;
    },
};

// ─── Component ──────────────────────────────────────────────

export const MathsPanel_ID = 'maths-panel';

const mathsPanelOptions = {
    showSheetList: false,
    lockCurrentSheetName: '__maths__',
    componentTitle: 'Maths Components'
};

// Create-game form — mirrors the RGS platform's "Game Library" create form exactly
// (Game Name, Slug, Description). Everything else (game type, RTP, bets, volatility,
// reel dimensions, version) is filled in by the games-table defaults on the backend,
// same as a game created from the RGS platform.
const CREATE_DEFAULTS = { name: '', slug: '', description: '' };

// Slug generation matches the RGS Game Library form's autoSlug.
const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Create-operator defaults + option lists (values mirror the operator_connectors CHECK constraints).
const OPERATOR_DEFAULTS = { name: '', wallet_mode: 'demo', currencies: 'EUR' };
const WALLET_MODE_OPTIONS = ['demo', 'internal', 'seamless'];

const MODAL_LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };
const MODAL_INPUT_STYLE: React.CSSProperties = { width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };



export function MathsPanel() {
    const [settings, setSettings] = useState(getRgsSettings());
    const [keyInput, setKeyInput] = useState('');
    const [showInput, setShowInput] = useState(false);
    const [validating, setValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [games, setGames] = useState<any[] | null>(null);
    // Restore the previously-set game ("project") so it survives reloads and is shared with the AI.
    const [selectedGame, setSelectedGame] = useState<string | null>(() => getRgsExtra().activeGame?.id || null);
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [generatingKey, setGeneratingKey] = useState(false);
    // "Server Versions" now lists deployed-edge-function versions (matches the
    // studio Versions tab), not maths_configs.
    const [versions, setVersions] = useState<any[] | null>(null);
    const [versionsLoading, setVersionsLoading] = useState(false);

    // Upload, Test & Deploy modal state
    const [showTestConfigModal, setShowTestConfigModal] = useState(false);
    const [simCount, setSimCount] = useState(10000);
    const [pipelineStep, setPipelineStep] = useState<string | null>(null);

    // Create Game modal state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [createForm, setCreateForm] = useState({ ...CREATE_DEFAULTS });

    // Create Operator modal state. `newOperatorKey` holds the raw key returned once
    // by the RPC so it can be shown/copied before the modal closes.
    const [showOperatorModal, setShowOperatorModal] = useState(false);
    const [creatingOperator, setCreatingOperator] = useState(false);
    const [operatorError, setOperatorError] = useState<string | null>(null);
    const [operatorForm, setOperatorForm] = useState({ ...OPERATOR_DEFAULTS });
    const [newOperatorKey, setNewOperatorKey] = useState<string | null>(null);

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
                body: JSON.stringify({ action: 'list-edge-deployments', game_id: selectedGame }),
            });
            const data = await res.json();
            setVersions(data.deployments || []);
        } catch { setVersions([]); }
        setVersionsLoading(false);
    }, [settings, selectedGame]);

    useEffect(() => { fetchVersions(); }, [selectedGame, fetchVersions]);

    // Refresh versions after upload
    useEffect(() => {
        if (uploadStatus?.type === 'success') fetchVersions();
    }, [uploadStatus, fetchVersions]);

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

    // Create a game on XGENIA RGS (same backend as the RGS platform, so it shows up there too).
    const handleCreateGame = useCallback(async () => {
        if (!settings?.apiKey) return;
        const name = createForm.name.trim();
        if (!name) { setCreateError('Enter a game name'); return; }

        setCreating(true);
        setCreateError(null);

        // Same fields the RGS "Game Library" form submits: name, slug, description.
        // status 'draft' matches the RGS create form (and keeps the game uploadable —
        // the RGS backend rejects maths uploads to Active games). All other columns use
        // the games-table defaults, so the row is identical to an RGS-created game.
        const payload: Record<string, unknown> = {
            action: 'create-game',
            name,
            slug: createForm.slug.trim() || autoSlug(name),
            description: createForm.description,
            status: 'draft',
        };

        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setCreateError(data.error || `Failed to create game (${res.status})`);
                setCreating(false);
                return;
            }

            // Refresh the games list and auto-select the new (or existing) game.
            let newGames = games || [];
            try {
                const listRes = await fetch(`${XRGS_URL}/maths-deployer`, {
                    method: 'POST',
                    headers: rgsHeaders(settings.apiKey),
                    body: JSON.stringify({ action: 'list-games' }),
                });
                const listData = await listRes.json();
                if (listRes.ok && !listData.error) newGames = listData.games || [];
            } catch { /* keep existing list on refresh failure */ }
            setGames(newGames);

            const created = newGames.find((g) => g.id === data.game_id) || newGames.find((g) => g.slug === data.slug);
            if (created) {
                setSelectedGame(created.id);
                (window as any).__xrgs?.setActiveGame?.({ id: created.id, slug: created.slug, name: created.name, status: created.status });
            }

            setShowCreateModal(false);
            setCreateForm({ ...CREATE_DEFAULTS });
            setUploadStatus({
                type: 'success',
                message: data.created === false ? (data.message || `Game "${name}" already exists`) : `Game "${name}" created on XGENIA RGS`,
            });
        } catch (e) {
            setCreateError(e instanceof Error ? e.message : 'Failed to create game');
        }
        setCreating(false);
    }, [settings, createForm, games]);

    // Create an operator + API key on XGENIA RGS (so the user can connect without
    // leaving the editor). Mirrors the RGS platform's "Operators" section.
    const handleCreateOperator = useCallback(async () => {
        const name = operatorForm.name.trim();
        if (!name) { setOperatorError('Enter an operator name'); return; }

        setCreatingOperator(true);
        setOperatorError(null);
        try {
            const currencies = operatorForm.currencies
                .split(',')
                .map((c) => c.trim().toUpperCase())
                .filter(Boolean);
            const result = await createOperator({
                name,
                walletMode: operatorForm.wallet_mode as 'demo' | 'internal' | 'seamless',
                currencies: currencies.length ? currencies : ['EUR'],
            });
            // Connect immediately using the freshly minted key (same as handleConnect).
            saveRgsSettings(result.api_key);
            setSettings({ apiKey: result.api_key });
            setNewOperatorKey(result.api_key);
            setUploadStatus({ type: 'success', message: `Operator "${name}" created — connected to XGENIA RGS` });
        } catch (e) {
            setOperatorError(e instanceof Error ? e.message : 'Failed to create operator');
        }
        setCreatingOperator(false);
    }, [operatorForm]);

    const closeOperatorModal = useCallback(() => {
        setShowOperatorModal(false);
        setOperatorForm({ ...OPERATOR_DEFAULTS });
        setOperatorError(null);
        setNewOperatorKey(null);
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
            const rtpStr = rtpComp.measured_rtp ? `${rtpComp.measured_rtp.toFixed(2)}%` : '';
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
                {/* RGS controls (connection, target game, server versions) — sized to content, capped so the
                    components list below always has room. */}
                <div style={{ flexShrink: 0, maxHeight: '50%', overflowY: 'auto', overflowX: 'hidden' }}>
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
                                    {connected ? 'Connected to XGENIA RGS' : 'Not connected'}
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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span
                                            onClick={() => { setCreateError(null); setShowCreateModal(true); }}
                                            style={{ fontSize: '10px', color: '#67DE92', cursor: 'pointer', userSelect: 'none' as const }}
                                            title="Create a new game on XGENIA RGS"
                                        >
                                            + New game
                                        </span>
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
                                    </div>
                                    {games === null ? (
                                        <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>Loading games…</div>
                                    ) : games.length === 0 ? (
                                        <div style={{
                                            fontSize: '11px', color: '#a0a0b0', padding: '8px 12px',
                                            backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                        }}>
                                            No games yet.{' '}
                                            <span
                                                onClick={() => { setCreateError(null); setShowCreateModal(true); }}
                                                style={{ color: '#67DE92', cursor: 'pointer', textDecoration: 'underline' }}
                                            >
                                                Create your first game
                                            </span>.
                                        </div>
                                    ) : (
                                        <select
                                            value={selectedGame || ''}
                                            onChange={(e) => {
                                                const id = e.target.value || null;
                                                setSelectedGame(id);
                                                // Persist the chosen "project" so the AI tests the same game.
                                                // Write through __xrgs → mergeRgsSettings (the xgenia_rgs_settings
                                                // key this panel reads back via getRgsExtra), keeping the chosen
                                                // game consistent between the panel and the AI.
                                                const g = id && games ? games.find((x: any) => x.id === id) : null;
                                                (window as any).__xrgs?.setActiveGame?.(
                                                    g ? { id: g.id, slug: g.slug, name: g.name, status: g.status } : null
                                                );
                                            }}
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
                                    </>
                                ) : (
                                    <Box hasBottomSpacing>
                                        <PrimaryButton
                                            icon={IconName.CloudData}
                                            label="Connect to XGENIA RGS"
                                            size={PrimaryButtonSize.Small}
                                            variant={PrimaryButtonVariant.MutedOnLowBg}
                                            onClick={() => setShowInput(true)}
                                            isGrowing
                                        />
                                    </Box>
                                )}
                                {/* Self-serve: create an operator + key without leaving the editor */}
                                <Box hasBottomSpacing>
                                    <PrimaryButton
                                        icon={IconName.CloudData}
                                        label="Create operator & get key"
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.MutedOnLowBg}
                                        onClick={() => { setShowOperatorModal(true); setOperatorError(null); setNewOperatorKey(null); }}
                                        isGrowing
                                    />
                                </Box>
                                <div style={{ fontSize: '10px', color: '#666' }}>
                                    No API key yet? Create an operator to generate one and connect.
                                </div>
                            </>
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
                                            No edge functions deployed yet.
                                        </div>
                                    )}

                                    {versions && versions.map((v: any) => {
                                        const count = v.functions?.length || 0;
                                        return (
                                            <div key={v.id} style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                padding: '6px 8px', borderRadius: '4px', marginBottom: '4px',
                                                backgroundColor: 'rgba(255,255,255,0.03)',
                                            }}>
                                                <span style={{
                                                    fontSize: '11px', fontWeight: 700, fontFamily: 'monospace',
                                                    color: '#e0e0e0', minWidth: '24px',
                                                }}>v{v.version}</span>

                                                <span style={{
                                                    fontSize: '11px', color: '#c0c0c0',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                                                }}>{v.name}</span>

                                                <span style={{ flex: 1 }} />

                                                <span style={{ fontSize: '10px', color: '#a0a0b0', fontFamily: 'monospace' }}>
                                                    {count} component{count === 1 ? '' : 's'}
                                                </span>
                                                <span style={{ fontSize: '10px', color: '#555' }}>
                                                    {new Date(v.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Box>
                        )}
                    </VStack>
                </Box>
                </div>

                {/* Maths Components — the node-graph components for this project, locked to the
                    __maths__ sheet (mirrors CloudFunctionsPanel's cloud-components list). Without this the
                    panel only showed RGS "Server Versions" and no local components. */}
                <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
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

            {/* ═══ Create Game Modal ═══ */}
            {showCreateModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => !creating && setShowCreateModal(false)}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '440px', maxHeight: '85vh', overflowY: 'auto',
                            backgroundColor: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            padding: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>New Game</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Creates a game on XGENIA RGS. It appears in the RGS platform's Game Library immediately.
                            </div>
                        </div>

                        {/* Game Name — typing auto-fills the slug (matches the RGS form). */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Game Name</label>
                            <input
                                type="text"
                                placeholder="e.g. Dark Alice"
                                value={createForm.name}
                                onChange={(e) => { const v = e.target.value; setCreateForm({ ...createForm, name: v, slug: autoSlug(v) }); setCreateError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGame(); }}
                                style={MODAL_INPUT_STYLE}
                                autoFocus
                            />
                        </div>

                        {/* Slug */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Slug</label>
                            <input
                                type="text"
                                placeholder="dark-alice"
                                value={createForm.slug}
                                onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                                style={MODAL_INPUT_STYLE}
                            />
                        </div>

                        {/* Description */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Description</label>
                            <input
                                type="text"
                                placeholder="A gothic horror-themed game..."
                                value={createForm.description}
                                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                                style={MODAL_INPUT_STYLE}
                            />
                        </div>

                        {createError && (
                            <div style={{ fontSize: '11px', color: '#EF4444', marginBottom: '12px' }}>{createError}</div>
                        )}

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setShowCreateModal(false)}
                                disabled={creating}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px', cursor: creating ? 'not-allowed' : 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={handleCreateGame}
                                disabled={creating || !createForm.name.trim()}
                                style={{
                                    padding: '8px 20px', borderRadius: '6px', border: 'none',
                                    backgroundColor: creating || !createForm.name.trim() ? '#444' : '#67DE92',
                                    color: creating || !createForm.name.trim() ? '#888' : '#1a1a2e',
                                    fontSize: '13px', fontWeight: 700,
                                    cursor: creating || !createForm.name.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >{creating ? 'Creating…' : 'Create Game'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Create Operator modal ─── */}
            {showOperatorModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => { if (!creatingOperator) { newOperatorKey ? closeOperatorModal() : setShowOperatorModal(false); } }}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '440px', maxHeight: '85vh', overflowY: 'auto',
                            backgroundColor: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            padding: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>Create Operator</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Creates an operator on XGENIA RGS and generates its API key, so you can connect the editor to the RGS platform.
                            </div>
                        </div>

                        {newOperatorKey ? (
                            <>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Your API Key (shown once)</label>
                                    <input
                                        type="text"
                                        readOnly
                                        value={newOperatorKey}
                                        onFocus={(e) => e.currentTarget.select()}
                                        style={{ ...MODAL_INPUT_STYLE, fontFamily: 'monospace', fontSize: '12px' }}
                                    />
                                </div>
                                <div style={{ fontSize: '10px', color: '#E0B44A', marginBottom: '16px' }}>
                                    Save this key now — it is only shown once and cannot be retrieved again. It has already been stored in this editor and is sent as the X-Operator-Key header.
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button
                                        onClick={() => { navigator.clipboard?.writeText(newOperatorKey); }}
                                        style={{
                                            padding: '8px 16px', borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                            color: '#a0a0b0', fontSize: '13px', cursor: 'pointer',
                                        }}
                                    >Copy</button>
                                    <button
                                        onClick={closeOperatorModal}
                                        style={{
                                            padding: '8px 20px', borderRadius: '6px', border: 'none',
                                            backgroundColor: '#67DE92', color: '#1a1a2e',
                                            fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                                        }}
                                    >Done</button>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* Name */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Operator Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Acme Casino"
                                        value={operatorForm.name}
                                        onChange={(e) => { setOperatorForm({ ...operatorForm, name: e.target.value }); setOperatorError(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateOperator(); }}
                                        style={MODAL_INPUT_STYLE}
                                        autoFocus
                                    />
                                </div>

                                {/* Wallet mode + currencies */}
                                <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={MODAL_LABEL_STYLE}>Wallet Mode</label>
                                        <select
                                            value={operatorForm.wallet_mode}
                                            onChange={(e) => setOperatorForm({ ...operatorForm, wallet_mode: e.target.value })}
                                            style={{ ...MODAL_INPUT_STYLE, appearance: 'none', cursor: 'pointer' }}
                                        >
                                            {WALLET_MODE_OPTIONS.map((m) => (
                                                <option key={m} value={m} style={{ background: '#1a1a2e' }}>{m}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={MODAL_LABEL_STYLE}>Currencies</label>
                                        <input
                                            type="text"
                                            placeholder="EUR, USD"
                                            value={operatorForm.currencies}
                                            onChange={(e) => setOperatorForm({ ...operatorForm, currencies: e.target.value })}
                                            style={MODAL_INPUT_STYLE}
                                        />
                                    </div>
                                </div>
                                <div style={{ fontSize: '10px', color: '#666', marginBottom: '16px' }}>
                                    Comma-separated currency codes. New operators are created with status “testing” — an admin promotes them to “active” from the RGS platform.
                                </div>

                                {operatorError && (
                                    <div style={{ fontSize: '11px', color: '#EF4444', marginBottom: '12px' }}>{operatorError}</div>
                                )}

                                {/* Actions */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button
                                        onClick={() => setShowOperatorModal(false)}
                                        disabled={creatingOperator}
                                        style={{
                                            padding: '8px 16px', borderRadius: '6px',
                                            border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                            color: '#a0a0b0', fontSize: '13px', cursor: creatingOperator ? 'not-allowed' : 'pointer',
                                        }}
                                    >Cancel</button>
                                    <button
                                        onClick={handleCreateOperator}
                                        disabled={creatingOperator || !operatorForm.name.trim()}
                                        style={{
                                            padding: '8px 20px', borderRadius: '6px', border: 'none',
                                            backgroundColor: creatingOperator || !operatorForm.name.trim() ? '#444' : '#67DE92',
                                            color: creatingOperator || !operatorForm.name.trim() ? '#888' : '#1a1a2e',
                                            fontSize: '13px', fontWeight: 700,
                                            cursor: creatingOperator || !operatorForm.name.trim() ? 'not-allowed' : 'pointer',
                                        }}
                                    >{creatingOperator ? 'Creating…' : 'Create Operator'}</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </BasePanel>
    );
}