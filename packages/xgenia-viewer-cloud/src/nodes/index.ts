import xgeniaRuntime from '@xgenia/runtime';

// Math nodes now live in the private @xgenia/pro-nodes package. The full pro-nodes
// index pulls in PIXI, which cannot be required in the pure-Node cloud runtime, so
// the editor/viewer register maths via the external module loader instead. Here we
// require the PIXI-free maths barrel directly and register each node with the runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mathNodes: any[] = require('@xgenia/pro-nodes/src/maths');

export function registerNodes(runtime: xgeniaRuntime) {
  console.log('[Register Nodes] Registering cloud nodes');
  [
    require('./cloud/request'),
    require('./cloud/response'),
    require('./data/aggregatenode'),
    ...mathNodes
  ].forEach(function (nodeDefinition) {
    console.log('[Register Nodes] Registering node:', nodeDefinition.node?.name);
    runtime.registerNode(nodeDefinition);
  });
  console.log('[Register Nodes] All nodes registered');
}
