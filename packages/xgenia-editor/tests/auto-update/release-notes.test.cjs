// Release notes in the update dialog (2026-11-11): GitHub's release HTML becomes plain text blocks,
// nothing from it can run in the editor, and Stable never shows a nightly's notes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { htmlToBlocks, toReleaseNotes } = require(path.resolve(__dirname, '../../src/main/src/release-notes.js'));

// Shaped like GitHub's rendered release body (the v3.0.2 notes).
const RELEASE_HTML = `<h1>🎰 XGENIA v3.0.2</h1>
<p>A focused follow-up to 3.0.1.</p>
<hr>
<h2>🌟 Highlights</h2>
<ul>
<li>🔒 <strong>Your maths stays on the RGS.</strong> A published game no longer includes its maths.</li>
<li><strong>Simulation shows rounding and win caps.</strong> A Simulate run now tells you:
<ul>
<li>how many wins were rounded down</li>
<li>how many wins were cut to the game&#39;s max win</li>
</ul>
</li>
</ul>
<p>Links point to <a href="https://xgenia.com">xgenia.com</a> &amp; <code>observe_timeline</code> takes a click.</p>`;

test('headings, paragraphs and nested list items become text blocks', () => {
  assert.deepEqual(htmlToBlocks(RELEASE_HTML), [
    { type: 'heading', text: '🎰 XGENIA v3.0.2' },
    { type: 'text', text: 'A focused follow-up to 3.0.1.' },
    { type: 'heading', text: '🌟 Highlights' },
    { type: 'item', depth: 0, text: '🔒 Your maths stays on the RGS. A published game no longer includes its maths.' },
    { type: 'item', depth: 0, text: 'Simulation shows rounding and win caps. A Simulate run now tells you:' },
    { type: 'item', depth: 1, text: 'how many wins were rounded down' },
    { type: 'item', depth: 1, text: "how many wins were cut to the game's max win" },
    { type: 'text', text: 'Links point to xgenia.com & observe_timeline takes a click.' }
  ]);
});

test('markup in a release body never survives as markup', () => {
  const blocks = htmlToBlocks(
    '<p>Safe<script>alert(1)</script><img src=x onerror="alert(2)"> text</p><style>p{}</style><p>&lt;b&gt;literal&lt;/b&gt;</p>'
  );
  assert.deepEqual(blocks, [
    { type: 'text', text: 'Safe text' },
    { type: 'text', text: '<b>literal</b>' } // shown as text by React, not parsed
  ]);
});

test('empty and huge notes are handled', () => {
  assert.deepEqual(htmlToBlocks(''), []);
  assert.deepEqual(htmlToBlocks(null), []);
  const long = htmlToBlocks(`<p>${'a'.repeat(5000)}</p>`);
  assert.equal(long[0].text.length, 600);
  const many = htmlToBlocks('<ul>' + '<li>x</li>'.repeat(1000) + '</ul>');
  assert.equal(many.length, 150);
});

test('a full changelog keeps every release, newest first; Stable leaves out pre-releases', () => {
  const notes = [
    { version: '3.0.4', note: '<p>Four</p>' },
    { version: '3.0.4-beta.2', note: '<p>Nightly</p>' },
    { version: '3.0.3', note: '<p>Three</p>' },
    { version: '3.0.3-beta.1', note: '<p>Beta one</p>' },
    { version: '3.0.2', note: '' } // a release with no notes is left out
  ];
  assert.deepEqual(
    toReleaseNotes(notes, { version: '3.0.4', channel: 'stable' }).map((r) => r.version),
    ['3.0.4', '3.0.3']
  );
  assert.deepEqual(
    toReleaseNotes(notes, { version: '3.0.4', channel: 'beta' }).map((r) => r.version),
    ['3.0.4', '3.0.4-beta.2', '3.0.3', '3.0.3-beta.1']
  );
});

test('a single notes string belongs to the update version; no notes means an empty list', () => {
  assert.deepEqual(toReleaseNotes('<p>Only this</p>', { version: '3.0.3', channel: 'stable' }), [
    { version: '3.0.3', blocks: [{ type: 'text', text: 'Only this' }] }
  ]);
  assert.deepEqual(toReleaseNotes(null, { version: '3.0.3' }), []);
  assert.deepEqual(toReleaseNotes([{ version: '3.0.3', note: '' }], { version: '3.0.3' }), []);
});
