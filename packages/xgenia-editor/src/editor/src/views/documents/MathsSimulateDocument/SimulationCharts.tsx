import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { SimulationSeriesPoint } from '@xgenia-utils/rgs/simulationEngine';

/**
 * RTP / Hit Frequency / Volatility convergence charts for the Simulate view.
 *
 * Hand-drawn SVG rather than a charting library: the editor has no chart
 * dependency, and these are three single-series curves — the whole job is one
 * path, an axis and a hover readout.
 *
 * All three wear the same accent. They're small multiples of ONE run, so colour
 * carries no identity here (each chart holds a single series named by its own
 * title); varying the hue per card would imply a distinction that doesn't exist.
 * #67DE92 is the editor's accent green and clears 3:1 contrast on the document
 * background.
 *
 * The plotted values are already cumulative running averages (see
 * SimulationSeriesPoint), so the curves are smooth by construction; the
 * Catmull-Rom pass below only rounds off the sampling steps.
 */
const ACCENT = '#67DE92';
const GRID = 'rgba(255,255,255,0.07)';
const AXIS_TEXT = '#7a7a8a';

const CHART_HEIGHT = 190;
const PAD_LEFT = 56;
const PAD_RIGHT = 18;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

type MetricKey = 'rtp' | 'hitRate' | 'volatility';

interface MetricSpec {
    key: MetricKey;
    label: string;
    caption: string;
    /** Appended to axis ticks, the hover readout and the headline figure. */
    unit: string;
    decimals: number;
}

// Order is the order they render, top to bottom.
const METRICS: MetricSpec[] = [
    { key: 'rtp', label: 'RTP', caption: 'Running total win ÷ total bet as rounds accumulate', unit: '%', decimals: 2 },
    { key: 'hitRate', label: 'Hit Frequency', caption: 'Running share of rounds that paid a non-zero win', unit: '%', decimals: 2 },
    { key: 'volatility', label: 'Volatility', caption: 'Running standard deviation of the per-round win ÷ bet ratio', unit: '', decimals: 2 }
];

const CARD_STYLE: React.CSSProperties = {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '8px',
    padding: '14px 16px',
    marginBottom: '12px'
};

function formatRounds(value: number): string {
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
    return String(value);
}

/**
 * Pad the y-range around the data instead of anchoring at 0: a run that settles
 * between 95.8% and 96.4% RTP is a flat line on a 0–100 axis, and the whole point
 * of these charts is to show that settling.
 */
function rangeFor(values: number[]): [number, number] {
    if (values.length === 0) return [0, 1];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (hi === lo) {
        const pad = Math.max(Math.abs(hi) * 0.1, 0.5);
        return [Math.max(0, lo - pad), hi + pad];
    }
    const pad = (hi - lo) * 0.15;
    return [Math.max(0, lo - pad), hi + pad];
}

