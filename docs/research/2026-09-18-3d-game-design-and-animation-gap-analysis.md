# 3D game design and animation in XGENIA: gap analysis

Date: 2026-09-18. Status: research, no code. Repo state: `feature/cascade-engine-and-ai-clock` @ `36645df`.

## TL;DR

1. **"Astra 5" is GPT-6 Astra** (OpenAI, GA 2026-09-04). It is a text+image → text model. It generates **no meshes, no video, no 3D output**. Every viral 3D demo is Astra *writing code* (Blender `bpy` headless, three.js/WebGPU, Godot, UE5, Roblox Studio), running it, screenshotting the result, and patching. The wow is an agent loop plus a 3D runtime, not a 3D model.
2. **XGENIA already owns the hard half of that loop**: 186 AI tools, structured eyes (`take_screenshot`, `capture_motion`, `compare_to_keyart`, `ui_layout_map`), a node-graph runtime, fal.ai plumbing, an Assets panel, 2D skeletal animation (Spine), GSAP, particles.
3. **XGENIA has zero 3D.** No three.js/Babylon, no GLB loader, no WebGPU, no 3D asset kind, no 3D node, no 3D tool. The only 3D code in the tree is a regex that *removes* fal's text-to-3D models from the image picker.
4. **The generative-3D models are commodity and already reachable.** Trellis 2 (MIT, $0.25–0.35/gen), Hunyuan3D 3.1 Pro/Rapid, Tripo, Rodin are on fal, which XGENIA already integrates. Meshy sells auto-rig + 697 preset animations at $0.20 + $0.12/clip. World Labs Marble returns collider GLB + textured mesh.
5. **The gap is runtime + asset pipeline + AI grammar, not models.** Three horizons: (0) 3D-sourced 2D sprites into today's pixi engine in days; (1) a `three.Stage` leaf node beside `pixi.Stage` in weeks; (2) 3D-native game kinds (cylinder reels, 3D crash, physics, worlds) in months.

---

## 1. What Astra actually does (and does not)

Source: OpenAI dev blog "How to build games with Astra", Playco case study, model page, community collection `awesome-gpt-6-astra` (171 entries), third-party guides. Full citations in §8.

| Claim | Reality |
|---|---|
| Text → 3D mesh | Astra scripts Blender (`bpy`) headless, renders, inspects the PNG, patches. Output formats are whatever Blender exports. OpenAI ships no 3D output. |
| Playable 3D games | three.js/WebGPU (Fall Guys clone in 2 prompts; "Void Explorer" with Rapier physics + TSL shaders), Godot (3D Sonic in 53 min), UE5 (walkable house; Manhattan), Roblox Studio (kart racer, tweet-only). |
| Edit → play → verify | Playco: Astra edits scenes, plays, screenshots, fixes. "50% fewer manual fixes." This is the loop XGENIA already has. |
| Rigging / animation | Keyframed cameras shown. Body rigs via Blender auto-rig claimed by third parties; "rubbery deformation" flagged. Unproven. |
| 2D sprites / spritesheets | **Weak.** OpenAI's own GBA demo pulled sprites from Sprite Fusion's API; Astra only called it. Reviewers: "difficulty getting it to draw hand-drawn frame-by-frame animation." |
| Interactive world model (Genie-style) | None. |
| Cost | $10/$50 per 1M tokens; ~$167 per completed benchmark task; the 5-day SimCity run cost ~$800–1,000. |
| Criticism | Aesthetic sameness ("flat pastel UI, forest green"), spiky quality, ignores skill rules, geometry glitches, heightfield-only terrain. |

**Implication.** Nothing Astra does in 3D requires Astra. It requires (a) a model that codes well, (b) a 3D runtime the agent can target, (c) eyes, (d) an asset source. XGENIA has (a) via its default models, (c) fully, (d) via fal. It is missing (b) and the plumbing between (b) and (d).

## 2. Where XGENIA stands today (file-cited)

