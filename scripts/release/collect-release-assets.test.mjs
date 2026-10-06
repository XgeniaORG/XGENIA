// node --test scripts/release/collect-release-assets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectReleaseAssets, mergeMacManifests, parseManifest } from './collect-release-assets.mjs';

// The shape electron-builder writes (latest-mac.yml per arch, latest.yml for NSIS).
const macManifest = (arch) => `version: 3.0.1
files:
  - url: XGENIA-3.0.1-mac-${arch}.zip
    sha512: zip-${arch}==
    size: 111
  - url: XGENIA-3.0.1-mac-${arch}.dmg
    sha512: dmg-${arch}==
    size: 222
path: XGENIA-3.0.1-mac-${arch}.zip
sha512: zip-${arch}==
releaseDate: '2026-10-05T10:00:00.000Z'
`;

const winManifest = `version: 3.0.1
files:
  - url: XGENIA-Setup-3.0.1.exe
    sha512: exe==
    size: 333
    blockMapSize: 44
path: XGENIA-Setup-3.0.1.exe
sha512: exe==
releaseDate: '2026-10-05T10:00:00.000Z'
`;

// One manifest for both Linux targets: AppImageUpdater and DebUpdater each pick their own file.
const linuxManifest = `version: 3.0.1
files:
  - url: XGENIA-3.0.1.AppImage
    sha512: appimage==
    size: 555
  - url: xgenia-editor_3.0.1_amd64.deb
    sha512: deb==
    size: 666
path: XGENIA-3.0.1.AppImage
sha512: appimage==
releaseDate: '2026-10-05T10:00:00.000Z'
`;

function artifacts({ dropArm64Zip = false, arm64Version = '3.0.1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  const put = (rel, text = 'x') => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const arch of ['arm64', 'x64']) {
    const dir = `XGENIA-macOS-${arch}`;
    put(`${dir}/latest-mac.yml`, macManifest(arch).replace(/version: 3\.0\.1/, `version: ${arch === 'arm64' ? arm64Version : '3.0.1'}`));
    if (!(arch === 'arm64' && dropArm64Zip)) put(`${dir}/XGENIA-3.0.1-mac-${arch}.zip`);
    put(`${dir}/XGENIA-3.0.1-mac-${arch}.zip.blockmap`);
    put(`${dir}/XGENIA-3.0.1-mac-${arch}.dmg`);
    put(`${dir}/XGENIA-3.0.1-mac-${arch}.dmg.blockmap`);
  }
  put('XGENIA-Windows-x64/latest.yml', winManifest);
  put('XGENIA-Windows-x64/XGENIA-Setup-3.0.1.exe');
  put('XGENIA-Windows-x64/XGENIA-Setup-3.0.1.exe.blockmap');
  put('XGENIA-Linux-x64/latest-linux.yml', linuxManifest);
  put('XGENIA-Linux-x64/xgenia-editor_3.0.1_amd64.deb');
  put('XGENIA-Linux-x64/XGENIA-3.0.1.AppImage');
  return { root, out: path.join(root, '..', path.basename(root) + '-out') };
}

test('the two per-arch macOS manifests become one listing both archs', () => {
  const merged = parseManifest(mergeMacManifests([macManifest('arm64'), macManifest('x64')]));
  assert.equal(merged.head.version, '3.0.1');
  assert.deepEqual(merged.files.map((f) => f.url), [
    'XGENIA-3.0.1-mac-x64.zip',
    'XGENIA-3.0.1-mac-x64.dmg',
    'XGENIA-3.0.1-mac-arm64.zip',
    'XGENIA-3.0.1-mac-arm64.dmg'
  ]);
  assert.equal(merged.files[2].sha512, 'zip-arm64==');
  // The legacy top-level fields point at the x64 zip, as a single-arch x64 build would.
  assert.equal(merged.head.path, 'XGENIA-3.0.1-mac-x64.zip');
  assert.equal(merged.head.releaseDate, "'2026-10-05T10:00:00.000Z'");
});

test('collects every installer, blockmap and manifest into one folder', () => {
  const { root, out } = artifacts();
  collectReleaseAssets(root, out);
  assert.deepEqual(fs.readdirSync(out).sort(), [
    'XGENIA-3.0.1-mac-arm64.dmg',
    'XGENIA-3.0.1-mac-arm64.dmg.blockmap',
    'XGENIA-3.0.1-mac-arm64.zip',
    'XGENIA-3.0.1-mac-arm64.zip.blockmap',
    'XGENIA-3.0.1-mac-x64.dmg',
    'XGENIA-3.0.1-mac-x64.dmg.blockmap',
    'XGENIA-3.0.1-mac-x64.zip',
    'XGENIA-3.0.1-mac-x64.zip.blockmap',
    'XGENIA-3.0.1.AppImage',
    'XGENIA-Setup-3.0.1.exe',
    'XGENIA-Setup-3.0.1.exe.blockmap',
    'latest-linux.yml',
    'latest-mac.yml',
    'latest.yml',
    'xgenia-editor_3.0.1_amd64.deb'
  ]);
  assert.equal(parseManifest(fs.readFileSync(path.join(out, 'latest-mac.yml'), 'utf8')).files.length, 4);
  assert.equal(fs.readFileSync(path.join(out, 'latest.yml'), 'utf8'), winManifest);
});

test('refuses a release whose manifest names a file that is not there', () => {
  const { root, out } = artifacts({ dropArm64Zip: true });
  assert.throws(() => collectReleaseAssets(root, out), /XGENIA-3\.0\.1-mac-arm64\.zip/);
});

test('refuses macOS manifests from two different versions', () => {
  const { root, out } = artifacts({ arm64Version: '3.0.0' });
  assert.throws(() => collectReleaseAssets(root, out), /version/);
});

test('refuses when a macOS arch is missing', () => {
  const { root, out } = artifacts();
  fs.rmSync(path.join(root, 'XGENIA-macOS-arm64'), { recursive: true });
  assert.throws(() => collectReleaseAssets(root, out), /latest-mac\.yml/);
});
