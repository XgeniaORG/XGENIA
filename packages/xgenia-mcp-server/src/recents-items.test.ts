import { describe, it, expect } from 'vitest';
import { recentsItems } from './debug-export.js';

// (2026-09-23) The real file leads with a boolean; the old parse took it as the list.
describe('recentsItems', () => {
  it('reads recentProjects even when another key comes first', () => {
    const raw = { thumbsMigratedV1: true, recentProjects: [{ retainedProjectDirectory: '/p/Particle Lab' }] };
    expect(recentsItems(raw)).toEqual([{ retainedProjectDirectory: '/p/Particle Lab' }]);
  });
  it('accepts a bare array and never returns a non-array', () => {
    expect(recentsItems([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(recentsItems({ flag: true })).toEqual([]);
    expect(recentsItems(null)).toEqual([]);
  });
});
