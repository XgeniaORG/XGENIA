/**
 * formula-eval-emit.ts — the ONE emitted formula evaluator for slot-maths RGS code.
 *
 * WHY THIS EXISTS (money/RTP root, root-tree deep-dive #4): slot-maths formulas are
 * evaluated with real `mathjs` in the editor (xgenia-pro-nodes) but the generated RGS
 * bundle runs standalone (Deno, no mathjs), so the converter emits a self-contained
 * shim. That shim was COPY-PASTED into three node generators (generate-symbol-weights,
 * get-paytable, reel-strips-from-seed) and could drift from each other AND from mathjs —
 * any mathjs feature the shim misses works in editor preview and CRASHES / differs in the
 * certified RGS, skewing RTP. There was no test comparing the two.
 *
 * Now there is ONE emitted evaluator (this constant) that every generator interpolates,
 * and formula-eval-parity.test.ts evals THIS string and asserts it matches real mathjs
 * across a battery of formulas. So editor↔RGS maths parity is locked in CI.
 *
 * IMPORTANT: this is EMITTED code (a string baked into the generated bundle). Keep it
 * plain JS (no TS annotations) so it is valid in BOTH the Deno RGS runtime AND the Node
 * parity test that evals it. It may use only globals guaranteed everywhere: Math, eval,
 * String, Object, Error, RegExp, isNaN.
 */
export const EVALUATE_FORMULA_JS = `
      function evaluateFormula(formula, x) {
        try {
          const scope = { x: x, pi: Math.PI, e: Math.E };

          let processedFormula = String(formula)
            .replace(/\\bsin\\b/g, 'Math.sin')
            .replace(/\\bcos\\b/g, 'Math.cos')
            .replace(/\\btan\\b/g, 'Math.tan')
            .replace(/\\blog\\b/g, 'Math.log')
            .replace(/\\bexp\\b/g, 'Math.exp')
            .replace(/\\bsqrt\\b/g, 'Math.sqrt')
            .replace(/\\bpow\\b/g, 'Math.pow')
            .replace(/\\babs\\b/g, 'Math.abs')
            .replace(/\\bfloor\\b/g, 'Math.floor')
            .replace(/\\bceil\\b/g, 'Math.ceil')
            .replace(/\\bround\\b/g, 'Math.round')
            // Common mathjs functions that exist on JS Math with identical semantics —
            // anything the editor's mathjs accepts but this misses would CRASH in the RGS.
            .replace(/\\bmin\\b/g, 'Math.min')
            .replace(/\\bmax\\b/g, 'Math.max')
            .replace(/\\bcbrt\\b/g, 'Math.cbrt')
            .replace(/\\bsign\\b/g, 'Math.sign')
            // mathjs's truncation fn is 'fix' (NOT 'trunc' — mathjs has no trunc, so the
            // old trunc→Math.trunc rule was dead AND, once fix→Math.trunc was added, the
            // trunc rule re-matched the inserted "trunc" → "Math.Math.trunc" → crash. One
            // fix rule, no trunc rule. fix = truncate toward zero = Math.trunc.
            .replace(/\\bfix\\b/g, 'Math.trunc')
            .replace(/\\blog2\\b/g, 'Math.log2')
            .replace(/\\blog10\\b/g, 'Math.log10')
            // Word-boundary \\b keeps asin/atan2/sinh/log1p from being clobbered by the
            // shorter sin/atan/tan/log rules above, and longer variants (acosh vs acos vs
            // cos) intact — order-independent.
            .replace(/\\bacosh\\b/g, 'Math.acosh')
            .replace(/\\basinh\\b/g, 'Math.asinh')
            .replace(/\\batanh\\b/g, 'Math.atanh')
            .replace(/\\batan2\\b/g, 'Math.atan2')
            .replace(/\\basin\\b/g, 'Math.asin')
            .replace(/\\bacos\\b/g, 'Math.acos')
            .replace(/\\batan\\b/g, 'Math.atan')
            .replace(/\\bsinh\\b/g, 'Math.sinh')
            .replace(/\\bcosh\\b/g, 'Math.cosh')
            .replace(/\\btanh\\b/g, 'Math.tanh')
            .replace(/\\bhypot\\b/g, 'Math.hypot')
            .replace(/\\bexpm1\\b/g, 'Math.expm1')
            .replace(/\\blog1p\\b/g, 'Math.log1p')
            // mathjs-only fns with no JS Math equivalent — shim to identical math.
            // Arg-capturing ([^()]* = no nested parens, fine for the simple x-formulas
            // these ports accept). Run before the ^->** rule below.
            .replace(/\\bsquare\\s*\\(([^()]*)\\)/g, '(($1)**2)')
            .replace(/\\bcube\\s*\\(([^()]*)\\)/g, '(($1)**3)')
            .replace(/\\bnthRoot\\s*\\(([^(),]*),([^()]*)\\)/g, 'Math.pow($1, 1/($2))')
            .replace(/\\bmod\\s*\\(([^(),]*),([^()]*)\\)/g, '(($1) % ($2))')
            // mathjs (the editor) treats ^ as exponentiation, but raw JS eval treats ^ as
            // bitwise XOR — so "2^x" silently gave the wrong number server-side. Convert
            // ^ to ** (JS power) to match the editor.
            .replace(/\\^/g, '**');

          Object.keys(scope).forEach((key) => {
            const regex = new RegExp('\\\\b' + key + '\\\\b', 'g');
            processedFormula = processedFormula.replace(regex, String(scope[key]));
          });

          const result = eval(processedFormula);
          // Reject NaN AND Infinity (the strictest of the three former copies) — a
          // non-finite weight/paytable entry is always a broken formula, and it must
          // fail loudly in the certified RGS rather than poison the maths.
          if (typeof result !== 'number' || !Number.isFinite(result)) {
            throw new Error('Formula must evaluate to a finite number, got ' + typeof result + ': ' + result);
          }
          return result;
        } catch (error) {
          throw new Error('Formula evaluation error: ' + error.message);
        }
      }
`;
