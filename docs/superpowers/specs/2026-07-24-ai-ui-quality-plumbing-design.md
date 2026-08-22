# AI UI Quality — Phase 1 "Stop Starving the Prompt"

Date: 2026-07-24
Status: approved design, pre-implementation
Scope: **plugin-side only** (`private/xgenia-ai/`, `private/xgenia-ai-app/`). No editor-package changes, no editor rebuild. Ships via `npm run ship`.

## Problem

AI-generated game UIs read as "AI-ugly" (floating stickers on a flat gradient, microscopic title on a 4K preview, weak borders). Diagnosis from debug export `1784900887290`, then grounded against real source.

**Key correction to the earlier iframe-blind diagnosis:** the UI sub-agent prompt is NOT thin. `UI_HTML_SYSTEM_PROMPT` (`SubAgentDispatcher.ts:33-455`, ~420 lines) plus the `CREATIVE MANDATE` (`buildThemeBanner`, `SubAgentDispatcher.ts:954-978`) already instruct "world-class game-UI art director, NOT a template filler," prescribe materials (carved wood, gilt metal), per-theme fonts, and forbid the dark-glass default.

The disease is **the pipeline silently starves and degrades that good prompt.** Five confirmed leaks, all code-located. This spec fixes the four that are plugin-side. (The fifth — the lossy HTML→node translator in `packages/xgenia-editor/.../html-translator.ts` — is editor-package / rebuild-gated and out of Phase 1 scope.)

## The four fixes

### Fix 1 — Style-cache race (style banner silently empty)

**Bug.** `warmStyleCache()` in `private/xgenia-ai-app/src/shims/editor-views.ts:194-209` sets `_cacheWarmed = true` synchronously (line 198) but populates `_globalStylePrompt` only inside the async `.then()` (line 204). The first read via `getProjectGlobalStylePrompt()` (216-219) returns `''`; because `_cacheWarmed` is already `true`, later calls never re-warm within the racing window. On a fresh session where UI generation is the first thing touching style, `projectStyleBanner` (`SubAgentDispatcher.ts:643-657`) is built empty and `hasStyle` (`set-project-base-style.ts:40`) reports `false` despite a style being set.

**Fix.** Add an awaitable warm to the shim:

```ts
export async function ensureStyleCacheWarmed(): Promise<void>
```

It reads all three bridge values (`getBaseUrl`, `getPrompt`, `getPalettes`) with `Promise.allSettled`, assigns the caches, and sets `_cacheWarmed = true` **only after** they resolve. `warmStyleCache()` stays for sync callers but delegates its promise bookkeeping to the same populate step so the two cannot disagree.

Await `ensureStyleCacheWarmed()`:
- at the top of `SubAgentDispatcher.generateUIHtml` (before the banner block at 643), and
- in the `project_style` tool handler (`set-project-base-style.ts`) before it computes `hasStyle`.

Sync getters then return real values. Blast radius: one new shim function + two await sites.

**Verify.** Real-output: fresh session, set a project style, immediately build a UI, assert `projectStyleBanner` is non-empty in the sub-agent request AND the rendered UI uses the palette. Unit: `ensureStyleCacheWarmed()` resolves populated values on first call.

### Fix 2 — Font never collapses to Times/10px

**Gap.** No validation that a named `font-family` (e.g. `Cinzel`) actually loads. The pipeline builds a Google-Fonts `<link>` from the name (`HTMLUICreationTool.ts:140-165`, `load-font.ts` `buildGoogleFontLinkTag`) and trusts it. A 404 or unloaded face silently falls back to the browser default at the authored (often 10px) size → hierarchy collapse. Grep confirmed **no** `validateFont`/`GOOGLE_FONTS`/`fontExists` anywhere.

**Fix (keep creative freedom — no hard reject).**
1. Curated `GOOGLE_FONTS` allow-set covering every family the prompt suggests plus common display/body fonts.
2. Post-generate normalization step (plugin-side, on the HTML before translation) guarantees **every** `font-family` declaration ends in a themed, linked fallback and a generic family — never a bare single name. `font-family:"Cinzel"` → `font-family:"Cinzel","Playfair Display",serif`. Themed fallback chosen by brief category (serif for classic/casino, display-sans for arcade, etc.).
3. Unknown family (not in allow-set) → keep it (user may have loaded it) but emit a warning back to the model and force the fallback tail so it can never be the whole stack.
4. Post-build audit runs `document.fonts.check()` per named face and warns on any unloaded (informational).

**Verify.** Real-output: build a UI naming a nonexistent font; assert the rendered title still uses a themed fallback at the intended size, not the browser default. Unit: normalization always yields a stack of length ≥ 2 ending in a generic family.

### Fix 3 — Type-scale-to-viewport audit (kills microscopic-title-on-4K)

**Gap.** Root is forced `100vw/100vh` (`SubAgentDispatcher.ts:600`) but text stays authored px. On a 4K preview a 24px title is a tiny stamp; 10px labels are invisible. Nothing measures rendered scale.

