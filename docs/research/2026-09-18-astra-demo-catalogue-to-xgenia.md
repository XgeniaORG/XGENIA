# What the awesome-gpt-6-astra catalogue teaches, and what to add to XGENIA

Date: 2026-09-18. Companion to `2026-09-18-3d-game-design-and-animation-gap-analysis.md`.
Source: https://github.com/magiccreator-ai/awesome-gpt-6-astra (171 entries: 48 games, 23 Blender/3D, 51 web apps, 15 video, 13 drawing, 21 other). Community-maintained, not OpenAI.

## 1. What the catalogue actually is

- **Mostly recorded demos, not products.** Roughly 40 have live links; ~12 have source. The maintainers flag most as "not independently reproduced".
- **Three tech shapes recur:** (a) three.js in the browser (single-file or Vite), (b) Astra scripting Blender headless via `bpy`, (c) Astra driving desktop apps by computer use (Unity, UE5, Godot, Aseprite, After Effects, KiCad).
- **Asset generation is always external:** Meshy, Tripo, GPT Image 2.5, FLUX.2, Sprite Fusion, Seedance, ElevenLabs. Astra glues; it never emits a mesh or a sprite.
- **Half the list is irrelevant to XGENIA:** CAD, PCB, robotics, video editing, dashboards, portfolios.

## 2. The twelve patterns that map onto XGENIA

### P1. 3D → pre-rendered sprite frames (Heroes III Necropolis remaster) — the best-documented recipe in the whole catalogue
Source: 28-post series, https://yzh119.github.io/series/enhancing-heroes-iii-with-generative-ai/

| Stage | Tool | Detail |
|---|---|---|
| Concept | FLUX.2 [pro] | front view, A-pose, alpha-cropped (19% of a 1024×1440 canvas) |
| Mesh | Meshy image-to-3D | quad topology, remeshed to 20k, textured; 37.5k verts, 30 credits |
| Rig | Meshy starter rig + local repair; later Astra-built Blender armature | 24-bone humanoid, Mixamo bone names; wrist/ankle error 0.000039 units |
| Animate | Blender, AI-assisted keyframes | 13 groups, 82 frames per scale (idle 8, attacks 8, hit 6, death 6, hover/defence 11) |
| Render | Blender **orthographic**, body + shadow + outline passes | canvas 450×400, creature 79 px tall, foot anchor y=267 |
| Validate | custom scripts | canvas consistency, anchor/ground-line drift, layer completeness, frame-count LOD |
| Cost | | "under two dollars per creature, roughly $280 for all 150" |

Lessons the author paid for:
- **Ratios, not adjectives.** "Broad and low" changed the pose; "fits a box 1.3× as tall as wide" changed only the bounding box. 14/14 concepts passed the 15% band after the switch, 8/14 before.
- **Calibrate the camera by measurement.** Render a probe frame, measure its alpha bbox, correct. Two phases, because rescaling moves the feet.
- **Validators must be run against known-good data first.** His anchor-drift check flagged eight of the *original* game's sprites. "The original skeleton isn't broken. My thresholds were." Replaced pass/fail with reported measurements.
- **The validator passed two real errors**: inherited frame counts (caught by a `--lod` count diff) and a zombie that strode like a skeleton (leg travel 335 px vs 53). "The motion is the character" needs eyes.
- **Every stage writes JSON metadata** (task id, params, cost) for traceability.
- Heroes III's creatures were pre-rendered from 3D originally: "Going 3D is a return to the original method." Same is true of most premium slot symbols.

**XGENIA mapping (Horizon 0):** this is the `model` tool + offscreen renderer described in the gap analysis, with the contract made explicit:
- Replace Blender with an offscreen three.js renderer in the editor (orthographic camera, body/shadow/outline passes as separate PNG layers).
- The sprite contract is the **symbol cell**: canvas = cell box, anchor = cell centre (or foot line for characters), scale from a measured probe frame, not from prompt adjectives.
- Prompt template for mesh generation carries ratios (`height:width`, `symbol fills 0.8 of cell`) drawn from the existing `ui_layout_map` measurements.
- Validators report measurements (bbox drift per frame, occupancy %, frame count vs spec) into the existing findings channel; `capture_motion` stays the human-eyes step for "motion is the character".
- Per-asset JSON lineage already exists in `.xgenia-assets.json`; add `model` → `clip` → `sheet` links.

