// Group's Design Width/Height: clearing really clears, and the "inert design size" warning
// goes away by the fixes its own text suggests (export 1794602677537: 60 calls failed to clear it).
const { designSizeValue, hasInertDesignSize } = require('../src/components/visual/Group/design-size');

test('cleared values are unset, not the default', () => {
  for (const v of [undefined, null, '', 0, -5, 'abc']) expect(designSizeValue(v)).toBeUndefined();
  expect(designSizeValue('1338')).toBe(1338);
  expect(designSizeValue(630)).toBe(630);
});

test('warns only for a chosen, non-default size while scaling is off', () => {
  expect(hasInertDesignSize(false, 1931, 1121)).toBe(true);
  expect(hasInertDesignSize(false, 1338, undefined)).toBe(true);
  expect(hasInertDesignSize(true, 1931, 1121)).toBe(false);
});

test('every fix the warning names clears it', () => {
  expect(hasInertDesignSize(false, undefined, undefined)).toBe(false); // cleared
  expect(hasInertDesignSize(false, designSizeValue(null), designSizeValue(''))).toBe(false);
  expect(hasInertDesignSize(false, designSizeValue(0), designSizeValue(0))).toBe(false);
  expect(hasInertDesignSize(false, 1920, 1080)).toBe(false); // the default every Group has
});

const { hasRealTranslate } = require('../src/components/visual/Group/design-size');
test('a zero translate is not a move; anything else is', () => {
  expect(hasRealTranslate('translateX(0px) translateY(0px) scale(1, 1)')).toBe(false);
  expect(hasRealTranslate('translate(0, 0%)')).toBe(false);
  expect(hasRealTranslate('')).toBe(false);
  expect(hasRealTranslate('translateX(12px)')).toBe(true);
  expect(hasRealTranslate('translateY(-0.5em)')).toBe(true);
  expect(hasRealTranslate('translateX(calc(100% - 4px))')).toBe(true);
  expect(hasRealTranslate('translateX([object Object])')).toBe(true);
});
