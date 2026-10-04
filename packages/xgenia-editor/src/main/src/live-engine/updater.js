// Fetch the channel's signed manifest and, when it names an engine this app can run and has not
// got, download and verify it into the store as `pending` — activated at the next start, never
// mid-session. Never throws: returns what happened. (2026-10-03)
'use strict';
const zlib = require('zlib');
const { verifyManifest } = require('./manifest');

const ENGINE_CDN = 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine';

// Every download has a byte cap, and inflating never goes past the size the signed manifest lists,
// so whoever can write the bucket (a weaker key than the signing key) cannot exhaust memory.
const MANIFEST_MAX = 1024 * 1024;
const SIG_MAX = 1024;
const fileCap = (size) => size + Math.ceil(size / 100) + 1024;

// Files are stored gzipped. A CDN that decodes on the way (content-encoding) hands back the plain
// bytes; the store's hash check decides either way.
const unpack = (buf, size) =>
  buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf, { maxOutputLength: Math.max(1, size) }) : buf;

async function checkForEngineUpdate({ store, channel, fetchBytes, publicKeyPem, shellApi, cdn = ENGINE_CDN }) {
  let raw;
  let sig;
  try {
    raw = await fetchBytes(`${cdn}/channels/${channel}/manifest.json`, MANIFEST_MAX);
    sig = (await fetchBytes(`${cdn}/channels/${channel}/manifest.sig`, SIG_MAX)).toString('utf8');
  } catch (e) {
    return { status: 'error', reason: e.message };
  }
  let m;
  try {
    m = verifyManifest(raw, sig, publicKeyPem);
  } catch (e) {
    return { status: 'rejected', reason: e.message };
  }
  if (m.channel !== channel) return { status: 'rejected', reason: `manifest is for ${m.channel}, this app follows ${channel}` };

  const state = store.readState();
  const floor = state.accepted[channel];
  if (floor && Date.parse(m.issuedAt) < Date.parse(floor.issuedAt)) {
    return { status: 'rejected', reason: `issued ${m.issuedAt}, older than the accepted ${floor.issuedAt} (replay)` };
  }
  if (state.bad.includes(m.version)) return { status: 'rejected', reason: `${m.version} failed on this machine before` };
  if (m.minShell > shellApi) {
    state.needsAppUpdate = m.version;
    store.writeState(state);
    return { status: 'needs-app-update', version: m.version, reason: `engine needs app shell ${m.minShell}, this app is ${shellApi}` };
  }
  if (m.minShell < shellApi) {
    return { status: 'older-than-app', version: m.version, reason: `engine was built for app shell ${m.minShell}, this app is ${shellApi}` };
  }
  if (m.version === state.active || m.version === state.pending) {
    // The channel names what already runs (a rollback): an engine waiting for restart is cancelled.
    if (m.version === state.active) state.pending = null;
    state.accepted = { ...state.accepted, [channel]: { version: m.version, issuedAt: m.issuedAt } };
    store.writeState(state);
    return { status: 'up-to-date', version: m.version };
  }
  try {
    await store.install(raw, sig, m, async (f) => unpack(await fetchBytes(m.filesBase + f.path + '.gz', fileCap(f.size)), f.size));
  } catch (e) {
    return { status: 'error', version: m.version, reason: e.message };
  }
  const after = store.readState(); // the download is slow; re-read before writing
  after.pending = m.version;
  after.accepted = { ...after.accepted, [channel]: { version: m.version, issuedAt: m.issuedAt } };
  after.needsAppUpdate = null;
  store.writeState(after);
  return { status: 'installed', version: m.version };
}

module.exports = { checkForEngineUpdate, ENGINE_CDN };
