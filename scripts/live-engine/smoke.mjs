// Last check before publishing. The pack must verify with the key the APP carries (a wrong
// ENGINE_SIGNING_KEY secret would otherwise publish an engine no app accepts), every file must
// unpack to its hash, both bundles must carry the version and the slot nodes, and the packed
// compiler must compile real maths: no unsupported nodes, one loop, its version stamped in the
// script, and its cores reproduce the Cascade The Reels goldens. Usage: smoke.mjs <uploadDir> <channel>
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
const fail = (msg) => {
  console.error('SMOKE FAIL: ' + msg);
  process.exit(1);
};
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
  // Users' game maths: kept in the private repo, not in this public one.
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'private/test-fixtures/rgs-maths', file), 'utf8'));
  const comp = { ...fx.component, graph: { roots: fx.component.graph.roots.map(mapNode), connections: fx.component.graph.connections } };
  const quiet = console.warn;
  console.warn = () => {};
  const out = new compiler.CloudFunctionConverter(comp, { name: 'fixture', components: [comp] }).generateRgsScript();
  console.warn = quiet;
  if (out.unsupportedNodes.length) fail(`${file}: unsupported ${JSON.stringify(out.unsupportedNodes)}`);
  if (out.loopsCompiled !== 1) fail(`${file}: expected 1 compiled loop, got ${out.loopsCompiled}`);
  if (!out.script.includes(`var __xgeniaCompiler = ${JSON.stringify(m.version)};`)) fail(`${file}: script does not name compiler ${m.version}`);
  try {
    new Function('ctx', out.script);
  } catch (e) {
    fail(`${file}: script does not parse: ${e.message}`);
  }
}
const cores = new Function('return (' + compiler.CORES_SOURCE + ')()')();
const goldens = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/xgenia-runtime/test/slot-features/cascade-the-reels.goldens.json'), 'utf8'));
const bad = goldens.filter((g) => JSON.stringify(cores.cascadeTheReels({ ...g.in, seeds: g.in.seeds }).reels) !== JSON.stringify(g.out));
if (bad.length) fail(`${bad.length}/${goldens.length} Cascade The Reels goldens differ`);
console.log(`smoke ok: ${m.version} (${channel}), ${m.files.length} files`);
