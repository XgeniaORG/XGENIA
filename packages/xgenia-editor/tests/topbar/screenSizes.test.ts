import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deviceSizesWithDividers,
  getScreenSizeObjectFromMeasurements,
  isMachineGroup,
  machineFamilies,
  machineSizesWithDividers,
  ScreenSize,
  screenSizes,
  screenSizesWithDividers,
  sizesForSurface,
  surfaceOfGroup
} from '../../src/editor/src/views/EditorTopbar/ScreenSizes';
import { FRAME_MAX_W, FRAME_MAX_H, FRAME_MIN } from '../../src/editor/src/views/VisualCanvas/frameSnap';

const sizesIn = (list: (ScreenSize | 'divider')[]) => list.filter((e): e is ScreenSize => typeof e !== 'string');

// Sweeps over the whole preset table rather than pinning the presets that exist today:
// rows get added and renamed constantly, and it is the RULES that keep breaking.

test('a preset is identified by its name, so names are unique', () => {
  const names = screenSizes.map((s) => s.name);
  assert.deepEqual([...new Set(names)], names);
});

test('every preset resolves back to itself when its own name is given', () => {
  // Sizes repeat, and not only across the machine families: Pixel 8 and Galaxy S24 Ultra
  // are both 412x915 in the device list that shipped long before this. So uniqueness of
  // MEASUREMENTS is not the invariant and never was — round-tripping the name is.
  for (const preset of screenSizes) {
    const resolved = getScreenSizeObjectFromMeasurements(preset.width, preset.height, preset.name);
    assert.equal(resolved.name, preset.name, `${preset.name} resolved to ${resolved.name}`);
  }
});

test('every preset fits the frame the canvas will let you drag', () => {
  // A preset the drag clamp cannot reach is a size you can pick and then never restore
  // by hand — this is what caught the 2160 height cap when portrait 4K arrived.
  for (const s of screenSizes) {
    if (!s.width) continue;
    assert.ok(s.width >= FRAME_MIN && s.width <= FRAME_MAX_W, `${s.name} width ${s.width} out of frame bounds`);
    assert.ok(s.height >= FRAME_MIN && s.height <= FRAME_MAX_H, `${s.name} height ${s.height} out of frame bounds`);
  }
});

test('the two surfaces partition the presets, both headed by Fit viewport', () => {
  for (const surface of ['device', 'machine'] as const) {
    const list = sizesForSurface(surface);
    assert.equal((list[0] as ScreenSize).name, 'Fit viewport');
    for (const s of sizesIn(list)) {
      if (s.group === 'Editor') continue;
      assert.equal(surfaceOfGroup(s.group), surface, `${s.name} is in the wrong list`);
    }
  }
});

test('every family preset reaches both the machine list and the full list', () => {
  for (const family of machineFamilies) {
    for (const preset of family.presets) {
      assert.ok(isMachineGroup(preset.group), `${preset.name} is not in a machine group`);
      assert.ok(sizesIn(machineSizesWithDividers).includes(preset), `${preset.name} missing from the machine list`);
      assert.ok(sizesIn(screenSizesWithDividers).includes(preset), `${preset.name} missing from the full list`);
    }
  }
});

test('a family label sits above each family, and only the first row carries one', () => {
  // FrameChip finds the label by identity of the family's FIRST preset. Two families
  // sharing a preset object, or an empty family, would silently lose their heading.
  const firsts = machineFamilies.map((f) => f.presets[0]);
  assert.deepEqual([...new Set(firsts)], firsts);
  for (const family of machineFamilies) {
    assert.ok(family.presets.length > 0, `${family.label} has no presets`);
    assert.ok(family.label.length > 0);
  }
});

test('a shared size resolves by the name the user actually picked', () => {
  const byName = getScreenSizeObjectFromMeasurements(1080, 1920, 'Betting terminal');
  assert.equal(byName.name, 'Betting terminal');
  assert.equal(byName.group, 'Betting');

  const slot = getScreenSizeObjectFromMeasurements(1080, 1920, 'Slot portrait FHD');
  assert.equal(slot.group, 'Slot');
});

test('without a name, a shared size still resolves to the device preset', () => {
  // Projects saved before machines existed have measurements and nothing else. Their
  // chip must keep saying what it said.
  assert.equal(getScreenSizeObjectFromMeasurements(1920, 1080).name, 'Full HD 1080p');
  assert.equal(getScreenSizeObjectFromMeasurements(3840, 2160).name, '4K UHD');
});

test('a stale or mismatched name never overrides the measurements', () => {
  // The name is a tie-breaker among presets of that exact size, not a source of truth:
  // a renamed preset, or a name saved against a size since edited, must not win.
  assert.equal(getScreenSizeObjectFromMeasurements(1920, 1080, 'Slot portrait FHD').name, 'Full HD 1080p');
  assert.equal(getScreenSizeObjectFromMeasurements(1234, 567, 'Betting terminal').name, 'Custom');
});

test('unknown sizes are Custom and no size at all is Fit viewport', () => {
  assert.equal(getScreenSizeObjectFromMeasurements(1234, 567).name, 'Custom');
  assert.equal(getScreenSizeObjectFromMeasurements(null, null).name, 'Fit viewport');
});
