import { describe, it, expect, beforeEach } from 'vitest';
import type { Frame, Page } from 'playwright-core';
import {
  parseTranscript,
  readStructuredMessages,
  resolveReadWindow,
  normaliseWhitespace,
  promptSlice,
  transcriptContainsPrompt,
  confirmSent,
  chatNotReadyHint,
  isChatButtonLabel,
  ensureChatPanelOpen,
  resetChatButtonCache
} from './chat.js';
import { summariseMessages, type ChatMessage } from './editor-state.js';

describe('parseTranscript', () => {
  it('drops the panel chrome preamble', () => {
    const raw = [
      '▶',
      'Chat (38 messages)',
      '$0.1658',
      'Dashboard',
      '20.0% of context',
      '210.1k / 1048.6k · 38 msgs',
      'Load 8 older messages',
      '',
      'Real first message'
    ].join('\n');
    const msgs = parseTranscript(raw);
    expect(msgs[0].text).toContain('Real first message');
    expect(msgs.some((m) => m.text.includes('Load 8 older messages'))).toBe(false);
    expect(msgs.some((m) => m.text.includes('% of context'))).toBe(false);
  });

  it('returns nothing for an empty panel', () => {
    expect(parseTranscript('')).toEqual([]);
    expect(parseTranscript('Chat (0 messages)\n')).toEqual([]);
  });

  it('keeps message text intact', () => {
    const raw = 'Chat (1 messages)\n\nTool: image { "action": "create" }';
    const msgs = parseTranscript(raw);
    expect(msgs[0].text).toContain('"action": "create"');
  });

  it('drops a "Load N older messages" line that appears after real content, not only leading', () => {
    const raw = [
      'Real message one',
      'Load 70 older messages',
      'Real message two'
    ].join('\n');
    const msgs = parseTranscript(raw);
    expect(msgs[0].text).not.toContain('Load 70 older messages');
    expect(msgs[0].text).toContain('Real message one');
    expect(msgs[0].text).toContain('Real message two');
  });

  it('drops the "Showing last N of M messages for performance" banner wherever it appears', () => {
    const raw = [
      'Real message one',
      'Showing last 100 of 110 messages for performance. Full conversation saved.',
      'Real message two'
    ].join('\n');
    const msgs = parseTranscript(raw);
    expect(msgs[0].text).not.toContain('Showing last 100 of 110');
    expect(msgs[0].text).not.toContain('Full conversation saved');
    expect(msgs[0].text).toContain('Real message one');
    expect(msgs[0].text).toContain('Real message two');
  });
});

/**
 * Minimal stand-in for a Playwright Frame, just enough for `evaluate`. Each
 * call in `sequence` answers one call to `frame.evaluate(...)` in order,
 * mirroring the readChatState stub approach in editor-state.test.ts.
 */
function stubFrame(sequence: unknown[]): Frame {
  let call = 0;
  return {
    evaluate: async () => sequence[call++]
  } as unknown as Frame;
}

describe('readStructuredMessages', () => {
  it('maps an assistant-group parent to assistant, and anything else to unknown (never user)', async () => {
    const rows = [
      { parentClasses: ['assistant-group'], text: 'Reply from the assistant' },
      { parentClasses: ['custom-scrollbar'], text: 'still streaming' }
    ];
    const frame = stubFrame([rows]);
    const messages = await readStructuredMessages(frame);
    expect(messages[0]).toEqual({ role: 'assistant', text: 'Reply from the assistant' });
    expect(messages[1]).toEqual({ role: 'unknown', text: 'still streaming' });
    expect(messages.some((m) => m.role === 'user')).toBe(false);
  });

  it('falls back to parseTranscript when zero .message-container elements are found', async () => {
    const raw = 'Chat (1 messages)\n\nReal fallback content';
    const frame = stubFrame([[], raw]);
    const messages = await readStructuredMessages(frame);
    expect(messages).toEqual(parseTranscript(raw));
    expect(messages[0].text).toContain('Real fallback content');
  });
});

