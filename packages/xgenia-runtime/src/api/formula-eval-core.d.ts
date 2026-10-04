/**
 * Type surface for formula-eval-core.js (a plain JS module; see its docblock): the one slot-maths
 * formula evaluator, shared by the editor slot nodes and every compiled RGS script.
 */
export interface FormulaEvaluator {
  /** The value of `formula` at x — a finite number, or a throw starting "Formula evaluation error: ". */
  evaluateFormula(formula: string, x: number): number;
  functionNames: string[];
  constantNames: string[];
}
export function defineFormulaEvaluator(): FormulaEvaluator;
/** The exact text the compilers embed: `(<FORMULA_SOURCE>)()`. */
export const FORMULA_SOURCE: string;
export const evaluateFormula: FormulaEvaluator['evaluateFormula'];
export const functionNames: string[];
export const constantNames: string[];
