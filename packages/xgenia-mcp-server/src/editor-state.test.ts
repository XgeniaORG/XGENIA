import { describe, it, expect, beforeEach } from 'vitest';
import type { Page } from 'playwright-core';
import {
  busySince,
  resetBusyTracking,
  summariseMessages,
  readChatState,
  waitForChatReady,
  isLoginScreen,
  describePageState,
  describePageStateText,
  unresponsiveHealthReport,
  type ProjectInfo
} from './editor-state.js';

beforeEach(() => resetBusyTracking());

/** Minimal stand-in for a Playwright Frame, just enough for getChatFrame + evaluate. */
function stubPage(frame: { url: () => string; evaluate: (...args: unknown[]) => unknown } | null): Page {
  return {
    frames: () => (frame ? [frame] : [])
  } as unknown as Page;
}

/**
 * Minimal stand-in for a Playwright Page for isLoginScreen/describePageState.
 * Like project.test.ts's and this file's other stubs, `evaluate` never runs
 * the real in-page callback -- it substitutes a canned resolution, so these
 * tests exercise the Node-side wrapper's handling of that outcome, not the
 * real in-browser querySelector logic (that's covered live and by
 * selectors.test.ts's fixtures).
 */
function stubEvalPage(results: unknown[]): Page {
  let i = 0;
  return {
    evaluate: async () => results[i++]
  } as unknown as Page;
}

describe('busySince', () => {
  it('returns null while idle', () => {
    expect(busySince(false, 1000)).toBeNull();
  });

  it('returns 0 on the first busy observation', () => {
    expect(busySince(true, 1000)).toBe(0);
  });

  it('accumulates while busy stays true', () => {
    busySince(true, 1000);
    expect(busySince(true, 4000)).toBe(3000);
  });

  it('resets once idle is observed', () => {
    busySince(true, 1000);
    expect(busySince(false, 2000)).toBeNull();
    expect(busySince(true, 5000)).toBe(0);
  });
});

describe('summariseMessages', () => {
  it('truncates a long message and flags it', () => {
    const long = 'x'.repeat(3000);
    const [m] = summariseMessages([{ role: 'assistant', text: long }], 0, 10, 2000);
    expect(m.text).toHaveLength(2000);
    expect(m.truncated).toBe(true);
  });

  it('leaves a short message whole', () => {
    const [m] = summariseMessages([{ role: 'user', text: 'hi' }], 0, 10, 2000);
    expect(m.text).toBe('hi');
    expect(m.truncated).toBe(false);
  });

  it('pages from an index', () => {
    const src = [1, 2, 3, 4].map((n) => ({ role: 'user' as const, text: String(n) }));
    const page = summariseMessages(src, 2, 10, 2000);
    expect(page.map((m) => m.text)).toEqual(['3', '4']);
    expect(page[0].index).toBe(2);
  });

  it('respects the limit', () => {
    const src = [1, 2, 3, 4].map((n) => ({ role: 'user' as const, text: String(n) }));
    expect(summariseMessages(src, 0, 2, 2000)).toHaveLength(2);
  });
});

describe('readChatState', () => {
  it('reports no-frame when no chat iframe is found', async () => {
    const page = stubPage(null);
    const state = await readChatState(page);
    expect(state.mounted).toBe(false);
    expect(state.unavailable).toBe('no-frame');
    expect(state.error).toBeUndefined();
  });

  it('reports evaluate-failed when the frame exists but evaluate throws', async () => {
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: () => {
        throw new Error('boom: cross-origin read failed');
      }
    });
    const state = await readChatState(page);
    expect(state.mounted).toBe(false);
    expect(state.unavailable).toBe('evaluate-failed');
    expect(state.error).toContain('boom: cross-origin read failed');
  });

  it('passes through real values on success with unavailable absent', async () => {
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: async () => ({ mounted: true, busy: false, messageCount: 3 })
    });
    const state = await readChatState(page);
    expect(state).toEqual({ mounted: true, busy: false, messageCount: 3 });
    expect(state.unavailable).toBeUndefined();
  });
});

// Defect 1: `openProject` was observed live to return as soon as the right
// project was verified open, while the chat panel iframe had not mounted
// yet -- a caller driving "open a project, then use the chat" immediately
// afterward got chat-frame-missing even though the panel was never actually
// missing. waitForChatReady is the shared primitive that closes that race
// for both openProject (project.ts) and the chat functions (chat.ts); these
// tests pin its polling and give-up behaviour independent of either caller.
describe('waitForChatReady', () => {
  it('resolves ready immediately when the panel is already mounted', async () => {
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: async () => ({ mounted: true, busy: false, messageCount: 2 })
    });
    const start = Date.now();
    const result = await waitForChatReady(page, 5000, 10);
    expect(result).toEqual({ ready: true, state: { mounted: true, busy: false, messageCount: 2 } });
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('retries past a panel that is a moment from ready, then reports ready once it mounts', async () => {
    let call = 0;
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: async () => {
        call += 1;
        return call < 3
          ? { mounted: false, busy: false, messageCount: 0 }
          : { mounted: true, busy: false, messageCount: 2 };
      }
    });
    const result = await waitForChatReady(page, 5000, 5);
    expect(result.ready).toBe(true);
    expect(call).toBeGreaterThanOrEqual(3);
  });

  it('gives up at the timeout and reports ready:false with unavailable "no-frame" when no iframe ever appears', async () => {
    const page = stubPage(null);
    const start = Date.now();
    const result = await waitForChatReady(page, 30, 10);
    expect(result.ready).toBe(false);
    expect(result.state.unavailable).toBe('no-frame');
    expect(Date.now() - start).toBeLessThan(300);
  });

  it('distinguishes a readable-but-never-mounted panel (no unavailable reason) from no-frame', async () => {
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: async () => ({ mounted: false, busy: false, messageCount: 0 })
    });
    const result = await waitForChatReady(page, 30, 10);
    expect(result.ready).toBe(false);
    expect(result.state.mounted).toBe(false);
    expect(result.state.unavailable).toBeUndefined();
  });

  it('gives up at the timeout and reports the evaluate-failed reason when the frame is present but throws', async () => {
    const page = stubPage({
      url: () => 'https://xgenia-ai-app.vercel.app/panel',
      evaluate: () => {
        throw new Error('boom: cross-origin read failed');
      }
    });
    const result = await waitForChatReady(page, 30, 10);
    expect(result.ready).toBe(false);
    expect(result.state.unavailable).toBe('evaluate-failed');
    expect(result.state.error).toContain('boom: cross-origin read failed');
  });
});

