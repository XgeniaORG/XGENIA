# Editor left rail redesign — design

Date: 2026-09-06
Status: approved direction (mockup), spec for implementation
Mockup: https://claude.ai/code/artifact/449c41b1-7db3-474f-8dfc-d96b35e94952
Builds on: `2026-09-05-editor-topbar-redesign-design.md` (glass tokens, `aiactivity`, the bar's
absolute positioning against the EditorPage row).

## Problem

The top bar is now one glass row. The left column is the last chrome still drawn in the old
language. Verified against the source and a live screenshot of the dev build on 2026-09-06:

- `SidePanel.tsx` renders core-ui `SideNavigation`: an opaque 64px strip and an opaque panel,
  both `--theme-color-bg-2`, no edge between them. The bar floats; the strip does not.
- The icon cluster is vertically centred inside three nested `Container`s, leaving ~170px of
  dead space under the green + on a 1125px-tall window.
- Panel order is `1 · 2 · 5.3 · 5.4 · 5.45 · 5.6 · 5.7 · 5 · 8`. `SidebarItem.placement`
  exists in the model but `SidePanel.tsx` ignores it and keeps its own hardcoded `bottomIds`
  set, which also forces `project-styles` and `feedback-panel` to the bottom.
- Icons come from a hardcoded `iconMap` keyed by panel id; `register({ icon })` is ignored.
  Five map entries point at panels that no longer register (`cloudservice`, `cloud-functions`,
  `memory-panel`, `ai-panel`, `ChatPanel`).
- "Hide panel" in the bar sets the `FrameDivider` size to 0, which unmounts the whole
  `SidePanel` including the strip (`first={frameDividerSize > 0 ? <SidePanel /> : null}`,
  `EditorPage.tsx:381`). The only way back is the bar's button.
- Panel width is a `useState(450)` that resets on every launch. The right inspector remembers
  its width in localStorage, has pin, close, a drag edge and double-click reset. The left
  has none of these.
- The + button is `#67DE92` inline, the exact colour the bar spec tokenised. The separator and
  the exit glyph are inline rgba.
- `SideNavigation`'s logo/exit slot is overridden by a `header` prop, so no project name or
  icon appears anywhere in the window. Exit project is an unlabelled logout glyph at the
  bottom of the strip.
- `SideNavigationButton` has a `notification` badge slot; nothing in the editor passes it.
- The AI chat is one of twelve rail items, ranked between the image editor and Feedback,
  yet it is the surface the product is built around. Opening Components replaces the
  conversation.

## Goal

Same treatment as the bar, plus one idea the bar could not carry: in an AI-native editor
the rail is the presence layer. It shows what the AI is doing and where, and lets the
human look at a tool without leaving the conversation.

```
┌────┬─────────────────────────────────────────────────────────────────────────┐
│ ▣  │ [▤] [◀ ▶ ↻]     ( 🖥 ⌇ ⌂ /lobby ▾ · ⚠2 )     [Desktop·100%▾][Edit|Preview][⋯][▲ Publish] │
│    ├───────────┐                                                   ┌──────────┤
│ ✦◎ │ Chat      │                                                   │SpinButton│
│ ▦  │ ┌─────────┴─┐  node graph                                     │          │
│ ⌕  │ │Components │                                                 │ label    │
│ ▭  │ │  peek     │                                                 │ width    │
│ ✎  │ │           │                                                 │          │
│ ▤  │ └───────────┘                                                 │          │
│ ▧  │           │                                                   │          │
│ ── │           │                                                   │          │
│ ⑂3 │           │                                                   │          │
│ ✉  │           │                                                   │          │
│ ⚙  │           │                                                   │          │
└────┴───────────┴───────────────────────────────────────────────────┴──────────┘
 rail  docked card + peek                                             inspector
```

- **Rail**: 48px, glass, full height, always present while a project is open. Three
  clusters: identity chip at the bar's row, top cluster anchored to the top, bottom cluster
  from `placement: 'bottom'`.
- **Docked card**: one floating glass card, twin of `RightPropertyPanel` (header, pin/close,
  drag edge, width remembered per panel). Default docked panel is the chat.
- **Peek**: clicking any other rail item opens that panel as a second card 12px in front of
  the docked one. Esc, click-away or the same icon closes it. Pin docks it (the chat goes
  back to being a rail item).
