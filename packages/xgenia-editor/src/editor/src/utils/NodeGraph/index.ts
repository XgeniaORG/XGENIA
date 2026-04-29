import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { RuntimeType } from '@xgenia-models/nodelibrary/NodeLibraryData';

export function getComponentModelRuntimeType(node: ComponentModel) {
  const name = node.name;

  if (name.startsWith('/#__cloud__/')) {
    return RuntimeType.Cloud;
  }

  if (name.startsWith('/#__maths__/')) {
    return RuntimeType.Maths;
  }

  return RuntimeType.Browser;
}

export const isComponentModel_BrowserRuntime = (node: ComponentModel) =>
  getComponentModelRuntimeType(node) === RuntimeType.Browser;
export const isComponentModel_CloudRuntime = (node: ComponentModel) =>
  getComponentModelRuntimeType(node) === RuntimeType.Cloud;
export const isComponentModel_MathsRuntime = (node: ComponentModel) =>
  getComponentModelRuntimeType(node) === RuntimeType.Maths;

export function getNodeGraphNodeRuntimeType(node: NodeGraphNode): RuntimeType {
  const name = node?.owner?.owner?.name;
  if (name?.startsWith('/#__cloud__')) return RuntimeType.Cloud;
  if (name?.startsWith('/#__maths__')) return RuntimeType.Maths;
  return RuntimeType.Browser;
}
