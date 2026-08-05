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

import { EditorDocumentProvider } from '../EditorDocument';
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
     * before that card existed, and on any whose author skipped the choice;
     * those fall back to the first-numeric-port guess.
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

// ─── Port model (mirrors the studio Testing page) ────────────
type PortType = 'number' | 'boolean' | 'string' | 'object' | 'array';

interface PortInfo {
    name: string;
    type: PortType;
    /** The raw example value — seeds the fixed (JSON) default for complex ports. */
    example?: any;
}

// number → rng | fixed ; boolean → random | true | false ; string → random | fixed
// object / array → fixed (JSON valueStr)
type InputMode = 'rng' | 'fixed' | 'random' | 'true' | 'false';

interface InputConfig {
    mode: InputMode;
    value: number;
    valueStr: string;
    rngMin: number;
    rngMax: number;
}

function portTypeOf(v: unknown): PortType {
    if (Array.isArray(v)) return 'array';
    const t = typeof v;
    if (t === 'number') return 'number';
    if (t === 'boolean') return 'boolean';
    if (t === 'object' && v !== null) return 'object';
    return 'string';
}

// Arrays and records can't be RNG-sampled or used as the bet/win port — they're
// passed through the simulation as a fixed (JSON) value.
function isComplexType(t: PortType): boolean {
    return t === 'object' || t === 'array';
}

function safeJsonStringify(v: any): string {
    try {
        return JSON.stringify(v);
    } catch {
        return '';
    }
}

