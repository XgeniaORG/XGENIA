# UI Quality Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the verified root causes of samey/ugly AI-generated UIs: silent style dropping (runtime styleCss parser, translator, Columns node), the imagery/interaction straitjacket on the UI sub-agent, the blind/correctness-only visual feedback loop, and the design-free system prompt — each with a mechanical test lock.

**Architecture:** Four independent workstreams by directory ownership: (A) engine runtime (`packages/xgenia-viewer-react` + `private/xgenia-pro-nodes`), (B) editor translator + capture (`packages/xgenia-editor`), (C) ChatPanel tools (`private/xgenia-ai`), (D) server prompt (`private/supabase`). One cross-area contract: the translator returns a warnings report that the bridge exposes as `translationWarnings: string[]` and the ChatPanel tool surfaces to the model. All tests live in the live suite at `private/xgenia-ai-app/tests/` (vitest imports cross-package, see existing `html-translator-solid-bg.test.ts`).

**Tech Stack:** TypeScript (translator, ChatPanel), plain JS (viewer-react/pro-nodes, babel-built), vitest (xgenia-ai-app), zod schemas for tools.

## Global Constraints

- NEVER `git push`. Never add a Claude co-author trailer. Commit messages: short plain summaries.
- Test runner: `cd private/xgenia-ai-app && npm test` (use `--no-file-parallelism` under load).
- `private/` is ONE git submodule and runs DETACHED: after committing inside it run `git checkout -B main HEAD`.
- Engine/translator changes need an editor rebuild (`npm run build:editor:_viewer` at repo root after `private/xgenia-pro-nodes && npm run build`) + Electron restart — Vercel ship does NOT make them live.
- ChatPanel changes go live only via `cd private/xgenia-ai-app && npm run ship` (never deploy:vercel).
- Tool failures must carry a real `code` (NOT_FOUND, UNAVAILABLE, …) — an uncoded `success:false` gets mislabeled INTERNAL.
- No false verdicts: never report success over a dropped/broken state; that doctrine drove this whole plan.
- Aesthetic signals are INFORMATIONAL only — never a blocker/gate (stage-grid false-positive lesson).
- If prompt text states a node/port fact, add an assertion to `prompt-port-claims-vs-authority.test.ts`.
- Port truth authority: compiled-node-docs (grep `search-index.json` / node source), not memory.

## File Map

| Area | Files |
|---|---|
| A | `private/xgenia-pro-nodes/src/utils/react-component-node.js`, `packages/xgenia-viewer-react/src/nodes/node-shared-port-definitions.js`, `packages/xgenia-viewer-react/src/nodes/visual/columns.js` |
| B | `packages/xgenia-editor/src/editor/src/views/EditorTopbar/html-translator.ts`, the bridge handler that calls it (in `packages/xgenia-editor/src/editor/src/**/ChatPanelBridge/EditorBridge.ts`), `packages/xgenia-editor/src/editor/src/views/VisualCanvas/CanvasView.ts`, `packages/xgenia-editor/src/frames/viewer-frame/src/views/viewer.js` |
| C | `private/xgenia-ai/src/ChatPanel/SubAgentDispatcher.ts`, `HTMLDesignTemplates.ts`, `StreamlinedToolRegistry/tools/creation-tools/create-ui-from-html.ts`, `create-ui-from-xml.ts`, `StreamlinedToolRegistry/tools/ui-tools/take-screenshot.ts`, `xml/HTMLUICreationTool.ts` |
| D | `private/supabase/functions/ai-chat/system-prompt.ts` |
| Tests | NEW files in `private/xgenia-ai-app/tests/`: `stylecss-parser.test.ts`, `html-translator-quality.test.ts`, `design-guidance-lock.test.ts`, `sim/ui-warning-channel.sim.test.ts` |

---

### Task A1: Tolerant styleCss parser (runtime)

**Files:**
- Modify: `private/xgenia-pro-nodes/src/utils/react-component-node.js` (~:577-614, `updateAdvancedStyle` / the css split logic)
- Test: `private/xgenia-ai-app/tests/stylecss-parser.test.ts` (new)

**Interfaces:**
- Produces: named export `parseStyleCssDeclarations(css: string) -> { style: Object, errors: string[] }` from `react-component-node.js` (pure function, no `this`), used by the class method and by tests.

**Current verified code:** `const styles = css.split(';')…` then per-declaration `const parts = s.split(':')` with `parts.length !== 2` → `errorMessage += 'Syntax error'`, and `if (errorMessage) { sendWarning } else { style && this.setStyle(style) }` — one bad/complex declaration (any value containing `;` or a second `:`, e.g. `url(data:image/png;base64,…)`) discards the ENTIRE style block.

