/**
 * Arithmetic and keyboard nudging for the inspector's number fields.
 *
 * Deliberately hand-rolled rather than delegating to `eval` or mathjs: this parser
 * accepts numbers and the four operators and NOTHING else, so a port value can never
 * become an execution vector. It is also pure and synchronous, which is what lets the
 * whole surface be covered by tests instead of by clicking around the editor.
 */

export type NumberEditResult =
  | { kind: 'value'; value: number }
  /** The field was emptied — the caller resets the parameter to its default. */
  | { kind: 'clear' }
  /** Not a number and not an expression. The caller restores the previous value. */
  | { kind: 'invalid' };

/** Multiplication and division signs a user may paste in from a document. */
const MULTIPLY_CHARS = '*×'; // * ×
const DIVIDE_CHARS = '/÷'; // / ÷
/** Unicode minus and en-dash, which arrive from autocorrect and copied text. */
const MINUS_CHARS = '-−–';

type Token = { kind: 'number'; value: number } | { kind: 'op'; op: '+' | '-' | '*' | '/' };

function normalizeOperators(input: string): string {
  let out = '';
  for (const ch of input) {
    if (MULTIPLY_CHARS.indexOf(ch) !== -1) out += '*';
    else if (DIVIDE_CHARS.indexOf(ch) !== -1) out += '/';
    else if (MINUS_CHARS.indexOf(ch) !== -1) out += '-';
    else out += ch;
  }
  return out;
}

/**
 * Splits into numbers and operators. Returns null on any character outside the
 * accepted set, which is what keeps `alert(1)` from ever reaching the evaluator.
 */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const ch = input[index];

    if (ch === ' ') {
      index++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', op: ch });
      index++;
      continue;
    }

    // A number: digits with at most one decimal point. No exponents — `1e3` in a
    // size field is far more likely to be a typo than an intent.
    const start = index;
    let sawDot = false;
    while (index < input.length) {
      const c = input[index];
      if (c >= '0' && c <= '9') {
        index++;
      } else if (c === '.' && !sawDot) {
        sawDot = true;
        index++;
      } else {
        break;
      }
    }

    if (index === start) return null; // Unrecognised character.

    const value = Number(input.slice(start, index));
    if (!isFinite(value)) return null;
    tokens.push({ kind: 'number', value });
  }

  return tokens;
}

/**
 * Folds unary signs into their number so the evaluator below only ever sees
 * `number op number op number`. Handles `-5`, `3 * -2` and the doubled `+-5`.
 */
function foldUnarySigns(tokens: Token[]): Token[] | null {
  const out: Token[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.kind === 'number') {
      out.push(token);
      continue;
    }

    // An operator in a value position (start of input, or straight after another
    // operator) is a sign, not a binary operator.
    const previous = out.length > 0 ? out[out.length - 1] : undefined;
    const isValuePosition = previous === undefined || previous.kind === 'op';

    if (!isValuePosition) {
      out.push(token);
      continue;
    }

    if (token.op === '*' || token.op === '/') return null; // `*3` cannot start a value.

    const next = tokens[i + 1];
    if (next === undefined || next.kind !== 'number') return null;

    out.push({ kind: 'number', value: token.op === '-' ? -next.value : next.value });
    i++; // Consumed the number too.
  }

  return out;
}

/** Two passes so `2 + 3 * 4` is 14, not 20. */
function evaluateTokens(tokens: Token[]): number | null {
  if (tokens.length === 0) return null;
  if (tokens.length % 2 === 0) return null; // Must be number (op number)*.

  // Pass 1: * and /
  const folded: Token[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const operand = tokens[i + 1];
    if (op.kind !== 'op' || operand === undefined || operand.kind !== 'number') return null;

    if (op.op === '*' || op.op === '/') {
      const left = folded[folded.length - 1];
      if (left.kind !== 'number') return null;
      // Division by zero yields Infinity, which is not a usable port value.
      if (op.op === '/' && operand.value === 0) return null;
      folded[folded.length - 1] = {
        kind: 'number',
        value: op.op === '*' ? left.value * operand.value : left.value / operand.value
      };
    } else {
      folded.push(op, operand);
    }
  }

  // Pass 2: + and -
  const first = folded[0];
  if (first.kind !== 'number') return null;
  let total = first.value;
  for (let i = 1; i < folded.length; i += 2) {
    const op = folded[i];
    const operand = folded[i + 1];
    if (op.kind !== 'op' || operand === undefined || operand.kind !== 'number') return null;
    total = op.op === '+' ? total + operand.value : total - operand.value;
  }

  return isFinite(total) ? total : null;
}

