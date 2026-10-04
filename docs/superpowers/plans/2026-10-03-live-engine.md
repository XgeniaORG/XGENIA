# Live Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Engine, slot-node and RGS-compiler changes reach installed XGENIA apps within minutes of a green push, signed by CI, with no app release and no submodule pointer bump.

**Architecture:** CI builds an "engine pack" (`viewer/`, `deploy/`, `compiler/xgenia.rgs-compiler.js`) from outer `develop` + private `main`, gzips each file, signs a manifest with ed25519 and uploads it to the public Supabase Storage bucket `engine`. The Electron main process picks the engine for each run from disk before the window opens (a verified downloaded engine, else the built-in one), exposes the choice through `XGENIA_ENGINE_ROOT` / `global.xgeniaLiveEngine`, and downloads newer engines in the background for the next start. The web server, export code and Maths panel read the choice.

**Tech Stack:** Electron 31 main process (CommonJS, Node 20 `crypto`/`zlib`/`fetch`), TypeScript renderer (webpack), webpack 5 viewer build, esbuild for the compiler bundle, GitHub Actions, Supabase Storage REST API. Tests: `node:test` (`node --test`, `npx tsx --test`) and jest (`@xgenia/runtime`).

**Spec:** `docs/superpowers/specs/2026-10-03-live-engine-design.md`

## Global Constraints

- Work in the worktree `~/Documents/GitHub/XGENIAOPEN/wt-live-engine` on branch `feature/live-engine` (from `origin/develop` 2b6b241). Never touch the main checkout `XGENIAOpen2` (the user's editor runs from it).
- One-time worktree setup: `cd ~/Documents/GitHub/XGENIAOPEN/wt-live-engine && ln -s ../XGENIAOpen2/node_modules node_modules && git submodule update --init private && git -C private fetch origin main && git -C private checkout --detach origin/main`.
- Node: `export PATH=/Users/markfm/.nvm/versions/node/v22.23.1/bin:$PATH` before every command.
- Git: commits only on `feature/live-engine`; **ask the user before the first commit and before any push**; one PR to `develop` at the end. Plain short commit messages, no `Co-Authored-By` trailer. The private-repo workflow (Task 11) is committed to private `main` only after asking.
- Never print secrets: `private/xgenia-ai-app/.supabase-token`, the signing private key, the Supabase service key.
- Public key file: `packages/xgenia-editor/src/main/src/live-engine/public-key.js`. Private key: only the GitHub secret `ENGINE_SIGNING_KEY`, plus the one local copy `~/.xgenia-engine-signing-key.pem` (mode 600) until the user has stored it.
- Storage: `https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine` — `channels/<beta|stable>/manifest.json|.sig`, `<version>/manifest.json|.sig`, `<version>/files/<path>.gz`.
- Version string format: `YYYYMMDD.HHMM-<outer sha8>-<private sha8>` (must match `/^[0-9A-Za-z][0-9A-Za-z.\-]{0,79}$/`).
- `SHELL_API_VERSION = 1`; `engine-compat.json` `minShell = 1`.
- Development builds (`!app.isPackaged`) never download or use a live engine unless `XGENIA_LIVE_ENGINE=1`. `XGENIA_ENGINE=builtin` forces the built-in engine. `XGENIA_ENGINE_CHANNEL=beta|stable` overrides the channel; default `stable`.
- Out of scope: `src/external/cloudruntime` (stays built-in), already-published games, AI/bridge changes, automatic app releases.

## Review Focus

1. **Offline or the CDN down at startup** — the app must start at once on whatever is installed (or built-in); selection reads only disk. Pinned in Task 5 ("decides from disk and returns at once").
2. **A download interrupted or corrupted half way** — it must never become a version, never activate. Pinned in Tasks 2 and 4.
3. **A live engine whose preview never comes up** — marked bad; the next start goes back to the previous engine. Pinned in Tasks 3 and 5.
4. **An engine that needs a newer app** — not installed, recorded as `needsAppUpdate`. Pinned in Tasks 1 (compat test) and 4.
5. **A new engine downloaded mid-session** — preview, export and the compiler keep using this run's engine until restart. Pinned in Task 5 ("an update installed mid-session changes nothing until restart").

---

### Task 1: Manifest format, signature check, compatibility numbers, signing key

**Files:**
- Create: `packages/xgenia-editor/src/main/src/live-engine/manifest.js`
- Create: `packages/xgenia-editor/src/main/src/live-engine/shell-api.js`
- Create: `packages/xgenia-viewer-react/engine-compat.json`
- Create: `scripts/live-engine/keygen.mjs`
- Create (generated): `packages/xgenia-editor/src/main/src/live-engine/public-key.js`
- Create: `packages/xgenia-editor/tests/live-engine/helpers.cjs`
- Test: `packages/xgenia-editor/tests/live-engine/manifest.test.cjs`

**Interfaces:**
- Produces: `manifest.js` exports `FORMAT` (1), `CHANNELS` (`['beta','stable']`), `ROOTS` (`['viewer/','deploy/','compiler/']`), `REQUIRED` (string[]), `isSafePath(p: string): boolean`, `validateManifest(m): m` (throws `Error('live-engine manifest: <reason>')`), `verifyManifest(raw: Buffer|string, sigB64: string, publicKeyPem: string): manifest` (throws), `signManifest(raw, privateKeyPem): string` (base64), `sha256(buf): string` (hex).
- Produces: `shell-api.js` exports `SHELL_API_VERSION` (1). `public-key.js` exports `ENGINE_PUBLIC_KEY_PEM` (string).
- Produces: `helpers.cjs` exports `keys()`, `packFiles(extra?)`, `makeManifest(files, overrides?)`.
- Manifest shape: `{ format: 1, version, channel, issuedAt (ISO), minShell (int ≥1), sources: {outer, private}, filesBase ('https://…/'), files: [{ path, sha256, size }] }`.

- [ ] **Step 1: Write the test helpers**

`packages/xgenia-editor/tests/live-engine/helpers.cjs`:

```js
// Shared fixtures for the live-engine tests: a key pair, a minimal engine pack, its manifest.
const crypto = require('crypto');
const { sha256 } = require('../../src/main/src/live-engine/manifest');

function keys() {
  return crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
}

function packFiles(extra = {}) {
  return {
    'viewer/index.html': '<html>live</html>',
    'viewer/xgenia.viewer.js': 'LIVE VIEWER',
    'deploy/index.json': '[]',
    'deploy/xgenia.deploy.js': 'LIVE DEPLOY',
    'compiler/xgenia.rgs-compiler.js': 'module.exports = { CloudFunctionConverter: function LiveCompiler() {} };',
    ...extra
  };
}

function makeManifest(files, over = {}) {
  const version = over.version || '20261003.1200-aaaaaaaa-bbbbbbbb';
  return {
    format: 1,
    version,
    channel: 'beta',
    issuedAt: '2026-10-03T12:00:00.000Z',
    minShell: 1,
    sources: { outer: 'a', private: 'b' },
    filesBase: `https://cdn.example/engine/${version}/files/`,
    files: Object.entries(files).map(([path, body]) => ({
      path,
      sha256: sha256(Buffer.from(body)),
      size: Buffer.byteLength(body)
    })),
    ...over
  };
}

module.exports = { keys, packFiles, makeManifest };
```

- [ ] **Step 2: Write the failing test**

`packages/xgenia-editor/tests/live-engine/manifest.test.cjs`:

```js
// Live engine (2026-10-03): nothing the app downloads runs unless our CI signed it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { verifyManifest, signManifest, validateManifest, isSafePath } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
const signed = (m, key = k.privateKey) => {
  const raw = Buffer.from(JSON.stringify(m));
  return { raw, sig: signManifest(raw, key) };
};

test('a manifest signed by our key verifies and parses', () => {
  const m = makeManifest(packFiles());
  const { raw, sig } = signed(m);
  assert.equal(verifyManifest(raw, sig, k.publicKey).version, m.version);
});

test('one changed byte, another key, or a garbage signature is refused', () => {
  const { raw, sig } = signed(makeManifest(packFiles()));
  const tampered = Buffer.from(raw);
  tampered[tampered.length - 2] ^= 1;
  assert.throws(() => verifyManifest(tampered, sig, k.publicKey), /signature does not match/);
  const other = keys();
  assert.throws(() => verifyManifest(raw, signManifest(raw, other.privateKey), k.publicKey), /signature does not match/);
  assert.throws(() => verifyManifest(raw, 'not base64 at all!!', k.publicKey), /signature does not match/);
});

test('a signed manifest that is malformed is still refused', () => {
  const { raw, sig } = signed({ ...makeManifest(packFiles()), minShell: 0 });
  assert.throws(() => verifyManifest(raw, sig, k.publicKey), /bad minShell/);
});

test('paths stay inside viewer/, deploy/, compiler/', () => {
  for (const p of ['../x', 'viewer/../../x', '/etc/passwd', 'other/x', 'viewer//x', 'viewer\\x.js', 'viewer/./x', 'viewer/x\0']) {
    assert.equal(isSafePath(p), false, p);
  }
  for (const p of ['viewer/xgenia.viewer.js', 'deploy/index.json', 'compiler/xgenia.rgs-compiler.js']) {
    assert.equal(isSafePath(p), true, p);
  }
  assert.throws(() => validateManifest(makeManifest(packFiles({ '../evil.js': 'x' }))), /unsafe path/);
});

test('every required file must be listed', () => {
  const files = packFiles();
  delete files['compiler/xgenia.rgs-compiler.js'];
  assert.throws(() => validateManifest(makeManifest(files)), /missing compiler\/xgenia\.rgs-compiler\.js/);
});

test('the app supports the minShell the engine source declares', () => {
  const { SHELL_API_VERSION } = require('../../src/main/src/live-engine/shell-api');
  const { minShell } = require('../../../xgenia-viewer-react/engine-compat.json');
  assert.ok(Number.isInteger(minShell) && minShell >= 1);
  assert.ok(
    SHELL_API_VERSION >= minShell,
    `the engine needs app shell ${minShell}, the app is ${SHELL_API_VERSION}: bump SHELL_API_VERSION in the same PR as the editor change`
  );
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/manifest.test.cjs`
Expected: FAIL — `Cannot find module '../../src/main/src/live-engine/manifest'`.

- [ ] **Step 4: Write `manifest.js`, `shell-api.js`, `engine-compat.json`**

`packages/xgenia-editor/src/main/src/live-engine/manifest.js`:

```js
// Live engine manifest: what an engine pack contains, and the ed25519 check that our CI made it.
// Shared by the app (verify) and scripts/live-engine (sign). (2026-10-03)
'use strict';
const crypto = require('crypto');

const FORMAT = 1;
const CHANNELS = ['beta', 'stable'];
const ROOTS = ['viewer/', 'deploy/', 'compiler/'];
const REQUIRED = [
  'viewer/index.html',
  'viewer/xgenia.viewer.js',
  'deploy/index.json',
  'deploy/xgenia.deploy.js',
  'compiler/xgenia.rgs-compiler.js'
];

function fail(msg) {
  throw new Error('live-engine manifest: ' + msg);
}

function isSafePath(p) {
  return (
    typeof p === 'string' &&
    p.length > 0 &&
    p.length < 300 &&
    !p.startsWith('/') &&
    !p.includes('\\') &&
    !p.includes('\0') &&
    !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..') &&
    ROOTS.some((r) => p.startsWith(r))
  );
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') fail('not an object');
  if (m.format !== FORMAT) fail('unknown format ' + m.format);
  if (typeof m.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.\-]{0,79}$/.test(m.version)) fail('bad version');
  if (!CHANNELS.includes(m.channel)) fail('bad channel');
  if (typeof m.issuedAt !== 'string' || Number.isNaN(Date.parse(m.issuedAt))) fail('bad issuedAt');
  if (!Number.isInteger(m.minShell) || m.minShell < 1) fail('bad minShell');
  if (typeof m.filesBase !== 'string' || !/^https:\/\/\S+\/$/.test(m.filesBase)) fail('bad filesBase');
  if (!Array.isArray(m.files) || m.files.length === 0) fail('no files');
  const seen = new Set();
  for (const f of m.files) {
    if (!f || !isSafePath(f.path)) fail('unsafe path ' + (f && f.path));
    if (seen.has(f.path)) fail('duplicate path ' + f.path);
    seen.add(f.path);
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) fail('bad sha256 for ' + f.path);
    if (!Number.isInteger(f.size) || f.size < 0) fail('bad size for ' + f.path);
  }
  for (const r of REQUIRED) if (!seen.has(r)) fail('missing ' + r);
  return m;
}

/** The manifest, parsed, only if `sigB64` is our key's signature over exactly these bytes. */
function verifyManifest(raw, sigB64, publicKeyPem) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let ok = false;
  try {
    ok = crypto.verify(null, bytes, publicKeyPem, Buffer.from(String(sigB64).trim(), 'base64'));
  } catch {
    ok = false;
  }
  if (!ok) fail('signature does not match');
  let m;
  try {
    m = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('not JSON');
  }
  return validateManifest(m);
}