- [ ] **Step 1: Write the failing test** — `stylecss-parser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
// pro-nodes is plain JS; import the source directly
import { parseStyleCssDeclarations } from '../../xgenia-pro-nodes/src/utils/react-component-node.js';

describe('styleCss tolerant parser', () => {
  it('survives data-URI values (semicolon inside url())', () => {
    const { style, errors } = parseStyleCssDeclarations(
      'background-image: url(data:image/png;base64,iVBORw==); border-radius: 8px;');
    expect(style.backgroundImage).toBe('url(data:image/png;base64,iVBORw==)');
    expect(style.borderRadius).toBe('8px');
    expect(errors).toEqual([]);
  });
  it('splits on the FIRST colon only (https URLs)', () => {
    const { style, errors } = parseStyleCssDeclarations('background: url(https://x/y.png)');
    expect(style.background).toBe('url(https://x/y.png)');
    expect(errors).toEqual([]);
  });
  it('applies good declarations even when one is bad', () => {
    const { style, errors } = parseStyleCssDeclarations('nonsense; color: red;');
    expect(style.color).toBe('red');
    expect(errors.length).toBe(1);
  });
  it('camelCases hyphenated properties', () => {
    const { style } = parseStyleCssDeclarations('box-shadow: 0 2px 8px rgba(0,0,0,0.4)');
    expect(style.boxShadow).toBe('0 2px 8px rgba(0,0,0,0.4)');
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd private/xgenia-ai-app && npx vitest run tests/stylecss-parser.test.ts` → FAIL (export missing).
- [ ] **Step 3: Implement.** In `react-component-node.js`, add the pure function + rewire the method:

```js
// Tolerant CSS declaration parser: paren-aware ';' split, first-':' split,
// applies every valid declaration and reports (not swallows) the bad ones.
export function parseStyleCssDeclarations(css) {
  const style = {}; const errors = [];
  const decls = []; let depth = 0; let cur = '';
  for (const ch of String(css || '')) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) decls.push(cur);
  for (const raw of decls) {
    const s = raw.trim();
    if (!s) continue;
    const idx = s.indexOf(':');
    if (idx <= 0) { errors.push(`Invalid declaration: "${s.slice(0, 60)}"`); continue; }
    const prop = s.slice(0, idx).trim();
    const value = s.slice(idx + 1).trim();
    if (!prop || !value) { errors.push(`Invalid declaration: "${s.slice(0, 60)}"`); continue; }
    const camel = prop.startsWith('--') ? prop : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[camel] = value;
  }
  return { style, errors };
}
```