- **Presence**: a conic ring on the AI icon while a turn runs; a ping and a "changed since
  you looked" dot on the icon of whichever panel the AI's last tool call belonged to; an
  uncommitted-files count on Version control.
- **The bar never moves**: the bar already anchors to the EditorPage row; the left card
  joins that row, so opening or closing it no longer shifts the pill.

## Non-goals (this spec)

- Moving `EditorTopbar` out of `EditorDocument`. It stays; the row it anchors to simply
  grows to include the left card.
- Touching the chat app (`private/xgenia-ai`) or its iframe header. Presence is derived on
  the editor side from the `command` messages it already posts.
- Ambient backdrop tinted from the project thumbnail (needs colour extraction; follow-up).
- A drop target on the Image editor icon (no open-with-file entry point today; follow-up).
- Per-page thumbnails, key-art in the project menu, "Switch project…" (Close project already
  lands on the projects screen).
- Changing core-ui `SideNavigation`. It has other consumers (`DefaultApp`, stories); the
  editor stops using it.

## Architecture

### Layout (`pages/EditorPage/EditorPage.tsx`)

`FrameDivider` and `SidebarWidthContext` go. The page becomes:

```tsx
<div className={css.Editor}>                     {/* flex row, 100% */}
  <Rail />                                       {/* 48px, always */}
  <div className={css.Row} style={{ position: 'relative' }}>   {/* the bar anchors here */}
    <LeftPanelCard />                            {/* null when the card is closed */}
    <div style={{ flex: 1, minWidth: 0 }}><Document /></div>
    {isRightPanelActive && <RightPropertyPanel />}
  </div>
</div>
```

`EditorTopbar` keeps `position: absolute; inset: 0 0 auto 0` inside `EditorDocument`, whose
nearest positioned ancestor is `.Row`. The bar therefore spans left card + document +
inspector. `LeftPanelCard` uses `margin: 46px 0 8px 8px` (the inspector uses `46px 8px 8px 0`),
so both clear the bar. `SidebarWidthContext.ts` is deleted (its only consumer was EditorPage).

### Files

New (under `packages/xgenia-editor/src/editor/src/` unless noted):

| Path | Role |
|---|---|
| `views/Rail/Rail.tsx` | The rail: identity chip, top/bottom clusters, overflow, drop mode, ⌘⌥ digit reveal. |
| `views/Rail/Rail.module.scss` | Rail geometry and glass; sliding indicator; ping/ring/badge keyframes. |
| `views/Rail/RailButton.tsx` | One item: icon, tooltip (label + binding), badge / unseen dot / ring, `aria-label`, `data-test`. |
| `views/Rail/IdentityChip.tsx` | 28px chip: `ProjectModel.getThumbnailURI()` or the project's initial; opens `ProjectMenu`. |
| `views/Rail/ProjectMenu.tsx` | `GlassPopover`: name, path, saved-ago; Rename (inline), Reveal in Finder, Project settings, Close project. |
| `views/Rail/useTooltipGroup.ts` | Shared "warm" state so the second tooltip in 500ms shows at 0ms. |
| `views/Rail/railOrder.ts` | Pure: `arrangeRail(items, userOrder, capacity)` → `{ top, bottom, overflow }`. |
| `views/Rail/railLayout.ts` | Pure reducer: `{ dockedId, peekId, open }` × actions (`click`, `peek`, `pin`, `close`, `toggle`, `esc`). |
| `views/LeftPanelCard/LeftPanelCard.tsx` | Docked or peek card: header, content host (keep-mounted panels, `PanelActiveContext`), resize edge, width chip. |
| `views/LeftPanelCard/LeftPanelCard.module.scss` | Card material via tokens; open/close/switch recipe; scroll-aware header. |
| `views/LeftPanelCard/panelWidth.ts` | Pure: clamp, snap (`[320, 380, 450, 560]`, tol 12), storage key, read/write with injected storage. |
| `models/railpresence.ts` | Store: `noteCommand(name)`, `markSeen(panelId)`, snapshot per panel `{ unseen, lastAt }`; emits `rail-presence-changed`. |
| `models/railpresence.core.ts` | Pure: `familyOf(command) → panelId \| null`, `reducePresence(state, event)`. |
| `models/gitstatus.ts` | Store: `refresh()` → `Git.status().length`; emits `git-status-changed`. Debounced triggers listed below. |
| `styles/custom-properties/glass.css` | Adds rail/card/motion tokens (see Styling). |
| `tests/rail/railLayout.test.ts`, `railOrder.test.ts`, `railPresence.test.ts`, `panelWidth.test.ts` | Node runner via `tsx`, no editor imports. |

