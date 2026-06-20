// Step 2 of Compile: for a visual component, capture the UI<->logic boundary,
// then build a single cloud/logic component ("/#__cloud__/__Component_N__")
// containing the component's logic, with every embedded logic-component
// instance recursively inlined down to primitive / custom nodes.

import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { guid } from '@xgenia-utils/utils';
import {
  Boundary,
  BoundaryDataInput,
  BoundaryOutput,
  BoundaryTrigger,
  assignUnique,
  camelCase,
  isSignalPort,
  pascalCase,
  safeLabel
} from './util';

const GENERIC_TRIGGER = /^(do|on|trigger|run|fetch|send|click|press|tap)$/i;

function deriveTriggerName(targetNode: any, toPort: string): string {
  let disp = '';
  try {
    const port = targetNode.getPort(toPort, 'input');
    disp = port && port.displayName ? String(port.displayName) : '';
  } catch (e) {
    /* ignore */
  }
  disp = disp.replace(/^\s*(do|on|trigger)\s+/i, '').trim();

  let base: string;
  if (disp && !GENERIC_TRIGGER.test(disp)) {
    base = disp; // distinct port name, e.g. "Add" from "Do Add"
  } else if (targetNode.type instanceof ComponentModel) {
    base = targetNode.type.localName; // embedded logic component name
  } else {
    base = safeLabel(targetNode);
  }
  return pascalCase(base);
}

function deriveFieldName(sourceNode: any): string {
  return camelCase(safeLabel(sourceNode));
}

// Scan the component's connections for edges crossing the UI<->logic boundary.
export function captureBoundary(comp: any, logicRoots: any[]): Boundary {
  const graph = comp.graph;
  const logicIds = new Set<string>();
  logicRoots.forEach((r) => r.forEach((n: any) => logicIds.add(n.id)));

  const dataMap = new Map<string, BoundaryDataInput>();
  const trigMap = new Map<string, BoundaryTrigger>();
  const outMap = new Map<string, BoundaryOutput>();

  const fieldRegistry = new Map<string, string>(); // field name -> identity
  const trigRegistry = new Map<string, string>();
  const outRegistry = new Map<string, string>();

  graph.connections.forEach((c: any) => {
    const fromLogic = logicIds.has(c.fromId);
    const toLogic = logicIds.has(c.toId);

    if (toLogic && !fromLogic) {
      // UI output -> logic input
      const targetNode = graph.findNodeWithId(c.toId);
      const sourceNode = graph.findNodeWithId(c.fromId);
      if (!targetNode || !sourceNode) return;
      // Trigger if either endpoint is a signal port (robust if one lookup fails).
      const targetPort = targetNode.getPort(c.toProperty, 'input');
      const sourcePort = sourceNode.getPort(c.fromProperty, 'output');

      if (isSignalPort(targetPort) || isSignalPort(sourcePort)) {
        const identity = c.toId + '|' + c.toProperty;
        const name = assignUnique(deriveTriggerName(targetNode, c.toProperty), identity, trigRegistry);
        let entry = trigMap.get(name);
        if (!entry) {
          entry = { name, sourceId: c.fromId, sourceProperty: c.fromProperty, targets: [] };
          trigMap.set(name, entry);
        }
        entry.targets.push({ logicTargetId: c.toId, logicPort: c.toProperty });
      } else {
        const identity = c.fromId + '|' + c.fromProperty;
        const field = assignUnique(deriveFieldName(sourceNode), identity, fieldRegistry);
        let entry = dataMap.get(field);
        if (!entry) {
          entry = { field, sourceId: c.fromId, sourceProperty: c.fromProperty, targets: [] };
          dataMap.set(field, entry);
        }
        entry.targets.push({ logicTargetId: c.toId, logicPort: c.toProperty });
      }
    } else if (fromLogic && !toLogic) {
      // logic output -> UI input (response value). Phase 1: declared but the
      // return path back into the UI is not re-wired (aggregator POSTs only).
      const sourceNode = graph.findNodeWithId(c.fromId);
      if (!sourceNode) return;
      const identity = c.fromId + '|' + c.fromProperty;
      const base = camelCase(safeLabel(sourceNode) + ' ' + c.fromProperty);
      const field = assignUnique(base, identity, outRegistry);
      if (!outMap.has(field)) {
        outMap.set(field, { field, logicSourceId: c.fromId, logicProperty: c.fromProperty });
      }
    }
  });

  return {
    dataInputs: Array.from(dataMap.values()),
    triggers: Array.from(trigMap.values()),
    outputs: Array.from(outMap.values())
  };
}

