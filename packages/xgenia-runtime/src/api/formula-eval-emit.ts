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
 * 2026-07-10 (trace 1783634013326) — NO MORE eval(). The previous version of this
 * evaluator did `eval(processedFormula)` after regex-rewriting mathjs names to Math.*.
 * But the RGS sandbox forbids eval, and sanitizeForSandbox (supabase-converter.ts)
 * replaced `eval(processedFormula)` with `0` in the uploaded bundle — so EVERY weight
 * and paytable formula evaluated to 0 in the certified RGS ("total weight is zero"
 * crashes, 0% RTP) while the parity test kept passing against the pre-sanitize string.
 * This version is a self-contained recursive-descent parser/evaluator: no eval, no
 * new Function, nothing for the sanitizer to strip. sanitize-parity is locked in
 * formula-eval-parity.test.ts (the emitted code must survive sanitizeForSandbox
 * UNCHANGED in behavior).
 *
 * Grammar (a mathjs-compatible subset, superset of the old shim):
 *   ternary:      cond ? a : b            (right-assoc; both branches evaluated eagerly —
 *                                          formulas here are tiny + side-effect-free)
 *   comparison:   < <= > >= == !=         (single, non-chained, like the formulas use)
 *   add/sub:      + -
 *   mul/div/mod:  * / %                   (% is JS remainder — same as the old eval)
 *   power:        ^ and ** (right-assoc; binds tighter than unary minus, so -2^2 = -4
 *                                          matching mathjs, where the old shim CRASHED)
 *   unary:        - +
 *   atoms:        numbers (incl. 2e3), parens, x, pi, e, fn(args)
 *   functions:    the same set the old shim mapped (sin..log1p, square, cube, nthRoot,
 *                 mod, fix→trunc) plus variadic min/max/hypot.
 *
 * IMPORTANT: this is EMITTED code (a string baked into the generated bundle). Keep it
 * plain JS (no TS annotations) so it is valid in BOTH the Deno RGS runtime AND the Node
 * parity test that evals it. It may use only globals guaranteed everywhere: Math,
 * String, Object, Error, Number, parseFloat, isNaN. It must NOT contain the substrings
 * the RGS sandbox blocklist rejects (eval with an open-paren, new Function, crypto,
 * Deno, import, require) — sanitizeForSandbox would mutilate them.
 */
