/**
 * The live-engine compiler bundle must compile maths exactly like the compiler source the editor
 * bundles. Scripts are compared after reprinting both through esbuild (the bundle reprints the
 * embedded slot-feature cores) with the compiler stamp line removed. Also: the bundle carries its
 * version, its cores text runs standalone (as it does inside an RGS script) and reproduces the
 * Cascade The Reels goldens, and no esbuild helper leaks in. (2026-10-03) The slot GAME cores and the
 * formula evaluator (2026-10-04) run standalone from the bundle's text and match the source module.
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
// Users' game maths: kept in the private repo, not in this public one.
const FIXTURE_DIR = path.join(ROOT, 'private/test-fixtures/rgs-maths');
const GOLDENS = path.resolve(HERE, '../../test/slot-features/cascade-the-reels.goldens.json');
const HELPERS = /\b__(name|spreadValues|spreadProps|async|publicField|objRest|toESM|toCommonJS|commonJS|require|export|defProp)\b/;
const STAMP = /^var __xgeniaCompiler = "[^"]*";$/m;

const mapNode = (n: any): any => ({ ...n, typename: n.type || n.typename, dynamicports: n.dynamicports || n.ports || [], children: (n.children || []).map(mapNode) });
const canon = (s: string) => transformSync('(function (ctx) {\n' + s.replace(STAMP, '') + '\n})', { loader: 'js', legalComments: 'none' }).code as string;

async function main() {
  const { buildCompiler } = await import(pathToFileURL(path.join(ROOT, 'scripts/live-engine/build-compiler.mjs')).href);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'xgenia-compiler-')), 'xgenia.rgs-compiler.js');
  await buildCompiler(out, 'vPARITY');
  const bundled = require(out);
  let failures = 0;
  const fail = (what: string, msg: string) => { failures++; console.log(`FAIL  ${what}: ${msg}`); };

  if (!fs.existsSync(FIXTURE_DIR)) throw new Error(`needs the private repo checked out: ${FIXTURE_DIR} is missing`);
  for (const file of FIXTURES) {
    const before = failures;
    const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
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
    if (!/^var __xgeniaCompiler = "vPARITY";$/m.test(b.script) || b.compilerVersion !== 'vPARITY') fail(file, 'the bundle does not carry its version');
    if (a.compilerVersion !== 'bundled') fail(file, `the source compiler reports ${a.compilerVersion}`);
    if (HELPERS.test(b.script)) fail(file, 'an esbuild helper leaked into the script');
    if (failures === before) console.log(`ok    ${file} — ${b.script.length} bytes, ${b.loopsCompiled} loop(s)`);
  }

  const cores = new Function('return (' + bundled.CORES_SOURCE + ')()')();
  const goldens = JSON.parse(fs.readFileSync(GOLDENS, 'utf8'));
  const bad = goldens.filter((g: any) => JSON.stringify(cores.cascadeTheReels({ ...g.in, seeds: g.in.seeds }).reels) !== JSON.stringify(g.out));
  if (bad.length) fail('cores', `${bad.length}/${goldens.length} Cascade The Reels goldens differ when the bundle's cores run standalone`);
  if (JSON.stringify(Object.keys(cores).sort()) !== JSON.stringify([...bundled.coreNames].sort())) fail('cores', 'core names differ');

  // (2026-10-04) The slot GAME cores and the one formula evaluator: the bundle's texts run standalone
  // (as they do inside an RGS script) and compute what the source module computes.
  const gameCores = new Function('return (' + bundled.SLOT_GAME_CORES_SOURCE + ')((' + bundled.FORMULA_SOURCE + ')())')();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sourceGameCores = require('./slot-game-cores');
  if (JSON.stringify(Object.keys(gameCores).sort()) !== JSON.stringify([...bundled.slotGameCoreNames].sort())) fail('slot game cores', 'core names differ');
  const grid = [[9, 4, 5], [3, 5, 4], [3, 4, 5], [3, 5, 4], [3, 4, 5]];
  const probes: Array<[string, any]> = [
    ['checkWins', { reels: grid }],
    ['getPaytable', { payoutFormula: 'round(-x / 2) + max(x, 3) ^ 2 % 7', symbolPayout2: '5' }],
    ['generateSymbolWeights', { weightFormula: 'exp(-x / 6)' }],
    ['weightedReels', { reelStrips: [[1, 2, 3, 4], [4, 3, 2, 1]], Seeds: [1e11, 7.5e11], rowSize: 3 }]
  ];
  for (const [core, args] of probes) {
    const a = JSON.stringify(gameCores[core](args));
    const b = JSON.stringify(sourceGameCores[core](args));
    if (a !== b) fail('slot game cores', `${core} differs when the bundle's text runs standalone:\n  bundle: ${a.slice(0, 200)}\n  source: ${b.slice(0, 200)}`);
  }

  if (failures) process.exit(1);
  console.log('\nthe live compiler bundle compiles exactly like the source');
}

main().catch((e) => { console.error(e); process.exit(1); });
