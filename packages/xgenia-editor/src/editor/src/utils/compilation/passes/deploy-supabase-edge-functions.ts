/**
 * Supabase Edge Functions Deployment Script
 *
 * This script integrates with the existing XGENIA deployment system to deploy
 * cloud functions to Supabase Edge Functions when a Supabase cloud service is active.
 */

import { filesystem, platform } from '@xgenia/platform';
import { XgeniaComponent, XgeniaToSupabaseConverter } from '@xgenia/runtime/src/api/supabase-converter';
// Import the Supabase integration
import { SupabaseEdgeFunctionIntegration, SupabaseProjectConfig } from '@xgenia/runtime/src/api/supabase-integration';

import { CloudServiceType } from '@xgenia-models/CloudServices/type';
import { BuildScript, NotifyType } from '@xgenia-utils/compilation/build-context';
import { exportComponentsToJSON } from '@xgenia-utils/exporter';

type CloudRuntimeManifest = {
  version: string;
};

/**
 * Gives the path to the "external" folder.
 */
function getExternalFolderPath() {
  return filesystem.join(platform.getAppPath(), 'src/external');
}

function loadCloudRuntimeManifest(): Promise<CloudRuntimeManifest> {
  const indexPath = filesystem.join(getExternalFolderPath(), 'cloudruntime', 'index.json');
  return filesystem.readJson(indexPath);
}

/**
 * Convert XGENIA components to Supabase Edge Functions format
 */
function convertComponentsToSupabaseFunctions(components: any[]): XgeniaComponent[] {
  const validComponents: XgeniaComponent[] = [];

  console.log('Converting components to Supabase functions, total components:', components.length);

  for (const component of components) {
    if (!component.name.startsWith('/#__cloud__/')) {
      continue;
    }

    try {
      const functionName = component.name.replace('/#__cloud__/', '');
      console.log('Processing component for deployment:', component.name, 'ID:', component.id);
      console.log('Original component structure:', JSON.stringify(component, null, 2));

      // Debug: Check if all nodes referenced in connections are present in roots
      const connectionNodeIds = new Set();
      component.graph.connections?.forEach((conn: any) => {
        connectionNodeIds.add(conn.fromId);
        connectionNodeIds.add(conn.toId);
      });

      const rootNodeIds = new Set(component.graph.roots?.map((root: any) => root.id) || []);
      const missingNodeIds = [...connectionNodeIds].filter((id) => !rootNodeIds.has(id));

      if (missingNodeIds.length > 0) {
        console.warn(`Missing nodes in roots array: ${missingNodeIds.join(', ')}`);
        console.log('Connection node IDs:', [...connectionNodeIds]);
        console.log('Root node IDs:', [...rootNodeIds]);

        // Try to find missing nodes in other parts of the component
        console.log('Component keys:', Object.keys(component));
        if (component.graph) {
          console.log('Graph keys:', Object.keys(component.graph));
        }

        // Check if nodes are stored in children of root nodes
        component.graph.roots?.forEach((root: any, index: number) => {
          if (root.children && root.children.length > 0) {
            console.log(
              `Root ${index} has children:`,
              root.children.map((child: any) => ({ id: child.id, type: child.type }))
            );
          }
        });
      }

      // Find request and response nodes
      const requestNode = component.graph.roots.find((root: any) => {
        const nodeType = typeof root.type === 'string' ? root.type : root.type?.name;
        return nodeType === 'xgenia.cloud.request';
      });
      const responseNode = component.graph.roots.find((root: any) => {
        const nodeType = typeof root.type === 'string' ? root.type : root.type?.name;
        return nodeType === 'xgenia.cloud.response';
      });

      if (!requestNode || !responseNode) {
        console.warn(`Skipping component ${functionName}: missing request or response node`);
        console.log(
          'Available roots:',
          component.graph.roots.map((root: any) => ({ id: root.id, typeName: root.type?.name, type: root.type }))
        );
        continue;
      }

      // Convert to XgeniaComponent format
      const xgeniaComponent: XgeniaComponent = {
        name: component.name,
        id: component.id,
        displayName: component.displayName || functionName,
        graph: {
          roots: component.graph.roots,
          connections: component.graph.connections || [],
          visualRoots: component.graph.visualRoots || []
        }
      };

      console.log('Converted XgeniaComponent structure:', JSON.stringify(xgeniaComponent, null, 2));
      validComponents.push(xgeniaComponent);
    } catch (error: any) {
      console.error(`Failed to convert component ${component.name}:`, error);
    }
  }

  return validComponents;
}

/**
 * Extract project ID from Supabase URL
 */
function extractProjectIdFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Extract project ID from hostname like "yourproject.supabase.co"
    const match = hostname.match(/^([^.]+)\.supabase\.(co|io)$/);
    return match ? match[1] : null;
  } catch (error: any) {
    return null;
  }
}

