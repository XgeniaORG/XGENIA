import React, { useEffect, useMemo, useState } from 'react';
import { ipcRenderer } from 'electron';

import { usePanelActive } from '../useIsActivePanel';

type RendererMemAPI = {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  showPanel: () => void;
  hidePanel: () => void;
  recentLoads: (windowMs?: number) => Array<{ t: number; name: string; type: string; bytes: number }>;
  samples: Array<{ t: number; used?: number; dom?: number; ua?: number }>;
  getMemoryBreakdown: () => Array<{ category: string; size: number; details: string[] }>;
  getXgeniaMemoryBreakdown: () => Array<{ category: string; size: number; details: string[]; items?: Array<{ name: string; size: number; details: string[] }> }>;
  detectLoops: () => Array<{ type: string; count: number; details: string; severity: 'low' | 'medium' | 'high' }>;
  isRunning: () => boolean;
};

function getAPI(): RendererMemAPI | null {
  return (window as any).__RendererMem || null;
}

function humanBytes(n?: number) {
  if (typeof n !== 'number' || !isFinite(n)) return 'n/a';
  const mb = n / 1048576;
  return `${mb.toFixed(2)} MB`;
}

export function MemoryPanel() {
  const api = getAPI();
  const isActive = usePanelActive();
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState<boolean>(false);

  // Only while the panel is actually on screen. SidePanel keeps every opened
  // panel mounted, so this used to re-render a hidden memory readout every 1.5
  // seconds for the rest of the session — a profiler that costs what it measures.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(id);
  }, [isActive]);

  useEffect(() => {
    // probe running by checking the actual profiler state
    const a = getAPI();
    if (!a) return;
    setRunning(a.isRunning());
  }, [tick]);

  const { last, first, delta, loads, breakdown, xgeniaBreakdown, loops } = useMemo(() => {
    const a = getAPI();
    const ss = a?.samples || [];
    const lastS = ss[ss.length - 1];
    const firstS = ss[0];
    const d = lastS && firstS && lastS.used != null && firstS.used != null ? lastS.used - firstS.used : undefined;
    const loadsArr = a?.recentLoads ? a.recentLoads(10000) : [];
    const breakdownArr = a?.getMemoryBreakdown ? a.getMemoryBreakdown() : [];
    const xgeniaArr = a?.getXgeniaMemoryBreakdown ? a.getXgeniaMemoryBreakdown() : [];
    const loopsArr = a?.detectLoops ? a.detectLoops() : [];
    return { last: lastS, first: firstS, delta: d, loads: loadsArr, breakdown: breakdownArr, xgeniaBreakdown: xgeniaArr, loops: loopsArr };
  }, [tick]);

  function onStart() {
    const a = getAPI();
    a?.start();
    setRunning(true);
  }
  async function onStop() {
    const a = getAPI();
    a?.stop();
    setRunning(false);
    try { await ipcRenderer.invoke('memprof:reveal'); } catch { }
  }

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Memory</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{running ? 'Running' : 'Stopped'}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <Stat label="JS Heap" value={humanBytes(last?.used)} />
        <Stat label="Δ Heap" value={humanBytes(delta)} />
        <Stat label="UA Memory" value={humanBytes(last?.ua)} />
        <Stat label="DOM Nodes" value={typeof last?.dom === 'number' ? String(last?.dom) : 'n/a'} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {running ? (
          <button onClick={onStop} style={btnStyle('#7f1d1d')}>Stop</button>
        ) : (
          <button onClick={onStart} style={btnStyle('#064e3b')}>Start</button>
        )}
        <button onClick={() => ipcRenderer.invoke('memprof:reveal')} style={btnStyle('#1f2937')}>Reveal Reports</button>
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Memory Breakdown</div>
      <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
        {(breakdown || []).slice(0, 8).map((item, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 0' }}>
            <div style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.category}>
              {item.category}
            </div>
            <div style={{ fontSize: 11, opacity: 0.8 }}>{humanBytes(item.size)}</div>
          </div>
        ))}
        {(!breakdown || breakdown.length === 0) && <div style={{ opacity: 0.6 }}>No data</div>}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>🔍 XGENIA Project Analysis</div>
      <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
        {(xgeniaBreakdown || []).slice(0, 6).map((item, i) => (
          <div key={i} style={{ padding: '8px', backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{ fontWeight: 500, fontSize: 11 }}>{item.category}</div>
              <div style={{ fontSize: 11, opacity: 0.8 }}>{humanBytes(item.size)}</div>
            </div>
            <div style={{ fontSize: 10, opacity: 0.7, marginBottom: '4px' }}>
              {item.details.join(', ')}
            </div>
            {item.items && item.items.length > 0 && (
              <div style={{ fontSize: 10, opacity: 0.8 }}>
                <div style={{ marginBottom: '2px' }}>Top items:</div>
                {item.items.slice(0, 3).map((subItem, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                    <div style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={subItem.name}>
                      {subItem.name}
                    </div>
                    <div>{humanBytes(subItem.size)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {(!xgeniaBreakdown || xgeniaBreakdown.length === 0) && <div style={{ opacity: 0.6 }}>No XGENIA data</div>}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>🔄 Loop Detection</div>
      <div style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
        {(loops || []).length > 0 ? (
          loops.map((loop, i) => (
            <div key={i} style={{
              padding: '8px',
              backgroundColor: loop.severity === 'high' ? 'rgba(220,38,38,0.1)' :
                loop.severity === 'medium' ? 'rgba(245,158,11,0.1)' :
                  'rgba(34,197,94,0.1)',
              borderRadius: '4px',
              border: `1px solid ${loop.severity === 'high' ? 'rgba(220,38,38,0.3)' :
                loop.severity === 'medium' ? 'rgba(245,158,11,0.3)' :
                  'rgba(34,197,94,0.3)'}`
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{ fontWeight: 500, fontSize: 11 }}>
                  {loop.severity === 'high' ? '🚨' : loop.severity === 'medium' ? '⚠️' : 'ℹ️'} {loop.type}
                </div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>{loop.count}</div>
              </div>
              <div style={{ fontSize: 10, opacity: 0.7 }}>
                {loop.details}
              </div>
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.6, fontSize: 11 }}>✅ No loops detected</div>
        )}
      </div>

      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Recent loads (10s)</div>
      <div style={{ display: 'grid', gap: 4 }}>
        {(loads || []).slice(0, 12).map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
              {(r.type || 'res') + ': ' + r.name}
            </div>
            <div>{humanBytes(r.bytes)}</div>
          </div>
        ))}
        {(!loads || loads.length === 0) && <div style={{ opacity: 0.6 }}>None</div>}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{props.label}</div>
      <div style={{ fontSize: 13 }}>{props.value}</div>
    </div>
  );
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    padding: '6px 10px',
    borderRadius: 6,
    border: 0,
    background: bg,
    color: '#fff',
    cursor: 'pointer'
  };
}

export default MemoryPanel;