describe('resolveReadWindow', () => {
  it('returns the tail of the transcript when since is not given', () => {
    // 10 messages, limit 3 -> the last three: indices 7, 8, 9
    expect(resolveReadWindow(10, undefined, 3)).toBe(7);
  });

  it('passes an explicit since through untouched, including 0', () => {
    expect(resolveReadWindow(10, 2, 3)).toBe(2);
    expect(resolveReadWindow(10, 0, 3)).toBe(0);
  });

  it('never goes negative when limit exceeds total', () => {
    expect(resolveReadWindow(2, undefined, 5)).toBe(0);
  });
});

describe('chatRead windowing (resolveReadWindow + summariseMessages together)', () => {
  const messages: ChatMessage[] = Array.from({ length: 10 }, (_, i) => ({
    role: 'assistant' as const,
    text: `message ${i}`
  }));

  it('tail behaviour: no since, limit 3, over 10 messages returns absolute indices 7, 8, 9', () => {
    const since = resolveReadWindow(messages.length, undefined, 3);
    const out = summariseMessages(messages, since, 3, 2000);
    expect(out.map((m) => m.index)).toEqual([7, 8, 9]);
    expect(out.map((m) => m.text)).toEqual(['message 7', 'message 8', 'message 9']);
  });

  it('paging: since 2, limit 3 returns indices 2, 3, 4', () => {
    const since = resolveReadWindow(messages.length, 2, 3);
    const out = summariseMessages(messages, since, 3, 2000);
    expect(out.map((m) => m.index)).toEqual([2, 3, 4]);
  });

  it('truncates a long message per-message while leaving a short sibling untouched', () => {
    const long = 'x'.repeat(3000);
    const withLong: ChatMessage[] = [
      { role: 'assistant', text: long },
      { role: 'assistant', text: 'short reply' }
    ];
    const since = resolveReadWindow(withLong.length, undefined, 2);
    const out = summariseMessages(withLong, since, 2, 2000);
    expect(out[0].text).toHaveLength(2000);
    expect(out[0].truncated).toBe(true);
    expect(out[1].text).toBe('short reply');
    expect(out[1].truncated).toBe(false);
  });
});

describe('normaliseWhitespace', () => {
  it('collapses runs of spaces and newlines into one space', () => {
    expect(normaliseWhitespace('hello   world\n\nagain')).toBe('hello world again');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normaliseWhitespace('  padded  ')).toBe('padded');
  });
});

describe('promptSlice', () => {
  it('returns the whole normalised text when shorter than the slice length', () => {
    expect(promptSlice('hi   there')).toBe('hi there');
  });

  it('truncates a long prompt to the slice length after normalising', () => {
    const long = 'word '.repeat(50); // far longer than CONFIRM_SLICE_LEN once normalised
    const slice = promptSlice(long, 20);
    expect(slice).toHaveLength(20);
    expect(slice).toBe(normaliseWhitespace(long).slice(0, 20));
  });
});

describe('transcriptContainsPrompt', () => {
  it('matches when the transcript contains the leading slice, whitespace differences aside', () => {
    const sent = 'Please   refactor\nthe reel stop logic';
    const transcript = 'some chrome\nPlease refactor the reel stop logic and also explain why\nmore chrome';
    expect(transcriptContainsPrompt(transcript, sent)).toBe(true);
  });

  it('matches a long prompt on its leading slice even when the tail never rendered verbatim', () => {
    // Simulates the panel truncating a long prompt or inserting markup partway
    // through it — a whole-string match would false-negative here even though
    // the prompt genuinely landed.
    const sent = 'x'.repeat(200);
    const transcript = `${'x'.repeat(60)}... [truncated by panel] ...`;
    expect(transcriptContainsPrompt(transcript, sent)).toBe(true);
  });

  it('does not match when the prompt never appears', () => {
    expect(transcriptContainsPrompt('completely unrelated content', 'my actual prompt text')).toBe(false);
  });

  it('never confirms an empty or whitespace-only sent text', () => {
    expect(transcriptContainsPrompt('anything at all', '   ')).toBe(false);
    expect(transcriptContainsPrompt('anything at all', '')).toBe(false);
  });
});

/**
 * Stub Frame whose evaluate alternates between two FIXED answers forever —
 * unlike the one-shot `sequence` stub used above, this one is safe to poll an
 * unknown number of times (confirmSent's loop timing is not deterministic
 * enough to predict an exact call count).
 */
