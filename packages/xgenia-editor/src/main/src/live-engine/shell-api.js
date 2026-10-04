// What this app build can host. A live engine declares the lowest it needs (manifest.minShell, from
// packages/xgenia-viewer-react/engine-compat.json). Bump BOTH in the same PR when an engine change
// needs an editor change: a new WebSocket message the editor must handle, a new deploy/index.json
// shape, a new file the editor must read. (2026-10-03)
module.exports = { SHELL_API_VERSION: 1 };
