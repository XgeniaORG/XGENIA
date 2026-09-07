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
      // (2026-07-16, trace 1784200864517 — RGS throughput) evaluateFormula used to
      // RE-PARSE the formula string and re-allocate its function tables on EVERY
      // call (gen-weights: once per symbol per spin). It now compiles each distinct
      // formula ONCE into a closure tree and memoizes it — later calls just walk
      // closures. Semantics are byte-identical to the old direct evaluator (both
      // ternary branches still evaluate eagerly; same error messages; same final
      // finite-number check per call) and remain parity-locked vs mathjs.
      var _FORMULA_UNARY = {
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
      var _FORMULA_MULTI = {
        pow: Math.pow, atan2: Math.atan2, min: Math.min, max: Math.max, hypot: Math.hypot,
        nthRoot: function (a, b) { return Math.pow(a, 1 / b); },
        mod: function (a, b) { return a % b; }
      };
      var _formulaCache = {};

      function _compileFormula(src) {
        var len = src.length;
        var pos = 0;
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
        // Every parse level returns a FUNCTION (x) -> value. Parsing happens once;
        // evaluation is a closure walk with zero allocation.
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
            // Eager both-branch evaluation — matches the old direct evaluator.
            return function (x) { var c = cond(x); var t = thenVal(x); var e = elseVal(x); return c ? t : e; };
          }
          return cond;
        }
        function parseComparison() {
          var left = parseAddSub();
          skipWs();
          var c = src[pos];
          var c2 = src[pos + 1];
          if (c === '<' && c2 === '=') { pos += 2; return (function (a, b) { return function (x) { return a(x) <= b(x); }; })(left, parseAddSub()); }
          if (c === '>' && c2 === '=') { pos += 2; return (function (a, b) { return function (x) { return a(x) >= b(x); }; })(left, parseAddSub()); }
          if (c === '=' && c2 === '=') { pos += 2; return (function (a, b) { return function (x) { return a(x) === b(x); }; })(left, parseAddSub()); }
          if (c === '!' && c2 === '=') { pos += 2; return (function (a, b) { return function (x) { return a(x) !== b(x); }; })(left, parseAddSub()); }
          if (c === '<') { pos += 1; return (function (a, b) { return function (x) { return a(x) < b(x); }; })(left, parseAddSub()); }
          if (c === '>') { pos += 1; return (function (a, b) { return function (x) { return a(x) > b(x); }; })(left, parseAddSub()); }
          return left;
        }
        function parseAddSub() {
          var v = parseMulDiv();
          for (;;) {
            skipWs();
            var c = src[pos];
            if (c === '+') { pos++; v = (function (a, b) { return function (x) { return a(x) + b(x); }; })(v, parseMulDiv()); }
            else if (c === '-') { pos++; v = (function (a, b) { return function (x) { return a(x) - b(x); }; })(v, parseMulDiv()); }
            else return v;
          }
        }
        function parseMulDiv() {
          var v = parseUnary();
          for (;;) {
            skipWs();
            var c = src[pos];
            if (c === '*' && src[pos + 1] !== '*') { pos++; v = (function (a, b) { return function (x) { return a(x) * b(x); }; })(v, parseUnary()); }
            else if (c === '/') { pos++; v = (function (a, b) { return function (x) { return a(x) / b(x); }; })(v, parseUnary()); }
            else if (c === '%') { pos++; v = (function (a, b) { return function (x) { return a(x) % b(x); }; })(v, parseUnary()); }
            else return v;
          }
        }
        function parseUnary() {
          skipWs();
          var c = src[pos];
          if (c === '-') { pos++; return (function (inner) { return function (x) { return -inner(x); }; })(parseUnary()); }
          if (c === '+') { pos++; return parseUnary(); }
          return parsePower();
        }
        function parsePower() {
          var base = parseAtom();
          skipWs();
          if (src[pos] === '^') { pos++; return (function (b, e2) { return function (x) { return Math.pow(b(x), e2(x)); }; })(base, parseUnary()); }
          if (src[pos] === '*' && src[pos + 1] === '*') { pos += 2; return (function (b, e2) { return function (x) { return Math.pow(b(x), e2(x)); }; })(base, parseUnary()); }
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
          if (isDigit(c) || (c === '.' && isDigit(src[pos + 1]))) {
            var n = parseNumber();
            return function () { return n; };
          }
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
              if (has(_FORMULA_UNARY, name)) {
                if (args.length !== 1) throw new Error(name + ' expects 1 argument, got ' + args.length);
                return (function (fn, a0) { return function (x) { return fn(a0(x)); }; })(_FORMULA_UNARY[name], args[0]);
              }
              if (has(_FORMULA_MULTI, name)) {
                if (args.length === 0) throw new Error(name + ' expects at least 1 argument');
                return (function (fn, fargs) {
                  return function (x) {
                    var vals = [];
                    for (var i = 0; i < fargs.length; i++) vals.push(fargs[i](x));
                    return fn.apply(null, vals);
                  };
                })(_FORMULA_MULTI[name], args);
              }
              throw new Error('Unknown function: ' + name);
            }
            if (name === 'x') return function (x) { return x; };
            if (name === 'pi') return function () { return Math.PI; };
            if (name === 'e') return function () { return Math.E; };
            throw new Error('Undefined symbol ' + name);
          }
          throw new Error('Unexpected character ' + (c === undefined ? '<end>' : c) + ' at position ' + pos);
        }

        var rootFn = parseExpressionLvl();
        skipWs();
        if (pos < len) throw new Error('Unexpected trailing input at position ' + pos);
        return rootFn;
      }

      function evaluateFormula(formula, x) {
        try {
          var key = String(formula);
          var fn = _formulaCache[key];
          if (fn === undefined) {
            fn = _compileFormula(key);
            _formulaCache[key] = fn;
          }
          var result = fn(x);
          if (typeof result !== 'number' || !Number.isFinite(result)) {
            throw new Error('Formula must evaluate to a finite number, got ' + typeof result + ': ' + result);
          }
          return result;
        } catch (error) {
          throw new Error('Formula evaluation error: ' + error.message);
        }
      }
`;
