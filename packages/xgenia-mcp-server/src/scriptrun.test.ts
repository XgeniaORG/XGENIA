import { describe, it, expect } from 'vitest';
import { runScriptBody } from './scriptrun.js';

// The harness previously provided only Done/Do/Success/Failure as callable outputs, so any
// node firing its own declared signal came back as "Outputs.X is not a function". That made
// it useless for exactly the nodes most worth testing: a cascade guard whose failure is an
// unbounded synchronous loop, i.e. an instant renderer freeze.
describe('runScriptBody signal outputs', () => {
  const gate = `
    if ((Inputs.passCount | 0) >= 100) { Outputs.PassLimitReached(); }
    else { Outputs.ContinueCascade(); }
    Outputs.Done();`;

  it('records a node-declared signal instead of throwing', () => {
    const r = runScriptBody(gate, { passCount: 0 });
    expect(r.threw).toBeFalsy();
    expect(r.firedSignals).toContain('ContinueCascade');
    expect(r.firedSignals).toContain('Done');
  });

  it('takes the other branch at the limit', () => {
    const r = runScriptBody(gate, { passCount: 100 });
    expect(r.firedSignals).toContain('PassLimitReached');
    expect(r.firedSignals).not.toContain('ContinueCascade');
  });

  it('still reports reading an output that was never assigned', () => {
    // This used to throw "Cannot read properties of undefined", which is a real defect
    // worth surfacing — it must stay visible now that unknown gets no longer throw.
    const r = runScriptBody('const x = Outputs.Meters.heat; Outputs.Done();', {});
    expect(r.threw).toBeFalsy();
    expect(r.unassignedOutputReads).toContain('Meters.heat');
  });

  it('still captures assigned data outputs', () => {
    const r = runScriptBody('Outputs.total = 7; Outputs.Done();', {});
    expect(r.outputs).toMatchObject({ total: 7 });
  });
});
