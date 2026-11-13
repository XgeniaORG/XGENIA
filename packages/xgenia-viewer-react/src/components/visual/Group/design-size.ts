/**
 * Group's Design Width / Design Height ports.
 *
 * An empty, null, zero or non-numeric value means "not set" (undefined), so clearing the port
 * really clears it. Before this, the setter turned every cleared value into the default
 * (1920 / 1080), and the "inert design size" warning tested `!== undefined` — once anything had
 * been written, nothing short of a remount could clear the warning (an AI spent 60 tool calls
 * trying: null, 0, "", 1920×1080 and source deletes all left it on).
 */
export const DEFAULT_DESIGN_WIDTH = 1920;
export const DEFAULT_DESIGN_HEIGHT = 1080;

export function designSizeValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return isFinite(n) && n > 0 ? n : undefined;
}

/**
 * True when a design size is set to something other than the default while Scale Mode is off —
 * a number the user chose that decides nothing. The default itself is not a choice (every Group
 * is born with it), so it never warns.
 */
export function hasInertDesignSize(
  scaleOn: boolean,
  designWidth: number | undefined,
  designHeight: number | undefined
): boolean {
  if (scaleOn) return false;
  const w = designSizeValue(designWidth);
  const h = designSizeValue(designHeight);
  return (w !== undefined && w !== DEFAULT_DESIGN_WIDTH) || (h !== undefined && h !== DEFAULT_DESIGN_HEIGHT);
}

/**
 * True when a CSS transform string moves the element: some translate/translateX/translateY argument
 * is not zero. Setting Pos X/Y back to 0 writes `translateX(0px)`, and the "Scale Mode AND its own
 * transform" warning used to match the word `translate` — so the fix it asks for could not clear it.
 */
export function hasRealTranslate(transform: unknown): boolean {
  if (typeof transform !== 'string') return false;
  const re = /translate(?:X|Y)?\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transform))) {
    for (const arg of m[1].split(',')) {
      const a = arg.trim();
      if (!a) continue;
      const n = parseFloat(a);
      if (!(isFinite(n) && n === 0 && /^-?0*\.?0*(px|%|em|rem|vw|vh)?$/.test(a))) return true;
    }
  }
  return false;
}
