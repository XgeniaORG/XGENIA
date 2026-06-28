'use strict';

// Maps a hex hash string onto an inclusive [min, max] integer range by
// taking the first 8 hex chars as a 32-bit value and applying modulo.
// Shared by Calculate Roll and Validate Outcome.
//
// options.swapWhenInverted: if true, swaps min/max when min > max
// (Calculate Roll behaviour). Validate Outcome omits this.
function hashToRange(hash, min, max, options) {
  options = options || {};

  if (options.swapWhenInverted && min > max) {
    var temp = min;
    min = max;
    max = temp;
  }

  var hexSubset = String(hash == null ? '' : hash).substring(0, 8);
  var decimalValue = parseInt(hexSubset, 16);
  if (isNaN(decimalValue)) {
    decimalValue = 0;
  }

  var rangeSize = max - min + 1;
  return (decimalValue % rangeSize) + min;
}

module.exports = {
  hashToRange: hashToRange
};
