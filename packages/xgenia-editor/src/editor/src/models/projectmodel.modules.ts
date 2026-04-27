import { filesystem } from '@xgenia/platform';
import { bugtracker } from '@xgenia-utils/bugtracker';
import path from 'path';
import fs from 'fs';

// TODO: Can we merge this with ProjectModules ?

export type ProjectModule = {
  main?: string;
  name: string;
  type: 'iconset' | undefined;
  icons?: string[];
  iconClass?: string;
  dependencies?: string[];
  browser?: {
    stylesheets?: string[];
  };
};

export interface ProjectModuleManifest {
  name: string;
  manifest: TSFixme;
}

export async function listProjectModules(project: TSFixme /* ProjectModel */): Promise<ProjectModuleManifest[]> {
  console.log('[listProjectModules] Starting module scan for project:', project._retainedProjectDirectory);
  var modules: {
    name: string;
    manifest: any;
  }[] = [];

  const modulesPath = project._retainedProjectDirectory + '/xgenia_modules';
  console.log('[listProjectModules] Checking modules path:', modulesPath);
  
  const files = await filesystem.listDirectory(modulesPath);
  console.log('[listProjectModules] Files found in xgenia_modules:', files);

  await Promise.all(
    files.map(async (file) => {
      console.log('[listProjectModules] Processing file:', file);
      if (file.isDirectory) {
        console.log('[listProjectModules] Processing directory:', file.name);
        const manifestPath = filesystem.join(modulesPath, file.name, 'manifest.json');
        console.log('[listProjectModules] Reading manifest from:', manifestPath);
        
        try {
          const manifest = await filesystem.readJson(manifestPath);
          console.log('[listProjectModules] Successfully read manifest for', file.name, ':', manifest);

          modules.push({
            name: file.name,
            manifest
          });
          
          console.log('[listProjectModules] Added module to list:', file.name);
        } catch (error: any) {
          console.error('[listProjectModules] Error reading manifest for', file.name, ':', error);
        }
      } else {
        console.log('[listProjectModules] Skipping non-directory:', file.name);
      }
    })
  );

  console.log('[listProjectModules] Final modules list:', modules);
  return modules;
}

export async function readProjectModules(project: TSFixme /* ProjectModel */): Promise<ProjectModule[]> {
  console.log(`[readProjectModules] Starting scan in directory: ${project._retainedProjectDirectory}`);
  const _modulesDir = path.join(project._retainedProjectDirectory, 'xgenia_modules');
  console.log(`[readProjectModules] Module directory path: ${_modulesDir}`);

  let moduleNames: string[] = [];
  try {
    moduleNames = fs.readdirSync(_modulesDir);
    console.log(`[readProjectModules] Found items in xgenia_modules:`, moduleNames);
  } catch (e: any) {
    console.log(`[readProjectModules] Error reading xgenia_modules directory (or it doesn't exist):`, e.message);
    project.modules = [];
    project.previews = [];
    project.componentAnnotations = {};
    return project.modules;
  }

  project.modules = [];
  project.previews = [];
  project.componentAnnotations = {};

  const processingPromises = moduleNames.map(async (moduleName) => {
    const modulePath = path.join(_modulesDir, moduleName);
    let manifest: any = null;

    try {
      // Check if it's a directory before proceeding
      const stats = fs.statSync(modulePath);
      if (!stats.isDirectory()) {
        console.log(`[readProjectModules] Skipping '${moduleName}' because it is not a directory.`);
        return; // Skip non-directories like .DS_Store
      }

      const manifestPath = path.join(modulePath, 'manifest.json');
      const content = await filesystem.readFile(manifestPath);
      console.log(`[readProjectModules] Successfully read manifest.json for ${moduleName}`);
      manifest = JSON.parse(content);
      console.log(`[readProjectModules] Successfully parsed manifest for ${moduleName}`);
    } catch (e: any) {
      console.error(`[readProjectModules] Failed to read or parse manifest.json for module ${moduleName}`, e);
      return;
    }

    if (!manifest) { // Check if parsing resulted in a falsy manifest (e.g. parsing "null")
      console.warn(`[readProjectModules] Manifest for module ${moduleName} parsed to a falsy value or is empty.`);
      return;
    }

    // Log the manifest object before further processing
    console.log(`[readProjectModules] Manifest object for ${moduleName} before name assignment:`, JSON.stringify(manifest));

    // Always assign the directory name as the module name, like the old code did.
    // This handles cases where manifest.json doesn't have its own "name" property.
    manifest.name = moduleName;
    project.modules.push(manifest);

    // Log after pushing to the array
    console.log(`[readProjectModules] Module ${moduleName} supposedly pushed to project.modules. Current count: ${project.modules.length}`);

    if (manifest.componentAnnotations) {
      for (var comp in manifest.componentAnnotations) {
        var ca = manifest.componentAnnotations[comp];

        if (!project.componentAnnotations[comp]) project.componentAnnotations[comp] = {};
        for (var key in ca) project.componentAnnotations[comp][key] = ca[key];
      }
    }

    if (manifest.previews) {
      project.previews = manifest.previews.concat(project.previews);
    }
  });

  console.log('[readProjectModules] About to await Promise.all for module processing.');
  try {
    await Promise.all(processingPromises);
    console.log('[readProjectModules] Promise.all for module processing completed.');
  } catch (error: any) {
    console.error('[readProjectModules] Error during Promise.all for module processing:', error);
  }

  console.log(`[readProjectModules] Finished processing. Loaded ${project.modules.length} modules:`, project.modules.map(m => m.name).join(', '));

  return project.modules;
}
