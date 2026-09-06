# Editor Left Rail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the editor's opaque 64px sidebar strip + docked panel with a 48px glass rail, a floating left panel card (twin of the right inspector), peek-in-front-of-the-chat panel opening, and a presence layer (AI ring, per-panel "changed since you looked" dots, uncommitted-files count).

**Architecture:** Three pure, dependency-free modules hold every decision (`railLayout` reducer, `railOrder` arrangement, `panelWidth` clamp/snap/storage) plus a pure presence core (`railpresence.core`), all unit-tested with Node's runner. `SidebarModel` gains a layout state driven by the reducer and persists it in `EditorSettings`. Two thin React trees (`Rail`, `LeftPanelCard`) render it; two small stores (`railpresence`, `gitstatus`) feed badges from one-line hooks in `EditorBridge`. `EditorPage` swaps `FrameDivider` for a flex row so the existing absolutely-positioned top bar spans the left card too.

**Tech Stack:** React 19, TypeScript, SCSS modules, core-ui (`IconButton`, `Tooltip`, `MenuDialog`, `TextInput`, `ErrorBoundary`), the bar's `GlassPopover`, `@hugeicons/react` wrappers in `SidebarIcons.tsx`, `@xgenia/git`, `@xgenia/platform` filesystem, Electron 31 (`shell`, `File.path`), Node test runner via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-06-editor-left-rail-redesign-design.md`

## Global Constraints

- Branch: `feature/topbar-redesign` (current). Commit after every task. **Never push** (user pushes). No `Co-Authored-By` trailer. Short plain commit messages.
- Unit tests: `npx tsx --test packages/xgenia-editor/tests/rail/<name>.test.ts` from the repo root. Pure modules import nothing from the editor (no `@xgenia-*` aliases, no React), so `tsx` can load them.
- Renderer build for wiring checks: `cd packages/xgenia-editor && npm run build:renderer:dev` must finish without TypeScript or webpack errors.
- Visual checks: the xgenia MCP against the dev build (`xgenia_health`, `xgenia_launch {target:'dev'}`, `xgenia_open_project {dir:'/Users/markfm/Downloads/NeonReelsV2'}`, `xgenia_screenshot`). Compare against the mockup at https://claude.ai/code/artifact/449c41b1-7db3-474f-8dfc-d96b35e94952.
- Colours only via tokens. New tokens live in `packages/xgenia-editor/src/editor/src/styles/custom-properties/glass.css`.
- Sizes: rail 48px; rail items 28px / radius 8; identity chip 28px / radius 8; card header 40px (32px when `chromeless`); card radius 12; badge 14px with 9px text; digit chip 13px.
- Motion: `--speed-snap: 180ms` (card open), `--speed-move: 220ms` (indicator, FLIP), `--easing-base` from core-ui. Every transition sits under `@media (prefers-reduced-motion: no-preference)` or has a `reduce` override.
- The chat rail item's `name` stays exactly `Chat`. The MCP harness finds the button by hovering rail icons and matching that tooltip (`packages/xgenia-mcp-server/src/index.ts:160`).
- EventDispatcher names introduced here: `rail-presence-changed`, `git-status-changed`, `project-assets-changed`. Removed: `toggle-left-panel`.
- No new npm dependencies.

---

## Verified codebase facts (checked 2026-09-06 — these OVERRIDE anything below that contradicts them)

1. **Layout today.** `pages/EditorPage/EditorPage.tsx:380-407` renders `<FrameDivider first={frameDividerSize > 0 ? <SidePanel /> : null} second={<div style={{display:'flex', position:'relative', …}}>…<Document/>…<RightPropertyPanel/></div>} />`. The row div's `position: relative` is what the bar anchors to (`EditorTopbar.module.scss:8` `position: absolute; inset: 0 0 auto 0`). `SidebarWidthContext` (`contexts/SidebarWidthContext.ts`) is consumed only by EditorPage.
2. **`toggle-left-panel`** is emitted once (`views/EditorTopbar/EditorTopbar.tsx:267`) and listened to once (`EditorPage.tsx:121`). `EditorTopbar` keeps `const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true)` at line 94 and imports `TopbarPanelClose, TopbarPanelOpen` from `../SidePanel/SidebarIcons` at line 29.
3. **`SidebarModel`** (`models/sidebar/sidebarmodel.tsx`): `SidebarItem` interface lines 10-50 (`icon?: IconName`, `order?`, `transient?`, `unmountWhenHidden?`, `placement?: 'top'|'bottom'`, `isDisabled?`, `experimental?`, `onOpen?`, `onClose?`, `onClick?`, `panelProps?`, `panel`). `SidebarModelEvent` enum lines 94-104 (`itemsChanged`, `activeChanged`, `nodeSelected`, `receivedCommand`, `HotReload`, `rightPanelChanged`). `register()` at 265 defaults `placement` to `'top'`. `switch(id)` at 289 calls `onClose`/`onOpen` hooks and lazily creates the panel via `createPanel(id, {})` + `setActivePanel` (388). `getVisibleItems()` at 252 filters `transient`. `reset()` at 210 clears everything. `models/sidebar/index.ts` re-exports `SidebarModel` and `type SidebarItem`.
4. **Panel registrations** live in `router.setup.ts:73-300` (`installSidePanel`). Every `register` today passes `icon: IconName.X`, which `SidePanel.tsx` ignores in favour of a hardcoded `iconMap` (`views/SidePanel/SidePanel.tsx:48-64`). Ids: `PropertyEditor`, `PortEditor`, `node-picker` (transient), `components`, `search`, `feedback-panel`, `versioncontrol`, `chat-panel`, `maths-panel`, `image-editor`, `project-styles`, `settings`, `node-references` (experimental), `assets` (experimental). `ChatPanel_ID = 'chat-panel'` (`views/panels/ChatPanelShell.tsx:13`); `FeedbackPanel_ID`, `VersionControlPanel_ID`, `MathsPanel_ID`, `SettingsPanel_ID`, `NodeReferencesPanel_ID` are imported constants.
5. **Icons.** `views/SidePanel/SidebarIcons.tsx` exports `makeIcon(hugeicon, name)` wrappers: `SideComponents`, `SideSearch`, `SideVersionControl`, `SideCloud`, `SideCloudFunctions`, `SideSettings`, `SideChatPanel`, `SideAiPanel`, `SideProjectStyles`, `SideNodeReferences`, `SideFeedback`, `SideImageEditor`, `SideMemoryPanel`, `SideMaths`, `SideAssets`, `SideAddNode`, `SideLogout`, plus `TopbarPanelOpen`, `TopbarPanelClose`, `TopbarPinned`, `TopbarUnpinned`. Each is a `React.ElementType` taking `size` and `color`.
6. **core-ui props.** `IconButton` (`inputs/IconButton`): `icon: IconName | React.ElementType`, `size?: IconSize`, `variant?: IconButtonVariant`, `state?: IconButtonState`, `isDisabled?`, `testId?`, `onClick?`, `UNSAFE_style?`, `UNSAFE_className?`, `iconColor?`. `Tooltip` (`popups/Tooltip`): `content`, `fineType?: string | string[]`, `showAfterMs?`, `renderDirection?: DialogRenderDirection`. `MenuDialog` (`popups/MenuDialog`): `items: (MenuDialogItem | 'divider')[]` where `MenuDialogItem = { label?, icon?: IconName, onClick?, endSlot?, key? }`, plus `isVisible`, `onClose`, `triggerRef`, `renderDirection`. `TextInput` (`inputs/TextInput`): `value`, `onChange`, `onEnter?`, `onBlur?`, `isAutoFocus?`, `placeholder?`. `ErrorBoundary` (`common/ErrorBoundary`): `showTryAgain`, `onTryAgain`.
7. **`GlassPopover`** (`views/EditorTopbar/topbar/GlassPopover.tsx`): `{ triggerRef, isVisible, onClose, width?, renderDirection?, children, UNSAFE_className? }`. Handles outside-click and Escape itself.
8. **`PanelActiveContext`** is exported from `views/panels/useIsActivePanel.ts:42` (`createContext(true)`); panels read it via `usePanelActive()`.
9. **`useModernModel(model, [events])`** (`hooks/useModel.ts:46`) re-renders on the listed model events. `Model.on(event, listener, group)` / `Model.off(group)`; `Model.notifyListeners(event, ...args)`. Every `notifyListeners` is mirrored on `EventDispatcher` as `'Model.' + event`.
10. **`EventDispatcher`** (`src/shared/utils/EventDispatcher.ts`): `on(event | event[], listener, group)`, `off(group)`, `emit(event, args?)`. Relative import from `models/`: `'../../../shared/utils/EventDispatcher'`; from `views/<Dir>/`: `'../../../../shared/utils/EventDispatcher'`.
11. **Keyboard.** `useKeyboardCommands(() => [{ handler, keybinding: number }], deps)` (`hooks/useKeyboardCommands.ts:8`). `KeyMod.CtrlCmd = 1<<11`, `KeyMod.Shift = 1<<10`, `KeyMod.Alt = 1<<9`; `KeyCode.KEY_B = 32`, `KEY_1 = 22` … `KEY_9 = 30` (`utils/keyboard/KeyCode.ts`). `Keybinding` (`utils/keyboard/Keybinding.ts`) has `.hash` and `.label`. Taken in EditorPage (257-323): ⌘F, ⌘D, ⌘⇧R, ⌘R, ⌘⇧X, ⌘⇧E, ⌘⇧P, ⌘P, ⌘K. Taken in Keybindings.ts: ⌘L, ⌘T, ⌘1/2/3, ⌘0, ⌘⇧D, ⌘⏎. **⌘B and ⌘⌥1–9 are free.**
12. **`EditorSettings.instance.get(key)` / `.set(key, data)`** (`utils/editorsettings.ts:99-111`), persisted to JSON storage, `set` emits `'updated'`.
13. **`ProjectModel.instance`**: `getThumbnailURI()` (line 656), `setThumbnailFromDataURI` emits `'thumbnailChanged'`; `rename(name)` (648) emits `'renamed'`; `name`; `_retainedProjectDirectory`. `App.instance.exitProject()` closes the project.
14. **Reveal precedent:** `shell.showItemInFolder(Path.normalize(ProjectModel.instance._retainedProjectDirectory + '/project.json'))` in `views/panels/ProjectSettingsTab/ProjectSettingsTab.tsx:39`.
15. **`aiactivity.ts`** exports `AiActivity.getSnapshot(): { active, label }`, `begin(label?)`, `end()`; emits `'ai-activity-changed'`. Fed at `EditorBridge.ts:523` (`AiActivity.begin();` inside `if (msg.type === 'command' && msg.id && msg.command)`).
16. **`EditorBridge` handlers** are registered with `h('<name>', fn)` inside `registerCommands()` (line 654). Anchors: `h('fs.writeFile', …)` 2705, `h('fs.writeJson', …)` 2806, `h('fs.writeFileBinary', …)` 2826, `h('assetMeta.set', …)` 2842, `h('git.commit', …)` 1990, `h('git.push', …)` 2089. Line numbers drift as you edit; grep the `h('` string.
17. **Git.** `import { Git } from '@xgenia/git'`; `import { mergeProject } from '@xgenia-utils/projectmerger'`; `const g = new Git(mergeProject); await g.openRepository(dir); const files = await g.status();` returns `{ status, path }[]` (`packages/xgenia-git/src/git.ts:110,204`).
18. **Assets.** `views/panels/AssetPanel/useProjectAssets.ts` returns `{ assets, isLoading, error, refetch }` and has no watcher (comment at 128). `AssetPanel.tsx:471-492` `handleFilesImport` only writes localStorage entries — it does not copy files; `currentPath` is `'/'` for the assets root and maps to `'assets' + currentPath` (line 271). `assetOps.ts` has `projectRoot()`, `assertUnderAssets(root, abs)`, `splitExt(name)` helpers and uses `filesystem` from `@xgenia/platform`: `exists(path)`, `writeFile(path, Buffer|string)`, `copyFile(from, to)`, `makeDirectory(path)`.
19. **Electron 31.3.1**: dropped `File` objects still expose `.path`.
20. **Right inspector material** lives in `views/RightPropertyPanel/RightPropertyPanel.module.scss` `.Root` (`background: rgba(22,22,24,.62)`, `backdrop-filter: blur(40px) saturate(180%)`, `border-radius: 12px`, the three-part `box-shadow`, `margin-top: 46px; margin-right: 8px; margin-bottom: 8px`). Its `.ResizeHandle` pattern (8px hit area, hairline on hover) is the one to mirror.
21. **`relativeTime.formatAgo(deltaMs)`** exists at `views/EditorTopbar/topbar/relativeTime.ts`.
22. **Core-ui `SideNavigation`** has other consumers (`DefaultApp.tsx`, stories). Do not modify it; the editor stops importing it.

---

## File Structure

All paths below `packages/xgenia-editor/` unless stated.

**Pure modules (tested, zero editor imports):**
- `src/editor/src/views/Rail/railLayout.ts` — `reduceRailLayout(state, action)`, `activePanelId(state)`.
- `src/editor/src/views/Rail/railOrder.ts` — `arrangeRail(items, userOrder, capacity)`, `railCapacity(height, bottomCount)`.
- `src/editor/src/views/LeftPanelCard/panelWidth.ts` — clamp, snap, per-panel storage.
- `src/editor/src/models/railpresence.core.ts` — `familyOf(command)`, `reducePresence(state, event)`.
- Tests: `tests/rail/railLayout.test.ts`, `railOrder.test.ts`, `panelWidth.test.ts`, `railPresence.test.ts`.

**Model + stores:**
- `src/editor/src/models/sidebar/sidebarmodel.tsx` — layout state, `dispatch`, persistence, `layoutChanged`.
- `src/editor/src/models/railpresence.ts` — store over the pure core; emits `rail-presence-changed`.
- `src/editor/src/models/gitstatus.ts` — uncommitted file count; emits `git-status-changed`.

**Components:**
- `src/editor/src/views/Rail/Rail.tsx`, `Rail.module.scss`, `RailButton.tsx`, `IdentityChip.tsx`, `ProjectMenu.tsx`, `useTooltipGroup.ts`, `index.ts`.
- `src/editor/src/views/LeftPanelCard/LeftPanelCard.tsx`, `LeftPanelCard.module.scss`, `PanelHost.tsx`, `index.ts`.
- `src/editor/src/views/panels/componentspanel/AddNodeAction.tsx`.

**Modified:** `pages/EditorPage/EditorPage.tsx`, `views/EditorTopbar/EditorTopbar.tsx`, `router.setup.ts`, `views/SidePanel/SidebarIcons.tsx`, `views/RightPropertyPanel/RightPropertyPanel.module.scss`, `styles/custom-properties/glass.css`, `constants/Keybindings.ts`, `views/panels/ChatPanelBridge/EditorBridge.ts`, `views/panels/AssetPanel/useProjectAssets.ts`, `views/panels/AssetPanel/AssetPanel.tsx`, `views/panels/AssetPanel/assetOps.ts`.

