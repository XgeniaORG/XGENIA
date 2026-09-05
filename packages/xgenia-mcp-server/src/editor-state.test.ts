import { describe, it, expect, beforeEach } from 'vitest';
import { busySince, resetBusyTracking, summariseMessages } from './editor-state.js';

beforeEach(() => resetBusyTracking());

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
