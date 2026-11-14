# Sizing, placing and scaling — the one model

This page is for people and for the AI. It says what every size-shaped control in the
property panel does, in the words Unity, Godot and CSS use for the same ideas, so a screen
can be set up once and keep its layout at every resolution.

There are only **four layers**. Every control belongs to exactly one of them:

| Layer | Panel group(s) | Unity | What it answers |
|---|---|---|---|
| 1. **Box** | Dimensions | RectTransform size | How big is this element? |
| 2. **Placement** | Layout, Alignment, Margin and Padding | RectTransform anchor + anchoredPosition | Where does it sit in its parent? |
| 3. **Scaler** | UI Scaling | CanvasScaler | How does a design made at one size map onto the real screen? |
| 4. **Content fit** | Image Fit, Symbol Scale, Spine Fit Mode | — (CSS `object-fit`) | How do the pixels fill the box? |

The confusion came from layer 3: a Group and a pixi.Stage each had a scaler, with different
words, and the same word (“Fit”) meant different things on each. Since 2026-11-14 they offer
**the same seven modes with the same labels and the same maths**. Only the stored key name
differs (`uiScaleMode` on Group, `fitMode` on pixi.Stage).

## Layer 1 — Box (Dimensions)

- **Size Mode** (the four icons): *explicit* (you give Width and Height), *content width*,
  *content height*, *content size* (hug the children on that axis — Unity's ContentSizeFitter).
- **Width / Height** take a number and a unit: `px` is a fixed size, `%` is a share of the
  parent. Note that in a row or column parent a `%` size is implemented as flex-grow, so it is
  a *weight* against the siblings' percentages, not a true percentage. See the engine rule
  `percent_size_is_flex_grow`.
- **Fixed** (the checkbox beside a `%` size): keep the percentage as a plain CSS size instead
  of turning it into growth. Rarely needed.
- On a **pixi.Stage** the Dimensions group is the DOM box the canvas lives in: `100%` fills
  the parent, which is what you want almost always.

## Layer 2 — Placement (Layout, Alignment)

- **Position: In Layout** means the element is a flex item of its parent; its parent's
  *Layout* (Vertical / Horizontal / None) and *Align and Justify Content* decide where it goes.
- **Position: Absolute** takes the element out of the flow. Then **Alignment** (the six
  arrows) is the **anchor** — the nine Unity anchor presets, written as `alignX` and `alignY`
  (`left|center|right`, `top|center|bottom`) — and **Pos X / Pos Y** (`transformX`,
  `transformY`) is the offset from that anchor in pixels, Unity's `anchoredPosition`.
- The trap this whole page exists for: an anchor is a *percentage* of the parent and the
  offset is *fixed pixels*. Without a scaler they drift apart when the window changes, and
  nested offsets compound. That is why layer 3 exists.

## Layer 3 — Scaler (UI Scaling)

A scaler says: “I designed this at **Design Width × Design Height**. Map that box onto
whatever box I actually get.” Children keep their design-pixel positions and the whole
composition scales as one, so nothing drifts.

**Set it on ONE outer Group per screen** (the screen root), and place everything inside it in
design pixels. A scaler inside a scaler compounds and the content is scaled twice; the engine
warns on the node when it sees that.

The seven modes, identical on Group and pixi.Stage:

| Key | Label | Factor | Canvas (design units) | You see | Unity | Godot | CSS |
|---|---|---|---|---|---|---|---|
| `none` | Off | 1 | the real box | 1:1 pixels, nothing scales | Constant Pixel Size | disabled | — |
| `fit` | Fit | `min(w/dw, h/dh)` | exactly `dw × dh` | everything, **bars** on the loose axis | Shrink, fixed canvas | keep | contain |
| `fill` | Fill | `max(w/dw, h/dh)` | `box / factor` | box covered, edges **cropped** | Shrink | — | cover |
| `expand` | Expand | `min(w/dw, h/dh)` | `box / factor` | everything, **extra room** instead of bars | Expand | expand | — |
| `matchWidth` | Match Width | `w/dw` | `box / factor` | width exact, height gets room or crops | Match = 0 | keep_width | — |
| `matchHeight` | Match Height | `h/dh` | `box / factor` | height exact, width gets room or crops | Match = 1 | keep_height | — |
| `stretch` | Stretch | `(w/dw, h/dh)` | exactly `dw × dh` | box filled exactly, shapes **distort** | — | ignore | fill |

`w × h` is the box the node actually gets; `dw × dh` is the design size.

Which one:

- **Fit** when the design must stay exactly the design size (a key-art screen whose art is
  made for 1920 × 1080, a layout that mixes `%` and `px` children). Give the Group a background
  colour: the bars show it.
- **Expand** when the screen should have no bars and the children are anchored (a HUD whose
  balance plate sits bottom-left and spin button bottom-right at every aspect ratio).
- **Fill** for full-bleed art where cropping the edges is fine.
- **Match Width / Match Height** when one axis must be exact (a vertical mobile game that is
  always 1080 wide).
- **Stretch** almost never. It is here so a Stage and a Group can say the same thing.
- **Off** on any node that already sits inside a scaled Group.

Old spellings still work everywhere and still appear in saved projects: `letterbox` means
`fit`, `shrink` means `fill`; the CSS words `contain` and `cover` are read as `fit` and
`fill`. The panel shows them under the new label. Picking from the dropdown stores the new key.

**Design Width / Design Height only appear while Scale Mode is on.** With it Off they decide
nothing, so the panel hides them (the stored numbers survive).

### Group vs pixi.Stage

They are the same control on two different trees, and they do not know about each other:

- A **Group's** Scale Mode scales the DOM subtree: every Text, Image, Button and Group inside
  it, and the DOM box of any pixi.Stage inside it.
- A **pixi.Stage's** Scale Mode scales what PIXI draws *inside its canvas*: sprites, reels,
  effects. It does nothing to the Stage's own DOM box, which comes from Dimensions.

So a Stage **inside a scaled Group is already scaled**. Leave its Scale Mode Off and its
Width / Height at 100%. Set the Stage's own Scale Mode only when the Stage is the thing being
fitted (a Stage that is the whole screen, or a Stage whose canvas must stay a fixed reel
window). If you do, its Design Width / Height describe the *Stage's own* box, never the
screen's: a 1920 × 1080 design inside a 1041 × 801 Stage is scaled to 0.54 and drawn tiny.

On a Stage, Fit and Expand look alike because PIXI draws nothing outside the design box
except the background; they differ in what *Current Width / Height* report and what a reel
grid centres against (the design box for Fit, the grown space for Expand).

Do not hand-set **Scale** (the Style transform) as a fit factor. It was the workaround before
Scale Mode existed; it multiplies with the factor the mode computes.

## Layer 4 — Content fit

How pixels fill a box they do not match. These use the CSS words because that is what they
are: **Image → Image Fit** (`fill` / `contain` / `cover`), **Reel Cell → Symbol Scale**,
**Spine → Fit Mode**. They never move or scale the box itself; that is layers 1 to 3.

## A worked example (the key-art screen that prompted this page)

```
KeyArtScreen   Group   Scale Mode: Match width, 1920×1080, Width 100% Height 100%
├─ KeyArt      Image   absolute, 1920×1080 px, Image Fit: fill
├─ UI_reels    Group   absolute at (502, 82), 1041×801 px, Scale Mode: Off
│  ├─ FXStage   pixi.Stage  Scale Mode: Fit, design 1920×1080, Width 100% Height 100%
│  └─ ReelStage pixi.Stage  Scale Mode: Off, Size Mode: content width, no Width/Height
├─ UI_balance  Group   absolute at (152, 963), 167×70 px
└─ UI_spin     Button  absolute at (1677, 919), 160×156 px
```

What is right: one scaler at the root, everything inside it in design pixels, and UI_reels
correctly Off. Two things are wrong and both are layer-3 mistakes:

1. **FXStage** has its own Scale Mode with a *screen-sized* design box inside a 1041 × 801
   Group. Its effects are drawn at 0.54× and off-centre. Set its Scale Mode to Off (the root
   Group already scales it), or if the FX really are authored in a 1920 × 1080 space that must
   be fitted here, give it that Group's own size as its design box.
2. **ReelStage** has Size Mode *content width* and no Width / Height. A canvas has no DOM
   content to size from, so its DOM box falls back to the engine default and the reels do not
   track the window. Set Size Mode explicit, Width 100%, Height 100%, Scale Mode Off.

With those two changes the screen has exactly one scaler, and resizing the window moves
everything together.

Match width at the root means a window taller than 16:9 gets extra design room at the bottom
(the key art does not reach it) and a wider window crops the bottom of the design. If the art
must always be whole, use Fit and give the root a black background for the bars.

## Where the rules live

- The list, labels and maths: `packages/xgenia-viewer-react/src/components/visual/Group/scale-mode.ts`
  (Group) and `private/xgenia-pro-nodes/src/utils/scale-modes.js` (pixi.Stage); a private test
  holds the two equal.
- The engine facts the AI is given at tool time: `private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/utils/engine-layout-semantics.ts`,
  rule `design_canvas_keeps_placement`.
- Warnings appear on the node in the editor: a scaler inside a scaler, a design size with the
  mode Off, a hand-set Scale under a mode, a Stage whose fit resolves to 1.