Keep the existing method's warning plumbing but change semantics: `const { style, errors } = parseStyleCssDeclarations(css);` → always `this.setStyle(style)` when any keys exist; `sendWarning` with the joined `errors` when non-empty (warning text: `styleCss: N declaration(s) skipped: …`). Preserve any existing camelCase/vendor handling the method had — if the method already converts, reuse `parseStyleCssDeclarations` as the single source (DRY).
- [ ] **Step 4: Run tests** → PASS. Also `cd private/xgenia-pro-nodes && npm run build` → no babel errors (this file must stay ES-module-compatible with the existing build; match the file's current export style — if it uses CommonJS, use `module.exports.parseStyleCssDeclarations` and adapt the test import accordingly).
- [ ] **Step 5: Commit** (in `private/`): `styleCss parser: tolerant per-declaration parsing, stop discarding whole block`

### Task A2: Google fonts load real weights

**Files:**
- Modify: `packages/xgenia-viewer-react/src/nodes/node-shared-port-definitions.js` (~:1300-1302 and ~:1443-1444)

**Current verified code:** both sites call `FontLoader.instance.loadGoogleFont(family)` with no weights → webfontloader fetches only weight 400 → faux-bold everywhere.

- [ ] **Step 1:** Add near the top of the file: `const DEFAULT_GOOGLE_FONT_WEIGHTS = '400,500,600,700,800,900';` and change BOTH call sites to `loadGoogleFont(family, DEFAULT_GOOGLE_FONT_WEIGHTS)`. Verify `fontloader.js` builds `family + ':' + weights` (verified: it does).
- [ ] **Step 2:** Grep for other `loadGoogleFont(` call sites in viewer-react and update any weightless ones.
- [ ] **Step 3: Commit** (parent repo): `load full Google font weight range in viewer (was 400-only faux bold)`

### Task A3: Columns node gets a real style surface

**Files:**
- Modify: `packages/xgenia-viewer-react/src/nodes/visual/columns.js`
- Test: assertions inside `private/xgenia-ai-app/tests/html-translator-quality.test.ts` (Task B2 file; add a `columns style ports` describe here if importable, otherwise verify via node source grep test)

**Current verified state:** `columns.js:50-154` defines only layout inputs; no `NodeSharedPortDefinitions` style helpers, no `frame` → translator-written `backgroundColor/borderRadius/padding*/width/height/opacity` are silently dropped by `node.js:88-90`.

- [ ] **Step 1:** Read `packages/xgenia-viewer-react/src/nodes/visual/group.js` to see exactly which helpers wire style ports → DOM style (e.g. `NodeSharedPortDefinitions.addSharedVisualInputs(node)`, `addBorderInputs`, `addShadowInputs`, `addPaddingInputs`, `addDimensions`, `addMarginInputs`) and how the React component consumes them (style/frame props).
- [ ] **Step 2:** Apply the same helpers to the Columns node definition so it accepts: backgroundColor, border* (width/color/style, per-corner radius), boxShadow*, padding*, width/height, opacity. Confirm the Columns React component passes the computed `style` to its root element (follow the Group pattern; if `createNodeFromReactComponent` needs a `frame`/style option, set it the way Group-like nodes do).
- [ ] **Step 3:** Manual check: `node -e` smoke or unit-level: instantiate is overkill — instead add to the quality test (Task B2): translated `<div style="display:grid; grid-template-columns: 1fr 1fr; background:#123456; border-radius:12px; padding:16px">…` must emit `<columns … backgroundColor="#123456"` (translator already writes these attrs — the fix is that the runtime now honors them; the test locks the XML side, the port existence is locked by grepping columns.js in the same test file via `readFileSync` asserting `backgroundColor` appears in the node's input definitions).
- [ ] **Step 4: Commit** (parent repo): `Columns node: real style surface (bg, border, radius, shadow, padding, dims)`

### Task B1: Translator warning channel end-to-end

**Files:**
- Modify: `packages/xgenia-editor/src/editor/src/views/EditorTopbar/html-translator.ts`
- Modify: the editor bridge handler that calls `translateHtmlToXgeniaXml` (locate with `grep -rn "translateHtmlToXgeniaXml" packages/xgenia-editor/src` — expected in ChatPanelBridge/EditorBridge.ts around :442)
- Test: `private/xgenia-ai-app/tests/html-translator-quality.test.ts` (new, shared with B2-B4)

**Interfaces:**
- Produces: `export function translateHtmlToXgeniaXmlWithReport(html: string): { xml: string; warnings: string[] }`. Existing `translateHtmlToXgeniaXml(html)` keeps its signature, delegating to the new function and returning `.xml`.
- Bridge response for the HTML→UI creation call gains `translationWarnings: string[]` (already-formatted, deduped, max 40 entries). Task C3 consumes this exact field name.

- [ ] **Step 1: Failing tests** (in the new quality test file):

```ts
import { translateHtmlToXgeniaXml, translateHtmlToXgeniaXmlWithReport } from '../../../packages/xgenia-editor/src/editor/src/views/EditorTopbar/html-translator';

describe('warning channel', () => {
  it('reports dropped hover variants instead of silence', () => {
    const { warnings } = translateHtmlToXgeniaXmlWithReport('<button class="brightness-125">x</button>');
    expect(warnings.some(w => /brightness/.test(w))).toBe(true);
  });
  it('back-compat: string API unchanged', () => {
    expect(typeof translateHtmlToXgeniaXml('<div></div>')).toBe('string');
  });
});
```

- [ ] **Step 2:** Implement a module-scoped collector: `let _warnings: string[] = [];` + `function reportDrop(msg: string) { if (_warnings.length < 200) _warnings.push(msg); }`. `translateHtmlToXgeniaXmlWithReport` resets it, runs the existing translation, returns `{ xml, warnings: [...new Set(_warnings)].slice(0, 40) }`.
- [ ] **Step 3:** Instrument every verified silent-drop site with `reportDrop(...)` — minimum set: unsupported Tailwind class skips that remain after B2/B3 (the `continue` sites ~:299-335), the inline-style switch `default:` (after B2 routes unknown *visual* props to styleCss, still report true drops), `<style>` class-rule properties not extracted (~:3043-3079), skipped icon spans (~:3260-3275), nulled `<canvas>`/`<iframe>`, media-query content, `var(--…)` values. Message format: `"dropped: <what> (<where>, e.g. class 'hover:bg-red-500' on <button 'Spin'>)"` — keep each under ~120 chars.
- [ ] **Step 4:** Bridge: change the handler to use `WithReport` and include `translationWarnings` in its response object alongside whatever it returns today (verify the response shape by reading the handler; do not break existing fields).
- [ ] **Step 5:** Run the new tests + full existing translator suite: `npx vitest run tests/html-translator-solid-bg.test.ts tests/html-translator-quality.test.ts` → all PASS.
- [ ] **Step 6: Commit** (parent): `html-translator: warning channel — report every dropped style/element to caller`

### Task B2: Translator fidelity fixes (silent-drop class)

**Files:**
- Modify: `packages/xgenia-editor/src/editor/src/views/EditorTopbar/html-translator.ts`
- Test: `private/xgenia-ai-app/tests/html-translator-quality.test.ts`

All sites verified in the audit. Consult port truth (compiled-node-docs / viewer-react node source) before choosing native-port vs styleCss routing.

- [ ] **Step 1: Failing tests:**

```ts
describe('unit-aware parsing', () => {
  it('padding: 1.5rem → 24px, not 1px', () => {
    const xml = translateHtmlToXgeniaXml('<div style="padding: 1.5rem;">x</div>');
    expect(xml).toMatch(/paddingTop="24/);
  });
  it('border-radius: 50% stays a circle (styleCss fallback, not 50px)', () => {
    const xml = translateHtmlToXgeniaXml('<div style="width:64px;height:64px;border-radius:50%;"></div>');
    expect(xml).toMatch(/border-radius:\s*50%/); // in styleCss
    expect(xml).not.toMatch(/borderRadius="50"/);
  });
  it('gap: 1rem → 16', () => {
    expect(translateHtmlToXgeniaXml('<div style="display:flex;gap:1rem;"></div>')).toMatch(/gap="16/);
  });
});
describe('margin shorthand', () => {
  it('margin: 12px 0 maps to per-side margin ports', () => {
    const xml = translateHtmlToXgeniaXml('<div style="margin: 12px 0;">x</div>');
    expect(xml).toMatch(/marginTop="12/);
  });
});
describe('border-style', () => {
  it('dashed borders survive', () => {
    const xml = translateHtmlToXgeniaXml('<div style="border: 2px dashed #fff;"></div>');
    expect(xml).toMatch(/borderStyle="dashed"/);
  });
});
describe('background-image div', () => {
  it('keeps its children (Group with background, not self-closing img)', () => {
    const xml = translateHtmlToXgeniaXml(
      '<div style="background-image:url(assets/bg.png);"><h1>Title</h1><button>Go</button></div>');
    expect(xml).toMatch(/Title/); expect(xml).toMatch(/<button|<text/);
    expect(xml).not.toMatch(/<img[^>]*bg\.png[^>]*\/>\s*$/m);
  });
});
describe('bg-[url()] tailwind', () => {
  it('routes to background image, not backgroundColor', () => {
    const xml = translateHtmlToXgeniaXml('<div class="bg-[url(assets/hero.png)]"></div>');
    expect(xml).not.toMatch(/backgroundColor="url/);
  });
});
describe('grid proportions', () => {
  it('grid-template-columns: 2fr 1fr → layoutString "2 1"', () => {
    const xml = translateHtmlToXgeniaXml(
      '<div style="display:grid;grid-template-columns:2fr 1fr;"><div>a</div><div>b</div></div>');
    expect(xml).toMatch(/layoutString="2 1"/);
  });
});
describe('unknown visual props forward to styleCss', () => {
  it('filter: saturate(1.4) is not dropped', () => {
    const xml = translateHtmlToXgeniaXml('<div style="filter: saturate(1.4);"></div>');
    expect(xml).toMatch(/saturate\(1\.4\)/);
  });
});
```

- [ ] **Step 2: Implement, per verified site:**
  - Add helper `cssLenToPx(value: string): number | null` — handles `px`, `rem`/`em` (×16), bare numbers; returns null for `%`/`vw`/`vh`/`calc`. Replace the raw `parseInt` at the padding shorthand (~:1730), `gap` (~:1678), `border-radius` shorthand (~:1863) and audit siblings in the same switch for the same bug. `%` radius → route whole declaration to styleCss instead.
  - `margin` case (~:1770-1773): parse 1-4 value shorthand exactly like padding, emit per-side margin ports (confirm exact port names `marginTop`… from Group's margin inputs in node-shared-port-definitions).
  - `border-style` (~:1913-1916): engine supports solid/dashed/dotted (verified) — set `styles.borderStyle` and emit it; delete the dead duplicate `case 'border-style'` at ~:2053; the emitter (~:4305) uses `styles.borderStyle || 'solid'`.
  - background-image div (~:3224-3240): when the element HAS children, emit a `<group backgroundImage="…">` (verify Group's background-image port name in node source; if none, styleCss `background-image:…;background-size:cover;background-position:center`) and translate children normally. Keep the img emission only for childless elements.
  - `bg-[url(...)]` (~:907-917): divert `url(` arbitrary values to the same background-image handling, never `backgroundColor`.
  - grid tracks (~:1636-1646): store the raw track list; when emitting `<columns>` (~:3925-3927) build `layoutString` from `fr` ratios (strip `fr`, integer-normalize e.g. `2fr 1fr` → `"2 1"`); non-fr tracks fall back to current behavior.
  - inline-style switch `default:` (~:2163-2166): forward `prop: value` to `styles.styleCss` for any property NOT in a small explicit no-op list (`cursor`, `user-select`, `pointer-events`, `white-space`, `-webkit-font-smoothing`, `text-rendering`); everything else must either hit a native port or styleCss — never vanish. Filter/transition/brightness/saturate Tailwind classes (~:1334-1424 neighborhood): add passthrough to styleCss `filter:`/`transition:` instead of `continue`.
- [ ] **Step 3:** Run full translator suite (old 33 + new) → PASS. Fix regressions, not tests (old tests are locks).
- [ ] **Step 4: Commit** (parent): `html-translator: unit-aware parsing, margins, dashed borders, bg-image keeps children, grid ratios, styleCss forward-by-default`

### Task B3: Hover/interaction states via CSS Definition

**Files:**
- Modify: `html-translator.ts` (~:299-305 hover-variant skip; ~:2323 class-rule regex; css-definition emission area ~:3097-3141)
- Test: `html-translator-quality.test.ts`

- [ ] **Step 1: Failing tests:**

```ts
describe('hover states', () => {
  it('Tailwind hover:brightness-110 becomes a css-definition :hover rule + class', () => {
    const xml = translateHtmlToXgeniaXml('<button class="bg-red-500 hover:brightness-110">Spin</button>');
    expect(xml).toMatch(/css-definition/);
    expect(xml).toMatch(/:hover/);
    expect(xml).toMatch(/cssClassName="/);
  });
  it('<style> .btn:hover rules survive', () => {
    const xml = translateHtmlToXgeniaXml(
      '<style>.btn{background:#333;} .btn:hover{background:#555;}</style><button class="btn">Go</button>');
    expect(xml).toMatch(/:hover/);
  });
});
```

- [ ] **Step 2:** Implement:
  - Hover variants: instead of `continue`, parse the inner class with the existing Tailwind parser into CSS declarations, accumulate per-element `hoverCss`; when non-empty, emit/reuse a `css-definition` node with `.xg-hov-<n>:hover { … ; transition: all 120ms ease; }` and append `xg-hov-<n>` to the element's `cssClassName`. Follow the existing gradient-text css-definition emission pattern (~:3097-3141) for how css-definition nodes + classes are wired. Support `hover:` first; `focus:`/`active:` same mechanism if trivial, else reportDrop them.
  - `<style>` rules: extend `extractCssClassStyles` regex to also capture `\.([\w-]+):(hover|focus|active)\s*\{([^}]+)\}` and route those whole rules into the css-definition channel verbatim (they're already valid CSS).
- [ ] **Step 3:** Run suite → PASS.
- [ ] **Step 4: Commit** (parent): `html-translator: hover/focus/active states via css-definition classes`

### Task B4: Luminance-aware text color default

**Files:** `html-translator.ts` (~:4108-4111) — **Test:** quality test file.

- [ ] **Step 1: Failing test:**

```ts
describe('text color default', () => {
  it('dark text on a light background (no more invisible white-on-white)', () => {
    const xml = translateHtmlToXgeniaXml('<div style="background:#f5f5f5;"><p>hello</p></div>');
    const m = xml.match(/<text[^>]*color="([^"]+)"/);
    expect(m && m[1].toLowerCase()).not.toBe('#ffffff');
  });
  it('keeps white default on dark background', () => {
    const xml = translateHtmlToXgeniaXml('<div style="background:#111122;"><p>hello</p></div>');
    expect(xml).toMatch(/color="#FFFFFF"/i);
  });
});
```

- [ ] **Step 2:** Track effective background down the recursion (nearest ancestor with a resolvable solid `backgroundColor`; hex `#rgb/#rrggbb` and `rgb()` forms only). At the text-emit default site: `luminance > 0.6 → '#1A1A1A'` else `'#FFFFFF'` (relative luminance `0.2126R+0.7152G+0.0722B` on 0-1 scale). Unknown/gradient/alpha backgrounds keep `#FFFFFF`.
- [ ] **Step 3:** Suite PASS. **Step 4: Commit** (parent): `html-translator: luminance-aware default text color`

### Task B5: Screenshot capture resolution 400px → 1024px

**Files:**
- Modify: `packages/xgenia-editor/src/editor/src/views/VisualCanvas/CanvasView.ts` (~:1320-1331)
- Modify: `packages/xgenia-editor/src/frames/viewer-frame/src/views/viewer.js` (~:133-145)

- [ ] **Step 1:** CanvasView thumb path: change short-side 400 → 1024 (same aspect math, `400`→`1024`).
- [ ] **Step 2:** Floating-viewer path: replace the fixed `canvas.width = 400; canvas.height = 250` with aspect-preserving sizing from the source image, max width 1024 (`const scale = Math.min(1, 1024 / image.width); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);`), JPEG quality 0.7 → 0.8.
- [ ] **Step 3: Commit** (parent): `screenshot capture: 1024px aspect-true thumbs (was 400px / distorted 400x250)`

### Task C1: Unshackle the UI sub-agent

**Files:**
- Modify: `private/xgenia-ai/src/ChatPanel/SubAgentDispatcher.ts` (FORBIDDEN list ~:353-361, icon rule ~:430, element budget ~:309-316, max_tokens ~:910, userContent assembly ~:884-886)
- Test: `private/xgenia-ai-app/tests/design-guidance-lock.test.ts` (new)

- [ ] **Step 1: Failing lock tests:**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
const dispatcher = readFileSync(join(__dirname, '../../xgenia-ai/src/ChatPanel/SubAgentDispatcher.ts'), 'utf8');

describe('sub-agent design freedom locks', () => {
  it('no longer bans project-asset imagery', () => {
    expect(dispatcher).toMatch(/assets\//); // prompt must mention assets/ referencing
    expect(dispatcher).not.toMatch(/background-image: url\(\.\.\.\) for external image URLs — they won't load/);
  });
  it('no longer bans hover pseudo-classes (translator now supports them)', () => {
    expect(dispatcher).not.toMatch(/Pseudo-classes for visual effect \(:hover/);
  });
  it('output budget raised', () => {
    expect(dispatcher).toMatch(/8000/); // base max_tokens
  });
});
```

- [ ] **Step 2:** Implement prompt/config edits:
  - FORBIDDEN list rewrite: ALLOW `hover:`/`focus:` Tailwind variants and `.cls:hover` style rules ("they become css-definition hover classes"); ALLOW `background-image`/`<img>` with **project-relative `assets/` paths** and small `data:` URIs; KEEP bans on external `http(s)` image URLs (hallucination 404s), `::before/::after`, `@media`. Keyframes: keep the current claim conservative (runtime tick unverified) — allow `@keyframes` in `<style>` "persisted via headCode; treat as progressive enhancement, never structural".
  - Asset inventory: in `generateUIHtml`, before building `userContent`, attempt a cheap project-asset listing (find the existing mechanism used by the assets tooling — grep `unified-assets`/EditorProxy fs listing; cap 40 entries, image extensions only). Inject as `assetsBanner`: `PROJECT ASSETS you may use via <img src="assets/…"> or background-image: <list>` — silently omitted if listing unavailable (iframe-safe, wrap in try/catch, no throw).
  - Budgets: base `max_tokens` 4000 → 8000 (grid formula: `detectedGridCells > 40 ? Math.min(16000, 8000 + (detectedGridCells - 40) * 90) : 8000`, reasoning headroom unchanged). Element budget: full-screen stays 120 in the banner; fix the system-prompt 60 → 120 contradiction (one number, both places); decorative-div ban → "max 10 decorative-only elements, each must earn its place".
- [ ] **Step 3:** Tests pass. **Step 4: Commit** (private): `UI sub-agent: allow project imagery + hover states, bigger output budget, asset inventory banner`

### Task C2: HTMLDesignTemplates — kill the house style

**Files:** `private/xgenia-ai/src/ChatPanel/HTMLDesignTemplates.ts` — **Test:** `design-guidance-lock.test.ts`.

- [ ] **Step 1: Failing lock test:**

```ts
const templates = readFileSync(join(__dirname, '../../xgenia-ai/src/ChatPanel/HTMLDesignTemplates.ts'), 'utf8');
it('glassmorphism is not the sole recipe', () => {
  // must name at least 4 distinct visual systems
  const systems = ['glass', 'flat', 'skeuo', 'retro', 'editorial', 'neon', 'paper', 'brutal'];
  expect(systems.filter(s => new RegExp(s, 'i').test(templates)).length).toBeGreaterThanOrEqual(4);
});
```

- [ ] **Step 2:** Rewrite `HTML_TEMPLATE_GUIDANCE`: replace the glassmorphism/glow/pill recipe family with a **visual-system menu** (6+ distinct directions, each 2-3 lines: e.g. flat-vector cartoon, retro pixel/CRT, skeuomorphic wood/metal/felt, editorial serif luxury, neon cyberpunk, paper/hand-drawn, brutalist bold-type, glass — glass allowed but explicitly "one option of many, never the default") + a hard rule: "pick ONE system from the brief's theme; composition must differ per game (not recolored layouts)". Keep the technical constraints section (what renders) — update it to match B2/B3 reality. Delete the retired dead template exports if truly unreferenced (grep first).
- [ ] **Step 3:** Tests pass. **Step 4: Commit** (private): `design guidance: visual-system menu replaces glass-pill house recipe`

### Task C3: Surface translation warnings + auto-screenshot after UI creation

**Files:**
- Modify: `private/xgenia-ai/src/ChatPanel/xml/HTMLUICreationTool.ts` (success message ~:286) and/or `create-ui-from-html.ts` result assembly
- Test: `private/xgenia-ai-app/tests/sim/ui-warning-channel.sim.test.ts` (new, follow existing `tests/sim/*.sim.test.ts` fake-editor pattern)

**Interfaces:** Consumes bridge field `translationWarnings: string[]` (Task B1).

- [ ] **Step 1: Failing sim test:** fake editor bridge returns `translationWarnings: ['dropped: class hover:x on <button>']` from the create call; assert the tool result message contains `STYLES DROPPED` and the warning text, and that `success` stays true (informational, not failure).
- [ ] **Step 2:** Implement: read `translationWarnings` off the bridge response wherever the create result is assembled; when non-empty append to the message: `⚠ STYLES DROPPED (N): <first 10, one per line> — the render will differ from your HTML here; restyle with supported properties or accept the loss.` No warnings → no section. Never flip success.
- [ ] **Step 3:** Auto-screenshot: after successful creation+mount in `create-ui-from-html.ts`, replicate the `simulate-signal.ts` ~:1508 auto-capture pattern: call the take_screenshot handler internally (respect its cooldown), attach `response.screenshot = { captured, analysis }` — analysis TEXT only, never base64, in the tool result. Wrap in try/catch; capture failure must not fail the creation (append `screenshot: unavailable (<reason>)`).
- [ ] **Step 4:** Sim tests + full suite pass. **Step 5: Commit** (private): `create_ui_from_html: surface dropped-style warnings + auto-screenshot with analysis`

### Task C4: take_screenshot — design read + fidelity

**Files:** `private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/ui-tools/take-screenshot.ts` (schema ~:94-97, compress ~:22, ~:173), `SubAgentDispatcher.ts` VISION_SYSTEM_PROMPT (~:12-20) — **Test:** `design-guidance-lock.test.ts`.

- [ ] **Step 1: Failing lock tests:** schema exposes `question` (grep the zod schema text for `question:`); VISION_SYSTEM_PROMPT contains a `DESIGN READ` section.
- [ ] **Step 2:** Implement:
  - Schema: add `question: z.string().optional()` with description "Optional: a specific question for the vision analyst (e.g. 'does this look premium and on-theme, or generic?')" (handler already reads `params.question` at ~:187).
  - Compression: `maxWidth 768 → 1024`, `quality 0.6 → 0.75`.
  - VISION_SYSTEM_PROMPT: keep the factual-description + breakage contract EXACTLY as-is, then append a clearly separated section: `DESIGN READ (subjective, informational — never a blocker): 2-4 sentences on palette (name the actual colors you see), typography, visual hierarchy, theme fit, and whether the design looks distinctive or like a generic template. If it looks generic/flat/default, say so plainly.` Do NOT add aesthetic patterns to the CONCERN_PATTERNS breakage scanner (false-positive-gate lesson).
- [ ] **Step 3:** Tests pass. **Step 4: Commit** (private): `take_screenshot: 1024px q0.75, question param exposed, vision design read`

### Task C5: uiModel silent-skip becomes loud

**Files:** `SubAgentDispatcher.ts` (~:800-803) and the create-ui-from-html result path.

- [ ] **Step 1:** Read the skip branch. Change: when no `uiModel` is configured, still generate — use the configured MAIN model with the FULL `UI_HTML_SYSTEM_PROMPT` (same call plumbing; if the main provider isn't reachable from the dispatcher, keep the skip) — and in ALL no-uiModel cases prepend to the tool result: `NOTE code:UI_MODEL_NOT_CONFIGURED — UI specialist model not set (Settings → AI): design quality is reduced.` Never silently degrade.
- [ ] **Step 2: Commit** (private): `no silent sub-agent skip: full design prompt on fallback + loud notice`

### Task C6: Truth-fix styleCss overclaim

**Files:** `create-ui-from-xml.ts` (~:119). 

- [ ] **Step 1:** Replace "styleCss … always applies" with: "styleCss is a universal port on every visual node; invalid declarations are skipped and reported as warnings (they do not kill the rest of the block)." (True after A1.)
- [ ] **Step 2: Commit** (private): `create_ui_from_xml docs: accurate styleCss semantics`

### Task D1: Always-on design doctrine in the system prompt

**Files:** `private/supabase/functions/ai-chat/system-prompt.ts` (add section after the phase definitions ~:217; extend the Phase-6 polish table ~:205-213) — **Test:** `design-guidance-lock.test.ts` greps the prompt file for the section header.

- [ ] **Step 1: Failing lock test:** prompt file contains `DESIGN & VISUAL CRAFT`.
- [ ] **Step 2:** Add a compact (~30 line) section — exact content:

```
## DESIGN & VISUAL CRAFT (applies to every visual deliverable)
Working software that looks generic is HALF-DONE. Visual quality is part of correctness for game UIs.
- BEFORE the first create_ui_from_html call: derive a visual identity FROM THE THEME — 4-6 named
  colors, 2 fonts (display + body), and ONE visual system (flat-vector / retro-pixel / skeuomorphic /
  editorial / neon / paper / glass / brutalist — pick what fits, never default to dark glassmorphism).
  Put all of it in the designBrief. A brief without palette+fonts+system is a thin brief.
- The #1 failure mode: every game shipping the same glassy dark HUD with recolored accents.
  Re-theme the CHROME (frame, buttons, panels, typography), not just the symbols.
- AFTER a UI build: take_screenshot and read the DESIGN READ in the analysis. If it says generic,
  flat, or off-theme, do ONE targeted restyle pass (colors/fonts/spacing on existing nodes) before
  moving on. Dropped-style warnings in the tool result tell you exactly what didn't render — fix or
  substitute those properties, don't repeat them.
- Decoration that serves the theme (frame art, background depth, accent ornaments) is part of the
  requested scope for a game UI — it is NOT scope creep. Budget: it must never break wiring or maths.
```

  Polish table: add rows `| Theme-derived palette & fonts (no default dark-glass) |`, `| Hover/pressed feedback on interactive controls |`. B1 gate line (~:82): append "…and the screenshot's design read does not call it generic."
- [ ] **Step 3:** No node/port names are used above (css-definition deliberately not named here) → no prompt-port-claims assertion needed; verify by grepping your added text for node names.
- [ ] **Step 4: Commit** (private): `system prompt: always-on design doctrine + visual polish gates`

### Task E1: Full verification + builds (orchestrator, inline)

- [ ] `cd private/xgenia-ai-app && npm test` — full suite green (load-flake: rerun with `--no-file-parallelism`).
- [ ] `cd private/xgenia-pro-nodes && npm run build` — green.
- [ ] Repo root: `npm run build:editor:_viewer` — green (bundles viewer-react + pro-nodes into the editor's viewer).
- [ ] `cd private/xgenia-ai-app && npm run ship` (deploys Vercel + supabase; verify supabase deploy actually succeeded — ship can print COMPLETE over a failed function deploy; check output for the ai-chat function, re-auth if 403).
- [ ] Commits per workstream done; `private/`: `git checkout -B main HEAD`; parent: commit packages+plan+private-pointer bump on `AICleanup_Fix_2`.
- [ ] Report: Electron restart required for engine/translator/capture changes to go live.

## Self-Review Notes

- Spec coverage: cluster 1 (eyes) → B5+C3+C4; cluster 2 (straitjacket) → C1+C2+C5; cluster 3 (silent drops) → A1-A3+B1-B4+C3+C6; cluster 4 (doctrine) → D1+C2; cluster 5 (mechanical locks) → every task carries a test. Deferred explicitly: ProxyProvider multimodal pass-through, multi-pass critique loop, server-proxy vision for keyless users, state-aware setParameter (engine hover states via css-definition instead).
- Known coupling: C1's FORBIDDEN rewrite depends on B3 (hover) and B2 (assets bg) shipping in the same release — they do (same editor rebuild + ship).
- Type consistency: `translationWarnings: string[]` (B1→C3); `parseStyleCssDeclarations` (A1); `translateHtmlToXgeniaXmlWithReport` (B1→tests).

---

# ROUND 2 (same Global Constraints as above)

### Task R1: ProxyProvider multimodal pass-through (main model sees pixels)
Files: private/xgenia-ai/src/ChatPanel/providers/ProxyProvider.ts (+ read-only: OpenRouterProvider.ts:2756-2781 as the pattern, AIProviderSettings.modelHasVision, supabase ai-chat/index.ts provider branches). Behavior: when a take_screenshot-shaped tool result carries image_data AND the active model is vision-capable AND the server provider branch forwards content arrays, emit a proper multimodal tool/user message (image block + text) instead of flattening; exempt image blocks from PER_RESULT_MAX (truncate text only); replace all PREVIOUS screenshot image blocks with placeholders (mirror OpenRouterProvider); keep text-only behavior for non-vision models (no regression). Verify the edge function branch for each proxy-mode provider accepts content arrays BEFORE enabling it for that provider; when unsure, stay text-only (a 400 poisons the stream — deliberation-stall lesson). Locks: new tests + full recovery/streaming suites green.

### Task R2: In-tool critique pass + vision error-string filter
Files: create-ui-from-html.ts, SubAgentDispatcher.ts. `refinePasses: 0|1` param (default 0, no behavior change): after auto-screenshot, when analysis flags generic/flat/off-theme, run ONE sub-agent improvement call (existingHtml mode) with the critique text. Vision analysis strings starting '[Vision sub-agent error:' never surface as analysis (analysis:null + note). Delete the retired SLOT_UI_THEME_PRESETS dead block (grep zero refs first). Locks: sim/lock tests.

### Task R3: XML fallback de-templating
Files: xml/XMLModificationService.ts (+ create-ui-from-xml.ts docs), ChatPanel-root XMLModificationService.ts (stale duplicate, zero importers — delete after grep), DesignExamples.ts (zero importers — delete after grep; extend tests/removed-helpers.test.ts). Behavior: remove the RANDOM stock-image fill entirely (src-less Image = honest placeholder, no off-theme imagery); neutralize the forced #4299e1/#2d3748 look (keep minimal legibility defaults, drop the branded palette); fix "Default is system blue" docs.

### Task R4: Translator dead-case cleanup + Figma multi-shadow + keyframes trace
Files: packages html-translator.ts (delete dead duplicate case clauses that esbuild warns about — first-case-wins, behavior-neutral, keep suite green), figma-translator.ts (emit shadows 2..N as a styleCss box-shadow list instead of break-at-one), plus a STATIC trace that nothing strips @keyframes between headCode and the preview DOM (report, don't change prompts unless the trace contradicts them).

### Task R5: load_font persistence
Files: load-font.ts, xml/HTMLUICreationTool.ts (export injectCssTextIntoHeadCode + a link-tag variant for reuse). Behavior: after a successful runtime load, persist (google → <link>, file/url → @font-face style block) into project headCode via the hang-proof getHeadCodeAccess path, deduped, so fonts survive preview reload; persist failure = note in result, never a tool failure. Locks: sim test.
