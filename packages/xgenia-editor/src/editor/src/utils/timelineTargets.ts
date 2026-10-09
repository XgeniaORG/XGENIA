import type { TimelineNodeLike } from '../models/timelineState';
import { numericValue } from './timelineModel';

/**
 * What a Timeline can animate on a node, and what a param's value is before any key: pure
 * helpers over the node's ports and parameters, shared by the dock and the record hook.
 */

export interface AnimatableParam {
  param: string;
  label: string;
  unit: string | null;
}

/** Common animatable inputs, in menu order: DOM visuals, then Pixi, then 3D. */
const CANDIDATES = [
  // DOM visual nodes (node-shared-port-definitions.js)
  'transformX',
  'transformY',
  'transformRotation',
  'transformScale',
  'opacity',
  'width',
  'height',
  // Pixi nodes (numeric ports)
  'x',
  'y',
  'rotation',
  'scaleX',
  'scaleY',
  'alpha',
  // 3D nodes
  'posX',
  'posY',
  'posZ',
  'rotX',
  'rotY',
  'rotZ',
  'scaleZ'
];

/** Units a bare number on these DOM params means (rotate(45px) is invalid CSS). */
const DEFAULT_UNITS: Record<string, string> = {
  transformX: 'px',
  transformY: 'px',
  transformRotation: 'deg'
};

function portTypeName(port: any): string | undefined {
  if (!port) return undefined;
  const type = port.type;
  if (typeof type === 'string') return type;
  if (type && typeof type.name === 'string') return type.name;
  return undefined;
}

function findPort(node: TimelineNodeLike, param: string): any {
  if (typeof node.getPort === 'function') return node.getPort(param, 'input');
  if (typeof node.getPorts === 'function') return (node.getPorts('input') || []).find((p) => p && p.name === param);
  return undefined;
}

/** The unit a track for this param should use. */
export function unitForParam(node: TimelineNodeLike, param: string): string | null {
  const current = numericValue(node.parameters?.[param]);
  if (current && current.unit) return current.unit;
  const port = findPort(node, param);
  const defaultUnit = port && port.type && typeof port.type === 'object' ? port.type.defaultUnit : undefined;
  if (typeof defaultUnit === 'string' && defaultUnit) return defaultUnit;
  return DEFAULT_UNITS[param] || null;
}

/** Animatable numeric inputs the node actually has, labelled as the property panel labels them. */
export function animatableParams(node: TimelineNodeLike | undefined | null): AnimatableParam[] {
  if (!node) return [];
  const out: AnimatableParam[] = [];
  for (const param of CANDIDATES) {
    const port = findPort(node, param);
    if (!port) continue;
    if (portTypeName(port) !== 'number') continue;
    out.push({ param, label: port.displayName || param, unit: unitForParam(node, param) });
  }
  return out;
}

/** A param's value with no key applied: the node's parameter, else the port default, else 0. */
export function baseValue(node: TimelineNodeLike, param: string): { value: number; unit: string | null } {
  const fromParams = numericValue(node.parameters?.[param]);
  if (fromParams) return { value: fromParams.value, unit: fromParams.unit || unitForParam(node, param) };
  const port = findPort(node, param);
  const fromDefault = port ? numericValue(port.default) : null;
  if (fromDefault) return { value: fromDefault.value, unit: fromDefault.unit || unitForParam(node, param) };
  return { value: 0, unit: unitForParam(node, param) };
}

/** Human label for a param on a node ("Pos X"), falling back to the port name. */
export function paramLabel(node: TimelineNodeLike | undefined | null, param: string): string {
  if (!node) return param;
  const port = findPort(node, param);
  return (port && port.displayName) || param;
}

export function nodeLabel(node: TimelineNodeLike | undefined | null): string {
  if (!node) return 'Missing node';
  try {
    return node.label || node.typename || node.id;
  } catch {
    return node.typename || node.id;
  }
}

/** The component a graph node lives in (NodeGraphNode.owner is the graph, its owner the component). */
export function componentOf(node: TimelineNodeLike | undefined | null): unknown {
  if (!node || !node.owner) return null;
  return node.owner.owner || node.owner;
}

export function sameComponent(a: TimelineNodeLike | undefined | null, b: TimelineNodeLike | undefined | null): boolean {
  const ca = componentOf(a);
  return !!ca && ca === componentOf(b);
}
