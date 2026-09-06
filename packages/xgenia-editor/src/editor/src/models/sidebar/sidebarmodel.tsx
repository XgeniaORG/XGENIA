import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import React from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { EditorSettings } from '@xgenia-utils/editorsettings';
import { Model } from '@xgenia-utils/model';

import { IconName } from '@xgenia-core-ui/components/common/Icon';

import { activePanelId, reduceRailLayout, RailAction, RailLayout } from '../../views/Rail/railLayout';

export interface SidebarItem<TProps = Record<string, unknown>> {
  id: string;
  name: string;
  description?: string;
  fineType?: string;
  /** An IconName or one of the `Side*` wrappers from views/SidePanel/SidebarIcons. */
  icon?: IconName | React.ElementType;
  /** Card width before the user drags it. Default 380. */
  defaultWidth?: number;
  order?: number;

  /**
   * Lasting only for a short time.
   * The panel will be re-created every time.
   *
   * Default: false
   */
  transient?: boolean;

  /**
   * Unmount this panel while another one is showing, instead of keeping it
   * mounted and hidden.
   *
   * SidePanel keeps opened panels alive so switching back is instant and their
   * state survives — but a hidden panel still runs its timers and still
   * reconciles on every model event it subscribes to, for the rest of the
   * session. Set this on a panel whose state is cheap to rebuild and whose
   * background cost is not.
   *
   * Prefer `usePanelActive()` where the panel can simply idle: it gets the same
   * saving without throwing the panel's state away.
   *
   * Default: false
   */
  unmountWhenHidden?: boolean;

  placement?: 'top' | 'bottom';

  /** This panel is the card's home — the one docked when nothing is stored. */
  isDefaultDocked?: boolean;

  /**
   * This panel shows AI activity — its rail button gets the "AI working" ring and
   * elapsed-time tooltip, and callers that need to route the user to "wherever the AI
   * is" (MathsPanel's dispatchCommand) resolve the id through this flag rather than a
   * literal id. Declarative, like `isDefaultDocked`: router.setup.ts sets it on whichever
   * chat implementation actually loaded, under either id it may resolve to.
   */
  showsAiActivity?: boolean;

  /**
   * Registered and fully dispatchable (`SidebarModel.switch`, the settings panel's own
   * "Project settings" menu item, etc.) but not rendered as a rail button — e.g.
   * Settings, reachable only from the identity chip's project menu.
   */
  railHidden?: boolean;

  isDisabled?: boolean /** Default: false */;

  /** Default: false */
  experimental?: boolean;

  onOpen?: () => void;
  onClose?: () => void;
  onClick?: () => void;

  panelProps?: TProps;
  panel: React.ComponentType<TProps>;
}

/**
 * Returns the sidepanel we want to show for this node.
 *
 * @param node Node instance?
 * @returns The side panel name.
 */
function getNodePanelName(nodeModel: NodeGraphNode): { id: string; args?: TSFixme } {
  if (!nodeModel.type.panels) return { id: 'PropertyEditor' };
  if (nodeModel.type.panels === 'none') return { id: 'none' };

  const registeredPanels = SidebarModel.instance.getItems();
  const valids = nodeModel.type.panels.filter((x) => registeredPanels.find((b) => b.id == x.name));
  if (valids.length > 0) {
    return {
      id: valids[0].name,
      args: valids[0]
    };
  }

  return { id: 'PropertyEditor' };
}

function createPanel(type: string, args: { [key: string]: unknown }): () => React.ReactElement {
  const items = SidebarModel.instance.getItems();

  const item = items.find((x) => x.id === type);
  if (!item) {
    throw new Error(`Panel not found. (${type})`);
  }

  // eslint-disable-next-line react/display-name
  return () => React.createElement(item.panel, { ...args, ...(item.panelProps || {}) });
}

const getExperimentalSettingsKey = (item: SidebarItem) => `experimental.panel.${item.id}`;

