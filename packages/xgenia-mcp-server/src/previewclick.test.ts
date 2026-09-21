import { describe, it, expect } from 'vitest';
import { pickTarget } from './previewclick.js';

// The bug this encodes cost a real verification run: five clicks aimed at "SPIN" landed on
// the win ledger's "No wins yet — spin to populate", because that paragraph contains the
// word and is smaller than the button. Nothing moved, which reads exactly like a broken
// game — a verification tool that presses the wrong thing manufactures false defects.
describe('pickTarget', () => {
  const screen = [
    { text: 'No wins yet — spin to populate', area: 4_000 },
    { text: 'SPIN', area: 9_000 },
    { text: 'CONTROLS\nSPIN\nBet: 1.00', area: 90_000 }
  ];

  it('prefers an exact match over a smaller substring match', () => {
    const r = pickTarget(screen, 'SPIN');
    expect(r).not.toBeNull();
    expect(screen[r!.index]!.text).toBe('SPIN');
    expect(r!.matchKind).toBe('exact');
  });

  it('is case-insensitive', () => {
    expect(screen[pickTarget(screen, 'spin')!.index]!.text).toBe('SPIN');
  });

  it('falls back to substring and says so', () => {
    const r = pickTarget([{ text: 'Place your bet now', area: 500 }], 'bet');
    expect(r!.matchKind).toBe('substring');
  });

  it('takes the smallest among equals, not a containing panel', () => {
    const r = pickTarget(
      [
        { text: 'SPIN', area: 90_000 },
        { text: 'SPIN', area: 9_000 }
      ],
      'SPIN'
    );
    expect(r!.index).toBe(1);
  });

  it('returns null when nothing matches, rather than clicking something arbitrary', () => {
    expect(pickTarget(screen, 'COLLECT')).toBeNull();
  });
});
