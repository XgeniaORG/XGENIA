import { UndoActionGroup, UndoQueue } from '../models/undo-queue-model';

/**
 * Prefab-style overrides for component instances.
 *
 * A component instance's input ports are the outputs of the "Component Inputs" node
 * inside the component. Whatever the instance sets lives in its own `parameters`; an
 * input it leaves alone falls back to the port default, which `ComponentModel.getPorts`
 * derives from the inner node that input is wired to (only when there is exactly one
 * such wire). So "the component's value" for an input is the inner parameter the wire
 * lands on, and applying an instance override means writing it there and clearing it
 * from the instance — after which every instance that never overrode that input picks
 * up the new value too.
 *
 * Duck-typed on purpose: a node's type is a component when it carries a graph. That
 * keeps this module free of the node library, so it can be tested without an editor.
 */

/** The parts of a graph node this module reads or writes. */
export interface OverrideNodeLike {
  id: string;
  label?: string;
  typename?: string;
  type?: TSFixme;
  parameters: Record<string, unknown>;
  stateParameters?: Record<string, Record<string, unknown> | undefined>;
  variant?: TSFixme;
  variantName?: string;
  getPorts?: (filter?: 'input' | 'output') => readonly { name: string }[];
  getPort?: (name: string, plug?: 'input' | 'output') => unknown;
  getParameter?: (name: string, args?: TSFixme) => unknown;
  setParameter: (name: string, value: unknown, args?: TSFixme) => void;
}

interface ConnectionLike {
  fromId: string;
  fromProperty: string;
  toId: string;
  toProperty: string;
}

interface GraphLike {
  connections: ConnectionLike[];
  forEachNode: (callback: (node: OverrideNodeLike) => boolean | void) => boolean | void;
  findNodeWithId: (id: string) => OverrideNodeLike | undefined;
}

export interface OverrideTarget {
  nodeId: string;
  /** What the graph draws on the node: its label, or its type name when it has none. */
  nodeLabel: string;
  property: string;
}

export interface ComponentOverride {
  name: string;
  /** The instance's own value. */
  value: unknown;
  /**
   * The component's value for this input: the inner parameter the wire lands on. With
   * two or more wires it is only reported when they all agree; undefined otherwise.
   */
  defaultValue: unknown;
  applicable: boolean;
  /** Why it cannot be applied. Only set when `applicable` is false. */
  reason?: string;
  /** Extra information about an applicable override — e.g. that it writes to several ports. */
  note?: string;
  /** Every inner port an apply would write to. */
  targets: OverrideTarget[];
  /** Set for a value stored against a visual state. Those are never applicable. */
  state?: string;
}

export interface OverrideWrite {
  nodeId: string;
  property: string;
  value: unknown;
}

export interface OverrideResult {
  group: UndoActionGroup;
  /** Instance parameters that were applied or reverted. */
  names: string[];
  skipped: { name: string; reason: string }[];
  /** The inner-node writes an apply made (empty for a revert). */
  writes: OverrideWrite[];
}

export interface OverrideActionOptions {
  label?: string;
  /** Defaults to the editor's queue. Tests pass their own. */
  undoQueue?: { push: (group: UndoActionGroup) => void };
}

export const APPLY_LABEL = 'Apply to component';
export const REVERT_LABEL = 'Revert to component';

/** The component graph behind an instance, or null when the node is not a component instance. */
export function componentGraphOf(node: OverrideNodeLike | null | undefined): GraphLike | null {
  const type = node ? node.type : undefined;
  const graph = type ? type.graph : undefined;
  if (
    !graph ||
    typeof graph.forEachNode !== 'function' ||
    typeof graph.findNodeWithId !== 'function' ||
    !Array.isArray(graph.connections)
  ) {
    return null;
  }
  return graph as GraphLike;
}

export function isComponentInstance(node: OverrideNodeLike | null | undefined): boolean {
  return componentGraphOf(node) !== null;
}

/** The component's full path ("/Slot/Reels"), which is what its type is named. */
export function componentNameOf(node: OverrideNodeLike | null | undefined): string {
  const type = node ? node.type : undefined;
  return (type && (type.fullName || type.name)) || '';
}

interface InnerTarget {
  node: OverrideNodeLike;
  property: string;
}

interface InputWiring {
  /** Wires into ordinary inner nodes: these are what an apply writes. */
  targets: InnerTarget[];
  /** Wires that go straight on to a component output — there is no parameter to write. */
  passThrough: number;
}

/**
 * Every component input the graph defines, with the inner ports each one is wired to.
 * Mirrors `ComponentModel.getPorts`: any node whose type has `haveComponentPorts`
 * contributes its outputs as instance inputs, and a wire only counts when the port it
 * lands on still exists.
 */