export const EVALUATE_FORMULA_JS = `
      function evaluateFormula(formula, x) {
        try {
          var src = String(formula);
          var len = src.length;
          var pos = 0;
          var UNARY_FUNCS = {
            sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log, exp: Math.exp,
            sqrt: Math.sqrt, abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
            cbrt: Math.cbrt, sign: Math.sign, fix: Math.trunc, trunc: Math.trunc,
            log2: Math.log2, log10: Math.log10,
            acosh: Math.acosh, asinh: Math.asinh, atanh: Math.atanh,
            asin: Math.asin, acos: Math.acos, atan: Math.atan,
            sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
            expm1: Math.expm1, log1p: Math.log1p,
            square: function (a) { return a * a; },
            cube: function (a) { return a * a * a; }
          };
          var MULTI_FUNCS = {
            pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, hypot: Math.hypot,
            nthRoot: function (a, b) { return Math.pow(a, 1 / b); },
            mod: function (a, b) { return a % b; }
          };
          var CONSTS = { x: x, pi: Math.PI, e: Math.E };
          var has = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };

          function isDigit(c) { return c >= '0' && c <= '9'; }
          function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
          function skipWs() {
            while (pos < len) {
              var cc = src.charCodeAt(pos);
              if (cc === 32 || cc === 9 || cc === 10 || cc === 13) { pos++; } else { break; }
            }
          }
          function parseNumber() {
            var start = pos;
            while (pos < len && isDigit(src[pos])) pos++;
            if (src[pos] === '.') { pos++; while (pos < len && isDigit(src[pos])) pos++; }
            if (src[pos] === 'e' || src[pos] === 'E') {
              var save = pos;
              pos++;
              if (src[pos] === '+' || src[pos] === '-') pos++;
              if (pos < len && isDigit(src[pos])) { while (pos < len && isDigit(src[pos])) pos++; }
              else { pos = save; }
            }
            return parseFloat(src.slice(start, pos));
          }
          function parseIdent() {
            var start = pos;
            while (pos < len && (isAlpha(src[pos]) || isDigit(src[pos]))) pos++;
            return src.slice(start, pos);
          }
          function parseExpressionLvl() { return parseTernary(); }
          function parseTernary() {
            var cond = parseComparison();
            skipWs();
            if (src[pos] === '?') {
              pos++;
              var thenVal = parseTernary();
              skipWs();
              if (src[pos] !== ':') throw new Error('Expected : in ternary at position ' + pos);
              pos++;
              var elseVal = parseTernary();
              return cond ? thenVal : elseVal;
            }
            return cond;
          }
          function parseComparison() {
            var left = parseAddSub();
            skipWs();
            var c = src[pos];
            var c2 = src[pos + 1];
            if (c === '<' && c2 === '=') { pos += 2; return left <= parseAddSub(); }
            if (c === '>' && c2 === '=') { pos += 2; return left >= parseAddSub(); }
            if (c === '=' && c2 === '=') { pos += 2; return left === parseAddSub(); }
            if (c === '!' && c2 === '=') { pos += 2; return left !== parseAddSub(); }
            if (c === '<') { pos += 1; return left < parseAddSub(); }
            if (c === '>') { pos += 1; return left > parseAddSub(); }
            return left;
          }
          function parseAddSub() {
            var v = parseMulDiv();
            for (;;) {
              skipWs();
              var c = src[pos];
              if (c === '+') { pos++; v = v + parseMulDiv(); }
              else if (c === '-') { pos++; v = v - parseMulDiv(); }
              else return v;
            }
          }
          function parseMulDiv() {
            var v = parseUnary();
            for (;;) {
              skipWs();
              var c = src[pos];
              if (c === '*' && src[pos + 1] !== '*') { pos++; v = v * parseUnary(); }
              else if (c === '/') { pos++; v = v / parseUnary(); }
              else if (c === '%') { pos++; v = v % parseUnary(); }
              else return v;
            }
          }
          function parseUnary() {
            skipWs();
            var c = src[pos];
            if (c === '-') { pos++; return -parseUnary(); }
            if (c === '+') { pos++; return parseUnary(); }
            return parsePower();
          }
          function parsePower() {
            var base = parseAtom();
            skipWs();
            if (src[pos] === '^') { pos++; return Math.pow(base, parseUnary()); }
            if (src[pos] === '*' && src[pos + 1] === '*') { pos += 2; return Math.pow(base, parseUnary()); }
            return base;
          }
          function parseAtom() {
            skipWs();
            var c = src[pos];
            if (c === '(') {
              pos++;
              var v = parseExpressionLvl();
              skipWs();
              if (src[pos] !== ')') throw new Error('Expected ) at position ' + pos);
              pos++;
              return v;
            }
            if (isDigit(c) || (c === '.' && isDigit(src[pos + 1]))) return parseNumber();
            if (isAlpha(c)) {
              var name = parseIdent();
              skipWs();
              if (src[pos] === '(') {
                pos++;
                var args = [];
                skipWs();
                if (src[pos] !== ')') {
                  args.push(parseExpressionLvl());
                  skipWs();
                  while (src[pos] === ',') { pos++; args.push(parseExpressionLvl()); skipWs(); }
                }
                if (src[pos] !== ')') throw new Error('Expected ) after arguments to ' + name);
                pos++;
                if (has(UNARY_FUNCS, name)) {
                  if (args.length !== 1) throw new Error(name + ' expects 1 argument, got ' + args.length);
                  return UNARY_FUNCS[name](args[0]);
                }
                if (has(MULTI_FUNCS, name)) {
                  if (args.length === 0) throw new Error(name + ' expects at least 1 argument');
                  return MULTI_FUNCS[name].apply(null, args);
                }
                throw new Error('Unknown function: ' + name);
              }
              if (has(CONSTS, name)) return CONSTS[name];
              throw new Error('Undefined symbol ' + name);
            }
            throw new Error('Unexpected character ' + (c === undefined ? '<end>' : c) + ' at position ' + pos);
          }

          var result = parseExpressionLvl();
          skipWs();
          if (pos < len) throw new Error('Unexpected trailing input at position ' + pos);
          if (typeof result !== 'number' || !Number.isFinite(result)) {
            throw new Error('Formula must evaluate to a finite number, got ' + typeof result + ': ' + result);
          }
          return result;
        } catch (error) {
          throw new Error('Formula evaluation error: ' + error.message);
        }
      }
`;