Modified:

| Path | Change |
|---|---|
| `pages/EditorPage/EditorPage.tsx` | Layout above. Remove `frameDividerSize`, `lastPanelWidth`, `SidebarWidthContext`, the `toggle-left-panel` listener. Add ⌘B and ⌘⌥1–9 commands. |
| `models/sidebar/sidebarmodel.tsx` | `icon?: IconName \| React.ElementType`; `headerAction?`, `chromeless?`, `defaultWidth?` on `SidebarItem`; layout state (`dockedId`, `peekId`, `open`) driven by `railLayout.ts`; `peek()`, `pin()`, `closePeek()`, `toggleCard()`, `setUserOrder()`; `ActiveId` = `peekId ?? dockedId`; `layoutChanged` event; persists `rail.docked` and `rail.order` in `EditorSettings`. |
| `router.setup.ts` | Every `register` passes its `Side*` icon component; integer orders; `placement: 'bottom'` on version control, feedback, settings; `headerAction` on components (Add node); `chromeless: true` on the chat; `defaultWidth: 450` on the chat; `project-styles` order in the top cluster. |
| `views/SidePanel/SidebarIcons.tsx` | Kept (icons). `SideLogout`, `SideCloud`, `SideCloudFunctions`, `SideMemoryPanel`, `SideAiPanel` removed. |
| `views/SidePanel/SidePanel.tsx`, `SidePanel.model.scss`, `views/SidePanel/index.ts` | Deleted. |
| `contexts/SidebarWidthContext.ts` | Deleted. |
| `views/EditorTopbar/EditorTopbar.tsx` | Panel toggle calls `SidebarModel.instance.toggleCard()`; `isLeftPanelVisible` read from the model's `layoutChanged`. `toggle-left-panel` emit removed. |
| `views/RightPropertyPanel/RightPropertyPanel.module.scss` | Its literal material (`rgba(22,22,24,.62)`, blur, shadow, radius) replaced by the new `--card-*` tokens. No visual change. |
| `views/panels/ChatPanelBridge/EditorBridge.ts` | Beside `AiActivity.begin()` at the `command` branch (~line 523): `RailPresence.noteCommand(msg.command)`. In `fs.writeFile` / `fs.writeJson` / `fs.writeFileBinary` / `assetMeta.set`: `EventDispatcher.emit('project-assets-changed', { path })`. After `git.commit` / `git.push`: `GitStatus.refresh()`. |
| `views/panels/AssetPanel/useProjectAssets.ts` | Listens for `project-assets-changed` → debounced `refetch()` (300ms). |
| `views/panels/AssetPanel/AssetPanel.tsx` / `assetOps.ts` | `handleFilesImport` extracted to `assetOps.importFiles(files)` so the rail's drop target can call it. Panel keeps its own drop zone. |
| `views/panels/componentspanel/*` | Exports a small `AddNodeAction` button (the green +) used as `headerAction`. Clicking it: `SidebarModel.instance.peek('node-picker')`. |
| `constants/Keybindings.ts` | `TOGGLE_LEFT_PANEL` (⌘B), `RAIL_1…RAIL_9` (⌘⌥1–9). |
| `packages/xgenia-editor/src/editor/src/styles/custom-properties/glass.css` | Tokens below. |

Deleted from the editor: the `iconMap`, `bottomIds`, the `header` slot override, the inline
`#67DE92` / `#0b1b14` / rgba separator / exit glyph, decimal orders.

### Events (EventDispatcher)

| Event | Payload | Emitter → Listener |
|---|---|---|
| `Model.layoutChanged` (SidebarModel) | `{ dockedId, peekId, open }` | SidebarModel → Rail, LeftPanelCard, EditorTopbar |
| `rail-presence-changed` | `Record<panelId, { unseen, lastAt }>` | railpresence → Rail |
| `git-status-changed` | `{ count }` | gitstatus → Rail |
| `project-assets-changed` | `{ path }` | EditorBridge → useProjectAssets, railpresence |
| `ai-activity-changed` (existing) | `{ active, label }` | aiactivity → Rail (ring) |
| `Model.thumbnailChanged` (existing) | meta | ProjectModel → IdentityChip |

