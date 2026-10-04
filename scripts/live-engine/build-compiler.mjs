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
