import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { optionalAlias } = require('../../webpackconfigs/helpers/optional-alias.js');

test('an optional alias points at the target when it exists, else at the stub', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'optional-alias-'));
  const stub = path.join(root, 'stub/index.js');
  const target = path.join(root, 'private/ext/editor-extension');

  assert.equal(optionalAlias(target, stub), stub, 'absent: stub');

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '.ts', 'export function register() {}');
  assert.equal(optionalAlias(target, stub), target, 'file with an extension: target');

  fs.rmSync(target + '.ts');
  fs.mkdirSync(target);
  assert.equal(optionalAlias(target, stub), stub, 'empty folder: stub');
  fs.writeFileSync(path.join(target, 'index.js'), 'exports.register = () => {}');
  assert.equal(optionalAlias(target, stub), target, 'folder with an index: target');
});

test('the shared webpack config maps @xgenia/project-extensions to the stub, or to a module under private/', () => {
  const shared = require('../../webpackconfigs/shared/webpack.shared.js');
  const resolved = path.resolve(shared.resolve.alias['@xgenia/project-extensions']);
  const stub = path.resolve(__dirname, '../../src/stubs/project-extensions/index.js');
  const privateDir = path.resolve(__dirname, '../../../../private') + path.sep;
  if (resolved !== stub) {
    // A checkout with the optional module: it lives under private/.
    assert.ok(resolved.startsWith(privateDir), resolved);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(resolved);
  assert.equal(typeof mod.register, 'function');
});
