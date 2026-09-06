import { NodeLibrary } from '@xgenia-models/nodelibrary';

import { evaluateNumberInput, isPlainNumberLiteral, nudgeValue, splitValueUnit } from './model/numberEdit';

/**
 * Adds arrow-key nudging and arithmetic to the number fields the legacy templates
 * render, without replacing those editors.
 *
 * Committing goes through a native `change` event rather than by calling the view's
 * handler directly. `View.bindView` wires `data-change` with jQuery's `.on('change')`,
 * which listens for exactly that event, so dispatching it runs the SAME code path a
 * typed-then-blurred edit runs — including whatever unit handling the specific editor
 * does. Calling `onPropertyChanged` by name would have meant knowing which of the
 * three number editors this is, and would drift the moment one of them renames its
 * handler.
 */

/** Port type names whose field holds a number the user can nudge. */
const NUMERIC_TYPE_NAMES = new Set(['number', 'dimension']);

function isNumericView(view: TSFixme): boolean {
  if (!view || view.type === undefined) return false;
  try {
    return NUMERIC_TYPE_NAMES.has(NodeLibrary.nameForPortType(view.type));
  } catch (e) {
    return false;
  }
}

/**
 * The value field, as opposed to the unit dropdown that sits beside it. The unit
 * control is a `div`, not an input, in every template that has one — but it is inside
 * `.property-number-units`, so exclude that subtree rather than relying on tag names.
 */
function findValueInput(host: HTMLElement): HTMLInputElement | null {
  const inputs = host.querySelectorAll('input');
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i] as HTMLInputElement;
    if (input.readOnly) continue;
    if (input.closest('.property-number-units') !== null) continue;
    return input;
  }
  return null;
}

function commit(input: HTMLInputElement, value: number) {
  const caretAtEnd = String(value).length;
  input.value = String(value);
  // The legacy handlers re-read the model and then blur the field. Blurring after
  // every arrow press would make the second press do nothing, so put focus back.
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.focus();
  try {
    input.setSelectionRange(caretAtEnd, caretAtEnd);
  } catch (e) {
    // Some input types refuse selection APIs; the value is already committed.
  }
}

/**
 * The value the model currently holds, which is what a relative expression is
 * relative TO. Reading it off the field instead would be wrong: `splitValueUnit('+5')`
 * happily parses to 5, so `+5` would add five to five rather than to the port's value.
 */
function currentModelValue(view: TSFixme): number | undefined {
  try {
    const current = view.getCurrentValue && view.getCurrentValue();
    let value = current && typeof current === 'object' ? current.value : current;
    // A port with units stores `{ value, unit }`, so the number is one level deeper.
    // Missing this made `+5` on a 12px gap produce 5: the base read as undefined and
    // the expression fell back to adding to zero.
    if (value && typeof value === 'object' && 'value' in value) value = value.value;
    return typeof value === 'number' && isFinite(value) ? value : undefined;
  } catch (e) {
    return undefined;
  }
}

/**
 * Returns a teardown function, or undefined when this view has no numeric field.
 */
export function attachNumberBehaviour(host: HTMLElement, view: TSFixme): (() => void) | undefined {
  if (!isNumericView(view)) return undefined;

  const input = findValueInput(host);
  if (input === null) return undefined;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const current = splitValueUnit(input.value).value;
      // `null` means the field holds something non-numeric ('auto', an expression
      // half-typed); nudging from zero is friendlier than refusing.
      const next = nudgeValue(current === null ? undefined : current, event.key === 'ArrowUp' ? 1 : -1, {
        shiftKey: event.shiftKey,
        altKey: event.altKey
      });
      event.preventDefault();
      commit(input, next);
      return;
    }

    if (event.key === 'Enter') {
      const raw = input.value;
      // A plain number needs no help — let the normal change/blur path handle it so
      // this only ever intercepts input the legacy parser would get wrong.
      if (isPlainNumberLiteral(raw)) return;

      // The model is the authority, but a dynamic port the model has no entry for
      // still shows a number in its field — fall back to that, and only when the
      // text is not itself relative (`+5` would otherwise be its own base).
      let base = currentModelValue(view);
      if (base === undefined && !/^\s*[+*/×÷]/.test(raw)) {
        const parsed = splitValueUnit(raw).value;
        if (parsed !== null) base = parsed;
      }

      const result = evaluateNumberInput(raw, base);
      if (result.kind !== 'value') return;

      event.preventDefault();
      commit(input, result.value);
    }
  };

  input.addEventListener('keydown', onKeyDown);
  return () => input.removeEventListener('keydown', onKeyDown);
}
