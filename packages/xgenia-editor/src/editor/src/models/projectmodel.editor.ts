import { filesystem } from '@xgenia/platform';

import { applyPatches } from '@xgenia-models/ProjectPatches/applypatches';
import { bugtracker } from '@xgenia-utils/bugtracker';
import FileSystem from '@xgenia-utils/filesystem';

import Model from '../../../shared/model';
import PopupLayer from '../views/popuplayer';
import { ToastLayer } from '../views/ToastLayer/ToastLayer';
import { CloudServiceMetadata, CloudServiceMetadataDataFormat, ProjectModel } from './projectmodel';

const supportedProjectVersion = 4;

// Helper to check if a project might have noodl references that need upgrading to xgenia
function projectMightHavexgeniaReferences(content) {
  // Convert to string and check for various noodl patterns that need conversion
  const contentStr = JSON.stringify(content);

  // Check for the common patterns of noodl references that need upgrading to xgenia
  return contentStr.includes('noodl') || contentStr.includes('net.noodl') || contentStr.includes('Noodl'); // Also catch capitalized versions
}

export function projectFromDirectory(projectdir: string, callback: (project?: ProjectModel) => void, args?: TSFixme) {
  bugtracker.debug('ProjectModel.fromDirectory');

  ProjectModel.readJSONFromDirectory(projectdir, function (content) {
    if (content) {
      const openProject = () => {
        // Before opening the project, we need to patch it, if necessary
        applyPatches(content);

        // Disable model listeners while loading project, otherwise this will bog down large projects
        Model._listenersEnabled = false;
        const project = ProjectModel.fromJSON(content);
        Model._listenersEnabled = true;
        project._retainedProjectDirectory = projectdir;
        console.log('[projectFromDirectory] ProjectModel created. Directory:', project._retainedProjectDirectory);

        // Check if there are any packages
        console.log('[projectFromDirectory] Calling project.readModules()...');
        project.readModules(() => {
          console.log('[projectFromDirectory] project.readModules() callback executed.');
          callback(project);
        });
      };

      //is project version incompatible?
      if (content.version > supportedProjectVersion) {
        ToastLayer.hideAll();
        PopupLayer.instance.showErrorModal({
          message:
            'This project was saved with a newer version of XGENIA.<br/><a href="https://xgenia.net" target="_blank">Click here to download</a>',
          title: 'Error opening project'
        });
        callback();
        return;
      }

      // Check if project needs upgrade - either due to version or having noodl references
      const needsUpgrade = content.version < supportedProjectVersion || projectMightHavexgeniaReferences(content);

      // Apply upgrades automatically without showing modal - user rule: upgrades should happen in background
      if (needsUpgrade) {
        console.log('[projectFromDirectory] Project needs upgrade, applying automatically...');

        if (content.version < supportedProjectVersion) {
          console.log(
            '[projectFromDirectory] Upgrading project from version',
            content.version,
            'to',
            supportedProjectVersion
          );
        }

        if (projectMightHavexgeniaReferences(content)) {
          console.log('[projectFromDirectory] Converting noodl references to xgenia...');
        }

        // Apply upgrade automatically - no user intervention required
        openProject();
      } else {
        openProject();
      }
    } else {
      console.error('[projectFromDirectory] Failed to read project.json content.');
      bugtracker.track('ProjectModel.fromDirectory readJSONFromDirectory failed', {
        dir: projectdir,
        dirContent: FileSystem.instance.readDirectorySync(projectdir)
      });
      callback(); // Failed to read project
    }
  });
}

// Extracts a zip into a directory and returns the project in a callback
// TODO: Replace partly with Filesystem.instance.unzipIntoDirectory
export async function unzipIntoDirectory(
  url: string,
  dirEntry: string,
  callback,
  args?: {
    noAuth?: boolean;
    skipLoad?: boolean;
  }
) {
  // Make sure the folder is empty
  const isEmpty = await filesystem.isDirectoryEmpty(dirEntry);
  if (!isEmpty) {
    callback({
      result: 'failure',
      message: 'Folder must be empty'
    });
    return;
  }

  // Load zip file from URL
  try {
    await filesystem.unzipUrl(url, dirEntry);
  } catch (e: any) {
    callback({
      result: 'failure',
      message: 'Failed to extract'
    });
    return;
  }

  if (args && args.skipLoad) {
    // Skip loading the project?
    callback({
      result: 'success',
      dirEntry: dirEntry
    });
    return;
  }

  // Project extracted successfully, load it
  projectFromDirectory(dirEntry, function (project) {
    if (!project) {
      callback({
        result: 'failure',
        message: 'Failed to load project'
      });
      return;
    }

    // Store the project again, this will make it a unique project by
    // forcing it to generate a project id
    project.id = undefined;
    //project.name = dirEntry.split('/').pop();
    project.toDirectory(project._retainedProjectDirectory, function (res) {
      if (res.result === 'success')
        callback({
          result: 'success',
          project: project
        });
      else
        callback({
          result: 'failure',
          message: 'Failed to clone project'
        });
    });
  });
}

