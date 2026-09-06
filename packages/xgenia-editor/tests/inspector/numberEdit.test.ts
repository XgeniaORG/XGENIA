import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateNumberInput,
  nudgeStep,
  nudgeValue,
  roundFloat,
  splitValueUnit
} from '../../src/editor/src/views/panels/propertyeditor/inspector/model/numberEdit';

function value(raw: string, current?: number): number {
  const result = evaluateNumberInput(raw, current);
  assert.equal(result.kind, 'value', `expected a value from ${JSON.stringify(raw)}, got ${result.kind}`);
  return (result as { kind: 'value'; value: number }).value;
}

test('plain numbers', () => {
  assert.equal(value('12'), 12);
  assert.equal(value('12.5'), 12.5);
  assert.equal(value('.5'), 0.5);
  assert.equal(value('  42  '), 42);
});

test('a leading minus is a negative literal, not subtraction', () => {
  // Typing a negative number must be possible; subtraction has `100-5`.
  assert.equal(value('-5', 100), -5);
  assert.equal(value('-0.25', 100), -0.25);
});

test('leading + * / are relative to the current value', () => {
  assert.equal(value('+5', 100), 105);
  assert.equal(value('*2', 21), 42);
  assert.equal(value('/2', 100), 50);
  assert.equal(value('+-5', 100), 95);
});

test('unicode operators pasted from documents', () => {
  assert.equal(value('×2', 21), 42);
  assert.equal(value('÷2', 100), 50);
  assert.equal(value('−5', 100), -5);
});

test('infix arithmetic with correct precedence', () => {
  assert.equal(value('2+3*4'), 14);
  assert.equal(value('100/4+5'), 30);
  assert.equal(value('10-2-3'), 5);
  assert.equal(value('2*3*4'), 24);
});

test('float dust never reaches the model', () => {
  // 0.1 + 0.2 must commit as 0.3, not 0.30000000000000004 — this value is written
  // into the project file and read back to the user.
  assert.equal(value('0.1+0.2'), 0.3);
  assert.equal(roundFloat(0.1 + 0.2), 0.3);
});

test('empty input clears the parameter', () => {
  assert.deepEqual(evaluateNumberInput('', 5), { kind: 'clear' });
  assert.deepEqual(evaluateNumberInput('   ', 5), { kind: 'clear' });
});

test('non-numeric input is rejected, never executed', () => {
  for (const bad of ['abc', 'alert(1)', '1;2', '${x}', '1e3', 'NaN', 'Infinity', '0x10', '1,000']) {
    assert.equal(evaluateNumberInput(bad, 0).kind, 'invalid', `should reject ${bad}`);
  }
});

test('malformed arithmetic is rejected', () => {
  for (const bad of ['1+', '*', '1*/2', '+', '1 2']) {
    assert.equal(evaluateNumberInput(bad, 10).kind, 'invalid', `should reject ${bad}`);
  }
});

test('a doubled sign is a sign, consistently in both positions', () => {
  // `+-5` on the current value subtracts, so `1++2` must likewise read the second
  // operator as the sign of its operand rather than as a parse error.
  assert.equal(value('1++2'), 3);
  assert.equal(value('1--2'), 3);
  assert.equal(value('3*-2'), -6);
});

test('division by zero is rejected rather than producing Infinity', () => {
  assert.equal(evaluateNumberInput('10/0', 0).kind, 'invalid');
  assert.equal(evaluateNumberInput('/0', 10).kind, 'invalid');
});

test('relative scaling of an unset value is refused, but + treats it as zero', () => {
  assert.equal(evaluateNumberInput('*2', undefined).kind, 'invalid');
  assert.equal(evaluateNumberInput('/2', undefined).kind, 'invalid');
  assert.equal(value('+5', undefined), 5);
});

test('nudge steps', () => {
  assert.equal(nudgeStep({}), 1);
  assert.equal(nudgeStep({ shiftKey: true }), 10);
  assert.equal(nudgeStep({ altKey: true }), 0.1);
  // Shift wins when both are held; coarse is the more deliberate gesture.
  assert.equal(nudgeStep({ shiftKey: true, altKey: true }), 10);
});

test('nudge from a value and from nothing', () => {
  assert.equal(nudgeValue(10, 1), 11);
  assert.equal(nudgeValue(10, -1), 9);
  assert.equal(nudgeValue(10, 1, { shiftKey: true }), 20);
  assert.equal(nudgeValue(undefined, 1), 1);
  assert.equal(nudgeValue(NaN, -1), -1);
  // 0.1 steps must not accumulate float dust.
  assert.equal(nudgeValue(0.2, 1, { altKey: true }), 0.3);
});

test('splitValueUnit', () => {
  assert.deepEqual(splitValueUnit('12px'), { value: 12, unit: 'px' });
  assert.deepEqual(splitValueUnit('100%'), { value: 100, unit: '%' });
  assert.deepEqual(splitValueUnit('12'), { value: 12, unit: '' });
  assert.deepEqual(splitValueUnit('-1.5em'), { value: -1.5, unit: 'em' });
  assert.deepEqual(splitValueUnit('auto'), { value: null, unit: '' });
  assert.deepEqual(splitValueUnit(''), { value: null, unit: '' });
});

// --- added after live testing caught the passthrough boundary ---
import { isPlainNumberLiteral } from '../../src/editor/src/views/panels/propertyeditor/inspector/model/numberEdit';

test('a leading + is never "plain", so it reaches the evaluator', () => {
  // The first version allowed [+-]? here. `+5` therefore skipped the arithmetic layer
  // entirely and the legacy parser read it as the literal 5 — a 12px gap typed `+5`
  // became 5px instead of 17px, silently.
  assert.equal(isPlainNumberLiteral('+5'), false);
  assert.equal(isPlainNumberLiteral(' +5 '), false);
  assert.equal(isPlainNumberLiteral('*2'), false);
  assert.equal(isPlainNumberLiteral('/2'), false);
  assert.equal(isPlainNumberLiteral('5*4'), false);

  assert.equal(isPlainNumberLiteral('5'), true);
  assert.equal(isPlainNumberLiteral('-5'), true);
  assert.equal(isPlainNumberLiteral('12.5'), true);
  assert.equal(isPlainNumberLiteral('.5'), true);
  assert.equal(isPlainNumberLiteral(' 42 '), true);
  assert.equal(isPlainNumberLiteral(''), false);
  assert.equal(isPlainNumberLiteral('auto'), false);
});

test('every plain literal round-trips through the evaluator unchanged', () => {
  // Whichever path a plain number takes, it must mean the same thing.
  for (const raw of ['5', '-5', '12.5', '.5', ' 42 ']) {
    assert.equal(isPlainNumberLiteral(raw), true);
    assert.equal(value(raw, 99), Number(raw.trim()));
  }
});
