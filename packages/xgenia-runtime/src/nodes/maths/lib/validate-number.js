'use strict';

// Default bounds shared by the math nodes (±1e12).
const MAX_VALUE = 1000000000000;
const MIN_VALUE = -1000000000000;

// Coerces `value` to a finite number, throwing if it is not numeric.
function validateNumber(value) {
  const num = Number(value);
  if (isNaN(num)) {
    throw new Error('Input must be a valid number');
  }
  return num;
}

// As validateNumber, but also rejects values outside [min, max].
// Bounds default to the historical ±1e12 range; pass an explicit `min`
// (e.g. 0) for nodes that only accept non-negative input.
function validateBoundedNumber(value, min, max) {
  if (min === undefined) min = MIN_VALUE;
  if (max === undefined) max = MAX_VALUE;
  const num = validateNumber(value);
  if (num > max) {
    throw new Error(`Input cannot exceed ${max}`);
  }
  if (num < min) {
    throw new Error(`Input cannot be less than ${min}`);
  }
  return num;
}

module.exports = {
  validateNumber: validateNumber,
  validateBoundedNumber: validateBoundedNumber,
  MAX_VALUE: MAX_VALUE,
  MIN_VALUE: MIN_VALUE
};
