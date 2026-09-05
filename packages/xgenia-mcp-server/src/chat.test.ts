import { describe, it, expect } from 'vitest';
import { parseTranscript } from './chat.js';

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
});