export enum SidebarModelEvent {
  /** Occurs when a new panel is added. */
  itemsChanged = 'itemsChanged',
  /** Occurs when a panel is selected. */
  activeChanged = 'activeChanged',
  nodeSelected = 'nodeSelected',
  receivedCommand = 'receivedCommand',
  HotReload = 'HotReload',
  /** Occurs when the right-side panel changes (independent of left sidebar). */
  rightPanelChanged = 'rightPanelChanged',
  /** Occurs when the active panel or open state of the left card changes. */
  layoutChanged = 'layoutChanged'
}

export type SidebarModelEventEvents = {
  [SidebarModelEvent.itemsChanged]: () => void;
  [SidebarModelEvent.activeChanged]: (panelId: string, previousActiveId: string) => void;
  [SidebarModelEvent.nodeSelected]: (nodeId: string) => void;
  [SidebarModelEvent.receivedCommand]: (panelId: string, command: string, args: unknown[] | any) => void;
  [SidebarModelEvent.HotReload]: () => void;
  [SidebarModelEvent.rightPanelChanged]: (panelId: string | null, component: (() => React.ReactElement) | null) => void;
  [SidebarModelEvent.layoutChanged]: (layout: RailLayout) => void;
};

/**
 * The Sidebar Model.
 *
 * ## Nodes
 * Nodes can have custom panels when selected.
 *
 * Before telling a node to use a specific panel we have to register it with
 * SidebarModel. Which is done by calling register.
 *
 * To add a custom panel to a node, you have to add it to the **node definition**.
 * ```js
 *  {
 *    ...
 *    panels: [
 *      {
 *        name: "PortEditor",
 *      }
 *    ],
 *    ...
 *  }
 * ```
 *
 */
export class SidebarModel extends Model<SidebarModelEvent, SidebarModelEventEvents> {
  public static instance = new SidebarModel();

  private activeId: string;
  private previousActiveId: string;
  private items: SidebarItem[] = [];
  private experimentalItems: SidebarItem[] = [];

  private panels: {
    [key: string]: () => React.ReactElement;
  } = {};

  /** Independent right-side panel state (for PropertyEditor, PortEditor, etc.) */
  private rightPanelId: string | null = null;
  private rightPanelComponent: (() => React.ReactElement) | null = null;

  private groupRef = {};

  /** Older key, read as a fallback when `rail.active` has never been written. */
  private static readonly SETTINGS_DOCKED_LEGACY = 'rail.docked';
  private static readonly SETTINGS_ACTIVE = 'rail.active';
  private static readonly SETTINGS_OPEN = 'rail.open';
  private static readonly SETTINGS_ORDER = 'rail.order';

  private layout: RailLayout = { activeId: 'components', homeId: 'components', open: true };

  public get Layout(): RailLayout {
    return { ...this.layout };
  }

  /**
   * Which panel id should be docked when nothing is stored.
   *
   * Declarative, not string-matched: a panel opts in with `isDefaultDocked` on its own
   * registration (router.setup.ts sets it on whichever chat implementation actually
   * loaded, under either id it may resolve to) rather than the model guessing an id.
   * Falling back to "first item" without a placement filter previously let a bottom-cluster
   * utility panel (version control, settings) win a tie in `order` against the intended
   * default just because it happened to register first — a stable sort preserves
   * registration order on equal keys. Restricting the fallback to the top cluster closes
   * that door structurally, not by picking a different tiebreak.
   */
  private defaultDockedId(): string {
    const preferred = this.items.find((x) => x.isDefaultDocked && !x.transient);
    if (preferred) return preferred.id;
    const topItem = this.getVisibleItems().find((x) => x.placement !== 'bottom');
    return topItem ? topItem.id : 'components';
  }

  /**
   * Read the stored layout. Call once the panels for this project are registered.
   *
   * Awaits `EditorSettings.instance.ready` first: under Electron, settings live in a
   * file and `get()` returns undefined until the async fetch lands (see the comment on
   * `ready` in utils/editorsettings.ts) — without this, the active panel and open state
   * would be silently discarded on every launch, which is the bug this method exists to fix.
   * Do not add a pre-await staleness check here: an earlier attempt at one discarded the
   * user's stored layout on ordinary project loads.
   *
   * `homeId` always comes from `defaultDockedId()`, never from storage — a renamed or
   * removed chat panel must never strand the user with no way home.
   */
  public async restoreLayout(): Promise<void> {
    // Apply whatever settings are readable RIGHT NOW, before awaiting anything, so the
    // caller can paint a correct first frame. EditorSettings mirrors itself into
    // localStorage, which is synchronous, so on any launch after the first this already
    // has the stored answer. Awaiting the file read before applying anything is what made
    // the editor paint its default panel and then visibly swap it.
    this.applyStoredLayout();
    // The file is still the authority — it may hold settings this window has never seen —
    // so apply again once it lands. The reducer returns the same state when nothing
    // changed, and dispatch() drops that, so the common case notifies nobody twice.
    await EditorSettings.instance.ready;
    this.applyStoredLayout();
  }

