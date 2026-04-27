import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { filesystem } from '@xgenia/platform';

import { getExternalFolderPath } from '@xgenia-utils/compilation/build/deploy-index';

import { TypescriptModule } from '../helper';

// Singleton pattern to prevent multiple initializations
let singletonPkg: TypescriptModule | null = null;
let initializationPromise: Promise<void> | null = null;

export function GetOrCreateViewerReactModel(): TypescriptModule {
  // Return cached singleton if available
  if (singletonPkg) {
    return singletonPkg;
  }

  const libPathName = 'inmemory://@xgenia/viewer/react/global.d.ts';
  const libUri = monaco.Uri.parse(libPathName);

  const pkg = new TypescriptModule();
  singletonPkg = pkg; // Cache immediately to prevent re-entry

  // Check if model already exists
  let model = monaco.editor.getModel(libUri);

  if (model) {
    pkg.setModel(model);
    // Model exists, assume extraLib is already loaded
    return pkg;
  }

  // Create model with placeholder
  const loadingSource = '/* loading... */';
  model = monaco.editor.createModel(loadingSource, 'typescript', libUri);
  pkg.setModel(model);

  // Only start async initialization once
  if (!initializationPromise) {
    initializationPromise = (async () => {
      try {
        const filePath = filesystem.join(getExternalFolderPath(), 'viewer', 'global.d.ts.keep');
        const source = await filesystem.readFile(filePath);

        // Double check model wasn't disposed while we were awaiting
        if (model!.isDisposed()) return;

        pkg.setExtraLib(monaco.languages.typescript.javascriptDefaults.addExtraLib(source, libPathName));
        pkg.setSource(source);
      } catch (e: any) {
        console.warn('[GetOrCreateViewerReactModel] Failed to load types:', e);
      }
    })();
  }

  return pkg;
}
