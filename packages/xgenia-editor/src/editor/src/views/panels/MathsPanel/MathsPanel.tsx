import React, { useState, useEffect, useCallback } from 'react';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import {
    PrimaryButton,
    PrimaryButtonSize,
    PrimaryButtonVariant
} from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
// ContextMenu (and IconSize above) are used only by the commented-out "Deployed
// Functions" list further down — kept so restoring it is a pure uncomment.
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';
import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';

import { supabase } from '../../../supabaseInit';
import {
    downloadEdgeDeployment,
    deleteComponentEverywhere,
    deleteEdgeDeployment,
    renameEdgeDeployment,
    downloadEdgeFunction,
    renameEdgeFunction,
    deleteEdgeFunction
} from '@xgenia-utils/rgs/deployEdgeFunction';
import { AppRegistry } from '@xgenia-models/app_registry';
import { runMathsTest, promoteMathsToLive } from '@xgenia-utils/rgs/mathsPipeline';
import { ProjectModel } from '@xgenia-models/projectmodel';
import {
    deployMathsComponents,
    createEmptyServerVersion,
    listMathsComponents,
    MathsDeployResult
} from '@xgenia-utils/rgs/deployMathsComponents';
import {
    computeMathsStatus,
    DeployedComponent,
    emptyMathsStatus,
    MathsStatus,
    readDeployedComponents
} from '@xgenia-utils/rgs/mathsComponentStatus';
import { setMathsDeployState } from '@xgenia-utils/rgs/mathsDeployState';
import {
    CommitFileInput,
    ComponentCommit,
    createComponentCommit,
    listComponentCommits
} from '@xgenia-utils/rgs/componentCommits';
import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';
import { ComponentsPanel } from '../componentspanel';
import { MathsComponentDocumentProvider } from '../../documents/MathsComponentDocument';
import { MathsSimulateDocumentProvider } from '../../documents/MathsSimulateDocument';
import { MathsChangedSection } from './subsections/MathsChangedSection';
import { MathsDeployedSection } from './subsections/MathsDeployedSection';
import { MathsCommitsSection } from './subsections/MathsCommitsSection';


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
    fetchOperatorInfo,
    formatOperatorFunds,
    EDITOR_OPERATOR_MODES,
    GAME_MODES,
    gameModesForOperatorMode,
    RgsSettings,
    OperatorMode,
    GameMode,
    OperatorInfo
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
     * WHICH component gets compiled, in order:
     *   1. `componentName`, when given — and if that name does not resolve this
     *      FAILS. It used to fall through to auto-discovery, so a typo'd or stale
     *      name silently compiled and deployed a different component while every
     *      status message named the one you asked for.
     *   2. the maths component currently open in the node graph editor — "deploy
     *      what I am looking at", which is what the edit→deploy→test loop means.
     *   3. the only maths component, when the project has exactly one.
     *   4. otherwise an error listing the candidates. Picking the first of several
     *      is a coin flip that reports success either way; with the Maths
     *      Components tree restored, projects hold more than one as a matter of
     *      course (one per game, plus older revisions), so this case is normal
     *      rather than exotic and must not be guessed at.
     *
     * @param componentName - Full component name (e.g. '/#__maths__/Zeus Maths')
     * @returns { script, configData, componentName, nodeCount } or { error }
     */
    generateRgsScript: (componentName?: string) => {
        try {
            const { ProjectModel } = require('@xgenia-models/projectmodel');
            const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');

            const project = ProjectModel.instance;
            if (!project) return { error: 'No project loaded' };

            const allComponents = project.getComponents?.() || [];
            const mathsComponents = allComponents.filter((c: any) => c.name?.startsWith('/#__maths__/'));

            // Find the maths component
            let component;
            if (componentName) {
                component = project.getComponentWithName?.(componentName);
                if (!component) {
                    return {
                        error:
                            `Maths component "${componentName}" not found. ` +
                            (mathsComponents.length
                                ? `Available: ${mathsComponents.map((c: any) => c.name).join(', ')}`
                                : 'This project has no maths components yet.')
                    };
                }
            }
            if (!component) {
                if (mathsComponents.length === 0) {
                    return { error: 'No maths component found. Create a maths component first.' };
                }
                // The component open in the node graph editor wins, so "Upload,
                // Test & Deploy" ships the maths you are actually editing.
                const activeName = NodeGraphContextTmp?.nodeGraph?.getActiveComponent?.()?.name;
                component = mathsComponents.find((c: any) => c.name === activeName);
            }
            if (!component) {
                if (mathsComponents.length === 1) {
                    component = mathsComponents[0];
                } else {
                    return {
                        error:
                            `This project has ${mathsComponents.length} maths components and none of them is open, ` +
                            `so there is no way to tell which one you meant. Open the one you want in the Maths ` +
                            `Components tree, then run this again. Candidates: ` +
                            mathsComponents.map((c: any) => c.name).join(', ')
                    };
                }
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
                // Nodes the compiler cannot express server-side. Returned so a
                // caller testing maths sees the same gap the deploy path
                // refuses on, instead of measuring an RTP against a script
                // that is missing part of the graph.
                unsupportedNodes: result.unsupportedNodes,
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

// The project's own maths components — the `/#__maths__/` sheet, rendered as a
// component tree exactly the way Cloud Functions renders `/#__cloud__/`
// (CloudFunctionsPanel.tsx). This is where maths is AUTHORED: node graphs that
// `CloudFunctionConverter.generateRgsScript()` (supabase-converter.ts) turns into
// the `evaluate(ctx)` script that "Upload, Test & Deploy" ships to the RGS.
//
// This mount is load-bearing, not decorative. `router.setup.ts` passes
// `hideSheets: ['__cloud__', '__maths__']` to the general Components panel on the
// assumption that each of those sheets has its own dedicated panel. Between
// 4386af9 (2026-07-22) and this restore that assumption was false for maths: the
// mount was deleted but the hide rule stayed, so `/#__maths__/` components were
// unreachable from every UI surface in the editor — you could neither open the
// ones you had nor create a new one, while the converter went on compiling them
// on upload. Do not remove this without also removing '__maths__' from that
// hideSheets list. See mathsPanelMount guard test.
const mathsPanelOptions = {
    showSheetList: false,
    lockCurrentSheetName: '__maths__',
    // This tree is the "Local" subsection now — the working copy you author in.
    // The panel that holds it is already called Maths Components, so repeating
    // that here would say nothing; naming it Local says which of the four it is.
    componentTitle: 'Local Components'
};

// Create-game form — mirrors the RGS platform's "Game Library" create form
// (Game Name, Slug, Description, Mode), minus its Owner field: a game created from
// here is owned by the operator whose key the editor is connected with, so there is
// nothing to pick. Everything else (game type, RTP, bets, volatility, reel
// dimensions, version) is filled in by the games-table defaults on the backend,
// same as a game created from the RGS platform.
//
// Mode is whether real money moves through the game. Which values are offered
// depends on the connected key — see gameModesForOperatorMode.
const CREATE_DEFAULTS = { name: '', slug: '', description: '', mode: 'demo' as GameMode };

// Slug generation matches the RGS Game Library form's autoSlug.
const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// Create-operator form — mirrors the RGS platform's "New Operator" form field for
// field (Operator Name, Slug, Mode, Wallet Balance, Supported Currencies, Max Bet,
// Max Win, IP Whitelist), with one deliberate difference: Mode offers only Demo and
// Live. `internal` is superadmin over every game in the platform and is granted
// from the RGS platform alone — see EDITOR_OPERATOR_MODES in rgsClient.
//
// wallet_balance / max_bet / max_win are held as strings because they are text
// inputs; wallet_balance is entered in MAJOR units (what the platform shows) and
// converted to cents on submit, while max bet/win are in cents, exactly as the
// platform labels them.
const OPERATOR_DEFAULTS = {
    name: '',
    slug: '',
    mode: 'demo' as OperatorMode,
    wallet_balance: '0.00',
    // EUR, not USD: the RGS platform's operating currency went back to EUR on
    // 2026-08-04 (migration 20260804130000) and create_operator's own default is
    // EUR, so an operator opened from here in USD would be the only one on the
    // platform quoting a currency it does not operate in.
    currencies: 'EUR',
    max_bet: '',
    max_win: '',
    contact_email: '',
    allowed_ips: ''
};

const MODAL_LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' };
const MODAL_INPUT_STYLE: React.CSSProperties = { width: '100%', padding: '10px 12px', backgroundColor: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff', fontSize: '14px', outline: 'none', boxSizing: 'border-box' };
// Small per-version action buttons in the Server Versions list (download/delete).
const VERSION_BTN_STYLE: React.CSSProperties = { fontSize: '11px', lineHeight: 1, cursor: 'pointer', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '4px', color: '#c0c0c0', padding: '3px 6px' };
const VERSION_DELETE_BTN_STYLE: React.CSSProperties = { ...VERSION_BTN_STYLE, color: '#EF4444', borderColor: 'rgba(239,68,68,0.35)' };

// A component row in the Components sub-section: the name opens the component's
// API docs + script inspector in the editor's main area, and the three-dot menu
// on the far right holds its rename / simulate / download / delete actions.
const COMPONENT_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '6px', marginBottom: '4px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#e0e0e0' };
// The name part of that row — a transparent button filling the space left of the menu.
const COMPONENT_NAME_BTN_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0, padding: 0, textAlign: 'left', background: 'transparent', border: 'none', color: '#e0e0e0', cursor: 'pointer' };

/**
 * One label/value line in the connected-operator summary under
 * "Connected to XGENIA RGS".
 */
const OperatorDetail = ({ label, value, isNegative }: { label: string; value: string; isNegative?: boolean }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', fontSize: '11px', lineHeight: 1.4 }}>
        <span style={{ color: '#7a7a8a', flexShrink: 0 }}>{label}</span>
        <span
            style={{
                color: isNegative ? '#EF4444' : '#c8c8d0',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
            }}
            title={value}
        >
            {value}
        </span>
    </div>
);

/**
 * Whether `deploymentId` holds the copy of `slug` that the public rgs-fn
 * dispatcher actually serves — i.e. whether redeploying it changes production.
 *
 * rgs-fn resolves a (game, slug) to the NEWEST ACTIVE row by created_at across
 * every version, not to the newest version. Those usually agree, but they come
 * apart when a component was dropped from a later version: the surviving older
 * row stays live. Mirror the dispatcher's rule rather than assuming "highest
 * version wins", so the redeploy confirmation never misstates the blast radius.
 */
const isLiveComponent = (versions: any[] | null, deploymentId: string, slug: string): boolean => {
    const rows = (versions || []).flatMap((v: any) =>
        (v.functions || [])
            .filter((f: any) => f.function_slug === slug && f.status === 'active')
            .map((f: any) => ({ deploymentId: v.id, createdAt: f.created_at }))
    );
    if (rows.length === 0) return false;
    const live = rows.reduce((newest, row) => (row.createdAt > newest.createdAt ? row : newest));
    return live.deploymentId === deploymentId;
};

// Simulation-input configuration types. The develop merge (952bf91) kept the sim-config STATE and
// its UI but dropped these definitions, so the panel referenced PortInfo / InputConfig / InputMode
// that no longer existed anywhere — the TS2304s the dev server reported.
interface PortInfo { name: string; type: string }
type InputMode = 'rng' | 'fixed' | 'trigger' | 'off';
interface InputConfig { mode: InputMode; value: number; rngMin?: number; rngMax?: number }

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
    // Per-version action state for the Server Versions rename/download/delete controls.
    // `versionActionId` = the version currently renaming/downloading/deleting (busy row);
    // `confirmDeleteId` = the version showing its inline "Delete? Yes/No" confirm;
    // `renameVersion` = the version whose rename modal is open.
    const [versionActionId, setVersionActionId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    // Maths configs (action:'versions') — the APPROVAL lifecycle: draft →
    // testing → approved → live, each row carrying its stress results. Distinct
    // from `versions` above, which lists deployed edge functions. The panel
    // stopped calling 'versions' in 57ba2a6; the action stayed live server-side
    // (the AI's rgs_get_versions still uses it), so nothing needed rebuilding —
    // without it there is no way to promote a tested config after a reload.
    const [mathsConfigs, setMathsConfigs] = useState<any[] | null>(null);
    // The config most recently put through a Test run, so Promote has a target
    // in this session before the list has refreshed.
    const [testedConfigId, setTestedConfigId] = useState<string | null>(null);
    const [promotingId, setPromotingId] = useState<string | null>(null);
    const [renameVersion, setRenameVersion] = useState<any | null>(null);
    const [versionNameInput, setVersionNameInput] = useState('');
    const [versionRenameError, setVersionRenameError] = useState<string | null>(null);
    // The Server Version whose components are shown in the Components sub-section.
    // Null until the user clicks a row; the derived `selectedVersion` below then
    // falls back to the newest version (matching the studio "API docs" default).
    const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
    // Per-component action state for the Components sub-section's three-dot menu.
    // `componentActionId` = the component currently downloading/renaming/deleting;
    // `renameFn` / `confirmDeleteFn` = the component whose modal is open.
    const [componentActionId, setComponentActionId] = useState<string | null>(null);
    const [renameFn, setRenameFn] = useState<any | null>(null);
    const [renameInput, setRenameInput] = useState('');
    const [renameError, setRenameError] = useState<string | null>(null);
    const [confirmDeleteFn, setConfirmDeleteFn] = useState<any | null>(null);

    // ─── Maths Components → Deploy ──────────────────────────────
    // Deploying the project's `/#__maths__/` components into the selected Server
    // Version as backend components. This is the OTHER lifecycle in this panel and
    // deliberately separate from Test / Promote to Live above: that one uploads one
    // maths config and moves it through draft → testing → live (maths_configs);
    // this one turns each authored component into its own callable endpoint
    // (game_edge_functions). Both target the same game, neither touches the other.
    //
    // `deployingComponents` disables the button while a run is in flight;
    // `deployStep` is its per-component progress line; `mathsCount` is how many
    // Maths Components the project has right now — the tree below can add, rename
    // and delete them while this panel is open.
    const [deployingComponents, setDeployingComponents] = useState(false);
    const [deployStep, setDeployStep] = useState<string | null>(null);
    const [mathsCount, setMathsCount] = useState(0);
    // Creating a new (empty) Server Version from the Server Versions header.
    const [creatingVersion, setCreatingVersion] = useState(false);

    // ─── Maths Components subsections ────────────────────────────
    // The panel's three views of the same components, in the shape Source Control
    // uses: Deployed is the tree (what exists, badged by whether it is live),
    // Changed is the working copy against the platform, Commits is the history.
    //
    // All three are driven by one comparison, refreshed together — a split where
    // the tree's badges and the Changed list could disagree would be worse than
    // either being briefly stale.
    const [activeSubsection, setActiveSubsection] = useState('local');
    const [mathsStatus, setMathsStatus] = useState<MathsStatus>(() => emptyMathsStatus());
    const [statusError, setStatusError] = useState<string | null>(null);
    const [commits, setCommits] = useState<ComponentCommit[]>([]);
    const [commitsLoading, setCommitsLoading] = useState(false);
    const [commitsError, setCommitsError] = useState<string | null>(null);
    // The Deploy prompt: a commit needs a message, so Deploy asks for one first.
    const [commitPrompt, setCommitPrompt] = useState<{ message: string } | null>(null);

    // Everything a Deploy applies — deletions included, since they are applied now
    // (see handleDeployMathsComponents). Counting only the deploys would let the
    // button read "Deploy 0 changes" while a removal was still pending.
    const deployableCount = mathsStatus.changed.length;
    const removalCount = mathsStatus.changed.filter((c) => c.kind === 'deleted').length;

    // Upload, Test & Deploy modal state
    const [showTestConfigModal, setShowTestConfigModal] = useState(false);
    const [activeSimVersionId, setActiveSimVersionId] = useState<string | null>(null);
    const [simCount, setSimCount] = useState(10000);
    const [simBetPort, setSimBetPort] = useState('bet');
    const [simWinPort, setSimWinPort] = useState('win');
    const [simAvailablePorts, setSimAvailablePorts] = useState<{ inputPorts: PortInfo[], outputPorts: PortInfo[] } | null>(null);
    const [simInputConfig, setSimInputConfig] = useState<Record<string, InputConfig>>({});
    const [pipelineStep, setPipelineStep] = useState<string | null>(null);

    // Same merge casualty as the types above: the sim-config UI calls this on every input row.
    const updateSimInputConfig = (portName: string, field: Partial<InputConfig>) => {
        setSimInputConfig(prev => ({
            ...prev,
            [portName]: { ...(prev[portName] || { mode: 'rng', value: 0, rngMin: 1, rngMax: 100 }), ...field }
        }));
    };

    // Create Game modal state
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [createForm, setCreateForm] = useState({ ...CREATE_DEFAULTS });

    // Delete Game modal state. `deletePreview` is the server's account of what would
    // be destroyed and what stands in the way (maths-deployer game-delete-preview);
    // the modal is confirmation only, and every rule is enforced server-side.
    const [deletePreview, setDeletePreview] = useState<any | null>(null);
    const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
    const [deletingGame, setDeletingGame] = useState(false);
    const [deleteGameError, setDeleteGameError] = useState<string | null>(null);

    // Create Operator modal state. `newOperatorKey` holds the raw key returned once
    // by the RPC so it can be shown/copied before the modal closes.
    const [showOperatorModal, setShowOperatorModal] = useState(false);
    const [creatingOperator, setCreatingOperator] = useState(false);
    const [operatorError, setOperatorError] = useState<string | null>(null);
    const [operatorForm, setOperatorForm] = useState({ ...OPERATOR_DEFAULTS });
    const [newOperatorKey, setNewOperatorKey] = useState<string | null>(null);

    // The operator this key belongs to — name, mode and remaining wallet funds,
    // shown under "Connected to XGENIA RGS". Null while loading or if the lookup
    // fails; the detail line is simply omitted then rather than showing a blank.
    const [operatorInfo, setOperatorInfo] = useState<OperatorInfo | null>(null);

    const connected = !!settings;

    // The version whose components the Components sub-section renders. Defaults to
    // the newest (first) version until the user clicks another row — same default
    // as the studio "API docs" page.
    const selectedVersion =
        (versions || []).find((v: any) => v.id === selectedVersionId) || (versions || [])[0] || null;

    /** The line under the Deploy button: why it is unavailable, or what it will do. */
    const deployButtonHint = !connected
        ? 'Connect to XGENIA RGS to deploy.'
        : !selectedGame
            ? 'Select a game above.'
            : !selectedVersion
                ? 'Create a server version above to deploy into.'
                : deployableCount > 0
                    ? `Applies ${deployableCount} change${deployableCount === 1 ? '' : 's'} to v${selectedVersion.version}` +
                      (removalCount > 0
                          ? `, removing ${removalCount} component${removalCount === 1 ? '' : 's'} from RGS`
                          : '') +
                      ', and records a commit.'
                    : mathsCount === 0
                        ? 'Add a Maths Component in Local to deploy.'
                        : 'Nothing to deploy — every component matches what is live.';

    // ─── Deployed-function helpers ───────────────────────────────
    // These three (openComponentDoc, openComponentSimulate, and the handlers
    // further down) drive the "Deployed Functions" list, which is currently
    // commented out further down this file. Kept live so uncommenting that block is
    // the only step needed to restore it.

    // Open a component's API docs + script inspector in the editor's MAIN area
    // (an AppRegistry document, like the Component Diff view) — not in this
    // sidebar. The document fetches the script itself via download-edge-deployment.
    const openComponentDoc = (fn: any) => {
        if (!settings?.apiKey || !selectedVersion) return;
        AppRegistry.instance.openDocument(MathsComponentDocumentProvider.ID, {
            apiKey: settings.apiKey,
            // Needed to redeploy an edited script — deploy-edge-function is game-scoped.
            gameId: selectedGame,
            deploymentId: selectedVersion.id,
            version: selectedVersion.version,
            gameName: (games || []).find((g: any) => g.id === selectedGame)?.name,
            isLiveVersion: isLiveComponent(versions, selectedVersion.id, fn.function_slug),
            // Decides whether the script opens editable or view-only: internal
            // keys may redeploy it, demo/live keys may only read it (see
            // canEditDeployedScript). Passed as a seed — the document resolves
            // the mode itself if this is still null, so an operator-info lookup
            // that has not landed yet cannot silently lock an internal key out.
            operatorMode: operatorInfo?.mode ?? null,
            fn: {
                function_slug: fn.function_slug,
                function_name: fn.function_name,
                function_url: fn.function_url,
                payload_example: fn.payload_example,
                response_example: fn.response_example
            }
        });
    };

    // Open a DEPLOYED component's Simulate view in the editor's MAIN area — the
    // same Define Inputs → Simulate → Results flow as a game's Testing subsection
    // in the RGS studio, with the rounds run on RGS against the deployed script.
    //
    // Identical to what the Deployed tab's three-dot menu does
    // (MathsDeployedSection.simulate), which is the route people actually take;
    // this copy belongs to the commented-out Deployed Functions list below and is
    // kept in step with it so restoring that block stays a pure uncomment.
    const openComponentSimulate = (fn: any) => {
        if (!settings?.apiKey || !selectedVersion) return;
        AppRegistry.instance.openDocument(MathsSimulateDocumentProvider.ID, {
            apiKey: settings.apiKey,
            deploymentId: selectedVersion.id,
            version: selectedVersion.version,
            gameName: (games || []).find((g: any) => g.id === selectedGame)?.name,
            fn: {
                function_slug: fn.function_slug,
                function_name: fn.function_name,
                payload_example: fn.payload_example,
                response_example: fn.response_example,
                // The bet/win mapping chosen in the post-compile setup card at
                // publish time; the view defaults its pickers to these.
                bet_input_port: fn.bet_input_port,
                win_output_port: fn.win_output_port
            }
        });
    };

    // Who are we connected as? Fetched alongside the games list so the connection
    // block can name the operator, its mode and its remaining wallet funds. The
    // wallet figure moves with play, so it is refreshed whenever the games list is.
    const loadOperatorInfo = useCallback(async () => {
        if (!settings?.apiKey) { setOperatorInfo(null); return; }
        try {
            setOperatorInfo(await fetchOperatorInfo(settings.apiKey));
        } catch (err) {
            console.error('[MathsPanel] operator-info failed:', err);
            setOperatorInfo(null);
        }
    }, [settings]);

    useEffect(() => { void loadOperatorInfo(); }, [loadOperatorInfo]);

    // How many Maths Components the project holds. Recounted on every add / remove
    // / rename, because the Maths Components tree in this same panel is what
    // performs those — so the Deploy button must not describe a stale tree.
    useEffect(() => {
        const project = ProjectModel.instance;
        const recount = () => setMathsCount(listMathsComponents(project).length);
        recount();
        if (!project) return;
        const group = {};
        project.on(['componentAdded', 'componentRemoved', 'componentRenamed'], recount, group);
        return () => { project.off(group); };
    }, []);

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

    // Maths configs — the approval lifecycle behind the Promote action.
    const fetchMathsConfigs = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) { setMathsConfigs(null); return; }
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'versions', game_id: selectedGame }),
            });
            const data = await res.json();
            setMathsConfigs(data.versions || data.maths_configs || []);
        } catch { setMathsConfigs([]); }
    }, [settings, selectedGame]);

    useEffect(() => { fetchMathsConfigs(); }, [selectedGame, fetchMathsConfigs]);

    const handlePromote = useCallback(async (mathsConfigId: string) => {
        if (!settings?.apiKey || !mathsConfigId) return;
        setPromotingId(mathsConfigId);
        const callAction = async (payload: any) => {
            const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify(payload),
            });
            return r.json();
        };
        const res = await promoteMathsToLive(callAction, mathsConfigId, setPipelineStep);
        setUploadStatus(
            res.ok
                ? { type: 'success', message: 'Promoted to live.' }
                : { type: 'error', message: res.error || 'Promote failed' }
        );
        setPromotingId(null);
        setPipelineStep(null);
        fetchMathsConfigs();
        fetchVersions();
    }, [settings, fetchMathsConfigs, fetchVersions]);

    // Clear the components selection when the game changes so the sub-section
    // re-defaults to the new game's newest version.
    useEffect(() => { setSelectedVersionId(null); }, [selectedGame]);

    // Refresh versions after upload
    useEffect(() => {
        if (uploadStatus?.type === 'success') fetchVersions();
    }, [uploadStatus, fetchVersions]);

    // Download one Server Version as a JSON bundle — identical to the RGS studio
    // Versions tab: an array of the version's component edge functions (with
    // scripts), saved as `${slug}-edge-functions-v${version}.bundle.json`.
    const handleDownloadVersion = useCallback(async (v: any) => {
        if (!settings?.apiKey) return;
        setVersionActionId(v.id);
        try {
            const bundle = await downloadEdgeDeployment(settings.apiKey, v.id);
            const out = (bundle.functions || []).map(fn => ({
                slug: fn.function_slug,
                function_name: fn.function_name,
                function_url: fn.function_url,
                script: fn.script,
                payload_example: fn.payload_example,
                response_example: fn.response_example,
            }));
            if (out.length === 0) {
                setUploadStatus({ type: 'error', message: 'This version has no edge functions to download.' });
            } else {
                const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${bundle.slug}-edge-functions-v${bundle.version}.bundle.json`;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Download failed' });
        }
        setVersionActionId(null);
    }, [settings]);

    // Delete one Server Version. The server cascade-deletes its component edge
    // functions; refresh the list afterward.
    const handleDeleteVersion = useCallback(async (v: any) => {
        if (!settings?.apiKey) return;
        setConfirmDeleteId(null);
        setVersionActionId(v.id);
        try {
            await deleteEdgeDeployment(settings.apiKey, v.id, selectedGame || undefined);
            await fetchVersions();
            setUploadStatus({ type: 'success', message: `Deleted v${v.version}` });
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Delete failed' });
        }
        setVersionActionId(null);
    }, [settings, selectedGame, fetchVersions]);

    // Rename one Server Version. Label only — the version number, its components
    // and their function URLs are untouched, so a deployed frontend is unaffected.
    const handleRenameVersion = useCallback(async () => {
        if (!settings?.apiKey || !renameVersion) return;
        const name = versionNameInput.trim();
        if (!name) { setVersionRenameError('Enter a version name'); return; }
        if (name === (renameVersion.name || '')) { setRenameVersion(null); return; }

        setVersionActionId(renameVersion.id);
        setVersionRenameError(null);
        try {
            await renameEdgeDeployment(settings.apiKey, renameVersion.id, name, selectedGame || undefined);
            setRenameVersion(null);
            await fetchVersions();
            setUploadStatus({ type: 'success', message: `Renamed v${renameVersion.version} to "${name}"` });
        } catch (e: any) {
            setVersionRenameError(e?.message || 'Rename failed');
        }
        setVersionActionId(null);
    }, [settings, renameVersion, versionNameInput, selectedGame, fetchVersions]);

    // ─── Server Versions: create a new (empty) one ───────────────────
    // A Server Version is the container a game's backend components are deployed
    // into. Publish opens one per publish; this creates one up front and EMPTY, so
    // the user can pick their target before deploying anything into it. It lands on
    // the RGS platform immediately (the version number is assigned server-side) and
    // is auto-selected, so the Maths Components Deploy button is already aimed at it.
    const handleCreateVersion = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) return;
        setCreatingVersion(true);
        setUploadStatus(null);
        try {
            const game = (games || []).find((g: any) => g.id === selectedGame);
            const { deploymentId, version } = await createEmptyServerVersion(
                settings.apiKey,
                selectedGame,
                // Named after the open project, same as Publish does, so a version is
                // recognisable in the RGS studio's Versions tab.
                ProjectModel.instance?.name || game?.name || 'Server Version'
            );
            await fetchVersions();
            setSelectedVersionId(deploymentId);
            setUploadStatus({ type: 'success', message: `Created empty server version v${version}` });
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Could not create a server version' });
        }
        setCreatingVersion(false);
    }, [settings, selectedGame, games, fetchVersions]);

    // ─── Maths Components: Deploy ────────────────────────────────────
    // Deploys every Maths Component in the open project into the SELECTED Server
    // Version, one backend component each. Per component: compile (inline every
    // nested layer into one) → deploy the compiled script → upload its authored
    // project.json. See utils/rgs/deployMathsComponents.
    //
    // Works on demo, live and internal keys alike: the server-side mode gate on
    // overwriting a deployed component was withdrawn, so a component can be edited
    // and re-deployed into the same version as often as you like (ownership is
    // still enforced — assertGameAccess refuses games this key does not own).
    // ─── Maths Components: what is deployed, and how local differs ───
    // One read of the platform feeds all three subsections AND the badges on the
    // tree. Kept as two steps on purpose: `deployedComponents` is the expensive
    // half (a network round trip), `mathsStatus` is the cheap half (a local
    // comparison), so an edit in the graph re-compares without re-downloading.
    const [deployedComponents, setDeployedComponents] = useState<DeployedComponent[]>([]);

    const refreshDeployed = useCallback(async () => {
        if (!settings?.apiKey || !selectedVersion) {
            setDeployedComponents([]);
            setStatusError(null);
            return;
        }
        try {
            setDeployedComponents(await readDeployedComponents(settings.apiKey, selectedVersion.id));
            setStatusError(null);
        } catch (e: any) {
            setDeployedComponents([]);
            setStatusError(e?.message || 'Could not read what is deployed');
        }
    }, [settings, selectedVersion]);

    const refreshCommits = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame || !selectedVersion) {
            setCommits([]);
            return;
        }
        setCommitsLoading(true);
        setCommitsError(null);
        try {
            setCommits(await listComponentCommits(settings.apiKey, selectedGame, selectedVersion.id));
        } catch (e: any) {
            setCommits([]);
            setCommitsError(e?.message || 'Could not load commit history');
        }
        setCommitsLoading(false);
    }, [settings, selectedGame, selectedVersion]);

    useEffect(() => { void refreshDeployed(); }, [refreshDeployed]);
    useEffect(() => { void refreshCommits(); }, [refreshCommits]);

    // Deployed and Commits both describe the platform, which someone else can
    // change from another editor or the RGS studio. Re-read when either tab is
    // opened so a mirror is never quietly stale — on tab change only, so it costs
    // one request when you go looking, not a poll.
    useEffect(() => {
        if (activeSubsection === 'deployed') void refreshDeployed();
        if (activeSubsection === 'commits') void refreshCommits();
    }, [activeSubsection]);

    /**
     * Re-compare the working copy against what was last read from the platform.
     *
     * Local-only, so it is cheap enough to run on every project save — which is
     * what makes Changed behave like Source Control's list: edit a component's
     * graph, and it appears there without anyone pressing refresh.
     *
     * Also publishes to the shared deploy-state store, because the components tree
     * is the legacy ComponentsPanel view and cannot be handed React state.
     */
    const recompareMaths = useCallback(() => {
        const project = ProjectModel.instance;
        if (!project || !selectedVersion) {
            setMathsStatus(emptyMathsStatus());
            setMathsDeployState(null);
            return;
        }
        const status = computeMathsStatus(project, deployedComponents);
        setMathsStatus(status);
        setMathsDeployState(status);
    }, [deployedComponents, selectedVersion]);

    useEffect(() => { recompareMaths(); }, [recompareMaths]);

    // The working copy changed. `projectSavedToDisk` is the same signal the
    // Version Control panel diffs on — saves are debounced, so this fires once
    // after a burst of edits rather than on every keystroke.
    useEffect(() => {
        const group = {};
        EventDispatcher.instance.on(
            ['ProjectModel.projectSavedToDisk', 'ProjectModel.instanceHasChanged'],
            () => recompareMaths(),
            group
        );
        const project = ProjectModel.instance;
        if (project) {
            project.on(['componentAdded', 'componentRemoved', 'componentRenamed'], recompareMaths, group);
        }
        return () => {
            EventDispatcher.instance.off(group);
            project?.off(group);
        };
    }, [recompareMaths]);

    // Nothing else owns this store, so clear it when the panel goes away rather
    // than leaving the tree badging rows against a game that is no longer selected.
    useEffect(() => () => setMathsDeployState(null), []);

    /**
     * Deploy = commit.
     *
     * Only what CHANGED is pushed: a component that already matches its deployment
     * has nothing to send, and re-uploading it would put an identical snapshot in
     * the history and make every commit look like it touched everything.
     *
     * Deletions ARE applied. A component deleted in Local is removed from the
     * platform — every row it has, in every Server Version, because rgs-fn serves
     * the newest active row for a (game, slug) across all of them and deleting only
     * the selected version's copy would leave the endpoint answering with older
     * code. That is the whole point: a component you deleted should stop being live.
     *
     * The order matters and is not arbitrary. Deploys first, then the commit —
     * which carries the last-known script and graph of everything being deleted —
     * and only then the deletions themselves. The platform rows are the only copy
     * it holds, so the history has to exist before they go, or deleting a component
     * would be the one irreversible thing this editor can do.
     */
    const handleDeployMathsComponents = useCallback(async (commitMessage: string) => {
        if (!settings?.apiKey || !selectedGame || !selectedVersion) return;

        setDeployingComponents(true);
        setUploadStatus(null);
        setDeployStep(null);
        try {
            const project = ProjectModel.instance;
            if (!project) throw new Error('No project is open.');

            const toDeploy = mathsStatus.changed.filter((c) => c.kind === 'added' || c.kind === 'modified');
            const toDelete = mathsStatus.changed.filter((c) => c.kind === 'deleted');
            const onlySlugs = new Set(toDeploy.map((c) => c.slug));
            if (onlySlugs.size === 0 && toDelete.length === 0) {
                throw new Error('Nothing to deploy — every component matches what is already deployed.');
            }

            const results: MathsDeployResult[] = onlySlugs.size > 0
                ? await deployMathsComponents(project, {
                    apiKey: settings.apiKey,
                    gameId: selectedGame,
                    deploymentId: selectedVersion.id,
                    version: selectedVersion.version,
                    onlySlugs,
                    onProgress: setDeployStep
                })
                : [];

            // Record what just happened. AFTER the deploy, never before: a commit
            // written up front would claim a deploy that might still fail. If this
            // throws, the components are live and only the history entry is
            // missing — worth saying, not worth calling the deploy failed.
            const kindBySlug = new Map(mathsStatus.changed.map((c) => [c.slug, c.kind]));
            const files: CommitFileInput[] = results.map((r) => ({
                function_slug: r.slug,
                function_name: r.functionName,
                change_kind: kindBySlug.get(r.slug) === 'added' ? 'added' : 'modified',
                script: r.script,
                project_json: r.projectJson
            }));

            // Each deletion carries the component's last-known state, read from what
            // we already fetched off the platform. This is what makes the removal
            // recoverable — after the delete below, this commit is the only place
            // the component's graph still exists.
            toDelete.forEach((entry) => {
                const live = mathsStatus.deployedBySlug.get(entry.slug);
                files.push({
                    function_slug: entry.slug,
                    function_name: live?.functionName || entry.displayName,
                    change_kind: 'deleted',
                    ...(live?.component ? { project_json: { components: [live.component] } } : {})
                });
            });

            let commitWarning: string | null = null;
            try {
                setDeployStep('Recording commit…');
                await createComponentCommit(
                    settings.apiKey,
                    selectedGame,
                    selectedVersion.id,
                    commitMessage,
                    files,
                    operatorInfo?.name || undefined
                );
            } catch (e: any) {
                commitWarning = e?.message || 'the commit could not be recorded';
                console.error('[MathsComponents] commit failed:', e);
            }

            // The commit is the deletions' only backup, so a failed commit stops the
            // deletions rather than proceeding without one. The deploys already
            // happened and stay — reporting them as failed would be a lie — but
            // nothing gets removed that we could not put back.
            if (commitWarning) {
                await refreshDeployed();
                await refreshCommits();
                setUploadStatus({
                    type: 'error',
                    message:
                        `Deployed ${results.length} component${results.length === 1 ? '' : 's'}, but ` +
                        `${commitWarning}. The components are live; only the history entry is missing.` +
                        (toDelete.length > 0
                            ? ` ${toDelete.length} deletion${toDelete.length === 1 ? ' was' : 's were'} skipped — ` +
                              'without a commit to hold the graph, removing them could not be undone.'
                            : '')
                });
                setDeployingComponents(false);
                setDeployStep(null);
                return;
            }

            // Now the removals. Every row the component has, in every Server Version
            // — deleting only this version's copy would promote an older one and the
            // endpoint would go on answering (see deleteComponentEverywhere).
            const removed: string[] = [];
            const alreadyGone: string[] = [];
            const failedToRemove: string[] = [];
            for (const entry of toDelete) {
                try {
                    setDeployStep(`Removing ${entry.displayName} from RGS…`);
                    const { deleted } = await deleteComponentEverywhere(settings.apiKey, selectedGame, entry.slug);
                    (deleted > 0 ? removed : alreadyGone).push(entry.displayName);
                } catch (e: any) {
                    failedToRemove.push(`${entry.displayName} (${e?.message || 'unknown error'})`);
                }
            }

            await fetchVersions();
            await refreshDeployed();
            await refreshCommits();

            if (failedToRemove.length > 0) {
                setUploadStatus({
                    type: 'error',
                    message:
                        `Committed ${files.length} change${files.length === 1 ? '' : 's'} to v${selectedVersion.version}, ` +
                        `but could not remove ${failedToRemove.join(', ')}. ` +
                        `${failedToRemove.length === 1 ? 'It is' : 'They are'} still live on RGS.`
                });
                setDeployingComponents(false);
                setDeployStep(null);
                return;
            }

            // A component whose script deployed but whose project.json didn't is a
            // live backend with no readable graph stored — worth saying out loud
            // rather than reporting a clean success. Same for one whose bet/win
            // mapping could not be derived: it is live, but sees a stake of 0 until
            // the mapping is set.
            const noProject = results.filter((r) => !r.projectUploaded);
            const betWinIssue = results.find((r) => r.betWinWarning);
            // A node the compiler cannot express server-side, present but
            // feeding nothing: the deploy is real, and part of the graph does
            // not exist on the platform. Said out loud for the same reason as
            // the two above. Ones that DO feed the maths never get here — they
            // throw out of deployMathsComponents.
            const unsupportedIssue = results.find((r) => r.unsupportedNodeWarning);
            if (noProject.length > 0) {
                setUploadStatus({
                    type: 'error',
                    message:
                        `Deployed ${results.length} component${results.length === 1 ? '' : 's'} to v${selectedVersion.version}, but ` +
                        `${noProject.length} project.json upload${noProject.length === 1 ? '' : 's'} failed: ` +
                        (noProject[0].projectError || 'unknown error')
                });
            } else if (betWinIssue) {
                setUploadStatus({ type: 'error', message: betWinIssue.betWinWarning! });
            } else if (unsupportedIssue) {
                setUploadStatus({ type: 'error', message: unsupportedIssue.unsupportedNodeWarning! });
            } else {
                // Name the removals explicitly. "Committed 3 changes" would hide the
                // fact that an endpoint just stopped answering, which is the one
                // outcome of a deploy that can break a game already in the wild.
                const parts = [
                    results.length > 0 ? `${results.length} component${results.length === 1 ? '' : 's'} deployed` : '',
                    removed.length > 0 ? `${removed.join(', ')} removed from RGS` : '',
                    alreadyGone.length > 0 ? `${alreadyGone.join(', ')} already gone` : ''
                ].filter(Boolean);
                setUploadStatus({
                    type: 'success',
                    message: `v${selectedVersion.version}: ${parts.join(' · ')}`
                });
            }
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Deploy failed' });
        }
        setDeployingComponents(false);
        setDeployStep(null);
    }, [
        settings,
        selectedGame,
        selectedVersion,
        fetchVersions,
        mathsStatus,
        operatorInfo,
        refreshDeployed,
        refreshCommits
    ]);

    // ─── Components: per-component actions (three-dot menu) ──────────
    // Rename one component's DISPLAY name. Its slug and URL are untouched, so
    // anything already calling the endpoint keeps working.
    const handleRenameComponent = useCallback(async () => {
        if (!settings?.apiKey || !renameFn) return;
        const name = renameInput.trim();
        if (!name) { setRenameError('Enter a component name'); return; }
        if (name === (renameFn.function_name || '')) { setRenameFn(null); return; }

        setComponentActionId(renameFn.id);
        setRenameError(null);
        try {
            await renameEdgeFunction(settings.apiKey, renameFn.id, name, selectedGame || undefined);
            setRenameFn(null);
            await fetchVersions();
            setUploadStatus({ type: 'success', message: `Renamed to "${name}"` });
        } catch (e: any) {
            setRenameError(e?.message || 'Rename failed');
        }
        setComponentActionId(null);
    }, [settings, renameFn, renameInput, selectedGame, fetchVersions]);

    // Download one component as JSON (script + API docs) — the single-component
    // counterpart of the Server Version bundle, same file shape as the RGS studio.
    const handleDownloadComponent = useCallback(async (fn: any) => {
        if (!settings?.apiKey || !selectedVersion) return;
        setComponentActionId(fn.id);
        try {
            const { version, slug, fn: full } = await downloadEdgeFunction(
                settings.apiKey,
                selectedVersion.id,
                fn.function_slug
            );
            const blob = new Blob([JSON.stringify({
                slug: full.function_slug,
                function_name: full.function_name,
                function_url: full.function_url,
                script: full.script,
                payload_example: full.payload_example,
                response_example: full.response_example,
            }, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${slug}-${full.function_slug}-v${version}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Download failed' });
        }
        setComponentActionId(null);
    }, [settings, selectedVersion]);

    // Delete one component, leaving the rest of its version intact.
    const handleDeleteComponent = useCallback(async (fn: any) => {
        if (!settings?.apiKey) return;
        setConfirmDeleteFn(null);
        setComponentActionId(fn.id);
        try {
            await deleteEdgeFunction(settings.apiKey, fn.id, selectedGame || undefined);
            await fetchVersions();
            setUploadStatus({ type: 'success', message: `Deleted ${fn.function_name || fn.function_slug}` });
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e?.message || 'Delete failed' });
        }
        setComponentActionId(null);
    }, [settings, selectedGame, fetchVersions]);

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

        // Same fields the RGS "Game Library" form submits: name, slug, description, mode.
        // status 'draft' matches the RGS create form (and keeps the game uploadable —
        // the RGS backend rejects maths uploads to Active games). All other columns use
        // the games-table defaults, so the row is identical to an RGS-created game.
        //
        // Mode is clamped to what this key may create rather than trusted from the
        // form: operator-info can land after the modal opened and narrow the choice.
        // The backend rejects an out-of-bounds mode anyway; this just avoids failing
        // the create over a value the user can no longer see.
        const allowed = gameModesForOperatorMode(operatorInfo?.mode);
        const payload: Record<string, unknown> = {
            action: 'create-game',
            name,
            slug: createForm.slug.trim() || autoSlug(name),
            description: createForm.description,
            mode: allowed.includes(createForm.mode) ? createForm.mode : allowed[0],
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
    }, [settings, createForm, games, operatorInfo]);

    // Create an operator + API key on XGENIA RGS (so the user can connect without
    // leaving the editor). Mirrors the RGS platform's "Operators" section.
    const handleCreateOperator = useCallback(async () => {
        const name = operatorForm.name.trim();
        if (!name) { setOperatorError('Enter an operator name'); return; }

        // Entered in major units, stored in cents — same as the platform's form.
        const funds = Math.round(parseFloat(operatorForm.wallet_balance || '0') * 100);
        if (!Number.isFinite(funds) || funds < 0) {
            setOperatorError('Wallet balance must be zero or more');
            return;
        }

        // Loose shape check, the same rule the column's CHECK constraint and the
        // platform's mailer apply. Caught here so a typo reads as a sentence
        // instead of as "violates operator_connectors_contact_email_check".
        const contactEmail = operatorForm.contact_email.trim();
        if (contactEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail)) {
            setOperatorError(`"${contactEmail}" is not a valid email address`);
            return;
        }

        setCreatingOperator(true);
        setOperatorError(null);
        try {
            const currencies = operatorForm.currencies
                .split(',')
                .map((c) => c.trim().toUpperCase())
                .filter(Boolean);
            const allowedIps = operatorForm.allowed_ips
                .split(',')
                .map((ip) => ip.trim())
                .filter(Boolean);
            const result = await createOperator({
                name,
                slug: operatorForm.slug.trim() || undefined,
                mode: operatorForm.mode,
                currencies: currencies.length ? currencies : ['EUR'],
                walletBalance: funds,
                maxBet: operatorForm.max_bet ? parseInt(operatorForm.max_bet, 10) : null,
                maxWin: operatorForm.max_win ? parseInt(operatorForm.max_win, 10) : null,
                allowedIps,
                contactEmail,
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

    // ─── Delete the selected game ───────────────────────────────
    // Ask the server what deleting it would cost before showing any confirmation:
    // whether it is deletable at all (a played game never is — its rounds, ledger
    // entries and compliance reports are permanent), and what would be torn down
    // with it (maths versions, server versions, and any PUBLISHED component
    // endpoints a deployed frontend is calling).
    const openDeleteGame = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) return;
        setDeleteGameError(null);
        setDeletePreviewLoading(true);
        setDeletePreview({ loading: true });
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'game-delete-preview', game_id: selectedGame }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setDeletePreview(null);
                setUploadStatus({ type: 'error', message: data.error || 'Could not check the game' });
                return;
            }
            setDeletePreview(data);
        } catch (err) {
            setDeletePreview(null);
            setUploadStatus({ type: 'error', message: err instanceof Error ? err.message : 'Could not check the game' });
        } finally {
            setDeletePreviewLoading(false);
        }
    }, [settings, selectedGame]);

    const confirmDeleteGame = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame || !deletePreview?.game) return;
        setDeletingGame(true);
        setDeleteGameError(null);
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({
                    action: 'delete-game',
                    game_id: selectedGame,
                    // The preview already told the user this would remove live
                    // endpoints; acknowledging it here is what unlocks the delete.
                    confirm_published: deletePreview.active_components > 0 ? true : undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setDeleteGameError(data.error || 'Failed to delete the game');
                return;
            }

            const name = data.name || deletePreview.game.name;
            // Drop the selection and everything derived from it before refetching,
            // so nothing renders against a game that no longer exists.
            setSelectedGame(null);
            (window as any).__xrgs?.setActiveGame?.(null);
            setVersions(null);
            setSelectedVersionId(null);
            setDeletePreview(null);
            setGames((prev) => (prev || []).filter((g: any) => g.id !== selectedGame));
            setUploadStatus({ type: 'success', message: `Game "${name}" deleted` });
        } catch (err) {
            setDeleteGameError(err instanceof Error ? err.message : 'Failed to delete the game');
        } finally {
            setDeletingGame(false);
        }
    }, [settings, selectedGame, deletePreview]);

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

    // `comp` is optional: the Maths Versions list passes the component it is showing, while the
    // Test Configuration modal has no component in hand and relies on generateRgsScript picking
    // the one open in the graph editor (the behaviour the pre-merge handleUploadTestDeploy had).
    const handleUploadMathsComponent = useCallback(async (comp?: any) => {
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

            const result = xrgs.generateRgsScript(comp?.name);
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

            // 2. Test pipeline: upload → activate → stress-test, STOPPING at
            //    `testing`. Promotion to live is handlePromote, a separate act.
            //    This used to run on to approve → deploy, so the one button here
            //    pushed maths live with no stop — while the AI path already
            //    defaulted to stopping. The boundary now lives in mathsPipeline.ts
            //    where a test can hold it.
            const callAction = async (payload: any) => {
                const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                    method: 'POST',
                    headers: rgsHeaders(settings.apiKey),
                    body: JSON.stringify(payload),
                });
                return r.json();
            };

            const testRun = await runMathsTest({
                callAction,
                gameId: selectedGame,
                script: result.script,
                configData: result.configData,
                declaredRtp: game?.default_rtp || '96.00',
                numSpins: simCount,
                onStep: setPipelineStep,
            });

            if (!testRun.ok) {
                setUploadStatus({ type: 'error', message: testRun.error || 'Test failed' });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Keep the tested config so "Promote to Live" has something to act on
            // in this session; the Maths Versions list supplies it after a reload.
            setTestedConfigId(testRun.mathsConfigId || null);
            fetchMathsConfigs();

            const rtpComp = testRun.stress?.tests?.rtp_compliance || {};
            const rtpStr = rtpComp.measured_rtp ? `${rtpComp.measured_rtp.toFixed(2)}%` : '';
            const hitStr = rtpComp.hit_rate != null ? `${(rtpComp.hit_rate * 100).toFixed(1)}%` : '';
            const maxStr = (rtpComp.max_win || rtpComp.max_multiplier) != null ? `${rtpComp.max_win || rtpComp.max_multiplier}×` : '';
            // Name the component that was actually compiled. A project can hold
            // several maths components, so "v7 tested" on its own leaves you
            // guessing which of them you just pushed. "(not live)" is explicit
            // because this pipeline used to end at live and muscle memory lingers.
            const deployedName = String(result.componentName || '').replace('/#__maths__/', '') || 'maths';
            setUploadStatus({
                type: 'success',
                message: `${deployedName} → v${testRun.version} tested (not live). RTP ${rtpStr} · Hit ${hitStr} · Max ${maxStr}`,
            });
        } catch (e: any) {
            // The develop merge left this handler's tail belonging to a DIFFERENT function
            // (`setActionStatus({ id, ... })` — `id` does not exist in this scope) and closed a
            // useCallback with a bare `};`, which is the TS1005 the dev server reported.
            setUploadStatus({ type: 'error', message: e?.message || 'Upload failed' });
        } finally {
            setUploading(false);
            setPipelineStep(null);
        }
    }, [settings, selectedGame, games, fetchMathsConfigs]);


    return (
        <BasePanel title="Maths RGS" isFill>
            <Container direction={ContainerDirection.Vertical} isFill>
                {/* RGS controls (connection, target game, server versions) — sized to content, capped so the
                    components list below always has room. */}
                <div style={{ flexShrink: 0, maxHeight: '50%', overflowY: 'auto', overflowX: 'hidden' }}>
                <Box hasXSpacing hasYSpacing>
                    <VStack>
                        {/* Connection Status — plus, once connected, which operator
                            the key belongs to: name, mode and remaining wallet
                            fund. Internal mode has no wallet, so it reports that
                            rather than a zero balance. */}
                        <Box hasBottomSpacing>
                            <div style={{
                                padding: '8px 12px',
                                borderRadius: '6px',
                                backgroundColor: connected ? 'rgba(103, 222, 146, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                border: `1px solid ${connected ? 'rgba(103, 222, 146, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <div style={{
                                        width: '8px',
                                        height: '8px',
                                        borderRadius: '50%',
                                        backgroundColor: connected ? '#67DE92' : '#666',
                                        flexShrink: 0,
                                    }} />
                                    <span style={{ fontSize: '13px', color: '#e0e0e0' }}>
                                        {connected ? 'Connected to XGENIA RGS' : 'Not connected'}
                                    </span>
                                </div>

                                {connected && operatorInfo && (
                                    <div style={{ marginTop: '8px', paddingLeft: '16px', display: 'grid', gap: '3px' }}>
                                        <OperatorDetail
                                            label="Operator"
                                            value={operatorInfo.name || operatorInfo.operator_slug}
                                        />
                                        <OperatorDetail
                                            label="Mode"
                                            value={operatorInfo.mode.charAt(0).toUpperCase() + operatorInfo.mode.slice(1)}
                                        />
                                        <OperatorDetail
                                            label="Wallet fund"
                                            value={
                                                operatorInfo.wallet_balance === null
                                                    ? 'No wallet'
                                                    : formatOperatorFunds(operatorInfo.wallet_balance, operatorInfo.currency)
                                            }
                                            isNegative={(operatorInfo.wallet_balance ?? 0) < 0}
                                        />
                                    </div>
                                )}
                            </div>
                        </Box>

                        {/* Connect / Disconnect */}
                        {connected ? (
                            <>
                                {/* Game selector dropdown — always visible when connected */}
                                <Box hasBottomSpacing>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <label style={{ fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>
                                            Selected Game
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
                                                // The wallet fund moves with every
                                                // round, so refresh it alongside the
                                                // games list.
                                                void loadOperatorInfo();
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
                                                alignItems: 'center',
                                                flexWrap: 'wrap' as const,
                                                gap: '8px',
                                            }}>
                                                <span>{g.reel_rows}×{g.reel_cols}</span>
                                                <span>RTP {(parseFloat(g.default_rtp) * 100).toFixed(1)}%</span>
                                                <span>{g.volatility}</span>
                                                {/* Deleting is scoped to games this operator owns and is
                                                    refused server-side once a game has been played. */}
                                                <span
                                                    onClick={() => { if (!deletePreviewLoading) void openDeleteGame(); }}
                                                    style={{
                                                        marginLeft: 'auto',
                                                        color: deletePreviewLoading ? '#666' : '#EF4444',
                                                        cursor: deletePreviewLoading ? 'default' : 'pointer',
                                                        userSelect: 'none' as const,
                                                    }}
                                                    title="Delete this game from XGENIA RGS"
                                                >
                                                    {deletePreviewLoading ? 'Checking…' : 'Delete game'}
                                                </span>
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
                                        {versionsLoading ? (
                                            <span style={{ fontSize: '10px', color: '#666' }}>Loading&#8230;</span>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                {/* Creates the version EMPTY on the RGS platform and
                                                    selects it, so the Maths Components Deploy button
                                                    below has somewhere to deploy into. */}
                                                <span
                                                    onClick={() => { if (!creatingVersion) void handleCreateVersion(); }}
                                                    style={{
                                                        fontSize: '10px',
                                                        color: creatingVersion ? '#666' : '#67DE92',
                                                        cursor: creatingVersion ? 'default' : 'pointer',
                                                        userSelect: 'none' as const
                                                    }}
                                                    title="Create an empty server version on XGENIA RGS to deploy components into"
                                                >
                                                    {creatingVersion ? 'Creating…' : '+ New version'}
                                                </span>
                                                {/* Re-runs list-edge-deployments. The Deploy target
                                                    follows automatically, since its
                                                    `selectedVersion` is derived from this list. */}
                                                <span
                                                    onClick={() => { void fetchVersions(); }}
                                                    style={{ fontSize: '10px', color: '#666', cursor: 'pointer', userSelect: 'none' as const }}
                                                    title="Refresh server versions list"
                                                >
                                                    ↻ Refresh
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    {versions && versions.length === 0 && !versionsLoading && (
                                        <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>
                                            No server versions yet. Create one to deploy Maths Components into.
                                        </div>
                                    )}

                                    {versions && versions.map((v: any) => {
                                        const count = v.functions?.length || 0;
                                        const isSelected = selectedVersion?.id === v.id;
                                        return (
                                            <div
                                                key={v.id}
                                                onClick={() => setSelectedVersionId(v.id)}
                                                title="Deploy Maths Components into this version"
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '8px',
                                                    padding: '6px 8px', borderRadius: '4px', marginBottom: '4px',
                                                    cursor: 'pointer',
                                                    backgroundColor: isSelected ? 'rgba(103,222,146,0.12)' : 'rgba(255,255,255,0.03)',
                                                    border: `1px solid ${isSelected ? 'rgba(103,222,146,0.35)' : 'transparent'}`,
                                                }}
                                            >
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

                                                {versionActionId === v.id ? (
                                                    <span style={{ fontSize: '10px', color: '#666', minWidth: '52px', textAlign: 'right' as const }}>Working&#8230;</span>
                                                ) : confirmDeleteId === v.id ? (
                                                    <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                                        <span style={{ fontSize: '10px', color: '#EF4444' }}>Delete?</span>
                                                        <button title="Confirm delete" onClick={() => handleDeleteVersion(v)} style={VERSION_DELETE_BTN_STYLE}>Yes</button>
                                                        <button title="Cancel" onClick={() => setConfirmDeleteId(null)} style={VERSION_BTN_STYLE}>No</button>
                                                    </span>
                                                ) : (
                                                    <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            title="Rename version"
                                                            onClick={() => {
                                                                setRenameVersion(v);
                                                                setVersionNameInput(v.name || '');
                                                                setVersionRenameError(null);
                                                            }}
                                                            style={VERSION_BTN_STYLE}
                                                        >&#9998;</button>
                                                        <button title="Download bundle" onClick={() => handleDownloadVersion(v)} style={VERSION_BTN_STYLE}>&#8595;</button>
                                                        <button title="Delete version" onClick={() => setConfirmDeleteId(v.id)} style={VERSION_DELETE_BTN_STYLE}>&#128465;</button>
                                                    </span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </Box>
                        )}

                        {/* Test — COMMENTED OUT (2026-08-06), deliberately kept rather than
                            deleted. It compiled the maths component you had open, uploaded it
                            as a maths_config and ran the stress-test gauntlet, stopping at
                            `testing`.

                            Withdrawn because measuring a component's maths is now Simulate's
                            job, on the Maths RGS panel's Deployed tab: it runs on RGS against
                            the row rgs-fn actually serves, needs no upload and no second copy
                            of the maths on the platform.

                            READ THIS BEFORE ASSUMING THE TWO ARE INTERCHANGEABLE. They
                            overlap on "measure the RTP on RGS" and differ everywhere else:

                              * Simulate reports RTP / hit frequency / volatility for ONE
                                deployed component. That is all it does.
                              * Test also ran the certification gauntlet (bonus abuse, streak
                                analysis, variance validation, edge-case fuzzing, max-win cap,
                                analytical RTP) and, by moving a config to `testing`, was the
                                ONLY thing that made "Promote to Live" reachable — the server
                                refuses to approve a config that was never tested.

                            So while this is commented out, NO NEW maths_config can ever
                            become promotable. Configs already at `testing` or `approved` keep
                            their Promote to Live button; nothing can join them. If the
                            maths_configs lifecycle is wanted again, this button is the door
                            back in.

                            The pipeline it drives is untouched and now unreachable:
                            handleUploadTestDeploy, runMathsTest / promoteMathsToLive
                            (utils/rgs/mathsPipeline.ts, whose only caller is this file), the
                            Test Configuration modal, simCount, showTestConfigModal. Restoring
                            is a pure uncomment.

                            History, and the reason it is commented rather than deleted: 4565e24
                            removed this same entry point once before. Nothing else called
                            setShowTestConfigModal(true), so the modal could not be opened and
                            there was no way for a human to push maths to the RGS at all — it
                            was rediscovered as dead code, not noticed as a missing feature.
                            (The maths-sheet-mount.test.ts the old note cited as a guard does
                            not exist in this repo, so nothing catches a repeat.) */}
                        {/* RE-ENABLED 2026-08-06 (owner): creating a draft game and TESTING
                            must work. Promotion to live stays off — see the Maths Versions
                            block below, restored WITHOUT its Promote button.

                            GUARDS (they exist, and they are not in this repo): the note that
                            was here said "the maths-sheet-mount.test.ts the old note cited as
                            a guard does not exist in this repo, so nothing catches a repeat."
                            It does exist — in the `private` SUBMODULE, which is where the whole
                            AI test suite lives:
                              private/xgenia-ai-app/tests/maths-sheet-mount.test.ts
                              private/xgenia-ai-app/tests/maths-pipeline.test.ts
                            Run them with: cd private/xgenia-ai-app && npx vitest run
                            Commenting this button out fails the first; adding a Promote control
                            back fails the second. Grepping only the parent repo makes both look
                            fictional. */}
                        {connected && selectedGame && (
                            <Box hasBottomSpacing>
                                <Tooltip content="Compile the maths component you have open, upload it and run a stress test. Stops before live.">
                                    <PrimaryButton
                                        icon={IconName.Play}
                                        label={uploading ? (pipelineStep || 'Working…') : 'Test'}
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.MutedOnLowBg}
                                        onClick={() => setShowTestConfigModal(true)}
                                        isDisabled={uploading}
                                        isGrowing
                                    />
                                </Tooltip>
                            </Box>
                        )}

                        {/* Maths Versions — COMMENTED OUT (2026-08-06), deliberately kept
                            rather than deleted. It listed the `maths_configs` approval
                            lifecycle (draft → testing → approved → live) and carried the
                            Promote to Live button.

                            Withdrawn with the Test button above, which fed it. Test was the
                            only way a config could reach `testing`, and the server refuses to
                            approve one that was never tested — so with Test gone this section
                            could only ever show a frozen list nobody could add to. Two dead
                            sections are worse than none: an operator reading a stale `live`
                            row here would think it described the maths their game is running,
                            when what a player actually hits is the Server Version's
                            components in `game_edge_functions`. Those are a separate
                            lifecycle, shown in Server Versions / Deployed above.

                            WHAT THIS COSTS: the editor no longer has any UI for promoting a
                            maths_config, and neither does the RGS studio — its maths page has
                            no approve action. A config sitting at `testing` or `approved` can
                            now only be promoted by calling maths-deployer directly
                            (`action: "approve"`, then `"deploy"`). Uncomment this block AND
                            the Test button to get the lifecycle back; this one is useless on
                            its own.

                            Still live and now unreachable: handlePromote, promoteMathsToLive,
                            promotingId, testedConfigId, and the mathsConfigs loader — which
                            still fetches the version list on every game selection. Left
                            running deliberately, so restoring is a pure uncomment; it is one
                            request against a list the panel already talks to.

                            On the RTP column, if it comes back: it showed the MEASURED figure
                            from the stress run, or "RTP unknown" — never the declared number.
                            A declared RTP is what someone hoped for; showing it here would let
                            a config that has never been measured look tested. */}
                        {/* Maths Versions — the maths_configs TEST lifecycle. Restored
                            2026-08-06 (owner: draft + testing must work), but WITHOUT the
                            Promote to Live button: promotion stays deliberately off.

                            This is NOT what players hit. A player's spin runs the Server
                            Version's components in game_edge_functions, shown under Server
                            Versions above — a separate lifecycle. A `live` row here means a
                            maths_config was once promoted, not that it is what is running,
                            which is why the header says so.

                            RTP shown is the MEASURED figure from the stress run, or
                            "RTP unknown" — never the declared number. A declared RTP is what
                            someone hoped for; showing it would let an unmeasured config look
                            tested. */}
                        {connected && selectedGame && mathsConfigs && mathsConfigs.length > 0 && (
                            <Box hasBottomSpacing>
                                <div style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#a0a0b0', marginBottom: '2px' }}>
                                    Maths Versions <span style={{ fontWeight: 400, textTransform: 'none' as const }}>(test only)</span>
                                </div>
                                {/* Says what these rows are NOT, because a `live` row here reads as
                                    "this is what my game runs" and it is not — players hit the Server
                                    Version's components above. */}
                                <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>
                                    Test lifecycle only — not what players run.
                                </div>
                                {mathsConfigs.map((c: any) => {
                                    const rtp = c.stress_results?.tests?.rtp_compliance?.measured_rtp;
                                    const justTested = testedConfigId === c.id;
                                    return (
                                        <div
                                            key={c.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: '8px',
                                                padding: '6px 8px', borderRadius: '4px', marginBottom: '4px',
                                                backgroundColor: justTested ? 'rgba(103,222,146,0.12)' : 'rgba(255,255,255,0.03)',
                                                border: `1px solid ${justTested ? 'rgba(103,222,146,0.35)' : 'transparent'}`,
                                            }}
                                        >
                                            <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', color: '#e0e0e0', minWidth: '24px' }}>v{c.version}</span>
                                            <span style={{ fontSize: '10px', color: c.status === 'live' ? '#67DE92' : '#a0a0b0' }}>{c.status}</span>
                                            <span style={{ flex: 1 }} />
                                            <span style={{ fontSize: '10px', color: '#a0a0b0', fontFamily: 'monospace' }}>
                                                {rtp != null ? `${rtp.toFixed(2)}%` : 'RTP unknown'}
                                            </span>
                                            {/* No Promote control, deliberately. Promotion to live is
                                                off; this list is here so a Test run's result is
                                                visible, not so a config can be shipped from it. */}
                                        </div>
                                    );
                                })}
                            </Box>
                        )}
                    </VStack>
                </Box>
                </div>

                {/* Deploy target + Deploy — turns every Maths Component in the tree below
                    into its own backend component of the selected Server Version.
                    Per component: compile (inline every nested integration layer into one
                    flat layer) → deploy the compiled script → upload its authored
                    project.json. That is what makes a component a real backend: after
                    this, Publish only has to point the frontend at its live endpoint, and
                    nothing is compiled at publish time.

                    "Every" counts the tree, not its top level: a child and a grandchild
                    are components in their own right and each gets its own compile and its
                    own endpoint, so a sheet holding two parents with four descendants
                    between them deploys 6 components. The count on the button is exactly
                    that number (listMathsComponents).

                    Was distinct from "Test" above: that moved ONE maths config through the
                    draft → testing → live approval lifecycle (maths_configs), while this
                    turns each authored component into a callable endpoint
                    (game_edge_functions). Same game, independent lifecycles — and since
                    Test is now commented out, this is the only one of the two still
                    reachable, which makes Deploy the single way maths gets onto RGS. */}
                <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.08)', padding: '10px 12px 8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#a0a0b0' }}>
                            Deploy target
                        </span>
                        {selectedVersion ? (
                            <span style={{ fontSize: '10px', color: '#67DE92', fontFamily: 'monospace' }}>
                                v{selectedVersion.version}
                                {selectedVersion.name ? ` · ${selectedVersion.name}` : ''}
                            </span>
                        ) : (
                            <span style={{ fontSize: '10px', color: '#666' }}>none</span>
                        )}
                    </div>

                    {/* Deploy is a commit: it pushes what CHANGED and records what it
                        pushed. The count is the changed set, not the whole tree — pressing
                        it with nothing changed would put a duplicate snapshot in the
                        history and make every commit look like it touched everything. */}
                    <PrimaryButton
                        icon={IconName.CloudUpload}
                        label={
                            deployingComponents
                                ? 'Deploying…'
                                : deployableCount > 0
                                    ? `Deploy ${deployableCount} change${deployableCount === 1 ? '' : 's'}`
                                    : 'Deploy'
                        }
                        size={PrimaryButtonSize.Small}
                        variant={PrimaryButtonVariant.MutedOnLowBg}
                        onClick={() => setCommitPrompt({ message: '' })}
                        isGrowing
                        isDisabled={
                            !connected || !selectedGame || !selectedVersion || deployableCount === 0 || deployingComponents
                        }
                    />

                    {/* Why the button is unavailable, rather than an inert control — and
                        what pressing it will do when it is. `deployableCount` is checked
                        before `mathsCount`: deleting every component locally leaves an
                        empty tree with real removals still to apply, and "add a component"
                        would be the wrong thing to say about that. */}
                    {!deployingComponents && (
                        <div style={{ fontSize: '10px', color: '#666', marginTop: '6px' }}>
                            {deployButtonHint}
                        </div>
                    )}

                    {/* Per-component progress — the run is sequential, so this names the
                        component currently being worked on. */}
                    {deployStep && (
                        <div style={{ fontSize: '10px', color: '#67DE92', marginTop: '6px', fontFamily: 'monospace' }}>
                            {deployStep}
                        </div>
                    )}
                </div>

                {/* Maths Components — four views, split by WHERE a component lives rather
                    than by what you want to do with it. The two that hold real components
                    are the two you can drag from, and each drops the form that matches
                    where it came from:

                      Local    — the project's `/#__maths__/` tree, and the only place
                        components are authored: create, Folder, rename, duplicate, delete.
                        Every component in it is its own component at any depth — a child or
                        grandchild has its own graph, compiles on its own and deploys to its
                        own endpoint. Dragging one drops the LOCAL component, whose maths
                        runs in the browser, which is what makes it testable without
                        deploying. Rows are badged with how they stand against the platform.
                        No Simulate here — see Deployed.

                      Deployed — a read-only mirror of the selected Server Version: only
                        what RGS is actually serving. Dragging one drops a BACKEND
                        component, an Aggregator on its live endpoint. Its three-dot menu
                        holds Simulate, and this is the ONLY place that offers it: the
                        rounds run on the platform against the row rgs-fn serves, so an
                        RTP measured here is an RTP of the live maths. Nothing here is
                        editable; it describes code already running.

                      Changed  — Local measured against Deployed. A report, not a source:
                        read-only and not draggable, because everything it lists is Local's,
                        and a second way to drag the same component is a way to drag the
                        wrong one.

                      Commits  — the deploy history. Also not draggable: dropping a
                        superseded version into a live graph is a way to ship yesterday's
                        maths by accident.

                    Tab labels stay bare — the sidebar variant gives each button a fixed
                    quarter of the width, and a "(3)" suffix wraps. Counts live inside each
                    section's header instead. */}
                <div style={{ flex: '1.5 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <Tabs
                        variant={TabsVariant.Sidebar}
                        // The tree is a legacy view with its own DOM and scroll state;
                        // remounting it on every tab switch would lose the open folders and
                        // the selection. Keeping the tabs alive also means the badge
                        // subscription stays live while Changed or Commits is on screen.
                        keepTabsAlive
                        activeTab={activeSubsection}
                        onChange={(tab) => setActiveSubsection(tab)}
                        tabs={[
                            {
                                id: 'local',
                                label: 'Local',
                                content: <ComponentsPanel options={mathsPanelOptions} />
                            },
                            {
                                id: 'deployed',
                                label: 'Deployed',
                                content: (
                                    <MathsDeployedSection
                                        deployed={deployedComponents}
                                        versionLabel={selectedVersion
                                            ? `v${selectedVersion.version}${selectedVersion.name ? ` · ${selectedVersion.name}` : ''}`
                                            : null}
                                        isReady={Boolean(connected && selectedGame && selectedVersion)}
                                        error={statusError}
                                        // The row menu's remote actions — Simulate and
                                        // Compliance — both run on RGS, so the section needs
                                        // enough to name the caller and the Server Version.
                                        apiKey={settings?.apiKey}
                                        deploymentId={selectedVersion?.id}
                                        version={selectedVersion?.version}
                                        gameName={(games || []).find((g: any) => g.id === selectedGame)?.name}
                                    />
                                )
                            },
                            {
                                id: 'changed',
                                label: 'Changed',
                                content: (
                                    <MathsChangedSection
                                        status={mathsStatus}
                                        isReady={Boolean(connected && selectedGame && selectedVersion)}
                                        error={statusError}
                                    />
                                )
                            },
                            {
                                id: 'commits',
                                label: 'Commits',
                                content: (
                                    <MathsCommitsSection
                                        commits={commits}
                                        isLoading={commitsLoading}
                                        error={commitsError}
                                        apiKey={settings?.apiKey}
                                    />
                                )
                            }
                        ]}
                    />
                </div>

                {/* Deployed Functions — COMMENTED OUT, deliberately kept rather than deleted.
                    The edge functions of the selected Server Version, shown API-docs style
                    (mirrors the RGS studio "API docs" page), driven by the version clicked in
                    "Server Versions" above.

                    Withdrawn from the panel because the one action people came here for —
                    Simulate — now lives on the Deployed tab above, on each row's three-dot
                    menu. The rest of this list (API docs / rename / download / delete of a
                    deployed function) is still reachable in the RGS studio.

                    To bring it back, uncomment the JSX below. Everything it needs is still
                    live in this file: openComponentDoc, openComponentSimulate,
                    handleRenameComponent, handleDownloadComponent, handleDeleteComponent and
                    the rename / delete modals at the bottom.

                    NOTE for whoever restores or edits this: it is commented with a single
                    JSX comment, so the block must not contain the characters that would close
                    one. That is why the inner notes below are `//` line comments. */}
                {/*
                <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
                        <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#a0a0b0' }}>
                            Deployed Functions
                        </span>
                        {selectedVersion && (
                            <span style={{ fontSize: '10px', color: '#666', fontFamily: 'monospace' }}>
                                v{selectedVersion.version} · {selectedVersion.functions?.length || 0}
                            </span>
                        )}
                    </div>

                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 12px 12px' }}>
                        {!connected || !selectedGame ? (
                            <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>
                                Connect to XGENIA RGS and select a game to view its deployed components.
                            </div>
                        ) : versionsLoading ? (
                            <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>Loading&#8230;</div>
                        ) : !selectedVersion ? (
                            <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>
                                No deployed versions yet. Deploy a version to view its components&#8217; API docs.
                            </div>
                        ) : (selectedVersion.functions?.length || 0) === 0 ? (
                            <div style={{ fontSize: '11px', color: '#666', padding: '8px 0' }}>
                                This version has no components.
                            </div>
                        ) : (
                            // Names only. Clicking a name opens its API docs + script
                            // inspector in the editor's main area (not this sidebar);
                            // the three-dot menu on the right holds per-component actions.
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {[...selectedVersion.functions]
                                    .sort((a: any, b: any) => (a.function_slug || '').localeCompare(b.function_slug || ''))
                                    .map((fn: any) => (
                                        <div key={fn.id || fn.function_slug} style={COMPONENT_ROW_STYLE}>
                                            <button
                                                onClick={() => openComponentDoc(fn)}
                                                title="Open API docs & script inspector"
                                                style={COMPONENT_NAME_BTN_STYLE}
                                            >
                                                <span style={{
                                                    flex: 1, minWidth: 0,
                                                    fontSize: '12px', color: '#e0e0e0',
                                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
                                                }}>{fn.function_name || fn.function_slug}</span>
                                                <span style={{ flexShrink: 0, fontSize: '13px', color: '#67DE92', lineHeight: 1 }}>&#8250;</span>
                                            </button>

                                            {componentActionId === fn.id ? (
                                                <span style={{ fontSize: '10px', color: '#666' }}>Working&#8230;</span>
                                            ) : (
                                                <ContextMenu
                                                    size={IconSize.Tiny}
                                                    menuItems={[
                                                        {
                                                            label: 'Rename',
                                                            icon: IconName.Pencil,
                                                            onClick: () => {
                                                                setRenameFn(fn);
                                                                setRenameInput(fn.function_name || fn.function_slug || '');
                                                                setRenameError(null);
                                                            }
                                                        },
                                                        {
                                                            label: 'Simulate',
                                                            icon: IconName.Play,
                                                            onClick: () => openComponentSimulate(fn)
                                                        },
                                                        {
                                                            label: 'Download',
                                                            icon: IconName.CloudDownload,
                                                            onClick: () => handleDownloadComponent(fn)
                                                        },
                                                        'divider',
                                                        {
                                                            label: 'Delete',
                                                            icon: IconName.Trash,
                                                            isDangerous: true,
                                                            onClick: () => setConfirmDeleteFn(fn)
                                                        }
                                                    ]}
                                                />
                                            )}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
                */}

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
                            width: '520px', maxHeight: '85vh', overflowY: 'auto',
                            backgroundColor: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            padding: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>Test Configuration</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>Configure the simulation parameters for batch-spin execution.</div>
                        </div>

                        {/* ── Define Inputs ── */}
                        {simAvailablePorts && simAvailablePorts.inputPorts.length > 0 && (
                            <div style={{
                                marginBottom: '20px', padding: '16px',
                                backgroundColor: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderRadius: '8px',
                            }}>
                                <div style={{
                                    fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase' as const,
                                    letterSpacing: '0.5px', marginBottom: '12px', fontWeight: 600,
                                }}>Input Port Configuration</div>
                                {simAvailablePorts.inputPorts.map(port => {
                                    const isSignal = port.type === 'signal' || port.type === 'boolean';
                                    const cfg = simInputConfig[port.name] || {
                                        mode: isSignal ? 'trigger' : 'rng',
                                        value: 0, rngMin: 1, rngMax: 100,
                                    };
                                    return (
                                        <div key={port.name} style={{
                                            display: 'flex', alignItems: 'center', gap: '10px',
                                            padding: '10px 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                                        }}>
                                            {/* Port name & type */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
                                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#60A5FA' }} />
                                                <span style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{port.name}</span>
                                                <span style={{
                                                    fontSize: '10px', color: '#888', backgroundColor: 'rgba(255,255,255,0.08)',
                                                    padding: '1px 6px', borderRadius: '3px',
                                                }}>{port.type}</span>
                                            </div>
                                            {/* Mode + controls */}
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                                                <select
                                                    value={cfg.mode}
                                                    onChange={(e) => updateSimInputConfig(port.name, { mode: e.target.value as InputMode })}
                                                    style={{
                                                        padding: '5px 8px', backgroundColor: 'rgba(255,255,255,0.08)',
                                                        border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
                                                        color: '#fff', fontSize: '12px', outline: 'none',
                                                    }}
                                                >
                                                    {!isSignal && <option value="rng" style={{ color: '#000' }}>RNG Value</option>}
                                                    {!isSignal && <option value="fixed" style={{ color: '#000' }}>Fixed</option>}
                                                    <option value="trigger" style={{ color: '#000' }}>Always trigger / true</option>
                                                    <option value="off" style={{ color: '#000' }}>Off</option>
                                                </select>
                                                {cfg.mode === 'rng' && (
                                                    <>
                                                        <span style={{ fontSize: '10px', color: '#888' }}>Min</span>
                                                        <input type="number" value={cfg.rngMin ?? 1}
                                                            onChange={(e) => updateSimInputConfig(port.name, { rngMin: Number(e.target.value) || 0 })}
                                                            style={{
                                                                width: '60px', padding: '5px 6px', backgroundColor: 'rgba(255,255,255,0.08)',
                                                                border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
                                                                color: '#fff', fontSize: '12px', fontFamily: 'monospace', outline: 'none',
                                                            }}
                                                        />
                                                        <span style={{ fontSize: '10px', color: '#888' }}>Max</span>
                                                        <input type="number" value={cfg.rngMax ?? 100}
                                                            onChange={(e) => updateSimInputConfig(port.name, { rngMax: Number(e.target.value) || 0 })}
                                                            style={{
                                                                width: '60px', padding: '5px 6px', backgroundColor: 'rgba(255,255,255,0.08)',
                                                                border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
                                                                color: '#fff', fontSize: '12px', fontFamily: 'monospace', outline: 'none',
                                                            }}
                                                        />
                                                    </>
                                                )}
                                                {cfg.mode === 'fixed' && (
                                                    <input type="number" value={cfg.value}
                                                        onChange={(e) => updateSimInputConfig(port.name, { value: Number(e.target.value) || 0 })}
                                                        style={{
                                                            width: '80px', padding: '5px 6px', backgroundColor: 'rgba(255,255,255,0.08)',
                                                            border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
                                                            color: '#fff', fontSize: '12px', fontFamily: 'monospace', outline: 'none',
                                                        }}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* ── RTP Port Mapping ── */}
                        <div style={{
                            marginBottom: '20px', padding: '16px',
                            backgroundColor: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '8px',
                        }}>
                            <div style={{
                                fontSize: '11px', color: '#a0a0b0', textTransform: 'uppercase' as const,
                                letterSpacing: '0.5px', marginBottom: '4px', fontWeight: 600,
                            }}>RTP</div>
                            <div style={{ fontSize: '11px', color: '#666', marginBottom: '12px' }}>
                                Map which port carries the bet amount and which carries the win amount for RTP calculation.
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: '4px' }}>Bet Input</label>
                                    {simAvailablePorts ? (
                                        <select value={simBetPort} onChange={(e) => setSimBetPort(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                                fontSize: '13px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const,
                                            }}
                                        >
                                            <option value="" style={{ color: '#000' }}>— Select input port —</option>
                                            {simAvailablePorts.inputPorts.map(p => (
                                                <option key={p.name} value={p.name} style={{ color: '#000' }}>{p.name} ({p.type})</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input type="text" value={simBetPort} onChange={(e) => setSimBetPort(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                                fontSize: '13px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const,
                                            }}
                                        />
                                    )}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', fontSize: '10px', color: '#888', marginBottom: '4px' }}>Win Output</label>
                                    {simAvailablePorts ? (
                                        <select value={simWinPort} onChange={(e) => setSimWinPort(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                                fontSize: '13px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const,
                                            }}
                                        >
                                            <option value="" style={{ color: '#000' }}>— Select output port —</option>
                                            {simAvailablePorts.outputPorts.map(p => (
                                                <option key={p.name} value={p.name} style={{ color: '#000' }}>{p.name} ({p.type})</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <input type="text" value={simWinPort} onChange={(e) => setSimWinPort(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.06)',
                                                border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: '#fff',
                                                fontSize: '13px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' as const,
                                            }}
                                        />
                                    )}
                                </div>
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
                                min={1}
                                max={1000000}
                                value={simCount}
                                onChange={(e) => setSimCount(Math.max(1, Math.min(1000000, Number(e.target.value) || 1)))}
                                style={{
                                    width: '100%', padding: '10px 12px',
                                    backgroundColor: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px', color: '#fff',
                                    fontSize: '14px', fontFamily: 'monospace',
                                    outline: 'none', boxSizing: 'border-box' as const,
                                }}
                            />
                            <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                1 – 1,000,000 spins
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

                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Commit message</label>
                            <input
                                type="text"
                                placeholder="what changed, and why"
                                value={commitPrompt.message}
                                onChange={(e) => setCommitPrompt({ message: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && commitPrompt.message.trim() && !deployingComponents) {
                                        const message = commitPrompt.message.trim();
                                        setCommitPrompt(null);
                                        void handleDeployMathsComponents(message);
                                    }
                                }}
                                style={MODAL_INPUT_STYLE}
                                autoFocus
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setCommitPrompt(null)}
                                disabled={deployingComponents}
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
                                onClick={() => { setShowTestConfigModal(false); handleUploadMathsComponent(); }}
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

                        {/* Mode — whether real money moves through the game. The connected
                            key's own mode caps the choice: a demo key can only make demo
                            games, so it gets a single option rather than a rejected create. */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Mode</label>
                            <select
                                value={createForm.mode}
                                onChange={(e) => setCreateForm({ ...createForm, mode: e.target.value as GameMode })}
                                style={MODAL_INPUT_STYLE}
                            >
                                {GAME_MODES
                                    .filter((m) => gameModesForOperatorMode(operatorInfo?.mode).includes(m.value))
                                    .map((m) => (
                                        <option key={m.value} value={m.value} style={{ backgroundColor: '#1e1e2e' }}>
                                            {m.label}
                                        </option>
                                    ))}
                            </select>
                            <div style={{ fontSize: '11px', color: '#7a7a8a', marginTop: '6px' }}>
                                {GAME_MODES.find((m) => m.value === createForm.mode)?.blurb}
                                {operatorInfo?.mode === 'demo' && (
                                    <> Your operator key runs in Demo mode, so its games can only be Demo.</>
                                )}
                            </div>
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

            {/* ─── Delete Game modal ─── */}
            {deletePreview && !deletePreview.loading && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => { if (!deletingGame) { setDeletePreview(null); setDeleteGameError(null); } }}>
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
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                                {deletePreview.deletable ? 'Delete this game?' : 'This game cannot be deleted'}
                            </div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                {deletePreview.game?.name}
                                <span style={{ color: '#666', fontFamily: 'monospace' }}> · {deletePreview.game?.slug}</span>
                            </div>
                        </div>

                        {deletePreview.deletable ? (
                            <>
                                {/* What goes with it. */}
                                {(deletePreview.cascades?.length > 0 || deletePreview.active_components > 0) ? (
                                    <div style={{ marginBottom: '16px' }}>
                                        <label style={MODAL_LABEL_STYLE}>This also removes</label>
                                        <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#c8c8d0', lineHeight: 1.7 }}>
                                            {(deletePreview.cascades || []).map((c: any) => (
                                                <li key={c.table}>{c.text || `${c.count} ${c.label}`}</li>
                                            ))}
                                            {deletePreview.active_components > 0 && (
                                                <li style={{ color: '#E0B44A' }}>
                                                    {deletePreview.active_components} published component{' '}
                                                    {deletePreview.active_components === 1 ? 'endpoint' : 'endpoints'}
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '12px', color: '#c8c8d0', marginBottom: '16px' }}>
                                        Nothing has been built on this game yet — it will simply be removed.
                                    </div>
                                )}

                                {deletePreview.active_components > 0 && (
                                    <div style={{
                                        fontSize: '11px', color: '#E0B44A', marginBottom: '16px',
                                        padding: '8px 10px', borderRadius: '6px',
                                        backgroundColor: 'rgba(224,180,74,0.1)',
                                        border: '1px solid rgba(224,180,74,0.3)',
                                    }}>
                                        Those endpoints are live. Any deployed frontend calling them will start failing
                                        as soon as this game is deleted.
                                    </div>
                                )}

                                <div style={{ fontSize: '11px', color: '#666', marginBottom: '16px' }}>
                                    This cannot be undone.
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ marginBottom: '12px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Because it has</label>
                                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12px', color: '#c8c8d0', lineHeight: 1.7 }}>
                                        {(deletePreview.blockers || []).map((b: any) => (
                                            <li key={b.table}>{b.text || `${b.count} ${b.label}`}</li>
                                        ))}
                                    </ul>
                                </div>
                                <div style={{ fontSize: '11px', color: '#a0a0b0', marginBottom: '16px' }}>
                                    That record is permanent. To take the game out of circulation while keeping its
                                    history, set its status to “retired” in the RGS platform&apos;s Game Library.
                                </div>
                            </>
                        )}

                        {deleteGameError && (
                            <div style={{ fontSize: '11px', color: '#EF4444', marginBottom: '12px' }}>{deleteGameError}</div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => { setDeletePreview(null); setDeleteGameError(null); }}
                                disabled={deletingGame}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px', cursor: deletingGame ? 'not-allowed' : 'pointer',
                                }}
                            >{deletePreview.deletable ? 'Cancel' : 'Close'}</button>
                            {deletePreview.deletable && (
                                <button
                                    onClick={confirmDeleteGame}
                                    disabled={deletingGame}
                                    style={{
                                        padding: '8px 20px', borderRadius: '6px', border: 'none',
                                        backgroundColor: deletingGame ? '#444' : '#EF4444',
                                        color: deletingGame ? '#888' : '#fff',
                                        fontSize: '13px', fontWeight: 700,
                                        cursor: deletingGame ? 'not-allowed' : 'pointer',
                                    }}
                                >{deletingGame ? 'Deleting…' : 'Delete game'}</button>
                            )}
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
                                {/* Name + slug — as on the platform's form, the slug
                                    is derived from the name until the user edits it. */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Operator Name</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. Acme Casino"
                                        value={operatorForm.name}
                                        onChange={(e) => {
                                            setOperatorForm({
                                                ...operatorForm,
                                                name: e.target.value,
                                                slug: autoSlug(e.target.value),
                                            });
                                            setOperatorError(null);
                                        }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateOperator(); }}
                                        style={MODAL_INPUT_STYLE}
                                        autoFocus
                                    />
                                </div>

                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Slug</label>
                                    <input
                                        type="text"
                                        placeholder="acme-casino"
                                        value={operatorForm.slug}
                                        onChange={(e) => setOperatorForm({ ...operatorForm, slug: e.target.value })}
                                        style={MODAL_INPUT_STYLE}
                                    />
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>Used in API URLs.</div>
                                </div>

                                {/* Mode — Demo and Live only. Internal is superadmin
                                    over every game and is granted from the RGS
                                    platform alone. */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Mode</label>
                                    <select
                                        value={operatorForm.mode}
                                        onChange={(e) => setOperatorForm({ ...operatorForm, mode: e.target.value as OperatorMode })}
                                        style={{ ...MODAL_INPUT_STYLE, appearance: 'none', cursor: 'pointer' }}
                                    >
                                        {EDITOR_OPERATOR_MODES.map((m) => (
                                            <option key={m.value} value={m.value} style={{ background: '#1a1a2e' }}>{m.label}</option>
                                        ))}
                                    </select>
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                        {EDITOR_OPERATOR_MODES.find((m) => m.value === operatorForm.mode)?.blurb}
                                        {' '}Internal mode is created from the RGS platform only.
                                    </div>
                                </div>

                                {/* Contact email — the operator's registered address on
                                    the RGS platform. It is the ONE address compliance
                                    documents are delivered to: a game's Compliance
                                    section can generate a Gaming Licence Application
                                    Pack for a deployed component and email it, and that
                                    Send button is disabled for an operator with no
                                    address. Optional, so trying the editor out does not
                                    require one. */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Contact Email</label>
                                    <input
                                        type="email"
                                        placeholder="compliance@acme-casino.com"
                                        value={operatorForm.contact_email}
                                        onChange={(e) => { setOperatorForm({ ...operatorForm, contact_email: e.target.value }); setOperatorError(null); }}
                                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateOperator(); }}
                                        style={MODAL_INPUT_STYLE}
                                    />
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                        Where the RGS platform sends compliance and certification documents for this
                                        operator's games. Can be added later from the platform's Operators section.
                                    </div>
                                </div>

                                {/* Wallet — the funding behind this operator's games. */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>
                                        Wallet Balance ({operatorForm.currencies.split(',')[0]?.trim() || 'EUR'})
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        placeholder="1000000.00"
                                        value={operatorForm.wallet_balance}
                                        onChange={(e) => { setOperatorForm({ ...operatorForm, wallet_balance: e.target.value }); setOperatorError(null); }}
                                        style={MODAL_INPUT_STYLE}
                                    />
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                        Funding for the games this operator owns. Player losses credit it; player wins are paid out of it.
                                    </div>
                                </div>

                                {/* Currencies + bet limits */}
                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>Supported Currencies</label>
                                    <input
                                        type="text"
                                        placeholder="EUR, USD, GBP"
                                        value={operatorForm.currencies}
                                        onChange={(e) => setOperatorForm({ ...operatorForm, currencies: e.target.value })}
                                        style={MODAL_INPUT_STYLE}
                                    />
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>Comma-separated ISO codes.</div>
                                </div>

                                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={MODAL_LABEL_STYLE}>Max Bet (cents)</label>
                                        <input
                                            type="number"
                                            placeholder="100000"
                                            value={operatorForm.max_bet}
                                            onChange={(e) => setOperatorForm({ ...operatorForm, max_bet: e.target.value })}
                                            style={MODAL_INPUT_STYLE}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={MODAL_LABEL_STYLE}>Max Win (cents)</label>
                                        <input
                                            type="number"
                                            placeholder="5000000"
                                            value={operatorForm.max_win}
                                            onChange={(e) => setOperatorForm({ ...operatorForm, max_win: e.target.value })}
                                            style={MODAL_INPUT_STYLE}
                                        />
                                    </div>
                                </div>

                                <div style={{ marginBottom: '16px' }}>
                                    <label style={MODAL_LABEL_STYLE}>IP Whitelist</label>
                                    <input
                                        type="text"
                                        placeholder="1.2.3.4, 5.6.7.8"
                                        value={operatorForm.allowed_ips}
                                        onChange={(e) => setOperatorForm({ ...operatorForm, allowed_ips: e.target.value })}
                                        style={MODAL_INPUT_STYLE}
                                    />
                                    <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                                        Comma-separated. Leave blank to allow all IPs.
                                    </div>
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

            {/* ─── Rename Server Version modal ─── */}
            {renameVersion && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => { if (versionActionId !== renameVersion.id) setRenameVersion(null); }}>
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
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>Rename v{renameVersion.version}</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Renames the label shown in this list. The version number, its components and their
                                function URLs are unchanged, so deployed frontends are unaffected.
                            </div>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Version Name</label>
                            <input
                                type="text"
                                placeholder={`v${renameVersion.version}`}
                                value={versionNameInput}
                                onChange={(e) => { setVersionNameInput(e.target.value); setVersionRenameError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameVersion(); }}
                                style={MODAL_INPUT_STYLE}
                                autoFocus
                            />
                        </div>

                        {versionRenameError && (
                            <div style={{ fontSize: '11px', color: '#EF4444', marginBottom: '12px' }}>{versionRenameError}</div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setRenameVersion(null)}
                                disabled={versionActionId === renameVersion.id}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px',
                                    cursor: versionActionId === renameVersion.id ? 'not-allowed' : 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={handleRenameVersion}
                                disabled={versionActionId === renameVersion.id || !versionNameInput.trim()}
                                style={{
                                    padding: '8px 20px', borderRadius: '6px', border: 'none',
                                    backgroundColor: versionActionId === renameVersion.id || !versionNameInput.trim() ? '#444' : '#67DE92',
                                    color: versionActionId === renameVersion.id || !versionNameInput.trim() ? '#888' : '#1a1a2e',
                                    fontSize: '13px', fontWeight: 700,
                                    cursor: versionActionId === renameVersion.id || !versionNameInput.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >{versionActionId === renameVersion.id ? 'Renaming…' : 'Rename'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Deploy = commit: message prompt ───────────────────────
                A commit with no message is a row in the history that says nothing, so
                the message is required rather than defaulted. The list above it is the
                exact set that will be pushed — including the deletions that will NOT
                be, so nobody presses Deploy expecting an endpoint to come down. */}
            {commitPrompt && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => { if (!deployingComponents) setCommitPrompt(null); }}>
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            width: '460px',
                            backgroundColor: '#1e1e2e',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '12px',
                            padding: '24px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                                Deploy to v{selectedVersion?.version}
                            </div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Compiles and deploys the changed components, then records a commit so this
                                version of each one stays readable after the next deploy overwrites it.
                            </div>
                            {removalCount > 0 && (
                                <div style={{ fontSize: '12px', color: '#EF4444', marginTop: '8px' }}>
                                    {removalCount === 1 ? 'One component' : `${removalCount} components`} will be
                                    REMOVED from RGS — every version, so the endpoint stops answering. Anything
                                    already published that calls {removalCount === 1 ? 'it' : 'them'} will start
                                    failing. The commit keeps a copy, so this can be put back by deploying again.
                                </div>
                            )}
                        </div>

                        <div style={{ marginBottom: '16px', maxHeight: '160px', overflowY: 'auto' }}>
                            {mathsStatus.changed.map((c) => (
                                <div key={c.slug} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    fontSize: '12px', padding: '3px 0',
                                    color: c.kind === 'deleted' ? '#666' : '#d0d0d8'
                                }}>
                                    <span style={{
                                        fontFamily: 'monospace', fontWeight: 700, width: '12px',
                                        color: c.kind === 'added' ? '#67DE92' : c.kind === 'deleted' ? '#EF4444' : '#E5A83B'
                                    }}>
                                        {c.kind === 'added' ? 'A' : c.kind === 'deleted' ? 'D' : 'M'}
                                    </span>
                                    <span style={{ textDecoration: c.kind === 'deleted' ? 'line-through' : 'none' }}>
                                        {c.displayName}
                                    </span>
                                    {c.kind === 'deleted' && (
                                        <span style={{ fontSize: '10px', color: '#EF4444' }}>
                                            — will be removed from RGS
                                        </span>
                                    )}
                                </div>
                            ))}
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Commit message</label>
                            <input
                                type="text"
                                placeholder="what changed, and why"
                                value={commitPrompt.message}
                                onChange={(e) => setCommitPrompt({ message: e.target.value })}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && commitPrompt.message.trim() && !deployingComponents) {
                                        const message = commitPrompt.message.trim();
                                        setCommitPrompt(null);
                                        void handleDeployMathsComponents(message);
                                    }
                                }}
                                style={MODAL_INPUT_STYLE}
                                autoFocus
                            />
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setCommitPrompt(null)}
                                disabled={deployingComponents}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px',
                                    cursor: deployingComponents ? 'not-allowed' : 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={() => {
                                    const message = commitPrompt.message.trim();
                                    if (!message) return;
                                    setCommitPrompt(null);
                                    void handleDeployMathsComponents(message);
                                }}
                                disabled={deployingComponents || !commitPrompt.message.trim()}
                                style={{
                                    padding: '8px 20px', borderRadius: '6px', border: 'none',
                                    backgroundColor: deployingComponents || !commitPrompt.message.trim() ? '#444' : '#67DE92',
                                    color: deployingComponents || !commitPrompt.message.trim() ? '#888' : '#1a1a2e',
                                    fontSize: '13px', fontWeight: 700,
                                    cursor: deployingComponents || !commitPrompt.message.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >{`Deploy ${deployableCount} change${deployableCount === 1 ? '' : 's'}`}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Rename Component modal (Components three-dot menu) ─── */}
            {renameFn && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => { if (componentActionId !== renameFn.id) setRenameFn(null); }}>
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
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>Rename Component</div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Display name only — <span style={{ fontFamily: 'monospace' }}>{renameFn.function_slug}</span> and its
                                function URL stay the same, so anything already calling this component keeps working.
                            </div>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={MODAL_LABEL_STYLE}>Component Name</label>
                            <input
                                type="text"
                                placeholder={renameFn.function_slug}
                                value={renameInput}
                                onChange={(e) => { setRenameInput(e.target.value); setRenameError(null); }}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameComponent(); }}
                                style={MODAL_INPUT_STYLE}
                                autoFocus
                            />
                        </div>

                        {renameError && (
                            <div style={{ fontSize: '11px', color: '#EF4444', marginBottom: '12px' }}>{renameError}</div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setRenameFn(null)}
                                disabled={componentActionId === renameFn.id}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px',
                                    cursor: componentActionId === renameFn.id ? 'not-allowed' : 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={handleRenameComponent}
                                disabled={componentActionId === renameFn.id || !renameInput.trim()}
                                style={{
                                    padding: '8px 20px', borderRadius: '6px', border: 'none',
                                    backgroundColor: componentActionId === renameFn.id || !renameInput.trim() ? '#444' : '#67DE92',
                                    color: componentActionId === renameFn.id || !renameInput.trim() ? '#888' : '#1a1a2e',
                                    fontSize: '13px', fontWeight: 700,
                                    cursor: componentActionId === renameFn.id || !renameInput.trim() ? 'not-allowed' : 'pointer',
                                }}
                            >{componentActionId === renameFn.id ? 'Renaming…' : 'Rename'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Delete Component confirmation (Components three-dot menu) ─── */}
            {confirmDeleteFn && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: 'rgba(0,0,0,0.6)',
                }} onClick={() => setConfirmDeleteFn(null)}>
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
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                                Delete “{confirmDeleteFn.function_name || confirmDeleteFn.function_slug}”?
                            </div>
                            <div style={{ fontSize: '12px', color: '#888' }}>
                                Removes this component from v{selectedVersion?.version} only — the version's other
                                components are left alone. This cannot be undone.
                            </div>
                        </div>

                        {/* rgs-fn serves the newest active copy of a (game, slug) across ALL
                            versions, so say what deleting this one actually does to players. */}
                        {selectedVersion && isLiveComponent(versions, selectedVersion.id, confirmDeleteFn.function_slug) && (
                            <div style={{ fontSize: '11px', color: '#E0B44A', marginBottom: '16px' }}>
                                This is the copy the live endpoint currently serves. Deleting it promotes an older
                                version's copy — or takes the endpoint offline if this was the only one.
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                            <button
                                onClick={() => setConfirmDeleteFn(null)}
                                style={{
                                    padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid rgba(255,255,255,0.12)', backgroundColor: 'transparent',
                                    color: '#a0a0b0', fontSize: '13px', cursor: 'pointer',
                                }}
                            >Cancel</button>
                            <button
                                onClick={() => handleDeleteComponent(confirmDeleteFn)}
                                style={{
                                    padding: '8px 20px', borderRadius: '6px', border: 'none',
                                    backgroundColor: '#EF4444', color: '#fff',
                                    fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                                }}
                            >Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </BasePanel>
    );
}