**Deleted:** `views/SidePanel/SidePanel.tsx`, `views/SidePanel/SidePanel.model.scss`, `views/SidePanel/index.ts`, `contexts/SidebarWidthContext.ts`.

---

## Step 1 — Structure

### Task 1: Tokens for the rail and the card

**Files:**
- Modify: `src/editor/src/styles/custom-properties/glass.css`
- Modify: `src/editor/src/views/RightPropertyPanel/RightPropertyPanel.module.scss:1-30`

**Interfaces:**
- Produces CSS custom properties: `--rail-width`, `--card-bg`, `--card-blur`, `--card-radius`, `--card-shadow`, `--card-shadow-peek`, `--speed-snap`, `--speed-move`, `--theme-color-presence`.

- [ ] **Step 1: Add the tokens**

Append inside the existing `:root { … }` block of `glass.css`:

```css
  /* ---- left rail + floating panel cards (2026-09-06) ---- */
  --rail-width: 48px;
  --card-bg: rgba(22, 22, 24, 0.62);
  --card-blur: blur(40px) saturate(180%);
  --card-radius: 12px;
  --card-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 8px 40px rgba(0, 0, 0, 0.45), 0 2px 12px rgba(0, 0, 0, 0.3);
  --card-shadow-peek: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 24px 64px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0, 0, 0, 0.4);
  --speed-snap: 180ms;
  --speed-move: 220ms;
  --theme-color-presence: var(--theme-color-publish);
```

- [ ] **Step 2: Point the right inspector at the tokens (no visual change)**

In `RightPropertyPanel.module.scss` `.Root`, replace the literal material lines:

```scss
    background: var(--card-bg);
    backdrop-filter: var(--card-blur);
    -webkit-backdrop-filter: var(--card-blur);
    border-radius: var(--card-radius);
    border: none;
    box-shadow: var(--card-shadow);
```

(keep `width`, `margin-top: 46px`, `margin-right: 8px`, `margin-bottom: 8px`, `z-index`, `animation`, `overflow` as they are).

- [ ] **Step 3: Build**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/styles/custom-properties/glass.css packages/xgenia-editor/src/editor/src/views/RightPropertyPanel/RightPropertyPanel.module.scss
git commit -m "Rail: card and rail tokens; inspector reads them"
```

---

### Task 2: `railLayout` reducer (pure)

**Files:**
- Create: `src/editor/src/views/Rail/railLayout.ts`
- Test: `tests/rail/railLayout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RailLayout { dockedId: string; peekId: string | null; open: boolean }
  export type RailAction =
    | { type: 'click'; id: string } | { type: 'peek'; id: string } | { type: 'pin' }
    | { type: 'close' } | { type: 'esc' } | { type: 'toggle' } | { type: 'dock'; id: string };
  export function reduceRailLayout(state: RailLayout, action: RailAction): RailLayout;
  export function activePanelId(state: RailLayout): string;   // peekId ?? dockedId
  ```

- [ ] **Step 1: Write the failing tests**

`tests/rail/railLayout.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reduceRailLayout, activePanelId, RailLayout } from '../../src/editor/src/views/Rail/railLayout';

const docked = (id = 'chat-panel', open = true): RailLayout => ({ dockedId: id, peekId: null, open });

test('click on another id opens it as a peek', () => {
  const s = reduceRailLayout(docked(), { type: 'click', id: 'components' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'components', open: true });
  assert.equal(activePanelId(s), 'components');
});

test('click on the peeked id closes the peek', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'components', open: true }, { type: 'click', id: 'components' });
  assert.deepEqual(s, docked());
});

test('click on the docked id toggles the card when nothing is peeking', () => {
  assert.equal(reduceRailLayout(docked(), { type: 'click', id: 'chat-panel' }).open, false);
  assert.equal(reduceRailLayout(docked('chat-panel', false), { type: 'click', id: 'chat-panel' }).open, true);
});

test('click on the docked id while peeking closes the peek and keeps the card open', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'search', open: true }, { type: 'click', id: 'chat-panel' });
  assert.deepEqual(s, docked());
});

test('click while the card is closed opens it with a peek', () => {
  const s = reduceRailLayout(docked('chat-panel', false), { type: 'click', id: 'assets' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'assets', open: true });
});

test('pin docks the peek', () => {
  const s = reduceRailLayout({ dockedId: 'chat-panel', peekId: 'components', open: true }, { type: 'pin' });
  assert.deepEqual(s, docked('components'));
});

test('pin with no peek is a no-op', () => {
  assert.deepEqual(reduceRailLayout(docked(), { type: 'pin' }), docked());
});

test('close closes the peek first, then the card', () => {
  const peeking: RailLayout = { dockedId: 'chat-panel', peekId: 'components', open: true };
  const s1 = reduceRailLayout(peeking, { type: 'close' });
  assert.deepEqual(s1, docked());
  const s2 = reduceRailLayout(s1, { type: 'close' });
  assert.deepEqual(s2, docked('chat-panel', false));
});

test('esc only closes a peek', () => {
  assert.deepEqual(reduceRailLayout({ dockedId: 'chat-panel', peekId: 'x', open: true }, { type: 'esc' }), docked());
  assert.deepEqual(reduceRailLayout(docked(), { type: 'esc' }), docked());
});

test('toggle flips open and drops any peek', () => {
  assert.deepEqual(reduceRailLayout({ dockedId: 'chat-panel', peekId: 'x', open: true }, { type: 'toggle' }), docked('chat-panel', false));
  assert.deepEqual(reduceRailLayout(docked('chat-panel', false), { type: 'toggle' }), docked());
});

test('peek opens the card and sets the peek even for the docked id', () => {
  const s = reduceRailLayout(docked('chat-panel', false), { type: 'peek', id: 'chat-panel' });
  assert.deepEqual(s, { dockedId: 'chat-panel', peekId: 'chat-panel', open: true });
});

test('dock replaces the docked id, opens, and drops the peek', () => {
  const s = reduceRailLayout({ dockedId: 'a', peekId: 'b', open: false }, { type: 'dock', id: 'c' });
  assert.deepEqual(s, docked('c'));
});