// Clone a set of root nodes (and their internal connections) with fresh ids,
// returning the old->new id map so callers can rewire to the clones.
function cloneRootsWithIdMap(
  graph: any,
  roots: any[]
): { nodes: any[]; connections: any[]; idMap: Record<string, string> } {
  const set = graph.getNodeSetWithNodes(roots); // original objects + internal conns
  const idMap: Record<string, string> = {};
  const clones: any[] = [];

  set.nodes.forEach((root: any) => {
    const clone = NodeGraphNode.fromJSON(root.toJSON());
    clone.forEach((n: any) => {
      const id = guid();
      idMap[n.id] = id;
      n.id = id;
    });
    clones.push(clone);
  });

  const connections = set.connections.map((c: any) => ({
    fromId: idMap[c.fromId],
    fromProperty: c.fromProperty,
    toId: idMap[c.toId],
    toProperty: c.toProperty
  }));

  return { nodes: clones, connections, idMap };
}

// Deep-clone a component definition graph (fresh ids), locating its Component
// Inputs / Outputs gateway nodes within the clone.
function cloneComponentDef(defGraph: any): { nodes: any[]; connections: any[]; ci?: any; co?: any } {
  const { nodes, connections } = cloneRootsWithIdMap(defGraph, defGraph.roots);
  let ci: any;
  let co: any;
  nodes.forEach((root: any) =>
    root.forEach((n: any) => {
      if (n.typename === 'Component Inputs' && !ci) ci = n;
      if (n.typename === 'Component Outputs' && !co) co = n;
    })
  );
  return { nodes, connections, ci, co };
}

// Inline a single component-instance root: splice in the definition's nodes and
// short-circuit the Component Inputs/Outputs gateways so no gateway nodes remain.
function inlineOne(graph: any, inst: any): void {
  const def = inst.type; // ComponentModel
  if (!(def instanceof ComponentModel) || !def.graph) {
    graph.removeNode(inst);
    return;
  }

  const { nodes, connections, ci, co } = cloneComponentDef(def.graph);

  const extIn = graph.connections.filter((c: any) => c.toId === inst.id);
  const extOut = graph.connections.filter((c: any) => c.fromId === inst.id);
  const ciOut = ci ? connections.filter((c: any) => c.fromId === ci.id) : [];
  const coIn = co ? connections.filter((c: any) => c.toId === co.id) : [];

  // Insert internal nodes/connections, excluding the gateway nodes themselves.
  nodes
    .filter((n: any) => n !== ci && n !== co)
    .forEach((n: any) => graph.addRoot(n));
  connections
    .filter(
      (c: any) =>
        (!ci || (c.fromId !== ci.id && c.toId !== ci.id)) &&
        (!co || (c.fromId !== co.id && c.toId !== co.id))
    )
    .forEach((c: any) => graph.addConnection(c));

  // Collapse inputs: (external source -> inst.X) + (ci.X -> internal target)
  extIn.forEach((e: any) => {
    ciOut
      .filter((ic: any) => ic.fromProperty === e.toProperty)
      .forEach((ic: any) =>
        graph.addConnection({
          fromId: e.fromId,
          fromProperty: e.fromProperty,
          toId: ic.toId,
          toProperty: ic.toProperty
        })
      );
  });

  // Collapse outputs: (internal source -> co.Y) + (inst.Y -> external target)
  extOut.forEach((e: any) => {
    coIn
      .filter((oc: any) => oc.toProperty === e.fromProperty)
      .forEach((oc: any) =>
        graph.addConnection({
          fromId: oc.fromId,
          fromProperty: oc.fromProperty,
          toId: e.toId,
          toProperty: e.toProperty
        })
      );
  });

  graph.removeNode(inst); // also removes inst's external connections
}

