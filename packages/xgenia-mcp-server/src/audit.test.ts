import { describe, it, expect } from 'vitest';
import { auditProjectFile, diffFindings } from './audit.js';


// A Timer that re-arms itself is an unbounded wall-clock loop. This is not theoretical:
// a 250ms self-restarting Timer, added to "break a signal cycle", left the editor's
// renderer unable to answer a direct CDP evaluate for minutes. Each wire looks sensible on
// its own, which is exactly why it needs a rule rather than an eyeball.
describe('timer-self-restart', () => {
  const build = (extra: Record<string, unknown>[] = []) => ({
    components: [
      {
        name: '/#__maths__/M',
        graph: {
          roots: [
            {
              id: 'root',
              type: 'Group',
              children: [
                { id: 'timer', type: 'Timer', parameters: { label: 'CascadeBeat', duration: 250 } },
                { id: 'casc', type: 'JavaScriptFunction', parameters: { label: 'Cascade' } }
              ]
            }
          ],
          connections: [
            { fromId: 'timer', toId: 'casc', fromProperty: 'timerFinished', toProperty: 'Do' },
            { fromId: 'casc', toId: 'timer', fromProperty: 'out-ContinueCascade', toProperty: 'restart' },
            ...extra
          ]
        }
      }
    ]
  });

  it('flags a timer whose output loops back to its own restart', () => {
    const f = auditProjectFile(build()).findings.filter((x) => x.rule === 'timer-self-restart');
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.detail).toContain('250ms');
  });

  it('still flags it when a stop wire exists, because stop only helps if it fires', () => {
    const f = auditProjectFile(
      build([{ fromId: 'casc', toId: 'timer', fromProperty: 'out-Limit', toProperty: 'stop' }])
    ).findings.filter((x) => x.rule === 'timer-self-restart');
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toMatch(/stop wire\(s\) only end it/);
  });

  it('leaves a one-shot timer alone', () => {
    const one = build();
    one.components[0]!.graph.connections = [
      { fromId: 'timer', toId: 'casc', fromProperty: 'timerFinished', toProperty: 'Do' }
    ];
    expect(auditProjectFile(one).findings.filter((x) => x.rule === 'timer-self-restart')).toHaveLength(0);
  });
});

// A component containing itself expands forever and blocks the renderer outright. This is
// what "instancing a maths component hangs the renderer" actually was: a builder passed the
// wrong componentPath and created GameMaths inside GameMaths. It never reaches disk,
// because the editor blocks before it can save.
describe('self-instancing-component', () => {
  const comp = (name: string, instances: string[]) => ({
    name,
    graph: {
      roots: [
        {
          id: `${name}-root`,
          type: 'Group',
          children: instances.map((t, i) => ({ id: `${name}-i${i}`, type: t }))
        }
      ],
      connections: []
    }
  });

  it('flags a component that instances itself', () => {
    const f = auditProjectFile({ components: [comp('/#__maths__/GameMaths', ['/#__maths__/GameMaths'])] })
      .findings.filter((x) => x.rule === 'self-instancing-component');
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.detail).toContain('componentPath');
  });

  it('flags an indirect cycle through another component', () => {
    const f = auditProjectFile({
      components: [comp('/A', ['/B']), comp('/B', ['/A'])]
    }).findings.filter((x) => x.rule === 'self-instancing-component');
    expect(f.length).toBeGreaterThan(0);
  });

  it('leaves ordinary nesting alone', () => {
    // /App instancing a maths component is supported and must not be flagged.
    const f = auditProjectFile({
      components: [comp('/App', ['/#__maths__/GameMaths']), comp('/#__maths__/GameMaths', [])]
    }).findings.filter((x) => x.rule === 'self-instancing-component');
    expect(f).toHaveLength(0);
  });
});

// The renderer-killer, and the one no other check caught. Proven by experiment: a
// hand-placed, audit-clean instance froze the editor 12s after open, and a pre-armed
// Debugger.pause caught Node.update / Node._updateDependencies recursing.
describe('data-dependency-cycle', () => {
  const proj = (connections: any[]) => ({
    components: [
      {
        name: '/#__maths__/M',
        graph: {
          roots: [
            {
              id: 'r',
              type: 'Group',
              children: [
                { id: 'pass', type: 'JavaScriptFunction', parameters: { label: 'MeterPass' } },
                { id: 'heat', type: 'JavaScriptFunction', parameters: { label: 'HeatMeter' } }
              ]
            }
          ],
          connections
        }
      }
    ]
  });

  it('flags a read-modify-write data loop as an error', () => {
    const f = auditProjectFile(
      proj([
        { fromId: 'pass', toId: 'heat', fromProperty: 'out-delta', toProperty: 'in-delta' },
        { fromId: 'heat', toId: 'pass', fromProperty: 'out-value', toProperty: 'in-heat' }
      ])
    ).findings.filter((x) => x.rule === 'data-dependency-cycle');
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.detail).toContain('DATA wires');
  });

  it('does not flag a loop closed by a signal wire', () => {
    // Signal loops are a different rule and a different failure mode; conflating them
    // would bury the fatal case in noise from bounded, intentional signal cycles.
    const f = auditProjectFile(
      proj([
        { fromId: 'pass', toId: 'heat', fromProperty: 'out-delta', toProperty: 'in-delta' },
        { fromId: 'heat', toId: 'pass', fromProperty: 'Done', toProperty: 'Do' }
      ])
    ).findings.filter((x) => x.rule === 'data-dependency-cycle');
    expect(f).toHaveLength(0);
  });

  it('leaves an acyclic data chain alone', () => {
    const f = auditProjectFile(
      proj([{ fromId: 'pass', toId: 'heat', fromProperty: 'out-delta', toProperty: 'in-delta' }])
    ).findings.filter((x) => x.rule === 'data-dependency-cycle');
    expect(f).toHaveLength(0);
  });
});