function signManifest(raw, privateKeyPem) {
  return crypto.sign(null, Buffer.isBuffer(raw) ? raw : Buffer.from(raw), privateKeyPem).toString('base64');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

module.exports = { FORMAT, CHANNELS, ROOTS, REQUIRED, isSafePath, validateManifest, verifyManifest, signManifest, sha256 };
```

`packages/xgenia-editor/src/main/src/live-engine/shell-api.js`:

```js
// What this app build can host. A live engine declares the lowest it needs (manifest.minShell, from
// packages/xgenia-viewer-react/engine-compat.json). Bump BOTH in the same PR when an engine change
// needs an editor change: a new WebSocket message the editor must handle, a new deploy/index.json
// shape, a new file the editor must read. (2026-10-03)
module.exports = { SHELL_API_VERSION: 1 };
```

`packages/xgenia-viewer-react/engine-compat.json`:

```json
{ "minShell": 1 }
```

- [ ] **Step 5: Write the key generator and generate the real key pair**

`scripts/live-engine/keygen.mjs`:

```js
// Makes the live-engine signing key pair. The public key is written into the app
// (packages/xgenia-editor/src/main/src/live-engine/public-key.js); the private key goes ONLY into
// the GitHub secret ENGINE_SIGNING_KEY. Usage: node scripts/live-engine/keygen.mjs <private-key-out.pem>
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[2];
if (!out) {
  console.error('usage: keygen.mjs <private-key-out.pem>');
  process.exit(2);
}
if (existsSync(out)) {
  console.error(`${out} exists — refusing to overwrite a signing key`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
writeFileSync(out, privateKey, { mode: 0o600 });
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/public-key.js');
writeFileSync(
  target,
  `// ed25519 public key for live-engine manifests. The private half is the GitHub secret
// ENGINE_SIGNING_KEY (XgeniaORG/XGENIA). Rotating it means a new app build. (2026-10-03)
module.exports = {
  ENGINE_PUBLIC_KEY_PEM: ${JSON.stringify(publicKey)}
};
`
);
console.log(`private key -> ${out} (mode 600)\npublic key  -> ${path.relative(ROOT, target)}`);
```

Run: `node scripts/live-engine/keygen.mjs ~/.xgenia-engine-signing-key.pem`
Expected: two lines, `private key -> …` and `public key  -> packages/xgenia-editor/src/main/src/live-engine/public-key.js`. Do not print the private key file.

- [ ] **Step 6: Run the test to see it pass**

Run: `node --test packages/xgenia-editor/tests/live-engine/manifest.test.cjs`
Expected: `# pass 6`, `# fail 0`.

- [ ] **Step 7: Commit** (ask the user first — first commit of the branch)

```bash
git add packages/xgenia-editor/src/main/src/live-engine packages/xgenia-viewer-react/engine-compat.json scripts/live-engine/keygen.mjs packages/xgenia-editor/tests/live-engine
git commit -m "Live engine: signed manifest format and app shell version"
```

---

### Task 2: Engine store (install, verify, prune)

**Files:**
- Create: `packages/xgenia-editor/src/main/src/live-engine/engine-store.js`
- Test: `packages/xgenia-editor/tests/live-engine/engine-store.test.cjs`

**Interfaces:**
- Consumes: `manifest.js` `sha256`, `verifyManifest`, `isSafePath`.
- Produces: `class EngineStore(baseDir)` with `baseDir`, `statePath()`, `versionDir(version)`, `readState()` → `{ active, previous, pending, trial, accepted: {version, issuedAt}|null, bad: string[], cleanExit: boolean, needsAppUpdate: string|null }`, `writeState(state)`, `readInstalledManifest(version, publicKeyPem)` → manifest|null, `isComplete(manifest)` → boolean, `async install(rawManifest: Buffer, sigB64: string, manifest, fetchFile: (fileEntry) => Promise<Buffer>)` → version dir path (throws on mismatch), `prune(keep: string[])`.
- Layout: `<baseDir>/state.json`, `<baseDir>/versions/<version>/{viewer,deploy,compiler}/…`, `<baseDir>/versions/<version>/manifest.json|manifest.sig`, partial downloads in `<baseDir>/versions/.partial-<version>`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-editor/tests/live-engine/engine-store.test.cjs`:

```js
// Live engine (2026-10-03): a downloaded engine is either complete and hash-checked, or absent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
function setup(files = packFiles(), over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-engine-'));
  const m = makeManifest(files, over);
  const raw = Buffer.from(JSON.stringify(m));
  return { store: new EngineStore(dir), dir, m, raw, sig: signManifest(raw, k.privateKey), files };
}
const fetchFrom = (files) => async (f) => Buffer.from(files[f.path]);

test('install writes every file and the signed manifest, which reads back verified', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  assert.equal(fs.readFileSync(path.join(s.store.versionDir(s.m.version), 'viewer/xgenia.viewer.js'), 'utf8'), 'LIVE VIEWER');
  assert.equal(s.store.readInstalledManifest(s.m.version, k.publicKey).version, s.m.version);
  assert.equal(s.store.isComplete(s.m), true);
});

test('installing a version already complete downloads nothing', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  let calls = 0;
  await s.store.install(s.raw, s.sig, s.m, async (f) => { calls++; return Buffer.from(s.files[f.path]); });
  assert.equal(calls, 0);
});

test('a file whose bytes do not match aborts the install and leaves no version', async () => {
  const s = setup();
  await assert.rejects(
    s.store.install(s.raw, s.sig, s.m, async (f) => Buffer.from(f.path === 'deploy/xgenia.deploy.js' ? 'TAMPERED' : s.files[f.path])),
    /hash mismatch for deploy\/xgenia\.deploy\.js/
  );
  assert.equal(fs.existsSync(s.store.versionDir(s.m.version)), false);
});

test('a download that dies half way never becomes a version', async () => {
  const s = setup();
  let n = 0;
  await assert.rejects(
    s.store.install(s.raw, s.sig, s.m, async (f) => {
      if (++n === 3) throw new Error('network gone');
      return Buffer.from(s.files[f.path]);
    }),
    /network gone/
  );
  assert.equal(fs.existsSync(s.store.versionDir(s.m.version)), false);
});

test('a file changed on disk after install makes the version incomplete', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  fs.writeFileSync(path.join(s.store.versionDir(s.m.version), 'viewer/xgenia.viewer.js'), 'EDITED');
  assert.equal(s.store.isComplete(s.m), false);
});

test('an installed manifest checked against another key reads as absent', async () => {
  const s = setup();
  await s.store.install(s.raw, s.sig, s.m, fetchFrom(s.files));
  assert.equal(s.store.readInstalledManifest(s.m.version, keys().publicKey), null);
});

test('state round-trips; a missing or corrupt state file reads as empty', () => {
  const s = setup();
  assert.deepEqual(s.store.readState().bad, []);
  assert.equal(s.store.readState().cleanExit, true);
  s.store.writeState({ ...s.store.readState(), active: 'v1', bad: ['v0'] });
  assert.equal(s.store.readState().active, 'v1');
  fs.writeFileSync(s.store.statePath(), '{not json');
  assert.equal(s.store.readState().active, null);
});