// Defect 1: `window.ProjectModel` is defined by the router on the login
// screen too, so it alone cannot tell an authenticated editor from an
// unauthenticated one. isLoginScreen is the actual detector; these tests
// pin the Node-side wrapper's behaviour (does it pass the right selectors
// through and return the in-page boolean as-is) -- the real DOM match is
// covered by selectors.test.ts against the live-captured fixture.
describe('isLoginScreen', () => {
  it('resolves true when the in-page check reports the login form is present', async () => {
    const page = stubEvalPage([true]);
    expect(await isLoginScreen(page)).toBe(true);
  });

  it('resolves false when the in-page check reports no login form', async () => {
    const page = stubEvalPage([false]);
    expect(await isLoginScreen(page)).toBe(false);
  });
});

describe('describePageState', () => {
  it('reports login-screen without reading further', async () => {
    const page = stubEvalPage([true]);
    expect(await describePageState(page)).toEqual({ kind: 'login-screen' });
  });

  it('reports project-open with the project when one is open', async () => {
    const project: ProjectInfo = { name: 'Amazing thing', id: 'p1', dir: '/tmp/x', componentCount: 2 };
    const page = stubEvalPage([false, project]);
    expect(await describePageState(page)).toEqual({ kind: 'project-open', project });
  });

  it('reports projects-screen with the tile count when no project is open', async () => {
    const page = stubEvalPage([false, null, 317]);
    expect(await describePageState(page)).toEqual({ kind: 'projects-screen', tileCount: 317 });
  });

  it('reports projects-screen with zero tiles distinctly from a populated one', async () => {
    const page = stubEvalPage([false, null, 0]);
    expect(await describePageState(page)).toEqual({ kind: 'projects-screen', tileCount: 0 });
  });

  it('reports unreadable, with the error, when a read throws', async () => {
    const page = {
      evaluate: async () => {
        throw new Error('boom: page navigated mid-evaluate');
      }
    } as unknown as Page;
    const state = await describePageState(page);
    expect(state.kind).toBe('unreadable');
    expect('error' in state && state.error).toContain('boom: page navigated mid-evaluate');
  });
});

// Defect 3: `health()` used to simply throw whatever `connect()` threw, so a
// wedged or absent editor never produced a `HealthReport` at all -- only
// `guard()`'s generic {error, tried, hint} in index.ts, losing the
// running:false shape a caller could otherwise inspect directly.
// unresponsiveHealthReport is the pure builder `health()`'s catch block now
// calls; pinned here independent of a real connect() attempt.
describe('unresponsiveHealthReport', () => {
  it('reports running:false with the given code, hint and port, and every other field honestly empty', () => {
    const report = unresponsiveHealthReport(9223, 'editor-unresponsive', 'boom: timed out');
    expect(report).toEqual({
      running: false,
      target: null,
      port: 9223,
      pageResponsive: false,
      projectOpen: false,
      project: null,
      chatMounted: false,
      chatBusy: false,
      busyForMs: null,
      pageTitle: null,
      authenticated: 'unknown',
      code: 'editor-unresponsive',
      hint: 'boom: timed out'
    });
  });

  it('passes the not-running code through just as faithfully', () => {
    const report = unresponsiveHealthReport(9223, 'not-running', 'boom: ECONNREFUSED');
    expect(report.code).toBe('not-running');
    expect(report.running).toBe(false);
  });
});

describe('describePageStateText', () => {
  it('renders login-screen', () => {
    expect(describePageStateText({ kind: 'login-screen' })).toContain('nobody is signed in');
  });

  it('renders project-open with the project name', () => {
    const project: ProjectInfo = { name: 'Amazing thing', id: null, dir: null, componentCount: 0 };
    expect(describePageStateText({ kind: 'project-open', project })).toContain('Amazing thing');
  });

  it('distinguishes zero tiles from a populated screen', () => {
    expect(describePageStateText({ kind: 'projects-screen', tileCount: 0 })).toContain('zero tiles');
    expect(describePageStateText({ kind: 'projects-screen', tileCount: 317 })).toContain('317');
  });

  it('renders unreadable with the error message', () => {
    expect(describePageStateText({ kind: 'unreadable', error: 'boom' })).toContain('boom');
  });
});
