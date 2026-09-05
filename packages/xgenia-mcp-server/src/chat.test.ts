import { describe, it, expect } from 'vitest';
import type { Frame } from 'playwright-core';
import { parseTranscript, readStructuredMessages, resolveReadWindow } from './chat.js';
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