function componentInputWiring(graph: GraphLike): Map<string, InputWiring> {
  const wiring = new Map<string, InputWiring>();
  const sourcePorts = new Map<string, Set<string>>();

  graph.forEachNode((inner) => {
    if (!inner || !inner.type || !inner.type.haveComponentPorts) return undefined;
    const outputs = typeof inner.getPorts === 'function' ? inner.getPorts('output') || [] : [];
    const names = new Set<string>();
    outputs.forEach((port) => {
      if (!port || typeof port.name !== 'string') return;
      names.add(port.name);
      if (!wiring.has(port.name)) wiring.set(port.name, { targets: [], passThrough: 0 });
    });
    sourcePorts.set(inner.id, names);
    return undefined;
  });

  for (const connection of graph.connections) {
    const names = sourcePorts.get(connection.fromId);
    if (!names || !names.has(connection.fromProperty)) continue;

    const target = graph.findNodeWithId(connection.toId);
    if (!target) continue;
    if (typeof target.getPort === 'function' && !target.getPort(connection.toProperty, 'input')) continue;

    const entry = wiring.get(connection.fromProperty)!;
    if (target.type && target.type.haveComponentPorts) entry.passThrough++;
    else entry.targets.push({ node: target, property: connection.toProperty });
  }

  return wiring;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch (e) {
    return false;
  }
}

/** Parameters are JSON in the project file, so a JSON copy is a faithful one. */
function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return value;
  }
}

function readInner(target: InnerTarget): unknown {
  return typeof target.node.getParameter === 'function'
    ? target.node.getParameter(target.property)
    : target.node.parameters[target.property];
}

function variantValue(node: OverrideNodeLike, name: string): unknown {
  let variant: TSFixme;
  try {
    variant = node.variant;
  } catch (e) {
    return undefined;
  }
  return variant && variant.parameters ? variant.parameters[name] : undefined;
}

