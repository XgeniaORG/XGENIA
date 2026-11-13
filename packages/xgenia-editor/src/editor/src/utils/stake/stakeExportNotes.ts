// Dependency-free, like stakeMathsFormat.ts, so it is unit-tested under plain Node
// (tests/deploy/stakeExportNotes.test.ts).

/**
 * What a finished export should say beyond "done" — never a refusal. The stake-sdk refuses to simulate
 * a mode at 100% RTP or more (BetMode, rtp < 1.0) and warns when two modes' RTPs differ by more than
 * 0.05 ("exceeds allowed difference for approvals", rgs_verification.py); both are the studio's call.
 */
export function stakeExportNotes(modes: { mode: { name: string }; stats: { rtp: number } }[]): string[] {
  const notes: string[] = [];
  for (const m of modes) {
    if (m.stats.rtp >= 1) {
      notes.push(`${m.mode.name} returns ${(m.stats.rtp * 100).toFixed(2)}% — Stake approves modes under 100%.`);
    }
  }
  const rtps = modes.map((m) => m.stats.rtp);
  if (rtps.length > 1 && Math.max(...rtps) - Math.min(...rtps) > 0.05) {
    notes.push(
      `The modes' returns differ by more than 5 points (${modes.map((m) => `${m.mode.name} ${(m.stats.rtp * 100).toFixed(2)}%`).join(', ')}); ` +
        "Stake's approval check flags that."
    );
  }
  return notes;
}