`toggle-left-panel` is removed. Nothing else emits it (verified: one emitter in EditorTopbar,
one listener in EditorPage).

### Layout reducer (`railLayout.ts`)

```ts
type Layout = { dockedId: string; peekId: string | null; open: boolean };
type Action =
  | { type: 'click'; id: string }      // rail item click or ⌘⌥n
  | { type: 'peek'; id: string }       // hover-peek while collapsed, header actions
  | { type: 'pin' }                    // pin button on a peek card
  | { type: 'close' }                  // × on either card, or Esc with no peek
  | { type: 'esc' }                    // Esc: closes peek if any, else no-op
  | { type: 'toggle' }                 // ⌘B / bar button
  | { type: 'dock'; id: string };      // programmatic (restore on project open)
```

Rules, in order:

- `click id` when `id === dockedId`: `open = !open` (or if a peek is showing, close the
  peek and keep the docked card open).
- `click id` when `id === peekId`: `peekId = null`.
- `click id` otherwise: `peekId = id; open = true`.
- `pin`: `dockedId = peekId; peekId = null` (the previously docked panel stays mounted).
- `close`: `peekId ? peekId = null : open = false`.
- `toggle`: `open = !open; peekId = null`.
- `esc`: `peekId = null` if any, else unchanged.
- `dock id`: `dockedId = id; peekId = null; open = true`.

`ActiveId` (what `PanelActiveContext`, `getActive()` and `switchToNode` see) is
`peekId ?? dockedId`. Existing callers of `switch(id)` (⌘F search, `component.switchTo`,
`onOpen` hooks) map to `click`. Transient panels (`node-picker`, `PortEditor`) open as peeks
and are recreated on each open as today.

Persistence: `rail.docked` (id) and `rail.open` (bool) in `EditorSettings`, written on every
change, read on project open. Default docked id: `chat-panel` if registered, else
`components`.

### Rail

- 48px wide, `height: 100%`, `background: var(--glass-bar-bg)`, `backdrop-filter:
  var(--glass-bar-blur)`, `border-right: 1px solid var(--glass-bar-border)`. `role="toolbar"`,
  `aria-orientation="vertical"`, arrow keys move focus, Enter/Space activates.
