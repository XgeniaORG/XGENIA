// Where downloaded engines live (<userData>/engine) and the small state file that says which one
// runs. A version directory exists only once every file in it matched its signed hash. (2026-10-03)
'use strict';
const fs = require('fs');
const path = require('path');
const { sha256, verifyManifest, isSafePath } = require('./manifest');

const EMPTY = { active: null, previous: null, pending: null, trial: null, accepted: null, bad: [], cleanExit: true, needsAppUpdate: null };

class EngineStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  statePath() {
    return path.join(this.baseDir, 'state.json');
  }

  versionDir(version) {
    return path.join(this.baseDir, 'versions', version);
  }

  readState() {
    let parsed = {};
    try {
      parsed = JSON.parse(fs.readFileSync(this.statePath(), 'utf8')) || {};
    } catch {
      parsed = {};
    }
    const s = { ...EMPTY, ...parsed };
    s.bad = Array.isArray(s.bad) ? s.bad.slice() : [];
    return s;
  }

  writeState(state) {
    fs.mkdirSync(this.baseDir, { recursive: true });
    const tmp = this.statePath() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.statePath());
  }

  /** The installed manifest for a version with its signature re-checked; null when absent or not ours. */
  readInstalledManifest(version, publicKeyPem) {
    try {
      const dir = this.versionDir(version);
      return verifyManifest(
        fs.readFileSync(path.join(dir, 'manifest.json')),
        fs.readFileSync(path.join(dir, 'manifest.sig'), 'utf8'),
        publicKeyPem
      );
    } catch {
      return null;
    }
  }

  /** Every file present with the size and sha256 the signed manifest names. */
  isComplete(manifest) {
    const dir = this.versionDir(manifest.version);
    return manifest.files.every((f) => {
      try {
        const b = fs.readFileSync(path.join(dir, f.path));
        return b.length === f.size && sha256(b) === f.sha256;
      } catch {
        return false;
      }
    });
  }

  /** Download every file (fetchFile returns the decompressed bytes), check it, then move into place with one rename. */
  async install(rawManifest, sigB64, manifest, fetchFile) {
    const final = this.versionDir(manifest.version);
    if (fs.existsSync(final) && this.isComplete(manifest)) return final;
    const tmp = path.join(this.baseDir, 'versions', '.partial-' + manifest.version);
    fs.rmSync(tmp, { recursive: true, force: true });
    for (const f of manifest.files) {
      if (!isSafePath(f.path)) throw new Error('unsafe path ' + f.path);
      const body = await fetchFile(f);
      if (body.length !== f.size || sha256(body) !== f.sha256) throw new Error('hash mismatch for ' + f.path);
      const out = path.join(tmp, f.path);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body);
    }
    fs.writeFileSync(path.join(tmp, 'manifest.json'), rawManifest);
    fs.writeFileSync(path.join(tmp, 'manifest.sig'), sigB64);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
    return final;
  }

  prune(keep) {
    const root = path.join(this.baseDir, 'versions');
    let names = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      return;
    }
    for (const n of names) if (!keep.includes(n)) fs.rmSync(path.join(root, n), { recursive: true, force: true });
  }
}

module.exports = { EngineStore, EMPTY };
