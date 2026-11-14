import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  XGENIA_CREDIT_URL,
  XGENIA_GENERATOR_META,
  injectXgeniaCredit,
  wantsXgeniaCredit,
  xgeniaCreditHtml
} from '../../src/editor/src/utils/compilation/build/processors/xgenia-credit';

const page = '<!DOCTYPE html><html><head><title>Game</title></head><body><div id="root"></div><script src="x.js"></script></body></html>';

test('the credit is a real, visible link to xgenia.com, placed before </body>', () => {
  const out = injectXgeniaCredit(page);
  assert.ok(out.includes(`href="${XGENIA_CREDIT_URL}"`));
  assert.ok(XGENIA_CREDIT_URL.startsWith('https://xgenia.com/'));
  assert.ok(out.indexOf('xgenia-made-with') < out.indexOf('</body>'));
  assert.ok(out.indexOf('xgenia-made-with') > out.indexOf('x.js'), 'after the game scripts, so it never delays them');
  assert.match(out, />Made with XGENIA</);
  // never hidden: no display:none / visibility:hidden on the credit
  assert.doesNotMatch(xgeniaCreditHtml(), /display:\s*none|visibility:\s*hidden/);
});

test('injecting twice adds it once; a template without </body> still gets it', () => {
  const twice = injectXgeniaCredit(injectXgeniaCredit(page));
  assert.equal(twice.split('class="xgenia-made-with"').length - 1, 1);
  assert.match(injectXgeniaCredit('<div id="root"></div>'), /Made with XGENIA/);
});

test('on by default; off for the Stake embed (caller) and when the project hides it', () => {
  assert.equal(wantsXgeniaCredit(undefined, {}), true);
  assert.equal(wantsXgeniaCredit(undefined, undefined), true);
  assert.equal(wantsXgeniaCredit(false, {}), false);
  assert.equal(wantsXgeniaCredit(undefined, { hideXgeniaCredit: true }), false);
  assert.equal(wantsXgeniaCredit(true, { hideXgeniaCredit: 'yes' }), true);
});

test('the generator meta names XGENIA and xgenia.com', () => {
  assert.match(XGENIA_GENERATOR_META, /<meta name="generator" content="XGENIA[^"]*https:\/\/xgenia\.com/);
});