function stubConfirmFrame(cleared: boolean, transcriptText: string): Frame {
  let call = 0;
  return {
    evaluate: async () => (call++ % 2 === 0 ? cleared : transcriptText)
  } as unknown as Frame;
}

describe('confirmSent', () => {
  const SENT = 'refactor the reel stop logic please';

  it('confirms when the input is cleared AND the prompt is found in the transcript', async () => {
    const frame = stubConfirmFrame(true, `some chat chrome\n${SENT}\nmore chrome`);
    const result = await confirmSent(frame, SENT, 50, 5);
    expect(result).toEqual({
      confirmed: true,
      inputCleared: true,
      promptFoundInTranscript: true,
      matchedSlice: promptSlice(SENT)
    });
  });

  it('does not confirm when the input cleared but the prompt never rendered', async () => {
    const frame = stubConfirmFrame(true, 'transcript with no relation to the sent text');
    const result = await confirmSent(frame, SENT, 50, 5);
    expect(result.confirmed).toBe(false);
    expect(result.inputCleared).toBe(true);
    expect(result.promptFoundInTranscript).toBe(false);
  });

  it('does not confirm when the prompt rendered but the input never cleared', async () => {
    const frame = stubConfirmFrame(false, `chrome\n${SENT}\nchrome`);
    const result = await confirmSent(frame, SENT, 50, 5);
    expect(result.confirmed).toBe(false);
    expect(result.inputCleared).toBe(false);
    expect(result.promptFoundInTranscript).toBe(true);
  });

  it('does not confirm when neither the input cleared nor the prompt rendered', async () => {
    const frame = stubConfirmFrame(false, 'unrelated transcript content');
    const result = await confirmSent(frame, SENT, 50, 5);
    expect(result.confirmed).toBe(false);
    expect(result.inputCleared).toBe(false);
    expect(result.promptFoundInTranscript).toBe(false);
  });

  // This is the real defect this whole function replaced: a live run showed
  // messageCount (the count of `[aria-label="Copy message to clipboard"]`
  // elements) going 19 -> 17 across a single successful send, because the
  // panel virtualises its transcript. confirmSent takes no messageCount
  // parameter at all — it cannot regress on that axis by construction — so
  // this pins the real-world case: input cleared and the prompt genuinely
  // rendered must confirm success regardless of what any message count did.
  it('confirms success on the real-world case that broke the old messageCount check: cleared + prompt present, independent of any message count', async () => {
    const frame = stubConfirmFrame(true, `Chat (17 messages)\nshowing last 100 of 200 messages\n${SENT}\nassistant reply chrome`);
    const result = await confirmSent(frame, SENT, 50, 5);
    expect(result.confirmed).toBe(true);
  });

  it('times out (never confirms) within the given deadline when both signals stay false', async () => {
    const frame = stubConfirmFrame(false, 'nope');
    const start = Date.now();
    const result = await confirmSent(frame, SENT, 30, 10);
    expect(result.confirmed).toBe(false);
    expect(Date.now() - start).toBeLessThan(500); // bounded, not the real 10s default
  });
});

// Defect 1b: chatRead/chatSend/chatWaitIdle must not tell a caller to "open
// the AI panel" when the panel isn't missing, only a moment from ready --
// that hint used to be the same regardless of which of these three very
// different situations was actually observed. chatNotReadyHint is what
// produces the hint text after the retry window (waitForChatReady) gives up;
// these pin that only the message differs per reason, not the underlying
// retry-then-fail behaviour (covered live and by waitForChatReady's own
// tests in editor-state.test.ts).
describe('chatNotReadyHint', () => {
  it('names the wait and says the iframe never appeared in the DOM for "no-frame"', () => {
    const hint = chatNotReadyHint({ unavailable: 'no-frame' }, 6000);
    expect(hint).toContain('6000ms');
    expect(hint).toContain('did not appear in the DOM');
  });

  it('surfaces the underlying error message for "evaluate-failed"', () => {
    const hint = chatNotReadyHint({ unavailable: 'evaluate-failed', error: 'boom: cross-origin' }, 6000);
    expect(hint).toContain('6000ms');
    expect(hint).toContain('boom: cross-origin');
  });

  it('describes a present-but-unmounted iframe distinctly, without any unavailable reason', () => {
    const hint = chatNotReadyHint({}, 6000);
    expect(hint).toContain('6000ms');
    expect(hint).toContain('iframe is present');
    expect(hint).toContain('input never rendered');
  });

  it('never tells the caller to open a panel that is not actually missing (no-frame case aside)', () => {
    // The old hint was the same literal "Open the AI panel in XGENIA." for
    // every reason, which is actively misleading when the panel is simply
    // still mounting. The present-but-unmounted case must not lead with that.
    const hint = chatNotReadyHint({}, 6000);
    expect(hint.startsWith('Open the AI panel')).toBe(false);
  });
});

