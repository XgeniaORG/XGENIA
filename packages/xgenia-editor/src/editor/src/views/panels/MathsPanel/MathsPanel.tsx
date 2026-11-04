// The Maths panel: where a game's maths is authored, and a read-only view of what
// XGENIA RGS is serving.
//
// Releasing is not done here. Publish → XGENIA signs the studio in, picks or
// creates the game, deploys whatever maths changed, publishes and verifies RTP
// (DeployPopup/ReleaseSetup, utils/publish/deployChangedMaths). The AI drives the
// same modules through the EditorBridge `xrgs.*` / `publish.*` commands and the
// `window.__xrgs` bridge defined below. The panel's old manual route (paste a key,
// pick a game, create Server Versions, Deploy with a commit message, the
// maths_configs Test / Maths Versions lifecycle, the Changed and Commits views)
// duplicated that and is gone; hand-authored maths_configs are managed in the
// XRGS back office.
import React, { useState, useEffect, useCallback, useRef } from 'react';

import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Tabs, TabsVariant } from '@xgenia-core-ui/components/layout/Tabs';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { computeMathsStatus, DeployedComponent, readDeployedComponents } from '@xgenia-utils/rgs/mathsComponentStatus';
import { MATHS_DEPLOYED_ELSEWHERE, setMathsDeployState } from '@xgenia-utils/rgs/mathsDeployState';
import { newestServerVersion, ServerVersionRef } from '@xgenia-utils/publish/deployChangedMaths';
import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';
import { ComponentsPanel } from '../componentspanel';
import { useShowAllTools } from '../../Rail/useShowAllTools';
import { MathsDeployedSection } from './subsections/MathsDeployedSection';

// Shared XGENIA RGS settings live in utils/rgs/rgsClient (the key, the per-project
// game). Panel-local helpers (getRgsExtra / mergeRgsSettings) for the shared
// `xgenia_rgs_settings` localStorage key (read/written by the AI via __xrgs) are
// kept below — rgsClient does not provide them.
import {
    rgsFunctionsUrl,
    getRgsSettings,
    setActiveGame,
    getActiveGame,
    SelectedGame
} from '@xgenia-utils/rgs/rgsClient';

// ─── Shared RGS test config (game + settings) ───────────────
// One localStorage key (`xgenia_rgs_settings`) is the single source of truth, read/written by
// the __xrgs bridge below and the AI (which reaches it via EditorBridge `xrgs.*` → EditorProxy.xrgs).
// `activeGame` = the "set project" to test against; `testSettings` = declared RTP / volatility / etc.
function getRgsExtra(): { activeGame?: any; testSettings?: any } {
    try {
        const p = JSON.parse(localStorage.getItem('xgenia_rgs_settings') || '{}');
        // The selected game is per project (rgsClient getActiveGame), never the last project's.
        return { activeGame: getActiveGame(), testSettings: p.testSettings };
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
    getUrl: () => rgsFunctionsUrl(),

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
            const compiler = require('@xgenia-utils/liveEngine').loadRgsCompiler();
            const { CloudFunctionConverter } = compiler.mod;

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
                // The component open in the node graph editor wins, so a test or
                // deploy compiles the maths you are actually editing.
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
                // Which compiler built this script: the live engine's, or the app's own.
                compiler: {
                    source: compiler.source,
                    version: compiler.version,
                    // Set when the live engine's compiler could not be used and the app's own compiled this.
                    ...(compiler.fallbackReason ? { warning: compiler.fallbackReason } : {}),
                },
            };
        } catch (e: any) {
            console.error('[__xrgs] generateRgsScript error:', e);
            return { error: e.message || 'Failed to generate RGS script' };
        }
    },

    // ─── Persisted test config (shared with the AI via the bridge) ───
    /** The game ("project") to test maths against: { id, slug, name, status } or null. */
    getActiveGame: () => getRgsExtra().activeGame || null,
    // Through rgsClient, not mergeRgsSettings: it also emits `rgs.gameSelected`,
    // which is how the always-mounted Publish popup learns the game changed.
    setActiveGame: (game: any) => { setActiveGame(game || null); return true; },
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
// the `evaluate(ctx)` script that Publish deploys to the RGS.
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
    // that here would say nothing; naming it Local says which of the two it is.
    componentTitle: 'Local Components'
};
// The simple rail has no Local/Deployed tabs, so "Local" contrasts with nothing; the rail calls components Parts.
const simpleMathsPanelOptions = { ...mathsPanelOptions, componentTitle: 'Maths parts' };

