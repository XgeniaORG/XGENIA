// Shared helpers for the "Compile" feature.
//
// Naming conventions (per product spec):
//   * data payload fields -> camelCase  (e.g. "First Number" -> "firstNumber")
//   * trigger operations   -> PascalCase (e.g. "Add" -> "Add", flag "isAdd")
//   * response fields      -> camelCase "<producing node><output port>"
//                             (e.g. Subtraction.result -> "subtractionResult")
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

// Join two label parts (e.g. a node label and one of its port labels) into a
// single word source for camelCase/pascalCase, collapsing a repeated boundary so
// the result doesn't stutter:
//   "Subtraction" + "Result"   -> "Subtraction Result"  ("subtractionResult")
//   "Calculate Win" + "Win"    -> "Calculate Win"       ("calculateWin")
//   "Result" + "result"        -> "Result"              ("result")
export function joinLabelParts(first: string, second: string): string {
  const a = toWords(first);
  const b = toWords(second);
  if (!a.length) return b.join(' ');
  if (!b.length) return a.join(' ');
  const lower = (w: string) => w.toLowerCase();
  // Longest run of words that is both a tail of `a` and a head of `b`.
  let overlap = Math.min(a.length, b.length);
  while (overlap > 0) {
    const tail = a.slice(a.length - overlap).map(lower).join(' ');
    const head = b.slice(0, overlap).map(lower).join(' ');
    if (tail === head) break;
    overlap--;
  }
  return [...a, ...b.slice(overlap)].join(' ');
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

// Nodes that already reach the RGS platform / backend services from their own
// implementation — cloud function gateways and callers, the cloud DB/auth/storage
// nodes, the RGS player/balance/session nodes, the Stake Engine RGS nodes.
// Extracting them into a generated edge function makes no sense: they depend on
// those services from wherever they run, and most need the browser (Supabase
// session, launch-URL query params, redirects, a Stripe popup) to work at all.
// So they carry no `isMath` toggle (nodelibraryexport.js drops the injection and
// re-emits `usesBackendServices`) and they are excluded here BEFORE the isMath
// resolution below, so a value stored on an old node instance can't resurrect the
// extraction. The category list is a duplicate of the runtime's
// ISMATH_BACKEND_SERVICE_CATEGORIES — it keeps this correct against a viewer
// bundle that predates the flag.
const BACKEND_SERVICE_CATEGORIES = new Set(['Cloud', 'Cloud Functions', 'Cloud Services']);

function usesBackendServices(type: any): boolean {
  if (!type) return false;
  return type.usesBackendServices === true || BACKEND_SERVICE_CATEGORIES.has(type.category);
}

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

// A node type may declare the Compile `isMath` deployment toggle with a default.
// Frontend-only nodes (e.g. the pixi reel renderer, which drives the WebGL scene
// and is fed live node references) declare `default: false` so they are never
// extracted to a backend edge function — even without a per-instance parameter.
// Returns the type's declared default, or true (backend) when the type doesn't
// declare isMath, so existing node types are unaffected.
function typeIsMathDefault(type: any): boolean {
  try {
    const ports = type && type.ports ? type.ports : [];
    for (let i = 0; i < ports.length; i++) {
      if (ports[i] && ports[i].name === 'isMath') {
        return ports[i].default !== false;
      }
    }
  } catch (e) {
    /* fall through to the backend default */
  }
  return true;
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
    else if (usesBackendServices(type)) isLogic = false; // already backend/RGS-backed
    else isLogic = true;
    if (!isLogic) return false;
    // Deployment target (the `isMath` toggle). A non-visual node / logic-component
    // instance defaults to the backend (RGS); false keeps it on the frontend
    // (Vercel) — never extracted, ships untouched with the UI bundle. Resolution:
    //   1. an explicit per-instance `isMath` parameter (user override), else
    //   2. the node TYPE's declared isMath default — frontend-only renderers like
    //      the pixi reel controller declare false and are kept client-side with no
    //      per-instance parameter, else
    //   3. backend (true), so existing projects/node types are unchanged.
    const explicitIsMath = root.parameters ? root.parameters.isMath : undefined;
    const isMath =
      explicitIsMath === true || explicitIsMath === false ? explicitIsMath : typeIsMathDefault(type);
    if (!isMath) return false;
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
  // camelCase response field, named after the PRODUCING logic node and its output
  // port ("<node><port>", e.g. "subtractionResult") — see captureBoundary.
  field: string;
  // The logic output producing it. Keyed one field per (node, port), so this
  // always holds exactly one entry; kept as a list for the consumers' sake.
  sources: { logicSourceId: string; logicProperty: string }[];
  targets: { uiTargetId: string; uiPort: string }[]; // UI inputs that display the value
}

export interface Boundary {
  dataInputs: BoundaryDataInput[];
  triggers: BoundaryTrigger[];
  outputs: BoundaryOutput[];
}