// A builder can fix something, report success honestly, and undo it two turns later. Totals
// hide that completely: three fixed and three introduced reads as "no change". This project
// had exactly that — a data cycle removed and verified, then rewired back while the turn
// reported canComplete: true.
describe('diffFindings', () => {
  const f = (rule: string, component: string, severity = 'error') =>
    ({ rule, component, severity, detail: 'x' }) as never;

  it('names findings this turn introduced as regressions', () => {
    const d = diffFindings(
      [f('data-dependency-cycle', '/A')],
      [f('data-dependency-cycle', '/A'), f('data-dependency-cycle', '/B')]
    );
    expect(d.regressions).toHaveLength(1);
    expect(d.verdict).toMatch(/NEW ERRORS/);
  });

  it('does not call an equal-count swap "no change"', () => {
    // The case that matters: one fixed, one broken. Totals are identical.
    const d = diffFindings([f('dangling', '/A')], [f('data-dependency-cycle', '/B')]);
    expect(d.fixed).toHaveLength(1);
    expect(d.regressions).toHaveLength(1);
    expect(d.verdict).toMatch(/NEW ERRORS/);
  });

  it('reports strictly better when something was fixed and nothing broke', () => {
    const d = diffFindings([f('dangling', '/A')], []);
    expect(d.verdict).toBe('strictly better than baseline');
  });

  it('ignores detail-text churn when matching findings', () => {
    const a = { rule: 'unwired-text', component: '/A', severity: 'info', detail: '3/6 Text nodes' } as never;
    const b = { rule: 'unwired-text', component: '/A', severity: 'info', detail: '4/7 Text nodes' } as never;
    expect(diffFindings([a], [b]).regressions).toHaveLength(0);
  });
});

// Two data wires into one input: only one value survives, chosen by evaluation order. This
// cost 13 consecutive spins that charged the stake and credited nothing — a win calculator
// guarded on `roundEnded === true` had that input fed by both a round-end flag (true) and a
// per-pass pass-through (false). Every node ran and completed, and the script returned the
// right answer when tested headless in isolation.
describe('duplicate-input-source', () => {
  const proj = (connections: any[]) => ({
    components: [
      {
        name: '/#__maths__/M',
        graph: {
          roots: [
            {
              id: 'r',
              type: 'Group',
              children: [
                { id: 'flag', type: 'JavaScriptFunction', parameters: { label: 'RoundEndFlag' } },
                { id: 'pass', type: 'JavaScriptFunction', parameters: { label: 'MeterPass' } },
                { id: 'calc', type: 'JavaScriptFunction', parameters: { label: 'LastWinCalc' } }
              ]
            }
          ],
          connections
        }
      }
    ]
  });
  const find = (p: any) =>
    auditProjectFile(p).findings.filter((x) => x.rule === 'duplicate-input-source');

  it('flags two data wires racing for one input', () => {
    const f = find(
      proj([
        { fromId: 'flag', toId: 'calc', fromProperty: 'out-roundEnded', toProperty: 'in-roundEnded' },
        { fromId: 'pass', toId: 'calc', fromProperty: 'out-roundEnded', toProperty: 'in-roundEnded' }
      ])
    );
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe('error');
    expect(f[0]!.detail).toContain('evaluation order');
  });

  it('allows signal fan-in, including prefixed out-Done', () => {
    // Several things may legitimately trigger one node. Reporting ordinary signal wiring
    // as a defect is how a rule earns the habit of being ignored.
    expect(
      find(
        proj([
          { fromId: 'flag', toId: 'calc', fromProperty: 'out-Done', toProperty: 'run' },
          { fromId: 'pass', toId: 'calc', fromProperty: 'out-Done', toProperty: 'run' }
        ])
      )
    ).toHaveLength(0);
  });

  it('leaves a single source alone', () => {
    expect(
      find(proj([{ fromId: 'flag', toId: 'calc', fromProperty: 'out-roundEnded', toProperty: 'in-roundEnded' }]))
    ).toHaveLength(0);
  });
});
