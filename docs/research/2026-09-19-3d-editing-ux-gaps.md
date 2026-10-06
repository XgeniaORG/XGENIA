# 3D in XGENIA — what's missing from a user's point of view

Date: 2026-09-19. Written after the first hands-on session with the `three.*` nodes, prompted by four
concrete complaints. Those complaints are not four bugs; they are four symptoms of one thing missing.

## The root problem: there is no scene view

Every 3D tool a designer has ever used — Unity, Blender, Unreal, Godot — separates two cameras:

| | What it is | Who moves it |
| --- | --- | --- |
| **Scene view** | How *you* are looking at the world while you build it | You, constantly, with no consequence |
| **Game view** | What the *player* sees | Only deliberately, as authored data |

XGENIA shipped only the second one. So the moment someone wanted to look at their object from another
angle, the only camera available was the one the game renders through, and moving it changed the game.
That single omission produced three of the four complaints:

- *"I can no longer manually move around the camera"* — there was nothing safe to move.
- *"It feels like it's always orbiting"* — the only way to look around was to turn on orbit, which is a
  **gameplay** feature (letting the player rotate the view), pressed into service as a **navigation**
  feature. Of course it then also orbited in the game.
- *"I cannot move objects in 3D space"* — a gizmo is meaningless if you cannot get the camera to an angle
  where the axis you want is actually draggable.

**Fixed this session.** Edit mode now creates its own perspective camera and its own orbit/pan/zoom,
seeded from the game camera's pose so the switch is not disorienting, plus a ground grid. The game camera
is never touched. Leaving Edit mode drops all of it.

## The second root problem: the gizmo has to mean what the inspector means

*"Movement does not move according to the axis if rotated."* The gizmo drew **world** axes but wrote
**local** ports (`posX/posY/posZ` are measured in the parent's space). Inside a rotated 3D Group those are
different directions, so dragging the red arrow moved the object sideways.

**Fixed this session.** The arrows are now drawn in the parent's basis, so the red arrow always means
"increase posX" by exactly the distance dragged. This is the rule to hold to: *a gizmo is a graphical
handle on a specific port. If it does not move that port one-for-one, it is lying.*

Later, this is where a **Global / Local toggle** belongs, the way Unity and Blender have one — but local
is the right default here precisely because it matches the inspector.

## What is still missing, in the order a user will feel it

### 1. Rotate and scale gizmos
Move is done. Rotation and scale are still inspector-only, which means the most common 3D adjustments —
turning a symbol to face the player, sizing it to a reel cell — are numeric guesswork. Standard shortcuts
(W/E/R) should select the mode.

### 2. Selection feedback
Nothing tells you what is selected except the arrows appearing. There should be an outline on the selected
object and a hover highlight, as the 2D side already has.

### 3. Numbers while you drag
A drag currently shows no value. Every other tool shows the live delta, and it matters more here because
world units are abstract — is 1 unit a symbol, or a building?

### 4. Snapping
Grid snap and angle snap. Slot layouts are grids; placing symbols by eye to three decimal places is worse
than useless because the numbers look deliberate.

### 5. The 2D view should constrain the gizmo
In a locked 2D front view, the Z arrow points at the camera and dragging it does something invisible and
confusing. A 2D view should offer only the two axes it can actually show.

### 6. A visible camera in the scene
When a 3D Camera node exists, you cannot see where it is or what it can see. A camera frustum drawn in the
scene view, plus a small picture-in-picture of the game view, is how every engine solves this.

### 7. Units and scale need an anchor
"1 unit" means nothing on its own. `autoFit` defaults a model to 1 unit, but a designer has no reference
for what that is next to a reel. The grid added this session is a start; a scale reference and a stated
convention (1 unit = 1 reel cell, say) would finish it.

### 8. Frame selected
Added this session (`f`), but undiscoverable. It needs to be in a toolbar, not just a keystroke.

### 9. The 3D nodes have no viewport toolbar at all
Everything above assumes somewhere to put it: gizmo mode, global/local, snap toggle, 2D/3D, frame
selected. The 2D side has viewport chrome; 3D has none.

### 10. Nothing tells you why you cannot see anything
The most common first-run failure in 3D is a black viewport: camera inside the model, object behind the
camera, light missing, model not loaded. The Stage should detect "nothing rendered this frame" and say
which of those it is. The defaults already prevent most of it, but silence when it does happen is brutal.

## What XGENIA should NOT copy from Unity

- **A separate scene window.** The preview strip is the right surface. Edit mode changing what that strip
  shows is enough.
- **A full transform hierarchy panel.** The node graph already is one.
- **Materials as separate assets.** Ports on the node are simpler and match the rest of XGENIA.
- **A prefab system.** Components already do this.

## Ranked

| # | Change | Why it is where it is | Effort |
| --- | --- | --- | --- |
| 1 | Scene camera + grid | Unblocks everything else | **done** |
| 2 | Gizmo in parent basis | The gizmo was lying | **done** |
| 3 | Selection outline + drag readout | Cheapest confidence win left | ~1 day |
| 4 | Rotate + scale gizmos, W/E/R | The next two things anyone reaches for | ~3 days |
| 5 | Viewport toolbar | Makes 3, 4, 6 discoverable | ~2 days |
| 6 | Snapping | Slots are grids | ~1 day |
| 7 | 2D view constrains the gizmo | Removes a confusing no-op | ~half day |
| 8 | Camera frustum + game-view PIP | Needed once real cameras get authored | ~2 days |
| 9 | Empty-view diagnostics | Turns a black screen into a sentence | ~1 day |

## The "torus bug" was not a bug
Recorded here because the correction matters more than the claim. A runtime diagnostic printed
`shape=torus geom=TorusGeometry size=2.70x2.70x0.70 rot=(0,0,0) scale=1/1/1`, and a headless probe confirmed
a 0.52 hole radius. The geometry was always a correct ring. What I had seen was a tilted torus read at an
angle in a small screenshot. **Lesson: measure before reporting a regression.**

## Shipped 2026-09-19, later the same day
Items 1, 2, 3, 4 and 8 of the ranked list above, plus snapping:

- **Scene camera + grid** in edit mode, seeded from the game camera's pose, never touching it.
- **Gizmo in the parent basis** — the red arrow always means "increase posX", one-for-one.
- **Move / Rotate / Scale** gizmos, `W` / `E` / `R`, each writing only its own three ports.
- **Selection outline** (solid) and **hover outline** (dashed) as projected bounding boxes.
- **Live readout** beside the object: name, mode, and the three live numbers.
- **A toolbar** — a translucent pill, bottom centre, drawn in the overlay so it needs no editor UI change.
- **Shift to snap** (0.25 units, 15°, 0.1 scale). A held modifier, not a mode to forget.
- **`F` frames the selection**, `Esc` deselects.

One drag is one undo entry: live feedback is in-page, and the model is written once on release through the
editor's own `viewportGesture` resolver, which now understands `kind: 'three'` for all three gestures.

Locked by `gizmo-contract.test.js` (11 tests): the parent-basis rule including the 90°-rotated-parent case
that caused the original complaint, the gesture→port mapping, NaN rejection, and snap arithmetic.
