/**
 * Does an update's file list carry a build for THIS machine?
 *
 * (2026-10-07) The published V3.0.1 macOS feed (latest-mac.yml) listed only the x64 zip and dmg — the
 * arm64 files sat in a separate latest-mac-arm.yml the updater never reads. Every Apple Silicon Mac was
 * offered the Intel build (and a zip the release did not even carry), on every start. An update whose
 * macOS files name an architecture but none for this one is not this machine's update.
 */
function updateFitsThisMachine(files, platform = process.platform, arch = process.arch) {
  if (platform !== 'darwin' || !Array.isArray(files) || files.length === 0) return true;
  const urls = files.map((f) => String((f && (f.url || f.name)) || '')).filter(Boolean);
  const named = urls.filter((u) => /(arm64|x64|universal)/i.test(u));
  if (named.length === 0) return true; // no architecture in the names: nothing to judge
  return named.some((u) => new RegExp(`(${arch}|universal)`, 'i').test(u));
}

module.exports = { updateFitsThisMachine };