test('reducer never mutates its input', () => {
  const before = docked();
  const frozen = Object.freeze({ ...before });
  reduceRailLayout(frozen, { type: 'click', id: 'components' });
  assert.deepEqual(frozen, before);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railLayout.test.ts`
Expected: FAIL, cannot find module `railLayout`.

- [ ] **Step 3: Implement**

`src/editor/src/views/Rail/railLayout.ts`:

```ts
// Pure layout reducer for the left rail + panel card. No editor imports: tested with
// Node's runner. `dockedId` is the panel that lives in the card; `peekId` is a panel shown
// in a second card in front of it; `open` is whether the docked card is visible at all.

export interface RailLayout {
  dockedId: string;
  peekId: string | null;
  open: boolean;
}

export type RailAction =
  | { type: 'click'; id: string }
  | { type: 'peek'; id: string }
  | { type: 'pin' }
  | { type: 'close' }
  | { type: 'esc' }
  | { type: 'toggle' }
  | { type: 'dock'; id: string };

/** The panel the user is looking at (or would be, if the card were open). */
export function activePanelId(state: RailLayout): string {
  return state.peekId ?? state.dockedId;
}

export function reduceRailLayout(state: RailLayout, action: RailAction): RailLayout {
  switch (action.type) {
    case 'click': {
      if (action.id === state.peekId) return { ...state, peekId: null };
      if (action.id === state.dockedId) {
        if (state.peekId) return { ...state, peekId: null, open: true };
        return { ...state, open: !state.open };
      }
      return { ...state, peekId: action.id, open: true };
    }
    case 'peek':
      return { ...state, peekId: action.id, open: true };
    case 'pin':
      if (!state.peekId) return state;
      return { dockedId: state.peekId, peekId: null, open: true };
    case 'close':
      if (state.peekId) return { ...state, peekId: null };
      return { ...state, open: false };
    case 'esc':
      return state.peekId ? { ...state, peekId: null } : state;
    case 'toggle':
      return { ...state, peekId: null, open: !state.open };
    case 'dock':
      return { dockedId: action.id, peekId: null, open: true };
    default:
      return state;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railLayout.test.ts`
Expected: 13 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail/railLayout.ts packages/xgenia-editor/tests/rail/railLayout.test.ts
git commit -m "Rail: pure layout reducer"
```

---

### Task 3: `railOrder` arrangement (pure)

**Files:**
- Create: `src/editor/src/views/Rail/railOrder.ts`
- Test: `tests/rail/railOrder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RailOrderItem { id: string; name: string; order?: number; placement?: 'top' | 'bottom' }
  export interface RailArrangement<T> { top: T[]; bottom: T[]; overflow: T[] }
  export function arrangeRail<T extends RailOrderItem>(items: readonly T[], userOrder: readonly string[], capacity: number): RailArrangement<T>;
  export const RAIL_SLOT = 38;          // 28px item + 10px gap
  export function railCapacity(railHeight: number, bottomCount: number): number;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/rail/railOrder.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeRail, railCapacity, RAIL_SLOT } from '../../src/editor/src/views/Rail/railOrder';

const items = [
  { id: 'settings', name: 'Settings', order: 30, placement: 'bottom' as const },
  { id: 'components', name: 'Components', order: 20 },
  { id: 'chat-panel', name: 'Chat', order: 10 },
  { id: 'versioncontrol', name: 'Version control', order: 10, placement: 'bottom' as const },
  { id: 'search', name: 'Search', order: 30 },
  { id: 'assets', name: 'Assets', order: 40 },
  { id: 'zeta', name: 'Zeta', order: 40 },
  { id: 'alpha', name: 'Alpha', order: 40 }
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test('placement splits clusters; order then name sorts within them', () => {
  const a = arrangeRail(items, [], 99);
  assert.deepEqual(ids(a.top), ['chat-panel', 'components', 'search', 'alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
  assert.deepEqual(a.overflow, []);
});

test('user order wins for the ids it names; the rest follow by order', () => {
  const a = arrangeRail(items, ['search', 'assets'], 99);
  assert.deepEqual(ids(a.top), ['search', 'assets', 'chat-panel', 'components', 'alpha', 'zeta']);
});

test('user order ignores unknown ids and bottom ids', () => {
  const a = arrangeRail(items, ['ghost', 'settings', 'components'], 99);
  assert.deepEqual(ids(a.top), ['components', 'chat-panel', 'search', 'alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
});

test('capacity moves the tail of the top cluster into overflow', () => {
  const a = arrangeRail(items, [], 3);
  assert.deepEqual(ids(a.top), ['chat-panel', 'components', 'search']);
  assert.deepEqual(ids(a.overflow), ['alpha', 'assets', 'zeta']);
  assert.deepEqual(ids(a.bottom), ['versioncontrol', 'settings']);
});

test('capacity 0 sends every top item to overflow', () => {
  const a = arrangeRail(items, [], 0);
  assert.deepEqual(a.top, []);
  assert.equal(a.overflow.length, 6);
});

test('missing order sorts after numbered items', () => {
  const a = arrangeRail([{ id: 'b', name: 'B' }, { id: 'a', name: 'A', order: 5 }], [], 9);
  assert.deepEqual(ids(a.top), ['a', 'b']);
});

test('railCapacity counts 38px slots between the identity block and the bottom cluster', () => {
  // identity block = 8 + 28 + 22 = 58; bottom = n*38 + 21 (border 1 + padding 10 + margin 10)
  assert.equal(RAIL_SLOT, 38);
  assert.equal(railCapacity(1125, 3), Math.floor((1125 - 58 - (3 * 38 + 21) + 10) / 38));
  assert.equal(railCapacity(300, 3), 3);
  assert.equal(railCapacity(100, 3), 0);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railOrder.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/editor/src/views/Rail/railOrder.ts`:

```ts
// Which rail item goes where. Pure; no editor imports.

export interface RailOrderItem {
  id: string;
  name: string;
  order?: number;
  placement?: 'top' | 'bottom';
}

export interface RailArrangement<T> {
  top: T[];
  bottom: T[];
  overflow: T[];
}

/** 28px item + 10px gap. */
export const RAIL_SLOT = 38;
const IDENTITY_BLOCK = 8 + 28 + 22; // margin-top + chip + gap to the first item
const BOTTOM_CHROME = 1 + 10 + 10; // border-top + padding-top + margin-bottom

function byOrderThenName<T extends RailOrderItem>(a: T, b: T): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}

export function arrangeRail<T extends RailOrderItem>(
  items: readonly T[],
  userOrder: readonly string[],
  capacity: number
): RailArrangement<T> {
  const bottom = items.filter((i) => i.placement === 'bottom').sort(byOrderThenName);
  const topAll = items.filter((i) => i.placement !== 'bottom');

  const pinned: T[] = [];
  for (const id of userOrder) {
    const it = topAll.find((i) => i.id === id);
    if (it && !pinned.includes(it)) pinned.push(it);
  }
  const rest = topAll.filter((i) => !pinned.includes(i)).sort(byOrderThenName);
  const ordered = [...pinned, ...rest];

  const cap = Math.max(0, Math.floor(capacity));
  return { top: ordered.slice(0, cap), overflow: ordered.slice(cap), bottom };
}

/** How many top-cluster slots fit in a rail of `railHeight` px with `bottomCount` bottom items. */
export function railCapacity(railHeight: number, bottomCount: number): number {
  const bottomHeight = bottomCount * RAIL_SLOT + BOTTOM_CHROME;
  const available = railHeight - IDENTITY_BLOCK - bottomHeight + 10; // last item needs no trailing gap
  return Math.max(0, Math.floor(available / RAIL_SLOT));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railOrder.test.ts`
Expected: 7 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail/railOrder.ts packages/xgenia-editor/tests/rail/railOrder.test.ts
git commit -m "Rail: pure arrangement with user order and overflow"
```

---

### Task 4: `panelWidth` clamp / snap / storage (pure)

**Files:**
- Create: `src/editor/src/views/LeftPanelCard/panelWidth.ts`
- Test: `tests/rail/panelWidth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PANEL_WIDTH_MIN = 280, PANEL_WIDTH_MAX = 720, PANEL_WIDTH_DEFAULT = 380;
  export const PANEL_WIDTH_SNAPS = [320, 380, 450, 560], PANEL_WIDTH_SNAP_TOL = 12;
  export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
  export function clampPanelWidth(w: number): number;
  export function snapPanelWidth(w: number, stops?: readonly number[], tol?: number): number;
  export function panelWidthKey(id: string): string;
  export function readPanelWidth(storage: StorageLike | null, id: string, fallback: number): number;
  export function writePanelWidth(storage: StorageLike | null, id: string, w: number): void;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/rail/panelWidth.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampPanelWidth, snapPanelWidth, panelWidthKey, readPanelWidth, writePanelWidth,
  PANEL_WIDTH_MIN, PANEL_WIDTH_MAX
} from '../../src/editor/src/views/LeftPanelCard/panelWidth';

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => void m.set(k, v) };
}

test('clamp', () => {
  assert.equal(clampPanelWidth(10), PANEL_WIDTH_MIN);
  assert.equal(clampPanelWidth(9999), PANEL_WIDTH_MAX);
  assert.equal(clampPanelWidth(400.6), 401);
  assert.equal(clampPanelWidth(NaN), 380);
});

test('snap inside tolerance pulls to the stop, outside leaves it', () => {
  assert.equal(snapPanelWidth(388), 380);
  assert.equal(snapPanelWidth(372), 380);
  assert.equal(snapPanelWidth(393), 393);
  assert.equal(snapPanelWidth(455), 450);
  assert.equal(snapPanelWidth(500), 500);
});

test('storage round-trip per panel id', () => {
  const s = memStorage();
  assert.equal(panelWidthKey('chat-panel'), 'xgenia.leftPanel.width:chat-panel');
  assert.equal(readPanelWidth(s, 'chat-panel', 450), 450);
  writePanelWidth(s, 'chat-panel', 512);
  assert.equal(readPanelWidth(s, 'chat-panel', 450), 512);
  assert.equal(readPanelWidth(s, 'components', 380), 380);
});

test('garbage in storage falls back, null storage works in memory', () => {
  const s = memStorage();
  s.setItem(panelWidthKey('x'), 'banana');
  assert.equal(readPanelWidth(s, 'x', 380), 380);
  s.setItem(panelWidthKey('y'), '5000');
  assert.equal(readPanelWidth(s, 'y', 380), PANEL_WIDTH_MAX);
  assert.equal(readPanelWidth(null, 'z', 300), 300);
  assert.doesNotThrow(() => writePanelWidth(null, 'z', 300));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/panelWidth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`src/editor/src/views/LeftPanelCard/panelWidth.ts`:

```ts
// Width rules for the left panel card. Pure; storage is injected so tests use a Map.

export const PANEL_WIDTH_MIN = 280;
export const PANEL_WIDTH_MAX = 720;
export const PANEL_WIDTH_DEFAULT = 380;
export const PANEL_WIDTH_SNAPS: readonly number[] = [320, 380, 450, 560];
export const PANEL_WIDTH_SNAP_TOL = 12;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function clampPanelWidth(w: number): number {
  if (!Number.isFinite(w)) return PANEL_WIDTH_DEFAULT;
  return Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(w)));
}

export function snapPanelWidth(
  w: number,
  stops: readonly number[] = PANEL_WIDTH_SNAPS,
  tol: number = PANEL_WIDTH_SNAP_TOL
): number {
  for (const stop of stops) {
    if (Math.abs(w - stop) <= tol) return stop;
  }
  return w;
}

export function panelWidthKey(id: string): string {
  return `xgenia.leftPanel.width:${id}`;
}

export function readPanelWidth(storage: StorageLike | null, id: string, fallback: number): number {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(panelWidthKey(id));
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n) : fallback;
  } catch {
    return fallback;
  }
}

export function writePanelWidth(storage: StorageLike | null, id: string, w: number): void {
  if (!storage) return;
  try {
    storage.setItem(panelWidthKey(id), String(clampPanelWidth(w)));
  } catch {
    /* storage unavailable: width lives in memory for the session */
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/panelWidth.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/LeftPanelCard/panelWidth.ts packages/xgenia-editor/tests/rail/panelWidth.test.ts
git commit -m "Rail: pure panel width clamp, snap and storage"
```

---

### Task 5: `SidebarModel` layout state

**Files:**
- Modify: `src/editor/src/models/sidebar/sidebarmodel.tsx` (item type 10-50, enum 94-104, class body 138-408)

**Interfaces:**
- Consumes: `reduceRailLayout`, `activePanelId`, `RailLayout`, `RailAction` (Task 2).
- Produces on `SidebarModel.instance`:
  ```ts
  // SidebarItem additions
  icon?: IconName | React.ElementType;
  headerAction?: React.ComponentType;   // rendered in the card header (e.g. Add node)
  chromeless?: boolean;                 // iframe panels: header is pin/close only
  defaultWidth?: number;                // card width before the user drags it
  // events
  SidebarModelEvent.layoutChanged = 'layoutChanged'   // (layout: RailLayout)
  // members
  get Layout(): RailLayout
  dispatch(action: RailAction): void
  peek(id: string): void; pin(): void; closePeek(): void; toggleCard(): void
  getUserOrder(): string[]; setUserOrder(ids: string[]): void
  restoreLayout(): void       // from EditorSettings; call once panels are registered
  switch(id) → dispatch({ type: 'click', id })   // existing callers keep working
  ```

- [ ] **Step 1: Extend the item type and the enum**

In `SidebarItem` replace `icon?: IconName;` with:

```ts
  /** An IconName or one of the `Side*` wrappers from views/SidePanel/SidebarIcons. */
  icon?: IconName | React.ElementType;
  /** Rendered in the panel card's header, right of the title (e.g. Components' Add node). */
  headerAction?: React.ComponentType;
  /** The panel draws its own header (an iframe); the card shows pin/close only. */
  chromeless?: boolean;
  /** Card width before the user drags it. Default 380. */
  defaultWidth?: number;
```

Add to `SidebarModelEvent`:

```ts
  /** Occurs when the docked/peek/open layout of the left card changes. */
  layoutChanged = 'layoutChanged'
```

and to `SidebarModelEventEvents` (the type right below the enum) add the line:

```ts
  [SidebarModelEvent.layoutChanged]: (layout: RailLayout) => void;
```

Add the imports at the top of the file:

```ts
import { EditorSettings } from '@xgenia-utils/editorsettings';
import { activePanelId, reduceRailLayout, RailAction, RailLayout } from '../../views/Rail/railLayout';
```

(check the alias used elsewhere for `editorsettings` — `grep -rn "editorsettings'" src/editor/src/models | head -1` — and copy it.)

- [ ] **Step 2: Add layout state and `dispatch`**

Inside the class, after `private groupRef = {};`:

```ts
  private static readonly SETTINGS_DOCKED = 'rail.docked';
  private static readonly SETTINGS_OPEN = 'rail.open';
  private static readonly SETTINGS_ORDER = 'rail.order';

  private layout: RailLayout = { dockedId: 'components', peekId: null, open: true };

  public get Layout(): RailLayout {
    return { ...this.layout };
  }

  /** Which panel id should be docked when nothing is stored. */
  private defaultDockedId(): string {
    if (this.items.some((x) => x.id === 'chat-panel')) return 'chat-panel';
    const first = this.getVisibleItems()[0];
    return first ? first.id : 'components';
  }

  /** Read the stored layout. Call once the panels for this project are registered. */
  public restoreLayout(): void {
    const storedDocked = EditorSettings.instance.get(SidebarModel.SETTINGS_DOCKED);
    const storedOpen = EditorSettings.instance.get(SidebarModel.SETTINGS_OPEN);
    const dockedId =
      typeof storedDocked === 'string' && this.items.some((x) => x.id === storedDocked && !x.transient)
        ? storedDocked
        : this.defaultDockedId();
    this.dispatch({ type: 'dock', id: dockedId });
    if (storedOpen === false) this.dispatch({ type: 'toggle' });
  }

  public getUserOrder(): string[] {
    const v = EditorSettings.instance.get(SidebarModel.SETTINGS_ORDER);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  }

  public setUserOrder(ids: string[]): void {
    EditorSettings.instance.set(SidebarModel.SETTINGS_ORDER, ids);
    this.notifyListeners(SidebarModelEvent.itemsChanged);
  }

  /** Make sure a panel component exists for `id`; transient panels are recreated. */
  private ensurePanel(id: string): void {
    const item = this.items.find((x) => x.id === id);
    if (!item) throw new Error(`Panel not found. (${id})`);
    if (item.transient || !this.panels[id]) {
      this.panels[id] = createPanel(id, {});
    }
  }

  public dispatch(action: RailAction): void {
    const before = this.layout;
    let next: RailLayout;
    try {
      next = reduceRailLayout(before, action);
      this.ensurePanel(next.dockedId);
      if (next.peekId) this.ensurePanel(next.peekId);
    } catch (error) {
      // A missing panel (user code, hot reload) must not wedge the rail.
      console.error(error);
      return;
    }
    if (next === before) return;

    const prevActive = activePanelId(before);
    const nextActive = activePanelId(next);
    if (prevActive !== nextActive) {
      const lastActiveTab = this.items.find((x) => x.id === prevActive);
      lastActiveTab?.onClose?.();
    }

    this.previousActiveId = this.activeId;
    this.activeId = nextActive;
    this.layout = next;

    if (next.dockedId !== before.dockedId) EditorSettings.instance.set(SidebarModel.SETTINGS_DOCKED, next.dockedId);
    if (next.open !== before.open) EditorSettings.instance.set(SidebarModel.SETTINGS_OPEN, next.open);

    this.notifyListeners(SidebarModelEvent.layoutChanged, this.Layout);
    if (prevActive !== nextActive) {
      this.notifyListeners(SidebarModelEvent.activeChanged, this.activeId, this.previousActiveId);
      const newActiveTab = this.items.find((x) => x.id === nextActive);
      newActiveTab?.onOpen?.();
    }
  }

  public peek(id: string): void {
    this.dispatch({ type: 'peek', id });
  }

  public pin(): void {
    this.dispatch({ type: 'pin' });
  }

  public closePeek(): void {
    this.dispatch({ type: 'esc' });
  }

  public toggleCard(): void {
    this.dispatch({ type: 'toggle' });
  }
```

- [ ] **Step 3: Route `switch` through `dispatch`; keep `setActivePanel` for `switchToNode`**

Replace the whole body of `public switch(id: string): boolean` with:

```ts
  public switch(id: string): boolean {
    // Existing callers (⌘F, component.switchTo, onOpen hooks) get the rail's click
    // semantics: docked → toggle, otherwise → peek.
    if (!this.items.some((x) => x.id === id)) {
      console.error(`Panel not found. (${id})`);
      return false;
    }
    this.dispatch({ type: 'click', id });
    return true;
  }
```

`setActivePanel` (used by nothing else after this change — verify with `grep -n setActivePanel`) can be deleted. `reset()` additionally sets `this.layout = { dockedId: 'components', peekId: null, open: true };`.

- [ ] **Step 4: Build**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean. (`SidePanel.tsx` still compiles: it reads `ActiveId` and `activeChanged`, both still emitted.)

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/models/sidebar/sidebarmodel.tsx
git commit -m "SidebarModel: docked/peek/open layout driven by the rail reducer"
```

---

### Task 6: Registrations carry their icon, placement, order and header action

**Files:**
- Create: `src/editor/src/views/panels/componentspanel/AddNodeAction.tsx`
- Modify: `src/editor/src/router.setup.ts:73-300`
- Modify: `src/editor/src/views/SidePanel/SidebarIcons.tsx` (remove five dead exports)

**Interfaces:**
- Consumes: `SidebarItem.icon | headerAction | chromeless | defaultWidth` (Task 5); `Side*` icons.
- Produces: registrations the rail renders without a lookup table.

- [ ] **Step 1: The Add node header action**

`src/editor/src/views/panels/componentspanel/AddNodeAction.tsx`:

```tsx
import React from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { SideAddNode } from '../../SidePanel/SidebarIcons';

import css from './AddNodeAction.module.scss';

/** The green + that used to sit at the top of the sidebar strip. Opens the node picker as a peek. */
export function AddNodeAction() {
  return (
    <button
      type="button"
      className={css.Root}
      onClick={() => SidebarModel.instance.peek('node-picker')}
      aria-label="Add node"
      data-test="add-node-action"
    >
      <SideAddNode size={12} color="currentColor" />
      <span>Add node</span>
    </button>
  );
}
```

`AddNodeAction.module.scss`:

```scss
.Root {
  height: 24px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: 500 11px/1 var(--font-family-regular);
  color: var(--theme-color-on-primary, #062b1c);
  background: var(--theme-color-publish);
  cursor: pointer;

  &:hover { filter: brightness(1.06); }
  &:focus-visible { outline: 2px solid var(--theme-color-fg-highlight); outline-offset: 1px; }
}
```

- [ ] **Step 2: Rewrite the registrations**

In `router.setup.ts`, add the import:

```ts
import {
  SideComponents, SideSearch, SideVersionControl, SideSettings, SideChatPanel, SideProjectStyles,
  SideNodeReferences, SideFeedback, SideImageEditor, SideMaths, SideAssets, SideAddNode
} from './views/SidePanel/SidebarIcons';
import { AddNodeAction } from './views/panels/componentspanel/AddNodeAction';
```

Then change each `register` call's `icon`, `order`, `placement` and the new fields. Final values:

| id | icon | order | placement | extra |
|---|---|---|---|---|
| `node-picker` | `SideAddNode` | 5 | top (transient) | — |
| `chat-panel` | `SideChatPanel` | 10 | top | `chromeless: true`, `defaultWidth: 450` (name stays `'Chat'`) |
| `components` | `SideComponents` | 20 | top | `headerAction: AddNodeAction` |
| `search` | `SideSearch` | 30 | top | — |
| `assets` | `SideAssets` | 40 | top (experimental) | — |
| `project-styles` | `SideProjectStyles` | 50 | top | — |
| `maths-panel` | `SideMaths` | 60 | top | — |
| `image-editor` | `SideImageEditor` | 70 | top | — |
| `node-references` | `SideNodeReferences` | 80 | top (experimental) | — |
| `versioncontrol` | `SideVersionControl` | 10 | `'bottom'` | — |
| `feedback-panel` | `SideFeedback` | 20 | `'bottom'` | — |
| `settings` | `SideSettings` | 30 | `'bottom'` | — |

`PropertyEditor` and `PortEditor` keep no icon (transient, right side). Delete the `IconName` import from `router.setup.ts` if nothing else uses it.

- [ ] **Step 3: Drop dead icon exports**

In `SidebarIcons.tsx` delete `SideCloud`, `SideCloudFunctions`, `SideAiPanel`, `SideMemoryPanel`, `SideLogout` and their hugeicon imports (`CloudIcon`, `FlashIcon`, `Telescope01Icon`, `Logout01Icon`; keep `Brain01Icon` for `SideChatPanel`). `SidePanel.tsx` still imports them — that file is deleted in Task 10; until then build with `SidePanel.tsx`'s import list trimmed to the survivors.

- [ ] **Step 4: Build**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/router.setup.ts packages/xgenia-editor/src/editor/src/views/SidePanel/SidebarIcons.tsx packages/xgenia-editor/src/editor/src/views/SidePanel/SidePanel.tsx packages/xgenia-editor/src/editor/src/views/panels/componentspanel/AddNodeAction.tsx packages/xgenia-editor/src/editor/src/views/panels/componentspanel/AddNodeAction.module.scss
git commit -m "Panels register their own icon, placement and header action"
```

---

### Task 7: `RailButton`, tooltip group and the `Rail`

**Files:**
- Create: `src/editor/src/views/Rail/useTooltipGroup.ts`
- Create: `src/editor/src/views/Rail/RailButton.tsx`
- Create: `src/editor/src/views/Rail/Rail.tsx`
- Create: `src/editor/src/views/Rail/Rail.module.scss`
- Create: `src/editor/src/views/Rail/index.ts`

**Interfaces:**
- Consumes: `SidebarModel.instance.{getVisibleItems, Layout, dispatch, getUserOrder}`, `SidebarModelEvent.{itemsChanged, layoutChanged}`, `arrangeRail`, `railCapacity`, `activePanelId`.
- Produces:
  ```ts
  export interface RailButtonProps {
    id: string; name: string; icon: React.ElementType | IconName; fineType?: string;
    isActive: boolean; isDisabled?: boolean;
    badge?: { count?: number; unseen?: boolean; ring?: boolean };
    digit?: number;                          // ⌘⌥ reveal (Task 12)
    tooltipSuffix?: string;                  // "· 9 new since you looked" (Task 13)
    onClick(): void;
    onPointerDownCapture?(e: React.PointerEvent): void;   // reorder (Task 18)
    onDrop?(files: FileList): void; isDropTarget?: boolean; // drop mode (Task 17)
  }
  export function Rail(): JSX.Element
  ```
  `useTooltipGroup()` returns `{ showAfterMs: number; noteClosed(): void }`.

- [ ] **Step 1: Tooltip group**

`useTooltipGroup.ts`:

```ts
import { useCallback, useRef, useState } from 'react';

const COLD_MS = 300;
const WARM_WINDOW_MS = 500;

/**
 * The first tooltip in a cluster waits; the next one within 500ms shows at once. core-ui's
 * Tooltip has only `showAfterMs`, so the group tracks when the last one closed and hands
 * each button the delay to use.
 */
export function useTooltipGroup() {
  const lastClosedAt = useRef(0);
  const [, force] = useState(0);
  const noteClosed = useCallback(() => {
    lastClosedAt.current = Date.now();
    force((n) => n + 1);
  }, []);
  const showAfterMs = Date.now() - lastClosedAt.current < WARM_WINDOW_MS ? 0 : COLD_MS;
  return { showAfterMs, noteClosed };
}
```

- [ ] **Step 2: RailButton**

`RailButton.tsx`:

```tsx
import classNames from 'classnames';
import React from 'react';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonState, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import css from './Rail.module.scss';

export interface RailButtonProps {
  id: string;
  name: string;
  icon: React.ElementType | IconName;
  fineType?: string;
  isActive: boolean;
  isDisabled?: boolean;
  badge?: { count?: number; unseen?: boolean; ring?: boolean };
  digit?: number;
  tooltipSuffix?: string;
  showAfterMs: number;
  onTooltipClosed?: () => void;
  onClick: () => void;
  onPointerDownCapture?: (e: React.PointerEvent<HTMLDivElement>) => void;
  isDropTarget?: boolean;
  isDropDimmed?: boolean;
  onDrop?: (files: FileList) => void;
}

export function RailButton(props: RailButtonProps) {
  const { badge } = props;
  const content = props.tooltipSuffix ? `${props.name} ${props.tooltipSuffix}` : props.name;

  return (
    <div
      className={classNames(css.Item, props.isActive && css['is-active'], props.isDropTarget && css['is-drop-target'], props.isDropDimmed && css['is-drop-dimmed'])}
      data-rail-id={props.id}
      onPointerDownCapture={props.onPointerDownCapture}
      onMouseLeave={props.onTooltipClosed}
      onDragOver={props.onDrop ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } : undefined}
      onDrop={props.onDrop ? (e) => { e.preventDefault(); e.stopPropagation(); props.onDrop!(e.dataTransfer.files); } : undefined}
    >
      <Tooltip content={content} fineType={props.fineType} renderDirection={DialogRenderDirection.Horizontal} showAfterMs={props.showAfterMs}>
        <IconButton
          icon={props.icon}
          size={IconSize.Small}
          variant={IconButtonVariant.Transparent}
          state={props.isActive ? IconButtonState.Active : IconButtonState.Default}
          isDisabled={props.isDisabled}
          onClick={props.onClick}
          testId={`${props.id}-panel`}
          aria-label={props.name}
          UNSAFE_className={css.Button}
        />
      </Tooltip>
      {badge?.ring && <span className={css.Ring} aria-hidden="true" />}
      {badge?.count !== undefined && badge.count > 0 && (
        <span className={css.Count} aria-label={`${badge.count}`}>{badge.count > 99 ? '99+' : badge.count}</span>
      )}
      {badge?.unseen && badge.count === undefined && <span className={css.Unseen} aria-hidden="true" />}
      {props.digit !== undefined && <span className={css.Digit} aria-hidden="true">{props.digit}</span>}
    </div>
  );
}
```

If `IconButton` does not forward `aria-label` (fact 6 lists no such prop), wrap: put `aria-label` and `role="button"` on the outer `div` instead and leave `IconButton` without it. Check `inputs/IconButton/IconButton.tsx` for `{...rest}` spreading before deciding.

- [ ] **Step 3: The Rail**

`Rail.tsx` (dock-only for now; peek, digits, presence, drop and reorder arrive in later tasks — the props exist so those tasks only add state):

```tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { IdentityChip } from './IdentityChip';
import { RailButton } from './RailButton';
import { activePanelId } from './railLayout';
import { arrangeRail, railCapacity, RAIL_SLOT } from './railOrder';
import { useTooltipGroup } from './useTooltipGroup';
import css from './Rail.module.scss';

export function Rail() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.itemsChanged, SidebarModelEvent.layoutChanged]);
  const items = sidebar.getVisibleItems();
  const layout = sidebar.Layout;
  const active = layout.open ? activePanelId(layout) : null;
  const tips = useTooltipGroup();

  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  const bottomCount = items.filter((i) => i.placement === 'bottom').length;
  const capacity = height ? railCapacity(height, bottomCount) : 99;
  const arrangement = useMemo(
    () => arrangeRail(items, sidebar.getUserOrder(), capacity),
    [items, capacity, sidebar]
  );

  // Sliding indicator: index of the active item within the rendered top cluster.
  const activeTopIndex = arrangement.top.findIndex((i) => i.id === active);
  const indicatorY = activeTopIndex >= 0 ? activeTopIndex * RAIL_SLOT + 7 : null;

  return (
    <div ref={rootRef} className={css.Root} role="toolbar" aria-orientation="vertical" aria-label="Panels" data-test="rail">
      <IdentityChip />

      <div className={css.Top}>
        {indicatorY !== null && <span className={css.Indicator} style={{ transform: `translateY(${indicatorY}px)` }} aria-hidden="true" />}
        {arrangement.top.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            name={item.name}
            icon={item.icon as React.ElementType}
            fineType={item.fineType}
            isActive={item.id === active}
            isDisabled={item.isDisabled}
            showAfterMs={tips.showAfterMs}
            onTooltipClosed={tips.noteClosed}
            onClick={() => {
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
          />
        ))}
      </div>

      <div className={css.Bottom}>
        {arrangement.bottom.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            name={item.name}
            icon={item.icon as React.ElementType}
            fineType={item.fineType}
            isActive={item.id === active}
            isDisabled={item.isDisabled}
            showAfterMs={tips.showAfterMs}
            onTooltipClosed={tips.noteClosed}
            onClick={() => {
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

`index.ts`: `export { Rail } from './Rail';`

- [ ] **Step 4: Styles**

`Rail.module.scss`:

```scss
.Root {
  position: relative;
  flex: 0 0 var(--rail-width);
  width: var(--rail-width);
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  background: var(--glass-bar-bg);
  -webkit-backdrop-filter: var(--glass-bar-blur);
  backdrop-filter: var(--glass-bar-blur);
  border-right: 1px solid var(--glass-bar-border);
  box-sizing: border-box;
  user-select: none;

  @supports not (backdrop-filter: blur(1px)) {
    background: var(--theme-color-bg-2);
  }
}

.Top {
  position: relative;
  margin-top: 22px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.Bottom {
  margin-top: auto;
  margin-bottom: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--glass-bar-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.Item {
  position: relative;
  width: 28px;
  height: 28px;
}

.Button {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--theme-color-fg-default-shy, var(--theme-color-fg-default));

  .is-active & {
    background: var(--glass-ctrl-bg);
    box-shadow: var(--glass-ctrl-shadow);
    color: var(--theme-color-fg-highlight);
  }
}

/* One accent bar travels between active items. `top: 7px` inside a 28px slot = 14px tall, centred. */
.Indicator {
  position: absolute;
  left: calc((var(--rail-width) - 28px) / -2);
  top: 0;
  width: 2px;
  height: 14px;
  border-radius: 0 1px 1px 0;
  background: var(--theme-color-presence);
  pointer-events: none;

  @media (prefers-reduced-motion: no-preference) {
    transition: transform var(--speed-move) var(--easing-base);
  }
}

.Count {
  position: absolute;
  right: -4px;
  bottom: -4px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  border-radius: 7px;
  box-sizing: border-box;
  font: 600 9px/14px var(--font-family-regular);
  font-variant-numeric: tabular-nums;
  text-align: center;
  color: #1a1405;
  background: var(--theme-color-attention);
  pointer-events: none;
}

.Unseen {
  position: absolute;
  right: -1px;
  top: -1px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--theme-color-attention);
  box-shadow: 0 0 0 2px var(--theme-color-bg-1);
  pointer-events: none;
}

.Ring {
  position: absolute;
  inset: -3px;
  border-radius: 11px;
  padding: 2px;
  background: conic-gradient(from var(--rail-ring-angle, 0deg), var(--theme-color-presence) 0 25%, transparent 25% 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;

  @media (prefers-reduced-motion: no-preference) {
    animation: rail-ring 1.4s linear infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    inset: auto -2px -2px auto;
    width: 8px;
    height: 8px;
    padding: 0;
    border-radius: 50%;
    background: var(--theme-color-presence);
    -webkit-mask: none;
    mask: none;
  }
}

@property --rail-ring-angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}

@keyframes rail-ring {
  to { --rail-ring-angle: 360deg; }
}

.Digit {
  position: absolute;
  right: -5px;
  top: -5px;
  min-width: 13px;
  height: 13px;
  padding: 0 2px;
  border-radius: 4px;
  box-sizing: border-box;
  font: 600 9px/13px var(--font-family-regular);
  text-align: center;
  color: var(--theme-color-bg-1);
  background: var(--theme-color-fg-highlight);
  pointer-events: none;
}

.is-drop-dimmed { opacity: 0.35; }
.is-drop-target .Button {
  transform: scale(1.12);
  box-shadow: 0 0 0 2px var(--theme-color-presence);
}
```

- [ ] **Step 5: Build (Rail is not mounted yet; it only has to compile)**

`IdentityChip` does not exist until Task 8. For this build, create a placeholder `IdentityChip.tsx` exporting `export function IdentityChip() { return <div className={css.Identity} /> }` — Task 8 replaces it.

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail: button, tooltip group and the rail component"
```

---

### Task 8: Identity chip and project menu

**Files:**
- Create: `src/editor/src/views/Rail/IdentityChip.tsx` (replaces the placeholder)
- Create: `src/editor/src/views/Rail/ProjectMenu.tsx`
- Modify: `src/editor/src/views/Rail/Rail.module.scss` (append `.Identity*`)

**Interfaces:**
- Consumes: `ProjectModel.instance.{getThumbnailURI, name, _retainedProjectDirectory, rename}`, `App.instance.exitProject`, `GlassPopover`, `TextInput`, `shell` from electron, `SidebarModel.instance.dispatch`.

- [ ] **Step 1: IdentityChip**

```tsx
import React, { useEffect, useRef, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';

import { ProjectMenu } from './ProjectMenu';
import css from './Rail.module.scss';

function readIdentity() {
  const pm = ProjectModel.instance;
  return { name: pm?.name || 'Project', thumb: pm?.getThumbnailURI?.() || '' };
}

export function IdentityChip() {
  const [identity, setIdentity] = useState(readIdentity);
  const [isOpen, setIsOpen] = useState(false);
  const [imgBroken, setImgBroken] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const group = {};
    const refresh = () => {
      setImgBroken(false);
      setIdentity(readIdentity());
    };
    ProjectModel.instance.on('thumbnailChanged', refresh, group);
    ProjectModel.instance.on('renamed', refresh, group);
    return () => ProjectModel.instance.off(group);
  }, []);

  const initial = identity.name.trim().charAt(0).toUpperCase() || '·';
  const showImage = identity.thumb && !imgBroken;

  return (
    <>
      <Tooltip content={identity.name} renderDirection={DialogRenderDirection.Horizontal} showAfterMs={300}>
        <button
          ref={ref}
          type="button"
          className={css.Identity}
          onClick={() => setIsOpen((v) => !v)}
          aria-label={`Project: ${identity.name}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          data-test="rail-identity"
        >
          {showImage ? <img src={identity.thumb} alt="" onError={() => setImgBroken(true)} /> : <span>{initial}</span>}
        </button>
      </Tooltip>
      <ProjectMenu triggerRef={ref} isVisible={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: ProjectMenu**

```tsx
import { shell } from 'electron';
import Path from 'path';
import React, { useEffect, useState } from 'react';

import { App } from '@xgenia-models/app';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';

import { GlassPopover } from '../EditorTopbar/topbar/GlassPopover';
import { SideLogoutIcon, SideRevealIcon, SideRenameIcon, SideSettings } from '../SidePanel/SidebarIcons';
import css from './Rail.module.scss';

interface Props {
  triggerRef: React.RefObject<HTMLElement>;
  isVisible: boolean;
  onClose: () => void;
}

function homeTilde(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return home && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

export function ProjectMenu({ triggerRef, isVisible, onClose }: Props) {
  const pm = ProjectModel.instance;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!isVisible) setRenaming(false);
  }, [isVisible]);

  const dir = String(pm?._retainedProjectDirectory || '');

  function commitRename() {
    const next = draft.trim();
    if (next && next !== pm.name) pm.rename(next);
    setRenaming(false);
  }

  const Item = ({ icon: Icon, label, onClick, danger }: { icon: React.ElementType; label: string; onClick: () => void; danger?: boolean }) => (
    <button type="button" className={danger ? `${css.MenuItem} ${css['is-danger']}` : css.MenuItem} onClick={() => { onClick(); onClose(); }}>
      <Icon size={14} color="currentColor" />
      <span>{label}</span>
    </button>
  );

  return (
    <GlassPopover triggerRef={triggerRef} isVisible={isVisible} onClose={onClose} width={260} renderDirection={DialogRenderDirection.Horizontal} UNSAFE_className={css.Menu}>
      <div className={css.MenuHead}>
        {renaming ? (
          <TextInput value={draft} isAutoFocus onChange={(e) => setDraft(e.target.value)} onEnter={commitRename} onBlur={commitRename} placeholder="Project name" />
        ) : (
          <b>{pm?.name}</b>
        )}
        <span title={dir}>{homeTilde(dir)}</span>
      </div>
      <Item icon={SideRenameIcon} label="Rename project" onClick={() => { setDraft(pm.name || ''); setRenaming(true); }} />
      <Item icon={SideRevealIcon} label="Reveal in Finder" onClick={() => shell.showItemInFolder(Path.normalize(dir + '/project.json'))} />
      <Item icon={SideSettings} label="Project settings" onClick={() => SidebarModel.instance.dispatch({ type: 'click', id: 'settings' })} />
      <div className={css.MenuRule} />
      <Item icon={SideLogoutIcon} label="Close project" danger onClick={() => App.instance.exitProject()} />
    </GlassPopover>
  );
}
```

The Rename `Item` closes the menu via `onClose()` in the wrapper; for rename that is wrong — write it as a plain button that does not call `onClose` (copy the `Item` markup inline with `onClick={() => { setDraft(pm.name || ''); setRenaming(true); }}` only).

Add to `SidebarIcons.tsx` (hugeicons `core-free-icons`): `SideRenameIcon = makeIcon(Edit02Icon, 'SideRenameIcon')`, `SideRevealIcon = makeIcon(FolderOpenIcon, 'SideRevealIcon')`, `SideLogoutIcon = makeIcon(Logout01Icon, 'SideLogoutIcon')` (re-add the `Logout01Icon` import removed in Task 6). Check the exact icon names exist under `node_modules/@hugeicons/core-free-icons/` before importing; substitute the nearest if not.

- [ ] **Step 3: Styles (append to `Rail.module.scss`)**

```scss
.Identity {
  width: 28px;
  height: 28px;
  margin-top: 8px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #3b2f6e, #1d3a33);
  color: var(--theme-color-fg-highlight);
  font: 600 12px/1 var(--font-family-regular);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 1px 2px rgba(0, 0, 0, 0.4);
  cursor: pointer;

  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  &[aria-expanded='true'] { box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 0 0 2px rgba(52, 211, 153, 0.5); }
  &:focus-visible { outline: 2px solid var(--theme-color-fg-highlight); outline-offset: 1px; }
}

.Menu { padding: 6px; font-size: 12px; }
.MenuHead {
  padding: 8px 10px 10px;
  margin-bottom: 4px;
  border-bottom: 1px solid var(--glass-bar-border);
  display: flex; flex-direction: column; gap: 2px;
  b { font-size: 13px; color: var(--theme-color-fg-highlight); }
  span { font-size: 11px; color: var(--theme-color-fg-default-shy, var(--theme-color-fg-default)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}
.MenuItem {
  width: 100%; height: 28px; padding: 0 8px; border: 0; border-radius: 6px;
  display: flex; align-items: center; gap: 10px;
  background: transparent; color: var(--theme-color-fg-highlight);
  font: 12px/1 var(--font-family-regular); text-align: left; cursor: pointer;
  &:hover { background: var(--glass-ctrl-bg); }
  &.is-danger { color: var(--theme-color-danger, #f87171); }
}
.MenuRule { height: 1px; margin: 4px 0; background: var(--glass-bar-border); }
```

- [ ] **Step 4: Build**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail packages/xgenia-editor/src/editor/src/views/SidePanel/SidebarIcons.tsx
git commit -m "Rail: identity chip with project menu"
```

---

### Task 9: `LeftPanelCard` and `PanelHost` (docked only)

**Files:**
- Create: `src/editor/src/views/LeftPanelCard/PanelHost.tsx`
- Create: `src/editor/src/views/LeftPanelCard/LeftPanelCard.tsx`
- Create: `src/editor/src/views/LeftPanelCard/LeftPanelCard.module.scss`
- Create: `src/editor/src/views/LeftPanelCard/index.ts`

**Interfaces:**
- Consumes: `SidebarModel.instance.{Layout, getPanel, getPanelComponent, dispatch, pin}`, `SidebarModelEvent.{layoutChanged, HotReload}`, `PanelActiveContext`, `panelWidth.*`.
- Produces:
  ```ts
  export function LeftPanelCard(): JSX.Element | null            // renders the docked card (and, from Task 11, the peek card)
  export function PanelHost(props: { visibleId: string | null; keepMounted: boolean }): JSX.Element
  ```

- [ ] **Step 1: PanelHost (the keep-mounted logic that lived in `SidePanel.tsx`)**

```tsx
import { nextTick } from 'process';
import React, { ReactNode, useEffect, useState } from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary';

import { PanelActiveContext } from '../panels/useIsActivePanel';
import css from './LeftPanelCard.module.scss';

interface Props {
  /** The panel to show. Others stay mounted and hidden when `keepMounted` is true. */
  visibleId: string | null;
  keepMounted: boolean;
}

/**
 * Every panel opened in this host stays mounted and is hidden with `display: none`, so
 * switching back is instant and keeps its state — and, for remote iframes, avoids
 * re-booting a whole application on every switch. `PanelActiveContext` tells a hidden
 * panel it is off screen so the expensive ones can idle. `unmountWhenHidden` on the item
 * is the stronger opt-out. This is the same policy the old SidePanel had.
 */
export function PanelHost({ visibleId, keepMounted }: Props) {
  const [panels, setPanels] = useState<Record<string, ReactNode>>({});

  useEffect(() => {
    if (!visibleId) return;
    setPanels((prev) => {
      const item = SidebarModel.instance.getPanel(visibleId);
      const component = SidebarModel.instance.getPanelComponent(visibleId);
      if (!component) return prev;
      if (prev[visibleId] && !item?.transient) return prev;
      return { ...prev, [visibleId]: React.createElement(component) };
    });
  }, [visibleId]);

  useEffect(() => {
    const group = {};
    SidebarModel.instance.on(
      SidebarModelEvent.HotReload,
      () => nextTick(() => setPanels({})),
      group
    );
    return () => SidebarModel.instance.off(group);
  }, []);

  return (
    <div className={css.Host}>
      {Object.entries(panels).map(([id, panel]) => {
        const isActive = id === visibleId;
        const item = SidebarModel.instance.getPanel(id);
        if (!isActive && (!keepMounted || item?.unmountWhenHidden)) return null;
        return (
          <div key={id} data-panel-id={id} className={css.PanelItem} style={{ display: isActive ? 'block' : 'none' }}>
            <ErrorBoundary
              showTryAgain
              onTryAgain={() =>
                setPanels((prev) => {
                  const component = SidebarModel.instance.getPanelComponent(id);
                  return component ? { ...prev, [id]: React.createElement(component) } : prev;
                })
              }
            >
              <PanelActiveContext.Provider value={isActive}>{panel}</PanelActiveContext.Provider>
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: LeftPanelCard (docked card; the peek card is added in Task 11)**

```tsx
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { TopbarPinned } from '../SidePanel/SidebarIcons';
import { PanelHost } from './PanelHost';
import {
  clampPanelWidth, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, readPanelWidth, writePanelWidth
} from './panelWidth';
import css from './LeftPanelCard.module.scss';

const storage = typeof window !== 'undefined' ? window.localStorage : null;

function usePanelWidth(panelId: string | null) {
  const item = panelId ? SidebarModel.instance.getPanel(panelId) : null;
  const fallback = item?.defaultWidth ?? PANEL_WIDTH_DEFAULT;
  const [width, setWidth] = useState(() => (panelId ? readPanelWidth(storage, panelId, fallback) : fallback));
  useEffect(() => {
    if (panelId) setWidth(readPanelWidth(storage, panelId, fallback));
  }, [panelId, fallback]);
  const commit = useCallback(
    (w: number) => {
      const c = clampPanelWidth(w);
      setWidth(c);
      if (panelId) writePanelWidth(storage, panelId, c);
    },
    [panelId]
  );
  return { width, setWidth, commit, fallback };
}

interface CardProps {
  panelId: string;
  mode: 'docked' | 'peek';
  onClose: () => void;
  onPin?: () => void;
}

export function PanelCard({ panelId, mode, onClose, onPin }: CardProps) {
  const item = SidebarModel.instance.getPanel(panelId);
  const { width, setWidth, commit, fallback } = usePanelWidth(panelId);
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
    el.prepend(sentinel);
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { root: el });
    io.observe(sentinel);
    return () => { io.disconnect(); sentinel.remove(); };
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      setWidth(clampPanelWidth(drag.current.startWidth + (ev.clientX - drag.current.startX)));
    };
    const onUp = (ev: MouseEvent) => {
      if (drag.current) commit(drag.current.startWidth + (ev.clientX - drag.current.startX));
      drag.current = null;
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowRight') commit(width + step);
    else if (e.key === 'ArrowLeft') commit(width - step);
    else if (e.key === 'Home') commit(PANEL_WIDTH_MIN);
    else if (e.key === 'End') commit(PANEL_WIDTH_MAX);
    else return;
    e.preventDefault();
  };

  const HeaderAction = item?.headerAction;
  const chromeless = !!item?.chromeless;

  return (
    <div
      className={classNames(css.Card, mode === 'peek' && css['is-peek'], isResizing && css['is-resizing'])}
      style={{ width }}
      data-test={`left-card-${mode}`}
      data-panel-id={panelId}
    >
      <div className={classNames(css.Header, chromeless && css['is-chromeless'], scrolled && css['is-scrolled'])}>
        {!chromeless && <span className={css.Title}>{item?.name}</span>}
        <span className={css.Grow} />
        {!chromeless && HeaderAction && <HeaderAction />}
        {mode === 'peek' && onPin && (
          <Tooltip content="Pin panel" renderDirection={DialogRenderDirection.Below}>
            <IconButton icon={TopbarPinned} variant={IconButtonVariant.Transparent} onClick={onPin} />
          </Tooltip>
        )}
        <Tooltip content="Close panel" renderDirection={DialogRenderDirection.Below}>
          <IconButton icon={IconName.Close} variant={IconButtonVariant.Transparent} onClick={onClose} />
        </Tooltip>
      </div>
      <div ref={scrollRef} className={css.Content}>
        <PanelHost visibleId={panelId} keepMounted={mode === 'docked'} />
      </div>
      <div
        className={css.ResizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH_MIN}
        aria-valuemax={PANEL_WIDTH_MAX}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={onHandleKeyDown}
        onDoubleClick={() => commit(fallback)}
        title="Drag to resize — double-click to reset"
      />
    </div>
  );
}

export function LeftPanelCard() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.layoutChanged]);
  const layout = sidebar.Layout;
  if (!layout.open) return null;
  return (
    <PanelCard panelId={layout.dockedId} mode="docked" onClose={() => SidebarModel.instance.dispatch({ type: 'close' })} />
  );
}
```

`index.ts`: `export { LeftPanelCard } from './LeftPanelCard';`

- [ ] **Step 3: Styles**

`LeftPanelCard.module.scss`:

```scss
.Card {
  position: relative;
  flex-shrink: 0;
  margin: 46px 0 8px 8px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background: var(--card-bg);
  -webkit-backdrop-filter: var(--card-blur);
  backdrop-filter: var(--card-blur);
  border-radius: var(--card-radius);
  box-shadow: var(--card-shadow);
  overflow: hidden;
  box-sizing: border-box;

  @supports not (backdrop-filter: blur(1px)) {
    background: var(--theme-color-bg-2);
  }
}

.is-resizing {
  user-select: none;
  animation: none;
}

.Header {
  flex-shrink: 0;
  height: 40px;
  padding: 0 8px 0 14px;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 0.5px solid rgba(255, 255, 255, 0.06);
  transition: box-shadow 120ms ease, border-color 120ms ease;

  &.is-chromeless { height: 32px; padding-left: 8px; justify-content: flex-end; }
  &.is-scrolled { border-bottom-color: rgba(255, 255, 255, 0.12); box-shadow: 0 6px 12px -6px rgba(0, 0, 0, 0.6); z-index: 1; }
}

.Title { font: 600 12.5px/1 var(--font-family-regular); color: var(--theme-color-fg-highlight); }
.Grow { flex: 1; }

.Content {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.Host { position: relative; width: 100%; height: 100%; }
.PanelItem { position: relative; width: 100%; height: 100%; }

/* Right edge: 8px hit area, hairline appears on hover/drag. Mirrors RightPropertyPanel. */
.ResizeHandle {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 8px;
  cursor: col-resize;
  z-index: 3;

  &::after {
    content: '';
    position: absolute;
    top: 8px;
    bottom: 8px;
    right: 3px;
    width: 2px;
    border-radius: 1px;
    background: transparent;
    transition: background 120ms ease;
  }
  &:hover::after,
  &:focus-visible::after,
  .is-resizing &::after { background: rgba(255, 255, 255, 0.28); }
}
```

- [ ] **Step 4: Build**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/LeftPanelCard
git commit -m "LeftPanelCard: floating card with keep-mounted host and remembered width"
```

---

### Task 10: Mount it — EditorPage layout, bar toggle, ⌘B, delete the old sidebar

**Files:**
- Modify: `src/editor/src/pages/EditorPage/EditorPage.tsx` (imports 31/42/51; state 104-134; render 379-408; keyboard 257-323)
- Modify: `src/editor/src/views/EditorTopbar/EditorTopbar.tsx:29,94,259-268`
- Modify: `src/editor/src/constants/Keybindings.ts`
- Delete: `src/editor/src/views/SidePanel/SidePanel.tsx`, `SidePanel.model.scss`, `views/SidePanel/index.ts`, `src/editor/src/contexts/SidebarWidthContext.ts`

**Interfaces:**
- Consumes: `Rail`, `LeftPanelCard`, `SidebarModel.instance.{toggleCard, restoreLayout, Layout}`, `SidebarModelEvent.layoutChanged`.

- [ ] **Step 1: Keybindings**

Append to `Keybindings.ts`:

```ts
  /** Show/hide the left panel card. The rail itself always stays. */
  export const TOGGLE_LEFT_PANEL = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_B);
  /** ⌘⌥1 … ⌘⌥9: the nth item in the rail's top cluster. */
  export const RAIL_ITEMS = [
    KeyCode.KEY_1, KeyCode.KEY_2, KeyCode.KEY_3, KeyCode.KEY_4, KeyCode.KEY_5,
    KeyCode.KEY_6, KeyCode.KEY_7, KeyCode.KEY_8, KeyCode.KEY_9
  ].map((k) => new Keybinding(KeyMod.CtrlCmd, KeyMod.Alt, k));
```

- [ ] **Step 2: EditorPage**

Imports: remove `FrameDivider` (line 31), `SidePanel` (42), `SidebarWidthContext` (51). Add:

```ts
import { Rail } from '../../views/Rail';
import { LeftPanelCard } from '../../views/LeftPanelCard';
import { Keybindings } from '../../constants/Keybindings';
```

State: delete `defaultLeftSidebarWidth`, `frameDividerSize`, `lastPanelWidth`, `sidebarWidthContextValue`, `frameDividerSizeRef`, and the two `useEffect`s that reference them (lines 104-134, including the `toggle-left-panel` listener).

Where `setIsLoading(false)` runs (line ~172), add on the line before it:

```ts
        SidebarModel.instance.restoreLayout();
```

Keyboard: append to the `useKeyboardCommands` array:

```ts
        {
            handler: () => SidebarModel.instance.toggleCard(),
            keybinding: Keybindings.TOGGLE_LEFT_PANEL.hash
        },
        ...Keybindings.RAIL_ITEMS.map((kb, i) => ({
            handler: () => EventDispatcher.instance.emit('rail-shortcut', i),
            keybinding: kb.hash
        })),
```

(`rail-shortcut` is consumed by the Rail in Task 12; until then it is a harmless emit.)

Render: replace the `<SidebarWidthContext.Provider>…</SidebarWidthContext.Provider>` block with:

```tsx
                                        <div style={{ display: 'flex', width: '100%', height: '100%', overflow: 'hidden' }}>
                                            <Rail />
                                            {/*
                                              `position: relative` here is what the editor top bar anchors to. The bar is
                                              absolutely positioned inside EditorDocument; its nearest positioned ancestor
                                              is this row, so it spans the left card + document + inspector and never moves
                                              when either card opens or closes. Both cards clear it with a 46px top margin.
                                            */}
                                            <div style={{ display: 'flex', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden', position: 'relative' }}>
                                                <LeftPanelCard />
                                                <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
                                                    <ErrorBoundary>{Boolean(Document) && <Document />}</ErrorBoundary>
                                                </div>
                                                {isRightPanelActive && <RightPropertyPanel />}
                                            </div>
                                        </div>
```

- [ ] **Step 3: EditorTopbar**

Line 29: `import { TopbarPanelClose, TopbarPanelOpen } from '../SidePanel/SidebarIcons';` stays (the icons file survives).

Replace line 94 with:

```ts
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(() => SidebarModel.instance.Layout.open);
  useEffect(() => {
    const group = {};
    SidebarModel.instance.on(SidebarModelEvent.layoutChanged, (layout) => setIsLeftPanelVisible(layout.open), group);
    return () => SidebarModel.instance.off(group);
  }, []);
```

(add `import { SidebarModel } from '@xgenia-models/sidebar'; import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';` if absent.) Replace the toggle's `onClick` (lines 264-268) with:

```ts
            onClick={() => SidebarModel.instance.toggleCard()}
```

and remove the now-unused `EventDispatcher` import only if nothing else in the file uses it (it does — leave it).

- [ ] **Step 4: Delete the old sidebar**

```bash
git rm packages/xgenia-editor/src/editor/src/views/SidePanel/SidePanel.tsx packages/xgenia-editor/src/editor/src/views/SidePanel/SidePanel.model.scss packages/xgenia-editor/src/editor/src/views/SidePanel/index.ts packages/xgenia-editor/src/editor/src/contexts/SidebarWidthContext.ts
```

Then `grep -rn "views/SidePanel'" packages/xgenia-editor/src` — any hit importing the deleted `index.ts` must change to `../SidePanel/SidebarIcons`.

- [ ] **Step 5: Build, then look**

Run: `cd packages/xgenia-editor && npm run build:renderer:dev`
Expected: clean.

Then with the xgenia MCP: `xgenia_health`; if running, `xgenia_restart` (dev build picks up the bundle); else `xgenia_launch {target:'dev'}`; `xgenia_open_project {dir:'/Users/markfm/Downloads/NeonReelsV2'}`; `xgenia_screenshot {region:'full'}`. Check:
- rail 48px, identity chip centred on the bar's row, top cluster starts 22px below it, bottom cluster with hairline;
- chat docked in a floating card whose top edge sits under the bar (46px), pin absent, close present, no title (chromeless);
- clicking Components in the rail (via `xgenia_open_chat_panel`'s hover technique is chat-only — use `page.click('[data-test="components-panel"]')` through `xgenia_probe` if exposed, else click by hand) docks Components (peek arrives in Task 11: for now `click` on a non-docked id sets `peekId`, and `LeftPanelCard` renders only the docked card — so verify that the docked card still shows the chat and that `SidebarModel.instance.Layout.peekId === 'components'` via devtools; Task 11 makes it visible);
- the bar's panel button hides the card and the rail stays;
- `xgenia_open_chat_panel` still reports `{opened: true}` (tooltip "Chat" found).

- [ ] **Step 6: Commit**

```bash
git add -A packages/xgenia-editor/src/editor/src
git commit -m "Editor: rail + floating left card replace the sidebar strip; bar toggles the card"
```

---

## Step 2 — Peek + motion

### Task 11: The peek card, Esc, click-away and the open/close recipe

**Files:**
- Modify: `src/editor/src/views/LeftPanelCard/LeftPanelCard.tsx` (`LeftPanelCard` component)
- Modify: `src/editor/src/views/LeftPanelCard/LeftPanelCard.module.scss`
- Modify: `src/editor/src/views/Rail/Rail.tsx` (pass the clicked item's y as the origin)

**Interfaces:**
- Consumes: `layout.peekId`, `SidebarModel.instance.{pin, dispatch}`.
- Produces: `EventDispatcher 'rail-origin-y'` (number, CSS px within the rail) emitted by the Rail on click; consumed by the card for `--origin-y`.

- [ ] **Step 1: Render the peek card and dim the docked one**

Replace `LeftPanelCard`:

```tsx
export function LeftPanelCard() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.layoutChanged]);
  const layout = sidebar.Layout;
  const peekRef = useRef<HTMLDivElement>(null);
  const [originY, setOriginY] = useState(60);

  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-origin-y', (y: number) => setOriginY(y), group);
    return () => EventDispatcher.instance.off(group);
  }, []);

  // Esc and click-away close a peek. The rail is excluded so a second rail click reaches
  // the reducer (which treats "click the peeked id" as close, and "click another" as switch).
  useEffect(() => {
    if (!layout.peekId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); SidebarModel.instance.dispatch({ type: 'esc' }); }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (peekRef.current?.contains(t)) return;
      if (t.closest('[data-test="rail"]')) return;
      if (t.closest('[role="dialog"], [data-glass-popover]')) return; // popovers spawned from the peek
      SidebarModel.instance.dispatch({ type: 'esc' });
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [layout.peekId]);

  if (!layout.open) return null;

  return (
    <>
      <div className={classNames(css.Docked, layout.peekId && css['is-under'])}>
        <PanelCard panelId={layout.dockedId} mode="docked" onClose={() => SidebarModel.instance.dispatch({ type: 'close' })} />
      </div>
      {layout.peekId && (
        <div ref={peekRef} className={css.PeekLayer} style={{ ['--origin-y' as any]: `${originY}px` }}>
          <PanelCard
            key={layout.peekId}
            panelId={layout.peekId}
            mode="peek"
            onClose={() => SidebarModel.instance.dispatch({ type: 'esc' })}
            onPin={() => SidebarModel.instance.pin()}
          />
        </div>
      )}
    </>
  );
}
```

Add `import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';`. In `PanelCard`, the `.Card` for `mode === 'peek'` no longer needs the docked margins: `.PeekLayer` positions it.

- [ ] **Step 2: Rail emits the origin**

In `Rail.tsx`, both `onClick` handlers become:

```tsx
            onClick={(e) => {
              const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.();
              const root = rootRef.current?.getBoundingClientRect();
              if (r && root) EventDispatcher.instance.emit('rail-origin-y', r.top - root.top + r.height / 2);
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
```

`RailButton.onClick` type becomes `(e?: React.MouseEvent<HTMLElement>) => void` and passes the event through from `IconButton`.

- [ ] **Step 3: Styles**

Append to `LeftPanelCard.module.scss`:

```scss
.Docked {
  display: contents;
  &.is-under .Card { opacity: 0.55; pointer-events: none; }
  .Card { transition: opacity 120ms ease; }
}

.PeekLayer {
  position: absolute;
  left: 20px;
  top: 58px;
  bottom: 20px;
  z-index: 11;
  display: flex;

  .Card {
    margin: 0;
    height: 100%;
    box-shadow: var(--card-shadow-peek);
    transform-origin: 0 var(--origin-y, 60px);
    @media (prefers-reduced-motion: no-preference) {
      animation: card-open var(--speed-snap) var(--easing-base);
    }
    @media (prefers-reduced-motion: reduce) {
      animation: card-fade 100ms ease;
    }
  }
}

.Card.is-peek { margin: 0; }

@keyframes card-open {
  from { opacity: 0; transform: scale(0.97) translateX(-6px); }
  to { opacity: 1; transform: none; }
}
@keyframes card-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Docked switch: incoming panel fades in with a 4px slide (direction from the rail). */
.PanelItem[data-enter='down'] { animation: panel-in-down 120ms ease; }
.PanelItem[data-enter='up'] { animation: panel-in-up 120ms ease; }
@keyframes panel-in-down { from { opacity: 0; transform: translateY(4px); } }
@keyframes panel-in-up { from { opacity: 0; transform: translateY(-4px); } }
@media (prefers-reduced-motion: reduce) {
  .PanelItem[data-enter] { animation: none; }
}
```

In `PanelHost`, remember the previous `visibleId` in a ref and set `data-enter` on the newly visible item: `'down'` when the new id's rail index is greater than the old one's, else `'up'` (compute via `SidebarModel.instance.getVisibleItems().findIndex`). Remove the attribute on `animationend`.

- [ ] **Step 4: Build and look**

Run the build; then in the editor: click Components in the rail. Expected: a card grows out of the icon row 12px in front of the dimmed chat; Esc closes it; click on the canvas closes it; the pin button docks it and the chat's rail icon is no longer lit; ⌘B hides the card; the bar did not move at any point (compare the pill's x before/after in two screenshots).

- [ ] **Step 5: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/LeftPanelCard packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Left card: peek in front of the docked panel, Esc and click-away, open recipe"
```

---

### Task 12: Hover-peek while collapsed, ⌘⌥ digit reveal and shortcuts

**Files:**
- Modify: `src/editor/src/views/Rail/Rail.tsx`

**Interfaces:**
- Consumes: `EventDispatcher 'rail-shortcut'` (index, from Task 10), `Keybindings.RAIL_ITEMS[i].label` for tooltips.

- [ ] **Step 1: ⌘⌥ digits + shortcut dispatch**

In `Rail.tsx` add:

```tsx
  const [showDigits, setShowDigits] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) clearTimeout(timer); timer = null; setShowDigits(false); };
    const onDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && !timer) timer = setTimeout(() => setShowDigits(true), 250);
    };
    const onUp = (e: KeyboardEvent) => { if (!(e.metaKey || e.ctrlKey) || !e.altKey) clear(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', clear); clear(); };
  }, []);

  const topRef = useRef(arrangement.top);
  topRef.current = arrangement.top;
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-shortcut', (i: number) => {
      const item = topRef.current[i];
      if (item) SidebarModel.instance.dispatch({ type: 'click', id: item.id });
    }, group);
    return () => EventDispatcher.instance.off(group);
  }, []);
```

Pass to each top `RailButton`: `digit={showDigits ? index + 1 : undefined}` and `fineType={item.fineType ?? (index < 9 ? Keybindings.RAIL_ITEMS[index].label : undefined)}` (import `Keybindings` from `../../constants/Keybindings`).

- [ ] **Step 2: Hover-peek while collapsed**

```tsx
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPeeked = useRef(false);

  const onRailEnter = () => {
    if (layoutRef.current.open) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    hoverTimer.current = setTimeout(() => {
      hoverPeeked.current = true;
      SidebarModel.instance.dispatch({ type: 'peek', id: layoutRef.current.dockedId });
    }, 400);
  };
  const onRailLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  useEffect(() => {
    // The hover-peek closes 300ms after the pointer leaves both the rail and the peek card,
    // unless the user clicked inside it (then Esc/click-away own it).
    const onMove = (e: PointerEvent) => {
      if (!hoverPeeked.current) return;
      const t = e.target as Element | null;
      const inside = !!t && (!!t.closest('[data-test="rail"]') || !!t.closest('[data-test="left-card-peek"]'));
      if (inside) { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } return; }
      if (!leaveTimer.current) leaveTimer.current = setTimeout(() => {
        hoverPeeked.current = false;
        leaveTimer.current = null;
        SidebarModel.instance.dispatch({ type: 'esc' });
      }, 300);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-test="left-card-peek"]')) hoverPeeked.current = false;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerdown', onDown, true); };
  }, []);
```

Put `onPointerEnter={onRailEnter} onPointerLeave={onRailLeave}` on the root `div`.

Note the reducer nuance: hover-peek dispatches `peek(dockedId)` while `open === false`; the reducer sets `open: true, peekId: dockedId`, so `LeftPanelCard` renders the docked card (under) **and** the peek card of the same id. Make `LeftPanelCard` skip the docked card when `layout.peekId === layout.dockedId` (one line: `{layout.peekId !== layout.dockedId && (<div className={css.Docked}…>)}`); on `esc` the reducer leaves `open: true` — so after the hover-peek closes, dispatch `toggle` too when it was hover-initiated: replace the `esc` in `leaveTimer` with `dispatch({ type: 'esc' }); dispatch({ type: 'toggle' });`.

- [ ] **Step 3: Build and look**

Verify: hold ⌘⌥ for a moment → digits appear on the top cluster; ⌘⌥2 opens the second item; ⌘B collapses; hovering the rail 400ms brings the chat back as a peek; moving away closes it and the rail stays collapsed.

- [ ] **Step 4: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail: hover-peek when collapsed, ⌘⌥ digit reveal and shortcuts"
```

---

## Step 3 — Presence

### Task 13: `railpresence` core + store + bridge hook + rail dots

**Files:**
- Create: `src/editor/src/models/railpresence.core.ts`
- Create: `src/editor/src/models/railpresence.ts`
- Test: `tests/rail/railPresence.test.ts`
- Modify: `src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts` (~line 523)
- Modify: `src/editor/src/views/Rail/Rail.tsx`

**Interfaces:**
- Produces:
  ```ts
  // core
  export function familyOf(command: string): string | null;
  export interface PresenceEntry { unseen: number; lastAt: number }
  export type PresenceState = Record<string, PresenceEntry>;
  export type PresenceEvent = { type: 'command'; panelId: string; at: number } | { type: 'seen'; panelId: string };
  export function reducePresence(state: PresenceState, ev: PresenceEvent): PresenceState;
  // store
  export const RailPresence = { getSnapshot(): PresenceState; noteCommand(command: string, at?: number): void; markSeen(panelId: string): void; reset(): void };
  // event
  'rail-presence-changed'  (PresenceState)
  ```

- [ ] **Step 1: Failing tests**

`tests/rail/railPresence.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { familyOf, reducePresence } from '../../src/editor/src/models/railpresence.core';

test('family map', () => {
  assert.equal(familyOf('fs.writeFile'), 'assets');
  assert.equal(familyOf('fs.writeJson'), 'assets');
  assert.equal(familyOf('fs.writeFileBinary'), 'assets');
  assert.equal(familyOf('assetMeta.set'), 'assets');
  assert.equal(familyOf('assetMeta.migrate'), 'assets');
  assert.equal(familyOf('imageEditor.toast'), 'image-editor');
  assert.equal(familyOf('fal.run'), 'image-editor');
  assert.equal(familyOf('gemini.generate'), 'image-editor');
  assert.equal(familyOf('style.setColor'), 'project-styles');
  assert.equal(familyOf('xrgs.compile'), 'maths-panel');
  assert.equal(familyOf('component.create'), 'components');
  assert.equal(familyOf('nodelibrary.list'), 'components');
  assert.equal(familyOf('git.commit'), 'versioncontrol');
  assert.equal(familyOf('git.push'), 'versioncontrol');
  assert.equal(familyOf('git.status'), null);
  assert.equal(familyOf('fs.readFile'), null);
  assert.equal(familyOf('graph.createNode'), null);
  assert.equal(familyOf('node.setParameter'), null);
  assert.equal(familyOf('warnings.get'), null);
  assert.equal(familyOf(''), null);
});

test('command increments unseen and stamps lastAt', () => {
  const s1 = reducePresence({}, { type: 'command', panelId: 'assets', at: 100 });
  assert.deepEqual(s1, { assets: { unseen: 1, lastAt: 100 } });
  const s2 = reducePresence(s1, { type: 'command', panelId: 'assets', at: 150 });
  assert.deepEqual(s2, { assets: { unseen: 2, lastAt: 150 } });
});

test('seen zeroes unseen but keeps lastAt; unknown panel is a no-op', () => {
  const s = reducePresence({ assets: { unseen: 3, lastAt: 9 } }, { type: 'seen', panelId: 'assets' });
  assert.deepEqual(s, { assets: { unseen: 0, lastAt: 9 } });
  const same = { a: { unseen: 1, lastAt: 1 } };
  assert.equal(reducePresence(same, { type: 'seen', panelId: 'zzz' }), same);
});

test('reducer does not mutate', () => {
  const s = Object.freeze({ assets: Object.freeze({ unseen: 1, lastAt: 1 }) }) as any;
  reducePresence(s, { type: 'command', panelId: 'assets', at: 2 });
  assert.equal(s.assets.unseen, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railPresence.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Core**

`models/railpresence.core.ts`:

```ts
// Which rail item an AI tool call belongs to, and the "changed since you looked" counters.
// Pure; no editor imports.

const FAMILIES: Array<[RegExp, string]> = [
  [/^fs\.write(File|Json|FileBinary)$/, 'assets'],
  [/^assetMeta\./, 'assets'],
  [/^imageEditor\./, 'image-editor'],
  [/^fal\./, 'image-editor'],
  [/^gemini\./, 'image-editor'],
  [/^style\./, 'project-styles'],
  [/^xrgs\./, 'maths-panel'],
  [/^component\./, 'components'],
  [/^nodelibrary\./, 'components'],
  [/^git\.(commit|push)$/, 'versioncontrol']
];

export function familyOf(command: string): string | null {
  if (!command) return null;
  for (const [re, panelId] of FAMILIES) if (re.test(command)) return panelId;
  return null;
}

export interface PresenceEntry {
  unseen: number;
  lastAt: number;
}
export type PresenceState = Record<string, PresenceEntry>;
export type PresenceEvent =
  | { type: 'command'; panelId: string; at: number }
  | { type: 'seen'; panelId: string };

export function reducePresence(state: PresenceState, ev: PresenceEvent): PresenceState {
  if (ev.type === 'command') {
    const prev = state[ev.panelId] ?? { unseen: 0, lastAt: 0 };
    return { ...state, [ev.panelId]: { unseen: prev.unseen + 1, lastAt: ev.at } };
  }
  const prev = state[ev.panelId];
  if (!prev || prev.unseen === 0) return state;
  return { ...state, [ev.panelId]: { unseen: 0, lastAt: prev.lastAt } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsx --test packages/xgenia-editor/tests/rail/railPresence.test.ts`
Expected: 4 passing.

- [ ] **Step 5: Store**

`models/railpresence.ts`:

```ts
// "The AI just touched this panel's domain." Fed by EditorBridge for every tool command;
// read by the rail for the amber dot and the tooltip count. The Version control family
// only recounts the git badge (Task 14), so it is never left "unseen".
import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import { familyOf, PresenceState, reducePresence } from './railpresence.core';

let state: PresenceState = {};

function set(next: PresenceState) {
  if (next === state) return;
  state = next;
  EventDispatcher.instance.emit('rail-presence-changed', { ...state });
}

export const RailPresence = {
  getSnapshot(): PresenceState {
    return { ...state };
  },
  noteCommand(command: string, at: number = Date.now()) {
    const panelId = familyOf(command);
    if (!panelId || panelId === 'versioncontrol') return;
    set(reducePresence(state, { type: 'command', panelId, at }));
  },
  markSeen(panelId: string) {
    set(reducePresence(state, { type: 'seen', panelId }));
  },
  reset() {
    set({});
  }
};
```

- [ ] **Step 6: Bridge hook**

In `EditorBridge.ts`, next to `AiActivity.begin();` in the `command` branch (~line 523):

```ts
            RailPresence.noteCommand(msg.command);
```

with `import { RailPresence } from '../../../models/railpresence';` (match the path style of the existing `AiActivity` import in that file).

- [ ] **Step 7: Rail reads it; seen on open**

In `Rail.tsx`:

```tsx
  const [presence, setPresence] = useState(RailPresence.getSnapshot);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-presence-changed', (s) => setPresence(s), group);
    return () => EventDispatcher.instance.off(group);
  }, []);
  useEffect(() => {
    if (layout.open) RailPresence.markSeen(activePanelId(layout));
  }, [layout.open, layout.peekId, layout.dockedId]);
```

Pass to every `RailButton`: `badge={{ unseen: (presence[item.id]?.unseen ?? 0) > 0 }}` and `tooltipSuffix={presence[item.id]?.unseen ? `· ${presence[item.id].unseen} new since you looked` : undefined}`. In `RailButton`, play the ping: keep `prevUnseen` in a ref; when it goes `false → true`, add class `css['is-ping']` for 600ms. Append to `Rail.module.scss`:

```scss
.is-ping .Button { animation: rail-ping 600ms cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes rail-ping {
  0% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.55); }
  100% { box-shadow: 0 0 0 9px rgba(52, 211, 153, 0); }
}
@media (prefers-reduced-motion: reduce) { .is-ping .Button { animation: none; box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.55); } }
```

Also call `RailPresence.reset()` where `SidebarModel.instance.reset()` is called on project close (`grep -rn "SidebarModel.instance.reset" src/editor/src`).

- [ ] **Step 8: Build, look, commit**

Ask the chat panel (via `xgenia_chat_send`) to "save a small text file at assets/notes/hello.txt with the content hi" — expected: the Assets icon pings and shows an amber dot; opening Assets clears it.

```bash
git add packages/xgenia-editor/src/editor/src/models/railpresence.core.ts packages/xgenia-editor/src/editor/src/models/railpresence.ts packages/xgenia-editor/tests/rail/railPresence.test.ts packages/xgenia-editor/src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail presence: the icon of the panel the AI just touched pings and stays marked until opened"
```

---

### Task 14: `gitstatus` store and the uncommitted-files badge

**Files:**
- Create: `src/editor/src/models/gitstatus.ts`
- Modify: `src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts` (`git.commit`, `git.push` handlers)
- Modify: `src/editor/src/pages/EditorPage/EditorPage.tsx` (refresh on project open)
- Modify: `src/editor/src/views/Rail/Rail.tsx`

**Interfaces:**
- Produces: `GitStatus = { getSnapshot(): { count: number | null }; refresh(): Promise<void>; scheduleRefresh(delayMs?): void; reset(): void }`; event `'git-status-changed'` with `{ count }`.

- [ ] **Step 1: Store**

```ts
// Uncommitted file count for the rail's Version control badge. The panel's own
// `localChangesCount` (a React context inside the panel) is a richer, different figure —
// components diffed against HEAD — and only exists once the panel has been opened. This
// counts files reported by `git status`, project.json included, and lives outside React.
import { Git } from '@xgenia/git';
import { mergeProject } from '@xgenia-utils/projectmerger';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { EventDispatcher } from '../../../shared/utils/EventDispatcher';

