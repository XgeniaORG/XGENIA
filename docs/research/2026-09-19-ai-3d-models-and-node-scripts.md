# Can the AI build 3D models, and can it edit our node scripts?

Date: 2026-09-19. Both questions answered by building the missing half of each, not by inspection.

## 1. AI-generated 3D models — YES, as of today

`image({action:"model"})` turns art into a `.glb` in the project, ready for a `three.Model` node.

```
image({action:"create", prompt:"a golden aztec sun medallion, front view, plain background", assetKind:"symbol"})
image({action:"save", imageId:"img_…", filename:"sun.png", folder:"assets/symbols"})
image({action:"model", sourceImage:"assets/symbols/sun.png", name:"sun"})
→ { path: "assets/models/sun.glb", sizeMB: 2.1 }
```

Then set that path on a `three.Model` node's `url`. Auto Fit scales it and stands it on the floor.

### Why an action on `image` and not a new tool
`image` is already in the schema the model sees. This codebase has paid twice for "registered but
not exposed" — `video` and `audio` were invisible for their entire life. A new top-level tool would
most likely never be called.

### Endpoints
All on fal, all through the key the panel already holds. No new vendor, no new env var.

| Key | Endpoint | When |
| --- | --- | --- |
| `trellis-2` (default from an image) | `fal-ai/trellis-2` | Best quality per price, MIT, no licence traps |
| `hunyuan3d-rapid` | `…/v3.1/rapid/image-to-3d` | Fastest, fine for blocking out |
| `hunyuan3d-pro` | `…/v3.1/pro/image-to-3d` | Most detail, slowest |
| `hunyuan3d-text` (default from a bare prompt) | `…/v3.1/rapid/text-to-3d` | Only when there is no reference image |

### Three decisions worth keeping
1. **Image-to-3D is the default, text-to-3D the fallback.** It is what actually works: the best
   documented pipeline in the field generates a reference image first and models from that, and
   Trellis 2 accepts no text at all. It also keeps the model on the project's style, because the
   image it came from already was.
2. **The defaults are web defaults, not showcase defaults.** Every vendor ships a film-quality
   mesh: Hunyuan `face_count: 500000`, Trellis `decimation_target: 500000` with a 2048 texture. At
   those numbers ONE symbol outweighs an entire finished slot, whose whole published bundle is
   about 6 MB. We ask for ~30k triangles and 1024, which is what the vendors themselves recommend
   for web and mobile. A result over 8 MB returns a warning saying so.
3. **A GLB never passes through memory as a data URI.** Generated images sit in the in-memory
   `imageSessions` map until an explicit save, which is fine at ~1 MB. Hunyuan returns up to 38 MB.
   The URL fal returns is fetched and streamed to disk, and an existing file goes to `.trash`
   first, the same rule the image save path follows.

### One fix this needed in shared code
`falInvoke` routes by `isLongRunning(modelId)`, and no 3D pattern was in that list — so every 3D
call would have taken the **synchronous** route, which holds a socket for minutes and, more
importantly, **gets none of fal's retries** on server errors, gateway timeouts or rate limits.
Added `trellis`, `hunyuan-3d`, `tripo`, `rodin|hyper3d`, `meshy` and `to-3d`. Additive; nothing
else changes route.

## 2. Editing node scripts — YES, and it was quietly broken

Every one of the seven `three.*` nodes declares `scriptScope`, and `edit_node_script` has no
node-type allowlist, so the AI could already edit them. But **the scope was incomplete**, which is
a failure that hides:

> An edited Script is re-compiled on its own, so the imports at the top of the node's source file
> are NOT in scope. Only the names in `scriptScope` are. A method that calls a module-local helper
> therefore works as shipped and throws the moment anyone edits it — at which point the runtime
> silently falls back to the built-in and the edit appears to have done nothing.

The 2D side already recorded this exact lesson: *"When a pixi node's methods lean on a helper that
isn't here, add it here rather than making the AI guess a workaround."*

Found unreachable, and fixed:

| Helper | Used by | Fix |
| --- | --- | --- |
| `buildGeometry` | `three.Mesh.directUpdateObject` | moved to `utils/meshFactory.js` |
| `makeErrorMarker` | `three.Model._load` | moved to `utils/meshFactory.js` |
| `applyEnvironmentPreset`, `TONE_MAPPINGS` | `three.Environment.directUpdateObject` | exported and added to scope |
| `makeDefaultCamera`, `makeDefaultLights`, `frameCameraOnBox` | Stage paths | added to scope |

The two module-locals had to MOVE rather than just be exported: the scope cannot import from a node
file, because every node imports the scope — that is a cycle. Shared helpers belong in `utils/`.

### Locked by a test
`script-scope.test.js` parses every node file, extracts the `methods:` block, and asserts that each
module-level name it calls is exposed by `threeScriptScope`. It also asserts every node declares a
scope, and that the scope never imports from a node file. This is the kind of breakage that is
invisible until someone edits a script, so it needed a test rather than a note.

## State
- 32 tests pass across `threeMath` (9), `framing` (7), `gizmo-contract` (11), `script-scope` (5).
- The three-node family is script-editable end to end, with a complete scope.
- The `model` action is registered, its params declared in the schema the model actually reads, and
  it typechecks. **It has not yet been run against fal** — that costs money and needs the user's key
  with credit. First real call is the remaining verification.
