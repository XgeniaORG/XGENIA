// Optional: minify the live engine's viewer bundle the same way a release build does
// (packages/xgenia-editor/scripts/build.ts, XGENIA_MINIFY_VIEWER): mangled locals, no comments,
// function and class names kept (engine code reads them). Like the release switch, it stays off
// until a game has been played on a minified build; CI runs it when the repo variable
// XGENIA_MINIFY_VIEWER is '1'. Usage: node scripts/live-engine/minify-viewer.mjs <file>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

export async function minifyFile(file) {
  const before = fs.statSync(file).size;
  const out = await minify(fs.readFileSync(file, 'utf8'), {
    ecma: 2020,
    compress: { passes: 1 },
    mangle: { keep_fnames: true, keep_classnames: true },
    keep_fnames: true,
    keep_classnames: true,
    format: { comments: false }
  });
  if (!out.code) throw new Error(`terser produced no output for ${file}`);
  fs.writeFileSync(file, out.code);
  return { before, after: fs.statSync(file).size };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: minify-viewer.mjs <file>');
    process.exit(2);
  }
  const r = await minifyFile(file);
  console.log(`minified ${file}: ${r.before} -> ${r.after} bytes`);
}