describe('isChatButtonLabel', () => {
  it('matches "Chat" exactly, case-insensitively and trimmed', () => {
    expect(isChatButtonLabel('Chat')).toBe(true);
    expect(isChatButtonLabel('chat')).toBe(true);
    expect(isChatButtonLabel('CHAT')).toBe(true);
    expect(isChatButtonLabel('  Chat  ')).toBe(true);
  });

  it('never matches a label that merely contains "chat" as a substring', () => {
    // The two names the task calls out explicitly: a real sibling button
    // ("AI Image Editor") that must never be mistaken for Chat, and a
    // plausible future button ("Chat History") that also must not match.
    expect(isChatButtonLabel('AI Image Editor')).toBe(false);
    expect(isChatButtonLabel('Chat History')).toBe(false);
    expect(isChatButtonLabel('Live Chat')).toBe(false);
    expect(isChatButtonLabel('')).toBe(false);
  });
});

/**
 * Minimal stand-in for a Playwright Page complete enough to drive
 * `ensureChatPanelOpen`: `frames()` reflects whether the chat frame is
 * "mounted" right now (flipped by a click, unless `mountsOnClick: false`),
 * and `evaluate` answers each ordered call from `evaluateSequence` in turn
 * -- the box scan first, then one tooltip read per button hovered, in the
 * exact order the implementation makes them, matching this file's existing
 * `stubFrame(sequence)` convention above.
 */
function stubChatPanelPage(opts: {
  evaluateSequence?: unknown[];
  alreadyOpen?: boolean;
  mountsOnClick?: boolean;
}): { page: Page; clicks: [number, number][]; moves: [number, number][] } {
  let call = 0;
  let chatOpen = !!opts.alreadyOpen;
  const clicks: [number, number][] = [];
  const moves: [number, number][] = [];
  const chatFrame = {
    url: () => 'https://xgenia-ai-app.vercel.app/panel',
    evaluate: async () => ({ mounted: true, busy: false, messageCount: 0 })
  };
  const page = {
    frames: () => (chatOpen ? [chatFrame] : []),
    evaluate: async () => (opts.evaluateSequence ?? [])[call++],
    mouse: {
      move: async (x: number, y: number) => {
        moves.push([x, y]);
      },
      click: async (x: number, y: number) => {
        clicks.push([x, y]);
        if (opts.mountsOnClick !== false) chatOpen = true;
      }
    }
  };
  return { page: page as unknown as Page, clicks, moves };
}

