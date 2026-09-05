import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePillState, LIVE_HOLD_MS, FAILED_HOLD_MS, PillInputs } from '../../src/editor/src/views/EditorTopbar/topbar/statusPillState';

const base: PillInputs = {
  route: '/#/lobby',
  surface: 'viewport',
  browser: { active: false, url: '' },
  warnings: 0,
  ai: { active: false, label: '' },
  publish: { phase: 'idle' },
  typing: null,
  now: 10_000
};

test('idle by default', () => {
  assert.deepEqual(derivePillState(base), { kind: 'idle', route: '/#/lobby', surface: 'viewport', browserActive: false, warnings: 0 });
});

test('warnings pass through every state', () => {
  assert.equal(derivePillState({ ...base, warnings: 2 }).warnings, 2);
  assert.equal(derivePillState({ ...base, warnings: 2, ai: { active: true, label: 'x' } }).warnings, 2);
  assert.equal(derivePillState({ ...base, warnings: 2, typing: 'ph' }).warnings, 2);
});

test('typing beats everything', () => {
  const s = derivePillState({ ...base, typing: 'phone', publish: { phase: 'publishing', label: 'x' }, ai: { active: true, label: 'y' } });
  assert.equal(s.kind, 'typing');
  assert.equal((s as any).text, 'phone');
});

test('publishing beats ai and browsing', () => {
  const s = derivePillState({ ...base, publish: { phase: 'publishing', label: 'Deploying to Vercel...' }, ai: { active: true, label: 'y' }, browser: { active: true, url: 'https://a' }, surface: 'browser' });
  assert.deepEqual(s, { kind: 'publishing', label: 'Deploying to Vercel...', warnings: 0 });
});

test('publishing without label uses default', () => {
  assert.equal((derivePillState({ ...base, publish: { phase: 'publishing' } }) as any).label, 'Publishing…');
});

test('live holds for LIVE_HOLD_MS then relaxes to idle', () => {
  const live = { phase: 'live' as const, url: 'https://x.vercel.app', changedAt: 10_000 };
  assert.equal(derivePillState({ ...base, publish: live, now: 10_000 + LIVE_HOLD_MS - 1 }).kind, 'live');
  assert.equal(derivePillState({ ...base, publish: live, now: 10_000 + LIVE_HOLD_MS }).kind, 'idle');
});

test('failed holds for FAILED_HOLD_MS, label truncated to 60 chars', () => {
  const long = 'x'.repeat(100);
  const failed = { phase: 'failed' as const, error: long, changedAt: 10_000 };
  const s = derivePillState({ ...base, publish: failed, now: 10_000 });
  assert.equal(s.kind, 'failed');
  assert.equal((s as any).label.length, 60);
  assert.equal(derivePillState({ ...base, publish: failed, now: 10_000 + FAILED_HOLD_MS }).kind, 'idle');
});

test('failed without error has a default label', () => {
  assert.equal((derivePillState({ ...base, publish: { phase: 'failed', changedAt: 10_000 } }) as any).label, 'Publish failed');
});

test('ai beats browsing', () => {
  const s = derivePillState({ ...base, ai: { active: true, label: 'Building reel strip' }, browser: { active: true, url: 'https://a' }, surface: 'browser' });
  assert.deepEqual(s, { kind: 'ai', label: 'Building reel strip', warnings: 0 });
});

test('ai without label falls back', () => {
  assert.equal((derivePillState({ ...base, ai: { active: true, label: '' } }) as any).label, 'AI working');
});

test('browsing requires active browser AND browser surface', () => {
  assert.equal(derivePillState({ ...base, browser: { active: true, url: 'https://framer.com' }, surface: 'browser' }).kind, 'browsing');
  const idle = derivePillState({ ...base, browser: { active: true, url: 'https://framer.com' }, surface: 'viewport' });
  assert.equal(idle.kind, 'idle');
  assert.equal((idle as any).browserActive, true);
});

test('browsing url is host only', () => {
  const s = derivePillState({ ...base, browser: { active: true, url: 'https://www.framer.com/marketplace?x=1' }, surface: 'browser' });
  assert.equal((s as any).url, 'framer.com');
});

// --- regression tests added after the adversarial review ---
import { hostOf } from '../../src/editor/src/views/EditorTopbar/topbar/statusPillState';

test('hostOf never returns an empty string for an authority-less URL', () => {
  for (const u of ['about:blank', 'localhost:3000', 'file:///Users/x/index.html', 'mailto:a@b.com']) {
    assert.equal(hostOf(u), u, `blanked: ${u}`);
  }
  assert.equal(hostOf('https://www.framer.com/x?y=1'), 'framer.com');
});

test('hostOf caps length so it cannot overrun the pill', () => {
  const long = 'not a url ' + 'x'.repeat(300);
  const out = hostOf(long);
  assert.ok(out.length <= 48, `too long: ${out.length}`);
  assert.ok(out.endsWith('…'));
});

test('failed state survives a missing or non-finite changedAt', () => {
  for (const changedAt of [undefined, NaN]) {
    const s = derivePillState({ ...base, publish: { phase: 'failed', error: 'boom', changedAt } as any });
    assert.equal(s.kind, 'failed', `hidden for changedAt=${changedAt}`);
    assert.equal((s as any).label, 'boom');
  }
});

test('failure label truncation never splits a surrogate pair', () => {
  const err = 'x'.repeat(59) + '\u{1F4A5}';
  const s = derivePillState({ ...base, publish: { phase: 'failed', error: err, changedAt: 10_000 } });
  const label = (s as any).label as string;
  assert.equal(Array.from(label).length, 60);
  assert.ok(!/[\uD800-\uDBFF]$/.test(label), 'ends in a lone high surrogate');
  assert.ok(label.endsWith('\u{1F4A5}'));
});
