const os = require('os');

/**
 * Who may use the preview relay (the WebSocket on the web server's port that carries editor <-> viewer
 * messages, including code the editor asks a viewer to run).
 *
 * Browsers always send an Origin with a WebSocket handshake, and CORS does not apply to WebSockets, so
 * without this any web page open in the user's browser could connect. Allowed: no Origin (Node clients),
 * file:// pages (the packaged editor, the cloud runtime), pages on this machine's loopback, and pages
 * served by this machine to the LAN (a phone previewing over Wi-Fi). Refused: everything else,
 * including "null" (a sandboxed iframe on any site).
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function ownAddresses() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces() || {})) {
    for (const a of list || []) if (a && a.address) out.add(a.address);
  }
  return out;
}

function hostOf(origin) {
  try {
    const u = new URL(origin);
    return { protocol: u.protocol, host: u.hostname.replace(/^\[|\]$/g, '') };
  } catch {
    return null;
  }
}

function originAllowed(origin, localAddresses = ownAddresses()) {
  if (origin === undefined || origin === '') return true;
  if (origin === 'file://') return true;
  const o = hostOf(origin);
  if (!o) return false;
  if (o.protocol === 'file:') return true;
  if (o.protocol !== 'http:' && o.protocol !== 'https:') return false;
  return LOOPBACK_HOSTS.has(o.host) || localAddresses.has(o.host);
}

function isLoopbackAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/**
 * The editor and service roles drive viewers (refresh, model updates, runtime evaluation): only a
 * client on this machine, from a local page, may take them. Viewers may connect from the LAN.
 */
function mayRegisterAs(type, remoteAddress, origin) {
  if (type !== 'editor' && type !== 'service') return true;
  if (!isLoopbackAddress(remoteAddress)) return false;
  if (origin === undefined || origin === '' || origin === 'file://') return true;
  const o = hostOf(origin);
  return !!o && (o.protocol === 'file:' || LOOPBACK_HOSTS.has(o.host));
}

module.exports = { originAllowed, mayRegisterAs, isLoopbackAddress };
