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
