'use strict';

/**
 * Slot-maths formula evaluator — the ONE evaluator, written once (2026-10-04).
 *
 * WHAT WAS WRONG: the editor evaluated the slot-maths formulas (Get Paytable payoutFormula,
 * Generate Symbol Weights weightFormula, Calculate Free Spins States freeSpinsRewardFormula) with
 * real mathjs, and the RGS with a hand-written subset (formula-eval-emit.ts). Measured on the same
 * formulas (src/api/test-slot-game-parity.ts):
 *   * formulas mathjs took and the RGS refused, so the game played in the editor and every RGS round
 *     failed: implicit multiplication "2x" / "2(x + 1)", "x!", log(x, 2), round(x / 3, 2), PI, E,
 *     percentages "5%";
 *   * formulas both took that gave DIFFERENT numbers: round(-2.5) (mathjs -3, Math.round -2),
 *     -7 % 3 and mod(-7, 3) (mathjs 2, JS remainder -1), x % 0 (mathjs x, JS NaN), nthRoot(-8, 3)
 *     (mathjs -2, the RGS NaN), floor / ceil of a value a rounding error away from an integer;
 *   * formulas the RGS took and mathjs refused: "x ** 2", trunc(x);
 *   * results the editor kept and the RGS refused: 1 / 0, log(0), 0 / 0 — Infinity and NaN went
 *     straight into the editor's paytable and symbol weights.
 * The game a player tested was not the game the RGS paid. Now both sides run THIS function body:
 * the editor slot nodes through slot-game-cores.js, the RGS through the text the compiler embeds
 * (slot-game-node-converter.ts corePrelude, and EVALUATE_FORMULA_JS in formula-eval-emit.ts for the
 * Math formula nodes). One set of formulas is accepted, one is refused, the same way on both sides:
 *   * supported, with mathjs's number semantics (the editor's documented language): numbers, the
 *     variable x, the constants pi / PI and e / E; + - * / % ^ (and
 *     mathjs precedence: unary minus binds looser than ^, -2^2 = -4); comparisons < <= > >= == !=
 *     with mathjs's tolerance (relTol 1e-12, absTol 1e-15); the ternary a ? b : c (lazy); and
 *     sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh exp expm1 log(x[, base]) log1p
 *     log2 log10 sqrt cbrt abs sign square cube pow atan2 hypot min max nthRoot(a[, root]) mod
 *     round(x[, n]) floor(x[, n]) ceil(x[, n]) fix(x[, n]) trunc(x[, n]) (= fix) — round / floor /
 *     ceil / fix / mod / min / max / hypot / nthRoot ported from mathjs 14 so a formula the editor
 *     preview accepted gives the same number it gave under mathjs;
 *   * refused with a message that says what to write instead: implicit multiplication, factorial,
 *     percentages, assignment, keyword operators (mod / and / or / not / xor / to / in), "**",
 *     every other function or symbol, and a result that is not a finite number.
 *
 * RULES FOR THIS FILE (the body runs inside the XRGS script sandbox after sanitizeForSandbox, and
 * the private formula-eval parity test scans the raw text): everything lives INSIDE
 * defineFormulaEvaluator() and references nothing outside it; ES2017 syntax; no classes, timers,
 * randomness or dynamic code; no `x: number`-shaped text; and none of the words the sandbox refuses
 * (the module loaders, the host runtime, dynamic code), not even in a comment.
 */
