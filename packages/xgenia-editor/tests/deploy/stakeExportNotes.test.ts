import { test } from 'node:test';
import assert from 'node:assert/strict';

import { stakeExportNotes } from '../../src/editor/src/utils/stake/stakeExportNotes';

// (2026-11-05) Stake's own tooling refuses to simulate a mode at 100% RTP or more and flags modes whose RTPs
// differ by more than 0.05 (stake-sdk BetMode, rgs_verification.py). A finished export says so as a note —
// it is the studio's call, not a reason to throw the books away.
test('a finished export notes what Stake will question, and says nothing otherwise', () => {
  const mode = (name: string, rtp: number) => ({ mode: { name }, stats: { rtp } });
  assert.deepEqual(stakeExportNotes([mode('base', 0.96), mode('buy_bonus', 0.962)]), []);
  const over = stakeExportNotes([mode('base', 1.02)]);
  assert.equal(over.length, 1);
  assert.match(over[0], /base returns 102\.00% — Stake approves modes under 100%/);
  const apart = stakeExportNotes([mode('base', 0.9), mode('buy_bonus', 0.97)]);
  assert.match(apart[0], /differ by more than 5 points \(base 90\.00%, buy_bonus 97\.00%\)/);
});
