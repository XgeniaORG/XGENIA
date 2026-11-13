import { describe, expect, it } from 'vitest';
import { workersToRelease } from './worker-resume.js';

describe('workersToRelease', () => {
  const url = 'ws://x';
  it('picks new workers only', () => {
    const seen = new Set(['old']);
    const picked = workersToRelease(
      [
        { id: 'old', type: 'worker', webSocketDebuggerUrl: url },
        { id: 'new', type: 'worker', webSocketDebuggerUrl: url },
        { id: 'page', type: 'page', webSocketDebuggerUrl: url }
      ],
      seen
    );
    expect(picked.map((t) => t.id)).toEqual(['new']);
  });
});
