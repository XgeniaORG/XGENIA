// The engine API this app build speaks. A live engine declares the shell it was built for
// (manifest.minShell, from packages/xgenia-viewer-react/engine-compat.json) and runs only on that
// exact shell: a newer engine may need editor support this app lacks, an older one is older than the
// engine this app ships with. Bump BOTH in the same PR when an engine change needs an editor change:
// a new WebSocket message the editor must handle, a new deploy/index.json shape, a new file the
// editor must read. (2026-10-03; exact match since the 2026-10-04 review)
module.exports = { SHELL_API_VERSION: 1 };
