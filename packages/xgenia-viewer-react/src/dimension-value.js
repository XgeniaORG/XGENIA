/**
 * Join a `{value, unit}` dimension into a CSS length.
 *
 * WHY THIS EXISTS (2026-08-15, user: "it did not set 800% — it set 800PX, and % was the
 * type"): a dimension is stored as `{value, unit}` and was applied everywhere by raw
 * concatenation, `value.value + value.unit`. When the value already carries a unit that
 * produces `"800px" + "%"` = `"800px%"`, which is not a CSS length — the browser drops the
 * whole declaration and the element falls back to auto, while the stored parameter still
 * looks perfectly well-formed to anything that inspects its shape.
 *
 * The repair was first written inline in ONE setter. A sweep found 25 sites doing the same
 * concatenation across width/height, transforms, transform-origin, padding, margin, box
 * shadows and blur — including a second one in the very file that had been "fixed". Hence
 * a shared helper rather than an edit: the point of the family is that fixing one instance
 * of it is not fixing it.
 *
 * Trust a unit written into the value: someone who typed "800px" meant 800px, and the unit
 * dropdown is the field they did not touch. Repairing at APPLY time means an already
 * corrupted project renders correctly on the next frame rather than needing a migration.
 *
 * @param {*} value        `{value, unit}`, or a bare number/string.
 * @param {string} [fallbackUnit='px'] unit for a bare value that has no unit of its own.
 * @returns {string|*} a CSS length string, or the input unchanged when it is not a
 *                     dimension shape at all (so callers keep their own null handling).
 */
export function joinDimensionValue(value, fallbackUnit) {
  var fallback = fallbackUnit === undefined ? 'px' : fallbackUnit;

  if (value === null || value === undefined) return value;

  var raw = value;
  var unit = fallback;
  if (typeof value === 'object' && !Array.isArray(value) && value.value !== undefined) {
    raw = value.value;
    unit = value.unit === undefined || value.unit === null ? fallback : value.unit;
  }

  if (typeof raw === 'string') {
    var s = raw.trim();
    if (s === '') return s;
    // "800px", "50%", "10vh", "calc(...)", "min(...)" — already a complete length.
    if (/[a-z%)]$/i.test(s)) return s;
    // A numeric string still wants the unit beside it.
    if (/^-?\d*\.?\d+$/.test(s)) return s + unit;
    return s;
  }

  if (typeof raw === 'number') {
    return isFinite(raw) ? raw + unit : raw;
  }

  return value;
}

export default joinDimensionValue;
