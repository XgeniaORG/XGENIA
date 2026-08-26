import React, { useEffect, useMemo, useRef, useState } from 'react';

import { AppRegistry, IDocumentProvider } from '@xgenia-models/app_registry';

import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { PrimaryButton, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';
import { Label } from '@xgenia-core-ui/components/typography/Label';

import {
    MAX_SIMULATION_ROUNDS,
    simulateDeployedComponent,
    type ComponentSimulationStats,
    type SimulationSeriesPoint
} from '@xgenia-utils/rgs/simulateComponent';
import {
    buildSimulationInputs,
    defaultConfigFor,
    describeInputConfig,
    inferBetInputPort,
    inferWinOutputPort,
    isComplexType,
    portsFromExample,
    seedStakeIfZero,
    type InputConfig,
    type InputMode,
    type PortInfo
} from '@xgenia-utils/rgs/simulationPorts';

import { EditorDocumentProvider } from '../EditorDocument';
import {
    DOCUMENT_BODY_STYLE,
    FIELD_LABEL_STYLE,
    HINT_STYLE,
    INPUT_STYLE,
    OPTION_STYLE,
    PORT_ROW_STYLE,
    SECTION_STYLE,
    SECTION_TITLE_STYLE,
    SELECT_STYLE,
    STAT_TILE_STYLE,
    TYPE_CHIP_STYLE
} from '../mathsDocumentStyles';
import { SimulationCharts } from './SimulationCharts';

/**
 * Simulate a DEPLOYED component's maths, on the RGS platform.
 *
 * Mirrors a game's Testing subsection in the RGS studio (Define Inputs →
 * Simulate → Simulation Results → convergence charts) so a maths author doesn't
 * have to leave the editor to see an RTP.
 *
 * The rounds do NOT run here. This view configures the run and renders what
 * comes back; the platform compiles the component's stored script through the
 * same sandbox `rgs-fn` uses and does the counting. That is deliberate — the
 * editor previously simulated a locally compiled copy, which could report an RTP
 * for maths no player would ever hit. It is also why there is only one way in:
 * the Deployed tab of the Maths RGS panel. An undeployed component has nothing
 * on the platform to measure, so Simulate is not offered for one.
 *
 * A run of any size arrives in chunks (an edge isolate is CPU-killed near 2s),
 * which is why there is a progress line and a Stop button — see
 * @xgenia-utils/rgs/simulateComponent.
 *
 * Opens in the editor's main area, beside the sidebar, and scrolls as one column.
 */

// The component being simulated — every field comes from the Server Version's
// component list (download-edge-deployment / list-edge-deployments).
export interface MathsSimulateDoc {
    function_slug: string;
    function_name: string;
    payload_example?: Record<string, any>;
    response_example?: Record<string, any>;
    /**
     * The bet / win mapping this component was DEPLOYED with — chosen in the
     * post-compile setup card at publish time. Null on components deployed
     * before that card existed, and on any whose author skipped the choice —
     * which is most of them, so see simulationPorts for what happens then.
     */
    bet_input_port?: string | null;
    win_output_port?: string | null;
}

interface MathsSimulateDocumentProps {
    /** Operator key. Required — the rounds run on the platform. */
    apiKey?: string;
    /** The Server Version holding this component; also what scopes the run to a game you own. */
    deploymentId?: string;
    version?: number;
    gameName?: string;
    fn: MathsSimulateDoc;
}

// The port model, the input defaults and the bet/win inference all live in
// @xgenia-utils/rgs/simulationPorts, which mirrors the RGS studio's own copy —
// this view and the studio's Testing tab configure the same run against the same
// platform runner, so they cannot be allowed to disagree about what a port means.

// ─── Styles ─────────────────────────────────────────────────
// Shared with the Compliance document — see mathsDocumentStyles.

// ─── Topbar (title + Exit) ──────────────────────────────────
function MathsSimulateTopbar({ title }: { title: string }) {
    return (
        <div style={{ height: '36px', flexShrink: 0, backgroundColor: 'var(--theme-color-bg-2)', borderBottom: '2px solid var(--theme-color-bg-1)', display: 'flex', alignItems: 'center' }}>
            <Label hasLeftSpacing>{title}</Label>
            <div style={{ marginLeft: 'auto', paddingRight: '8px' }}>
                <PrimaryButton
                    icon={IconName.Close}
                    label="Exit"
                    variant={PrimaryButtonVariant.MutedOnLowBg}
                    onClick={() => AppRegistry.instance.openDocument(EditorDocumentProvider.ID)}
                />
            </div>
        </div>
    );
}

function MathsSimulateDocument({
    apiKey,
    deploymentId,
    version,
    gameName,
    fn
}: MathsSimulateDocumentProps) {
    const [inputConfig, setInputConfig] = useState<Record<string, InputConfig>>({});
    const [betInputPort, setBetInputPort] = useState('');
    const [winOutputPort, setWinOutputPort] = useState('');
    /** Stake per round when no input port carries the bet. */
    const [flatStake, setFlatStake] = useState(1);
    const [simCount, setSimCount] = useState(10_000);
    const [running, setRunning] = useState(false);
    const [runError, setRunError] = useState<string | null>(null);
    const [progress, setProgress] = useState<{ rounds: number; totalRounds: number } | null>(null);
    const [simResult, setSimResult] = useState<{
        stats: ComponentSimulationStats;
        series: SimulationSeriesPoint[];
        cancelled: boolean;
    } | null>(null);

    // Read inside the chunk loop, so pressing Stop takes effect at the next chunk
    // boundary rather than at the next React render. A ref, not state, for the
    // same reason: the running loop closed over its own copy of state.
    const cancelRef = useRef(false);

    // Nothing to configure without these — the platform is where the rounds run.
    const notConnected = !apiKey || !deploymentId;

    const inputPorts = useMemo(() => portsFromExample(fn.payload_example), [fn.payload_example]);
    const outputPorts = useMemo(() => portsFromExample(fn.response_example), [fn.response_example]);
    const numericInputs = inputPorts.filter((p) => p.type === 'number');
    const numericOutputs = outputPorts.filter((p) => p.type === 'number');

    // The script is never fetched. It stays on the platform and is compiled there
    // for every chunk — this view only ever sees the component's port examples
    // (which the Server Version listing already carries) and the resulting figures.

    // Seed the input configuration and the bet/win mapping for this component.
    //
    // Every port starts at the value the component was DEPLOYED with. It used to
    // start at noise — numbers on a 1–100 draw, booleans on a coin flip — which
    // on a component declaring ~150 UI toggles (`isDoubleBet`, `isDoClear`,
    // `isToStartAutoBet`) meant every round fired a fistful of contradictory
    // interface events at the maths.
    //
    // The bet/win mapping still prefers whatever the component was deployed with
    // — the author said so in the post-compile setup card, and that beats
    // guessing — but the fallback is now a port actually NAMED like a stake or a
    // win, not whichever happens to sort first. See simulationPorts for why that
    // matters on the real library.
    useEffect(() => {
        const bet = inferBetInputPort(numericInputs, fn.bet_input_port);
        const win = inferWinOutputPort(numericOutputs, fn.win_output_port);

        let seeded: Record<string, InputConfig> = {};
        for (const port of inputPorts) seeded[port.name] = defaultConfigFor(port.type, port.example);
        seeded = seedStakeIfZero(seeded, bet, inputPorts);

        setInputConfig(seeded);
        setBetInputPort(bet);
        setWinOutputPort(win);
        setSimResult(null);
        setRunError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fn.function_slug]);

    const updateInputConfig = (port: PortInfo, field: Partial<InputConfig>) => {
        setInputConfig((prev) => ({
            ...prev,
            [port.name]: { ...(prev[port.name] || defaultConfigFor(port.type, port.example)), ...field }
        }));
    };

    const handleBetPortChange = (name: string) => {
        setBetInputPort(name);
        setInputConfig((prev) => seedStakeIfZero(prev, name, inputPorts));
    };

    const configFor = (port: PortInfo): InputConfig =>
        inputConfig[port.name] || defaultConfigFor(port.type, port.example);

    // No longer gated on picking a Win Output: for a component whose response
    // ports are UI elements there is no correct port to pick, and the right
    // answer — the win evaluate() itself returns, which is what rgs-fn pays — is
    // what an empty mapping means.
    const canRun = !notConnected && !running;

    const handleRunSimulations = async () => {
        if (notConnected || running) return;
        cancelRef.current = false;
        setRunning(true);
        setRunError(null);
        setSimResult(null);
        setProgress({ rounds: 0, totalRounds: Math.max(1, Math.min(simCount, MAX_SIMULATION_ROUNDS)) });
        try {
            const { inputOverrides, rngPorts, boolRngPorts, strRngPorts } = buildSimulationInputs(
                inputPorts,
                inputConfig
            );

            const numRounds = Math.max(1, Math.min(simCount, MAX_SIMULATION_ROUNDS));
            const res = await simulateDeployedComponent({
                apiKey: apiKey as string,
                deploymentId: deploymentId as string,
                functionSlug: fn.function_slug,
                totalRounds: numRounds,
                // Used on rounds where the bet port supplies no number — and on
                // every round when no bet port is mapped at all.
                betAmount: Math.max(1, flatStake) || 1,
                inputOverrides,
                rngPorts,
                boolRngPorts,
                strRngPorts,
                betInputPort: betInputPort || null,
                winOutputPort: winOutputPort || null,
                onProgress: (p) => setProgress({ rounds: p.rounds, totalRounds: p.totalRounds }),
                shouldCancel: () => cancelRef.current
            });
            setSimResult({ stats: res.stats, series: res.series, cancelled: res.cancelled });
        } catch (e: any) {
            setRunError(e?.message || 'Simulation failed');
        } finally {
            cancelRef.current = false;
            setRunning(false);
            setProgress(null);
        }
    };

    // "<game> · v3 · <component> · Simulate" — the Server Version is part of the
    // identity here, because that is the copy being measured.
    const titleParts = [
        gameName,
        version != null ? `v${version}` : null,
        fn.function_name,
        'Simulate'
    ].filter(Boolean);

    return (
        <Container direction={ContainerDirection.Vertical} isFill>
            <MathsSimulateTopbar title={titleParts.join(' · ')} />

            {/* One scrolling column — inputs, controls, results and charts, in that order. */}
            <div style={DOCUMENT_BODY_STYLE}>
                <div style={{ maxWidth: '920px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 600, color: '#f0f0f0' }}>{fn.function_name}</span>
                        <code style={TYPE_CHIP_STYLE}>{fn.function_slug}</code>
                        <span style={{ fontSize: '11px', color: '#7a7a8a' }}>runs on XGENIA RGS</span>
                        {notConnected && (
                            <span style={{ fontSize: '11px', color: '#EF4444' }}>
                                Not connected to XGENIA RGS — open this from the Deployed tab of the Maths RGS panel.
                            </span>
                        )}
                    </div>

                    {/* ═══ 1. DEFINE INPUTS ═══ */}
                    <div style={SECTION_STYLE}>
                        <div style={SECTION_TITLE_STYLE}>Define Inputs</div>
                        {inputPorts.length === 0 ? (
                            <div style={{ ...HINT_STYLE, fontStyle: 'italic' }}>This component has no request inputs.</div>
                        ) : (
                            <>
                                <div style={{ ...HINT_STYLE, marginBottom: '10px' }}>
                                    Every round feeds these values to the component. Defaults are the values this
                                    component was deployed with; switch a port to RNG or Random to sweep it.
                                </div>
                                {inputPorts.map((port) => {
                                    const config = configFor(port);
                                    return (
                                        <div key={port.name} style={PORT_ROW_STYLE}>
                                            <span style={{ flexShrink: 0, width: '8px', height: '8px', borderRadius: '50%', background: '#4FD1C5' }} />
                                            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0', minWidth: '90px' }}>{port.name}</span>
                                            <code style={TYPE_CHIP_STYLE}>{port.type}</code>
                                            <span style={{ flex: 1 }} />

                                            {port.type === 'number' && (
                                                <>
                                                    <select
                                                        style={{ ...SELECT_STYLE, minWidth: '110px' }}
                                                        value={config.mode}
                                                        onChange={(e) => updateInputConfig(port, { mode: e.target.value as InputMode })}
                                                    >
                                                        <option style={OPTION_STYLE} value="fixed">Fixed Value</option>
                                                        <option style={OPTION_STYLE} value="rng">RNG Value</option>
                                                    </select>
                                                    {config.mode === 'fixed' ? (
                                                        <input
                                                            type="number"
                                                            style={{ ...INPUT_STYLE, width: '96px' }}
                                                            placeholder="0"
                                                            value={config.valueStr}
                                                            onChange={(e) => {
                                                                const raw = e.target.value;
                                                                const num = raw === '' || raw === '-' ? 0 : Number(raw);
                                                                updateInputConfig(port, { value: Number.isFinite(num) ? num : 0, valueStr: raw });
                                                            }}
                                                        />
                                                    ) : (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                            <span style={{ fontSize: '10px', color: '#8a8a9a' }}>Min</span>
                                                            <input
                                                                type="number"
                                                                style={{ ...INPUT_STYLE, width: '72px' }}
                                                                value={config.rngMin}
                                                                onChange={(e) => updateInputConfig(port, { rngMin: Math.floor(Number(e.target.value) || 0) })}
                                                            />
                                                            <span style={{ fontSize: '10px', color: '#8a8a9a' }}>Max</span>
                                                            <input
                                                                type="number"
                                                                style={{ ...INPUT_STYLE, width: '72px' }}
                                                                value={config.rngMax}
                                                                onChange={(e) => updateInputConfig(port, { rngMax: Math.floor(Number(e.target.value) || 0) })}
                                                            />
                                                        </span>
                                                    )}
                                                </>
                                            )}

                                            {port.type === 'boolean' && (
                                                <select
                                                    style={{ ...SELECT_STYLE, minWidth: '130px' }}
                                                    value={config.mode}
                                                    onChange={(e) => updateInputConfig(port, { mode: e.target.value as InputMode })}
                                                >
                                                    <option style={OPTION_STYLE} value="false">Always false</option>
                                                    <option style={OPTION_STYLE} value="true">Always true</option>
                                                    <option style={OPTION_STYLE} value="random">Random (50/50)</option>
                                                </select>
                                            )}

                                            {port.type === 'string' && (
                                                <>
                                                    <select
                                                        style={{ ...SELECT_STYLE, minWidth: '110px' }}
                                                        value={config.mode}
                                                        onChange={(e) => updateInputConfig(port, { mode: e.target.value as InputMode })}
                                                    >
                                                        <option style={OPTION_STYLE} value="fixed">Fixed Value</option>
                                                        <option style={OPTION_STYLE} value="random">Random Name</option>
                                                    </select>
                                                    {config.mode !== 'random' && (
                                                        <input
                                                            type="text"
                                                            style={{ ...INPUT_STYLE, width: '160px' }}
                                                            placeholder="value"
                                                            value={config.valueStr}
                                                            onChange={(e) => updateInputConfig(port, { valueStr: e.target.value })}
                                                        />
                                                    )}
                                                </>
                                            )}

                                            {isComplexType(port.type) && (
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: '180px' }}>
                                                    <span style={{ fontSize: '10px', color: '#8a8a9a', whiteSpace: 'nowrap' }}>Fixed (JSON)</span>
                                                    <input
                                                        type="text"
                                                        style={{ ...INPUT_STYLE, flex: 1, minWidth: '140px' }}
                                                        placeholder={port.type === 'array' ? '[]' : '{}'}
                                                        value={config.valueStr}
                                                        onChange={(e) => updateInputConfig(port, { valueStr: e.target.value })}
                                                    />
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>

                    {/* ═══ 2. SIMULATE ═══ */}
                    <div style={SECTION_STYLE}>
                        <div style={SECTION_TITLE_STYLE}>Simulate</div>
                        <div style={{ ...HINT_STYLE, marginBottom: '12px' }}>
                            Choose which input carries the bet and which output carries the win. RTP = total win ÷ total bet.
                        </div>

                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '12px' }}>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={FIELD_LABEL_STYLE}>Bet Input</label>
                                <select
                                    style={{ ...SELECT_STYLE, width: '100%' }}
                                    value={betInputPort}
                                    onChange={(e) => handleBetPortChange(e.target.value)}
                                    disabled={running}
                                >
                                    <option style={OPTION_STYLE} value="">— Flat stake (no input port) —</option>
                                    {numericInputs.map((p) => (
                                        <option style={OPTION_STYLE} key={p.name} value={p.name}>{p.name} ({p.type})</option>
                                    ))}
                                </select>
                                {betInputPort ? (
                                    <div style={{ fontSize: '10px', color: '#7a7a8a', marginTop: '4px' }}>
                                        Each round is staked at this port&#39;s value from Define Inputs.
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                                        <span style={{ fontSize: '10px', color: '#8a8a9a', whiteSpace: 'nowrap' }}>Stake per round</span>
                                        <input
                                            type="number"
                                            min={1}
                                            style={{ ...INPUT_STYLE, width: '96px' }}
                                            value={flatStake}
                                            onChange={(e) => setFlatStake(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                                            disabled={running}
                                        />
                                    </div>
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={FIELD_LABEL_STYLE}>Win Output</label>
                                <select
                                    style={{ ...SELECT_STYLE, width: '100%' }}
                                    value={winOutputPort}
                                    onChange={(e) => setWinOutputPort(e.target.value)}
                                    disabled={running}
                                >
                                    {/* An empty mapping is a correct, working answer, not a
                                        missing one: the platform then reads the win evaluate()
                                        itself returns, which is the figure rgs-fn pays the
                                        player. For a component whose response ports are UI
                                        elements there is nothing else to pick. */}
                                    <option style={OPTION_STYLE} value="">— Use the win the script returns —</option>
                                    {numericOutputs.map((p) => (
                                        <option style={OPTION_STYLE} key={p.name} value={p.name}>{p.name} ({p.type})</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '10px', color: '#7a7a8a', marginTop: '4px' }}>
                                    {winOutputPort
                                        ? "Each round's win is read from this port."
                                        : 'The value evaluate() returns — the same figure rgs-fn pays the player.'}
                                </div>
                            </div>
                        </div>

                        {/* What the run will actually use — the Define Inputs config, resolved. */}
                        {inputPorts.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                                {inputPorts.map((port) => {
                                    const config = configFor(port);
                                    const isBet = port.name === betInputPort;
                                    return (
                                        <span
                                            key={port.name}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                fontSize: '10px', padding: '3px 7px', borderRadius: '4px',
                                                background: 'rgba(0,0,0,0.25)',
                                                border: `1px solid ${isBet ? 'rgba(103,222,146,0.4)' : 'rgba(255,255,255,0.08)'}`
                                            }}
                                        >
                                            <span style={{ fontFamily: 'monospace', color: '#d0d0d8' }}>{port.name}</span>
                                            <span style={{ color: '#8a8a9a' }}>{describeInputConfig(port, config)}</span>
                                            {isBet && <span style={{ color: '#67DE92', fontWeight: 700, letterSpacing: '0.5px' }}>BET</span>}
                                        </span>
                                    );
                                })}
                            </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', flexWrap: 'wrap', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                            <div>
                                <label style={FIELD_LABEL_STYLE}>Simulation Count</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={MAX_SIMULATION_ROUNDS}
                                    style={{ ...INPUT_STYLE, width: '160px' }}
                                    value={simCount}
                                    onChange={(e) => setSimCount(Math.max(1, Math.min(MAX_SIMULATION_ROUNDS, Number(e.target.value) || 1)))}
                                    disabled={running}
                                />
                                <div style={{ fontSize: '10px', color: '#7a7a8a', marginTop: '4px' }}>
                                    {/* The ceiling is the platform's, not this field's: the rounds run on
                                        RGS in chunks, and a long run is many calls rather than one long one. */}
                                    1 – {MAX_SIMULATION_ROUNDS.toLocaleString()}
                                    {simCount > 1_000_000 ? ' · a run this size takes several minutes of RGS time' : ''}
                                </div>
                            </div>
                            <span style={{ flex: 1 }} />
                            {running && (
                                <PrimaryButton
                                    label="Stop"
                                    icon={IconName.Close}
                                    variant={PrimaryButtonVariant.MutedOnLowBg}
                                    // Takes effect at the next chunk boundary — the chunk in flight
                                    // finishes, and its rounds are kept rather than thrown away.
                                    onClick={() => { cancelRef.current = true; }}
                                />
                            )}
                            <PrimaryButton
                                label={running ? 'Running…' : 'Run Simulations'}
                                icon={IconName.Play}
                                variant={PrimaryButtonVariant.Cta}
                                isDisabled={!canRun}
                                isLoading={running}
                                onClick={handleRunSimulations}
                            />
                        </div>
                        {progress && (
                            <div style={{ marginTop: '10px' }}>
                                <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.min(100, (progress.rounds / Math.max(1, progress.totalRounds)) * 100)}%`,
                                        background: '#67DE92',
                                        transition: 'width 120ms linear'
                                    }} />
                                </div>
                                <div style={{ fontSize: '10px', color: '#7a7a8a', marginTop: '4px', fontFamily: 'monospace' }}>
                                    {progress.rounds.toLocaleString()} / {progress.totalRounds.toLocaleString()} rounds on RGS
                                </div>
                            </div>
                        )}
                        {/* The platform names the construct and the line when a script trips a
                            sandbox rule — 43 of the 125 deployed components do — so give the
                            message room to be read rather than clipping it to one line. */}
                        {runError && (
                            <div
                                style={{
                                    marginTop: '10px',
                                    padding: '10px 12px',
                                    borderRadius: '6px',
                                    background: 'rgba(239,68,68,0.08)',
                                    border: '1px solid rgba(239,68,68,0.35)'
                                }}
                            >
                                <div style={{ fontSize: '11px', fontWeight: 600, color: '#EF4444', marginBottom: '4px' }}>
                                    Simulation failed
                                </div>
                                <div style={{ fontSize: '11px', color: '#e0a0a0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>
                                    {runError}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ═══ 3. SIMULATION RESULTS ═══ */}
                    {simResult && (
                        <div style={SECTION_STYLE}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={SECTION_TITLE_STYLE}>Simulation Results</div>
                                <div style={{ fontSize: '10px', color: '#7a7a8a', fontFamily: 'monospace' }}>
                                    {simResult.stats.rounds.toLocaleString()} rounds
                                    {simResult.stats.roundsEvaluated > simResult.stats.rounds
                                        ? ` · ${simResult.stats.roundsEvaluated.toLocaleString()} evaluated`
                                        : ''}
                                    {' '}· {simResult.stats.roundsPerSecond.toLocaleString()} rounds/s on RGS
                                </div>
                            </div>

                            {/* A stopped run is still a real measurement — of however many rounds it
                                got through. Say so, so nobody reads a short sample as the full one. */}
                            {simResult.cancelled && (
                                <div style={{ fontSize: '11px', color: '#F5A623', marginBottom: '10px' }}>
                                    Stopped early — these figures cover the {simResult.stats.rounds.toLocaleString()} rounds that ran.
                                </div>
                            )}

                            {/* A feature the platform had to break out of is a defect in the
                                component, not in the run — and every figure below was measured
                                against a bonus that never ends, so it needs saying. */}
                            {simResult.stats.featureCapHits > 0 && (
                                <div style={{ fontSize: '11px', color: '#F5A623', marginBottom: '10px', lineHeight: 1.5 }}>
                                    {simResult.stats.featureCapHits.toLocaleString()} feature
                                    {simResult.stats.featureCapHits === 1 ? ' was' : 's were'} cut short at 500 free rounds —
                                    this component never clears <code style={TYPE_CHIP_STYLE}>state.in_feature</code>, so its
                                    bonus does not end on its own.
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                <div style={STAT_TILE_STYLE}>
                                    <div style={{ fontSize: '11px', color: '#8a8a9a' }}>Average RTP</div>
                                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#67DE92' }}>{(simResult.stats.rtp * 100).toFixed(2)}%</div>
                                    <div style={{ fontSize: '10px', color: '#7a7a8a' }}>house edge {simResult.stats.houseEdge}</div>
                                </div>
                                <div style={STAT_TILE_STYLE}>
                                    <div style={{ fontSize: '11px', color: '#8a8a9a' }}>Hit Frequency</div>
                                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#f0f0f5' }}>{simResult.stats.hitRate.toFixed(2)}%</div>
                                    {/* Paid rounds, counted WITH the free rounds they bought — a
                                        stake that pays out through its bonus is one hit, not ten.
                                        Scoring each free round separately is what used to put this
                                        figure above 100%. */}
                                    <div style={{ fontSize: '10px', color: '#7a7a8a' }}>paid rounds that returned a win</div>
                                </div>
                                <div style={STAT_TILE_STYLE}>
                                    <div style={{ fontSize: '11px', color: '#8a8a9a' }}>Volatility</div>
                                    <div style={{ fontSize: '22px', fontWeight: 700, color: '#f0f0f5' }}>{simResult.stats.volatility.toFixed(2)}</div>
                                    <div style={{ fontSize: '10px', color: '#7a7a8a', textTransform: 'capitalize' }}>{simResult.stats.volatilityClass}</div>
                                </div>
                            </div>

                            {/* Supporting figures — the three headline stats derive from these. */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                {[
                                    ['Total bet', Math.round(simResult.stats.totalBet).toLocaleString()],
                                    ['Total win', Math.round(simResult.stats.totalWin).toLocaleString()],
                                    ['Max multiplier', `${simResult.stats.maxMultiplier.toFixed(2)}×`],
                                    // Derived, not betAmount: on an RNG bet port the stake varies per round.
                                    ['Avg bet / round', (simResult.stats.totalBet / Math.max(1, simResult.stats.rounds)).toFixed(2)]
                                ].map(([label, value]) => (
                                    <div key={label}>
                                        <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#7a7a8a' }}>{label}</div>
                                        <div style={{ fontSize: '13px', fontFamily: 'monospace', color: '#e0e0e0' }}>{value}</div>
                                    </div>
                                ))}
                            </div>

                            {/* Only when the component actually has a feature — on the current
                                library nothing sets in_feature, and four empty tiles would read
                                as a broken measurement rather than an absent bonus. */}
                            {simResult.stats.bonusTriggers > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '18px', marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                    {[
                                        ['Bonus frequency', simResult.stats.bonusFrequency],
                                        ['Free rounds played', simResult.stats.bonusRoundsPlayed.toLocaleString()],
                                        ['Bonus RTP', `${(simResult.stats.bonusRtp * 100).toFixed(2)}%`],
                                        ['Avg bonus win', simResult.stats.avgBonusWin.toLocaleString()]
                                    ].map(([label, value]) => (
                                        <div key={label}>
                                            <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#7a7a8a' }}>{label}</div>
                                            <div style={{ fontSize: '13px', fontFamily: 'monospace', color: '#e0e0e0' }}>{value}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ═══ 4. CONVERGENCE CHARTS (RTP → hit frequency → volatility) ═══ */}
                    {simResult && <SimulationCharts series={simResult.series} />}
                </div>
            </div>
        </Container>
    );
}

export class MathsSimulateDocumentProvider implements IDocumentProvider {
    public static ID = 'MathsSimulateDocumentProvider';

    getComponent() {
        return MathsSimulateDocument;
    }
}
