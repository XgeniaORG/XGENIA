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

/** Unit metadata off the port's declared type, when the caller has it. */
export interface PortUnitInfo {
  /** `type.units` — the engine's OWN discriminator for a unit-bearing port. */
  units?: string[];
  /** `type.defaultUnit` — what a value with no unit means on THIS port. */
  defaultUnit?: string;
}

/** The engine's dimension defaultUnit when the port metadata never reached us. */
const DIMENSION_FALLBACK_UNIT = '%';

/**
 * Pull the unit metadata off a live editor port descriptor.
 *
 * The engine's own discriminator is `input.type.units` (react-component-node.js
 * defineRegularInputProp), so read it from the same place rather than guessing
 * from the type NAME — `minWidth` is declared `{ name:'number', units:[…],
 * defaultUnit:'%' }` while a pixi `width` is declared `type:'number'` with no
 * units at all. Keying on the name would put both in the same bucket.
 */
export function portUnitInfo(port: any): PortUnitInfo | undefined {
  const t = port?.type;
  if (!t || typeof t !== 'object') return undefined;
  const units = Array.isArray(t.units) ? t.units : undefined;
  const defaultUnit = typeof t.defaultUnit === 'string' ? t.defaultUnit : undefined;
  if (!units && !defaultUnit) return undefined;
  return { units, defaultUnit };
}

/**
 * True when this port stores a `{value, unit}` dimension — i.e. when the runtime
 * takes the `input.type.units` branch of defineRegularInputProp.
 */
function isUnitPort(portType: string, info?: PortUnitInfo): boolean {
  if (portType === 'object' || portType === 'array') return false;
  if (info && Array.isArray(info.units) && info.units.length > 0) return true;
  if (info && typeof info.defaultUnit === 'string' && info.defaultUnit) return true;
  // `dimension` is only ever declared WITH units, so the name alone is proof.
  return portType === 'dimension';
}

/**
 * Render an editor-model dimension as the AI must see it: ALWAYS carrying its unit.
 *
 * WHY (debug export 1786550989048, the "100% / 90px" trace). One get_app_xml
 * document emitted four encodings of the same port family — `100%`, `90px`,
 * `480` (pixels) and `100` (percent). `480` and `100` are the same token with
 * opposite meanings, so the AI could not tell a 480px frame from a 100% one, and
 * a pure read→write round-trip silently converted a 100%-wide Text into a
 * 100px-wide one.
 *
 * Two producers put bare numbers in front of the AI, and this function was one:
 *   1. the px branch below collapsed {value:480, unit:'px'} to 480;
 *   2. an UNSET port reads back as its raw declared default — `100` — with the
 *      defaultUnit still sitting in the port TYPE, never applied to the value.
 *
 * ENGINE TRUTH — node-shared-port-definitions.js addDimensions (~line 598):
 *     width: { type: { name:'dimension', units:['%','px','vw','vh'],
 *                      defaultUnit:'%' }, default: 100 }
 * and react-component-node.js:358 (defineRegularInputProp):
 *     if (input.type.units) { … props[name] = value.value + value.unit;
 *                             else delete props[name] }
 * So on a unit-bearing port `{value, unit}` is the ONLY shape the runtime can
 * apply, the declared default `100` carries defaultUnit `'%'`, and a bare number
 * means neither px nor % — it DELETES the prop.
 *
 * Rules (kept identical to the xgenia-ai twin preserveDimensionUnit in
 * StreamlinedToolRegistry/utils/coerce-dim.ts — regression-lock/
 * dimension-default-unit.test.ts locks both):
 *   - object/array-typed ports → untouched ({value, unit} could be a genuine
 *     user value there, not dimension storage)
 *   - UNIT-BEARING ports (type.units present, or type name `dimension`):
 *       {value, unit} → joined CSS string, px included ("480px", "100%")
 *       bare finite number → joined with the port's defaultUnit ("100%")
 *     Never a bare number. That is the whole invariant.
 *   - ports with NO units (pixi.* `type:'number'`, plain numbers) → legacy
 *     behaviour: unwrap a stray {value, unit} to the bare number PIXI needs.
 *   - non-numeric value / anything that isn't a dimension → unchanged
 *
 * The joined string does not trip verify_logic_correctness CHECK 24
 * (malformed_dimension_param); that check flags the raw {value, unit} OBJECT.
 */
/**
 * The unit to append when a value carries none.
 *
 * (2026-08-18, trace 1787027583089 — QA BUG 5) `info?.defaultUnit || DIMENSION_FALLBACK_UNIT`
 * cannot tell a port that DECLARES itself unitless ('') from one with no metadata at all,
 * because '' is falsy. lineHeight is declared `units: ['', 'px', '%'], defaultUnit: ''` — CSS
 * line-height: 2 means two times the font size — so a correct `lineHeight: 2` was serialised
 * to the AI as "2%" while the live CSS said `line-height: 2`. An AI that "fixes" the 2%
 * breaks working text.
 *
 * Kept rule-for-rule identical to the xgenia-ai twin fallbackUnitFor in
 * StreamlinedToolRegistry/utils/coerce-dim.ts.
 */
function fallbackUnitFor(info?: PortUnitInfo): string {
  if (info && typeof info.defaultUnit === 'string') return info.defaultUnit; // '' means BARE
  return DIMENSION_FALLBACK_UNIT;
}

export function unwrapValueUnit(val: any, portType: string, info?: PortUnitInfo): any {
  const unitPort = isUnitPort(portType, info);

  if (val && typeof val === 'object' && !Array.isArray(val) &&
      val.value !== undefined && val.unit !== undefined) {
    if (portType === 'object' || portType === 'array') return val;
    const num = typeof val.value === 'number' ? val.value : parseFloat(String(val.value));
    if (!isFinite(num)) return val; // garbage in → keep as-is
    const unit = String(val.unit || '').trim();
    if (unitPort) return unit ? `${num}${unit}` : `${num}${fallbackUnitFor(info)}`;
    // Non-unit port (pixi number): keep the historical unwrap. Responsive units
    // still join, because a "%"-carrying value on a number port is a bug the AI
    // must be able to SEE rather than a pixel count.
    const responsive = unit === '%' || unit === 'vh' || unit === 'vw' || unit === 'em' || unit === 'rem';
    return responsive ? `${num}${unit}` : num;
  }

  // A BARE value on a unit-bearing port: this is the port default (or a legacy
  // un-normalised write). Resolve it against the port's defaultUnit so the AI
  // never receives a number whose unit it has to guess.
  if (unitPort && typeof val === 'number' && isFinite(val)) {
    const u = fallbackUnitFor(info);
    // A port DECLARED unitless renders BARE — that is what unitless means.
    return u ? `${val}${u}` : val;
  }

  return val;
}