test('prune keeps only the named versions', () => {
  const s = setup();
  for (const v of ['a1', 'b2', 'c3', '.partial-d4']) fs.mkdirSync(s.store.versionDir(v), { recursive: true });
  s.store.prune(['b2']);
  assert.deepEqual(fs.readdirSync(path.join(s.dir, 'versions')), ['b2']);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/engine-store.test.cjs`
Expected: FAIL — `Cannot find module '../../src/main/src/live-engine/engine-store'`.

- [ ] **Step 3: Write `engine-store.js`**

```js
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
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/xgenia-editor/tests/live-engine/`
Expected: `# fail 0` (manifest + engine-store).

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/main/src/live-engine/engine-store.js packages/xgenia-editor/tests/live-engine/engine-store.test.cjs
git commit -m "Live engine: store downloaded engines, verified or not at all"
```

---

### Task 3: Choosing the engine at startup, trial and fallback

**Files:**
- Create: `packages/xgenia-editor/src/main/src/live-engine/select.js`
- Test: `packages/xgenia-editor/tests/live-engine/select.test.cjs`

**Interfaces:**
- Consumes: `EngineStore` (Task 2).
- Produces: `selectEngine({ appPath, isPackaged, env, store, publicKeyPem, shellApi })` → `{ root, builtinRoot, version, source: 'live'|'builtin', reason, allowUpdates: boolean }`; `markHealthy(store, version)`; `markBad(store, version)`; `markCleanExit(store)`. Built-in root is `path.join(appPath, 'src/external')`; built-in `version` is the string `'builtin'`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-editor/tests/live-engine/select.test.cjs`:

```js
// Live engine (2026-10-03): which engine a start runs, decided from disk, with a way back.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { selectEngine, markHealthy, markBad, markCleanExit } = require('../../src/main/src/live-engine/select');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest } = require('./helpers.cjs');

const k = keys();
const APP = '/Applications/XGENIA.app/Contents/Resources/app.asar';
const newStore = () => new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-select-')));
async function installed(store, version, over = {}) {
  const files = packFiles();
  const m = makeManifest(files, { version, ...over });
  const raw = Buffer.from(JSON.stringify(m));
  await store.install(raw, signManifest(raw, k.privateKey), m, async (f) => Buffer.from(files[f.path]));
  return m;
}
const pick = (store, extra = {}) =>
  selectEngine({ appPath: APP, isPackaged: true, env: {}, store, publicKeyPem: k.publicKey, shellApi: 1, ...extra });

test('nothing installed: the built-in engine, updates allowed', () => {
  const r = pick(newStore());
  assert.equal(r.source, 'builtin');
  assert.equal(r.root, path.join(APP, 'src/external'));
  assert.equal(r.allowUpdates, true);
});

test('development builds and XGENIA_ENGINE=builtin neither use nor fetch a live engine', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), active: 'v1' });
  const dev = pick(store, { isPackaged: false });
  assert.equal(dev.source, 'builtin');
  assert.equal(dev.allowUpdates, false);
  assert.equal(pick(store, { env: { XGENIA_ENGINE: 'builtin' } }).allowUpdates, false);
  assert.equal(pick(store, { isPackaged: false, env: { XGENIA_LIVE_ENGINE: '1' } }).source, 'live');
});

test('a downloaded engine becomes active at the next start, on trial', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), pending: 'v1' });
  const r = pick(store);
  assert.equal(r.source, 'live');
  assert.equal(r.version, 'v1');
  assert.equal(r.root, store.versionDir('v1'));
  assert.equal(r.builtinRoot, path.join(APP, 'src/external'));
  const s = store.readState();
  assert.equal(s.active, 'v1');
  assert.equal(s.trial, 'v1');
  assert.equal(s.pending, null);
});

test('a trial engine whose run neither reported healthy nor quit cleanly is dropped for the previous one', async () => {
  const store = newStore();
  await installed(store, 'v1');
  await installed(store, 'v2');
  store.writeState({ ...store.readState(), active: 'v1', pending: 'v2' });
  assert.equal(pick(store).version, 'v2'); // start 1: v2 on trial, then the app dies
  const r = pick(store); // start 2
  assert.equal(r.version, 'v1');
  assert.deepEqual(store.readState().bad, ['v2']);
});

test('a trial engine that reported healthy stays, and older versions are pruned', async () => {
  const store = newStore();
  for (const v of ['v0', 'v1', 'v2']) await installed(store, v);
  store.writeState({ ...store.readState(), active: 'v1', previous: 'v0', pending: 'v2' });
  pick(store);
  markHealthy(store, 'v2');
  markCleanExit(store);
  assert.equal(pick(store).version, 'v2');
  assert.deepEqual(fs.readdirSync(path.join(store.baseDir, 'versions')).sort(), ['v1', 'v2']);
});

test('a clean quit before the preview ever opened keeps the trial engine', async () => {
  const store = newStore();
  await installed(store, 'v1');
  store.writeState({ ...store.readState(), pending: 'v1' });
  pick(store);
  markCleanExit(store);
  assert.equal(pick(store).version, 'v1');
  assert.equal(store.readState().trial, 'v1');
});

test('markBad on the running engine sends the next start back', async () => {
  const store = newStore();
  await installed(store, 'v1');
  await installed(store, 'v2');
  store.writeState({ ...store.readState(), active: 'v1', pending: 'v2' });
  pick(store);
  markBad(store, 'v2');
  markCleanExit(store);
  assert.equal(pick(store).version, 'v1');
});

test('an engine needing a newer app, a tampered file, or a foreign signature is never picked', async () => {
  const s1 = newStore();
  await installed(s1, 'v1', { minShell: 2 });
  s1.writeState({ ...s1.readState(), active: 'v1' });
  assert.equal(pick(s1).source, 'builtin');

  const s2 = newStore();
  await installed(s2, 'v1');
  s2.writeState({ ...s2.readState(), active: 'v1' });
  fs.writeFileSync(path.join(s2.versionDir('v1'), 'compiler/xgenia.rgs-compiler.js'), 'module.exports = {}');
  assert.equal(pick(s2).source, 'builtin');

  const s3 = newStore();
  await installed(s3, 'v1');
  s3.writeState({ ...s3.readState(), active: 'v1' });
  assert.equal(pick(s3, { publicKeyPem: keys().publicKey }).source, 'builtin');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/select.test.cjs`
Expected: FAIL — `Cannot find module '../../src/main/src/live-engine/select'`.

- [ ] **Step 3: Write `select.js`**

```js
// Which engine this start runs — decided once, before the window opens, from disk only (never the
// network). The web server, export and the Maths panel all read the answer, so the preview,
// exported games and compiled maths always come from the same engine. (2026-10-03)
'use strict';
const path = require('path');

function selectEngine({ appPath, isPackaged, env, store, publicKeyPem, shellApi }) {
  const builtinRoot = path.join(appPath, 'src/external');
  const builtin = (reason, allowUpdates) => ({ root: builtinRoot, builtinRoot, version: 'builtin', source: 'builtin', reason, allowUpdates });
  if (env.XGENIA_ENGINE === 'builtin') return builtin('forced by XGENIA_ENGINE=builtin', false);
  if (!isPackaged && env.XGENIA_LIVE_ENGINE !== '1') return builtin('development build', false);

  const state = store.readState();
  // The last start put a new engine on trial and then neither saw the preview come up on it nor
  // quit cleanly: treat it as broken and go back to what ran before.
  if (state.trial && state.trial === state.active && !state.cleanExit) {
    state.bad = [...new Set([...state.bad, state.trial])];
    state.active = state.previous;
    state.previous = null;
    state.trial = null;
  }
  state.cleanExit = false;

  const usable = (v) => {
    if (!v || state.bad.includes(v)) return null;
    const m = store.readInstalledManifest(v, publicKeyPem);
    return m && m.minShell <= shellApi && store.isComplete(m) ? m : null;
  };

  let chosen = usable(state.pending);
  if (chosen) {
    if (state.active !== chosen.version) {
      state.previous = state.active;
      state.active = chosen.version;
      state.trial = chosen.version;
    }
  } else {
    chosen = usable(state.active);
    if (!chosen) {
      state.active = null;
      state.trial = null;
    }
  }
  state.pending = null;
  store.writeState(state);

  if (!chosen) return builtin('no verified live engine installed', true);
  return {
    root: store.versionDir(chosen.version),
    builtinRoot,
    version: chosen.version,
    source: 'live',
    reason: state.trial === chosen.version ? 'first run of this engine' : 'live',
    allowUpdates: true
  };
}

/** The preview came up on this engine: it is no longer on trial. */
function markHealthy(store, version) {
  const s = store.readState();
  if (s.trial !== version) return;
  s.trial = null;
  store.writeState(s);
  store.prune([s.active, s.previous, s.pending].filter(Boolean));
}

/** This engine failed here: never pick it again; the next start runs the one before it. */
function markBad(store, version) {
  const s = store.readState();
  s.bad = [...new Set([...s.bad, version])];
  if (s.active === version) {
    s.active = s.previous;
    s.previous = null;
    s.trial = null;
  }
  if (s.pending === version) s.pending = null;
  store.writeState(s);
}

function markCleanExit(store) {
  const s = store.readState();
  s.cleanExit = true;
  store.writeState(s);
}

module.exports = { selectEngine, markHealthy, markBad, markCleanExit };
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/xgenia-editor/tests/live-engine/`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/main/src/live-engine/select.js packages/xgenia-editor/tests/live-engine/select.test.cjs
git commit -m "Live engine: pick the engine at startup, with a trial and a way back"
```

---

### Task 4: Background update check and download

**Files:**
- Create: `packages/xgenia-editor/src/main/src/live-engine/updater.js`
- Modify: `packages/xgenia-editor/tests/live-engine/helpers.cjs` (add `fakeCdn`)
- Test: `packages/xgenia-editor/tests/live-engine/updater.test.cjs`

**Interfaces:**
- Consumes: `EngineStore` (Task 2), `verifyManifest` (Task 1).
- Produces: `checkForEngineUpdate({ store, channel, fetchBytes: (url) => Promise<Buffer>, publicKeyPem, shellApi, cdn? })` → `Promise<{ status: 'installed'|'up-to-date'|'needs-app-update'|'rejected'|'error', version?, reason? }>` (never throws); `ENGINE_CDN` (string). Fetches `${cdn}/channels/${channel}/manifest.json` and `.sig`, then `${manifest.filesBase}${path}.gz` per file.
- Produces: `helpers.cjs` `fakeCdn({ version, channel, issuedAt, minShell, files, signKey, corrupt, cdn })` → `{ m, fetchBytes, fetched: string[] }`.

- [ ] **Step 1: Add the fake CDN to the helpers**

Append to `packages/xgenia-editor/tests/live-engine/helpers.cjs` (before `module.exports`), and add `fakeCdn` to the exports:

```js
const zlib = require('zlib');
const { signManifest } = require('../../src/main/src/live-engine/manifest');

/** A channel manifest + gzipped files served from memory, as the Supabase bucket serves them. */
function fakeCdn({ version = 'v2', channel = 'beta', issuedAt = '2026-10-03T12:00:00.000Z', minShell = 1, files = packFiles(), signKey, corrupt, cdn = 'https://cdn.example/engine' } = {}) {
  const m = makeManifest(files, { version, channel, issuedAt, minShell, filesBase: `${cdn}/${version}/files/` });
  const raw = Buffer.from(JSON.stringify(m));
  const objects = new Map([
    [`${cdn}/channels/${channel}/manifest.json`, raw],
    [`${cdn}/channels/${channel}/manifest.sig`, Buffer.from(signManifest(raw, signKey))]
  ]);
  for (const [p, body] of Object.entries(files)) {
    objects.set(`${cdn}/${version}/files/${p}.gz`, zlib.gzipSync(Buffer.from(corrupt === p ? 'CORRUPT' : body)));
  }
  const fetched = [];
  const fetchBytes = async (url) => {
    fetched.push(url);
    if (!objects.has(url)) throw new Error('404 ' + url);
    return objects.get(url);
  };
  return { m, fetchBytes, fetched };
}
```

`module.exports = { keys, packFiles, makeManifest, fakeCdn };`

- [ ] **Step 2: Write the failing test**

`packages/xgenia-editor/tests/live-engine/updater.test.cjs`:

```js
// Live engine (2026-10-03): the background check only ever leaves a verified engine pending.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { checkForEngineUpdate } = require('../../src/main/src/live-engine/updater');
const { keys, fakeCdn } = require('./helpers.cjs');

const k = keys();
const CDN = 'https://cdn.example/engine';
const cdnWith = (o = {}) => fakeCdn({ signKey: k.privateKey, cdn: CDN, ...o });
const newStore = () => new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-upd-')));
const run = (store, cdn, channel = 'beta', shellApi = 1) =>
  checkForEngineUpdate({ store, channel, fetchBytes: cdn.fetchBytes, publicKeyPem: k.publicKey, shellApi, cdn: CDN });

test('a new signed engine is downloaded, verified and left pending', async () => {
  const store = newStore();
  assert.deepEqual(await run(store, cdnWith()), { status: 'installed', version: 'v2' });
  const s = store.readState();
  assert.equal(s.pending, 'v2');
  assert.equal(s.accepted.version, 'v2');
  assert.equal(fs.readFileSync(path.join(store.versionDir('v2'), 'viewer/xgenia.viewer.js'), 'utf8'), 'LIVE VIEWER');
});

test('the same engine again downloads nothing', async () => {
  const store = newStore();
  await run(store, cdnWith());
  const again = cdnWith();
  assert.equal((await run(store, again)).status, 'up-to-date');
  assert.equal(again.fetched.length, 2);
});

test('a manifest signed by someone else is refused; offline is an error', async () => {
  assert.equal((await run(newStore(), cdnWith({ signKey: keys().privateKey }))).status, 'rejected');
  const offline = await checkForEngineUpdate({
    store: newStore(), channel: 'beta', publicKeyPem: k.publicKey, shellApi: 1, cdn: CDN,
    fetchBytes: async () => { throw new Error('getaddrinfo ENOTFOUND'); }
  });
  assert.equal(offline.status, 'error');
  assert.match(offline.reason, /ENOTFOUND/);
});

test('a beta manifest served on the stable path is refused', async () => {
  const beta = cdnWith({ channel: 'beta' });
  const moved = async (url) => beta.fetchBytes(url.replace('/channels/stable/', '/channels/beta/'));
  const r = await checkForEngineUpdate({ store: newStore(), channel: 'stable', fetchBytes: moved, publicKeyPem: k.publicKey, shellApi: 1, cdn: CDN });
  assert.equal(r.status, 'rejected');
  assert.match(r.reason, /manifest is for beta/);
});

test('an older manifest replayed after a newer one is refused', async () => {
  const store = newStore();
  await run(store, cdnWith({ version: 'v3', issuedAt: '2026-10-04T00:00:00.000Z' }));
  const r = await run(store, cdnWith({ version: 'v2', issuedAt: '2026-10-03T00:00:00.000Z' }));
  assert.equal(r.status, 'rejected');
  assert.match(r.reason, /replay/);
});

test('a rollback (older engine, newer issuedAt) is installed', async () => {
  const store = newStore();
  await run(store, cdnWith({ version: 'v3', issuedAt: '2026-10-04T00:00:00.000Z' }));
  assert.deepEqual(await run(store, cdnWith({ version: 'v2', issuedAt: '2026-10-05T00:00:00.000Z' })), { status: 'installed', version: 'v2' });
});

test('an engine that needs a newer app is not downloaded', async () => {
  const store = newStore();
  const cdn = cdnWith({ minShell: 2 });
  const r = await run(store, cdn);
  assert.equal(r.status, 'needs-app-update');
  assert.equal(store.readState().needsAppUpdate, 'v2');
  assert.equal(store.readState().pending, null);
  assert.equal(cdn.fetched.length, 2);
});

test('a corrupt file aborts the install; nothing pending', async () => {
  const store = newStore();
  const r = await run(store, cdnWith({ corrupt: 'deploy/xgenia.deploy.js' }));
  assert.equal(r.status, 'error');
  assert.match(r.reason, /hash mismatch/);
  assert.equal(store.readState().pending, null);
});

test('an engine already marked bad here is not fetched again', async () => {
  const store = newStore();
  store.writeState({ ...store.readState(), bad: ['v2'] });
  assert.equal((await run(store, cdnWith())).status, 'rejected');
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/updater.test.cjs`
Expected: FAIL — `Cannot find module '../../src/main/src/live-engine/updater'`.

- [ ] **Step 4: Write `updater.js`**

```js
// Fetch the channel's signed manifest and, when it names an engine this app can run and has not
// got, download and verify it into the store as `pending` — activated at the next start, never
// mid-session. Never throws: returns what happened. (2026-10-03)
'use strict';
const zlib = require('zlib');
const { verifyManifest } = require('./manifest');

const ENGINE_CDN = 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine';

// Files are stored gzipped. A CDN that decodes on the way (content-encoding) hands back the plain
// bytes; the store's hash check decides either way.
const unpack = (buf) => (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf);

async function checkForEngineUpdate({ store, channel, fetchBytes, publicKeyPem, shellApi, cdn = ENGINE_CDN }) {
  let raw;
  let sig;
  try {
    raw = await fetchBytes(`${cdn}/channels/${channel}/manifest.json`);
    sig = (await fetchBytes(`${cdn}/channels/${channel}/manifest.sig`)).toString('utf8');
  } catch (e) {
    return { status: 'error', reason: e.message };
  }
  let m;
  try {
    m = verifyManifest(raw, sig, publicKeyPem);
  } catch (e) {
    return { status: 'rejected', reason: e.message };
  }
  if (m.channel !== channel) return { status: 'rejected', reason: `manifest is for ${m.channel}, this app follows ${channel}` };

  const state = store.readState();
  if (state.accepted && Date.parse(m.issuedAt) < Date.parse(state.accepted.issuedAt)) {
    return { status: 'rejected', reason: `issued ${m.issuedAt}, older than the accepted ${state.accepted.issuedAt} (replay)` };
  }
  if (state.bad.includes(m.version)) return { status: 'rejected', reason: `${m.version} failed on this machine before` };
  if (m.minShell > shellApi) {
    state.needsAppUpdate = m.version;
    store.writeState(state);
    return { status: 'needs-app-update', version: m.version, reason: `engine needs app shell ${m.minShell}, this app is ${shellApi}` };
  }
  if (m.version === state.active || m.version === state.pending) {
    state.accepted = { version: m.version, issuedAt: m.issuedAt };
    store.writeState(state);
    return { status: 'up-to-date', version: m.version };
  }
  try {
    await store.install(raw, sig, m, async (f) => unpack(await fetchBytes(m.filesBase + f.path + '.gz')));
  } catch (e) {
    return { status: 'error', version: m.version, reason: e.message };
  }
  const after = store.readState(); // the download is slow; re-read before writing
  after.pending = m.version;
  after.accepted = { version: m.version, issuedAt: m.issuedAt };
  after.needsAppUpdate = null;
  store.writeState(after);
  return { status: 'installed', version: m.version };
}

module.exports = { checkForEngineUpdate, ENGINE_CDN };
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `node --test packages/xgenia-editor/tests/live-engine/`
Expected: `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add packages/xgenia-editor/src/main/src/live-engine/updater.js packages/xgenia-editor/tests/live-engine
git commit -m "Live engine: background update check that only installs signed engines"
```

---

### Task 5: Wire the live engine into the main process

**Files:**
- Create: `packages/xgenia-editor/src/main/src/live-engine/index.js`
- Modify: `packages/xgenia-editor/src/main/main.js` (the `app.on('ready', …)` handler, ~line 1836, before `createWindow()`)
- Test: `packages/xgenia-editor/tests/live-engine/index.test.cjs`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `setupLiveEngine({ app, ipcMain, env?, log?, publicKeyPem?, shellApi?, fetch?, timings? })` → `{ info, store, stop() }`. Side effects: `env.XGENIA_ENGINE_ROOT = info.root`, `env.XGENIA_ENGINE_VERSION = info.version`, `global.xgeniaLiveEngine = info`. Listens to `ipcMain` `'live-engine:viewer-ok'` (arg: engine version string), `app` `'xgenia:viewer-bundle-served'` (emitted by the web server, Task 6) and `'will-quit'`. `timings`: `{ checkAfterMs = 15000, checkEveryMs = 21600000, healthTimeoutMs = 90000 }`.
- Produces: `channelFor(env, store)` → `'beta'|'stable'`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-editor/tests/live-engine/index.test.cjs`:

```js
// Live engine (2026-10-03): main-process wiring — decided from disk at once, health-checked, and a
// download during a session changes nothing until the next start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { setupLiveEngine, channelFor } = require('../../src/main/src/live-engine');
const { EngineStore } = require('../../src/main/src/live-engine/engine-store');
const { signManifest } = require('../../src/main/src/live-engine/manifest');
const { keys, packFiles, makeManifest, fakeCdn } = require('./helpers.cjs');

const k = keys();
const quiet = { log() {}, warn() {} };
const never = () => new Promise(() => {});
function fakeApp({ isPackaged = true } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ud-'));
  const app = new EventEmitter();
  Object.assign(app, { isPackaged, getPath: () => userData, getAppPath: () => '/app.asar' });
  return app;
}
async function withPending(app, version) {
  const store = new EngineStore(path.join(app.getPath('userData'), 'engine'));
  const files = packFiles();
  const m = makeManifest(files, { version });
  const raw = Buffer.from(JSON.stringify(m));
  await store.install(raw, signManifest(raw, k.privateKey), m, async (f) => Buffer.from(files[f.path]));
  store.writeState({ ...store.readState(), pending: version });
  return store;
}
const setup = (app, extra = {}) =>
  setupLiveEngine({ app, ipcMain: new EventEmitter(), env: {}, log: quiet, publicKeyPem: k.publicKey, fetch: never, timings: { checkAfterMs: 1e9 }, ...extra });

test('setup decides from disk and returns at once, even when the network never answers', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const env = {};
  const r = setup(app, { env, timings: { checkAfterMs: 0 } });
  assert.equal(r.info.source, 'live');
  assert.equal(env.XGENIA_ENGINE_ROOT, r.store.versionDir('v1'));
  assert.equal(env.XGENIA_ENGINE_VERSION, 'v1');
  assert.equal(global.xgeniaLiveEngine.version, 'v1');
  r.stop();
});

test('the preview reporting in on this engine ends its trial; a report from another build does not', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const ipcMain = new EventEmitter();
  const r = setup(app, { ipcMain });
  app.emit('xgenia:viewer-bundle-served');
  ipcMain.emit('live-engine:viewer-ok', {}, 'local');
  assert.equal(r.store.readState().trial, 'v1');
  ipcMain.emit('live-engine:viewer-ok', {}, 'v1');
  assert.equal(r.store.readState().trial, null);
  r.stop();
});

test('a preview that never reports in marks the engine bad', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const r = setup(app, { timings: { checkAfterMs: 1e9, healthTimeoutMs: 20 } });
  app.emit('xgenia:viewer-bundle-served');
  await new Promise((res) => setTimeout(res, 80));
  assert.deepEqual(r.store.readState().bad, ['v1']);
  r.stop();
});

test('quitting records a clean exit', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const r = setup(app);
  assert.equal(r.store.readState().cleanExit, false);
  app.emit('will-quit');
  assert.equal(r.store.readState().cleanExit, true);
  r.stop();
});