  private applyStoredLayout(): void {
    const storedActive = EditorSettings.instance.get(SidebarModel.SETTINGS_ACTIVE);
    const storedDocked = EditorSettings.instance.get(SidebarModel.SETTINGS_DOCKED_LEGACY);
    const storedOpen = EditorSettings.instance.get(SidebarModel.SETTINGS_OPEN);
    const homeId = this.defaultDockedId();
    const stored = typeof storedActive === 'string' ? storedActive : storedDocked;
    const activeId = typeof stored === 'string' && this.items.some((x) => x.id === stored && !x.transient) ? stored : homeId;
    this.dispatch({ type: 'restore', homeId, activeId, open: storedOpen !== false });
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
      this.ensurePanel(next.activeId);
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

    if (next.activeId !== before.activeId) EditorSettings.instance.set(SidebarModel.SETTINGS_ACTIVE, next.activeId);
    if (next.open !== before.open) EditorSettings.instance.set(SidebarModel.SETTINGS_OPEN, next.open);

    this.notifyListeners(SidebarModelEvent.layoutChanged, this.Layout);
    if (prevActive !== nextActive) {
      this.notifyListeners(SidebarModelEvent.activeChanged, this.activeId, this.previousActiveId);
      const newActiveTab = this.items.find((x) => x.id === nextActive);
      newActiveTab?.onOpen?.();
    }
  }

  /** Returns to the home panel (the chat), opening the card if it was closed. */
  public goHome(): void {
    this.dispatch({ type: 'home' });
  }

  public toggleCard(): void {
    this.dispatch({ type: 'toggle' });
  }

  public get ActiveId(): string {
    return this.activeId;
  }

  public get RightPanelId(): string | null {
    return this.rightPanelId;
  }

  public getRightPanelComponent(): (() => React.ReactElement) | null {
    return this.rightPanelComponent;
  }

  constructor() {
    super();

    EditorSettings.instance.on(
      'updated',
      ({ key }: { key: string }) => {
        // Check if the key is an experimental panel
        const experimentalKeys = this.experimentalItems.map(getExperimentalSettingsKey);
        if (!experimentalKeys.includes(key)) {
          return;
        }

        const enabled = EditorSettings.instance.get(key);
        const id = key.split('.').at(-1);

        if (enabled) {
          const experimentalItem = this.experimentalItems.find((x) => x.id === id);

          // Check if item exists
          if (!experimentalItem) {
            return;
          }

          // Already enabled
          if (this.items.some((x) => x.id === id)) {
            return;
          }

          // Enable the item
          this.items.push(experimentalItem);
          this.notifyListeners(SidebarModelEvent.itemsChanged);
        } else {
          const index = this.items.findIndex((x) => x.id === id);
          if (index >= 0) {
            this.items.splice(index, 1);
            this.notifyListeners(SidebarModelEvent.itemsChanged);
          }
        }
      },
      this.groupRef
    );
  }

  public reset() {
    this.activeId = undefined;
    this.previousActiveId = undefined;

    this.items = [];
    this.experimentalItems = [];
    this.panels = {};
    this.rightPanelId = null;
    this.rightPanelComponent = null;
    this.layout = { activeId: 'components', homeId: 'components', open: true };
  }

  // TODO: Rename to getActive()
  public getCurrent(): SidebarItem {
    return this.items.find((x) => x.id === this.activeId) || this.items[0];
  }

  public getPanel(panelId: string) {
    return this.items.find((x) => x.id === panelId) || null;
  }

  public getPanelComponent(panelId: string): () => React.ReactElement {
    if (panelId) {
      return this.panels[panelId];
    }
    return null;
  }

