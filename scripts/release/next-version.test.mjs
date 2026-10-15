// node --test scripts/release/next-version.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { bumpVersion, compare, nightlyVersion, setVersion, stableVersion } from './next-version.mjs';

const require = createRequire(import.meta.url);

test('bump: next patch for a release, last number + 1 for a pre-release', () => {
  assert.equal(bumpVersion('3.0.2'), '3.0.3');
  assert.equal(bumpVersion('3.0.2-beta.1'), '3.0.2-beta.2');
  assert.equal(bumpVersion('3.0.2-beta.9'), '3.0.2-beta.10');
  assert.equal(bumpVersion('v3.1.0-rc.1'), '3.1.0-rc.2');
  assert.equal(bumpVersion('3.0.2-beta'), '3.0.2-beta.1');
});

test('ordering matches the semver package electron-updater uses', () => {
  const semver = require('semver');
  const versions = ['3.0.2', '3.0.3', '3.0.2-beta.1', '3.0.2-beta.2', '3.0.2-beta.10', '3.0.2-alpha.5', '3.1.0-beta.1', 'V2.1.0', '3.0.1-beta.9.nightly.202610070215'];
  for (const a of versions) for (const b of versions) {
    const norm = (v) => v.replace(/^[vV]/, '');
    assert.equal(Math.sign(compare(a, b)), semver.compare(norm(a), norm(b)), `${a} vs ${b}`);
  }
});

test('a nightly publishes a pre-release package version as it is', () => {
  assert.equal(nightlyVersion('3.0.2-beta.1'), '3.0.2-beta.1');
  assert.equal(nightlyVersion('3.0.2-beta.1', ['v3.0.2-beta.1', 'v3.0.2-beta.2']), '3.0.2-beta.3', 'taken versions are skipped');
});

test('a nightly never publishes a release version: it takes that release\'s first beta', () => {
  assert.equal(nightlyVersion('3.0.3'), '3.0.3-beta.1');
  // 3.0.2 is already out: a 3.0.2 beta would sort below it, so the next patch's beta.
  assert.equal(nightlyVersion('3.0.2', ['v3.0.2', 'V3.0.1']), '3.0.3-beta.1');
});

test('a manual release publishes the package version without its pre-release part', () => {
  assert.equal(stableVersion('3.0.3-beta.5'), '3.0.3');
  assert.equal(stableVersion('3.0.3'), '3.0.3');
  assert.equal(stableVersion('3.0.2-beta.5', ['v3.0.2']), '3.0.3');
});

test('the full cycle: nightlies count up, a release moves to the next patch', () => {
  let pkg = '3.0.2-beta.1';
  const released = [];
  const nightly = () => {
    const v = nightlyVersion(pkg, released);
    released.push(`v${v}`);
    pkg = bumpVersion(v);
    return v;
  };
  assert.equal(nightly(), '3.0.2-beta.1');
  assert.equal(pkg, '3.0.2-beta.2');
  assert.equal(nightly(), '3.0.2-beta.2');
  const stable = stableVersion(pkg, released);
  released.push(`v${stable}`);
  pkg = bumpVersion(stable);
  assert.equal(stable, '3.0.2');
  assert.equal(pkg, '3.0.3');
  assert.equal(nightly(), '3.0.3-beta.1');
  assert.equal(pkg, '3.0.3-beta.2');
});

test('set writes only the version line, and never lowers it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-version-'));
  const file = path.join(dir, 'package.json');
  const original = '{\n  "name": "xgenia-editor",\n  "version": "3.0.2-beta.1",\n  "private": true\n}\n';
  fs.writeFileSync(file, original);
  assert.equal(setVersion(file, '3.0.2-beta.2'), '3.0.2-beta.2');
  assert.equal(fs.readFileSync(file, 'utf8'), original.replace('3.0.2-beta.1', '3.0.2-beta.2'));
  // Someone moved it on by hand meanwhile: a lower bump leaves it alone.
  fs.writeFileSync(file, original.replace('3.0.2-beta.1', '3.1.0-beta.1'));
  assert.equal(setVersion(file, '3.0.2-beta.3'), '3.1.0-beta.1');
  assert.match(fs.readFileSync(file, 'utf8'), /"version": "3\.1\.0-beta\.1"/);
});