### P2. Holographic 3D cards (holo-card-studio, a Codex *skill*)
Source: https://github.com/EverettFish/holo-card-studio. Text or reference image → four layer PNGs (text, lineart, subject, background) → parallax stack (subject scale 1.25 / depth 0.4, background depth −0.25) → iridescent ribbon shader + Voronoi starlight, identical UV maths in Blender and three.js → interactive viewer, `card.blend`, optional GLB.

**XGENIA mapping (Horizon 0, no 3D runtime):** the `image` tool already has `split` (layer separation). Add a `pixi.HoloCard` node: layered sprites with pointer/gyro parallax and an iridescence filter (pixi v8 `Filter`). Product use: foil wilds, scatter symbols, card-game faces, "premium symbol" tier in the art loop. The recipe ships as a skill file in the agent's `skill` tool, exactly as holo-card-studio does.

### P3. Shader-driven UI juice (Directional Sticker Peel, Three.js Interface Studies, Cursor-Tracking Studio Footer, Clouds in Motion, Verdant Forest)
These are code, not assets: a fragment/vertex shader the model wrote.
**XGENIA mapping (Horizon 0):** `pixi.ShaderFilter` node whose parameter is an AI-written GLSL body against a frozen uniform set (`uTime`, `uPointer`, `uResolution`, `uTex`), validated like the particle-swarm sandbox. Gives "wow" without any 3D dependency.

### P4. One-shot single-file three.js games (Mosswing: 21 min, Melon Lab)
Source: https://github.com/Ayi1337/gpt6-astra-one-shot-games. Output is one 700 KB `index.html` with three.js inlined. The prompt is the interesting artefact:
> "One index.html, opens and plays instantly, no external assets (CDN libraries are allowed; your call). Keep the core exactly as everyone remembers it… Everything else is yours to decide… I won't answer clarifying questions. I'm judging a complete, elegant, great-feeling piece of work — not a feature list. Small and finished beats big and rough."

**XGENIA mapping (Horizon 1):** the `three.Script` node is the in-graph equivalent: the model writes the whole scene body against a stable API (scene, camera, THREE, assets, time, signal ports in/out). Adopt the brief format for XGENIA's run prompts: fixed core, open aesthetics, no clarifying questions, "small and finished".
Quick win to test appetite: an `HTMLEmbed` leaf node (sandboxed iframe + postMessage bridge to signals) would let a one-shot three.js game sit inside a project today. It is an escape hatch, not the product, because it bypasses RGS/maths nodes.

### P5. Blender-built GLB games with verify loops (Gogh Strike)
Source: https://github.com/petergpt/gogh-strike (three 0.170, no bundler, MIT). Twelve character GLBs built by `blender --background --python tools/build-character-heads.py`, an optimiser that de-duplicates shared textures, a render manifest that hashes served source + GLBs, and portraits rendered *from the game's own models* by an `agent-browser` script with `--finalize` that validates every capture before replacing shipped art. First load: **36 MB**. `npm test` (node) plus mandated "browser play-tests… and the actual visual result".

**XGENIA mapping:** (a) paytable icons and lobby thumbnails rendered from the same GLB as the animated symbol, so 2D UI art and 3D art never drift; (b) render manifests with hashes belong in asset lineage; (c) 36 MB is the cautionary number: enforce the deploy budget and per-asset caps before any 3D ships.

### P6. Astra-built games ship with batteries of deterministic verify scripts (Jelly Baby)
Source: https://github.com/scottstts/Jelly-Baby (three ^0.185, WebGPU, custom soft-body, GPL-3.0). `package.json` lists ~35 `verify-*` scripts: physics, swing, collision broadphase/hierarchy, lighting, caustics, render warm-up, multitouch, orientation, deformation, performance, benchmark.
**XGENIA mapping (Horizon 1):** the runtime-acceptance-oracle spec (2026-09-14) is the same idea. For 3D add oracle checks: scene bounds inside camera frustum, no NaN transforms, draw-call and triangle budget, first-frame time, GLB byte size, clip names present.

### P7. Image → Tripo/Meshy GLB → rig → clips → engine (Astra-Rigged Three.js Character, Scorpid, Tripo multipart rigging, Arena Zero 109 clips)
All four report "several feedback rounds", "supervision and a custom app still required", "converted with a custom tool". Confirms the pipeline and its friction.
**XGENIA mapping:** Meshy rig + preset clips via fal (`fal-ai/meshy/rigging/multi-animation`) is the no-Blender path; expect rig repair loops, so the `model` tool needs `inspect` (bone list, clip list, bounds) and `capture_motion` review before a clip is accepted.