let count: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

function set(next: number | null) {
  if (next === count) return;
  count = next;
  EventDispatcher.instance.emit('git-status-changed', { count });
}

export const GitStatus = {
  getSnapshot() {
    return { count };
  },

  async refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const dir = ProjectModel.instance?._retainedProjectDirectory;
      if (!dir) return set(null);
      try {
        const g = new Git(mergeProject);
        await g.openRepository(String(dir));
        const files = await g.status();
        set(files.length);
      } catch {
        // Not a repo, or git unavailable: hide the badge, retry on the next trigger.
        set(null);
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  scheduleRefresh(delayMs = 5000) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void GitStatus.refresh();
    }, delayMs);
  },

  reset() {
    if (timer) clearTimeout(timer);
    timer = null;
    set(null);
  }
};
```

- [ ] **Step 2: Triggers**

- EditorBridge: at the end of the `git.commit` handler's success path and the `git.push` handler's success path add `void GitStatus.refresh();` (import from `'../../../models/gitstatus'`).
- EditorPage: next to `SidebarModel.instance.restoreLayout();` add `void GitStatus.refresh();`, and in the same component:

```ts
    useEffect(() => {
        const group = {};
        EventDispatcher.instance.on('Model.undoHistoryChanged', () => GitStatus.scheduleRefresh(5000), group);
        const onFocus = () => void GitStatus.refresh();
        window.addEventListener('focus', onFocus);
        return () => { EventDispatcher.instance.off(group); window.removeEventListener('focus', onFocus); };
    }, []);