function describeTargets(targets: InnerTarget[]): OverrideTarget[] {
  return targets.map((target) => ({
    nodeId: target.node.id,
    nodeLabel: target.node.label || target.node.typename || target.node.id,
    property: target.property
  }));
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The inputs this instance overrides, in port order where the type knows it.
 *
 * Only component inputs are listed — a parameter that matches no input is not an
 * override of anything. Base (neutral) values come first; values stored against a
 * visual state follow, flagged as not applicable, because the component side has no
 * per-state value for them to land in.
 */
export function overriddenInputs(node: OverrideNodeLike | null | undefined): ComponentOverride[] {
  const graph = componentGraphOf(node);
  if (!graph || !node) return [];

  const parameters = node.parameters || {};
  const stateParameters = node.stateParameters || {};
  const hasNeutral = Object.keys(parameters).some((key) => parameters[key] !== undefined);
  const hasState = Object.keys(stateParameters).some((state) => {
    const values = stateParameters[state];
    return values && Object.keys(values).some((key) => values[key] !== undefined);
  });
  if (!hasNeutral && !hasState) return [];

  const wiring = componentInputWiring(graph);
  const order = inputOrder(node, wiring);
  const result: ComponentOverride[] = [];

  for (const name of order) {
    const value = parameters[name];
    if (value === undefined) continue;

    const { targets, passThrough } = wiring.get(name)!;
    const innerValues = targets.map(readInner);
    const agree = innerValues.every((inner) => valuesEqual(inner, innerValues[0]));
    const entry: ComponentOverride = {
      name,
      value,
      defaultValue: innerValues.length > 0 && agree ? innerValues[0] : undefined,
      applicable: true,
      targets: describeTargets(targets)
    };

    if (targets.length === 0) {
      entry.applicable = false;
      entry.reason =
        passThrough > 0
          ? 'Passed straight to a component output — there is no value inside to write'
          : 'Nothing inside the component reads this input';
    } else if (variantValue(node, name) !== undefined) {
      entry.applicable = false;
      entry.reason = `The "${node.variantName || 'current'}" variant also sets this — applying would show the variant's value here`;
    } else if (targets.length > 1) {
      entry.note = `Writes to ${plural(targets.length, 'port', 'ports')} inside the component`;
    }

    result.push(entry);
  }

  for (const state of Object.keys(stateParameters)) {
    const values = stateParameters[state];
    if (!values) continue;
    for (const name of order) {
      if (values[name] === undefined) continue;
      result.push({
        name,
        value: values[name],
        defaultValue: undefined,
        applicable: false,
        reason: `Set for the "${state}" visual state — only base values can be applied`,
        targets: describeTargets(wiring.get(name)!.targets),
        state
      });
    }
  }

  return result;
}

/** Component inputs in the order the instance's ports list them, any stragglers after. */
function inputOrder(node: OverrideNodeLike, wiring: Map<string, InputWiring>): string[] {
  const order: string[] = [];
  let ports: readonly { name: string }[] = [];
  try {
    ports = typeof node.getPorts === 'function' ? node.getPorts('input') || [] : [];
  } catch (e) {
    ports = [];
  }
  ports.forEach((port) => {
    if (port && wiring.has(port.name) && order.indexOf(port.name) === -1) order.push(port.name);
  });
  wiring.forEach((_entry, name) => {
    if (order.indexOf(name) === -1) order.push(name);
  });
  return order;
}

/**
 * Writes each named override into the component and clears it from the instance, as
 * ONE undo entry. Inner writes go first and the instance clears last, so when the
 * instance recomputes its ports on the clear, the new default is already in place;
 * undo runs the group backwards and restores both sides.
 *
 * Returns null when nothing could be applied (no undo entry is pushed).
 */
export function applyOverrides(
  node: OverrideNodeLike,
  names: readonly string[],
  options: OverrideActionOptions = {}
): OverrideResult | null {
  const label = options.label || APPLY_LABEL;
  const overrides = overriddenInputs(node).filter((entry) => entry.state === undefined);
  const graph = componentGraphOf(node);
  const skipped: { name: string; reason: string }[] = [];
  const toApply: ComponentOverride[] = [];

  for (const name of uniqueNames(names)) {
    const entry = overrides.find((candidate) => candidate.name === name);
    if (!entry) skipped.push({ name, reason: 'Not an override on this instance' });
    else if (!entry.applicable) skipped.push({ name, reason: entry.reason || 'Cannot be applied' });
    else toApply.push(entry);
  }

  if (!graph || toApply.length === 0) return null;

  const group = new UndoActionGroup({ label });
  const writes: OverrideWrite[] = [];

  for (const entry of toApply) {
    for (const target of entry.targets) {
      const inner = graph.findNodeWithId(target.nodeId);
      if (!inner) continue;
      const value = cloneValue(entry.value);
      inner.setParameter(target.property, value, { undo: group, label });
      writes.push({ nodeId: inner.id, property: target.property, value });
    }
  }

  for (const entry of toApply) {
    node.setParameter(entry.name, undefined, { undo: group, label });
  }

  (options.undoQueue || UndoQueue.instance).push(group);
  return { group, names: toApply.map((entry) => entry.name), skipped, writes };
}

/**
 * Clears each named override so the instance falls back to the component's value, as
 * ONE undo entry. Base values only — the same thing the row's reset dot does, batched.
 *
 * Returns null when there was nothing to clear (no undo entry is pushed).
 */
export function revertOverrides(
  node: OverrideNodeLike,
  names: readonly string[],
  options: OverrideActionOptions = {}
): OverrideResult | null {
  if (!isComponentInstance(node)) return null;
  const label = options.label || REVERT_LABEL;
  const skipped: { name: string; reason: string }[] = [];
  const toRevert: string[] = [];

  for (const name of uniqueNames(names)) {
    if (node.parameters[name] === undefined) skipped.push({ name, reason: 'Not an override on this instance' });
    else toRevert.push(name);
  }
  if (toRevert.length === 0) return null;

  const group = new UndoActionGroup({ label });
  toRevert.forEach((name) => node.setParameter(name, undefined, { undo: group, label }));
  (options.undoQueue || UndoQueue.instance).push(group);
  return { group, names: toRevert, skipped, writes: [] };
}

function uniqueNames(names: readonly string[]): string[] {
  const seen: string[] = [];
  (names || []).forEach((name) => {
    if (typeof name === 'string' && name !== '' && seen.indexOf(name) === -1) seen.push(name);
  });
  return seen;
}

/** A one-line preview of a parameter value for menus and tooltips. */
export function formatOverrideValue(value: unknown, maxLength = 24): string {
  let text: string;
  if (value === undefined) text = '—';
  else if (typeof value === 'string') text = value === '' ? '""' : value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else if (value && typeof value === 'object' && 'value' in (value as object) && 'unit' in (value as object)) {
    // Dimension-shaped values: { value: 12, unit: 'px' }
    const dimension = value as { value: unknown; unit: unknown };
    text = `${dimension.value}${dimension.unit || ''}`;
  } else {
    try {
      text = JSON.stringify(value);
    } catch (e) {
      text = String(value);
    }
  }
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '…' : text;
}
