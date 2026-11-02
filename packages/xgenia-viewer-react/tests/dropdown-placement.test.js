// The Dropdown's option list is drawn in a fixed layer on <body>, so its position is computed
// from the field's viewport rect. The preview zooms the document and games scale their stage,
// which is exactly where the native popup it replaces opened far away from the field.
const { placeDropdown } = require('../src/components/controls/Select/placement');

function place(overrides) {
  return placeDropdown({
    field: { left: 100, top: 200, right: 300, bottom: 240 },
    fieldScale: 1,
    layerScale: 1,
    layerLeft: 0,
    layerTop: 0,
    viewportHeight: 800,
    contentHeight: 150,
    maxHeight: 240,
    offset: 4,
    ...overrides
  });
}

describe('dropdown list placement', () => {
  test('opens under the field, as wide as the field', () => {
    expect(place()).toEqual({ left: 100, top: 244, width: 200, maxHeight: 240, scale: 1, above: false });
  });

  test('a zoomed document: viewport pixels are converted back to layer CSS pixels', () => {
    // zoom: 0.5 on <html> halves both the field and the layer.
    const p = place({ field: { left: 50, top: 100, right: 150, bottom: 120 }, fieldScale: 0.5, layerScale: 0.5 });
    expect(p).toMatchObject({ left: 100, top: 244, width: 200, scale: 1, above: false });
  });

  test('a scaled stage: the list is scaled to match the field', () => {
    // The field sits in a scale(0.5) stage; the layer on <body> is not scaled.
    const p = place({ field: { left: 50, top: 100, right: 150, bottom: 120 }, fieldScale: 0.5 });
    expect(p.width).toBe(200); // the field's own CSS width
    expect(p.scale).toBe(0.5);
    expect(p.left).toBe(50);
    expect(p.top).toBe(122); // 4px gap at half size
  });

  test('zoom and stage scale together', () => {
    const p = place({ field: { left: 40, top: 80, right: 120, bottom: 96 }, fieldScale: 0.4, layerScale: 0.8 });
    expect(p.scale).toBeCloseTo(0.5);
    expect(p.left).toBeCloseTo(50);
    expect(p.top).toBeCloseTo((96 + 4 * 0.4) / 0.8);
    expect(p.width).toBeCloseTo(200);
  });

  test('a layer whose origin is not the viewport origin', () => {
    expect(place({ layerLeft: 10, layerTop: 20 })).toMatchObject({ left: 90, top: 224 });
  });

  test('opens upwards when it does not fit below and there is more room above', () => {
    const p = place({ field: { left: 100, top: 700, right: 300, bottom: 740 } });
    expect(p.above).toBe(true);
    expect(p.top).toBe(700 - 4 - 150);
  });

  test('stays below when the room above is no better', () => {
    const p = place({ field: { left: 100, top: 60, right: 300, bottom: 100 }, viewportHeight: 200 });
    expect(p.above).toBe(false);
    expect(p.maxHeight).toBe(200 - 100 - 4 - 8);
  });

  test('caps the height at Max Height and at the room available', () => {
    expect(place({ contentHeight: 600 }).maxHeight).toBe(240);
    expect(place({ contentHeight: 600, maxHeight: 1000 }).maxHeight).toBe(800 - 240 - 4 - 8);
  });

  test('the room is measured in the field CSS pixels when the field is scaled', () => {
    const p = place({ field: { left: 50, top: 100, right: 150, bottom: 120 }, fieldScale: 0.5, contentHeight: 2000, maxHeight: 5000 });
    expect(p.maxHeight).toBe((800 - 120 - 2 - 8) / 0.5);
  });
});
