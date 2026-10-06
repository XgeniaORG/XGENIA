// The ONE slot-maths formula evaluator (src/api/formula-eval-core.js, 2026-10-04).
//
// The editor slot nodes evaluated payoutFormula / weightFormula / freeSpinsRewardFormula with mathjs and
// the RGS with a hand-written subset, and the two disagreed: "2x", "x!", log(x, 2), PI and "5%" played in
// the editor and failed every RGS round; round(-2.5), -7 % 3, mod(-7, 3), x % 0 and nthRoot(-8, 3) gave
// different numbers; "x ** 2" and trunc() worked only on the RGS; 1 / 0 put Infinity into the editor's
// paytable. Both sides now run this evaluator (the editor through slot-game-cores.js, the RGS through the
// text the compiler embeds). It keeps mathjs's numbers on the formulas it accepts — this file holds it
// to the real mathjs — and refuses everything else with a message that says what to write instead.
'use strict';

const { evaluate } = require('mathjs');
const core = require('../../src/api/formula-eval-core');

const { evaluateFormula } = core;
const mathjs = (formula, x) => evaluate(formula, { x, pi: Math.PI, e: Math.E });
const refusal = (formula, x) => {
  try {
    evaluateFormula(formula, x);
  } catch (e) {
    return e.message;
  }
  return null;
};

describe('formula-eval-core — mathjs numbers on the accepted set', () => {
  test('the formulas that used to diverge between the editor and the RGS give mathjs\'s numbers', () => {
    const cases = [
      '2 ^ x', 'x ^ 2', '2 ^ 3 ^ 2', '-x ^ 2', '2 ^ -x', // ^ is power, right-associative, below unary minus
      'min(x, 5)', 'max(x, 3)', 'min(x, 4, 2 * x)', 'max(-x, 0.5, x / 3)', // min / max, variadic
      'x % 3', '-x % 3', 'x % (-4)', 'mod(x, 4)', 'mod(-x, 4)', 'x % 0', 'mod(x, 0)', // % and mod are mathjs mod
      'round(x / 2)', 'round(-x / 2)', 'round(-2.5)', 'round(2.5)', 'round(x / 3, 2)', 'round(-0.5)', // half away from zero
      'floor(0.1 * 3 * 10)', 'ceil(x / 3)', 'fix(-x / 2)', 'floor(x / 3, 1)', 'ceil(-x / 7, 2)',
      'nthRoot(-x, 3)', 'nthRoot(x, 3)', 'cbrt(-x)', 'sign(x - 3)', 'log10(x)', 'log(x, 2)', 'log(x)',
      'x <= 1 ? 0 : (x * (x + 1)) / 2', 'x == 3 ? 7 : 1', '0.1 + 0.2 == 0.3 ? 1 : 0', 'x > 3 ? 10 : 1',
      'hypot(x, 3)', 'pow(x, 0.5)', 'PI * x', 'E ^ -x', 'pi * x', 'e ^ (-x)', 'exp(-x / 15)', '2.25 + 0.75 * x'
    ];
    for (const formula of cases) {
      for (const x of [1, 2, 3, 4, 5, 7, 10]) {
        expect([formula, x, evaluateFormula(formula, x)]).toEqual([formula, x, mathjs(formula, x)]);
      }
    }
    // the ones people remember
    expect(evaluateFormula('round(-2.5)', 0)).toBe(-3);
    expect(evaluateFormula('-x % 3', 7)).toBe(2);
    expect(evaluateFormula('mod(-7, 3)', 0)).toBe(2);
    expect(evaluateFormula('x % 0', 5)).toBe(5);
    expect(evaluateFormula('nthRoot(-8, 3)', 0)).toBe(-2);
    expect(evaluateFormula('2 ^ 3', 0)).toBe(8); // never XOR (1)
    expect(evaluateFormula('floor(0.1 * 3 * 10)', 0)).toBe(3); // 3.0000000000000004 under Math.floor is 3 either way …
    expect(evaluateFormula('floor(2.9999999999999996)', 0)).toBe(3); // … this one is 2 under Math.floor, 3 in mathjs
  });

  test('every formula the existing projects use keeps its mathjs numbers (45 projects + templates + fixtures, 2026-10-04)', () => {
    const inUse = [
      '0.6 + 0.3 * x', '1.2 + 0.6 * x', '1.20 + 0.40 * x', '1.5 + 0.5 * x', '2.25 + 0.75 * x', '2.6 * (2.25 + 0.75 * x)',
      '4.35 + 2.18 * x', '4.8 + 2.4 * x', '4.85 + 1.2125 * x', '5 * (1.2 + 0.6 * x)', '5.85 + 1.95 * x', 'pow(1.5, x)',
      '1 / x', '10 - x', '9 - x', 'exp(-x / 11)', 'exp(-x / 15)', 'exp(-x / 4)', 'exp(-x/4)', 'exp(-x / 6)', 'exp(-x / 8)',
      '8 + 4 * x', 'x <= 1 ? 0 : (x * (x + 1)) / 2'
    ];
    for (const formula of inUse) {
      for (let x = 1; x <= 20; x++) expect([formula, x, evaluateFormula(formula, x)]).toEqual([formula, x, mathjs(formula, x)]);
    }
  });

  test('random formulas over the accepted grammar: the same number as mathjs, or refused where mathjs leaves the reals', () => {
    let s = 20261004;
    const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const UN = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'exp', 'expm1', 'log1p', 'log2', 'log10', 'log', 'sqrt', 'cbrt', 'abs', 'sign', 'square', 'cube', 'round', 'floor', 'ceil', 'fix'];
    const BIN = ['pow', 'atan2', 'mod', 'log', 'nthRoot', 'min', 'max', 'hypot'];
    const gen = (d) => {
      if (d <= 0 || rnd() < 0.25) return pick(['x', 'x', String(Math.floor(rnd() * 20)), (rnd() * 10).toFixed(pick([1, 2, 3])), 'pi', 'e', '0.1', '2.5', '0']);
      const r = rnd();
      if (r < 0.35) return '(' + gen(d - 1) + ' ' + pick(['+', '-', '*', '/', '%', '^']) + ' (' + gen(d - 1) + '))';
      if (r < 0.5) return '-' + gen(d - 1);
      if (r < 0.7) return pick(UN) + '(' + gen(d - 1) + ')';
      if (r < 0.85) return pick(BIN) + '(' + gen(d - 1) + ', ' + gen(d - 1) + ')';
      return '(' + gen(d - 1) + ' ' + pick(['<', '<=', '>', '>=', '==', '!=']) + ' ' + gen(d - 1) + ' ? ' + gen(d - 1) + ' : ' + gen(d - 1) + ')';
    };
    const XS = [0, 1, 2, 3, 5, 10, -1, -2.5, 0.5, 2.9999999999999996, 0.30000000000000004, 1.005, 2.675];
    let compared = 0;
    for (let i = 0; i < 2500; i++) {
      const f = gen(4);
      for (const x of XS) {
        let want;
        try { want = mathjs(f, x); } catch (e) { want = undefined; }
        const ours = refusal(f, x) === null ? evaluateFormula(f, x) : undefined;
        if (typeof want === 'number' && Number.isFinite(want)) {
          if (ours === undefined) {
            // mathjs went through a complex value (sqrt(-1), asin(2), (-8)^(1/3), …) and back to a real one
            expect([f, x, refusal(f, x)]).toEqual([f, x, expect.stringMatching(/is not a real number/)]);
          } else {
            expect([f, x, Object.is(ours, want) ? 'same' : ours]).toEqual([f, x, 'same']);
            compared++;
          }
        } else {
          expect([f, x, ours]).toEqual([f, x, undefined]); // mathjs refused or left the reals: so do we
        }
      }
    }
    expect(compared).toBeGreaterThan(5000);
  });
});

