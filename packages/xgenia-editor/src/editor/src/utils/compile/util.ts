// Shared helpers for the "Compile" feature.
//
// Naming conventions (per product spec):
//   * data payload fields -> camelCase  (e.g. "First Number" -> "firstNumber")
//   * trigger operations   -> PascalCase (e.g. "Add" -> "Add", flag "isAdd")
//   * aggregator data port -> "data-<field>"   trigger port -> "do-<X>"
//   * logic component name -> "/#__cloud__/__Component_N__"

import { ComponentModel } from '@xgenia-models/componentmodel';

export const CLOUD_PREFIX = '/#__cloud__/';

// Split a single-line word source into words across spaces, separators and
// camelCase humps. "firstNumber"/"first_number"/"First Number" -> ["First","Number"]
function toWords(input: string): string[] {
  return String(input || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function humanize(input: string): string {
  const w = toWords(input);
  if (!w.length) return '';
  return w.map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
}

export function camelCase(input: string): string {
  const w = toWords(input);
  if (!w.length) return '';
  return w
    .map((x, i) => (i === 0 ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()))
    .join('');
}

export function pascalCase(input: string): string {
  const w = toWords(input);
  return w.map((x) => x.charAt(0).toUpperCase() + x.slice(1).toLowerCase()).join('');
}

// A port whose type is the "signal" pulse type (string form or { name } form).
export function isSignalPort(port: any): boolean {
  if (!port) return false;
  const t = port.type;
  return t === 'signal' || (t && t.name === 'signal');
}

export function isComponentInstance(node: any): boolean {
  return !!(node && node.type instanceof ComponentModel);
}

// A node is "visual"/UI if its type may be a visual child (Page, Group, controls…)
export function isVisualType(type: any): boolean {
  return !!(type && (type.allowAsChild || type.visual));
}

// Categories that are page/visual structure, not business logic, and must stay
// in the visual component (Page Inputs, Routers, Component Inputs/Outputs, …).
const NON_LOGIC_CATEGORIES = new Set(['Navigation', 'Visual', 'Visuals', 'Component Utilities']);

function isLogicComponentInstance(node: any): boolean {
  if (!isComponentInstance(node)) return false;
  try {
    // A logic component has no visual roots; a visual sub-component does and
    // should be left in place (it is compiled separately as its own component).
    return node.type.graph.getVisualRootIds().length === 0;
  } catch (e) {
    return false;
  }
}

// Roots that hold logic (non-UI) and should be extracted from a visual
// component: logic-component instances, primitive logic nodes and custom nodes —
// but not visual nodes, page-structure/navigation nodes, or component gateways.
export function collectLogicRoots(comp: any): any[] {
  // Node ids that participate in at least one connection in this component.
  const connectedIds = new Set<string>();
  comp.graph.connections.forEach((c: any) => {
    connectedIds.add(c.fromId);
    connectedIds.add(c.toId);
  });
  const isConnected = (root: any): boolean => {
    let hit = false;
    root.forEach((n: any) => {
      if (connectedIds.has(n.id)) hit = true;
    });
    return hit;
  };

  return comp.graph.roots.filter((root: any) => {
    const type = root.type;
    if (!type) return false;
    let isLogic: boolean;
    if (isComponentInstance(root)) isLogic = isLogicComponentInstance(root);
    else if (isVisualType(type)) isLogic = false;
    else if (type.haveComponentPorts) isLogic = false; // Component Inputs / Outputs
    else if (type.category && NON_LOGIC_CATEGORIES.has(type.category)) isLogic = false;
    else isLogic = true;
    if (!isLogic) return false;
    // Per-instance deployment override (the `isMath` toggle). A non-visual node /
    // logic-component instance defaults to the backend (RGS), but the user may
    // flip `isMath` off to keep it on the frontend (Vercel) — e.g. logic that
    // drives UI animations. Excluding it here means it is never extracted: it
    // stays untouched in the visual component and ships with the UI bundle.
    // A missing/true value reads as backend, so existing projects are unchanged.
    if (root.parameters && root.parameters.isMath === false) return false;
    // Skip logic roots wired to nothing (e.g. an unused logic-component instance
    // left on the page). Extracting them only adds dead nodes to the cloud
    // component that compute on default 0 inputs — and a dead Division would even
    // throw "Division by zero" and break the whole function.
    return isConnected(root);
  });
}

// A "non-logic" component to visit: a visual component that is not a cloud fn.
export function isVisualComponent(comp: any): boolean {
  if (!comp || !comp.graph) return false;
  if (typeof comp.fullName === 'string' && comp.fullName.startsWith(CLOUD_PREFIX)) return false;
  try {
    return comp.graph.getVisualRootIds().length > 0;
  } catch (e) {
    return false;
  }
}

export function safeLabel(node: any): string {
  try {
    if (node._label) return node._label;
    return node.label || node.typename || 'Node';
  } catch (e) {
    return node.typename || 'Node';
  }
}

// Assigns `base` if free, otherwise appends a numeric suffix. `identity` lets the
// same logical thing reuse a previously-assigned name across calls.
export function assignUnique(base: string, identity: string, registry: Map<string, string>): string {
  const safeBase = base || 'value';
  if (registry.get(safeBase) === identity) return safeBase;
  if (!registry.has(safeBase)) {
    registry.set(safeBase, identity);
    return safeBase;
  }
  let i = 2;
  let cand = safeBase + i;
  while (registry.has(cand) && registry.get(cand) !== identity) {
    i++;
    cand = safeBase + i;
  }
  registry.set(cand, identity);
  return cand;
}

export interface BoundaryDataInput {
  field: string; // camelCase payload field
  sourceId: string; // UI node id (aggregator wires from here)
  sourceProperty: string; // UI output port
  targets: { logicTargetId: string; logicPort: string }[]; // logic inputs it fed
}

export interface BoundaryTrigger {
  name: string; // PascalCase operation name -> flag "is<name>"
  sourceId: string; // UI signal node id
  sourceProperty: string; // UI signal output port
  targets: { logicTargetId: string; logicPort: string }[]; // logic signal inputs it fed
}

export interface BoundaryOutput {
  field: string; // camelCase response field (named after the UI destination)
  sources: { logicSourceId: string; logicProperty: string }[]; // logic outputs producing it
  targets: { uiTargetId: string; uiPort: string }[]; // UI inputs that display the value
}

export interface Boundary {
  dataInputs: BoundaryDataInput[];
  triggers: BoundaryTrigger[];
  outputs: BoundaryOutput[];
}