/** Catmull-Rom through every point, emitted as cubic Béziers. */
function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return '';
    if (pts.length < 3) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join('');
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        d += `C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
    }
    return d;
}

/** Decimals needed to print `step` exactly (capped at 3). */
function decimalsFor(step: number): number {
    for (let d = 0; d < 3; d++) {
        if (Math.abs(step - Number(step.toFixed(d))) < 1e-9) return d;
    }
    return 3;
}

/**
 * Nice-rounded y gridline values spanning [lo, hi].
 *
 * Picks the smallest nice step that yields 3–6 gridlines: settling curves live in
 * a narrow band, and a step chosen from the span alone often leaves only one or
 * two lines on the plot. Labels carry the decimals the step needs — a 0.25 step
 * printed to one decimal would show 17.75 as "17.8" against a gridline that
 * isn't there.
 */
function yTicks(lo: number, hi: number): { value: number; decimals: number }[] {
    const span = hi - lo;
    if (span <= 0) return [{ value: lo, decimals: 2 }];
    const mag = Math.pow(10, Math.floor(Math.log10(span / 4)));
    const candidates = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20].map((m) => m * mag);
    const countFor = (s: number) => Math.floor((hi - Math.ceil(lo / s) * s) / s) + 1;
    const step =
        candidates.find((s) => countFor(s) >= 3 && countFor(s) <= 6) ??
        candidates.find((s) => countFor(s) <= 6) ??
        span;
    const decimals = decimalsFor(step);
    const ticks: { value: number; decimals: number }[] = [];
    for (let t = Math.ceil(lo / step) * step; t <= hi + step * 0.001; t += step) {
        ticks.push({ value: Number(t.toFixed(decimals + 2)), decimals });
    }
    return ticks;
}

function MetricChart({ metric, series }: { metric: MetricSpec; series: SimulationSeriesPoint[] }) {
    // Real pixel width, so the curve and its stroke are never distorted by a
    // stretched viewBox.
    const wrapRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(680);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver((entries) => {
            const next = entries[0]?.contentRect.width;
            if (next && next > 0) setWidth(Math.max(280, next));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const gradientId = `sim-chart-${metric.key}`;
    const values = series.map((p) => p[metric.key]);
    const final = values.length > 0 ? values[values.length - 1] : 0;

    const geom = useMemo(() => {
        const [lo, hi] = rangeFor(values);
        const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
        const plotH = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
        const firstRound = series[0]?.round ?? 0;
        const lastRound = series[series.length - 1]?.round ?? 1;
        const roundSpan = Math.max(1, lastRound - firstRound);
        const xOf = (round: number) => PAD_LEFT + ((round - firstRound) / roundSpan) * plotW;
        const yOf = (v: number) => PAD_TOP + plotH - ((v - lo) / Math.max(1e-9, hi - lo)) * plotH;
        const pts = series.map((p) => ({ x: xOf(p.round), y: yOf(p[metric.key]) }));
        const line = smoothPath(pts);
        const area = line ? `${line}L${pts[pts.length - 1].x},${PAD_TOP + plotH}L${pts[0].x},${PAD_TOP + plotH}Z` : '';
        // Six x labels at most, taken from the data so they sit on real points.
        const labelCount = Math.min(6, series.length);
        const step = series.length > 1 ? (series.length - 1) / Math.max(1, labelCount - 1) : 0;
        const xLabels = Array.from({ length: labelCount }, (_, i) => {
            const idx = Math.round(i * step);
            return { round: series[idx].round, x: pts[idx].x };
        });
        return { lo, hi, plotW, plotH, pts, line, area, xLabels, baseline: PAD_TOP + plotH };
    }, [series, values, width, metric.key]);

    const hovered = hoverIndex != null ? series[hoverIndex] : null;
    const hoveredPt = hoverIndex != null ? geom.pts[hoverIndex] : null;

    const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
        if (series.length === 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        // Nearest sampled point to the cursor.
        let best = 0;
        let bestDist = Infinity;
        for (let i = 0; i < geom.pts.length; i++) {
            const d = Math.abs(geom.pts[i].x - x);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        setHoverIndex(best);
    };

    const readout = hovered
        ? `${formatRounds(hovered.round)} · ${hovered[metric.key].toFixed(metric.decimals)}${metric.unit}`
        : null;

    return (
        <div style={CARD_STYLE}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '8px' }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#e8e8f0' }}>{metric.label}</div>
                    <div style={{ fontSize: '11px', color: AXIS_TEXT, marginTop: '2px' }}>{metric.caption}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: '#f0f0f5' }}>
                        {final.toFixed(metric.decimals)}{metric.unit}
                    </div>
                    <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.5px', color: AXIS_TEXT }}>
                        {readout ? 'hover' : 'final'}
                    </div>
                </div>
            </div>

            <div ref={wrapRef} style={{ width: '100%' }}>
                {series.length < 2 ? (
                    <div style={{ fontSize: '11px', color: AXIS_TEXT, fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>
                        Not enough rounds to plot a curve — run more simulations.
                    </div>
                ) : (
                    <svg
                        width={width}
                        height={CHART_HEIGHT}
                        style={{ display: 'block', overflow: 'visible' }}
                        onMouseMove={handleMove}
                        onMouseLeave={() => setHoverIndex(null)}
                    >
                        <defs>
                            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.28} />
                                <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
                            </linearGradient>
                        </defs>

                        {/* Horizontal gridlines + y labels */}
                        {yTicks(geom.lo, geom.hi).map((t) => {
                            const y = PAD_TOP + geom.plotH - ((t.value - geom.lo) / Math.max(1e-9, geom.hi - geom.lo)) * geom.plotH;
                            return (
                                <g key={t.value}>
                                    <line x1={PAD_LEFT} y1={y} x2={width - PAD_RIGHT} y2={y} stroke={GRID} strokeWidth={1} />
                                    <text x={PAD_LEFT - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT} fontFamily="monospace">
                                        {`${t.value.toFixed(t.decimals)}${metric.unit}`}
                                    </text>
                                </g>
                            );
                        })}

                        {/* x labels (rounds) */}
                        {geom.xLabels.map((p, i) => {
                            const isFirst = i === 0;
                            const isLast = i === geom.xLabels.length - 1;
                            return (
                                <text
                                    key={p.round}
                                    x={p.x}
                                    y={CHART_HEIGHT - 6}
                                    textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
                                    fontSize={10}
                                    fill={AXIS_TEXT}
                                    fontFamily="monospace"
                                >
                                    {formatRounds(p.round)}
                                </text>
                            );
                        })}

                        <path d={geom.area} fill={`url(#${gradientId})`} />
                        <path d={geom.line} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

                        {/* Hover crosshair + point */}
                        {hoveredPt && (
                            <g>
                                <line
                                    x1={hoveredPt.x}
                                    y1={PAD_TOP}
                                    x2={hoveredPt.x}
                                    y2={geom.baseline}
                                    stroke="rgba(255,255,255,0.25)"
                                    strokeWidth={1}
                                    strokeDasharray="3 3"
                                />
                                <circle cx={hoveredPt.x} cy={hoveredPt.y} r={3.5} fill={ACCENT} stroke="#16161f" strokeWidth={1.5} />
                            </g>
                        )}
                    </svg>
                )}
            </div>

            {/* Hover readout below the plot — no absolute positioning to collide
                with the chart, and it doubles as the accessible value label. */}
            <div style={{ height: '14px', fontSize: '10px', fontFamily: 'monospace', color: readout ? '#c8c8d0' : 'transparent', marginTop: '2px' }}>
                {readout || '·'}
            </div>
        </div>
    );
}

export function SimulationCharts({ series }: { series: SimulationSeriesPoint[] }) {
    if (series.length === 0) return null;
    return (
        <>
            {METRICS.map((metric) => (
                <MetricChart key={metric.key} metric={metric} series={series} />
            ))}
        </>
    );
}