### P8. Game → trailer, scene → video model (From Game to Trailer, Clay-to-Seedance, Blender→Seedance, Otter stop motion)
Camera-matched render → Seedance 2.5 → promo video. Otter: 99 character-consistent frames from GPT Image 2.5, assembled to stop motion.
**XGENIA mapping (Horizon 0):** the `video` tool already targets Seedance 2.0 fast and MiniMax on fal. A `trailer` recipe: `capture_motion` frames of the built slot → image-to-video with start/end frames → 10 s promo. Operators buy promo assets; nobody else in the slot-tooling space generates them from the built game.

### P9. Interactive part viewers (Model X Studio exploded view, V8 engine, Microduck 70 parts, Orbital Core GLB)
GLB + orbit + part isolation + labels.
**XGENIA mapping (Horizon 1):** `three.Model` + `three.Orbit` + pick events; Hunyuan3D `/part` segmentation supplies parts. Product use: pick-a-prize bonus rounds, the Assets panel's 3D inspector.

### P10. Procedural 3D worlds by code (Seoul/Hangzhou atlas from OSM, ABYSSAL underwater, Afterlight robot streets, Sunwake water)
No asset generation at all; three.js code with custom shaders.
**XGENIA mapping (Horizon 1):** `three.Script` again. Crash-game backdrops (rocket over a procedural city, day-night cycle) are this pattern.

### P11. 3D tabletop and card games (Catan three.js with AI opponents, Balatro Web, Toy2Game)
Toy2Game's stack is the reference for "3D table game in a browser": React + three.js + **cannon-es** + **boardgame.io** + GSAP + Vite, six games, Playwright E2E, static hosting. Custom non-commercial licence, so learn from it, do not copy.
**XGENIA mapping (Horizon 2):** ETG roulette/dice/blackjack tables. XGENIA already has GSAP; physics is the missing piece (Rapier or cannon-es behind a `three.Physics` node).

### P12. MCP as the agent integration surface (Blender MCP for geometry-nodes water, Ableton MCP, Higgsfield MCP)
**XGENIA mapping:** XGENIA already ships `add_mcp_server`, `use_mcp_tool`, `create_mcp_tool_node`. A documented recipe for the community Blender MCP (ahujasid/blender-mcp) gives a power path for retopo, baking and turntables when Blender is installed locally, without XGENIA shipping Blender. Optional, Horizon 2.

## 3. Ranked additions

| # | Addition | Pattern | Runtime change | Effort | Value |
|---|---|---|---|---|---|
| 1 | `model` tool (create/rig/inspect) + offscreen three.js `render_sprites` with cell-anchor contract, ratio prompts, measurement validators | P1, P7 | none (editor-side) | 1–2 wk | consistent multi-angle animated symbols in every existing slot |
| 2 | `pixi.HoloCard` node + `holo_card` skill using `image.split` | P2 | pixi node | 3–5 d | premium wild/scatter tier |
| 3 | `pixi.ShaderFilter` node (sandboxed GLSL) | P3 | pixi node | 3–5 d | UI juice, backgrounds |
| 4 | `trailer` recipe on the existing `video` tool | P8 | none | 2–3 d | promo assets per game |
| 5 | Same-GLB paytable icons + render manifests in lineage; deploy size budget on | P5 | build config | 2–3 d | consistency, no 36 MB surprises |
| 6 | `three.Stage` + `three.Model/Camera/Light/Env/AnimationPlayer/Orbit` | P7, P9 | new leaf | 3–5 wk | live 3D |
| 7 | `three.Script` node + one-shot brief format for prompts | P4, P10 | with #6 | 1 wk | the Astra lever |
| 8 | 3D oracle checks (bounds, budgets, clips) | P6 | tests | 1 wk | trust |
| 9 | `three.Physics` (Rapier/cannon-es) + tabletop kit | P11 | new | 3–4 wk | ETG |
| 10 | Blender MCP recipe | P12 | none | 2 d | power users |

Items 1–5 need no 3D runtime and could ship before any `three.*` node exists.

## 4. Things the catalogue warns about
- Prompts that describe pose change pose. Measure, then constrain by numbers.
- A validator that has never been run on known-good art measures your assumptions.
- Frame counts and motion amplitude do not transfer between characters; the validator will not notice.
- Asset weight: 36 MB first loads, 500k-face GLBs. Decimate at generation, cap at import.
- Licences: Toy2Game is non-commercial; Jelly Baby is GPL-3.0; Gogh Strike is MIT. Read before lifting code.
- Most entries are recordings. Live, source-available, reproducible ones: Gogh Strike, Jelly Baby, Toy2Game, holo-card-studio, one-shot-games, Bubble Wrap Simulator, Magic Carpet Wizard, Last Beacon, VEYRA.
