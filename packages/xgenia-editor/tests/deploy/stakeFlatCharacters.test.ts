import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import '@xgenia/platform-node';
import { copyProjectFilesToFlatFolderStake } from '../../src/editor/src/utils/compilation/build/copy';

// A character package is `assets/characters/<name>/character.xgc.json` plus the atlas pages its
// `atlases[].file` / `atlases[].sdf` name relative to the rig. The Stake export flattens every file into one
// folder, so two characters both shipping `atlas_0.png` collide and one page is renamed. The rig that names the
// renamed page must be rewritten to the new name, or it loads the other character's page.
function writeCharacter(root: string, name: string, pageBytes: string, sdf = false) {
  const dir = path.join(root, 'assets', 'characters', name);
  fs.mkdirSync(dir, { recursive: true });
  const atlas: Record<string, unknown> = { id: 0, file: 'atlas_0.png', w: 4, h: 4 };
  if (sdf) atlas.sdf = 'atlas_0.sdf.png';
  fs.writeFileSync(path.join(dir, 'character.xgc.json'), JSON.stringify({ format: 'xgc', version: '0.2', atlases: [atlas] }));
  fs.writeFileSync(path.join(dir, 'atlas_0.png'), pageBytes);
  if (sdf) fs.writeFileSync(path.join(dir, 'atlas_0.sdf.png'), pageBytes + '-sdf');
}

test('two characters in a Stake export each load their own atlas pages', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stake-flat-chars-'));
  const project = path.join(tmp, 'project');
  const out = path.join(tmp, 'out');
  writeCharacter(project, 'leprechaun', 'LEPRECHAUN', true);
  writeCharacter(project, 'gremlin', 'GREMLIN', true);

  const flatMap = await copyProjectFilesToFlatFolderStake(project, out);

  for (const [name, bytes] of [['leprechaun', 'LEPRECHAUN'], ['gremlin', 'GREMLIN']]) {
    const rigName = flatMap[`assets/characters/${name}/character.xgc.json`];
    assert.ok(rigName, `${name}'s rig is in the flat map`);
    const rig = JSON.parse(fs.readFileSync(path.join(out, rigName), 'utf8'));
    const atlas = rig.atlases[0];
    assert.equal(fs.readFileSync(path.join(out, atlas.file), 'utf8'), bytes, `${name}'s rig names its own colour page`);
    assert.equal(fs.readFileSync(path.join(out, atlas.sdf), 'utf8'), bytes + '-sdf', `${name}'s rig names its own SDF page`);
  }
});
