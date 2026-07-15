/**
 * serialize-param-guard.ts — which node parameters the bridge should serialize.
 *
 * WHY (trace 1782150899325): EditorBridge.serializeParameters gated the input-port
 * walk on an ALLOWLIST built from compiled-docs `inputFormatHints`. But those hints
 * are partial — the `Text` type lists {textAlignX, textAlignY, testId} and NOT
 * `text`, and the button lists only {testId}. So the bridge silently DROPPED a
 * node's primary content (`text`, button `label`/styleCss…). That made inspect_node
 * / verify_logic_correctness / the debug export see a Text node with no text and a
 * button with `params: []` — and nearly caused a phantom "empty text" bug report.
 *
 * The allowlist existed only to avoid one real bloat case: on pixi.* nodes a magic
 * `functionScript` getter returns the entire ~98KB node-type definition. So gate on
 * a precise BLOCKLIST of that pseudo-port + a size backstop, instead of an allowlist
 * that throws away every legitimate param.
 */

/**
 * True for a pseudo-port that must never be serialized (it returns the whole
 * node-type def). Genuine JavaScript-function nodes are exempt — their
 * functionScript IS their content and is captured by the JS-specific block.
 */
export function isBloatPort(name: string, isJSFunction: boolean): boolean {
  if (isJSFunction) return false;
  return name === 'functionScript';
}

/**
 * Backstop against any other pathologically-large param value sneaking in
 * (the original bloat concern), independent of port name.
 */
export function isTooLargeToSerialize(value: unknown, maxStringLen = 20000): boolean {
  return typeof value === 'string' && value.length > maxStringLen;
}

/**
 * Flatten an editor-model `{value, unit}` dimension wrap to what the runtime
 * actually sees, WITHOUT losing the unit.
 *
 * Traces 1784010250453 / 1784051747260 (the "width: 100" phantom): collapsing
 * every {value, unit} to the bare number made {value:100, unit:'%'},
 * {value:100, unit:'vw'} and {value:100, unit:'px'} all read back as 100. The
 * AI-side unit doctrine says a bare Group dimension is PIXELS, so the AI
 * mis-read healthy responsive dims as 100px, "fixed" them to "100%", read back
 * 100 again, and looped on phantom "my width isn't persisting" bugs.
 *
 * Rules (unit set MUST stay identical to the xgenia-ai twin
 * preserveDimensionUnit in StreamlinedToolRegistry/utils/coerce-dim.ts — see
 * regression-lock/unwrap-value-unit.test.ts, which locks both):
 *   - object/array-typed ports → return the wrap untouched ({value, unit}
 *     could be a genuine user value there, not dimension storage)
 *   - responsive units (%, vh, vw, em, rem) → joined CSS string ("100vw") —
 *     the runtime-effective value on HTML dimension ports. "100%" does NOT
 *     trip verify_logic_correctness CHECK 24 (malformed_dimension_param); that
 *     check flags only the raw {value, unit} OBJECT form.
 *   - px / unitless / exotic units (deg, vmin, …) → bare number. Exotic units
 *     stay numeric on purpose: operation-verification's string parser only
 *     knows px|%|em|rem|vw|vh, so a "45deg" readback would mis-compare and
 *     spawn new VERIFICATION_FAILEDs.
 *   - non-numeric value / anything that isn't a {value, unit} wrap → unchanged
 */
export function unwrapValueUnit(val: any, portType: string): any {
  if (val && typeof val === 'object' && !Array.isArray(val) &&
      val.value !== undefined && val.unit !== undefined) {
    if (portType === 'object' || portType === 'array') return val;
    const num = typeof val.value === 'number' ? val.value : parseFloat(String(val.value));
    if (!isFinite(num)) return val; // garbage in → keep as-is
    const unit = String(val.unit || '').trim();
    const responsive = unit === '%' || unit === 'vh' || unit === 'vw' || unit === 'em' || unit === 'rem';
    return responsive ? `${num}${unit}` : num;
  }
  return val;
}