### Renderer
- pixi.js v8 lives only in the viewer: `packages/xgenia-viewer-react/package.json:43`; Spine `@esotericsoftware/spine-pixi-v8` `:16`; GSAP `:24`. The runtime package has no rendering dep (`packages/xgenia-runtime/package.json:11-20`).
- `PIXI.Application` created at `private/xgenia-pro-nodes/src/pixi/components/PixiStage.jsx:151-190`. No `preference` key, so WebGL. No WebGPU anywhere.
- Scene graph is a **DOM tree with the Pixi canvas as one leaf**. Nodes are React components; dirty nodes `forceUpdate()`; the only platform seam is `requestUpdate` bound to rAF (`packages/xgenia-viewer-react/xgenia-viewer-react.js:36,48`). There is **no renderer interface** to swap behind. A 3D backend must be a new leaf node type, a sibling of `pixi.Stage`.

### Nodes (296 total)
- Pixi visual: `pixi.Stage/Container/Sprite/Graphics/Text/BitmapText/TilingSprite/MeshRope/ParticleContainer/CellOverlay/ReelCell/ReelColumn/Wheel`.
- Animation: `pixi.AnimatedSprite`, `pixi.Spine` (2D skeletal, `PixiSpineNode.js:41`), `pixi.GSAPInertia`, `pixi.GSAPPhysics`; `pixi.ParticleEmitter`, `pixi.RevoltFX`; `pixi.Spritesheet`.
- Camera: `pixi.Camera2D`, `pixi.UIScaler`.
- Slot games: 17 nodes (`PixiReelController`, `Slot Spin`, `Render Paylines Pixi`, `Win Rollup`, …).
- Dead: `PixiMatterPhysicsNode.js` on disk, not in barrel or index. `PixiGameLoop.js` quarantined. No timeline node, no Lottie.

### Assets
- Extension table `packages/xgenia-editor/.../AssetPanel/asset-classification.ts:11-17`: image/audio/font/video/document only. **No glb/gltf/fbx/obj.** Table is deliberately duplicated in `private/xgenia-ai` and lock-tested (`asset-classification-mirror.test.ts`), so 3D kinds mean editing both.
- Roles (`.xgenia-assets.json`, spec `docs/superpowers/specs/2026-09-06-assets-browser-design.md:27-45`): `keyart|background|sprite|ui|icon|logo|sfx|music|video|font|other|string`. No `model|rig|clip`.
- The Unity-grade panel is uncommitted in worktree `wt-asset-editor` (branch `feature/asset-editor`); its import dialog (`assetOps.ts:259`) also lacks 3D formats.

### AI tools
- Media provider is **fal only**, client-side via `utils/fal-client.ts:28-30` (`fal.run`, `queue.fal.run` polling, CDN upload). `@fal-ai/client` already a dep (`packages/xgenia-editor/package.json:96`).
- Unified `image` tool (`tools/unified/unified-image.ts:205`): `create|edit|derive_page|upscale|save|inspect|split|measure_opening`. Defaults `fal-ai/gpt-image-2`. Generations are held as data URIs in `globalThis.imageSessions` until `save`.
- **3D models are reachable but filtered**: `private/xgenia-ai/src/ChatPanel/ImageAISettingsTab.tsx:112,133` (`THREED_RE = /trellis|hunyuan-?3d|tripo|rodin|hyper3d|meshy|…/`), commit `994651f`.
- Eyes are screenshot-based (`take_screenshot`, `get_rendered_output`, `capture_motion`, `observe_timeline`, `compare_to_keyart`, `ui_layout_map`, `art_placement`). These work unchanged on a 3D canvas; only the *composition-aware* ones (`ui_layout_map`, `art_placement`) are 2D-specific.
- Code paths the agent already has: `create_js_function_node`, `edit_node_script`, `execute_code`, `run_editor_script`, `create_ui_from_xml`.

### Output
- Published game = `index.html` + `xgenia.deploy.js` (~6 MB, React external) + `index.json` + `ndl_assets/`. Size budget is commented out (`webpack.deploy.common.js:28-30`).

## 3. The model landscape that matters (Sept 2026)

Only API-callable, commercial-use options. Full table with prices and licences in the research agent output; the ones that matter for XGENIA:

