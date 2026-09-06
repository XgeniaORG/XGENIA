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
  /** Rendered in the panel card's header, right of the title (e.g. Components' Add node). */
  headerAction?: React.ComponentType;
  /** The panel draws its own header (an iframe); the card shows pin/close only. */
  chromeless?: boolean;
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
  /** Occurs when the docked/peek/open layout of the left card changes. */
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
    this.layout = { dockedId: 'components', peekId: null, open: true };
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
    // Existing callers (⌘F, component.switchTo, onOpen hooks) get the rail's click
    // semantics: docked → toggle, otherwise → peek.
    if (!this.items.some((x) => x.id === id)) {
      console.error(`Panel not found. (${id})`);
      return false;
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
