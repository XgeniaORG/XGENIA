import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { NodeGrapPort } from '@xgenia-models/NodeGraphPort';
import { RuntimeType } from '@xgenia-models/nodelibrary/NodeLibraryData';

import { plugTypeToTSDef, TypescriptModule } from '../../helper';

type PortGroup = 'Inputs' | 'Outputs';

interface Port extends Pick<NodeGrapPort, 'name' | 'displayName' | 'type' | 'plug'> {
  group: PortGroup;
}

function generateTypeDefinitions(ports: Port[]): { inputs: string[]; outputs: string[] } {
  return ports.reduce(
    (acc, port) => {
      const portName = String(port.name || '');
      const line = `    readonly ['${portName}']: ${port.type || 'any'};`;
      if (port.group === 'Inputs') {
        acc.inputs.push(line);
      } else if (port.group === 'Outputs') {
        acc.outputs.push(line);
      }
      return acc;
    },
    { inputs: [] as string[], outputs: [] as string[] }
  );
}

function functionLib(node: NodeGraphNode): string {
  const ports = (node?.getPorts() ?? [])
    .filter((x: NodeGrapPort): x is NodeGrapPort & { group: PortGroup } =>
      x && x.group && ['Inputs', 'Outputs'].includes(String(x.group))
    )
    .map((x) => ({
      name: String(x.displayName || x.name || ''),
      type: plugTypeToTSDef(x.type, x.group === 'Inputs'),
      group: x.group as PortGroup,
      plug: x.plug
    }));

  const { inputs, outputs } = generateTypeDefinitions(ports);

  const source = [
    'type Prettify<T> = {',
    '  [K in keyof T]: T[K];',
    '} & {};',
    '',
    'type InputTypes = {',
    ...inputs,
    '',
    '    readonly [key: string]: any;',
    '}',
    '',
    'type OutputTypes = {',
    ...outputs,
    '',
    '    [key: string]: unknown;',
    '}',
    '',
    'declare const Inputs: Prettify<InputTypes>;',
    'declare const Outputs: Prettify<OutputTypes>;',
    ''
  ];

  const ownerName = node?.owner?.owner?.name || '';
  if (ownerName && String(ownerName).startsWith('/#__cloud__/')) {
    source.push('declare function query(className: string, query?: any, options?: any): Promise<any>;');
  }

  source.push(`/*${ownerName}*/`);

  return source.join('\n');
}

function buildNodeLib(node: NodeGraphNode) {
  const libPathName = 'inmemory://@xgenia/nodes/JavaScriptFunction/JavaScriptFunction.d.ts';
  const libUri = monaco.Uri.parse(libPathName);
  const source = functionLib(node);

  return { source, libPathName, libUri };
}

export function registerOrUpdate_JavaScriptFunction(
  node: NodeGraphNode,
  runtimeType: RuntimeType
): TypescriptModule {
  const { source, libPathName, libUri } = buildNodeLib(node);
  const pkg = new TypescriptModule();

  pkg.setLib(runtimeType === RuntimeType.Browser ? ['dom', 'es2020'] : ['es2020']);

  try {
    const existingModel = monaco.editor.getModel(libUri);
    if (existingModel) {
      pkg.setModel(existingModel);

      // Only update source if it actually changed
      if (existingModel.getValue() !== source) {
        pkg.setSource(source);
        // Update the extraLib to match the new source
        try {
          pkg.setExtraLib(monaco.languages.typescript.javascriptDefaults.addExtraLib(source, libPathName));
        } catch (e: any) {
          console.warn('[registerOrUpdate_JavaScriptFunction] Failed to update extraLib:', e);
        }
      }
    } else {
      const newModel = monaco.editor.createModel(source, 'typescript', libUri);
      pkg.setModel(newModel);
      try {
        pkg.setExtraLib(monaco.languages.typescript.javascriptDefaults.addExtraLib(source, libPathName));
      } catch (e: any) {
        console.warn('[registerOrUpdate_JavaScriptFunction] Failed to add extraLib:', e);
      }
      pkg.setSource(source);
    }
  } catch (e: any) {
    console.error('[registerOrUpdate_JavaScriptFunction] Error:', e);
  }

  return pkg;
}
