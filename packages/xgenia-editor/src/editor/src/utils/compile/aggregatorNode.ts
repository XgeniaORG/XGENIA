// Step 3 of Compile: drop a single "Aggregator Node" into the visual component
// to replace the logic that was extracted into "/#__cloud__/__Component_N__".
// The aggregator collects the UI outputs (data-<field>) and per-operation
// triggers (do-<X>), POSTs an aggregated payload to the logic component's URL,
// then takes each field of the JSON response and emits it on an out-<field>
// output port, which is wired back to the UI component that originally
// displayed that value (the reverse of the input aggregation).

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { guid } from '@xgenia-utils/utils';
import { Boundary, humanize } from './util';

// Phase-1 placeholder; a later phase swaps in the real Supabase edge-function URL.
function dummyUrlFor(cloudName: string): string {
  const slug = cloudName.replace('/#__cloud__/', '');
  return 'http://localhost:54321/functions/v1/' + encodeURIComponent(slug);
}

function uniqueStrings(list: string[]): string[] {
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

export function insertAggregatorNode(comp: any, cloudName: string, boundary: Boundary): any {
  const graph = comp.graph;

  const dataFields = uniqueStrings(boundary.dataInputs.map((d) => d.field));
  const triggerNames = uniqueStrings(boundary.triggers.map((t) => t.name));
  const outFields = uniqueStrings(boundary.outputs.map((o) => o.field));

  // Pre-populate dynamic ports so the saved JSON is self-describing before the
  // runtime regenerates them from the stringlist params.
  const dynamicports = [
    ...dataFields.map((f) => ({
      name: 'data-' + f,
      displayName: humanize(f),
      plug: 'input',
      type: { name: '*', allowConnectionsOnly: true },
      group: 'Data Inputs'
    })),
    ...triggerNames.map((x) => ({
      name: 'do-' + x,
      displayName: 'Do ' + humanize(x),
      plug: 'input',
      type: 'signal',
      group: 'Triggers'
    })),
    ...outFields.map((f) => ({
      name: 'out-' + f,
      displayName: humanize(f),
      plug: 'output',
      type: { name: '*', allowConnectionsOnly: true },
      group: 'Outputs'
    }))
  ];

  const aggId = guid();
  const aggNode = NodeGraphNode.fromJSON({
    id: aggId,
    type: 'Aggregator',
    x: 360,
    y: 320,
    parameters: {
      url: dummyUrlFor(cloudName),
      dataInputs: dataFields.join(', '),
      triggers: triggerNames.join(', '),
      // Response fields mapped onto out-<field> output ports (wired back to UI).
      outputs: outFields.join(', '),
      // The cloud/logic component this aggregator targets. Used by the RGS
      // deploy flow to map each aggregator to its deployed edge function URL.
      targetComponent: cloudName
    },
    ports: [],
    dynamicports,
    children: []
  } as any);

  graph.addRoot(aggNode);

  // Wire UI outputs -> aggregator (one connection per data field / trigger).
  boundary.dataInputs.forEach((d) =>
    graph.addConnection({
      fromId: d.sourceId,
      fromProperty: d.sourceProperty,
      toId: aggId,
      toProperty: 'data-' + d.field
    })
  );
  boundary.triggers.forEach((t) =>
    graph.addConnection({
      fromId: t.sourceId,
      fromProperty: t.sourceProperty,
      toId: aggId,
      toProperty: 'do-' + t.name
    })
  );

  // Wire aggregator response outputs -> UI inputs (one connection per UI target
  // that originally displayed the extracted logic's output).
  boundary.outputs.forEach((o) =>
    o.targets.forEach((t) =>
      graph.addConnection({
        fromId: aggId,
        fromProperty: 'out-' + o.field,
        toId: t.uiTargetId,
        toProperty: t.uiPort
      })
    )
  );

  return aggNode;
}
