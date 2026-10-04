/**
 * Round-player pass loop on the RGS — compiled graph vs. the round's own book, in the REAL XRGS sandbox.
 *
 * (2026-10-02) A slot whose tumbles run through the round player's pass loop
 * (RP_PassLoop → Check Wins → Calculate Winnings → back; RP_PassLoop → TRNG → ISAAC → Cascade The
 * Reels → back) could not be measured or certified on the RGS: Cascade The Reels had no server
 * implementation, the compiler ran every node once in a straight line, the loop script's `this`
 * did not exist and its bare `return;` returned undefined. Every round threw. The AI then rewrote
 * the user's certified maths into a single script to get past it.
 *
 * For each fixture (two real projects' maths components — users' game maths, so they live in the
 * private repo at private/test-fixtures/rgs-maths, not here):
 *   1. generateRgsScript() reports nothing unsupported and exactly one compiled loop,
 *   2. the editor's blocked-construct mirror and XRGS compileScript both accept the script,
 *   3. N rounds run with no error, and every round's RoundBook is a real tumble record:
 *      win === book.total === Σ passes[].win; every pass before the last paid; the last paid
 *      nothing unless the pass cap (12) was reached; a pass after a paying pass shows a new grid,
 *   4. some rounds actually tumble (more than one pass).
 *
 * Usage: cd packages/xgenia-runtime && XRGS_SANDBOX=<XRGS>/supabase/functions/_shared/script-sandbox.ts \
 *          npx tsx src/api/test-rgs-pass-loop.ts [rounds=3000]
 */
import * as fs from 'fs';
import * as path from 'path';
import { CloudFunctionConverter } from './supabase-converter';

type AnyRec = Record<string, any>;
const HERE = path.dirname(__filename);
const XRGS_SANDBOX = process.env.XRGS_SANDBOX || path.resolve(HERE, '../../../../../XRGS/supabase/functions/_shared/script-sandbox.ts');
const XRGS_ISAAC = path.join(path.dirname(XRGS_SANDBOX), 'isaac.ts');
const EDITOR_VALIDATOR = path.resolve(HERE, '../../../xgenia-editor/src/editor/src/utils/rgs/validateRgsScript.ts');
const FIXTURES = ['round-player-parrot.json', 'round-player-leprechaun.json'];
const FIXTURE_DIR = path.resolve(HERE, '../../../../private/test-fixtures/rgs-maths');
const MAX_PASSES = 12;

const mapNode = (n: AnyRec): AnyRec => ({ ...n, typename: n.type || n.typename, dynamicports: n.dynamicports || n.ports || [], children: (n.children || []).map(mapNode) });

async function main() {
  const rounds = Number(process.argv[2] || 3000);
  const sandbox: AnyRec = await import(XRGS_SANDBOX);
  const { Isaac }: AnyRec = await import(XRGS_ISAAC);
  const validator: AnyRec = await import(EDITOR_VALIDATOR);
  let failures = 0;
  const fail = (name: string, msg: string) => { console.log(`FAIL  ${name}: ${msg}`); failures++; };

  if (!fs.existsSync(FIXTURE_DIR)) throw new Error(`needs the private repo checked out: ${FIXTURE_DIR} is missing`);
  for (const file of FIXTURES) {
    const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
    const comp = { ...fx.component, graph: { roots: fx.component.graph.roots.map(mapNode), connections: fx.component.graph.connections } };
    const quiet = console.warn; console.warn = () => {};
    const out = new CloudFunctionConverter(comp as any, { name: 'fixture', components: [comp] } as any).generateRgsScript();
    console.warn = quiet;
    const name = fx.component.name;
    if (out.unsupportedNodes.length) { fail(name, `unsupported: ${JSON.stringify(out.unsupportedNodes)}`); continue; }
    if (out.loopsCompiled !== 1) { fail(name, `expected 1 compiled loop, got ${out.loopsCompiled}`); continue; }
    const blocked = validator.findBlockedConstructs(out.script);
    if (blocked.length) { fail(name, `editor validator: ${JSON.stringify(blocked.slice(0, 3))}`); continue; }
    try { sandbox.compileScript(out.script); } catch (e) { fail(name, `XRGS compileScript refused: ${(e as Error).message}`); continue; }

    const round = sandbox.createScriptRoundFn(out.script, out.configData || {});
    const rng = Isaac.fromEntropy();
    let errors = 0, firstErr = '', tumbled = 0, bad = 0, firstBad = '', staked = 0, won = 0;
    for (let i = 0; i < rounds; i++) {
      let o: AnyRec;
      try { o = round(rng, 100); } catch (e) { errors++; if (!firstErr) firstErr = String((e as Error).message).slice(0, 200); continue; }
      staked += 100; won += o.win;
      const book = o.data?.RoundBook;
      const passes: AnyRec[] = Array.isArray(book?.passes) ? book.passes : [];
      const sum = passes.reduce((s, p) => s + (Number(p.win) || 0), 0);
      const problems: string[] = [];
      if (!passes.length) problems.push('no RoundBook passes');
      if (book && book.total !== sum) problems.push(`book.total ${book.total} != Σ passes ${sum}`);
      if (o.win !== sum) problems.push(`win ${o.win} != Σ passes ${sum}`);
      passes.forEach((p, k) => {
        const last = k === passes.length - 1;
        if (!last && !(p.win > 0)) problems.push(`pass ${k} paid nothing but the round went on`);
        if (last && p.win > 0 && passes.length < MAX_PASSES) problems.push(`last pass ${k} paid ${p.win} but no refill followed`);
        if (k > 0 && JSON.stringify(p.grid) === JSON.stringify(passes[k - 1].grid)) problems.push(`pass ${k} scored the same grid as pass ${k - 1} (no tumble)`);
      });
      if (passes.length > 1) tumbled++;
      if (problems.length) { bad++; if (!firstBad) firstBad = `round ${i}: ${problems.join('; ')}`; }
    }
    if (errors) fail(name, `${errors}/${rounds} rounds threw: ${firstErr}`);
    else if (bad) fail(name, `${bad}/${rounds} rounds broke the tumble record — ${firstBad}`);
    else if (tumbled === 0) fail(name, `no round tumbled in ${rounds}`);
    else console.log(`ok    ${name} — ${rounds} rounds, ${tumbled} tumbled, RTP ${(100 * won / staked).toFixed(2)}% (${out.script.length} bytes)`);
  }
  if (failures) { console.log(`\n${failures} fixture(s) failed`); process.exit(1); }
  console.log(`\n${FIXTURES.length}/${FIXTURES.length} round-player maths run on the RGS with a true tumble record`);
}

main().catch((e) => { console.error(e); process.exit(1); });