export function MathsPanel() {
    const showAllTools = useShowAllTools();

    // Who is signed in and which game this project releases as. Both are chosen in
    // Publish (ReleaseSetup) or by the AI, never here; the panel follows them.
    const [apiKey, setApiKey] = useState<string | null>(() => getRgsSettings()?.apiKey || null);
    const [game, setGame] = useState<SelectedGame | null>(() => getActiveGame());

    // What is deployed: the game's newest Server Version — the one Publish deploys
    // into (deployChangedMaths) — and its components as the platform holds them.
    const [target, setTarget] = useState<ServerVersionRef | null>(null);
    const [deployedComponents, setDeployedComponents] = useState<DeployedComponent[]>([]);
    const [statusError, setStatusError] = useState<string | null>(null);
    const [activeSubsection, setActiveSubsection] = useState('local');

    // Signing in, signing out (clearRgsSettings emits `rgs.gameSelected`), choosing
    // a game and opening another project (the game is per project) all change what
    // this panel describes.
    useEffect(() => {
        const group = {};
        EventDispatcher.instance.on(
            ['rgs.connected', 'rgs.gameSelected', 'ProjectModel.instanceHasChanged'],
            () => {
                setApiKey(getRgsSettings()?.apiKey || null);
                setGame(getActiveGame());
            },
            group
        );
        return () => { EventDispatcher.instance.off(group); };
    }, []);

    // One read of the platform feeds the Deployed tab AND the badges on the Local
    // tree. A newer read supersedes an older one still in flight, so switching game
    // can never leave the previous game's components on screen.
    const readSeq = useRef(0);
    const refreshDeployed = useCallback(async () => {
        const seq = ++readSeq.current;
        if (!apiKey || !game?.id) {
            setTarget(null);
            setDeployedComponents([]);
            setStatusError(null);
            return;
        }
        try {
            const newest = await newestServerVersion(apiKey, game.id);
            const deployed = newest ? await readDeployedComponents(apiKey, newest.deploymentId) : [];
            if (seq !== readSeq.current) return;
            setTarget(newest);
            setDeployedComponents(deployed);
            setStatusError(null);
        } catch (e: any) {
            if (seq !== readSeq.current) return;
            setTarget(null);
            setDeployedComponents([]);
            setStatusError(e?.message || 'Could not read what is deployed');
        }
    }, [apiKey, game?.id]);

    useEffect(() => { void refreshDeployed(); }, [refreshDeployed]);

    // The platform can change from another editor or the RGS studio. Re-read when
    // the Deployed tab is opened — one request when you go looking, not a poll.
    useEffect(() => {
        if (activeSubsection === 'deployed') void refreshDeployed();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeSubsection]);

    // Publish and the AI's `publish.start` deploy maths and say so with this event.
    useEffect(() => {
        const group = {};
        EventDispatcher.instance.on(MATHS_DEPLOYED_ELSEWHERE, () => { void refreshDeployed(); }, group);
        return () => { EventDispatcher.instance.off(group); };
    }, [refreshDeployed]);

    /**
     * Badge the Local tree: live, changed since deploy, or never deployed.
     *
     * Local-only, so it is cheap enough to run on every project save — edit a
     * component's graph and its badge changes without anyone pressing refresh. The
     * tree is the legacy ComponentsPanel view and cannot be handed React state, so
     * the result goes to the shared deploy-state store it reads.
     */
    const recompareMaths = useCallback(() => {
        const project = ProjectModel.instance;
        setMathsDeployState(project && target ? computeMathsStatus(project, deployedComponents) : null);
    }, [deployedComponents, target]);

    useEffect(() => { recompareMaths(); }, [recompareMaths]);

    // `projectSavedToDisk` is the signal the Version Control panel diffs on — saves
    // are debounced, so this fires once after a burst of edits.
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

    // Nothing else owns the store, so clear it when the panel goes away rather than
    // leaving the tree badging rows against a game that is no longer selected.
    useEffect(() => () => setMathsDeployState(null), []);

    const versionLabel = target ? `v${target.version}${target.name ? ` · ${target.name}` : ''}` : null;

    return (
        <BasePanel title="Maths" isFill>
            <Container direction={ContainerDirection.Vertical} isFill>
                {/* What the maths is for and who changes it, and the one way to release. */}
                <div data-guide="maths-intro" style={{ flexShrink: 0, padding: '14px 14px 12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8ec', marginBottom: '6px' }}>
                        What each round pays
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#a0a0b0', marginBottom: '10px' }}>
                        The maths decides how often a round wins and how much it pays. Ask the AI to
                        change it, for example &ldquo;make small wins more often&rdquo;. It tests the
                        numbers before it changes anything.
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            // Required lazily: the sidebar model imports the panels.
                            // 'chat-panel' is only the open-source shell's id — the
                            // shipping (iframe) build registers the chat as 'ChatPanel' —
                            // so resolve it through the `showsAiActivity` flag.
                            const { SidebarModel } = require('@xgenia-models/sidebar');
                            const chatId = SidebarModel.instance.getAiActivityPanelId();
                            if (chatId) SidebarModel.instance.switch(chatId);
                        }}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: 0,
                            background: 'var(--theme-color-publish, #67DE92)',
                            color: '#000',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        Ask the AI
                    </button>
                    {/* The release path for everyone: Publish signs you in, creates the game, deploys
                        the maths, publishes, and verifies RTP — no panel tools needed. */}
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8ec', margin: '16px 0 6px' }}>
                        Release your game
                    </div>
                    <div style={{ fontSize: '12px', lineHeight: 1.5, color: '#a0a0b0', marginBottom: '10px' }}>
                        Publish signs you in to XGENIA RGS, creates the game, deploys this maths and gives you a
                        playable link. RTP verification and the pre-certification pack for a test lab are there too.
                    </div>
                    <button
                        type="button"
                        onClick={() => EventDispatcher.instance.emit('publish.open')}
                        style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid rgba(103, 222, 146, 0.5)',
                            background: 'transparent',
                            color: 'var(--theme-color-publish, #67DE92)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer'
                        }}
                    >
                        Open Publish
                    </button>
                </div>

                {/* Maths Components, split by WHERE a component lives:

                      Local    — the project's `/#__maths__/` tree, and the only place
                        components are authored: create, Folder, rename, duplicate, delete.
                        Every component in it is its own component at any depth — a child or
                        grandchild has its own graph, compiles on its own and deploys to its
                        own endpoint. Dragging one drops the LOCAL component, whose maths
                        runs in the browser. Rows are badged with how they stand against the
                        platform.

                      Deployed — a read-only mirror of what RGS is serving for this game.
                        Dragging one drops a BACKEND component, an Aggregator on its live
                        endpoint. Its three-dot menu holds Simulate, which runs the rounds on
                        the platform against the row rgs-fn serves. Behind "Show all tools":
                        nobody needs it to release a game. */}
                <div style={{ flex: '1.5 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    {!showAllTools ? (
                        <ComponentsPanel options={simpleMathsPanelOptions} />
                    ) : (
                    <Tabs
                        variant={TabsVariant.Sidebar}
                        // The tree is a legacy view with its own DOM and scroll state;
                        // remounting it on every tab switch would lose the open folders and
                        // the selection.
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
                                        versionLabel={versionLabel}
                                        isReady={Boolean(apiKey && game?.id)}
                                        error={statusError}
                                        apiKey={apiKey || undefined}
                                        deploymentId={target?.deploymentId}
                                        version={target?.version}
                                        gameName={game?.name}
                                    />
                                )
                            }
                        ]}
                    />
                    )}
                </div>
            </Container>
        </BasePanel>
    );
}