function defineFormulaEvaluator() {
  // mathjs DEFAULT_CONFIG (core/config.js): every comparison, round, floor and ceil uses these.
  var REL_TOL = 1e-12;
  var ABS_TOL = 1e-15;
  // round's "round off errors first" precision: |exponent of relTol| (mathjs round.js toExponent).
  var EPSILON_EXPONENT = 12;

  function fail(message) {
    throw new Error(message);
  }

  // ── mathjs utils/number.js ────────────────────────────────────────────────────────────────

  function nearlyEqual(a, b) {
    if (a !== a || b !== b) return false; // NaN
    if (!isFinite(a) || !isFinite(b)) return a === b;
    if (a === b) return true;
    return Math.abs(a - b) <= Math.max(REL_TOL * Math.max(Math.abs(a), Math.abs(b)), ABS_TOL);
  }
  function isInteger(v) {
    if (typeof v === 'boolean') return true;
    return isFinite(v) ? v === Math.round(v) : false;
  }
  function zeros(length) {
    var arr = [];
    for (var i = 0; i < length; i++) arr.push(0);
    return arr;
  }
  function splitNumber(value) {
    var match = String(value).toLowerCase().match(/^(-?)(\d+\.?\d*)(e([+-]?\d+))?$/);
    if (!match) fail('Invalid number ' + value);
    var sign = match[1];
    var digits = match[2];
    var exponent = parseFloat(match[4] || '0');
    var dot = digits.indexOf('.');
    exponent += dot !== -1 ? dot - 1 : digits.length - 1;
    var coefficients = digits
      .replace('.', '')
      .replace(/^0*/, function (z) { exponent -= z.length; return ''; })
      .replace(/0*$/, '')
      .split('')
      .map(function (d) { return parseInt(d, 10); });
    if (coefficients.length === 0) {
      coefficients.push(0);
      exponent++;
    }
    return { sign: sign, coefficients: coefficients, exponent: exponent };
  }
  function roundDigits(split, precision) {
    var rounded = { sign: split.sign, coefficients: split.coefficients, exponent: split.exponent };
    var c = rounded.coefficients;
    while (precision <= 0) {
      c.unshift(0);
      rounded.exponent++;
      precision++;
    }
    if (c.length > precision) {
      var removed = c.splice(precision, c.length - precision);
      if (removed[0] >= 5) {
        var i = precision - 1;
        c[i]++;
        while (c[i] === 10) {
          c.pop();
          if (i === 0) {
            c.unshift(0);
            rounded.exponent++;
            i++;
          }
          i--;
          c[i]++;
        }
      }
    }
    return rounded;
  }
  /** Decimal rounding of the printed digits, half away from zero (mathjs toFixed). */
  function toFixed(value, precision) {
    if (value !== value || !isFinite(value)) return String(value);
    var splitValue = splitNumber(value);
    var rounded = roundDigits(splitValue, splitValue.exponent + 1 + precision);
    var c = rounded.coefficients;
    var p = rounded.exponent + 1;
    var pp = p + (precision || 0);
    if (c.length < pp) c = c.concat(zeros(pp - c.length));
    if (p < 0) {
      c = zeros(-p + 1).concat(c);
      p = 1;
    }
    if (p < c.length) c.splice(p, 0, p === 0 ? '0.' : '.');
    return rounded.sign + c.join('');
  }

  // ── mathjs function/arithmetic + relational, number signatures ─────────────────────────────

  function roundNumber(value, decimals) {
    if (!isInteger(decimals) || decimals < 0 || decimals > 15) {
      fail('Number of decimals in function round must be an integer from 0 to 15 inclusive');
    }
    return parseFloat(toFixed(value, decimals));
  }
  function round(x, n) {
    if (n === undefined) {
      var xe = roundNumber(x, EPSILON_EXPONENT);
      return roundNumber(nearlyEqual(x, xe) ? xe : x, 0);
    }
    if (n >= EPSILON_EXPONENT) return roundNumber(x, n);
    var xe2 = roundNumber(x, EPSILON_EXPONENT);
    return roundNumber(nearlyEqual(x, xe2) ? xe2 : x, n);
  }
  function floorNumber(x) {
    var f = Math.floor(x);
    var r = round(x);
    if (f === r) return f;
    if (nearlyEqual(x, r) && !nearlyEqual(x, f)) return r;
    return f;
  }
  function ceilNumber(x) {
    var c = Math.ceil(x);
    var r = round(x);
    if (c === r) return c;
    if (nearlyEqual(x, r) && !nearlyEqual(x, c)) return r;
    return c;
  }
  function decimalsShift(n, fn) {
    if (!isInteger(n)) fail('number of decimals in function ' + fn + ' must be an integer');
    if (n < 0 || n > 15) fail('number of decimals in ' + fn + ' number must be in range ' + (fn === 'floor' ? '0 - 15' : '0-15'));
    return Math.pow(10, n);
  }
  function floor(x, n) {
    if (n === undefined) return floorNumber(x);
    var shift = decimalsShift(n, 'floor');
    return floorNumber(x * shift) / shift;
  }
  function ceil(x, n) {
    if (n === undefined) return ceilNumber(x);
    var shift = decimalsShift(n, 'ceil');
    return ceilNumber(x * shift) / shift;
  }
  function fix(x, n) {
    return x > 0 ? floor(x, n) : ceil(x, n);
  }
  function mod(x, y) {
    return y === 0 ? x : x - y * floorNumber(x / y);
  }
  function smaller(x, y) { return x < y && !nearlyEqual(x, y); }
  function larger(x, y) { return x > y && !nearlyEqual(x, y); }
  function smallerEq(x, y) { return x <= y || nearlyEqual(x, y); }
  function largerEq(x, y) { return x >= y || nearlyEqual(x, y); }
  function equal(x, y) { return nearlyEqual(x, y); }
  function unequal(x, y) { return !nearlyEqual(x, y); }
  function extreme(args, beats) {
    var res;
    for (var i = 0; i < args.length; i++) {
      var v = args[i];
      if (v !== v) res = v;
      else if (res === undefined || beats(v, res)) res = v;
    }
    return res;
  }
  function hypot(args) {
    var result = 0;
    var largest = 0;
    for (var i = 0; i < args.length; i++) {
      var value = Math.abs(args[i]);
      if (smaller(largest, value)) {
        result = result * ((largest / value) * (largest / value));
        result = result + 1;
        largest = value;
      } else {
        var positive = nearlyEqual(value, 0) ? false : value > 0;
        result = result + (positive ? (value / largest) * (value / largest) : value);
      }
    }
    return largest * Math.sqrt(result);
  }
  function nthRoot(a, root) {
    if (root === undefined) root = 2;
    var inv = root < 0;
    if (inv) root = -root;
    if (root === 0) fail('Root must be non-zero');
    if (a < 0 && Math.abs(root) % 2 !== 1) fail('Root must be odd when a is negative.');
    if (a === 0) return inv ? Infinity : 0;
    if (!isFinite(a)) return inv ? 0 : a;
    var r = Math.pow(Math.abs(a), 1 / root);
    r = a < 0 ? -r : r;
    return inv ? 1 / r : r;
  }
  // Where mathjs leaves the real numbers (sqrt(-1), log(-2), asin(2), (-8) ^ (1/3), …) it returns a
  // Complex, which the editor then refused as "not a number" — or, inside a comparison or abs(),
  // quietly turned back into a real one. There are no complex numbers here: such a value is refused
  // where it arises, with the same rule mathjs uses to leave the reals.
  function real(name, x, inDomain) {
    if (!inDomain) fail(name + '(' + x + ') is not a real number');
  }
  function pow(x, y) {
    if ((x * x < 1 && y === Infinity) || (x * x > 1 && y === -Infinity)) return 0;
    if (isInteger(y) || x >= 0) return Math.pow(x, y);
    return fail(x + ' ^ ' + y + ' is not a real number');
  }
  function ln(x) {
    real('log', x, x >= 0);
    return Math.log(x);
  }
  function log(x, base) {
    return base === undefined ? ln(x) : ln(x) / ln(base);
  }
  function domain(name, fn, test) {
    return function (x) {
      real(name, x, test(x));
      return fn(x);
    };
  }
  function unitInterval(x) { return x >= -1 && x <= 1; }

  /** name -> [function, fewest arguments, most arguments (-1 = any)] */
  var FUNCTIONS = {
    sin: [Math.sin, 1, 1], cos: [Math.cos, 1, 1], tan: [Math.tan, 1, 1],
    asin: [domain('asin', Math.asin, unitInterval), 1, 1], acos: [domain('acos', Math.acos, unitInterval), 1, 1], atan: [Math.atan, 1, 1],
    sinh: [Math.sinh, 1, 1], cosh: [Math.cosh, 1, 1], tanh: [Math.tanh, 1, 1],
    asinh: [Math.asinh, 1, 1], acosh: [domain('acosh', Math.acosh, function (x) { return x >= 1; }), 1, 1],
    atanh: [domain('atanh', Math.atanh, unitInterval), 1, 1],
    exp: [Math.exp, 1, 1], expm1: [Math.expm1, 1, 1], log1p: [domain('log1p', Math.log1p, function (x) { return x >= -1; }), 1, 1],
    log2: [domain('log2', Math.log2, function (x) { return x >= 0; }), 1, 1],
    log10: [domain('log10', Math.log10, function (x) { return x >= 0; }), 1, 1], log: [log, 1, 2],
    sqrt: [function (x) { if (x !== x) return NaN; real('sqrt', x, x >= 0); return Math.sqrt(x); }, 1, 1],
    cbrt: [Math.cbrt, 1, 1], abs: [Math.abs, 1, 1], sign: [Math.sign, 1, 1],
    square: [function (a) { return a * a; }, 1, 1], cube: [function (a) { return a * a * a; }, 1, 1],
    pow: [pow, 2, 2], atan2: [Math.atan2, 2, 2], nthRoot: [nthRoot, 1, 2], mod: [mod, 2, 2],
    round: [round, 1, 2], floor: [floor, 1, 2], ceil: [ceil, 1, 2], fix: [fix, 1, 2], trunc: [fix, 1, 2],
    hypot: [function () { return hypot(arguments); }, 1, -1],
    min: [function () { return extreme(arguments, smaller); }, 1, -1],
    max: [function () { return extreme(arguments, larger); }, 1, -1]
  };
  // x is the only variable (the nodes pass x; pi and e were the rest of the mathjs scope).
  var CONSTANTS = { pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E };
  var KEYWORD_OPERATORS = { mod: 1, and: 1, or: 1, not: 1, xor: 1, to: 1, in: 1 };
  var own = function (obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); };

  // ── parser: recursive descent, compiled once per formula into a closure tree ──────────────

  function compile(src) {
    var len = src.length;
    var pos = 0;

    function isDigit(c) { return c >= '0' && c <= '9'; }
    function isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
    function skipWs() {
      while (pos < len) {
        var cc = src.charCodeAt(pos);
        if (cc === 32 || cc === 9 || cc === 10 || cc === 13) pos++;
        else break;
      }
    }
    /** Refuse text that mathjs reads as an operation this evaluator does not support. */
    function refuseJuxtaposition() {
      skipWs();
      var c = src[pos];
      if (c === undefined) return;
      if (isAlpha(c)) {
        var at = pos;
        var word = '';
        while (at < len && (isAlpha(src[at]) || isDigit(src[at]))) word += src[at++];
        if (own(KEYWORD_OPERATORS, word)) {
          fail('Operator "' + word + '" is not supported: use mod(a, b) or a % b for a remainder and a ternary for conditions');
        }
      }
      if (isDigit(c) || c === '.' || isAlpha(c) || c === '(') {
        fail('Implicit multiplication is not supported: write the * (e.g. "2 * x", not "2x") at position ' + pos);
      }
      if (c === '!' && src[pos + 1] !== '=') fail('Factorial "!" is not supported at position ' + pos);
    }
    function parseNumber() {
      var start = pos;
      while (pos < len && isDigit(src[pos])) pos++;
      if (src[pos] === '.') {
        pos++;
        while (pos < len && isDigit(src[pos])) pos++;
      }
      if (src[pos] === 'e' || src[pos] === 'E') {
        var save = pos;
        pos++;
        if (src[pos] === '+' || src[pos] === '-') pos++;
        if (pos < len && isDigit(src[pos])) {
          while (pos < len && isDigit(src[pos])) pos++;
        } else {
          pos = save;
        }
      }
      return parseFloat(src.slice(start, pos));
    }
    function parseIdent() {
      var start = pos;
      while (pos < len && (isAlpha(src[pos]) || isDigit(src[pos]))) pos++;
      return src.slice(start, pos);
    }
    function parseTernary() {
      var cond = parseComparison();
      skipWs();
      if (src[pos] !== '?') return cond;
      pos++;
      var thenFn = parseTernary();
      skipWs();
      if (src[pos] !== ':') fail('Expected : in ternary at position ' + pos);
      pos++;
      var elseFn = parseTernary();
      // lazy, like mathjs ConditionalNode: only the branch taken is evaluated
      return function (x) { return cond(x) ? thenFn(x) : elseFn(x); };
    }
    function binary(op, a, b) {
      return function (x) { return op(a(x), b(x)); };
    }
    function parseComparison() {
      var left = parseAddSub();
      skipWs();
      var c = src[pos];
      var c2 = src[pos + 1];
      var op = null;
      if (c === '<' && c2 === '=') { pos += 2; op = smallerEq; }
      else if (c === '>' && c2 === '=') { pos += 2; op = largerEq; }
      else if (c === '=' && c2 === '=') { pos += 2; op = equal; }
      else if (c === '!' && c2 === '=') { pos += 2; op = unequal; }
      else if (c === '<') { pos += 1; op = smaller; }
      else if (c === '>') { pos += 1; op = larger; }
      else if (c === '=') fail('Assignment "=" is not supported (compare with ==) at position ' + pos);
      if (!op) return left;
      var cmp = binary(op, left, parseAddSub());
      skipWs();
      if (src[pos] === '<' || src[pos] === '>' || (src[pos] === '=' && src[pos + 1] === '=') || (src[pos] === '!' && src[pos + 1] === '=')) {
        fail('Chained comparisons are not supported: use a ternary at position ' + pos);
      }
      return cmp;
    }
    function parseAddSub() {
      var v = parseMulDiv();
      for (;;) {
        skipWs();
        var c = src[pos];
        if (c === '+') { pos++; v = binary(function (a, b) { return a + b; }, v, parseMulDiv()); }
        else if (c === '-') { pos++; v = binary(function (a, b) { return a - b; }, v, parseMulDiv()); }
        else return v;
      }
    }
    function parseMulDiv() {
      var v = parseUnary();
      for (;;) {
        refuseJuxtaposition();
        var c = src[pos];
        if (c === '*' && src[pos + 1] === '*') fail('"**" is not supported: write x ^ 2 at position ' + pos);
        if (c === '*') { pos++; v = binary(function (a, b) { return a * b; }, v, parseUnary()); }
        else if (c === '/') { pos++; v = binary(function (a, b) { return a / b; }, v, parseUnary()); }
        else if (c === '%') {
          pos++;
          skipWs();
          var n = src[pos];
          if (n === undefined || ')+-*/%^<>=!?:,'.indexOf(n) >= 0) {
            fail('Percentages ("5%") are not supported: write 5 / 100 at position ' + (pos - 1));
          }
          v = binary(mod, v, parseUnary());
        }
        else return v;
      }
    }
    function parseUnary() {
      skipWs();
      var c = src[pos];
      if (c === '-') { pos++; var neg = parseUnary(); return function (x) { return -neg(x); }; }
      if (c === '+') { pos++; var plus = parseUnary(); return function (x) { return +plus(x); }; }
      return parsePower();
    }
    function parsePower() {
      var base = parseAtom();
      skipWs();
      if (src[pos] === '^') { pos++; return binary(pow, base, parseUnary()); }
      return base;
    }
    function parseAtom() {
      skipWs();
      var c = src[pos];
      if (c === '(') {
        pos++;
        var inner = parseTernary();
        skipWs();
        if (src[pos] !== ')') fail('Expected ) at position ' + pos);
        pos++;
        return inner;
      }
      if (isDigit(c) || (c === '.' && isDigit(src[pos + 1]))) {
        var num = parseNumber();
        return function () { return num; };
      }
      if (isAlpha(c)) {
        var name = parseIdent();
        skipWs();
        if (src[pos] === '(') {
          pos++;
          var args = [];
          skipWs();
          if (src[pos] !== ')') {
            args.push(parseTernary());
            skipWs();
            while (src[pos] === ',') {
              pos++;
              args.push(parseTernary());
              skipWs();
            }
          }
          if (src[pos] !== ')') fail('Expected ) after arguments to ' + name);
          pos++;
          if (!own(FUNCTIONS, name)) fail('Unknown function: ' + name);
          var spec = FUNCTIONS[name];
          if (args.length < spec[1] || (spec[2] >= 0 && args.length > spec[2])) {
            fail(name + ' expects ' + (spec[1] === spec[2] ? spec[1] : spec[2] < 0 ? 'at least ' + spec[1] : spec[1] + ' or ' + spec[2]) +
              ' argument' + (spec[1] === 1 && spec[2] === 1 ? '' : 's') + ', got ' + args.length);
          }
          var fn = spec[0];
          return function (x) {
            var vals = [];
            for (var i = 0; i < args.length; i++) vals.push(args[i](x));
            return fn.apply(null, vals);
          };
        }
        if (name === 'x') return function (x) { return x; };
        if (own(CONSTANTS, name)) {
          var k = CONSTANTS[name];
          return function () { return k; };
        }
        fail('Undefined symbol ' + name);
      }
      fail('Unexpected character ' + (c === undefined ? '<end>' : c) + ' at position ' + pos);
    }

    var root = parseTernary();
    refuseJuxtaposition();
    skipWs();
    if (pos < len) fail('Unexpected trailing input at position ' + pos);
    return root;
  }

  var cache = {};
  /** The value of `formula` at x — a finite number, or a throw that starts "Formula evaluation error: ". */
  function evaluateFormula(formula, x) {
    try {
      var key = String(formula);
      var fn = own(cache, key) ? cache[key] : (cache[key] = compile(key));
      var result = fn(x);
      if (typeof result !== 'number' || !isFinite(result)) {
        fail('Formula must evaluate to a finite number, got ' + typeof result + ': ' + result);
      }
      return result;
    } catch (error) {
      throw new Error('Formula evaluation error: ' + error.message);
    }
  }

  return {
    evaluateFormula: evaluateFormula,
    functionNames: Object.keys(FUNCTIONS),
    constantNames: Object.keys(CONSTANTS)
  };
}

var FORMULA_EVALUATOR = defineFormulaEvaluator();

module.exports = {
  defineFormulaEvaluator: defineFormulaEvaluator,
  /** The exact text the compilers embed: `(<FORMULA_SOURCE>)()`. */
  FORMULA_SOURCE: String(defineFormulaEvaluator),
  evaluateFormula: FORMULA_EVALUATOR.evaluateFormula,
  functionNames: FORMULA_EVALUATOR.functionNames,
  constantNames: FORMULA_EVALUATOR.constantNames
};
