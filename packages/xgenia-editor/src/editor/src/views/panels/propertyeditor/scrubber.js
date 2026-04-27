/**
 * Scrubber — drag-to-adjust numeric values on property labels
 *
 * Hover a property label to see the ew-resize cursor.
 * Drag left/right to decrease/increase the value.
 *
 * Modifier keys:
 *   Shift  → ×10 (coarse)
 *   Alt    → ×0.1 (fine)
 *
 * Clicking without dragging focuses the text input for manual entry.
 */

const DRAG_THRESHOLD = 3; // px before we commit to a drag

/**
 * Attach scrubber behavior to a label + input pair.
 *
 * @param {HTMLElement}  labelEl   The <label> element (drag handle)
 * @param {HTMLElement}  inputEl   The <input> element (value target)
 * @param {object}       callbacks
 * @param {function(number, boolean):void} callbacks.onChange
 *        Called with (newValue, isFinal).
 *        isFinal=false during drag (skip undo), isFinal=true on mouse-up (commit undo).
 * @param {object}       [options]
 * @param {number}       [options.step=1]      Base step per pixel
 * @param {number}       [options.precision]    Decimal places to round to (auto-detected if omitted)
 */
export function attachScrubber(labelEl, inputEl, callbacks, options = {}) {
    const step = options.step ?? 1;

    let isDragging = false;
    let startX = 0;
    let startValue = 0;
    let accumulatedDelta = 0;
    let hasMoved = false;

    function getMultiplier(e) {
        if (e.shiftKey) return 10;
        if (e.altKey) return 0.1;
        return 1;
    }

    function parseValue() {
        const raw = $(inputEl).val();
        const num = parseFloat(raw);
        return isNaN(num) ? 0 : num;
    }

    function roundSmart(value, mult) {
        // Determine precision based on the effective step
        const effectiveStep = step * mult;
        if (effectiveStep >= 1) return Math.round(value);
        const decimals = Math.max(0, Math.ceil(-Math.log10(effectiveStep)));
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    function onMouseDown(e) {
        if (e.button !== 0) return; // left click only
        e.preventDefault();

        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startValue = parseValue();
        accumulatedDelta = 0;

        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseup', onMouseUp, true);

        // Hide cursor globally during drag
        document.body.style.cursor = 'ew-resize';
    }

    function onMouseMove(e) {
        if (!isDragging) return;

        const dx = e.clientX - startX;

        if (!hasMoved && Math.abs(dx) < DRAG_THRESHOLD) return;
        hasMoved = true;

        const mult = getMultiplier(e);
        const newValue = roundSmart(startValue + dx * step * mult, mult);

        // Update the input display
        $(inputEl).val(newValue);

        // Fire intermediate change (no undo)
        callbacks.onChange(newValue, false);
    }

    function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
        document.body.style.cursor = '';

        if (!isDragging) return;
        isDragging = false;

        if (hasMoved) {
            // Commit final value with undo
            const finalValue = parseValue();
            callbacks.onChange(finalValue, true);
        } else {
            // Click without drag → focus the input for manual typing
            $(inputEl).focus().select();
        }
    }

    // Attach
    labelEl.classList.add('scrubber-label');
    labelEl.addEventListener('mousedown', onMouseDown);

    // Return a dispose function
    return function dispose() {
        labelEl.classList.remove('scrubber-label');
        labelEl.removeEventListener('mousedown', onMouseDown);
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
    };
}
