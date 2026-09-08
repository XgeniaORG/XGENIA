import { ModelProxy } from '../../models/modelProxy';

/**
 * What the React inspector needs to know about one legacy port view in order to
 * lay it out, filter it and decorate it — without knowing anything about which of
 * the ~30 editor types it actually is.
 */
export interface PortRowMeta {
  /** Stable within one rebuild. Port name where there is one, position otherwise. */
  key: string;
  /** The model key. Empty for the container views that own no port of their own. */
  name: string;
  /**
   * EVERY parameter this row can edit, including the ones nested inside it.
   *
   * A row is not always one port. The margin/padding widget is a single view holding
   * eight; a popout group ("Open Graph") is a button whose ports only exist inside the
   * popup; a tab group holds one view per tab; a Dimension row owns its unit and Fixed
   * child ports. Deriving "has this been changed?" from `name` alone made all of those
   * invisible — the Changed count under-reported them and Reset all silently left them
   * set, which is the worst kind of wrong for a command that says "all".
   */
  portNames: string[];
  label: string;
  group: string;
  /** `false` once the node carries an explicit parameter for any port this row owns. */
  isDefault: boolean;
  isConnected: boolean;
  /**
   * Tab groups and popout groups: views that hold OTHER views rather than editing a
   * port of their own. They get no connected chip and no authorship glyph, because
   * neither means anything for a container.
   */
  isGroupLike: boolean;
}

/** The subset of a port definition this module reads. */
export interface PortLike {
  name: string;
  popout?: { group?: string };
}

function pushUnique(into: string[], name: unknown) {
  if (typeof name === 'string' && name !== '' && into.indexOf(name) === -1) into.push(name);
}

/**
 * Every parameter name reachable through this view.
 *
 * Each branch matches a real container in the legacy layer: `childViews` is what
 * `addChildTypeView` fills, `views` is what `TabGroup.addView` fills, `ports` is the
 * component map `MarginPaddingType` builds, and a popout group owns whichever ports
 * declare its group — those have no view at all until the popup opens.
 */
export function ownedPortNames(view: TSFixme, allPorts: readonly PortLike[] = []): string[] {
  const names: string[] = [];
  if (!view) return names;

  pushUnique(names, view.name);

  const visit = (child: TSFixme) => {
    ownedPortNames(child, allPorts).forEach((name) => pushUnique(names, name));
  };

  if (Array.isArray(view.childViews)) view.childViews.forEach(visit);
  if (Array.isArray(view.views)) view.views.forEach(visit);

  // MarginPaddingType keeps its ports as { component: port }, not as child views.
  if (view.ports && typeof view.ports === 'object' && !Array.isArray(view.ports)) {
    Object.keys(view.ports).forEach((key) => pushUnique(names, view.ports[key] && view.ports[key].name));
  }

  if (typeof view.popoutGroup === 'string') {
    allPorts.forEach((port) => {
      if (port && port.popout && port.popout.group === view.popoutGroup) pushUnique(names, port.name);
    });
  }

  return names;
}

/**
 * Reads a legacy `TypeView` (or `TabGroup` / `PopoutGroup`) for the React layer.
 *
 * `isDefault` and `isConnected` are read LIVE from the model rather than copied off
 * the view. The view samples them once in `fromPort` and never refreshes them —
 * which was fine when a value change repainted only that view's own DOM, but the
 * Changed filter and its counts sit above every row and have to agree with what the
 * rows show after each edit.
 */
export function describePortView(
  view: TSFixme,
  model: ModelProxy,
  index: number,
  allPorts: readonly PortLike[] = []
): PortRowMeta {
  const port = view && view.port;
  const name: string = (view && view.name) || (port && port.name) || '';
  const isGroupLike = name === '';
  const portNames = ownedPortNames(view, allPorts);

  return {
    key: isGroupLike ? `group-view-${index}` : `port-${name}`,
    name,
    portNames,
    // Popout groups ("Open Graph", "Twitter") name themselves with `label`; port
    // views use `displayName`. Both show a name to the user, so both have to be
    // searchable — reading only one of them left rows that were visible but unfindable.
    label: (view && (view.displayName || view.label)) || name,
    group: (view && view.group) || 'Other',
    isDefault: portNames.every((portName) => model.parameters[portName] === undefined),
    isConnected: isGroupLike ? false : Boolean(model.isPortConnected(name)),
    isGroupLike
  };
}

export interface DescribedGroup {
  name: string;
  rows: DescribedRow[];
}

export interface DescribedRow extends PortRowMeta {
  view: TSFixme;
}

/**
 * Turns `Ports.getViewGroupsFromPorts()` output into the shape the filter and the
 * renderer both consume. The view objects ride along untouched — React mounts their
 * elements, it does not rebuild them.
 */
export function describeGroups(
  groups: readonly TSFixme[],
  model: ModelProxy,
  allPorts: readonly PortLike[] = []
): DescribedGroup[] {
  let index = 0;
  return (groups || []).map((group) => ({
    name: group.name,
    rows: (group.views || []).map((view) => ({
      ...describePortView(view, model, index++, allPorts),
      view
    }))
  }));
}

/**
 * Every parameter the inspector can currently edit that the node actually carries a
 * value for. This is what "Reset all" clears and what the Changed count counts, so it
 * is derived from the rows' owned ports rather than from the rows themselves.
 */
export function changedPortNames(groups: readonly DescribedGroup[], model: ModelProxy): string[] {
  const names: string[] = [];
  for (const group of groups) {
    for (const row of group.rows) {
      for (const portName of row.portNames) {
        if (model.parameters[portName] !== undefined) pushUnique(names, portName);
      }
    }
  }
  return names;
}
