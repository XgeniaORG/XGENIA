import xgeniaRuntime from '@xgenia/runtime';

export function registerNodes(runtime: xgeniaRuntime) {
  console.log('[Register Nodes] Registering cloud nodes');
  [require('./cloud/request'), require('./cloud/response'), require('./data/aggregatenode')].forEach(function (
    nodeDefinition
  ) {
    console.log('[Register Nodes] Registering node:', nodeDefinition.node?.name);
    runtime.registerNode(nodeDefinition);
  });
  console.log('[Register Nodes] All nodes registered');
}
