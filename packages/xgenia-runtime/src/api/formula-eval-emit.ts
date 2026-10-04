/**
 * formula-eval-emit.ts — the formula evaluator as EMITTED code, for compiled RGS node bodies.
 *
 * History (kept because each step was a real money bug):
 *   * 2026-07 (root-tree deep-dive #4): the shim was copy-pasted into three generators and drifted
 *     from each other and from the editor's mathjs; it became one emitted string.
 *   * 2026-07-10 (trace 1783634013326): that string used eval(), which sanitizeForSandbox replaced
 *     with 0 in the uploaded bundle — every weight / paytable formula evaluated to 0 in the
 *     certified RGS. It became a no-eval recursive-descent parser.
 *   * 2026-10-04: it was still a SECOND evaluator — the editor kept mathjs — and the two disagreed
 *     (implicit multiplication, round(-2.5), -7 % 3, nthRoot(-8, 3), x ** 2, 1 / 0, …; see
 *     formula-eval-core.js). Now there is ONE evaluator, formula-eval-core.js, run by the editor slot
 *     nodes (through slot-game-cores.js) and embedded here verbatim for the generators that still
 *     interpolate a node-local evaluateFormula (the Math formula nodes in math-node-converter.ts).
 *     The slot-game nodes do not use this string any more: their compiled bodies call the shared
 *     cores (slot-game-node-converter.ts corePrelude).
 *
 * The emitted text declares `function evaluateFormula(formula, x)` in the enclosing function body,
 * contains nothing the RGS sandbox blocklist rejects, and survives sanitizeForSandbox unchanged in
 * behaviour (private xgenia-ai-app tests/formula-eval-parity.test.ts locks both, against mathjs).
 */
import { FORMULA_SOURCE } from './formula-eval-core';

export const EVALUATE_FORMULA_JS = `
      var __formulaEvaluator = (${FORMULA_SOURCE})();
      function evaluateFormula(formula, x) {
        return __formulaEvaluator.evaluateFormula(formula, x);
      }
`;