test('an update installed mid-session changes nothing until restart', async () => {
  const app = fakeApp();
  await withPending(app, 'v1');
  const env = {};
  const cdn = fakeCdn({ version: 'v2', channel: 'stable', signKey: k.privateKey, cdn: 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine' });
  const r = setup(app, { env, fetch: cdn.fetchBytes, timings: { checkAfterMs: 0 } });
  for (let i = 0; i < 50 && r.store.readState().pending !== 'v2'; i++) await new Promise((res) => setTimeout(res, 20));
  assert.equal(r.store.readState().pending, 'v2');
  assert.equal(env.XGENIA_ENGINE_VERSION, 'v1');
  assert.equal(global.xgeniaLiveEngine.version, 'v1');
  r.stop();
});

test('a development build never schedules a download', async () => {
  const app = fakeApp({ isPackaged: false });
  let calls = 0;
  const r = setup(app, { fetch: async () => { calls++; throw new Error('x'); }, timings: { checkAfterMs: 0 } });
  await new Promise((res) => setTimeout(res, 30));
  assert.equal(r.info.source, 'builtin');
  assert.equal(calls, 0);
  r.stop();
});

test('channel: env, then settings.json, then stable', () => {
  const store = new EngineStore(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ch-')));
  assert.equal(channelFor({}, store), 'stable');
  fs.writeFileSync(path.join(store.baseDir, 'settings.json'), JSON.stringify({ channel: 'beta' }));
  assert.equal(channelFor({}, store), 'beta');
  assert.equal(channelFor({ XGENIA_ENGINE_CHANNEL: 'stable' }, store), 'stable');
  assert.equal(channelFor({ XGENIA_ENGINE_CHANNEL: 'nonsense' }, store), 'beta');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/index.test.cjs`
Expected: FAIL — `Cannot find module '../../src/main/src/live-engine'`.

- [ ] **Step 3: Write `index.js`**

```js
// Live engine: the preview engine, the export runtime and the RGS compiler come from a signed pack
// CI publishes, instead of only from the app build. Design:
// docs/superpowers/specs/2026-10-03-live-engine-design.md
'use strict';
const fs = require('fs');
const path = require('path');
const { EngineStore } = require('./engine-store');
const { selectEngine, markHealthy, markBad, markCleanExit } = require('./select');
const { checkForEngineUpdate } = require('./updater');
const { ENGINE_PUBLIC_KEY_PEM } = require('./public-key');
const { SHELL_API_VERSION } = require('./shell-api');

async function fetchBytes(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function channelFor(env, store) {
  if (env.XGENIA_ENGINE_CHANNEL === 'beta' || env.XGENIA_ENGINE_CHANNEL === 'stable') return env.XGENIA_ENGINE_CHANNEL;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(store.baseDir, 'settings.json'), 'utf8'));
    if (s.channel === 'beta' || s.channel === 'stable') return s.channel;
  } catch {
    /* no settings file */
  }
  return 'stable';
}

function setupLiveEngine({
  app,
  ipcMain,
  env = process.env,
  log = console,
  publicKeyPem = ENGINE_PUBLIC_KEY_PEM,
  shellApi = SHELL_API_VERSION,
  fetch: fetchImpl = fetchBytes,
  timings = {}
}) {
  const { checkAfterMs = 15000, checkEveryMs = 6 * 3600 * 1000, healthTimeoutMs = 90000 } = timings;
  const store = new EngineStore(path.join(app.getPath('userData'), 'engine'));
  let info;
  try {
    info = selectEngine({ appPath: app.getAppPath(), isPackaged: app.isPackaged, env, store, publicKeyPem, shellApi });
  } catch (e) {
    const root = path.join(app.getAppPath(), 'src/external');
    info = { root, builtinRoot: root, version: 'builtin', source: 'builtin', reason: 'engine selection failed: ' + e.message, allowUpdates: false };
  }
  env.XGENIA_ENGINE_ROOT = info.root;
  env.XGENIA_ENGINE_VERSION = info.version;
  global.xgeniaLiveEngine = info;
  log.log(`[live-engine] ${info.source} ${info.version} — ${info.reason} (${info.root})`);

  const timers = [];
  if (info.source === 'live') {
    let healthy = false;
    let healthTimer = null;
    ipcMain.on('live-engine:viewer-ok', (_event, version) => {
      if (healthy || version !== info.version) return;
      healthy = true;
      if (healthTimer) clearTimeout(healthTimer);
      markHealthy(store, info.version);
    });
    app.on('xgenia:viewer-bundle-served', () => {
      if (healthy || healthTimer) return;
      healthTimer = setTimeout(() => {
        if (healthy) return;
        log.warn(`[live-engine] the preview never reported in on ${info.version}; the next start returns to the previous engine`);
        markBad(store, info.version);
      }, healthTimeoutMs);
      if (healthTimer.unref) healthTimer.unref();
      timers.push(healthTimer);
    });
  }
  if (info.source === 'live' || info.allowUpdates) {
    app.on('will-quit', () => {
      try {
        markCleanExit(store);
      } catch {
        /* quitting anyway */
      }
    });
  }

  if (info.allowUpdates) {
    const check = () =>
      checkForEngineUpdate({ store, channel: channelFor(env, store), fetchBytes: fetchImpl, publicKeyPem, shellApi })
        .then((r) => log.log('[live-engine] update check: ' + JSON.stringify(r)))
        .catch((e) => log.warn('[live-engine] update check failed: ' + e.message));
    const first = setTimeout(check, checkAfterMs);
    const every = setInterval(check, checkEveryMs);
    for (const t of [first, every]) {
      if (t.unref) t.unref();
      timers.push(t);
    }
  }
  return {
    info,
    store,
    stop: () => timers.forEach((t) => { clearTimeout(t); clearInterval(t); })
  };
}

module.exports = { setupLiveEngine, channelFor };
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `node --test packages/xgenia-editor/tests/live-engine/`
Expected: `# fail 0`.

- [ ] **Step 5: Call it from `main.js` before the window opens**

In `packages/xgenia-editor/src/main/main.js`, inside `app.on('ready', function () {`, directly above `console.log('[Main Process] About to call createWindow()...');`, insert:

```js
      // (2026-10-03) Before the window: which engine (preview, export runtime, RGS compiler) this
      // run uses — the signed live engine CI published, or the app's own. See src/live-engine.
      require('./src/live-engine').setupLiveEngine({ app, ipcMain: require('electron').ipcMain });
```

Run: `node -e "require('module')._load = ((l) => function (r, ...a) { return r === 'electron' ? { ipcMain: new (require('events'))() } : l.call(this, r, ...a); })(require('module')._load); require('./packages/xgenia-editor/src/main/src/live-engine')" && echo loads`
Expected: `loads`.

- [ ] **Step 6: Commit**

```bash
git add packages/xgenia-editor/src/main/src/live-engine/index.js packages/xgenia-editor/src/main/main.js packages/xgenia-editor/tests/live-engine/index.test.cjs
git commit -m "Live engine: choose the engine before the window opens; check for updates in the background"
```

---

### Task 6: The web server serves the chosen engine

**Files:**
- Modify: `packages/xgenia-editor/src/main/src/web-server.js` (lines 137, 619, 880, 917, 953 and the start of `startServer`, line ~44)
- Test: `packages/xgenia-editor/tests/live-engine/web-server-engine-root.test.cjs`

**Interfaces:**
- Consumes: `process.env.XGENIA_ENGINE_ROOT` (Task 5).
- Produces: every viewer file (`index.html`, `xgenia.viewer.js`, chunks, react copies, fonts) is read from `${XGENIA_ENGINE_ROOT || appPath + '/src/external'}/viewer/`; serving `xgenia.viewer.js` emits `app.emit('xgenia:viewer-bundle-served')`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-editor/tests/live-engine/web-server-engine-root.test.cjs`:

```js
// Live engine (2026-10-03): the preview server reads viewer files from the engine this run chose.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');

const SERVER = path.resolve(__dirname, '../../src/main/src/web-server.js');
const children = [];
after(() => children.forEach((c) => c.kill()));

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function startServer(engineRoot) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-ws-engine-'));
  const appDir = path.join(root, 'app');
  const projectDir = path.join(root, 'project');
  fs.mkdirSync(path.join(appDir, 'src/external/viewer'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'src/external/viewer/xgenia.viewer.js'), 'BUILTIN VIEWER');
  fs.writeFileSync(path.join(appDir, 'src/external/viewer/xgenia.683.js'), 'BUILTIN CHUNK');
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP SECRET');
  const port = await freePort();
  const script = `
    const Module = require('module');
    const load = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron' || request === '@electron/remote') return { app: { getPath: () => ${JSON.stringify(root)} } };
      return load.call(this, request, ...rest);
    };
    const startServer = require(${JSON.stringify(SERVER)});
    const app = { getAppPath: () => ${JSON.stringify(appDir)}, on() {}, quit() {}, emit(name) { process.stdout.write('EVENT ' + name + '\\n'); } };
    startServer(app, (cb) => cb && cb({}), (cb) => cb({ projectDirectory: ${JSON.stringify(projectDir)} }), () => '');
  `;
  const env = { ...process.env, XGENIAPORT: String(port) };
  delete env.XGENIA_ENGINE_ROOT;
  if (engineRoot) env.XGENIA_ENGINE_ROOT = engineRoot;
  const child = spawn(process.execPath, ['-e', script], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  children.push(child);
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  for (let i = 0; i < 100; i++) {
    try {
      await get(port, '/xgenia.683.js');
      return { port, events: () => out };
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error('web server did not start');
}

test('with no engine chosen, the app\'s own viewer files are served', async () => {
  const s = await startServer(null);
  assert.equal((await get(s.port, '/xgenia.viewer.js')).body, 'BUILTIN VIEWER');
});

test('with a live engine chosen, its viewer files are served and the bundle request is announced', async () => {
  const engine = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-live-'));
  fs.mkdirSync(path.join(engine, 'viewer'), { recursive: true });
  fs.writeFileSync(path.join(engine, 'viewer/xgenia.viewer.js'), 'LIVE VIEWER');
  fs.writeFileSync(path.join(engine, 'viewer/xgenia.683.js'), 'LIVE CHUNK');
  const s = await startServer(engine);
  assert.equal((await get(s.port, '/xgenia.viewer.js')).body, 'LIVE VIEWER');
  assert.equal((await get(s.port, '/xgenia.683.js')).body, 'LIVE CHUNK');
  await new Promise((r) => setTimeout(r, 50));
  assert.match(s.events(), /EVENT xgenia:viewer-bundle-served/);
  assert.notEqual((await get(s.port, '/../secret.txt')).body, 'TOP SECRET');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test packages/xgenia-editor/tests/live-engine/web-server-engine-root.test.cjs`
Expected: FAIL — the live test gets `BUILTIN VIEWER` instead of `LIVE VIEWER`.

- [ ] **Step 3: Read viewer files from the chosen engine**

In `startServer`, after `const appPath = app.getAppPath();` add:

```js
  // (2026-10-03) Viewer files come from the engine this run uses (src/live-engine/select.js):
  // a verified live engine when one was chosen, the app's own otherwise.
  const viewerDir = () => (process.env.XGENIA_ENGINE_ROOT || appPath + '/src/external') + '/viewer/';
```

Replace each of the five literal paths:
- line 137: `const indexHtmlPath = appPath + '/src/external/viewer/index.html';` → `const indexHtmlPath = viewerDir() + 'index.html';`
- line 619: `serveIndexFile(appPath + '/src/external/viewer/index.html', response);` → `serveIndexFile(viewerDir() + 'index.html', response);`
- line 880: same replacement as line 619.
- line 917: `const indexHtmlPath = appPath + '/src/external/viewer/index.html';` → `const indexHtmlPath = viewerDir() + 'index.html';`
- line 953: replace

```js
    const viewerFilePath = appPath + '/src/external/viewer/' + requestPath;
    if (fs.existsSync(viewerFilePath)) {
      serveFile(viewerFilePath, request, response);
```

with

```js
    const viewerFilePath = viewerDir() + requestPath;
    if (fs.existsSync(viewerFilePath)) {
      // The live engine's health check starts when the preview asks for the engine bundle.
      if (requestPath.replace(/^\/+/, '') === 'xgenia.viewer.js' && typeof app.emit === 'function') {
        app.emit('xgenia:viewer-bundle-served');
      }
      serveFile(viewerFilePath, request, response);
```

Run: `grep -n "src/external/viewer" packages/xgenia-editor/src/main/src/web-server.js`
Expected: no output.

- [ ] **Step 4: Run the new test and the existing traversal test**

Run: `node --test packages/xgenia-editor/tests/live-engine/web-server-engine-root.test.cjs packages/xgenia-editor/tests/web-server-traversal.test.cjs`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/main/src/web-server.js packages/xgenia-editor/tests/live-engine/web-server-engine-root.test.cjs
git commit -m "Live engine: preview server serves the chosen engine"
```

---

### Task 7: Export and the Maths panel use the chosen engine and compiler

**Files:**
- Create: `packages/xgenia-editor/src/editor/src/utils/liveEngine.ts`
- Modify: `packages/xgenia-editor/src/editor/src/utils/compilation/build/deploy-index.ts` (lines 33, 63-66, 129)
- Modify: `packages/xgenia-editor/src/editor/src/utils/compilation/build/deployer.ts` (line 8 import, line 318)
- Modify: `packages/xgenia-editor/src/editor/src/utils/CodeEditor/typescript/viewer-react/index.ts` (line 4 import, line 42)
- Modify: `packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx` (line 149 and the success return at ~224)
- Modify: `packages/xgenia-editor/src/editor/src/utils/rgs/generateFunctionArtifact.ts` (line 333)
- Test: `packages/xgenia-editor/tests/live-engine/liveEngine.test.ts`

**Interfaces:**
- Consumes: `global.xgeniaLiveEngine` set by Task 5 (read through `@electron/remote` `getGlobal`).
- Produces (`@xgenia-utils/liveEngine`): `type LiveEngineInfo = { root; builtinRoot; version; source: 'live'|'builtin'; reason? }`, `pickEngineInfo(fromMain, appPath)`, `externalPathFor(info, rel)`, `chooseCompiler(info, loadLive, loadBuiltin, warn?)` → `{ mod, source, version }`, `getLiveEngineInfo()`, `resolveExternalPath(rel)`, `loadRgsCompiler()`.
- Rule: a path whose first segment is `viewer`, `deploy` or `compiler` comes from the engine root; anything else (`cloudruntime`) from the app's own `src/external`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-editor/tests/live-engine/liveEngine.test.ts`:

```ts
// Live engine (2026-10-03): export files and the RGS compiler come from the engine this run chose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { pickEngineInfo, externalPathFor, chooseCompiler, type LiveEngineInfo } from '../../src/editor/src/utils/liveEngine';

const live: LiveEngineInfo = { root: '/ud/engine/versions/v1', builtinRoot: '/app.asar/src/external', version: 'v1', source: 'live' };
const builtinMod = { CloudFunctionConverter: function Builtin() {} };

test("engine folders come from the live engine; the cloud runtime stays the app's own", () => {
  assert.equal(externalPathFor(live, 'deploy/index.json'), path.join('/ud/engine/versions/v1', 'deploy/index.json'));
  assert.equal(externalPathFor(live, path.join('viewer', 'global.d.ts.keep')), path.join('/ud/engine/versions/v1', 'viewer', 'global.d.ts.keep'));
  assert.equal(externalPathFor(live, 'cloudruntime/manifest.json'), path.join('/app.asar/src/external', 'cloudruntime/manifest.json'));
});

test("no usable report from the main process means the app's own engine", () => {
  for (const bad of [null, undefined, {}, { root: '/x', source: 'live' }]) {
    const i = pickEngineInfo(bad, '/app.asar');
    assert.equal(i.source, 'builtin');
    assert.equal(i.root, path.join('/app.asar', 'src/external'));
  }
  assert.equal(pickEngineInfo(live, '/app.asar'), live);
});

test("the live compiler is used when it loads; otherwise the app's", () => {
  const liveMod = { CloudFunctionConverter: function Live() {} };
  const loaded: string[] = [];
  const r = chooseCompiler(live, (f) => { loaded.push(f); return liveMod; }, () => builtinMod);
  assert.equal(r.source, 'live');
  assert.equal(r.mod, liveMod);
  assert.deepEqual(loaded, [path.join('/ud/engine/versions/v1', 'compiler', 'xgenia.rgs-compiler.js')]);
  assert.equal(chooseCompiler(live, () => { throw new Error('SyntaxError'); }, () => builtinMod).source, 'builtin');
  assert.equal(chooseCompiler(live, () => ({}), () => builtinMod).source, 'builtin');
  assert.equal(chooseCompiler({ ...live, source: 'builtin' }, () => liveMod, () => builtinMod).source, 'builtin');
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx --test packages/xgenia-editor/tests/live-engine/liveEngine.test.ts`
Expected: FAIL — cannot find module `liveEngine`.

- [ ] **Step 3: Write `liveEngine.ts`**

`packages/xgenia-editor/src/editor/src/utils/liveEngine.ts`:

```ts
/**
 * The engine this run uses, as the main process chose it at startup (src/main/src/live-engine): a
 * signed live engine CI published, or the app's own. Preview (web server), export (deploy files)
 * and RGS compiling all read it, so they come from one version. (2026-10-03)
 */
import path from 'path';

export type LiveEngineInfo = {
  root: string;
  builtinRoot: string;
  version: string;
  source: 'live' | 'builtin';
  reason?: string;
};

declare const __non_webpack_require__: (id: string) => any;

const ENGINE_FOLDERS = new Set(['viewer', 'deploy', 'compiler']);

export function pickEngineInfo(fromMain: unknown, appPath: string): LiveEngineInfo {
  const i = fromMain as Partial<LiveEngineInfo> | null | undefined;
  if (
    i &&
    typeof i.root === 'string' &&
    typeof i.builtinRoot === 'string' &&
    typeof i.version === 'string' &&
    (i.source === 'live' || i.source === 'builtin')
  ) {
    return i as LiveEngineInfo;
  }
  const root = path.join(appPath, 'src/external');
  return { root, builtinRoot: root, version: 'builtin', source: 'builtin', reason: 'the main process reported no engine' };
}

/** `viewer/…`, `deploy/…`, `compiler/…` come from the engine; anything else (cloudruntime) from the app. */
export function externalPathFor(info: LiveEngineInfo, rel: string): string {
  const first = rel.replace(/^[\\/]+/, '').split(/[\\/]/)[0];
  return path.join(ENGINE_FOLDERS.has(first) ? info.root : info.builtinRoot, rel);
}

type CompilerModule = { CloudFunctionConverter: any };
export type LoadedCompiler = { mod: CompilerModule; source: 'live' | 'builtin'; version: string };

export function chooseCompiler(
  info: LiveEngineInfo,
  loadLive: (file: string) => any,
  loadBuiltin: () => CompilerModule,
  warn: (msg: string, e?: unknown) => void = () => {}
): LoadedCompiler {
  if (info.source === 'live') {
    const file = path.join(info.root, 'compiler', 'xgenia.rgs-compiler.js');
    try {
      const mod = loadLive(file);
      if (mod && typeof mod.CloudFunctionConverter === 'function') return { mod, source: 'live', version: info.version };
      warn(`[live-engine] ${file} has no CloudFunctionConverter; using the app's compiler`);
    } catch (e) {
      warn(`[live-engine] could not load ${file}; using the app's compiler`, e);
    }
  }
  return { mod: loadBuiltin(), source: 'builtin', version: 'builtin' };
}

let cachedInfo: LiveEngineInfo | null = null;
export function getLiveEngineInfo(): LiveEngineInfo {
  if (cachedInfo) return cachedInfo;
  let fromMain: unknown = null;
  try {
    fromMain = require('@electron/remote').getGlobal('xgeniaLiveEngine');
  } catch {
    fromMain = null;
  }
  const { platform } = require('@xgenia/platform');
  cachedInfo = pickEngineInfo(fromMain, platform.getAppPath());
  return cachedInfo;
}

export function resolveExternalPath(rel: string): string {
  return externalPathFor(getLiveEngineInfo(), rel);
}

let cachedCompiler: LoadedCompiler | null = null;
/** The RGS compiler shipped with the engine pack, else the one built into the app. */
export function loadRgsCompiler(): LoadedCompiler {
  if (!cachedCompiler) {
    cachedCompiler = chooseCompiler(
      getLiveEngineInfo(),
      (file) => __non_webpack_require__(file),
      () => require('@xgenia/runtime/src/api/supabase-converter'),
      (msg, e) => console.warn(msg, e)
    );
  }
  return cachedCompiler;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx tsx --test packages/xgenia-editor/tests/live-engine/liveEngine.test.ts`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Point export at the engine**

`deploy-index.ts` — add the import below the existing imports:

```ts
import { resolveExternalPath } from '@xgenia-utils/liveEngine';
```

Line 33: `const indexPath = filesystem.join(getExternalFolderPath(), filePath);` → `const indexPath = resolveExternalPath(filePath);`

Lines 63-66: replace

```ts
    const runtimeDir = filesystem.join(
      getExternalFolderPath(),
      indexFilePath.replace(/[\\\/][^\\\/]*$/, '')
    );
```

with

```ts
    const runtimeDir = resolveExternalPath(indexFilePath.replace(/[\\\/][^\\\/]*$/, ''));
```

Line 129: `const fullPath = filesystem.join(getExternalFolderPath(), runtimeType, url);` → `const fullPath = resolveExternalPath(filesystem.join(runtimeType, url));`

Leave `getExternalFolderPath()` itself unchanged (it still names the app's own folder, used for `cloudruntime`).

`deployer.ts` line 318: `const indexFilePath = filesystem.join(getExternalFolderPath(), 'deploy', indexFile.url);` → `const indexFilePath = resolveExternalPath(filesystem.join('deploy', indexFile.url));`, add `import { resolveExternalPath } from '@xgenia-utils/liveEngine';`, and remove `getExternalFolderPath` from the line-8 import if nothing else in the file uses it (`grep -n getExternalFolderPath deployer.ts`).

`CodeEditor/typescript/viewer-react/index.ts` line 42: `const filePath = filesystem.join(getExternalFolderPath(), 'viewer', 'global.d.ts.keep');` → `const filePath = resolveExternalPath(filesystem.join('viewer', 'global.d.ts.keep'));`; replace the line-4 import of `getExternalFolderPath` with `import { resolveExternalPath } from '@xgenia-utils/liveEngine';`.

- [ ] **Step 6: Point both compiler call sites at `loadRgsCompiler`**

`MathsPanel.tsx` line 149: replace `const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');` with

```ts
            const compiler = require('@xgenia-utils/liveEngine').loadRgsCompiler();
            const { CloudFunctionConverter } = compiler.mod;
```

and in the success `return { … }` of `generateRgsScript` (after `unsupportedNodes: result.unsupportedNodes,`) add:

```ts
                // Which compiler built this script: the live engine's, or the app's own.
                compiler: { source: compiler.source, version: compiler.version },
```

`generateFunctionArtifact.ts` line 333: replace `const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');` with

```ts
  const { CloudFunctionConverter } = require('@xgenia-utils/liveEngine').loadRgsCompiler().mod;
```

(and keep the comment above it).

- [ ] **Step 7: Typecheck the touched files against the base**

Run (once on the base commit, once after the change, compare):

```bash
npx tsc --noEmit -p packages/xgenia-editor/tsconfig.json 2>&1 | grep -E "liveEngine|deploy-index|deployer\.ts|MathsPanel\.tsx|generateFunctionArtifact|viewer-react/index\.ts" | sort > /tmp/tsc-after.txt; wc -l /tmp/tsc-after.txt
```

Expected: no line mentions `liveEngine.ts`, and the count for the other files equals the base count (pre-existing errors only).

- [ ] **Step 8: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/utils/liveEngine.ts packages/xgenia-editor/src/editor/src/utils/compilation/build/deploy-index.ts packages/xgenia-editor/src/editor/src/utils/compilation/build/deployer.ts packages/xgenia-editor/src/editor/src/utils/CodeEditor/typescript/viewer-react/index.ts packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx packages/xgenia-editor/src/editor/src/utils/rgs/generateFunctionArtifact.ts packages/xgenia-editor/tests/live-engine/liveEngine.test.ts
git commit -m "Live engine: export and the Maths panel use the chosen engine and compiler"
```

---

### Task 8: Version stamps in the bundles, the compiler and the preview

**Files:**
- Modify: `packages/xgenia-viewer-react/webpack-configs/webpack.common.js` (`plugins:` at line 109)
- Modify: `packages/xgenia-runtime/src/editorconnection.js` (`sendNodeLibrary`, line ~466)
- Modify: `packages/xgenia-runtime/src/api/supabase-converter.ts` (top of file; header at line 1383-1384; return type ~1259; return at line 1461)
- Modify: `packages/xgenia-editor/src/editor/src/ViewerConnection.ts` (imports; `nodelibrary` branch, line ~159)
- Test: `packages/xgenia-runtime/test/editorconnection-engine-version.test.js`

**Interfaces:**
- Consumes: build-time global `__XGENIA_ENGINE_VERSION__` (webpack `DefinePlugin` for the viewer/deploy bundles from env `XGENIA_ENGINE_VERSION`, default `'local'`; esbuild `define` for the compiler, Task 9).
- Produces: `nodelibrary` WebSocket message gains `engineVersion: string` (`'unknown'` when not stamped). Compiled RGS scripts gain the header line `// Compiler: <version>` (`'bundled'` for the compiler built into the app). `generateRgsScript()` returns `compilerVersion: string`. The renderer sends IPC `'live-engine:viewer-ok'` with the preview's `engineVersion`.

- [ ] **Step 1: Write the failing test**

`packages/xgenia-runtime/test/editorconnection-engine-version.test.js`:

```js
// Live engine (2026-10-03): the preview tells the editor which engine build it runs, so the main
// process can end a new engine's trial and support can see what a user runs.
const EditorConnection = require('../src/editorconnection');

function connection() {
  const ec = new EditorConnection({ runtimeType: 'browser', platform: { getCurrentTime: () => 0 } });
  const sent = [];
  ec.send = (msg) => sent.push(msg);
  return { ec, sent };
}

describe('node library carries the engine version', () => {
  afterEach(() => {
    delete globalThis.__XGENIA_ENGINE_VERSION__;
  });

  test('unstamped builds say unknown', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{}');
    expect(sent[0].cmd).toBe('nodelibrary');
    expect(sent[0].engineVersion).toBe('unknown');
  });

  test('a stamped build sends its version', () => {
    globalThis.__XGENIA_ENGINE_VERSION__ = '20261003.1200-aaaaaaaa-bbbbbbbb';
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{}');
    expect(sent[0].engineVersion).toBe('20261003.1200-aaaaaaaa-bbbbbbbb');
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd packages/xgenia-runtime && npx jest test/editorconnection-engine-version.test.js; cd ../..`
Expected: FAIL — `expected "unknown", received undefined`.

- [ ] **Step 3: Stamp the message**

In `packages/xgenia-runtime/src/editorconnection.js`, add at the top of the file:

```js
/* global __XGENIA_ENGINE_VERSION__ */
```

and change `sendNodeLibrary` to:

```js
EditorConnection.prototype.sendNodeLibrary = function (nodelibrary) {
  this.send({
    cmd: 'nodelibrary',
    type: 'viewer',
    runtimeType: this.runtimeType,
    content: nodelibrary,
    clientId: this.clientId,
    // (2026-10-03) Which engine build this is (live-engine pack version, 'local' for a dev build).
    engineVersion: typeof __XGENIA_ENGINE_VERSION__ !== 'undefined' ? __XGENIA_ENGINE_VERSION__ : 'unknown'
  });
};
```

- [ ] **Step 4: Run it to see it pass**

Run: `cd packages/xgenia-runtime && npx jest test/editorconnection-engine-version.test.js test/nodelibrary-resent-on-reconnect.test.js; cd ../..`
Expected: all pass.

- [ ] **Step 5: Stamp the viewer and deploy bundles**

In `packages/xgenia-viewer-react/webpack-configs/webpack.common.js`, make the first entry of `plugins: [` :

```js
    // (2026-10-03) The live-engine pack version (CI sets XGENIA_ENGINE_VERSION); 'local' otherwise.
    new webpack.DefinePlugin({
      __XGENIA_ENGINE_VERSION__: JSON.stringify(process.env.XGENIA_ENGINE_VERSION || 'local')
    }),
```

- [ ] **Step 6: Stamp compiled scripts**

In `packages/xgenia-runtime/src/api/supabase-converter.ts`, after the import block add:

```ts
// (2026-10-03) Set by the live-engine compiler bundle (esbuild define); the compiler built into the
// app has none and reports 'bundled'. Every compiled script names the compiler that made it.
declare const __XGENIA_ENGINE_VERSION__: string;
const COMPILER_VERSION: string = typeof __XGENIA_ENGINE_VERSION__ !== 'undefined' ? __XGENIA_ENGINE_VERSION__ : 'bundled';
```

After line 1384 (`'// Generated: ' + new Date().toISOString(),`) add:

```ts
      '// Compiler: ' + COMPILER_VERSION,
```

In the return type of `generateRgsScript()` add `compilerVersion: string;` after `loopsCompiled: number;`, and change line 1461 to:

```ts
    return { script: sanitizedScript, configData, unsupportedNodes: this._unsupportedNodes, loopsCompiled: this._loopBlocks.length, compilerVersion: COMPILER_VERSION };
```

Run: `cd packages/xgenia-runtime && npx jest test/slot-features; cd ../..`
Expected: all pass (no test compares the header).

Run: `grep -rln "Auto-generated from editor graph" private/xgenia-ai-app/tests | head`
For each file listed, run it from `private/xgenia-ai-app` with `npx vitest run <file>` and confirm it still passes.

- [ ] **Step 7: The editor reports the preview's engine to the main process**

In `packages/xgenia-editor/src/editor/src/ViewerConnection.ts` add `import { ipcRenderer } from 'electron';` to the imports, and change the `nodelibrary` branch to:

```ts
    } else if (request.cmd === 'nodelibrary' && request.type === 'viewer') {
      const content = JSON.parse(request.content);
      // (2026-10-03) The preview says which engine build it runs; the main process ends a new live
      // engine's trial on it (src/main/src/live-engine).
      if (request.runtimeType === 'browser' && typeof request.engineVersion === 'string') {
        ipcRenderer.send('live-engine:viewer-ok', request.engineVersion);
      }

      this.loadNodeLibrary(request.clientId, request.runtimeType, content);
```

- [ ] **Step 8: Commit**

```bash
git add packages/xgenia-viewer-react/webpack-configs/webpack.common.js packages/xgenia-runtime/src/editorconnection.js packages/xgenia-runtime/src/api/supabase-converter.ts packages/xgenia-editor/src/editor/src/ViewerConnection.ts packages/xgenia-runtime/test/editorconnection-engine-version.test.js
git commit -m "Live engine: bundles, compiled scripts and the preview carry the engine version"
```

---

### Task 9: The compiler as one bundle, proven equal to the source

**Files:**
- Create: `packages/xgenia-runtime/src/api/rgs-compiler-entry.ts`
- Create: `scripts/live-engine/build-compiler.mjs`
- Test: `packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts`

**Interfaces:**
- Consumes: `COMPILER_VERSION` stamp (Task 8).
- Produces: `buildCompiler(outfile: string, version: string): Promise<void>` (ESM export). The bundle (CommonJS) exports `CloudFunctionConverter`, `CORES_SOURCE`, `coreNames`.

Why a canonical comparison: esbuild reprints `defineSlotFeatureCores`, so its text (embedded in every script as `const __sfc = (…)();`) differs in layout from the source. Checked on 2026-10-03: raw scripts differ, but after reprinting both scripts through esbuild they are identical for both fixtures.

- [ ] **Step 1: Write the entry and the failing parity test**

`packages/xgenia-runtime/src/api/rgs-compiler-entry.ts`:

```ts
// Entry for the live-engine compiler bundle (scripts/live-engine/build-compiler.mjs). (2026-10-03)
export { CloudFunctionConverter } from './supabase-converter';
export { CORES_SOURCE, coreNames } from './slot-feature-cores';
```

`packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts`:

```ts
/**
 * The live-engine compiler bundle must compile maths exactly like the compiler source the editor
 * bundles. Scripts are compared after reprinting both through esbuild (the bundle reprints the
 * embedded slot-feature cores; comments, including the Generated/Compiler header, drop out).
 * Also: the bundle carries its version, its cores text runs standalone (as it does inside an RGS
 * script) and reproduces the Cascade The Reels goldens, and no esbuild helper leaks in. (2026-10-03)
 *
 * Usage (repo root): npx tsx packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CloudFunctionConverter as SourceConverter } from './supabase-converter';

const { transformSync } = require('esbuild');
const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../../..');
const FIXTURES = ['round-player-parrot.json', 'round-player-leprechaun.json'];
const GOLDENS = path.resolve(HERE, '../../test/slot-features/cascade-the-reels.goldens.json');
const HELPERS = /\b__(name|spreadValues|spreadProps|async|publicField|objRest|toESM|toCommonJS|commonJS|require|export|defProp)\b/;

const mapNode = (n: any): any => ({ ...n, typename: n.type || n.typename, dynamicports: n.dynamicports || n.ports || [], children: (n.children || []).map(mapNode) });
const canon = (s: string) => transformSync('(function (ctx) {\n' + s + '\n})', { loader: 'js', legalComments: 'none' }).code as string;

async function main() {
  const { buildCompiler } = await import(pathToFileURL(path.join(ROOT, 'scripts/live-engine/build-compiler.mjs')).href);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-compiler-')), 'xgenia.rgs-compiler.js');
  await buildCompiler(out, 'vPARITY');
  const bundled = require(out);
  let failures = 0;
  const fail = (what: string, msg: string) => { failures++; console.log(`FAIL  ${what}: ${msg}`); };

  for (const file of FIXTURES) {
    const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', file), 'utf8'));
    const comp = { ...fx.component, graph: { roots: fx.component.graph.roots.map(mapNode), connections: fx.component.graph.connections } };
    const project = { name: 'fixture', components: [comp] };
    const quiet = console.warn;
    console.warn = () => {};
    const a = new SourceConverter(comp as any, project as any).generateRgsScript();
    const b = new bundled.CloudFunctionConverter(comp, project).generateRgsScript();
    console.warn = quiet;
    const ca = canon(a.script).split('\n');
    const cb = canon(b.script).split('\n');
    const at = ca.findIndex((l, i) => l !== cb[i]);
    if (at >= 0 || ca.length !== cb.length) fail(file, `scripts differ at canonical line ${at}:\n  source: ${ca[at]}\n  bundle: ${cb[at]}`);
    if (JSON.stringify(a.unsupportedNodes) !== JSON.stringify(b.unsupportedNodes)) fail(file, 'unsupported nodes differ');
    if (a.loopsCompiled !== b.loopsCompiled) fail(file, `loops ${a.loopsCompiled} vs ${b.loopsCompiled}`);
    if (!/^\/\/ Compiler: vPARITY$/m.test(b.script) || b.compilerVersion !== 'vPARITY') fail(file, 'the bundle does not carry its version');
    if (a.compilerVersion !== 'bundled') fail(file, `the source compiler reports ${a.compilerVersion}`);
    if (HELPERS.test(b.script)) fail(file, 'an esbuild helper leaked into the script');
    if (!failures) console.log(`ok    ${file} — ${b.script.length} bytes, ${b.loopsCompiled} loop(s)`);
  }

  const cores = new Function('return (' + bundled.CORES_SOURCE + ')()')();
  const goldens = JSON.parse(fs.readFileSync(GOLDENS, 'utf8'));
  const bad = goldens.filter((g: any) => JSON.stringify(cores.cascadeTheReels({ ...g.in, seeds: g.in.seeds }).reels) !== JSON.stringify(g.out));
  if (bad.length) fail('cores', `${bad.length}/${goldens.length} Cascade The Reels goldens differ when the bundle's cores run standalone`);
  if (JSON.stringify(Object.keys(cores).sort()) !== JSON.stringify([...bundled.coreNames].sort())) fail('cores', 'core names differ');

  if (failures) process.exit(1);
  console.log('\nthe live compiler bundle compiles exactly like the source');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx tsx packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts`
Expected: FAIL — cannot find `scripts/live-engine/build-compiler.mjs`.

- [ ] **Step 3: Write `build-compiler.mjs`**

```js
// The RGS compiler (packages/xgenia-runtime/src/api/supabase-converter.ts) as one CommonJS file for
// the live-engine pack. Usage: node scripts/live-engine/build-compiler.mjs <outfile> [version]
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function buildCompiler(outfile, version) {
  await build({
    entryPoints: [path.join(ROOT, 'packages/xgenia-runtime/src/api/rgs-compiler-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    outfile,
    define: { __XGENIA_ENGINE_VERSION__: JSON.stringify(version) },
    // keepNames would wrap functions in __name(...) calls; the compiler embeds
    // String(defineSlotFeatureCores) into every RGS script, where __name does not exist.
    keepNames: false,
    minify: false,
    logLevel: 'warning'
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [outfile, version] = process.argv.slice(2);
  if (!outfile) {
    console.error('usage: build-compiler.mjs <outfile> [version]');
    process.exit(2);
  }
  await buildCompiler(outfile, version || process.env.XGENIA_ENGINE_VERSION || 'local');
  console.log('compiler bundle ->', outfile);
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx tsx packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts`
Expected: two `ok` lines and `the live compiler bundle compiles exactly like the source`.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-runtime/src/api/rgs-compiler-entry.ts packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts scripts/live-engine/build-compiler.mjs
git commit -m "Live engine: RGS compiler bundle, proven to compile like the source"
```

---

### Task 10: Pack, smoke-check, publish and promote scripts

**Files:**
- Create: `scripts/live-engine/pack.mjs`
- Create: `scripts/live-engine/smoke.mjs`
- Create: `scripts/live-engine/publish.mjs`
- Create: `scripts/live-engine/promote.mjs`
- Test: `scripts/live-engine/pack.test.mjs`

**Interfaces:**
- Consumes: `manifest.js` (Task 1), `public-key.js` (Task 1), compiler bundle exports (Task 9), version stamps (Task 8).
- Produces: `pack.mjs` exports `PUBLIC_BASE`, `listPackFiles(filesDir)`, `buildManifest({ filesDir, version, channel, minShell, sources, issuedAt?, publicBase? })`, `writePack({ filesDir, outDir, manifest, privateKeyPem })`; CLI `node scripts/live-engine/pack.mjs --files <dir> --out <dir> --channel beta` (env `ENGINE_SIGNING_KEY`, `XGENIA_ENGINE_VERSION`, optional `ENGINE_OUTER_SHA`, `ENGINE_PRIVATE_SHA`).
- Produces: upload folder layout `<out>/<version>/files/<path>.gz`, `<out>/<version>/manifest.json|.sig`, `<out>/channels/<channel>/manifest.json|.sig`.
- Produces: `smoke.mjs <uploadDir> <channel>`; `publish.mjs <uploadDir> <version> <channel>` (env `SUPABASE_ENGINE_SERVICE_KEY`); `promote.mjs [version]` (env `ENGINE_SIGNING_KEY`, `SUPABASE_ENGINE_SERVICE_KEY`).

- [ ] **Step 1: Write the failing test**

`scripts/live-engine/pack.test.mjs`:

```js
// Live engine (2026-10-03): what CI uploads is exactly what the app will accept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildManifest, writePack, listPackFiles } from './pack.mjs';

const require = createRequire(import.meta.url);
const { verifyManifest } = require('../../packages/xgenia-editor/src/main/src/live-engine/manifest.js');
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

function filesDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-pack-'));
  const files = {
    'viewer/index.html': '<html>', 'viewer/xgenia.viewer.js': 'V', 'viewer/xgenia.683.js': 'C',
    'deploy/index.json': '[]', 'deploy/xgenia.deploy.js': 'D', 'deploy/xgenia.deploy.js.map': 'MAP',
    'compiler/xgenia.rgs-compiler.js': 'X', 'stray.txt': 'no'
  };
  for (const [p, b] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), b);
  }
  return dir;
}

test('source maps and files outside viewer/deploy/compiler are left out', () => {
  assert.deepEqual(listPackFiles(filesDir()), [
    'compiler/xgenia.rgs-compiler.js', 'deploy/index.json', 'deploy/xgenia.deploy.js',
    'viewer/index.html', 'viewer/xgenia.683.js', 'viewer/xgenia.viewer.js'
  ]);
});

test('the pack verifies with the public key and every .gz unpacks to its listed bytes', () => {
  const dir = filesDir();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-out-'));
  const m = buildManifest({ filesDir: dir, version: 'v7', channel: 'beta', minShell: 1, sources: {} });
  writePack({ filesDir: dir, outDir: out, manifest: m, privateKeyPem: privateKey });
  for (const where of ['v7', 'channels/beta']) {
    const got = verifyManifest(fs.readFileSync(path.join(out, where, 'manifest.json')), fs.readFileSync(path.join(out, where, 'manifest.sig'), 'utf8'), publicKey);
    assert.equal(got.version, 'v7');
    assert.ok(got.filesBase.endsWith('/engine/v7/files/'));
  }
  assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(out, 'v7/files/viewer/xgenia.viewer.js.gz'))).toString(), 'V');
});

test('a build missing the compiler cannot be packed', () => {
  const dir = filesDir();
  fs.rmSync(path.join(dir, 'compiler'), { recursive: true });
  assert.throws(() => buildManifest({ filesDir: dir, version: 'v7', channel: 'beta', minShell: 1, sources: {} }), /missing compiler/);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test scripts/live-engine/pack.test.mjs`
Expected: FAIL — cannot find `./pack.mjs`.

- [ ] **Step 3: Write `pack.mjs`**

```js
// Turn a built engine (<files>/viewer, <files>/deploy, <files>/compiler) into an upload folder:
// <out>/<version>/files/<path>.gz, <out>/<version>/manifest.json + .sig, and the same manifest and
// signature at <out>/channels/<channel>/. (2026-10-03)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { FORMAT, ROOTS, validateManifest, signManifest, sha256 } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/manifest.js'));

export const PUBLIC_BASE = 'https://pcrghrjikkcmelflwiys.supabase.co/storage/v1/object/public/engine';
const skip = (rel) => rel.endsWith('.map') || path.basename(rel) === '.DS_Store';

export function listPackFiles(filesDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = path.relative(filesDir, abs).split(path.sep).join('/');
      if (!skip(rel) && ROOTS.some((r) => rel.startsWith(r))) out.push(rel);
    }
  };
  walk(filesDir);
  return out.sort();
}

export function buildManifest({ filesDir, version, channel, minShell, sources, issuedAt = new Date().toISOString(), publicBase = PUBLIC_BASE }) {
  const files = listPackFiles(filesDir).map((p) => {
    const body = fs.readFileSync(path.join(filesDir, p));
    return { path: p, sha256: sha256(body), size: body.length };
  });
  return validateManifest({ format: FORMAT, version, channel, issuedAt, minShell, sources, filesBase: `${publicBase}/${version}/files/`, files });
}

export function writePack({ filesDir, outDir, manifest, privateKeyPem }) {
  const raw = Buffer.from(JSON.stringify(manifest, null, 2));
  const sig = signManifest(raw, privateKeyPem);
  for (const f of manifest.files) {
    const dest = path.join(outDir, manifest.version, 'files', f.path + '.gz');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, zlib.gzipSync(fs.readFileSync(path.join(filesDir, f.path)), { level: 9 }));
  }
  for (const dir of [path.join(outDir, manifest.version), path.join(outDir, 'channels', manifest.channel)]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), raw);
    fs.writeFileSync(path.join(dir, 'manifest.sig'), sig);
  }
  return { raw, sig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = {};
  process.argv.slice(2).forEach((a, i, all) => {
    if (a.startsWith('--')) args[a.slice(2)] = all[i + 1];
  });
  const key = process.env.ENGINE_SIGNING_KEY;
  const version = process.env.XGENIA_ENGINE_VERSION;
  if (!key) { console.error('ENGINE_SIGNING_KEY is not set'); process.exit(1); }
  if (!version) { console.error('XGENIA_ENGINE_VERSION is not set'); process.exit(1); }
  if (!args.files || !args.out) { console.error('usage: pack.mjs --files <dir> --out <dir> [--channel beta]'); process.exit(2); }
  const channel = args.channel || 'beta';
  const { minShell } = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/xgenia-viewer-react/engine-compat.json'), 'utf8'));
  const manifest = buildManifest({
    filesDir: args.files, version, channel, minShell,
    sources: { outer: process.env.ENGINE_OUTER_SHA || '', private: process.env.ENGINE_PRIVATE_SHA || '' }
  });
  writePack({ filesDir: args.files, outDir: args.out, manifest, privateKeyPem: key });
  console.log(`packed ${manifest.files.length} files as ${version} (${channel}) -> ${args.out}`);
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test scripts/live-engine/pack.test.mjs`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 5: Write `smoke.mjs`**

```js
// Last check before publishing. The pack must verify with the key the APP carries (a wrong
// ENGINE_SIGNING_KEY secret would otherwise publish an engine no app accepts), every file must
// unpack to its hash, both bundles must carry the version and the slot nodes, and the packed
// compiler must compile real maths: no unsupported nodes, one loop, its version in the header,
// and its cores reproduce the Cascade The Reels goldens. Usage: smoke.mjs <uploadDir> <channel>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { verifyManifest, sha256 } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/manifest.js'));
const { ENGINE_PUBLIC_KEY_PEM } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/public-key.js'));

const [uploadDir, channel = 'beta'] = process.argv.slice(2);
const fail = (msg) => { console.error('SMOKE FAIL: ' + msg); process.exit(1); };
if (!uploadDir) fail('usage: smoke.mjs <uploadDir> <channel>');

const chan = path.join(uploadDir, 'channels', channel);
let m;
try {
  m = verifyManifest(fs.readFileSync(path.join(chan, 'manifest.json')), fs.readFileSync(path.join(chan, 'manifest.sig'), 'utf8'), ENGINE_PUBLIC_KEY_PEM);
} catch (e) {
  fail(`the channel manifest does not verify with the app's public key: ${e.message}`);
}

const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-smoke-'));
for (const f of m.files) {
  const body = zlib.gunzipSync(fs.readFileSync(path.join(uploadDir, m.version, 'files', f.path + '.gz')));
  if (body.length !== f.size || sha256(body) !== f.sha256) fail(`${f.path} does not match its manifest entry`);
  fs.mkdirSync(path.dirname(path.join(unpacked, f.path)), { recursive: true });
  fs.writeFileSync(path.join(unpacked, f.path), body);
}
for (const p of ['viewer/xgenia.viewer.js', 'deploy/xgenia.deploy.js']) {
  const text = fs.readFileSync(path.join(unpacked, p), 'utf8');
  if (!text.includes(m.version)) fail(`${p} does not carry ${m.version} (was XGENIA_ENGINE_VERSION set for the webpack build?)`);
  if (!text.includes('Cascade The Reels')) fail(`${p} has no slot nodes (built without private/xgenia-pro-nodes?)`);
}

const compiler = require(path.join(unpacked, 'compiler/xgenia.rgs-compiler.js'));
const mapNode = (n) => ({ ...n, typename: n.type || n.typename, dynamicports: n.dynamicports || n.ports || [], children: (n.children || []).map(mapNode) });
for (const file of ['round-player-parrot.json', 'round-player-leprechaun.json']) {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/xgenia-runtime/src/api/fixtures', file), 'utf8'));
  const comp = { ...fx.component, graph: { roots: fx.component.graph.roots.map(mapNode), connections: fx.component.graph.connections } };
  const quiet = console.warn;
  console.warn = () => {};
  const out = new compiler.CloudFunctionConverter(comp, { name: 'fixture', components: [comp] }).generateRgsScript();
  console.warn = quiet;
  if (out.unsupportedNodes.length) fail(`${file}: unsupported ${JSON.stringify(out.unsupportedNodes)}`);
  if (out.loopsCompiled !== 1) fail(`${file}: expected 1 compiled loop, got ${out.loopsCompiled}`);
  if (!out.script.includes('// Compiler: ' + m.version)) fail(`${file}: script header does not name compiler ${m.version}`);
  try { new Function('ctx', out.script); } catch (e) { fail(`${file}: script does not parse: ${e.message}`); }
}
const cores = new Function('return (' + compiler.CORES_SOURCE + ')()')();
const goldens = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/xgenia-runtime/test/slot-features/cascade-the-reels.goldens.json'), 'utf8'));
const bad = goldens.filter((g) => JSON.stringify(cores.cascadeTheReels({ ...g.in, seeds: g.in.seeds }).reels) !== JSON.stringify(g.out));
if (bad.length) fail(`${bad.length}/${goldens.length} Cascade The Reels goldens differ`);
console.log(`smoke ok: ${m.version} (${channel}), ${m.files.length} files`);
```

- [ ] **Step 6: Write `publish.mjs`**

```js
// Upload a pack to the public Supabase Storage bucket `engine`: the version's files and manifest
// first, the channel manifest last, so a channel never names files that are not there yet.
// Usage: SUPABASE_ENGINE_SERVICE_KEY=… node scripts/live-engine/publish.mjs <uploadDir> <version> <channel>
import fs from 'node:fs';
import path from 'node:path';

const SUPABASE_URL = 'https://pcrghrjikkcmelflwiys.supabase.co';
const BUCKET = 'engine';
const key = process.env.SUPABASE_ENGINE_SERVICE_KEY;
const [uploadDir, version, channel] = process.argv.slice(2);
if (!key) { console.error('SUPABASE_ENGINE_SERVICE_KEY is not set'); process.exit(1); }
if (!uploadDir || !version || !channel) { console.error('usage: publish.mjs <uploadDir> <version> <channel>'); process.exit(2); }
const auth = { Authorization: `Bearer ${key}`, apikey: key };

async function ensureBucket() {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
  });
  if (r.ok) return;
  const t = await r.text();
  if (!/already exists|duplicate/i.test(t)) throw new Error(`create bucket: ${r.status} ${t}`);
}

async function upload(objectPath, body, contentType, maxAge) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: 'POST',
    headers: { ...auth, 'content-type': contentType, 'cache-control': `max-age=${maxAge}`, 'x-upsert': 'true' },
    body
  });
  if (!r.ok) throw new Error(`upload ${objectPath}: ${r.status} ${await r.text()}`);
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')]
  );
}

const type = (p) => (p.endsWith('.gz') ? 'application/gzip' : p.endsWith('.json') ? 'application/json' : 'text/plain');

await ensureBucket();
const versionDir = path.join(uploadDir, version);
const files = walk(versionDir);
for (const rel of files) {
  await upload(`${version}/${rel}`, fs.readFileSync(path.join(versionDir, rel)), type(rel), 31536000);
}
for (const name of ['manifest.json', 'manifest.sig']) {
  await upload(`channels/${channel}/${name}`, fs.readFileSync(path.join(uploadDir, 'channels', channel, name)), type(name), 60);
}
console.log(`published ${version} (${files.length} objects) and pointed ${channel} at it: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/channels/${channel}/manifest.json`);
```

- [ ] **Step 7: Write `promote.mjs`**

```js
// Point the stable channel at a version already published (default: the current beta), re-signed
// with a new issuedAt. Apps refuse a manifest older than the last one they accepted, so a rollback
// is "promote an older version". Usage: ENGINE_SIGNING_KEY=… SUPABASE_ENGINE_SERVICE_KEY=… \
//   node scripts/live-engine/promote.mjs [version]
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { verifyManifest, validateManifest, signManifest } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/manifest.js'));
const { ENGINE_PUBLIC_KEY_PEM } = require(path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine/public-key.js'));

const SUPABASE_URL = 'https://pcrghrjikkcmelflwiys.supabase.co';
const PUBLIC = `${SUPABASE_URL}/storage/v1/object/public/engine`;
const signingKey = process.env.ENGINE_SIGNING_KEY;
const serviceKey = process.env.SUPABASE_ENGINE_SERVICE_KEY;
if (!signingKey || !serviceKey) { console.error('ENGINE_SIGNING_KEY and SUPABASE_ENGINE_SERVICE_KEY must be set'); process.exit(1); }
const version = process.argv[2];
const from = version ? `${PUBLIC}/${version}` : `${PUBLIC}/channels/beta`;

const get = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const m = verifyManifest(await get(`${from}/manifest.json`), (await get(`${from}/manifest.sig`)).toString('utf8'), ENGINE_PUBLIC_KEY_PEM);
const stable = validateManifest({ ...m, channel: 'stable', issuedAt: new Date().toISOString() });
const raw = Buffer.from(JSON.stringify(stable, null, 2));
const sig = signManifest(raw, signingKey);
for (const [name, body, type] of [['manifest.json', raw, 'application/json'], ['manifest.sig', Buffer.from(sig), 'text/plain']]) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/engine/channels/stable/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'content-type': type, 'cache-control': 'max-age=60', 'x-upsert': 'true' },
    body
  });
  if (!r.ok) throw new Error(`upload ${name}: ${r.status} ${await r.text()}`);
}
console.log(`stable -> ${stable.version} (issued ${stable.issuedAt})`);
```

- [ ] **Step 8: Build, pack and smoke a real engine locally (no upload)**

```bash
export XGENIA_ENGINE_VERSION="$(date -u +%Y%m%d.%H%M)-$(git rev-parse --short=8 HEAD)-$(git -C private rev-parse --short=8 HEAD)"
OUT=$(mktemp -d)
OUTPUT_PATH=$OUT/files npm run build -w @xgenia/xgenia-viewer-react
node scripts/live-engine/build-compiler.mjs $OUT/files/compiler/xgenia.rgs-compiler.js "$XGENIA_ENGINE_VERSION"
ENGINE_SIGNING_KEY="$(cat ~/.xgenia-engine-signing-key.pem)" node scripts/live-engine/pack.mjs --files $OUT/files --out $OUT/upload --channel beta
node scripts/live-engine/smoke.mjs $OUT/upload beta
du -sh $OUT/upload/$XGENIA_ENGINE_VERSION/files
```

Expected: `packed N files …`, `smoke ok: <version> (beta), N files`, and the gzipped size (well under 20 MB).

- [ ] **Step 9: Commit**

```bash
git add scripts/live-engine
git commit -m "Live engine: pack, smoke-check, publish and promote scripts"
```

---

### Task 11: CI that publishes on every push, and the first publish

**Files:**
- Create: `.github/workflows/live-engine.yml`
- Create (private repo): `private/.github/workflows/notify-live-engine.yml`
- Create: `scripts/live-engine/e2e-check.mjs`

**Interfaces:**
- Consumes: Tasks 8–10 scripts; secrets `PRIVATE_SUBMODULE_PAT` (exists), `ENGINE_SIGNING_KEY`, `SUPABASE_ENGINE_SERVICE_KEY` (outer, new), `OUTER_DISPATCH_TOKEN` (private, new).
- Produces: `beta` updated on every push to `develop` that touches the engine and on every private `main` push that touches `xgenia-pro-nodes/` or `xgenia-agent-nodes/`; `stable` changed by `workflow_dispatch` with `action: promote`.

- [ ] **Step 1: Write the outer workflow**

`.github/workflows/live-engine.yml`:

```yaml
name: Live Engine

on:
  push:
    branches: [develop]
    paths:
      - 'packages/xgenia-runtime/**'
      - 'packages/xgenia-viewer-react/**'
      - 'scripts/live-engine/**'
      - '.github/workflows/live-engine.yml'
  repository_dispatch:
    types: [private-main-push]
  workflow_dispatch:
    inputs:
      action:
        type: choice
        options: [build, promote]
        default: build
      version:
        type: string
        required: false
        description: 'promote: version to make stable (empty = current beta)'

concurrency:
  group: live-engine
  cancel-in-progress: false

jobs:
  build:
    if: github.event_name != 'workflow_dispatch' || inputs.action == 'build'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: develop

      - name: Private main (required — no engine without the slot nodes)
        env:
          PRIVATE_PAT: ${{ secrets.PRIVATE_SUBMODULE_PAT }}
        run: |
          test -n "$PRIVATE_PAT" || { echo "PRIVATE_SUBMODULE_PAT is missing"; exit 1; }
          git config --global url."https://x-access-token:${PRIVATE_PAT}@github.com/".insteadOf "https://github.com/"
          git submodule update --init --remote private
          test -f private/xgenia-pro-nodes/src/index.js

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - run: npm install

      - name: Engine tests
        run: |
          npm test -w @xgenia/runtime -- --ci
          node --test packages/xgenia-editor/tests/live-engine/
          node --test scripts/live-engine/pack.test.mjs
          npx tsx packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts

      - name: Version
        run: |
          echo "XGENIA_ENGINE_VERSION=$(date -u +%Y%m%d.%H%M)-$(git rev-parse --short=8 HEAD)-$(git -C private rev-parse --short=8 HEAD)" >> "$GITHUB_ENV"
          echo "ENGINE_OUTER_SHA=$(git rev-parse HEAD)" >> "$GITHUB_ENV"
          echo "ENGINE_PRIVATE_SHA=$(git -C private rev-parse HEAD)" >> "$GITHUB_ENV"

      - name: Build engine files
        run: |
          OUTPUT_PATH="$RUNNER_TEMP/engine/files" npm run build -w @xgenia/xgenia-viewer-react
          node scripts/live-engine/build-compiler.mjs "$RUNNER_TEMP/engine/files/compiler/xgenia.rgs-compiler.js" "$XGENIA_ENGINE_VERSION"

      - name: Pack and sign
        env:
          ENGINE_SIGNING_KEY: ${{ secrets.ENGINE_SIGNING_KEY }}
        run: node scripts/live-engine/pack.mjs --files "$RUNNER_TEMP/engine/files" --out "$RUNNER_TEMP/engine/upload" --channel beta

      - name: Smoke
        run: node scripts/live-engine/smoke.mjs "$RUNNER_TEMP/engine/upload" beta

      - name: Publish to beta
        env:
          SUPABASE_ENGINE_SERVICE_KEY: ${{ secrets.SUPABASE_ENGINE_SERVICE_KEY }}
        run: node scripts/live-engine/publish.mjs "$RUNNER_TEMP/engine/upload" "$XGENIA_ENGINE_VERSION" beta

  promote:
    if: github.event_name == 'workflow_dispatch' && inputs.action == 'promote'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: develop
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Promote to stable
        env:
          ENGINE_SIGNING_KEY: ${{ secrets.ENGINE_SIGNING_KEY }}
          SUPABASE_ENGINE_SERVICE_KEY: ${{ secrets.SUPABASE_ENGINE_SERVICE_KEY }}
        run: node scripts/live-engine/promote.mjs ${{ inputs.version }}
```

- [ ] **Step 2: Write the private-repo trigger**

`private/.github/workflows/notify-live-engine.yml`:

```yaml
name: Notify live engine

on:
  push:
    branches: [main]
    paths:
      - 'xgenia-pro-nodes/**'
      - 'xgenia-agent-nodes/**'

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - name: Ask XgeniaORG/XGENIA to rebuild the live engine
        env:
          TOKEN: ${{ secrets.OUTER_DISPATCH_TOKEN }}
        run: |
          test -n "$TOKEN" || { echo "OUTER_DISPATCH_TOKEN is missing"; exit 1; }
          curl -fsS -X POST \
            -H "Authorization: Bearer $TOKEN" \
            -H "Accept: application/vnd.github+json" \
            https://api.github.com/repos/XgeniaORG/XGENIA/dispatches \
            -d '{"event_type":"private-main-push","client_payload":{"sha":"${{ github.sha }}"}}'
```

- [ ] **Step 3: Write the end-to-end check against the real bucket**

`scripts/live-engine/e2e-check.mjs`:

```js
// After a publish: download the channel's engine exactly as an app would (real bucket, the app's
// public key), select it, and confirm the preview server would serve it. Uses a temp userData.
// Usage: node scripts/live-engine/e2e-check.mjs [channel=beta]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LE = path.join(ROOT, 'packages/xgenia-editor/src/main/src/live-engine');
const { EngineStore } = require(path.join(LE, 'engine-store.js'));
const { checkForEngineUpdate } = require(path.join(LE, 'updater.js'));
const { selectEngine } = require(path.join(LE, 'select.js'));
const { ENGINE_PUBLIC_KEY_PEM } = require(path.join(LE, 'public-key.js'));
const { SHELL_API_VERSION } = require(path.join(LE, 'shell-api.js'));

const channel = process.argv[2] || 'beta';
const store = new EngineStore(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-e2e-')), 'engine'));
const fetchBytes = async (url) => {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
};
const t0 = Date.now();
const r = await checkForEngineUpdate({ store, channel, fetchBytes, publicKeyPem: ENGINE_PUBLIC_KEY_PEM, shellApi: SHELL_API_VERSION });
console.log('update check:', JSON.stringify(r), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (r.status !== 'installed') process.exit(1);
const info = selectEngine({ appPath: '/nonexistent-app', isPackaged: true, env: {}, store, publicKeyPem: ENGINE_PUBLIC_KEY_PEM, shellApi: SHELL_API_VERSION });
console.log('selected:', info.source, info.version);
const viewer = fs.readFileSync(path.join(info.root, 'viewer/xgenia.viewer.js'), 'utf8');
if (info.source !== 'live' || !viewer.includes(info.version)) process.exit(1);
console.log('e2e ok');
```

- [ ] **Step 4: Ask the user to add the secrets** (outward action — do not do it without their go-ahead)

Tell the user exactly this, and wait:
1. `gh secret set ENGINE_SIGNING_KEY --repo XgeniaORG/XGENIA < ~/.xgenia-engine-signing-key.pem` (then keep the file somewhere safe offline, or delete it — CI only needs the secret).
2. `SUPABASE_ENGINE_SERVICE_KEY` on XgeniaORG/XGENIA: the service-role key of Supabase project `pcrghrjikkcmelflwiys` (Dashboard → Project Settings → API).
3. `OUTER_DISPATCH_TOKEN` on XgeniaORG/XFORGE_Private: a fine-grained token with Actions write (or Contents write) on XgeniaORG/XGENIA.

- [ ] **Step 5: Commit the outer workflow and e2e script; commit the private workflow after asking**

```bash
git add .github/workflows/live-engine.yml scripts/live-engine/e2e-check.mjs
git commit -m "Live engine: CI builds, signs and publishes the engine to beta"
git -C private add .github/workflows/notify-live-engine.yml
git -C private commit -m "Rebuild the live engine when pro or agent nodes change"
```

Push the private commit to private `main` only after the user agrees.

- [ ] **Step 6: First publish and end-to-end check**

After the PR (Task 12) merges and the secrets exist: run the workflow by hand once (`gh workflow run live-engine.yml --repo XgeniaORG/XGENIA -f action=build`), wait for it (`gh run watch`), then:

Run: `node scripts/live-engine/e2e-check.mjs beta`
Expected: `update check: {"status":"installed",…}`, `selected: live <version>`, `e2e ok`.

---

### Task 12: Docs and the PR

**Files:**
- Create: `docs/agents/live-engine.md`

- [ ] **Step 1: Write the operator doc**

`docs/agents/live-engine.md`:

````markdown
# Live engine

Engine, slot nodes and the RGS compiler reach installed apps without an app release.
Design: `docs/superpowers/specs/2026-10-03-live-engine-design.md`.

## How a change reaches users

1. Merge to `develop` (outer) or push to private `main` (pro/agent nodes).
2. The `Live Engine` workflow tests, builds, signs and publishes the engine to **beta**.
3. Apps on beta (`XGENIA_ENGINE_CHANNEL=beta`, or `<userData>/engine/settings.json` = `{"channel":"beta"}`)
   download it within 6 h (15 s after start) and run it from their next start.
4. Promote to **stable** (everyone): Actions → Live Engine → Run workflow → `action: promote`
   (empty version = current beta), or `node scripts/live-engine/promote.mjs [version]` with both keys set.

## Rollback

Promote the previous version: `action: promote`, `version: <old version>`. Apps install it (newer
issuedAt) and run it from their next start. An engine whose preview never comes up on a machine is
dropped there automatically on the next start.

## When an engine change needs an editor change

Bump `SHELL_API_VERSION` (`packages/xgenia-editor/src/main/src/live-engine/shell-api.js`) and
`minShell` (`packages/xgenia-viewer-react/engine-compat.json`) in the same PR. Older apps keep
their current engine and record `needsAppUpdate` until they get an app build.

## What a machine runs

- Main-process log line: `[live-engine] live <version> — …` or `[live-engine] builtin builtin — <reason>`.
- `<userData>/engine/state.json`: `active`, `previous`, `pending`, `trial`, `bad`, `needsAppUpdate`.
- Compiled RGS scripts: header line `// Compiler: <version>` (`bundled` = the app's own compiler).

## Switches

- `XGENIA_ENGINE=builtin` — run the app's own engine, never download.
- `XGENIA_LIVE_ENGINE=1` — let a development build use and download live engines.
- `XGENIA_ENGINE_CHANNEL=beta|stable` — channel override.

## Signing key

Private key: GitHub secret `ENGINE_SIGNING_KEY` only. Public key: `src/main/src/live-engine/public-key.js`.
Rotating means `node scripts/live-engine/keygen.mjs <out.pem>`, a new secret, and a new app build.
````

- [ ] **Step 2: Run every test of the plan once more**

```bash
node --test packages/xgenia-editor/tests/live-engine/ scripts/live-engine/pack.test.mjs packages/xgenia-editor/tests/web-server-traversal.test.cjs
npx tsx --test packages/xgenia-editor/tests/live-engine/liveEngine.test.ts
npx tsx packages/xgenia-runtime/src/api/test-compiler-bundle-parity.ts
cd packages/xgenia-runtime && npx jest && cd ../..
```

Expected: everything passes.

- [ ] **Step 3: Commit, push and open the PR** (ask the user before pushing)

```bash
git add docs/agents/live-engine.md docs/superpowers/specs/2026-10-03-live-engine-design.md docs/superpowers/plans/2026-10-03-live-engine.md
git commit -m "Live engine: operator doc"
git push -u origin feature/live-engine
gh pr create --base develop --title "Live engine: engine, nodes and RGS compiler update without an app release" --body "Signed engine packs (viewer, deploy, RGS compiler) published by CI to Supabase Storage; the app picks a verified one at startup and falls back to its own. Design: docs/superpowers/specs/2026-10-03-live-engine-design.md. Needs secrets ENGINE_SIGNING_KEY and SUPABASE_ENGINE_SERVICE_KEY before the workflow can publish; the loader reaches users with the next app build."
```

Then add a reviewer from recent `develop` committers (CLAUDE.md step 6). Do not merge without approval.
