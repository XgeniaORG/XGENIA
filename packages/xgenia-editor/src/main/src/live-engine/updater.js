// Fetch the channel's signed manifest and, when it names an engine this app can run and has not
// got, download and verify it into the store as `pending` — activated at the next start, never
// mid-session. Never throws: returns what happened. (2026-10-03)
'use strict';
const zlib = require('zlib');
const { verifyManifest } = require('./manifest');

const ENGINE_CDN = 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine';

// Files are stored gzipped. A CDN that decodes on the way (content-encoding) hands back the plain
// bytes; the store's hash check decides either way.
const unpack = (buf) => (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf);

async function checkForEngineUpdate({ store, channel, fetchBytes, publicKeyPem, shellApi, cdn = ENGINE_CDN }) {
  let raw;
  let sig;
  try {
    raw = await fetchBytes(`${cdn}/channels/${channel}/manifest.json`);
    sig = (await fetchBytes(`${cdn}/channels/${channel}/manifest.sig`)).toString('utf8');
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
  if (state.accepted && Date.parse(m.issuedAt) < Date.parse(state.accepted.issuedAt)) {
    return { status: 'rejected', reason: `issued ${m.issuedAt}, older than the accepted ${state.accepted.issuedAt} (replay)` };
  }
  if (state.bad.includes(m.version)) return { status: 'rejected', reason: `${m.version} failed on this machine before` };
  if (m.minShell > shellApi) {
    state.needsAppUpdate = m.version;
    store.writeState(state);
    return { status: 'needs-app-update', version: m.version, reason: `engine needs app shell ${m.minShell}, this app is ${shellApi}` };
  }
  if (m.version === state.active || m.version === state.pending) {
    state.accepted = { version: m.version, issuedAt: m.issuedAt };
    store.writeState(state);
    return { status: 'up-to-date', version: m.version };
  }
  try {
    await store.install(raw, sig, m, async (f) => unpack(await fetchBytes(m.filesBase + f.path + '.gz')));
  } catch (e) {
    return { status: 'error', version: m.version, reason: e.message };
  }
  const after = store.readState(); // the download is slow; re-read before writing
  after.pending = m.version;
  after.accepted = { version: m.version, issuedAt: m.issuedAt };
  after.needsAppUpdate = null;
  store.writeState(after);
  return { status: 'installed', version: m.version };
}

module.exports = { checkForEngineUpdate, ENGINE_CDN };