/**
 * Trims float dust. `0.1 + 0.2` must commit as `0.3`, not `0.30000000000000004` —
 * that value would be written into the project file and shown back to the user.
 */
export function roundFloat(value: number, decimals = 6): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Reads what the user typed into a number field.
 *
 * A LEADING operator is relative to the current value: `+5` adds five, `*2` doubles,
 * `/2` halves. A leading `-` is NOT relative — `-5` is the number minus five, because
 * typing a negative number is far more common than wanting to subtract, and there is
 * no way to type a negative literal if `-` is stolen for subtraction. To subtract,
 * write the arithmetic out (`100-5`) or use the down arrow.
 */
export function evaluateNumberInput(raw: string, currentValue: number | undefined): NumberEditResult {
  const trimmed = normalizeOperators((raw ?? '').trim());
  if (trimmed === '') return { kind: 'clear' };

  const isRelative =
    trimmed[0] === '+' || trimmed[0] === '*' || trimmed[0] === '/';

  if (isRelative) {
    // Relative to a value we do not have is meaningless; treat the current value as 0
    // only for `+`, and refuse scaling nothing.
    const base = typeof currentValue === 'number' && isFinite(currentValue) ? currentValue : undefined;
    if (base === undefined && trimmed[0] !== '+') return { kind: 'invalid' };

    const tokens = tokenize(trimmed);
    if (tokens === null) return { kind: 'invalid' };

    const withBase: Token[] = [{ kind: 'number', value: base ?? 0 }, ...tokens];
    const folded = foldUnarySigns(withBase);
    if (folded === null) return { kind: 'invalid' };

    const result = evaluateTokens(folded);
    return result === null ? { kind: 'invalid' } : { kind: 'value', value: roundFloat(result) };
  }

  const tokens = tokenize(trimmed);
  if (tokens === null) return { kind: 'invalid' };
  const folded = foldUnarySigns(tokens);
  if (folded === null) return { kind: 'invalid' };
  const result = evaluateTokens(folded);
  return result === null ? { kind: 'invalid' } : { kind: 'value', value: roundFloat(result) };
}

/**
 * True when the text is a number the ordinary editor already handles correctly, so
 * the arithmetic layer can stand aside.
 *
 * A leading `+` is deliberately NOT plain: `+5` is relative in this grammar. Treating
 * it as plain was a real bug — the passthrough regex allowed `[+-]?`, so `+5` never
 * reached the evaluator and the legacy parser read it as the literal 5, silently
 * replacing the value instead of adding to it.
 */
export function isPlainNumberLiteral(raw: string): boolean {
  return /^\s*-?(\d+\.?\d*|\.\d+)\s*$/.test(raw ?? '');
}

export interface NudgeModifiers {
  /** Shift: coarse. */
  shiftKey?: boolean;
  /** Alt: fine. */
  altKey?: boolean;
}

/** Arrow-key step size. Matches the convention every design tool uses. */
export function nudgeStep(modifiers: NudgeModifiers): number {
  if (modifiers.shiftKey) return 10;
  if (modifiers.altKey) return 0.1;
  return 1;
}

/**
 * Arrow-key nudge. `direction` is +1 for Up and -1 for Down. A field holding
 * something non-numeric nudges from zero rather than refusing — pressing Up in an
 * empty size field should give you a number.
 */
export function nudgeValue(
  currentValue: number | undefined,
  direction: 1 | -1,
  modifiers: NudgeModifiers = {}
): number {
  const base = typeof currentValue === 'number' && isFinite(currentValue) ? currentValue : 0;
  return roundFloat(base + direction * nudgeStep(modifiers));
}

/**
 * Splits a raw field value into its number and trailing unit (`"12px"` → `12`, `"px"`).
 * Used to show the unit as a suffix inside the field while still handing the parser a
 * bare number. Returns a null number when there is nothing numeric to work with.
 */
export function splitValueUnit(raw: string): { value: number | null; unit: string } {
  const trimmed = (raw ?? '').trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/i.exec(trimmed);
  if (match === null) return { value: null, unit: '' };
  const value = Number(match[1]);
  return { value: isFinite(value) ? value : null, unit: match[2] };
}
