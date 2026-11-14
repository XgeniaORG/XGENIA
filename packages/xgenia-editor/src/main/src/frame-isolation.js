const fs = require('fs');
const path = require('path');

/**
 * Remote pages the editor embeds (the AI chat, the image editor, Character Studio, web plugins)
 * run in a process of their own. They talk to the editor only through postMessage, which works
 * across processes, so each remote origin is listed in Chromium's --isolate-origins.
 *
 * The switch is read once, before the app is ready, so an origin first seen during a session
 * (a newly entitled web plugin) is remembered and isolated from the next launch on.
 */

/** Origins known to be embedded. Wildcards cover every subdomain of a registrable domain. */
const KNOWN_ORIGINS = [
  'https://xgenia-ai-app-xgenia.vercel.app',
  'https://xgenia-image-editor-plugin.vercel.app',
  'https://xgenia-character-studio.vercel.app',
  'https://[*.]xgenia.com',
  'https://[*.]xgenia.ai'
];

const STORE_FILE = 'isolated-frame-origins.json';
const MAX_REMEMBERED = 200;

/** The origin to isolate for a frame URL, or null for local and non-web content. */
function remoteOriginOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') return null;
  return u.origin;
}

function readRemembered(userDataDir) {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(userDataDir, STORE_FILE), 'utf8'));
    return Array.isArray(list) ? list.filter((o) => typeof o === 'string' && remoteOriginOf(o) === o) : [];
  } catch {
    return [];
  }
}

/** The --isolate-origins value: the known origins plus every remote origin seen before. */
function isolateOriginsValue(userDataDir) {
  return [...new Set([...KNOWN_ORIGINS, ...readRemembered(userDataDir)])].join(',');
}

function isCovered(origin, list) {
  return list.some((entry) => {
    if (entry === origin) return true;
    const m = /^https:\/\/\[\*\.\](.+)$/.exec(entry);
    if (!m) return false;
    const host = new URL(origin).hostname;
    return host === m[1] || host.endsWith('.' + m[1]);
  });
}

/** Remember a frame's remote origin for the next launch. Returns true when it was new. */
function rememberFrameOrigin(userDataDir, url) {
  const origin = remoteOriginOf(url);
  if (!origin) return false;
  const remembered = readRemembered(userDataDir);
  if (isCovered(origin, [...KNOWN_ORIGINS, ...remembered])) return false;
  const next = [...remembered, origin].slice(-MAX_REMEMBERED);
  try {
    fs.writeFileSync(path.join(userDataDir, STORE_FILE), JSON.stringify(next, null, 2));
  } catch {
    return false;
  }
  return true;
}

module.exports = { KNOWN_ORIGINS, remoteOriginOf, isolateOriginsValue, rememberFrameOrigin, isCovered };
