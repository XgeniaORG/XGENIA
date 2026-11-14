const fs = require('fs');
const path = require('path');

/**
 * The alias target for an optional module: `target` when it can be resolved (a file, with or
 * without a script extension, or a folder holding an index), otherwise `stub`.
 */
function optionalAlias(target, stub) {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx'];
  for (const ext of exts) {
    const file = target + ext;
    try {
      if (fs.statSync(file).isFile()) return target;
    } catch {
      // not there
    }
  }
  for (const ext of exts.slice(1)) {
    if (fs.existsSync(path.join(target, 'index' + ext))) return target;
  }
  return stub;
}

module.exports = { optionalAlias };