```

- Where `SidebarModel.instance.reset()` runs on project close, add `GitStatus.reset()`.

- [ ] **Step 3: Rail badge**

In `Rail.tsx`:

```tsx
  const [git, setGit] = useState(GitStatus.getSnapshot);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('git-status-changed', (s) => setGit(s), group);
    return () => EventDispatcher.instance.off(group);
  }, []);
```

For the item with `id === 'versioncontrol'`: `badge={{ count: git.count ?? undefined }}` and `tooltipSuffix={git.count ? `· ${git.count} uncommitted file${git.count === 1 ? '' : 's'}` : undefined}`. In `RailButton`, when `badge.count` changes, add `css['is-recount']` for 200ms; append:

```scss
.is-recount .Count { animation: rail-recount 200ms ease; }
@keyframes rail-recount { 50% { transform: scale(1.15); } }
```

- [ ] **Step 4: Build, look, commit**

Expected: after an edit and ~5s, the Version control icon shows an amber count; committing from the panel drops it.

```bash
git add packages/xgenia-editor/src/editor/src/models/gitstatus.ts packages/xgenia-editor/src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts packages/xgenia-editor/src/editor/src/pages/EditorPage/EditorPage.tsx packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail: uncommitted file count on Version control"
```

---

### Task 15: Assets refetch on AI writes; AI ring with elapsed tooltip

**Files:**
- Modify: `src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts` (`fs.writeFile`, `fs.writeJson`, `fs.writeFileBinary`, `assetMeta.set`)
- Modify: `src/editor/src/views/panels/AssetPanel/useProjectAssets.ts:128-131`
- Modify: `src/editor/src/views/Rail/Rail.tsx`

- [ ] **Step 1: Emit on writes**

In each of the four handlers, after the write succeeds:

```ts
                EventDispatcher.instance.emit('project-assets-changed', { path: filePath });
