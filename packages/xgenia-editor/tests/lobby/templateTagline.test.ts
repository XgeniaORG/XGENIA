import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  templateTagline,
  TEMPLATE_TAGLINE_MAX
} from '../../src/editor/src/models/lobby/templateTagline';

// Every `desc` below is the real string served by projecttemplates/index.json today.

test('the marketing opener is cut, leaving what the template is', () => {
  assert.equal(
    templateTagline({
      desc: 'Begin your project with a crash game template that offers clear structure and easy customization for efficient development.'
    }),
    'Crash game'
  );

  assert.equal(
    templateTagline({
      desc: 'Begin your project with a Dark Alice themed slot game template crafted for fast and flexible development.'
    }),
    'Dark Alice themed slot game'
  );

  assert.equal(
    templateTagline({
      desc: 'Start your project with a Wheel of Fortune game template featuring smooth spin mechanics, reward segments, and a flexible structure for rapid customization and development.'
    }),
    'Wheel of Fortune game'
  );
});

test('a description with no opener keeps its own words', () => {
  assert.equal(
    templateTagline({ desc: 'Slot engine to support your slot game development' }),
    'Slot engine'
  );

  assert.equal(
    templateTagline({ desc: 'A simple application template with just a Group and a Text node.' }),
    'Simple application'
  );
});

test('a tagline on the feed always wins', () => {
  assert.equal(
    templateTagline({ tagline: '5×3 · 20 lines · free spins', desc: 'Begin your project with a slot template.' }),
    '5×3 · 20 lines · free spins'
  );
});

test('nothing usable yields an empty string, never a crash', () => {
  assert.equal(templateTagline(undefined), '');
  assert.equal(templateTagline(null), '');
  assert.equal(templateTagline({}), '');
  assert.equal(templateTagline({ desc: '   ' }), '');
  // An opener and nothing else: there is no noun phrase to recover.
  assert.equal(templateTagline({ desc: 'Begin your project with a template' }), '');
});

test('a long result is clamped at a word boundary', () => {
  const long = templateTagline({
    tagline: 'A five reel three row slot machine with cluster pays and an expanding wild feature'
  });

  assert.ok(long.length <= TEMPLATE_TAGLINE_MAX + 1, `got ${long.length}`);
  assert.ok(long.endsWith('…'));
  assert.ok(!long.includes(' …'));
});