// NEW: Enhanced metadata structure to support multiple backend types
export function setCloudServices(project: ProjectModel, broker: CloudServiceMetadata) {
  console.log('[setCloudServices] === FUNCTION CALLED ===');
  console.log('[setCloudServices] Called with broker:', broker);

  const actualEnv = broker.environment; // The actual Environment instance
  console.log('[setCloudServices] Environment object:', actualEnv);
  console.log('[setCloudServices] Environment type:', typeof actualEnv);
  console.log('[setCloudServices] Environment constructor:', actualEnv?.constructor?.name);

  // Check isSupabase method availability and result
  let isSupabaseEnvironment = false;
  if (actualEnv) {
    console.log('[setCloudServices] Environment has isSupabase method:', typeof actualEnv.isSupabase === 'function');
    if (typeof actualEnv.isSupabase === 'function') {
      isSupabaseEnvironment = actualEnv.isSupabase();
      console.log('[setCloudServices] Environment isSupabase() result:', isSupabaseEnvironment);
    } else {
      // Alternative method: check for Supabase properties
      isSupabaseEnvironment = !!(actualEnv.supabaseUrl && actualEnv.anonKey);
      console.log(
        '[setCloudServices] Environment isSupabase method not found, checking properties. Is Supabase:',
        isSupabaseEnvironment
      );
      console.log(
        '[setCloudServices] Available methods on environment:',
        Object.getOwnPropertyNames(actualEnv).filter((prop) => typeof actualEnv[prop] === 'function')
      );
    }

    // Check environment properties
    console.log('[setCloudServices] Environment properties:');
    console.log('  - supabaseUrl:', actualEnv.supabaseUrl);
    console.log('  - anonKey:', actualEnv.anonKey ? 'Present' : 'Missing');
    console.log('  - serviceRoleKey:', actualEnv.serviceRoleKey ? 'Present' : 'Missing');
    console.log('  - enableRealtime:', actualEnv.enableRealtime);
    console.log('  - url:', actualEnv.url);
    console.log('  - appId:', actualEnv.appId);
  } else {
    console.log('[setCloudServices] ❌ Environment object is null/undefined!');
  }

  let endpointForBase = broker.endpoint || broker.url; // Default endpoint from broker
  if (isSupabaseEnvironment && actualEnv.supabaseUrl) {
    endpointForBase = actualEnv.supabaseUrl; // Prefer supabaseUrl if it's a Supabase env
    console.log('[setCloudServices] Using Supabase URL as endpoint:', endpointForBase);
  }

  // Base metadata that's common to all environments
  const baseMetadata: CloudServiceMetadataDataFormat = {
    instanceId: broker.id,
    endpoint: endpointForBase,
    appId: broker.appId
  };
  console.log('[setCloudServices] Base metadata:', baseMetadata);

  // If this is a Supabase environment, add Supabase-specific configuration
  if (isSupabaseEnvironment) {
    console.log('[setCloudServices] ✅ DETECTED AS SUPABASE ENVIRONMENT - Creating Supabase configuration...');
    const supabaseMetadata = {
      ...baseMetadata, // baseMetadata now has the correctly preferred endpoint
      supabase: {
        enabled: true,
        url: actualEnv.supabaseUrl, // Use actualEnv for Supabase specific details
        anonKey: actualEnv.anonKey,
        serviceRoleKey: actualEnv.serviceRoleKey,
        enableRealtime: actualEnv.enableRealtime !== false
      },
      routing: {
        default: 'supabase',
        collections: {}
      }
    };
    console.log('[setCloudServices] Setting Supabase metadata:', JSON.stringify(supabaseMetadata, null, 2));
    project.setMetaData('cloudservices', supabaseMetadata);

    // Force immediate persistence to storage
    if (typeof (project as any).markAsChanged === 'function') {
      (project as any).markAsChanged();
    }
  } else {
    // Standard Parse Server configuration (unchanged for backward compatibility)
    console.log('[setCloudServices] ❌ NOT DETECTED AS SUPABASE - Creating Parse Server configuration...');
    console.log(
      '[setCloudServices] Reason: actualEnv=' + !!actualEnv + ', isSupabaseEnvironment=' + isSupabaseEnvironment
    );
    console.log('[setCloudServices] Setting Parse Server metadata:', JSON.stringify(baseMetadata, null, 2));
    project.setMetaData('cloudservices', baseMetadata);
  }

  // Ensure listeners are notified
  project.notifyListeners('cloudServicesChanged');
  if (typeof (project as any).emit === 'function') {
    (project as any).emit('metadataChanged.cloudservices');
    (project as any).emit('cloudServicesChanged');
  }

  console.log('[setCloudServices] === FUNCTION COMPLETE ===');
  console.log('[setCloudServices] Metadata set and listeners notified');

  // Verify the metadata was set correctly
  const verifiedMetadata = project.getMetaData('cloudservices');
  console.log('[setCloudServices] Verification - Current metadata:', JSON.stringify(verifiedMetadata, null, 2));

  if (isSupabaseEnvironment) {
    // Verify the supabase object was set
    console.log('[setCloudServices] Verification - Supabase config exists:', !!verifiedMetadata.supabase);
    console.log('[setCloudServices] Verification - Routing config exists:', !!verifiedMetadata.routing);
  }
}

export function getCloudServices(project: ProjectModel): CloudServiceMetadata {
  const cloudServices = project.getMetaData('cloudservices');
  if (!cloudServices) {
    return {
      id: undefined,
      endpoint: undefined,
      appId: undefined
    };
  }

  return {
    id: cloudServices.instanceId,
    endpoint: cloudServices.endpoint,
    appId: cloudServices.appId
  };
}