```

(`assetMeta.set` uses `assetPath`.) `EventDispatcher` is already imported in `EditorBridge.ts`.

- [ ] **Step 2: Assets panel refetches (debounced)**

In `useProjectAssets.ts`, before the `return`:

```ts
  useEffect(() => {
    const group = {};
    let t: ReturnType<typeof setTimeout> | null = null;
    EventDispatcher.instance.on(
      'project-assets-changed',
      () => {
        if (t) clearTimeout(t);
        t = setTimeout(() => { t = null; loadAssets(); }, 300);
      },
      group
    );
    return () => { EventDispatcher.instance.off(group); if (t) clearTimeout(t); };
  }, [loadAssets]);
```

with `import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';` (path from `views/panels/AssetPanel/`: five `..` to reach `src/`). Update the comment at 128-131 to say the bridge now emits `project-assets-changed` after AI writes; manual `refetch()` remains for the panel's own mutations.

- [ ] **Step 3: AI ring**

In `Rail.tsx`:

```tsx
  const [ai, setAi] = useState(AiActivity.getSnapshot);
  const aiSince = useRef<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('ai-activity-changed', (s) => {
      if (s.active && !aiSince.current) aiSince.current = Date.now();
      if (!s.active) aiSince.current = null;
      setAi(s);
    }, group);
    const t = setInterval(() => aiSince.current && tick((n) => n + 1), 1000);
    return () => { EventDispatcher.instance.off(group); clearInterval(t); };
  }, []);
```