function parseJsonOr(raw: string, fallback: any): any {
    if (!raw || !raw.trim()) return fallback;
    try {
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function portsFromExample(example: any): PortInfo[] {
    if (!example || typeof example !== 'object') return [];
    return Object.entries(example).map(([name, v]) => ({ name, type: portTypeOf(v), example: v }));
}

function defaultConfigFor(type: PortType, example?: any): InputConfig {
    return {
        mode: type === 'number' ? 'rng' : type === 'boolean' ? 'random' : type === 'string' ? 'random' : 'fixed',
        value: 0,
        valueStr: isComplexType(type) && example !== undefined ? safeJsonStringify(example) : '',
        rngMin: 1,
        rngMax: 100
    };
}

// ─── Styles ─────────────────────────────────────────────────
const SECTION_STYLE: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' };
const SECTION_TITLE_STYLE: React.CSSProperties = { fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#a0a0b0', marginBottom: '10px' };
const HINT_STYLE: React.CSSProperties = { fontSize: '11px', color: '#7a7a8a', lineHeight: 1.5 };
const FIELD_LABEL_STYLE: React.CSSProperties = { display: 'block', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#8a8a9a', marginBottom: '4px' };
const CONTROL_STYLE: React.CSSProperties = { padding: '6px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '5px', color: '#e0e0e0', fontSize: '12px', outline: 'none' };
// The window's own gray (same var as the scrolling content area below). A <select>
// needs an OPAQUE background: the native dropdown popup is drawn on the platform's
// white popup surface, so the translucent rgba(255,255,255,0.06) the other controls
// use composited to near-white there and made the #e0e0e0 option text unreadable.
// Set on the options too — the popup rows take their colour from the option, not the
// select, on some platforms.
const SELECT_SURFACE = 'var(--theme-color-bg-3, #16161f)';
const SELECT_STYLE: React.CSSProperties = { ...CONTROL_STYLE, background: SELECT_SURFACE };
const OPTION_STYLE: React.CSSProperties = { background: SELECT_SURFACE, color: '#e0e0e0' };
const INPUT_STYLE: React.CSSProperties = { ...CONTROL_STYLE, fontFamily: 'monospace' };
const PORT_ROW_STYLE: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px 10px', marginBottom: '6px' };
const TYPE_CHIP_STYLE: React.CSSProperties = { flexShrink: 0, fontSize: '9px', fontFamily: 'monospace', padding: '2px 5px', borderRadius: '3px', background: 'rgba(255,255,255,0.06)', color: '#8a8a9a' };
const STAT_TILE_STYLE: React.CSSProperties = { flex: 1, minWidth: '140px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', padding: '12px', textAlign: 'center' };

/** One-line recap of what a port feeds the simulation. */
function describeInputConfig(port: PortInfo, config: InputConfig): string {
    if (port.type === 'number') {
        return config.mode === 'fixed'
            ? `fixed ${config.valueStr !== '' ? config.valueStr : config.value}`
            : `RNG ${Math.floor(config.rngMin)} – ${Math.floor(config.rngMax)}`;
    }
    if (port.type === 'boolean') {
        if (config.mode === 'true') return 'always true';
        if (config.mode === 'false') return 'always false';
        return 'random 50/50';
    }
    if (isComplexType(port.type)) {
        const raw = config.valueStr?.trim();
        if (!raw) return port.type === 'array' ? 'fixed []' : 'fixed {}';
        return `fixed ${raw.length > 24 ? `${raw.slice(0, 24)}…` : raw}`;
    }
    return config.mode === 'fixed' ? `fixed "${config.valueStr}"` : 'random name';
}

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

    // Default the bet/win mapping to whatever the component was deployed with —
    // the author said so in the editor's post-compile setup card, and that beats
    // guessing. Falls back to the first numeric port when the stored name is
    // missing or no longer matches a numeric port (a later publish can rename or
    // retype one).
    useEffect(() => {
        const storedBet = fn.bet_input_port;
        const storedWin = fn.win_output_port;
        setBetInputPort((storedBet && numericInputs.some((p) => p.name === storedBet) ? storedBet : numericInputs[0]?.name) || '');
        setWinOutputPort((storedWin && numericOutputs.some((p) => p.name === storedWin) ? storedWin : numericOutputs[0]?.name) || '');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fn.function_slug]);

    const updateInputConfig = (portName: string, type: PortType, field: Partial<InputConfig>) => {
        setInputConfig((prev) => ({
            ...prev,
            [portName]: { ...(prev[portName] || defaultConfigFor(type)), ...field }
        }));
    };

    const canRun = !notConnected && !running && !!betInputPort && !!winOutputPort;

    const handleRunSimulations = async () => {
        if (notConnected || running) return;
        cancelRef.current = false;
        setRunning(true);
        setRunError(null);
        setSimResult(null);
        setProgress({ rounds: 0, totalRounds: Math.max(1, Math.min(simCount, MAX_SIMULATION_ROUNDS)) });
        try {
            const inputOverrides: Record<string, any> = {};
            const rngPorts: Record<string, { min: number; max: number }> = {};
            const boolRngPorts: string[] = [];
            const strRngPorts: string[] = [];

            for (const port of inputPorts) {
                const cfg = inputConfig[port.name] || defaultConfigFor(port.type, port.example);
                if (port.type === 'number') {
                    if (cfg.mode === 'fixed') inputOverrides[port.name] = cfg.value;
                    else rngPorts[port.name] = { min: cfg.rngMin ?? 1, max: cfg.rngMax ?? 100 };
                } else if (port.type === 'boolean') {
                    if (cfg.mode === 'true') inputOverrides[port.name] = true;
                    else if (cfg.mode === 'false') inputOverrides[port.name] = false;
                    else boolRngPorts.push(port.name);
                } else if (isComplexType(port.type)) {
                    inputOverrides[port.name] = parseJsonOr(cfg.valueStr, port.type === 'array' ? [] : {});
                } else {
                    if (cfg.mode === 'fixed') inputOverrides[port.name] = cfg.valueStr ?? '';
                    else strRngPorts.push(port.name);
                }
            }

            const numRounds = Math.max(1, Math.min(simCount, MAX_SIMULATION_ROUNDS));
            const res = await simulateDeployedComponent({
                apiKey: apiKey as string,
                deploymentId: deploymentId as string,
                functionSlug: fn.function_slug,
                totalRounds: numRounds,
                betAmount: 1, // fallback; the bet port governs the actual stake
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
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', backgroundColor: 'var(--theme-color-bg-3, #16161f)', padding: '16px 20px' }}>
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
                                    Every round feeds these values to the component. RNG ports are redrawn each round.
                                </div>
                                {inputPorts.map((port) => {
                                    const config = inputConfig[port.name] || defaultConfigFor(port.type, port.example);
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
                                                        onChange={(e) => updateInputConfig(port.name, port.type, { mode: e.target.value as InputMode })}
                                                    >
                                                        <option style={OPTION_STYLE} value="rng">RNG Value</option>
                                                        <option style={OPTION_STYLE} value="fixed">Fixed Value</option>
                                                    </select>
                                                    {config.mode === 'fixed' ? (
                                                        <input
                                                            type="number"
                                                            style={{ ...INPUT_STYLE, width: '96px' }}
                                                            placeholder="0"
                                                            value={config.valueStr || (config.value === 0 ? '' : String(config.value))}
                                                            onChange={(e) => {
                                                                const raw = e.target.value;
                                                                const num = raw === '' || raw === '-' ? 0 : Number(raw);
                                                                updateInputConfig(port.name, port.type, { value: num, valueStr: raw });
                                                            }}
                                                        />
                                                    ) : (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                                            <span style={{ fontSize: '10px', color: '#8a8a9a' }}>Min</span>
                                                            <input
                                                                type="number"
                                                                style={{ ...INPUT_STYLE, width: '72px' }}
                                                                value={config.rngMin}
                                                                onChange={(e) => updateInputConfig(port.name, port.type, { rngMin: Math.floor(Number(e.target.value) || 0) })}
                                                            />
                                                            <span style={{ fontSize: '10px', color: '#8a8a9a' }}>Max</span>
                                                            <input
                                                                type="number"
                                                                style={{ ...INPUT_STYLE, width: '72px' }}
                                                                value={config.rngMax}
                                                                onChange={(e) => updateInputConfig(port.name, port.type, { rngMax: Math.floor(Number(e.target.value) || 0) })}
                                                            />
                                                        </span>
                                                    )}
                                                </>
                                            )}

                                            {port.type === 'boolean' && (
                                                <select
                                                    style={{ ...SELECT_STYLE, minWidth: '130px' }}
                                                    value={config.mode}
                                                    onChange={(e) => updateInputConfig(port.name, port.type, { mode: e.target.value as InputMode })}
                                                >
                                                    <option style={OPTION_STYLE} value="random">Random (50/50)</option>
                                                    <option style={OPTION_STYLE} value="true">Always true</option>
                                                    <option style={OPTION_STYLE} value="false">Always false</option>
                                                </select>
                                            )}

                                            {port.type === 'string' && (
                                                <>
                                                    <select
                                                        style={{ ...SELECT_STYLE, minWidth: '110px' }}
                                                        value={config.mode}
                                                        onChange={(e) => updateInputConfig(port.name, port.type, { mode: e.target.value as InputMode })}
                                                    >
                                                        <option style={OPTION_STYLE} value="random">Random Name</option>
                                                        <option style={OPTION_STYLE} value="fixed">Fixed Value</option>
                                                    </select>
                                                    {config.mode === 'fixed' && (
                                                        <input
                                                            type="text"
                                                            style={{ ...INPUT_STYLE, width: '160px' }}
                                                            placeholder="value"
                                                            value={config.valueStr}
                                                            onChange={(e) => updateInputConfig(port.name, port.type, { valueStr: e.target.value })}
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
                                                        onChange={(e) => updateInputConfig(port.name, port.type, { valueStr: e.target.value })}
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
                                    onChange={(e) => setBetInputPort(e.target.value)}
                                >
                                    <option style={OPTION_STYLE} value="">— Select input port —</option>
                                    {numericInputs.map((p) => (
                                        <option style={OPTION_STYLE} key={p.name} value={p.name}>{p.name} ({p.type})</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '10px', color: '#7a7a8a', marginTop: '4px' }}>
                                    Each round is staked at this port&#39;s value from Define Inputs.
                                </div>
                            </div>
                            <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={FIELD_LABEL_STYLE}>Win Output</label>
                                <select
                                    style={{ ...SELECT_STYLE, width: '100%' }}
                                    value={winOutputPort}
                                    onChange={(e) => setWinOutputPort(e.target.value)}
                                >
                                    <option style={OPTION_STYLE} value="">— Select output port —</option>
                                    {numericOutputs.map((p) => (
                                        <option style={OPTION_STYLE} key={p.name} value={p.name}>{p.name} ({p.type})</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* What the run will actually use — the Define Inputs config, resolved. */}
                        {inputPorts.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                                {inputPorts.map((port) => {
                                    const config = inputConfig[port.name] || defaultConfigFor(port.type, port.example);
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
                        {(!betInputPort || !winOutputPort) && !notConnected && (
                            <div style={{ fontSize: '11px', color: '#F5A623', marginTop: '8px' }}>
                                Select a numeric Bet input and Win output to run.
                            </div>
                        )}
                        {runError && (
                            <div style={{ fontSize: '11px', color: '#EF4444', marginTop: '8px' }}>{runError}</div>
                        )}
                    </div>

                    {/* ═══ 3. SIMULATION RESULTS ═══ */}
                    {simResult && (
                        <div style={SECTION_STYLE}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                                <div style={SECTION_TITLE_STYLE}>Simulation Results</div>
                                <div style={{ fontSize: '10px', color: '#7a7a8a', fontFamily: 'monospace' }}>
                                    {simResult.stats.rounds.toLocaleString()} rounds · {simResult.stats.roundsPerSecond.toLocaleString()} rounds/s on RGS
                                </div>
                            </div>

                            {/* A stopped run is still a real measurement — of however many rounds it
                                got through. Say so, so nobody reads a short sample as the full one. */}
                            {simResult.cancelled && (
                                <div style={{ fontSize: '11px', color: '#F5A623', marginBottom: '10px' }}>
                                    Stopped early — these figures cover the {simResult.stats.rounds.toLocaleString()} rounds that ran.
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
                                    <div style={{ fontSize: '10px', color: '#7a7a8a' }}>non-zero wins ÷ rounds</div>
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