**Fix.** New post-build **scale audit** inside `runCreatePipeline` (`create-ui-from-html.ts`), right after the auto-screenshot block (597-644), before the return at 646:
1. `execute_code` on the live DOM: collect bounding rects for the title, SPIN/primary CTA, and stat labels + the viewport size.
2. If title width < ~18% of viewport width, or the primary CTA is not the largest control, or any label font-size < a legibility floor → compute concrete px targets **from the measured viewport** and `smart_set` the node params (font size, button size). Concrete px sidesteps the translator's weak `vh`/`clamp` support.
3. Add a hard prompt line to `UI_HTML_SYSTEM_PROMPT`: "title font-size targets ~4% of viewport height; the SPIN/primary action is the single largest control."

Belt (prompt) + suspenders (measured auto-bump). Audit failure must never fail the creation (same contract as the screenshot block).

**Verify.** Real-output: build on a large viewport; assert measured title width ≥ threshold after the audit and that the primary CTA is the largest interactive rect.

### Fix 4 — Refine gate on by default

**Gap.** `refinePasses` defaults to `0` (`create-ui-from-html.ts:739-745`); the screenshot design-read is explicitly "never a blocker." So by default nothing acts on a generic/flat result.

**Fix.** Flip default `0 → 1`. Consolidate the post-build work into one **quality stage**: screenshot design-read → scale-audit auto-bump (Fix 3) → if still flagged generic/flat/off-theme, one refine regenerate (existing block ~1039-1098). Keep it a **single** pass (cost + loop guard). Strengthen the flag regex so the auto-pass reliably fires. Cost: +1 sub-agent pass per build — accepted tradeoff for quality.

**Verify.** Real-output: build a deliberately generic brief; assert the refine pass fires and the second render scores better on the design-read. Regression: existing `design-guidance-lock.test.ts` still passes.

## Phase 2 — Art stack (sketch, separate spec after Phase 1 verified)

Pre-UI stage generates a **coherent** cabinet set — background scene, reel frame (nine-slice-able), meter bezels, spin medallion — all seeded from the **one** project base-style image (one lighting direction, one line weight) for cross-asset consistency. Written to `assets/`, surfaced in `assetsBanner`, and the prompt requires the shell to place them (background under root, frame around `@ReelArea`). This is the "slot cabinet, not gradient + stickers" ceiling. Full design deferred until Phase 1 is verified in real output.

## Implementation approach

Build the four fixes in parallel (independent files), then an **adversarial verify** stage that drives real UI builds and inspects rendered output — no fix is "done" on unit tests alone. Fix 1 (style race) and Fix 2 (font collapse) especially require real-render proof.

Test runner: live vitest suite in `private/xgenia-ai-app` (per repo convention). Ship via `npm run ship`.

## Out of scope (Phase 1)

- The editor-package HTML→node translator (`html-translator.ts`) — lossy but rebuild-gated.
- Any new image-generation orchestration (that is Phase 2).
- Changing the sub-agent model selection.

## Appendix — second-pass trace findings (1784900887290) triage

The in-editor AI's second inspection pass surfaced 18 findings. Triage against this program:

**Absorbed into Phase 1 (this spec):**
- #4 font fraud (Cinzel 900 faked from 700 / weights unloaded) → Fix 2 extended: the css2 API rejects the whole request when any weight is missing; hardcoded `wght@300-700` silently killed fonts without a 300 (Cinzel) and capped titles at 700. Now: accurate `GOOGLE_FONT_WEIGHTS` map per known family, bare link for unknowns.
- #10/#16/#18 px-on-4K, mount-size blindness, editor-canvas desync → Fix 3 (the post-mount rect audit is exactly the missing step named in #10).
- #13 wireframe accepted as final → Fix 4 (refine default ON).
- #12 style side-channel → Fix 1 (the read-path race; style IS injected when the cache is warm).
- #1 currency soup (1000 / €100 / $0.00) → new prompt law: HUD NUMBER FORMAT.
- #6 full-bleed stat slabs + hairline borders → new prompt law: METERS ARE PILLS, NOT SLABS.
- #14 tone break ("Cartoon Romania") → new prompt law: COPY REGISTER.

**Phase 2 (art stack) — confirmed by:** #3 zero image nodes, #7 naked PIXI in a letterboxed hole, #11 symbol collage without a bible, #15 DOM/PIXI split visual language, #17 no craft components.

**Separate track (wiring/completion, not UI generation):** #2 balance never wired to @BalanceText (parent-agent completion failure — belongs with the slot-doctrine verify gates), #9 white App chassis (page assembly), #5 hover vocabulary (bounded by the editor-package translator's simple `:hover` support), #8 double canvas (editor-preview artifact, not product).

## Files touched (expected)

- `private/xgenia-ai-app/src/shims/editor-views.ts` — Fix 1 (`ensureStyleCacheWarmed`).
- `private/xgenia-ai/src/ChatPanel/SubAgentDispatcher.ts` — Fix 1 await, Fix 2 font normalization, Fix 3 prompt line.
- `private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/image-editing/set-project-base-style.ts` — Fix 1 await before `hasStyle`.
- `private/xgenia-ai/src/ChatPanel/xml/HTMLUICreationTool.ts` or a new font helper — Fix 2 normalization.
- `private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/creation-tools/create-ui-from-html.ts` — Fix 3 scale audit, Fix 4 default flip.
- Tests under `private/xgenia-ai-app/tests/`.
