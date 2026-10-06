import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The left card's resize handle is a transparent overlay: every pointer event in its strip
// is its own, and whatever the panel underneath draws there becomes unreachable. What a
// panel draws against its right edge is its scrollbar — so while the handle sat at
// `right: 0` it swallowed the scrollbar whole (the AI Chat panel's is 6px, the handle 8px),
// leaving the wheel as the only way to scroll. The fix is geometric: the strip lives
// outside the card. These are style-level invariants with no runtime seam to test, so they
// are asserted against the stylesheet itself.
const css = readFileSync(
  join(__dirname, '../../src/editor/src/views/LeftPanelCard/LeftPanelCard.module.scss'),
  'utf8'
);

/** The declarations of one top-level rule, block and line comments stripped, so prose
 *  about a declaration is never mistaken for the declaration itself — the comment on
 *  .Card's ::before, for one, recounts what `overflow: hidden` used to do there. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start > 0, `${selector} must exist in LeftPanelCard.module.scss`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  return css
    .slice(open + 1, i)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

test('the resize handle sits outside the card, never over a panel scrollbar', () => {
  const handle = ruleBody('.ResizeHandle');
  assert.match(
    handle,
    /left:\s*100%/,
    'ResizeHandle must be offset to the card\'s outer edge (left: 100%), or it covers the panel scrollbar'
  );
  assert.doesNotMatch(
    handle,
    /(^|[;{\s])right:\s*0/,
    'ResizeHandle must not be pinned to right: 0 — that is exactly the strip a panel puts its scrollbar in'
  );
});

test('the card does not clip, so the handle outside it survives', () => {
  assert.doesNotMatch(
    ruleBody('.Card'),
    /overflow:\s*hidden/,
    '.Card must not clip: `overflow: hidden` would cut away the handle that hangs off its right edge'
  );
});

test('.Content keeps the rounded-corner clipping .Card gave up', () => {
  const content = ruleBody('.Content');
  assert.match(content, /border-radius:\s*inherit/, '.Content must inherit the card radius to clip panels to it');
  assert.match(content, /overflow:\s*(auto|hidden|scroll)/, '.Content must clip/scroll for that radius to bite');
});