describe('formula-eval-core — refused, explicitly, on both sides', () => {
  test.each([
    ['2x', /Implicit multiplication is not supported/],
    ['2 * (x + 1)(x - 1)', /Implicit multiplication is not supported/],
    ['x!', /Factorial "!" is not supported/],
    ['5%', /Percentages \("5%"\) are not supported/],
    ['50% * x', /Percentages/],
    ['x % -4', /Percentages/], // mathjs reads this as x / 100 - 4
    ['x ** 2', /"\*\*" is not supported: write x \^ 2/],
    ['x = 2', /Assignment "=" is not supported/],
    ['x mod 3', /Operator "mod" is not supported/],
    ['x > 1 and x < 4', /Operator "and" is not supported/],
    ['1 < x < 3', /Chained comparisons are not supported/],
    ['random()', /Unknown function: random/],
    ['factorial(x)', /Unknown function: factorial/],
    ['tau * x', /Undefined symbol tau/],
    ['exponential', /Undefined symbol exponential/],
    ['1 / 0', /must evaluate to a finite number/],
    ['exp(1000)', /must evaluate to a finite number/],
    ['x > 2', /must evaluate to a finite number, got boolean/],
    ['sqrt(-1)', /sqrt\(-1\) is not a real number/],
    ['(-8) ^ (1 / 3)', /is not a real number/],
    ['nthRoot(-4, 2)', /Root must be odd when a is negative/],
    ['round(x, 16)', /Number of decimals in function round/],
    ['', /Unexpected character <end>/]
  ])('%s', (formula, message) => {
    const m = refusal(formula, 3);
    expect(m).toMatch(/^Formula evaluation error: /);
    expect(m).toMatch(message);
  });
});

describe('formula-eval-core — the embedded text', () => {
  test('is the module: the compiled RGS runs this exact function body', () => {
    // eslint-disable-next-line no-new-func
    const embedded = new Function('return (' + core.FORMULA_SOURCE + ')()')();
    for (const f of ['exp(-x / 15)', '-x % 3', 'round(-x / 2)', 'max(x, 3) ^ 2']) {
      for (const x of [1, 2, 3, 9]) expect(embedded.evaluateFormula(f, x)).toBe(evaluateFormula(f, x));
    }
    expect(() => embedded.evaluateFormula('2x', 1)).toThrow(/Implicit multiplication/);
  });

  test('carries none of the constructs the XRGS sandbox refuses', () => {
    const blocked = [/\bimport\s*\(/, /\brequire\s*\(/, /\bcrypto\b/, /\bDeno\b/, /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/,
      /\bMath\s*\.\s*random\b/, /__proto__/, /\bglobalThis\b/, /\bwindow\b/, /\bReflect\b/, /\bProxy\b/, /\.constructor\s*\(/];
    for (const re of blocked) expect([re.source, re.test(core.FORMULA_SOURCE)]).toEqual([re.source, false]);
  });
});