| Need | Pick | Where | Price | Why |
|---|---|---|---|---|
| Image → GLB (PBR) | **Trellis 2** | fal `fal-ai/trellis-2` | $0.25/0.30/0.35 by voxel res | MIT, 3–60 s on H100, `decimation_target` 20k–50k for web, `texture_size` 1024–4096, no licence traps |
| Text/multi-view → GLB (top quality) | **Hunyuan3D 3.1 Pro/Rapid** | fal `fal-ai/hunyuan-3d/v3.1/{pro,rapid}/{text,image}-to-3d` | undocumented on fal page; resellers ~35 credits | Up to 8 views in, `enable_pbr`, `face_count` 40k–1.5M; sibling endpoints `/part` (segmentation) and `/smart-topology` (quad retopo) |
| Clean quad topology | Rodin Gen-2 | fal `fal-ai/hyper3d/rodin/v2` | $0.40 | Reviewers: only output needing no cleanup |
| Auto-rig humanoid + clips | **Meshy** | fal `fal-ai/meshy/rigging/multi-animation` or Meshy REST | $0.20 rig + $0.12/clip; 697 preset clips | Takes any textured humanoid GLB (Trellis/Hunyuan output) |
| Rig non-humanoid | Tripo (7 creature types), Anything World | vendor REST | 25 credits / $50 mo | |
| Retexture existing GLB | Meshy Retexture, Tripo texture ops | vendor REST | 5–30 credits | Not on fal |
| Text/video → motion | DeepMotion (REST, FBX/GLB), Move AI (GraphQL) | vendor | $9/mo+; $0.0067/s | |
| Worlds with geometry | **World Labs Marble 1.1** | REST | ~$1.20 world, $2.80 HQ mesh | Only vendor returning colliders + textured GLB; splats free |
| Interactive video worlds | Genie 3, Odyssey-2, Decart, Cosmos | consumer / API | – | Video only, no geometry. Not useful for a game runtime. |
| 2D sprite animation direct | PixelLab (skeleton anim, 8-dir rotation), Retro Diffusion via Scenario | REST | $0.002–0.19/call | Pixel-art register only |
| Web 3D runtime | **three.js r18x** (WebGPURenderer since r171) | npm | – | Lowest friction beside pixi. Babylon 9 if Gaussian splats matter. **pixi3d is dead** (pixi v5–7 only). |

Licence traps: Hunyuan3D **2.x** community licence excludes EU/UK/KR and caps 1M MAU (fal-hosted 3.1 is under Tencent API terms instead); Roblox Cube is research-only; Meshy free tier is CC-BY. Unverified: "Hunyuan3D 3.5", PlayCanvas WebGPU maturity, Motorica/Odyssey pricing.

## 4. Gap table

| Capability | Astra demo | XGENIA today | Needed | Effort |
|---|---|---|---|---|
| Text/image → mesh | Blender scripting | fal plumbing exists; models regex-filtered out | `model` tool action → Trellis 2 / Hunyuan 3.1 → GLB on disk | Days |
| Mesh → game-ready | manual | none | Decimate (Trellis `decimation_target`, Hunyuan `smart-topology`), gltf-transform Draco/meshopt + KTX2 textures | Days |
| Rig + animate character | unproven | Spine (2D only) | Meshy rig + clips via fal; GLB with AnimationClips | Days |
| 3D asset kind in Assets panel | n/a | image/audio/font/video/document | `model` kind (`glb gltf fbx obj`), role `model|rig|clip`, thumbnail via offscreen render, both classification tables | Days |
| 3D → 2D sprites (turntable, anim frames) | none (Astra is bad at frame animation) | `pixi.AnimatedSprite`, `pixi.Spritesheet` exist; no atlas packer | Offscreen three.js renderer in the editor + atlas packer → existing pixi nodes | 1–2 weeks |
| Live 3D in the game | three.js/Godot/UE | none | `three.Stage` leaf node (own canvas + ticker on the `requestUpdate` seam), `three.Model`, `three.Camera`, `three.Light`, `three.Env`, `three.AnimationPlayer`, `three.Orbit` | 3–5 weeks |
| Agent authoring 3D freely | writes code | `create_js_function_node`, XML UI grammar | `three.Script` node: sandboxed scene function body with a stable API (scene, camera, THREE, assets, time, signal ports) so the model codes instead of waiting for a node per feature | Included above |
| Eyes on 3D | screenshots | screenshot tools work unchanged | `scene_layout_map` (camera, world bounds, screen-space projections of named objects) as the 3D sibling of `ui_layout_map` | 1 week |
| Physics | Rapier (Void Explorer) | Matter node dead; GSAP physics only | Rapier wasm behind a `three.Physics` node | 2 weeks |
| 3D slot reels | – | `PixiReelController` + `ReelColumn` | `three.ReelCylinder` driven by the same spin/stop signals as `PixiReelController` (maths unchanged) | 3–4 weeks |
| Worlds / environments | UE5 Manhattan | key art backgrounds | Marble GLB as `three.Env`; or rendered panorama into existing 2D background | 1 week after Horizon 1 |
| Deploy size | n/a | 6 MB, no budget | Lazy `three` chunk only when a `three.Stage` exists; enforce `performance` budget; GLB ≤ 3 MB per asset rule | Days |
| Mesh in memory | n/a | images held as data URIs until save | GLBs (35 MB at Hunyuan defaults) must stream fal URL → disk, never data URI | Days |

