import { describe, it, expect } from 'vitest';
import { classifyProbe, probeHint } from './rawprobe.js';

// The defect these encode: `editor-unresponsive` used to be returned purely because
// something was listening on the CDP port, with the renderer never consulted. That is a
// diagnosis of a component that was never asked a question, and it was wrong in the most
// common case — a stalled Playwright connect in front of a perfectly healthy page.
describe('classifyProbe', () => {
  it('calls it connect-stalled when the page itself answered', () => {
    // Observed live: MCP reported the page dead while a direct evaluate returned in 9ms.
    expect(
      classifyProbe({ listening: true, httpOk: true, editorPageResponsive: true })
    ).toBe('connect-stalled');
  });

  it('calls it editor-blocked when CDP answers but the page will not evaluate', () => {
    // Also observed live, in a later run: evaluate timed out repeatedly for minutes.
    // Both states are real; only evidence separates them.
    expect(
      classifyProbe({ listening: true, httpOk: true, editorPageResponsive: false })
    ).toBe('editor-blocked');
  });

  it('calls it editor-unresponsive only when CDP itself went silent', () => {
    expect(
      classifyProbe({ listening: true, httpOk: false, editorPageResponsive: null })
    ).toBe('editor-unresponsive');
  });

  it('reports not-running when nothing owns the port and nothing answers', () => {
    expect(
      classifyProbe({ listening: false, httpOk: false, editorPageResponsive: null })
    ).toBe('not-running');
  });

  it('does not invent a renderer diagnosis when the evaluate leg was skipped', () => {
    // Node 18/20 have no global WebSocket. Claiming "blocked" there would be the same
    // unfounded assertion this module exists to remove.
    expect(
      classifyProbe({ listening: true, httpOk: true, editorPageResponsive: null })
    ).toBe('connect-stalled');
  });

  it('does not say not-running when the port is owned but CDP went silent', () => {
    // Observed: Electron alive at 0% CPU, still holding the port, json/list aborting.
    // Reporting not-running there tells the caller there is nothing to kill or wait for.
    expect(
      classifyProbe({ listening: true, httpOk: false, editorPageResponsive: null })
    ).toBe('editor-unresponsive');
  });

  it('reports ok, not stalled, when nothing failed and the page answers', () => {
    // Run standalone as a health check there is no failed connect to explain, so calling
    // a healthy editor "stalled" would be a false alarm in the opposite direction.
    expect(
      classifyProbe({ listening: true, httpOk: true, editorPageResponsive: true, connectFailed: false })
    ).toBe('ok');
  });

  it('tells a retry-able stall apart from one that needs intervention', () => {
    expect(probeHint('connect-stalled')).toMatch(/[Rr]etry/);
    expect(probeHint('connect-stalled')).toMatch(/not restart/i);
    expect(probeHint('editor-blocked')).toMatch(/blocked/i);
  });
});
