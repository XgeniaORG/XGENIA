import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, reducePresence } from '../../src/editor/src/models/railpresence.core';

test('family map', () => {
  assert.equal(familyOf('fs.writeFile'), 'assets');
  assert.equal(familyOf('fs.writeJson'), 'assets');
  assert.equal(familyOf('fs.writeFileBinary'), 'assets');
  assert.equal(familyOf('assetMeta.set'), 'assets');
  assert.equal(familyOf('assetMeta.migrate'), 'assets');
  assert.equal(familyOf('imageEditor.toast'), 'image-editor');
  assert.equal(familyOf('fal.run'), 'image-editor');
  assert.equal(familyOf('gemini.generate'), 'image-editor');
  assert.equal(familyOf('style.setColor'), 'project-styles');
  assert.equal(familyOf('xrgs.compile'), 'maths-panel');
  assert.equal(familyOf('component.create'), 'components');
  assert.equal(familyOf('nodelibrary.list'), 'components');
  assert.equal(familyOf('git.commit'), 'versioncontrol');
  assert.equal(familyOf('git.push'), 'versioncontrol');
  assert.equal(familyOf('git.status'), null);
  assert.equal(familyOf('fs.readFile'), null);
  assert.equal(familyOf('graph.createNode'), null);
  assert.equal(familyOf('node.setParameter'), null);
  assert.equal(familyOf('warnings.get'), null);
  assert.equal(familyOf(''), null);
});

test('command increments unseen and stamps lastAt', () => {
  const s1 = reducePresence({}, { type: 'command', panelId: 'assets', at: 100 });
  assert.deepEqual(s1, { assets: { unseen: 1, lastAt: 100 } });
  const s2 = reducePresence(s1, { type: 'command', panelId: 'assets', at: 150 });
  assert.deepEqual(s2, { assets: { unseen: 2, lastAt: 150 } });
});

test('seen zeroes unseen but keeps lastAt; unknown panel is a no-op', () => {
  const s = reducePresence({ assets: { unseen: 3, lastAt: 9 } }, { type: 'seen', panelId: 'assets' });
  assert.deepEqual(s, { assets: { unseen: 0, lastAt: 9 } });
  const same = { a: { unseen: 1, lastAt: 1 } };
  assert.equal(reducePresence(same, { type: 'seen', panelId: 'zzz' }), same);
});

test('reducer does not mutate', () => {
  const s = Object.freeze({ assets: Object.freeze({ unseen: 1, lastAt: 1 }) }) as any;
  reducePresence(s, { type: 'command', panelId: 'assets', at: 2 });
  assert.equal(s.assets.unseen, 1);
});