## 5. Recommended path

### Horizon 0 — "3D-sourced 2D" (1–2 weeks, no runtime change)
Ship 3D quality into every existing 2D slot without touching the renderer.

1. **Leave `THREED_RE` alone** (see Verified corrections, §10). It correctly guards the *image-generation* picker. Give the 3D action its own separate model list (Trellis 2, Hunyuan 3.1 Rapid/Pro, Rodin v2.5, Meshy rig).
2. Add `model` action(s) to the unified image tool or a new `model` tool: `create` (text/image → GLB, saved to `assets/models/`), `rig_animate` (Meshy, clip IDs), `retopo` (Hunyuan smart-topology), `inspect` (bounds, tri count, materials, clip names).
3. Add an **offscreen three.js renderer in the editor renderer process**: `render_turntable` (N headings × M frames per clip → packed spritesheet + JSON compatible with `pixi.Spritesheet`), with alpha, fixed camera, 3-point light rig, optional toon/outline pass.
4. Assets panel: `model` kind, thumbnail, "Render to sprites" action; AI `assets({action:'spritesheet'})` reads the result.
5. Enforce GLB size/decimation defaults in the tool (Trellis `decimation_target: 30000`, `texture_size: 1024`; Hunyuan `face_count: 40000`).

Wins: consistent multi-angle symbols (2D image models fail at this), rotating coins/gems/wilds, mascot idle/celebrate cycles (Astra fails at frame animation), cheap ($4–8 per 12-symbol set).

### Horizon 1 — live 3D leaf (3–5 weeks)
1. `three.Stage` node: own transparent canvas stacked in the DOM tree, `WebGPURenderer` with WebGL fallback, ticker on the `requestUpdate` seam, `renderOnDemand` parity with `PixiStage`.
2. `three.Model` (GLTFLoader + Draco + meshopt + KTX2), `three.Camera`, `three.Light`, `three.Env` (HDRI/skybox/Marble GLB), `three.AnimationPlayer` (clip name, loop, speed, `Done` signal), `three.Orbit`.
3. `three.Script` node: the Astra lever. The agent writes a scene function body against a frozen API; port in/out for signals; validator like the existing particle-swarm sandbox rules.
4. Docs into `compile-node-source-docs` so the XML grammar and search index know the nodes; `scene_layout_map` eyes tool.
5. Deploy: lazy chunk; size budget on.

### Horizon 2 — 3D-native game kinds (months)
`three.ReelCylinder` on the existing spin/stop/maths signals; 3D crash (rocket/plane + camera rig); Rapier physics node (roulette/plinko/dice for ETG); Marble environments; Babylon only if Gaussian splat backgrounds become a product requirement.

### What not to do
- Do not swap pixi for a 3D engine. The DOM+leaf architecture supports a second leaf cleanly; the slot node set is pixi-bound and certified.
- Do not adopt Hunyuan3D 2.x open weights for an EU product (territory clause). Use fal-hosted 3.1 or Trellis 2.
- Do not use GPT-6 Astra as the chat model to "get 3D"; its 3D ability is coding, and cost is $10/$50 per M with quota burn. The default models plus a `three.Script` sandbox capture the same lever.
- Do not chase Genie/Odyssey/Decart world models for a game runtime; they emit video, not geometry.