For the item with `id === 'chat-panel'`: `badge={{ ring: ai.active, unseen: … }}` and `tooltipSuffix={ai.active ? `· ${ai.label || 'working'} · ${Math.round((Date.now() - (aiSince.current ?? Date.now())) / 1000)}s` : undefined}`. Import `AiActivity` from `@xgenia-models/aiactivity` (or the relative path the bar uses).

- [ ] **Step 4: Build, look, commit**

Send a prompt through the chat: the Chat icon shows the rotating ring while the turn runs and the tooltip reads e.g. `Chat · AI working · 14s`; it stops within ~4s of the last tool call.

```bash
git add packages/xgenia-editor/src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts packages/xgenia-editor/src/editor/src/views/panels/AssetPanel/useProjectAssets.ts packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail: AI ring with elapsed time; assets refetch after AI writes"
```

---

## Step 4 — Direct manipulation

### Task 16: Resize with a width chip and snapping

**Files:**
- Modify: `src/editor/src/views/LeftPanelCard/LeftPanelCard.tsx` (`startResize`)
- Modify: `src/editor/src/views/LeftPanelCard/LeftPanelCard.module.scss`

**Interfaces:**
- Consumes: `snapPanelWidth` (Task 4).

- [ ] **Step 1: Snap during drag and show the chip**

