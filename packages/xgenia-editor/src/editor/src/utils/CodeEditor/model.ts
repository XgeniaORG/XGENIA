import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { uniq } from 'underscore';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { RuntimeType } from '@xgenia-models/nodelibrary/NodeLibraryData';
import { EditorModel } from '@xgenia-utils/CodeEditor/model/editorModel';
import { TypescriptModule } from '@xgenia-utils/CodeEditor/typescript/helper';
import { registerOrUpdate_DbCollection2 } from '@xgenia-utils/CodeEditor/typescript/nodes/DbCollection2';
import { registerOrUpdate_Expression } from '@xgenia-utils/CodeEditor/typescript/nodes/Expression';
import { registerOrUpdate_Javascript2 } from '@xgenia-utils/CodeEditor/typescript/nodes/Javascript2';
import { registerOrUpdate_JavaScriptFunction } from '@xgenia-utils/CodeEditor/typescript/nodes/JavaScriptFunction';
import { GetOrCreateViewerModel } from '@xgenia-utils/CodeEditor/typescript/viewer';
import { GetOrCreateViewerCloudModel } from '@xgenia-utils/CodeEditor/typescript/viewer-cloud';
import { GetOrCreateViewerReactModel } from '@xgenia-utils/CodeEditor/typescript/viewer-react';
import { getNodeGraphNodeRuntimeType } from '@xgenia-utils/NodeGraph';

import { codeEditorTypeToLanguageId } from './mappings';

/**
 * KNOWN ISSUE: Monaco TypeScript worker "Unexpected usage" errors
 * 
 * These errors occur when multiple Monaco models/extraLibs are created concurrently.
 * The TypeScript worker enters an inconsistent state during parallel loadForeignModule calls.
 * This is a Monaco-editor limitation, not a code bug.
 * 
 * The errors are non-critical - the editor still works correctly.
 * A proper fix would require serializing all TypeScript model operations.
 */

// Cache for compiler options to prevent repeated setCompilerOptions calls
let lastLibConfigHash: string | null = null;

export interface createModelOptions {
  type: string;
  value: string;
  codeeditor: string;
}

/**
 * Create the Monaco Model, with better typings etc
 */
export function createModel(options: createModelOptions, node: NodeGraphNode): EditorModel {
  // arrays are edited as javascript (and eval:ed during runtime)
  // we are not going to add any extra typings here.
  if (options.type === 'array') {
    return new EditorModel(monaco.editor.createModel(options.value, 'javascript'));
  }

  const modules: TypescriptModule[] = [];

  if (['javascript', 'typescript'].includes(options.codeeditor)) {
    const runtimeType = getNodeGraphNodeRuntimeType(node);

    if (node.typename !== 'Expression') {
      modules.push(GetOrCreateViewerModel());
    }

    const defaultLibs: string[] = [];

    switch (runtimeType) {
      case RuntimeType.Browser:
        modules.push(GetOrCreateViewerReactModel());
        break;

      case RuntimeType.Cloud:
        modules.push(GetOrCreateViewerCloudModel());
        break;
    }

    switch (node.typename) {
      case 'DbCollection2':
        modules.push(registerOrUpdate_DbCollection2(node));
        break;

      case 'Expression':
        modules.push(registerOrUpdate_Expression());
        break;

      case 'JavaScriptFunction':
        modules.push(registerOrUpdate_JavaScriptFunction(node, runtimeType));
        break;

      case 'Javascript2':
        modules.push(registerOrUpdate_Javascript2(node, runtimeType));
        break;

      default:
        switch (runtimeType) {
          case RuntimeType.Browser:
            defaultLibs.push('dom', 'es2020');
            break;

          case RuntimeType.Cloud:
            defaultLibs.push('es2020');
            break;
        }
        break;
    }

    // Get a list of all the available libs
    // this is removing all the DOM typings
    const lib = uniq([...defaultLibs, ...modules.flatMap((x) => x.libs)]);

    // Only update compiler options if they've actually changed
    // This prevents repeated TypeScript worker re-initialization
    const libConfigHash = lib.sort().join(',');

    if (libConfigHash !== lastLibConfigHash) {
      lastLibConfigHash = libConfigHash;

      const compilerOptions: monaco.languages.typescript.CompilerOptions = {
        target: monaco.languages.typescript.ScriptTarget.ES5,
        lib,
        allowNonTsExtensions: true,
        allowJs: true,
        noImplicitAny: false
      };

      monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions);
      monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions);
      monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
      });
    }
  }

  const languageId = codeEditorTypeToLanguageId(options.codeeditor);
  const model = monaco.editor.createModel(options.value, languageId);

  return new EditorModel(model, modules);
}