export const deploySupabaseEdgeFunctionBuildScript: BuildScript = {
  // Called Pre Build
  async onPreBuild(context) {
    // Check if we have a Supabase environment
    const environment = context.environment;
    if (!environment || environment.type !== CloudServiceType.SUPABASE) {
      return; // Not a Supabase environment, skip
    }

    // Check if access token is available
    if (!environment.accessToken) {
      context.notify(NotifyType.Warning, 'Supabase access token not configured. Edge Functions deployment skipped.');
      return;
    }

    // Extract all the __cloud__ components
    const allComponents = context.project.getComponents();
    console.log(
      'All project components:',
      allComponents.map((c) => ({ name: c.name, id: c.id }))
    );

    const components = allComponents.filter((x) => x.name.startsWith('/#__cloud__/'));
    console.log(
      'Filtered cloud components:',
      components.map((c) => ({ name: c.name, id: c.id }))
    );

    if (components.length === 0) {
      return; // No cloud functions to deploy
    }

    // Debug: Log the first component in detail
    if (components.length > 0) {
      console.log('First component detailed structure:', JSON.stringify(components[0], null, 2));
    }

    await context.activity(
      {
        message: `Deploying Cloud Functions to Supabase Edge Functions...`,
        successMessage: `Successfully deployed Cloud Functions to Supabase Edge Functions.`
      },
      async () => {
        try {
          // Extract project ID from URL
          const projectId = extractProjectIdFromUrl(environment.url);
          if (!projectId) {
            throw new Error('Could not extract project ID from Supabase URL');
          }

          // Configure Supabase integration
          const integration = new SupabaseEdgeFunctionIntegration();
          const projectConfig: SupabaseProjectConfig = {
            projectId,
            accessToken: environment.accessToken,
            url: environment.url,
            anonKey: environment.anonKey,
            serviceRoleKey: environment.serviceRoleKey
          };

          integration.configure(projectConfig);

          // Convert components to Supabase functions
          const xgeniaComponents = convertComponentsToSupabaseFunctions(components);

          if (xgeniaComponents.length === 0) {
            context.notify(NotifyType.Notice, 'No valid cloud functions found to deploy.');
            return;
          }

          console.log(`Deploying ${xgeniaComponents.length} functions to Supabase Edge Functions...`);

          // Use the new converter to deploy functions
          const converter = new XgeniaToSupabaseConverter();
          // Configure the converter with credentials
          converter['apiClient']['credentialManager'].setCredentials({
            projectId,
            accessToken: environment.accessToken
          });
          const deployedFunctions = await converter.deployFunctions(xgeniaComponents); // Deploy/update existing

          console.log(`Successfully deployed ${deployedFunctions.length} functions:`);
          deployedFunctions.forEach((func) => {
            console.log(`  - ${func.name} (ID: ${func.id}, Status: ${func.status})`);
          });

          // Update project metadata
          context.project.metadata.cloudfunctions = {
            version: '1.0.0',
            supabaseDeployment: {
              timestamp: new Date().toISOString(),
              deployedCount: deployedFunctions.length,
              functions: deployedFunctions.map((f) => ({
                name: f.name,
                id: f.id,
                status: f.status
              }))
            }
          };
        } catch (error: any) {
          console.error('Error deploying to Supabase Edge Functions:', error);
          throw error;
        }
      }
    );
  }
};

/**
 * Alternative deployment script that works alongside the existing Parse Server deployment
 */
export const deployCloudFunctionBuildScriptWithSupabase: BuildScript = {
  async onPreBuild(context) {
    const environment = context.environment;
    if (!environment) {
      context.notify(NotifyType.Error, 'No cloud service to deploy cloud functions to.');
      return;
    }

    // Extract all the __cloud__ components
    const components = context.project.getComponents().filter((x) => x.name.startsWith('/#__cloud__/'));
    if (components.length === 0) {
      return;
    }

    await context.activity(
      {
        message: `Deploying Cloud functions to ${environment.name}.`,
        successMessage: `Successfully deployed Cloud functions to ${environment.name}.`
      },
      async () => {
        if (environment.type === CloudServiceType.SUPABASE) {
          // Deploy to Supabase Edge Functions
          await deploySupabaseEdgeFunctionBuildScript.onPreBuild(context);
        } else {
          // Deploy to Parse Server (existing logic)
          const exportedComponents = exportComponentsToJSON(context.project, components, {
            useBundles: false,
            environment: context.environment
          });

          // Delete some data we don't care about on the backend.
          if (exportedComponents.metadata) {
            delete exportedComponents.metadata.variants;
            delete exportedComponents.metadata.styles;
          }

          delete exportedComponents.componentIndex;

          const json = JSON.stringify(exportedComponents);

          // Deploy functions to the backend
          console.log('Deploying cloud functions to:' + environment.url);
          const manifest = await loadCloudRuntimeManifest();
          console.log(' - Using cloud runtime version: ' + manifest.version);

          try {
            const response = await fetch(environment.url + '/functions/deploy', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Parse-Application-Id': environment.appId,
                'X-Parse-Master-Key': environment.masterKey
              },
              body: JSON.stringify({
                // Project ID, let the server know about which project is pushing changes.
                projectId: context.project.id,
                projectName: context.project.name,
                deploy: json,
                runtime: manifest.version
              })
            });

            // NOTE: Expecting that we always get a JSON response
            const responseContent = await response.json();
            if (responseContent.status !== 'success') {
              throw new Error('Error while deploying: ' + JSON.stringify(responseContent));
            }

            const version = responseContent.version;
            // NOTE: We cannot change "cloudservices" since that is updated exportToJSON
            context.project.metadata.cloudfunctions = {
              version
            };
          } catch (e: any) {
            console.log('Error while deploying: ', e);
            throw e;
          }
        }
      }
    );
  }
};