In `PanelCard`, add `const [chip, setChip] = useState<number | null>(null);` and change `onMove`/`onUp`:

```ts
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      const raw = clampPanelWidth(drag.current.startWidth + (ev.clientX - drag.current.startX));
      const snapped = snapPanelWidth(raw);
      setWidth(snapped);
      setChip(snapped);
    };
    const onUp = (ev: MouseEvent) => {
      if (drag.current) commit(snapPanelWidth(clampPanelWidth(drag.current.startWidth + (ev.clientX - drag.current.startX))));
      drag.current = null;
      setIsResizing(false);
      setTimeout(() => setChip(null), 600);
      …
    };
```

Render after the handle:

```tsx
      {chip !== null && <div className={css.WidthChip} aria-hidden="true">{chip}</div>}
```

Style:

```scss
.WidthChip {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  height: 22px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--glass-pop-bg);
  border: 1px solid var(--glass-ctrl-border);
  font: 500 11px/22px var(--font-family-regular);
  font-variant-numeric: tabular-nums;
  color: var(--theme-color-fg-highlight);
  pointer-events: none;
  z-index: 4;
  @media (prefers-reduced-motion: no-preference) { transition: opacity 120ms ease; }
}
```

- [ ] **Step 2: Build, look, commit**

Drag the card's edge: the chip shows the live width and sticks briefly at 320/380/450/560; double-click resets; the width survives a restart.

```bash
git add packages/xgenia-editor/src/editor/src/views/LeftPanelCard
git commit -m "Left card: width chip and snap stops while resizing"
```

---

### Task 17: A real asset import, and dropping files on the rail

**Files:**
- Modify: `src/editor/src/views/panels/AssetPanel/assetOps.ts` (append `importFiles`)
- Modify: `src/editor/src/views/panels/AssetPanel/AssetPanel.tsx:471-492` (`handleFilesImport`)
- Modify: `src/editor/src/views/Rail/Rail.tsx`, `RailButton.tsx`

**Interfaces:**
- Produces: `export async function importFiles(files: FileList | File[], destRel = 'assets'): Promise<string[]>` — returns the project-relative paths written.

- [ ] **Step 1: `importFiles`**

Append to `assetOps.ts`:

```ts
/**
 * Copy OS files into the project's assets folder. `destRel` is project-relative and must
 * be `assets` or below. Electron 31 exposes `File.path` for dropped files; a File without
 * one (pasted, synthesized) is read and written instead. Name collisions get ` 2`, ` 3`, …
 */
export async function importFiles(files: FileList | File[], destRel: string = 'assets'): Promise<string[]> {
  const root = projectRoot();
  const destAbs = filesystem.join(root, destRel);
  assertUnderAssets(root, destAbs);
  if (!filesystem.exists(destAbs)) await filesystem.makeDirectory(destAbs);

  const written: string[] = [];
  for (const file of Array.from(files as ArrayLike<File>)) {
    const [base, ext] = splitExt(file.name);
    let candidate = file.name;
    let n = 2;
    while (filesystem.exists(filesystem.join(destAbs, candidate))) {
      candidate = `${base} ${n}${ext}`;
      n += 1;
    }
    const target = filesystem.join(destAbs, candidate);
    const srcPath = (file as any).path as string | undefined;
    if (srcPath) {
      await filesystem.copyFile(srcPath, target);
    } else {
      await filesystem.writeFile(target, Buffer.from(await file.arrayBuffer()));
    }
    written.push(`${destRel}/${candidate}`.replace(/\\/g, '/'));
  }
  return written;
}
```

- [ ] **Step 2: The panel uses it**

Replace `handleFilesImport` in `AssetPanel.tsx`:

```ts
    const handleFilesImport = useCallback(async (files: FileList) => {
      if (!files || files.length === 0) return;
      setIsImporting(true);
      try {
        const destRel = currentPath === '/' || currentPath === '' ? 'assets' : `assets${currentPath}`;
        await importFiles(files, destRel);
        refetch();
      } catch (error: any) {
        console.error('Error importing files:', error);
        ToastLayer.showError(`Import failed: ${error?.message || error}`);
      } finally {
        setIsImporting(false);
      }
    }, [currentPath, refetch]);
```

(import `importFiles` from `./assetOps`; import `ToastLayer` from `../../ToastLayer/ToastLayer` — check its error method name with `grep -n "show" views/ToastLayer/ToastLayer.tsx`.)

- [ ] **Step 3: Rail drop mode**

In `Rail.tsx`:

```tsx
  const [dropMode, setDropMode] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => { if (!hasFiles(e)) return; depth += 1; setDropMode(true); };
    const onLeave = () => { depth = Math.max(0, depth - 1); if (depth === 0) setDropMode(false); };
    const onDrop = () => { depth = 0; setDropMode(false); };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDrop);
    return () => { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('drop', onDrop); window.removeEventListener('dragend', onDrop); };
  }, []);

  const onDropAssets = async (files: FileList) => {
    try {
      await importFiles(files, 'assets');
      EventDispatcher.instance.emit('project-assets-changed', { path: 'assets' });
      SidebarModel.instance.dispatch({ type: 'peek', id: 'assets' });
    } catch (error: any) {
      console.error('[Rail] import failed', error);
    }
  };
```

For each `RailButton`: `isDropTarget={dropMode && item.id === 'assets'}`, `isDropDimmed={dropMode && item.id !== 'assets'}`, `onDrop={item.id === 'assets' ? onDropAssets : undefined}`. (`RailButton` already wires `onDragOver`/`onDrop` when `onDrop` is given.)

- [ ] **Step 4: Build, look, commit**

Drag a PNG from Finder over the window: the rail dims except Assets; drop on it → the file appears under `assets/`, the Assets panel peeks open with it listed.

```bash
git add packages/xgenia-editor/src/editor/src/views/panels/AssetPanel packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Assets: real file import; drop files on the rail's Assets item"
```

---

### Task 18: Reorder the top cluster by press-and-hold

**Files:**
- Modify: `src/editor/src/views/Rail/Rail.tsx`, `Rail.module.scss`

**Interfaces:**
- Consumes: `SidebarModel.instance.{getUserOrder, setUserOrder}`, `RAIL_SLOT`.

- [ ] **Step 1: Drag state machine**

```tsx
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; y: number } | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onItemPointerDown = (id: string, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const startY = e.clientY;
    const target = e.currentTarget;
    holdTimer.current = setTimeout(() => {
      target.setPointerCapture(e.pointerId);
      setDrag({ id, from: index, to: index, y: 0 });
    }, 400);
    const cancel = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };
    const onMove = (ev: PointerEvent) => {
      if (!holdTimer.current && drag === null) return;
      if (holdTimer.current && Math.abs(ev.clientY - startY) > 4) cancel(); // a scroll-ish move is not a hold
      setDrag((d) => {
        if (!d) return d;
        const dy = ev.clientY - startY;
        const to = Math.max(0, Math.min(topRef.current.length - 1, d.from + Math.round(dy / RAIL_SLOT)));
        return { ...d, y: dy, to };
      });
    };
    const onUp = () => {
      cancel();
      setDrag((d) => {
        if (d && d.from !== d.to) {
          const ids = topRef.current.map((i) => i.id);
          const [moved] = ids.splice(d.from, 1);
          ids.splice(d.to, 0, moved);
          SidebarModel.instance.setUserOrder(ids);
        }
        return null;
      });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
```

Note `topRef` is the ref from Task 12. Pass `onPointerDownCapture={onItemPointerDown(item.id, index)}` to each top `RailButton`. While `drag` is set, give the dragged item `style={{ transform: `translateY(${drag.y}px) scale(1.06)`, zIndex: 2 }}` and class `css['is-lifting']`; every other top item gets `style={{ transform: shiftFor(index) }}` where:

```ts
  const shiftFor = (index: number): string => {
    if (!drag || index === drag.from) return 'none';
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return `translateY(-${RAIL_SLOT}px)`;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return `translateY(${RAIL_SLOT}px)`;
    return 'none';
  };
```

A click that follows a completed hold must not dispatch: in the button's `onClick`, `if (drag) return;`.

Styles:

```scss
.Item {
  @media (prefers-reduced-motion: no-preference) { transition: transform var(--speed-move) var(--easing-base); }
}
.is-lifting { transition: none !important; }
.is-lifting .Button { box-shadow: 0 8px 20px rgba(0, 0, 0, 0.6); background: var(--glass-ctrl-bg); }
```

- [ ] **Step 2: Build, look, commit**

Press and hold Search for half a second, drag it above Components, release: the order persists across restarts (EditorSettings `rail.order`); ⌘⌥ digits follow the new order.

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail
git commit -m "Rail: press-and-hold to reorder the top cluster"
```

---

### Task 19: Overflow at short heights

**Files:**
- Modify: `src/editor/src/views/Rail/Rail.tsx`, `Rail.module.scss`

**Interfaces:**
- Consumes: `arrangement.overflow` (Task 3), `MenuDialog`.

- [ ] **Step 1: The ⋯ item**

When `arrangement.overflow.length > 0`, render after the top cluster's items:

```tsx
        {arrangement.overflow.length > 0 && (
          <RailButton
            id="rail-overflow"
            name="More panels"
            icon={SideMore}
            isActive={arrangement.overflow.some((i) => i.id === active)}
            showAfterMs={tips.showAfterMs}
            onTooltipClosed={tips.noteClosed}
            badge={{ unseen: arrangement.overflow.some((i) => (presence[i.id]?.unseen ?? 0) > 0) }}
            onClick={() => setOverflowOpen(true)}
          />
        )}
        <MenuDialog
          isVisible={overflowOpen}
          onClose={() => setOverflowOpen(false)}
          triggerRef={overflowRef}
          renderDirection={DialogRenderDirection.Horizontal}
          items={arrangement.overflow.map((i) => ({
            key: i.id,
            label: presence[i.id]?.unseen ? `${i.name} •` : i.name,
            onClick: () => { setOverflowOpen(false); SidebarModel.instance.dispatch({ type: 'click', id: i.id }); }
          }))}
        />
```

`overflowRef` is a ref on a wrapper `div` around the overflow `RailButton`. Add `SideMore = makeIcon(MoreHorizontalIcon, 'SideMore')` to `SidebarIcons.tsx` (check the hugeicon name exists). Note `arrangeRail`'s `capacity` must leave one slot for the ⋯ item when overflow is non-empty: compute `capacity` once, and if `arrangeRail(items, order, capacity).overflow.length > 0`, recompute with `capacity - 1`.

- [ ] **Step 2: Build, look, commit**

Resize the window to ~400px tall: the tail folds into ⋯; its menu lists the rest; an unseen dot on a folded item shows on ⋯.

```bash
git add packages/xgenia-editor/src/editor/src/views/Rail packages/xgenia-editor/src/editor/src/views/SidePanel/SidebarIcons.tsx
git commit -m "Rail: fold the tail of the top cluster into an overflow menu at short heights"
```

---

### Task 20: Final verification and the spec's "As built" note

**Files:**
- Modify: `docs/superpowers/specs/2026-09-06-editor-left-rail-redesign-design.md` (append)

- [ ] **Step 1: Run everything**

```bash
npx tsx --test packages/xgenia-editor/tests/rail/*.test.ts
cd packages/xgenia-editor && npm run build:renderer:dev
```

Expected: all rail tests pass; build clean.

- [ ] **Step 2: Walk the mockup against the editor**

With the dev build and `NeonReelsV2` open, screenshot and check each row; write the result of each into the "As built" section:

1. Rail 48px, chip on the bar's row, top cluster anchored top, bottom cluster with hairline.
2. Chat docked by default, chromeless header, width 450 first launch.
3. Click Components → peek in front; Esc closes; click-away closes; pin docks; chat icon unlit after pin.
4. ⌘B: card hides, rail stays; hover rail 400ms → peek; leave → closes, still collapsed.
5. ⌘⌥ held → digits; ⌘⌥3 opens the third item.
6. AI turn → ring on Chat + elapsed tooltip; an `fs.write` → Assets pings + dot; opening Assets clears it.
7. Edit → Version control count within ~5s; commit → count drops.
8. Drag edge → chip + snaps; double-click resets; width persists.
9. Finder drop on Assets → imported, peek opens.
10. Hold-drag reorder persists; ⌘⌥ digits follow.
11. 400px-tall window → ⋯ overflow.
12. `xgenia_open_chat_panel` still finds the button by its "Chat" tooltip.
13. The pill's x did not change between card open and closed screenshots.

- [ ] **Step 3: Append "As built" to the spec**

Same shape as the top bar spec's section: date, commits, verified list, deviations, deferred.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-09-06-editor-left-rail-redesign-design.md
git commit -m "Left rail: as-built notes"
```

---

## Self-review (done while writing)

- **Spec coverage:** rail/clusters (7, 8, 19), floating card + width (9, 16), bar never moves (10), collapse keeps rail (10, 12), peek/pin/esc/click-away/hover-peek (11, 12), presence ring/dots/pings (13, 15), git count (14), assets refetch (15), drop (17), reorder (18), overflow (19), tokens (1), keyboard (10, 12), project menu (8), deletions (6, 10), tests (2, 3, 4, 13), MCP "Chat" contract (7, 20).
- **Type consistency:** `RailLayout`/`RailAction`/`activePanelId` (2) used by 5, 7, 11, 12; `arrangeRail`/`railCapacity`/`RAIL_SLOT` (3) by 7, 18, 19; `panelWidth` exports (4) by 9, 16; `PresenceState`/`RailPresence` (13) by 15, 19; `GitStatus` (14) by 14 only; `importFiles` (17) by 17; `RailButtonProps` (7) extended in 13, 14, 17, 18, 19 with props already declared in 7.
- **Known soft spots called out in-task:** `IconButton` `aria-label` forwarding (7), hugeicon names (8, 19), `ToastLayer` error method (17), the hover-peek `open`/`toggle` nuance (12).