// Repeatedly inline component-instance roots until none remain.
function inlineAll(graph: any): void {
  let guard = 0;
  while (guard++ < 5000) {
    const instances = graph.roots.filter((n: any) => n.type instanceof ComponentModel);
    if (instances.length === 0) return;
    inlineOne(graph, instances[0]);
  }
  console.warn('[Compile] inlineAll hit its iteration guard (possible component cycle).');
}

function dedupe(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  list.forEach((x) => {
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  });
  return out;
}

// Build "/#__cloud__/__Component_N__" from the visual component's logic.
export function buildCloudComponent(
  copy: any,
  cloudName: string,
  srcComp: any,
  logicRoots: any[],
  boundary: Boundary
): any {
  const template = {
    connections: [] as any[],
    roots: [
      {
        id: 'A',
        type: 'xgenia.cloud.request',
        x: 0,
        y: 0,
        parameters: {} as any,
        ports: [],
        dynamicports: [],
        children: []
      },
      {
        id: 'B',
        type: 'xgenia.cloud.response',
        x: 700,
        y: 0,
        parameters: {} as any,
        ports: [],
        dynamicports: [],
        children: []
      }
    ]
  };

  const graph = NodeGraphModel.fromJSON(JSON.parse(JSON.stringify(template)));
  const requestNode = graph.roots.find((r: any) => r.typename === 'xgenia.cloud.request');
  const responseNode = graph.roots.find((r: any) => r.typename === 'xgenia.cloud.response');

  // Move the logic in (clone so removing it from the visual component later
  // does not disturb this copy).
  const { nodes, connections, idMap } = cloneRootsWithIdMap(srcComp.graph, logicRoots);
  nodes.forEach((n: any, i: number) => {
    n.x = 300;
    n.y = 40 + i * 140;
    graph.addRoot(n);
  });
  connections.forEach((c: any) => graph.addConnection(c));

  // Declare request/response parameters (drive the pm-* dynamic ports).
  const dataFields = boundary.dataInputs.map((d) => d.field);
  const triggerFlags = boundary.triggers.map((t) => 'is' + t.name);
  const outFields = boundary.outputs.map((o) => o.field);
  requestNode.parameters.params = dedupe([...dataFields, ...triggerFlags]).join(', ');
  responseNode.parameters.params = dedupe(outFields).join(', ');

  // Best-effort wiring: request -> logic, logic -> response. Connections are
  // name-based, so referencing pm-* ports is valid even before the runtime
  // materialises them. Inlining (below) propagates these inward.
  boundary.dataInputs.forEach((d) =>
    d.targets.forEach((t) => {
      const toId = idMap[t.logicTargetId];
      if (toId) {
        graph.addConnection({
          fromId: requestNode.id,
          fromProperty: 'pm-' + d.field,
          toId,
          toProperty: t.logicPort
        });
      }
    })
  );
  boundary.triggers.forEach((tr) =>
    tr.targets.forEach((t) => {
      const toId = idMap[t.logicTargetId];
      if (toId) {
        graph.addConnection({
          fromId: requestNode.id,
          fromProperty: 'pm-is' + tr.name,
          toId,
          toProperty: t.logicPort
        });
      }
    })
  );
  boundary.outputs.forEach((o) => {
    const fromId = idMap[o.logicSourceId];
    if (fromId) {
      graph.addConnection({
        fromId,
        fromProperty: o.logicProperty,
        toId: responseNode.id,
        toProperty: 'pm-' + o.field
      });
    }
  });

  // Recursively inline embedded logic-component instances.
  inlineAll(graph);

  const cloudComp = new ComponentModel({ name: cloudName, graph, id: guid() });
  cloudComp.rekeyAllIds(); // guarantee globally-unique ids
  cloudComp.owner = copy;
  copy.components.push(cloudComp);
  return cloudComp;
}