describe('ensureChatPanelOpen', () => {
  beforeEach(() => resetChatButtonCache());

  it('returns immediately, without hovering or clicking anything, when the chat iframe is already present', async () => {
    const { page, clicks, moves } = stubChatPanelPage({ alreadyOpen: true });
    const result = await ensureChatPanelOpen(page);
    expect(result).toEqual({ opened: true, alreadyOpen: true, clicked: false });
    expect(clicks).toEqual([]);
    expect(moves).toEqual([]);
  });

  it('scans the sidebar, clicks the button whose tooltip reads "Chat", and reports success once the panel renders', async () => {
    const { page, clicks } = stubChatPanelPage({
      evaluateSequence: [
        [
          { cx: 10, cy: 48 },
          { cx: 10, cy: 483 },
          { cx: 10, cy: 525 }
        ], // box scan: three rail buttons
        ['Add node'],
        ['AI Image Editor'],
        ['Chat'] // third button matches
      ]
    });
    const result = await ensureChatPanelOpen(page, { hoverDelayMs: 1, timeoutMs: 200, pollMs: 5 });
    expect(result).toEqual({ opened: true, alreadyOpen: false, clicked: true });
    expect(clicks).toEqual([[10, 525]]);
  });

  it('reports no-chat-button and every label it saw when no tooltip reads "Chat"', async () => {
    const { page, clicks } = stubChatPanelPage({
      evaluateSequence: [
        [{ cx: 10, cy: 48 }, { cx: 10, cy: 483 }],
        ['Add node'],
        ['AI Image Editor']
      ]
    });
    const result = await ensureChatPanelOpen(page, { hoverDelayMs: 1, timeoutMs: 30, pollMs: 5 });
    expect(result.opened).toBe(false);
    expect(result.alreadyOpen).toBe(false);
    expect(result.clicked).toBe(false);
    expect(result.reason).toBe('no-chat-button');
    expect(result.labelsSeen).toEqual(['Add node', 'AI Image Editor']);
    expect(result.hint).toContain('Add node');
    expect(result.hint).toContain('AI Image Editor');
    expect(clicks).toEqual([]);
  });

  it('reports clicked-but-not-rendered when the button is found and clicked but the panel never mounts', async () => {
    const { page, clicks } = stubChatPanelPage({
      evaluateSequence: [[{ cx: 10, cy: 525 }], ['Chat']],
      mountsOnClick: false
    });
    const result = await ensureChatPanelOpen(page, { hoverDelayMs: 1, timeoutMs: 30, pollMs: 5 });
    expect(result.opened).toBe(false);
    expect(result.clicked).toBe(true);
    expect(result.reason).toBe('clicked-but-not-rendered');
    expect(clicks).toEqual([[10, 525]]);
  });

  it('caches the identified point and skips the full scan on a later call', async () => {
    const first = stubChatPanelPage({
      evaluateSequence: [[{ cx: 10, cy: 48 }, { cx: 10, cy: 525 }], ['Add node'], ['Chat']]
    });
    const firstResult = await ensureChatPanelOpen(first.page, { hoverDelayMs: 1, timeoutMs: 200, pollMs: 5 });
    expect(firstResult.opened).toBe(true);

    // A later call against a *different* page instance (panel closed again,
    // e.g. a new project) whose evaluateSequence holds only ONE call's worth
    // of result: if the cache were not reused, the implementation would try
    // to read a full box-scan array from that single entry and every
    // tooltip check would fail, never reaching a match.
    const second = stubChatPanelPage({
      evaluateSequence: [['Chat']] // only the cache re-verify hover read
    });
    const secondResult = await ensureChatPanelOpen(second.page, { hoverDelayMs: 1, timeoutMs: 200, pollMs: 5 });
    expect(secondResult.opened).toBe(true);
    expect(secondResult.labelsSeen).toBeUndefined(); // no scan ran
    expect(second.clicks).toEqual([[10, 525]]);
  });

  it('falls back to a fresh scan when the cached point no longer reads "Chat" (stale cache)', async () => {
    const first = stubChatPanelPage({
      evaluateSequence: [[{ cx: 10, cy: 525 }], ['Chat']]
    });
    const firstResult = await ensureChatPanelOpen(first.page, { hoverDelayMs: 1, timeoutMs: 200, pollMs: 5 });
    expect(firstResult.opened).toBe(true);

    // The rail reflowed: the cached coordinate now hovers something else,
    // so the cache re-verify must fail closed and re-scan rather than
    // clicking the wrong button.
    const second = stubChatPanelPage({
      evaluateSequence: [
        ['Settings'], // cache re-verify at the old point -- no longer Chat
        [{ cx: 10, cy: 356 }, { cx: 10, cy: 609 }], // fresh scan
        ['Components'],
        ['Chat']
      ]
    });
    const secondResult = await ensureChatPanelOpen(second.page, { hoverDelayMs: 1, timeoutMs: 200, pollMs: 5 });
    // The click landing on the freshly-scanned point (356, not the stale
    // 525) is the proof the fallback scan ran and found the right button --
    // labelsSeen is only attached on a failed attempt (see ChatPanelOpenResult).
    expect(secondResult.opened).toBe(true);
    expect(second.clicks).toEqual([[10, 609]]);
  });
});
