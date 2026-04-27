const path = require('path');

// Normalize any provided OUT_PATH/OUTPUT_PATH to real filesystem casing (prevents duplicate modules on Windows)
function normalizeOutPath(p) {
  try {
    // Resolve relative segments then normalize to native real path if it exists
    const resolved = path.resolve(p);
    // fs.realpathSync.native is only available in Node >=9, fallback to fs.realpathSync
    const fs = require('fs');
    if (fs.existsSync(resolved)) {
      return (fs.realpathSync.native ? fs.realpathSync.native(resolved) : fs.realpathSync(resolved));
    }
    return resolved;
  } catch (_) {
    return p;
  }
}

const envOut = process.env.OUT_PATH || process.env.OUTPUT_PATH;
const defaultOut = path.resolve(__dirname, '../../xgenia-editor/src/external');

module.exports = {
  // Allows to define the output path of the files built by the viewer.
  // For example in the CLI, we will also build this, just with a different output path.
  outPath: normalizeOutPath(envOut || defaultOut)
};
