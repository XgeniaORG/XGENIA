// Release notes for the update the user is about to get (2026-11-11). electron-updater reads them
// from the GitHub release page (with fullChangelog: one entry per release between the running
// version and the update). That text is HTML from GitHub and is not covered by the signed manifest,
// so it never reaches the renderer as HTML: it is turned into plain text blocks here, which the
// renderer shows as text (ReleaseNotesList.tsx). Nothing in a release body can run in the editor.
//
// Pure (no electron), so the tests use the same code as the app.
'use strict';

const MAX_RELEASES = 10;
const MAX_BLOCKS_PER_RELEASE = 150;
const MAX_TEXT_LENGTH = 600;

const isPrerelease = (version) => /-/.test(String(version || ''));

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rarr: '→', larr: '←' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      try {
        return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : '';
      } catch {
        return '';
      }
    }
    const named = NAMED_ENTITIES[code.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/**
 * GitHub's rendered release body (HTML) → [{ type: 'heading' | 'item' | 'text', text, depth? }].
 * Headings, list items (with their nesting depth) and paragraphs are kept; everything else
 * (links, emphasis, code, images, rules, scripts) is reduced to its text or dropped.
 */
function htmlToBlocks(html) {
  const blocks = [];
  let current = null;
  let listDepth = 0;
  let skipping = 0; // inside <script>, <style>, <svg>: no text from there

  const flush = () => {
    if (!current) return;
    const text = current.text.replace(/\s+/g, ' ').trim();
    if (text && blocks.length < MAX_BLOCKS_PER_RELEASE) {
      blocks.push({ ...current, text: text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH - 1) + '…' : text });
    }
    current = null;
  };
  const open = (type) => {
    flush();
    current = type === 'item' ? { type, text: '', depth: Math.max(0, listDepth - 1) } : { type, text: '' };
  };

  const source = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  const tokens = source.split(/(<[^>]*>)/);
  for (const token of tokens) {
    if (!token) continue;
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (!tag) {
      if (token.startsWith('<')) continue; // <!doctype>, stray brackets
      if (skipping) continue;
      const text = decodeEntities(token);
      if (!text.trim()) {
        if (current) current.text += ' ';
        continue;
      }
      if (!current) open(listDepth ? 'item' : 'text');
      current.text += text;
      continue;
    }
    const closing = tag[1] === '/';
    const name = tag[2].toLowerCase();
    if (name === 'script' || name === 'style' || name === 'svg') {
      skipping = Math.max(0, skipping + (closing ? -1 : 1));
      continue;
    }
    if (skipping) continue;
    if (/^h[1-6]$/.test(name)) {
      if (closing) flush();
      else open('heading');
    } else if (name === 'li') {
      if (closing) flush();
      else open('item');
    } else if (name === 'ul' || name === 'ol') {
      flush();
      listDepth = Math.max(0, listDepth + (closing ? -1 : 1));
    } else if (name === 'p' || name === 'div' || name === 'blockquote' || name === 'pre' || name === 'tr') {
      // A paragraph inside a list item continues that item; elsewhere it is its own block.
      if (current && current.type === 'item') continue;
      if (closing) flush();
      else open('text');
    } else if (name === 'br') {
      if (current) current.text += ' ';
    } else if (name === 'hr') {
      flush();
    } else if (name === 'td' || name === 'th') {
      if (current) current.text += ' ';
    }
  }
  flush();
  return blocks;
}

/**
 * electron-updater's releaseNotes (a string, or [{ version, note }] with fullChangelog) → the list
 * the renderer shows, newest first: [{ version, blocks }]. On Stable, pre-release notes are left
 * out (a nightly between two stable releases is not what the user is getting). Releases with no
 * notes are left out.
 */
function toReleaseNotes(releaseNotes, { version, channel } = {}) {
  let entries;
  if (Array.isArray(releaseNotes)) entries = releaseNotes;
  else if (typeof releaseNotes === 'string' && version) entries = [{ version, note: releaseNotes }];
  else return [];

  const result = [];
  for (const entry of entries) {
    if (!entry || !entry.version) continue;
    const v = String(entry.version);
    if (channel !== 'beta' && isPrerelease(v)) continue;
    const blocks = htmlToBlocks(entry.note);
    if (!blocks.length) continue;
    result.push({ version: v, blocks });
    if (result.length >= MAX_RELEASES) break;
  }
  return result;
}

module.exports = { htmlToBlocks, toReleaseNotes, decodeEntities };