- Identity chip: 28px, radius 8, `margin-top: 8px` (centre at 22px, the bar's row). Image
  from `ProjectModel.instance.getThumbnailURI()` (`object-fit: cover`), else the project
  name's first letter on `linear-gradient(135deg, #3b2f6e, #1d3a33)`. Re-renders on
  `Model.thumbnailChanged` and `Model.renamed`. Click opens `ProjectMenu`.
- Top cluster: `margin-top: 22px`, `gap: 10px`, items 28px radius 8. Bottom cluster:
  `margin-top: auto`, hairline top border, `padding-top: 10px`, `margin-bottom: 10px`.
- Active indicator: one absolutely positioned 2px × 14px bar at `left: 0`, moved with
  `transform: translateY()` over `var(--speed-move) var(--easing-base)`. Active item also
  gets `--glass-ctrl-bg` fill. Under reduced motion the transform has no transition.
- Ordering: `arrangeRail(items, userOrder, capacity)`. `placement` decides the cluster;
  within a cluster, `userOrder` (ids) first, then `order` ascending, then name. `capacity`
  = number of 38px slots that fit between the identity chip and the bottom cluster; items
  beyond it move to an overflow `⋯` button whose `MenuDialog` lists them with their icons
  and badges rolled up. Capacity is measured with a `ResizeObserver` on the rail.
- Tooltips: core-ui `Tooltip`, `renderDirection: Horizontal`, `showAfterMs` = 300 when
  the group is cold, 0 when another rail tooltip closed within the last 500ms. Content =
  `item.name`, `fineType` = the binding label. **The chat item's `name` stays exactly
  `Chat`**: the MCP harness finds the panel button by hovering rail icons and matching that
  tooltip (`xgenia-mcp-server/src/index.ts:160`). Every button also gets `aria-label={name}`
  and `data-test={id + '-panel'}` so the harness can stop hovering in a later change.
- Shortcut reveal: a window `keydown`/`keyup` listener; when Meta+Alt has been held for
  250ms, each visible top-cluster item shows its 1-based index in a 13px corner chip; hidden
  on keyup or blur. ⌘⌥n dispatches `click` on the nth visible top-cluster item.
- Badges: `RailButton` renders one of `{ count }` (amber, bottom-right, `tabular-nums`),
  `{ unseen: true }` (6px amber dot, top-right), `{ ring: true }` (conic ring, AI item only).
  Count changes cross-fade the digit and scale 1 → 1.15 → 1 over 200ms. A ping (box-shadow
  ring 0 → 9px, 600ms) fires when `unseen` flips false → true.
- Drop mode: a window `dragenter` whose `dataTransfer.types` includes `Files` puts the rail
  in drop mode (non-target items at 35% opacity; the Assets item scaled 1.12 with a green
  outline). `drop` on the Assets item: `assetOps.importFiles(files)` then
  `dispatch({ type: 'peek', id: 'assets' })`. `dragleave` to outside the window or `drop`
  anywhere ends drop mode. Only registered (visible) `assets` is a target; when the
  experimental panel is off the rail ignores drops.
- Reorder: `pointerdown` + 400ms hold on a top-cluster item lifts it (`scale(1.06)`,
  elevated shadow); `pointermove` reorders among top-cluster siblings with FLIP transforms
  over `var(--speed-move)`; `pointerup` writes `rail.order`. Items never cross into the
  bottom cluster. Not available while the overflow menu is open.

### Project menu

`GlassPopover` anchored to the chip, 260px, `renderDirection: Horizontal`. Header: project
name, `retainedProjectDirectory` with `~` for the home dir, "saved 2m ago" via
`relativeTime.formatAgo` from the last `ProjectModel` save. Items:

- **Rename project** — swaps the header name for a `TextInput`; Enter →
  `ProjectModel.instance.rename(name)`; Esc cancels.
- **Reveal in Finder** — `shell.showItemInFolder(join(dir, 'project.json'))` (precedent:
  `ProjectSettingsTab.tsx:39`).
- **Project settings** — `dispatch({ type: 'click', id: 'settings' })`.
- **Close project** — `App.instance.exitProject()`. Danger colour, separated by a hairline.

### Left panel card

- Material from tokens: `--card-bg`, `--card-blur`, `--card-radius`, `--card-shadow`. The
  right inspector's SCSS is switched to the same tokens with no visual change.
- Geometry: docked card `margin: 46px 0 8px 8px`, `width` from `panelWidth.read(id)`
  (default `item.defaultWidth ?? 380`, clamp 280–720). Peek card is
  `position: absolute; left: 20px; top: 58px; bottom: 20px; z-index: 3` inside `.Row`, same
  width rule, `--card-shadow-peek` (heavier). While a peek is open the docked card gets
  `opacity: .55` and `pointer-events: none`.
- Header (40px): `item.name` (13px, 600), a `headerAction` slot, then pin (peek only) and
  close. `chromeless` items render a 32px row with pin/close only and no title (the chat
  iframe draws its own header).
- Content host: every panel opened this session stays mounted, hidden with
  `display: none`, exactly as `SidePanel.tsx` did; `PanelActiveContext` is `true` for the
  docked panel while it is visible and for the peek panel while peeking. `ErrorBoundary`
  with try-again per panel is kept.
- Resize edge: 8px hit area on the right edge, hairline visible on hover/drag, `col-resize`.
  Drag shows a width chip (`380`) beside the edge; `panelWidth.snap` pulls to 320/380/450/560
  within 12px; double-click resets to the default; width written per panel id on release.
  Keyboard: arrows ±16px, Home/End min/max. Same ARIA as the inspector's handle.
- Scroll-aware header: a 1px sentinel at the top of the scroll container; `IntersectionObserver`
  toggles `.is-scrolled` (hairline + `0 6px 12px -6px rgba(0,0,0,.6)` shadow).
- Click-away: a `pointerdown` listener on `document` while a peek is open; if the target is
  outside the peek card and outside the rail, `dispatch({ type: 'esc' })`. Esc key handled
  on the card and in `Rail`.
- Hover-peek while collapsed: `pointerenter` on the rail when `!open` starts a 400ms timer →
  `dispatch({ type: 'peek', id: dockedId })` rendered as a peek card; a 300ms grace after the
  pointer leaves both the rail and the card dispatches `esc`. Clicking inside the hover-peek
  keeps it open until Esc/click-away.

### Motion (one recipe, in `LeftPanelCard.module.scss`)

- Open: `transform-origin: 0 var(--origin-y)` (the clicked icon's centre, passed as a CSS
  variable); `scale(.97) translateX(-6px)` + `opacity 0` → identity over `var(--speed-snap)
  var(--easing-base)`.
- Switch (docked, different panel): outgoing fades 120ms, incoming fades in with a 4px slide
  in the rail's direction of travel (up/down).
- Close: reverse of open, 140ms.
- Collapse/expand: the document's width changes with the card; no transition on the document
  (the webview reflows at its own pace).
- Reduced motion (`prefers-reduced-motion: reduce`): opacity only, 100ms; the indicator jumps;
  the ring is a static 8px dot; the ping is a static outline.

Not doing: dock magnification, hover-expanding labels, cursor spotlight, gradient border
around the chat card, skeleton shimmer, sound.

### Presence

`railpresence.core.ts`:

```ts
export function familyOf(command: string): string | null
// fs.writeFile | fs.writeJson | fs.writeFileBinary | assetMeta.*  → 'assets'
// imageEditor.* | fal.* | gemini.*                                → 'image-editor'
// style.*                                                         → 'project-styles'
// xrgs.*                                                          → 'maths-panel'
// component.* | nodelibrary.*                                     → 'components'
// git.commit | git.push                                           → 'versioncontrol' (recount only, no unseen)
// everything else                                                 → null
```

`reducePresence(state, { type: 'command', panelId, at })` increments `unseen` and sets
`lastAt`; `{ type: 'seen', panelId }` zeroes `unseen`. The store calls `markSeen(id)` on
`layoutChanged` for whichever id became visible. Ping: the Rail compares previous and next
`unseen` and plays the ping keyframe when it goes 0 → n. Tooltip suffix: `· 9 new since you
looked` from `unseen`.

The AI item's ring reads `AiActivity` (`ai-activity-changed`); its tooltip is the pill's
label plus elapsed time since the first `begin()` of the current run (tracked in the Rail
from the `active` edge).

`gitstatus.ts`: `count = (await new Git(dir).status()).length` where `dir` is
`ProjectModel.instance._retainedProjectDirectory`. Refresh on: project open, `git.commit` /
`git.push` bridge commands, window `focus`, and `Model.undoHistoryChanged` debounced 5s.
Skips silently when the directory is not a repo (`Git.isAvailable` precedent in the bridge).
The badge is the number of changed files reported by `git status` (project.json included);
the Version control panel's own `localChangesCount` counts diffed components and is a
different, richer figure. The tooltip says `3 uncommitted files`.

### Keyboard

| Binding | Action | Conflict check (EditorPage `useKeyboardCommands`, Keybindings.ts) |
|---|---|---|
| ⌘B | toggle card | free |
| ⌘⌥1 … ⌘⌥9 | click nth visible top-cluster item | free; ⌘1–3/⌘0 are preview presets, ⌘⌥ is distinct |
| ⌘F | Search (existing) | now dispatches `click('search')`, i.e. a peek when the chat is docked |
| Esc | close peek | local to Rail / card; does not reach the graph when a peek consumed it |
| ⌘⇧P (pin) | **not used** — taken by Cloud dashboard | pin is a button and the rail's context |

### Styling

Added to `glass.css`:

```css
:root {
  --rail-width: 48px;
  --card-bg: rgba(22, 22, 24, 0.62);          /* was inline in RightPropertyPanel */
  --card-blur: blur(40px) saturate(180%);
  --card-radius: 12px;
  --card-shadow: 0 0 0 0.5px rgba(255,255,255,.08), 0 8px 40px rgba(0,0,0,.45), 0 2px 12px rgba(0,0,0,.3);
  --card-shadow-peek: 0 0 0 0.5px rgba(255,255,255,.12), 0 24px 64px rgba(0,0,0,.6), 0 4px 16px rgba(0,0,0,.4);
  --speed-snap: 180ms;                         /* card open */
  --speed-move: 220ms;                         /* indicator, FLIP reorder */
  --theme-color-presence: var(--theme-color-publish);
}
```

Existing core-ui motion tokens (`animations.css`): `--speed-turbo` 100ms, `--speed-quick`
300ms, `--easing-base`. The two new speeds sit between turbo and quick on purpose; nothing
in the rail uses `--speed-quick` or slower.

Sizes: rail 48; items 28/radius 8; identity 28/radius 8; card header 40 (chromeless 32);
badge 14px/9px text; digit chip 13px.

### Error handling

- Panel component throws: the per-panel `ErrorBoundary` shows try-again, as today.
- `getThumbnailURI()` empty or the image fails to load: the initial renders.
- `Git.status()` rejects (not a repo, git missing): badge hidden, no toast, retried on the
  next trigger.
- `EditorSettings` missing `rail.*`: defaults (`chat-panel` docked, open, registration order).
- A stored `rail.docked` id that is no longer registered: fall back to the default.
- `assetOps.importFiles` rejects: the existing import toast reports it; the peek still opens.
- Overflow capacity below 1: every top-cluster item goes into `⋯`.

### Testing

Pure modules import nothing from the editor and run under Node's runner:

```
npx tsx --test packages/xgenia-editor/tests/rail/*.test.ts
```

Covered: `railLayout` (every action × every state, transient ids, restore), `railOrder`
(placement, order ties, user order, capacity 0/partial/full, overflow rollup), `railPresence`
(family map for every bridge family, unseen counting, seen reset, unknown commands), `panelWidth`
(clamp, snap inside/outside tolerance, storage round-trip with injected storage).

UI wiring: `cd packages/xgenia-editor && npm run build:renderer:dev` clean; launch the dev
build via the xgenia MCP, open a project, `xgenia_screenshot` and compare against the mockup
for: rail at 48px with the chip on the bar's row, chat docked by default, a rail click opening
a peek in front of it, Esc closing it, pin docking it, ⌘B hiding the card with the rail
staying, a drag on the edge showing the width chip, `xgenia_open_chat_panel` still finding
the button by its "Chat" tooltip.

### Rollout

Four PR-sized steps, each shippable:

1. **Structure** — Rail + LeftPanelCard + EditorPage layout; SidebarModel layout state (dock
   only, `peekId` always null); `icon` honoured, `placement` honoured, integer orders; tokens;
   bar toggle → model; width per panel; identity chip + project menu; chat docked by default;
   `SidePanel`, `iconMap`, `bottomIds`, `FrameDivider`, `SidebarWidthContext` deleted.
2. **Peek + motion** — peek/pin/esc/click-away; hover-peek while collapsed; card recipe;
   sliding indicator; tooltip group; ⌘B; ⌘⌥ digits and bindings.
3. **Presence** — `railpresence` + bridge hook; `gitstatus` + count badge; `project-assets-changed`
   + Assets refetch; unseen dots and pings; AI ring with elapsed tooltip.
4. **Direct manipulation** — resize chip + snap; drop on the Assets item; reorder; overflow.

### Risks

- `EditorBridge.ts` is ~3,500 lines. Edits are one-liners beside existing handlers; no
  control-flow changes.
- `SidebarModel.switch` has callers outside the rail (`component.switchTo` in the bridge,
  ⌘F, `onOpen` hooks). Mapping them to `click` keeps their behaviour when the target is
  docked and turns them into peeks otherwise, which is the intended change; the plan lists
  each caller.
- The chat iframe is expensive to remount. It never unmounts: `LeftPanelCard` keeps the
  docked panel mounted through peeks and through `open = false` (hidden, not removed), the
  same policy `SidePanel.tsx` had.
- `backdrop-filter` on a full-height 48px rail adds one compositing layer; the bar already
  pays this. Fallback under `@supports not (backdrop-filter)` is opaque `--theme-color-bg-2`.
- Hover-peek can feel jumpy if the timer is short; 400ms in, 300ms out are the mockup's
  numbers and are the only two constants to tune.

### Follow-ups (not in this spec)

Ambient backdrop tinted from the thumbnail; Image editor drop target; harness selectors
moved from tooltip text to `data-test`; "Open panel: …" entries in the ⌘K palette; per-page
thumbnails in the project menu.
