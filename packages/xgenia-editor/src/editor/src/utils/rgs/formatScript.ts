// Formats a deployed edge-function script for display in the read-only script
// inspector. Mirrors the RGS studio's lib/formatEdgeFunctionScript.ts — keep the
// two in sync so the same script reads identically in both places.
//
// The scripts are assembled by string concatenation in generateRgsScript()
// (one snippet per graph node), so their indentation is inconsistent and some
// statements arrive crammed onto a single line.

/**
 * Runs a generated RGS script through Prettier.
 *
 * Two things to know about these scripts:
 * - They are *function bodies* (run via `new Function('ctx', script)`) and end
 *   in a top-level `return { win, data, state }`. Only Prettier's `babel`
 *   parser tolerates return-outside-function, so don't swap it out.
 * - Prettier is loaded lazily — it is ~600 KB of parser that nothing else in
 *   the editor needs, so it must stay out of the main renderer bundle.
 *
 * Returns the original source unchanged if anything fails to parse.
 */
export async function formatScript(script: string): Promise<string> {
  try {
    const [prettier, babel, estree] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      // @ts-ignore — estree is a printer-only plugin and ships no usable types
      import('prettier/plugins/estree'),
    ]);

    return await prettier.format(script, {
      parser: 'babel',
      plugins: [(babel as any).default ?? babel, (estree as any).default ?? estree],
      printWidth: 100,
      semi: true,
      singleQuote: true,
      tabWidth: 2,
    });
  } catch {
    return script;
  }
}
