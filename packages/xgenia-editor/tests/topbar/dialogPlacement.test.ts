import { test } from 'node:test';
import assert from 'node:assert/strict';

// Lives with the editor's tests because that is where the one Node runner is; the module
// under test is pure and belongs to core-ui, which has no runner of its own.
import {
  placeDialog,
  PlacementDirection,
  PlacementRect
} from '../../../xgenia-core-ui/src/components/layout/BaseDialog/dialogPlacement';

const VIEWPORT = { width: 1440, height: 900 };
const GAP = 12;
const EDGE = 10;

const rect = (top: number, left: number, width = 200, height = 30): PlacementRect => ({
  top,
  left,
  right: left + width,
  bottom: top + height,
  width,
  height
});

const place = (trigger: PlacementRect, height: number, direction: PlacementDirection = 'below', width = 200) =>
  placeDialog({ trigger, dialog: { width, height }, viewport: VIEWPORT, direction, gap: GAP, edge: EDGE });

test('a dialog that fits is placed on the requested side and left uncapped', () => {
  const p = place(rect(400, 600), 150, 'below');
  assert.equal(p.y, 430 + GAP);
  assert.equal(p.maxHeight, null, 'a dialog that fits must not become a scroll container');
});

test('a dialog that does not fit below moves above when there is more room there', () => {
  const trigger = rect(700, 600);
  const p = place(trigger, 300, 'below');
  assert.ok(p.y < trigger.top, 'expected the dialog above the trigger');
  assert.equal(p.y + (p.maxHeight ?? 300), trigger.top - GAP);
});

test('above is not abandoned while it still fits', () => {
  // The old test subtracted the dialog height from a Y that had already had it
  // subtracted, so "above" gave way to "below" unless there was TWICE the height
  // overhead. 300 of content under a trigger 400 down has room and must stay above.
  const p = place(rect(400, 600), 300, 'above');
  assert.equal(p.y, 400 - GAP - 300);
  assert.equal(p.maxHeight, null);
});

test('a list taller than the screen is capped, never pushed off the top', () => {
  // The reported bug: a property panel select with more options than the space below it.
  // It used to land at a negative Y with its first rows unreachable — the dialog layer is
  // fixed and has no overflow, so those rows were gone, not scrolled away.
  const trigger = rect(650, 300);
  const p = place(trigger, 2000, 'below');
  assert.ok(p.y >= EDGE, `y ${p.y} is off the top of the screen`);
  assert.ok(p.maxHeight !== null, 'a dialog taller than the screen must be capped');
  assert.ok(p.y + (p.maxHeight as number) <= VIEWPORT.height - EDGE, 'ran off the bottom');
});

test('the cap is the room actually available on the chosen side', () => {
  const trigger = rect(100, 300);
  const p = place(trigger, 2000, 'below');
  // Below the trigger: everything from its bottom edge, less the gap and the margin.
  assert.equal(p.maxHeight, VIEWPORT.height - trigger.bottom - GAP - EDGE);
  assert.equal(p.y, trigger.bottom + GAP);
});

test('every direction stays inside the viewport, whatever the trigger and the height', () => {
  // Sweeps the space instead of pinning cases: the invariant is that a placement is always
  // reachable, and reachable means on screen.
  const directions: PlacementDirection[] = ['above', 'below', 'horizontal'];
  for (const direction of directions) {
    for (const top of [0, 5, 120, 449, 880, 899]) {
      for (const left of [0, 8, 700, 1300, 1439]) {
        for (const height of [20, 150, 460, 899, 901, 3000]) {
          for (const width of [40, 200, 900, 1500]) {
            const p = place(rect(top, left, 200, 30), height, direction, width);
            const h = p.maxHeight ?? height;
            const label = `${direction} @${top},${left} ${width}x${height}`;

            assert.ok(p.y >= EDGE - 0.001, `${label}: y ${p.y} above the top edge`);
            assert.ok(p.x >= EDGE - 0.001, `${label}: x ${p.x} left of the edge`);
            assert.ok(h <= VIEWPORT.height - EDGE * 2 + 0.001, `${label}: capped height ${h} exceeds the window`);
            if (width <= VIEWPORT.width - EDGE * 2) {
              assert.ok(p.x + width <= VIEWPORT.width - EDGE + 0.001, `${label}: runs off the right`);
            }
            if (h <= VIEWPORT.height - EDGE * 2) {
              assert.ok(p.y + h <= VIEWPORT.height - EDGE + 0.001, `${label}: runs off the bottom`);
            }
          }
        }
      }
    }
  }
});

test('a dialog wider or taller than the window pins to the edge rather than past it', () => {
  const p = placeDialog({
    trigger: rect(400, 600),
    dialog: { width: 4000, height: 4000 },
    viewport: VIEWPORT,
    direction: 'below',
    gap: GAP,
    edge: EDGE
  });
  assert.equal(p.x, EDGE);
  assert.ok(p.y >= EDGE);
});

test('the arrow keeps pointing at the trigger after the dialog is pushed off centre', () => {
  // Tacked to the left edge: the arrow has to travel back across the dialog to the trigger.
  const trigger = rect(400, 20, 60, 30);
  const p = place(trigger, 100, 'below', 400);
  assert.equal(p.x, EDGE);
  assert.equal(p.arrowX, trigger.left + trigger.width / 2 - EDGE);
});

test('the arrow never leaves the dialog it belongs to', () => {
  for (const left of [0, 400, 1400]) {
    const p = place(rect(400, left, 60, 30), 100, 'below', 200);
    assert.ok(p.arrowX >= 0 && p.arrowX <= 200, `arrowX ${p.arrowX} is outside the dialog`);
  }
});

test('beside the trigger, a dialog flips to the left when the right would overflow', () => {
  const p = place(rect(400, 1300, 100, 30), 200, 'horizontal', 300);
  assert.ok(p.x < 1300, 'expected the dialog to the left of the trigger');
  assert.equal(p.animationStartOffsetX, -10);
});

test('non-finite geometry falls to the edge instead of propagating NaN', () => {
  const p = placeDialog({
    trigger: rect(NaN, NaN),
    dialog: { width: 200, height: 100 },
    viewport: VIEWPORT,
    direction: 'below',
    gap: GAP,
    edge: EDGE
  });
  assert.equal(p.x, EDGE);
  assert.equal(p.y, EDGE);
});
