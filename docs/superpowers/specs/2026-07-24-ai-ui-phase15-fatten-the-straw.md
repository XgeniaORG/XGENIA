# AI UI Quality — Phase 1.5 "Fatten the Straw"

Date: 2026-07-24
Status: implemented
Scope: **plugin-side only** (`private/xgenia-ai/`). Ships via `npm run ship`.
Predecessor: `2026-07-24-ai-ui-quality-plumbing-design.md` (Phase 1).

## Problem

The UI sub-agent (`SubAgentDispatcher.generateUIHtml`) runs a top model (default Opus 4.8, vision-capable) but sees the target look **only as a text brief**. Everything the main AI understood is squeezed through the `designBrief` string. Two specific losses:

1. The project **reference image** (`.styles/reference-image.png`, `getProjectBaseStyleUrl()`) is named in text but **never shown** to the sub-agent — a vision model art-directing blind.
2. The user's **verbatim aesthetic words** ("haunted cathedral", "no purple") never reach the sub-agent unless the main AI happens to carry them into the brief.

## Fix

### Part A — attach the reference image (multimodal)

In `generateUIHtml`, after the (now race-safe) style cache warm:
- read `getProjectBaseStyleUrl()`; accept only `data:image/*` or `http(s)://` URLs;
- decide via the pure, unit-tested `SubAgentDispatcher.shouldAttachReferenceImage(url, modelVision, maxBytes)`:
  - skip if no URL,
  - skip if the model is **explicitly** known to lack vision (`modelHasVision === false`; `undefined` still attaches — capability metadata is frequently uncached),
  - skip data URLs over 8 MB (cost/latency guard; external URLs pass, size unknown);
- when attaching, the OpenRouter user message becomes a content array `[{type:'text',text}, {type:'image_url',image_url:{url}}]`, and a `REFERENCE IMAGE` banner tells the model the attached image is the target look (match materials/palette/lighting/mood, don't copy literal content).

Text-only path is unchanged when no image / non-vision model.

### Part B — carry the user's words

`designBrief` schema `.describe()` gains a **QUOTE THE USER** instruction: include the user's exact aesthetic phrasing and never drop a stated constraint, because the specialist sees only this string. Prompt-only; zero runtime cost.

## Testing

- `shouldAttachReferenceImage` pure-function matrix (no URL, data URL under/over cap, external URL, `modelVision` true/false/undefined) in `ui-quality-plumbing.test.ts`.
- Source locks: multimodal `image_url` path present, vision guard present, `QUOTE THE USER` line present.
- Full suite green before ship.

## Out of scope

- Threading the live conversation into the sub-agent (Part B is handled by main-AI guidance, not plumbing).
- The asset-first art stack (Phase 2).
- A main-model-direct "high-craft" UI mode (possible Phase 3).

## Files touched

- `private/xgenia-ai/src/ChatPanel/SubAgentDispatcher.ts` — reference-image read, `shouldAttachReferenceImage`, multimodal message, `REFERENCE IMAGE` banner.
- `private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/creation-tools/create-ui-from-html.ts` — `designBrief` QUOTE THE USER line.
- `private/xgenia-ai-app/tests/ui-quality-plumbing.test.ts` — tests.