  public getActive(): () => React.ReactElement | null {
    if (this.activeId) {
      return this.panels[this.activeId];
    }
    return null;
  }

  public getItems(): readonly SidebarItem[] {
    return this.items.sort((a, b) => a.order - b.order);
  }

  public getVisibleItems(): readonly SidebarItem[] {
    return this.getItems().filter((x) => !x.transient);
  }

  /**
   * The id of the panel that shows AI activity (the chat), if one is registered.
   * Declarative lookup via `showsAiActivity`, mirroring `defaultDockedId()` above — a
   * caller that needs "the chat panel's id" (MathsPanel's dispatchCommand) must not guess
   * a literal id, since it differs between the iframe and shell chat implementations.
   */
  public getAiActivityPanelId(): string | null {
    return this.items.find((x) => x.showsAiActivity)?.id ?? null;
  }

  public getExperimentalItems() {
    return this.experimentalItems
      .filter((x) => !x.transient)
      .map((x) => ({
        id: x.id,
        settingsKey: getExperimentalSettingsKey(x),
        name: x.name,
        description: x.description,
        enabled: !!EditorSettings.instance.get(getExperimentalSettingsKey(x))
      }));
  }

  public register<TProps extends Record<string, unknown>>(item: SidebarItem<TProps>): void {
    // Set default placement
    if (!item.placement) {
      item.placement = 'top';
    }

    if (item.experimental) {
      this.experimentalItems.push(item);

      if (EditorSettings.instance.get(getExperimentalSettingsKey(item))) {
        this.items.push(item);
        this.notifyListeners(SidebarModelEvent.itemsChanged);
      }
    } else {
      this.items.push(item);
      this.notifyListeners(SidebarModelEvent.itemsChanged);
    }
  }

  /**
   *
   * @param id The panel id.
   * @returns
   */
  public switch(id: string): boolean {
    if (!this.items.some((x) => x.id === id)) {
      console.error(`Panel not found. (${id})`);
      return false;
    }
    // `switch` means "ensure visible", not "toggle": the reducer's `click` case, when `id`
    // is already `activeId` and the card is open, either goes home or collapses — either
    // way it stops showing `id`. Callers (⌘F, component.switchTo, onOpen hooks, settings
    // and hot-reload restore) want "make visible"; only the rail's own click handler wants
    // that go-home/collapse behavior, and it calls `dispatch({ type: 'click' })` directly.
    if (activePanelId(this.layout) === id && this.layout.open) {
      return true;
    }
    this.dispatch({ type: 'click', id });
    return true;
  }

  public switchToNode(nodeModel: NodeGraphNode) {
    const { id, args } = getNodePanelName(nodeModel);

    if (id === 'none') return;

    // Create the panel component for the right-side panel
    const component = createPanel(id, {
      model: nodeModel,
      ...args
    });

    // Set the right panel state (independent of left sidebar)
    this.rightPanelId = id;
    this.rightPanelComponent = component;

    // Also store it in panels registry so getPanelComponent works
    this.panels[id] = component;

    this.notifyListeners(SidebarModelEvent.rightPanelChanged, this.rightPanelId, this.rightPanelComponent);
    this.notifyListeners(SidebarModelEvent.nodeSelected, nodeModel.id);
  }

  /**
   * Show an arbitrary component in the right-hand property panel (the same region
   * node properties use). For non-node inspectors, e.g. the Asset inspector.
   */
  public showRightPanel(id: string, component: () => React.ReactElement) {
    this.rightPanelId = id;
    this.rightPanelComponent = component;
    this.panels[id] = component;
    this.notifyListeners(SidebarModelEvent.rightPanelChanged, this.rightPanelId, this.rightPanelComponent);
  }

  /**
   * Used by "doubleClick"
   *
   * @param command
   */
  public invokeActive(command: string, args?: unknown) {
    this.notifyListeners(SidebarModelEvent.receivedCommand, this.activeId, command, args);
  }

  public hidePanels() {
    // Clear the right panel
    this.rightPanelId = null;
    this.rightPanelComponent = null;
    this.notifyListeners(SidebarModelEvent.rightPanelChanged, null, null);
  }
}