## 6. Open questions for Mark
1. Which game kind first for live 3D: 3D reel cylinders, 3D crash, or ETG (roulette/dice physics)? This decides whether Rapier lands in Horizon 1 or 2.
2. Is EU distribution a constraint that rules out any Tencent-licensed self-hosted model? (fal-hosted is fine either way.)
3. Should Horizon 0 turntable renders be the default symbol pipeline for new slots, or an opt-in style?

## 7. Risks
- 3D generations take 1–3 min; the queue-polling path exists but turn-level batching must cover it.
- Hunyuan defaults produce 35 MB GLBs; without decimation defaults the deploy bundle explodes.
- WebGPU inside the Electron viewer iframe: Chromium supports it, but fall back to WebGL and test the OOPIF panel path.
- Two copies of the asset classification table; the regression-lock test will fail until both are edited.
- Aesthetic drift (Astra's "sameness") is real for meshes too; route mesh prompts through `project_style` / `bible` like images.

## 8. Companion
See `2026-09-18-astra-demo-catalogue-to-xgenia.md` for the pattern-by-pattern mapping of the awesome-gpt-6-astra catalogue onto XGENIA.

## 9. Sources
Astra: developers.openai.com/api/docs/models/gpt-6-astra · developers.openai.com/blog/how-to-build-games-with-astra · openai.com/index/playco-game-prototyping-with-astra · deploymentsafety.openai.com/gpt-6-astra · techcrunch.com/2026/09/03/openai-launches-astra-its-powerful-and-controversial-new-model · github.com/magiccreator-ai/awesome-gpt-6-astra · aituts.com/gpt6-astra-3d-generation-demos · spritefusion.com/blog/making-a-game-boy-advance-game-with-gpt-6-astra · kingy.ai/blog/blender-openai-astra-complete-guide · creatoreconomy.so/p/gpt-6-astra-is-both-incredible-and · stork.ai/blog/gpt-6-cant-build-simcity-heres-what-can · mindstudio.ai/blog/gpt6-astra-pricing-api-access

Models: fal.ai/docs/model-api-reference/3d-api/{overview,trellis,trellis-2,hunyuan-3d-v3.1-pro,hunyuan-3d-v3.1-rapid,hunyuan-3d-v3.1-part,hunyuan-3d-v3.1-smart-topology} · fal.ai/models/fal-ai/meshy/rigging/multi-animation · fal.ai/models/fal-ai/hyper3d/rodin/v2 · fal.ai/models/tripo3d/h3.1/image-to-3d · docs.meshy.ai/en/api/{text-to-3d,retexture,rigging-and-animation,animation} · developers.tripo3d.ai/en/pricing · huggingface.co/microsoft/TRELLIS.2-4B · github.com/tencent-hunyuan/hunyuan3d-2.1 (LICENSE) · docs.worldlabs.ai/api/pricing · docs.worldlabs.ai/marble/export/mesh · worldlabs.ai/blog/atlas · github.com/DeepMotion/Animate-3D-REST-API · developers.move.ai/docs/intro · docs.kinetix.tech/user-generated-emote · pixellab.ai/pixellab-api · scenario.com/models/retro-diffusion-animation · github.com/Roblox/cube (LICENSE) · blog.google/innovation-and-ai/models-and-research/google-deepmind/project-genie · docs.platform.decart.ai/getting-started/pricing

Runtimes: github.com/mrdoob/three.js/releases · blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0 · npmjs.com/package/pixi3d · pixijs.com/blog/8.16.0 · unity.com/blog/unity-ai-how-to-get-started · engadget.com/2196807/epic-games-details-how-its-embracing-gen-ai-in-unreal-engine

## 10. Verified corrections (2026-09-18, after primary-source check)

Three claims in the first draft of this document, and in the chat advice around it, did not survive verification.

**C1. There is no mesh-to-image endpoint on fal.** The whole `3d-to-3d` category is twelve models and every one returns a mesh. Rendering a GLB to frames on fal would mean deploying a custom `fal.App` with headless Blender in a container: supported (CPU machine types to 30 GB / 8 cores, 1 h default timeout, `/data` volume) but at an **unpublished CPU price**, and callable by users' own keys only in `shared` auth mode, which **requires fal to enable it on the account by request**. Do not render on fal.

**C2. The render belongs in the ChatPanel, client-side.** Every piece already exists in production there:
- real `webgl2` context — `private/xgenia-image-editor/src/services/BrushEngine/gpu/GpuPaintEngine.ts:629` (probe at `:431`)
- frame compositing with `OffscreenCanvas` / `createImageBitmap` — `tools/debugging/capture-motion.ts:725-790`
- binary writes to the project — `tools/image-editing/save-image.ts:521` (`proxy.fs.writeFileBinary`)
- fal key, CDN upload, sync run and queue+poll in one module — `utils/fal-client.ts:29-30, 62, 161`
- the panel declares its own dependencies (`private/xgenia-ai-app/package.json`), so adding `three` does not hit the hoisted-dep pruning trap.
Deploy is `npm run ship` alone. No editor rebuild, no viewer rebuild, no new service, no new key.

**C3. No atlas packer is needed for v1.** `pixi.AnimatedSprite` accepts `textureUrls`, a JSON array of plain image paths (`private/xgenia-pro-nodes/src/pixi/nodes/PixiAnimatedSprite.js:136-166`), and that port is already in the AI's compiled search index. Output N numbered PNGs and set one parameter. `pixi.Spritesheet` (`PixiSpritesheetManager.js:23,45`) loads a standard atlas JSON by URL if a packed sheet is wanted later.

**Also confirmed**
- The image tool's action list is a single `z.enum` at `tools/unified/unified-image.ts:205`; that file's own comments record the rule that a parameter not declared in that object does not exist to the model (`additionalProperties: false`).
- `THREED_RE` (`ImageAISettingsTab.tsx:112`) is correct code guarding the image-generation picker, not an obstacle.
- Trellis 2 is **image-only** ($0.25/$0.30/$0.35 by resolution) — which matches the strongest tip in the prompt corpus: make a reference image first, then model from it. Also on fal: `fal-ai/trellis-2/retexture` $0.20.
- Meshy rigging on fal (`fal-ai/meshy/rigging/multi-animation`) accepts any publicly reachable GLB, humanoid only, 697 preset clips, $0.20 + $0.12/clip, GLB and FBX out. **No Tripo rigging or animation endpoint exists on fal** — rigging there is Meshy-only.
- Hunyuan `/smart-topology` takes an arbitrary GLB or OBJ (200 MB cap, $0.75); `/part` is **FBX-only** (100 MB, ≤30k faces, $0.45).
- The art-loop spec lists "Animated pieces" under **Non-goals**, and already fits symbols "into one uniform cell box" — the anchor contract this pipeline needs.

**Runtime choice for Horizon 1: `<model-viewer>` is viable, with two caveats.**
Apache-2.0, v4.3.1 (2026-06-04), ~140 KB gzipped in the `-module` build that shares your three.js (~282 KB if it bundles its own, three r183). Animation scrub (`currentTime`, `availableAnimations`, `play`/`pause`), `getDimensions()`/`getBoundingBoxCenter()`, `toBlob({idealAspect})`/`toDataURL()` backed by `preserveDrawingBuffer: true`, transparent background, and a canvas with `pointer-events: none` whose listeners bind only when `camera-controls` is set — so it layers cleanly over or under the pixi canvas. Self-host the decoders via the static `dracoDecoderLocation` / `ktx2TranscoderLocation` / `meshoptDecoderLocation` properties, since the defaults fetch from `gstatic.com`.
- **No orthographic camera, declared WONTFIX** (issue #1101, closed 2021). Irrelevant to the panel renderer, which uses raw three.js and a real `OrthographicCamera`. It rules model-viewer out for any editor view that needs a true ortho projection.
- **Quiet since 2026-07-07** (no commits in Aug or Sep) and pinned to `three@^0.183` against a current 0.186. Not abandoned, but not moving. `@babylonjs/viewer` 9.27.0 shipped 2026-09-17 and is far more active, but brings the Babylon engine rather than three.

**First thing the spike must settle:** WebGL2 is proven in the panel for 2D painting, but nobody has run a full three.js scene in that iframe under Electron. Test that before anything else.
