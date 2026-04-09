import { CloudService } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { getCloudServices, setCloudServices } from '@xgenia-models/projectmodel.editor';
import SchemaModel from '@xgenia-models/schemamodel';

import { EventDispatcher } from '../../../shared/utils/EventDispatcher';

export default class SchemaHandler {
  public static instance: SchemaHandler | undefined;

  public haveCloudServices: boolean;
  public schemaModel: SchemaModel | undefined;
  public dbCollections: TSFixme[];
  public systemCollections: TSFixme[];
  public configSchema: TSFixme;
  public parseServerVersion: string;

  constructor() {
    EventDispatcher.instance.on(
      ['window-focused', 'Model.cloudServicesChanged'],
      () => {
        if (ProjectModel.instance) {
          this._fetch();
        }
      },
      this
    );
  }

  dispose() {
    EventDispatcher.instance.off(this);
  }

  _fetch() {
    return new Promise<void>((resolve) => {
      this.dbCollections = [];

      const activeBroker = getCloudServices(ProjectModel.instance);
      if (!activeBroker || activeBroker.id === undefined) {
        this.haveCloudServices = false;
        this._store();
        return; // No project broker
      }

      CloudService.instance.backend.fetch().then((collection) => {
        // Find by the Url / Endpoint and app id
        let environment = collection.find((b) => {
          return b.url === activeBroker.endpoint && b.appId === activeBroker.appId;
        });

        // Backwards compatibility:
        //    Make sure that the URL is the same as the one in the database.
        if (!environment) {
          // Find by the ID
          environment = collection.find((b) => b.id === activeBroker.id);

          // Update the stored cloud service
          if (environment) {
            setCloudServices(ProjectModel.instance, {
              id: environment.id,
              endpoint: environment.url,
              appId: environment.appId
            });
          }
        }

        this.haveCloudServices = environment !== undefined;
        if (environment === undefined) {
          this._store();
          return;
        }

        const opts = {
          endpoint: environment.url,
          instanceId: environment.id,
          masterKey: environment.masterKey,
          appId: environment.appId
        };
        this.schemaModel = new SchemaModel(opts);

        const ignoreCollections = ['Ndl_CF']; // Ignore the Ndl_CF collection, containing cloud function deploys

        // NEW: Check if this is a Supabase endpoint
        const isSupabaseEndpoint =
          environment.url &&
          (environment.url.includes('supabase.co') ||
            environment.url.includes('supabase.io') ||
            environment.url.includes('supabase.red') ||
            environment.url.includes('supabase.green'));

        if (isSupabaseEndpoint) {
          // For Supabase, we don't have schema introspection like Parse Server
          // Set empty collections and skip serverInfo request
          this.dbCollections = [];
          this.systemCollections = [];
          this.parseServerVersion = 'Supabase';

          // Fetch Supabase secrets and build config schema
          this._fetchSupabaseConfigSchema(environment)
            .then(() => {
              this._store();
              resolve();
            })
            .catch((error) => {
              console.warn('[SchemaHandler] Failed to fetch Supabase config schema:', error);
              // Set empty config schema on error
              this.configSchema = {};
              this._store();
              resolve();
            });
          return;
        }

        this.schemaModel.listSchemas({
          success: (schemas: TSFixme) => {
            this.dbCollections = schemas
              .filter((r: TSFixme) => r.name[0] !== '_' && ignoreCollections.indexOf(r.name) == -1)
              .map((schema: TSFixme) => {
                return {
                  name: schema.name,
                  schema: {
                    properties: schema.fields
                  }
                };
              });

            this.systemCollections = schemas
              .filter((r: TSFixme) => r.name[0] === '_' && ignoreCollections.indexOf(r.name) == -1)
              .map((schema: TSFixme) => {
                return {
                  name: schema.name,
                  schema: {
                    properties: schema.fields
                  }
                };
              });

            // Get the config schema
            this.schemaModel.getConfigSchema({
              success: (configSchema) => {
                this.configSchema = configSchema;
                this._store();
                resolve();
              },
              error: (e) => {
                console.log(e);
              }
            });
          },
          error: (e: TSFixme) => {
            console.log(e);
          }
        });

        // Get Parse Server Version & Supported features (only for Parse Server, not Supabase)
        if (!isSupabaseEndpoint) {
          fetch(environment.url + '/serverInfo', {
            method: 'POST',
            body: JSON.stringify({
              _method: 'GET',
              _ApplicationId: environment.appId,
              _MasterKey: environment.masterKey
            })
          })
            .then((response) => response.json())
            .then((json) => {
              this.parseServerVersion = json.parseServerVersion;
            })
            .catch((error) => {
              console.warn('[SchemaHandler] Failed to get Parse Server version:', error);
            });
        }
      });
    });
  }

  /**
   * Fetches Supabase secrets and builds a config schema from them
   * @param environment The Supabase environment configuration
   */
  async _fetchSupabaseConfigSchema(environment: TSFixme): Promise<void> {
    try {
      // Extract project ID from URL (e.g., "https://abc123xyz.supabase.co" -> "abc123xyz")
      let projectId: string | null = null;
      if (environment.url) {
        try {
          const urlObj = new URL(environment.url);
          const hostname = urlObj.hostname;
          const match = hostname.match(/^([^.]+)\.supabase\.co$/);
          projectId = match ? match[1] : null;
        } catch (error: any) {
          console.warn('[SchemaHandler] Failed to extract project ID from URL:', error);
        }
      }

      // Get access token (PAT) from environment
      const accessToken = environment.accessToken || environment.personalAccessToken || environment.supabaseAccessToken;

      if (!projectId || !accessToken) {
        console.warn('[SchemaHandler] Missing projectId or accessToken for Supabase secrets:', {
          hasProjectId: !!projectId,
          hasAccessToken: !!accessToken,
          url: environment.url
        });
        this.configSchema = {};
        return;
      }

      const apiUrl = `https://api.supabase.com/v1/projects/${projectId}/secrets`;

      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(
          `Failed to fetch Supabase secrets: ${response.status} ${response.statusText}. Details: ${JSON.stringify(
            errorData
          )}`
        );
      }

      const secrets = await response.json();

      // Build config schema from secrets
      // Format: { SECRET_NAME: { type: 'string', masterKeyOnly: false } }
      this.configSchema = {};
      secrets.forEach((secret: { name: string; value: string }) => {
        // All Supabase secrets are treated as strings by default
        // They can be accessed via ConfigService, but for the schema we just need the name
        this.configSchema[secret.name] = {
          type: 'string',
          masterKeyOnly: false // Supabase secrets are accessible without master key
        };
      });
    } catch (error: any) {
      console.error('[SchemaHandler] Error fetching Supabase config schema:', error);
      throw error;
    }
  }

  _store() {
    if (ProjectModel.instance) {
      if (this.haveCloudServices) {
        ProjectModel.instance.setMetaData('dbCollections', this.dbCollections);
        ProjectModel.instance.setMetaData('systemCollections', this.systemCollections);
        ProjectModel.instance.setMetaData('dbConfigSchema', this.configSchema);

        const versionNumbers = this.parseServerVersion?.split('.');
        if (versionNumbers && versionNumbers.length > 0) {
          // Let's only save the major version number,
          // since this will be used to determine which verison of the API to use.
          ProjectModel.instance.setMetaData('dbVersionMajor', versionNumbers[0]);
        } else {
          ProjectModel.instance.setMetaData('dbVersionMajor', undefined);
        }
      } else {
        ProjectModel.instance.setMetaData('dbCollections', undefined);
        ProjectModel.instance.setMetaData('systemCollections', undefined);
        ProjectModel.instance.setMetaData('dbConfigSchema', undefined);
        ProjectModel.instance.setMetaData('dbVersionMajor', undefined);
      }
    }
  }
}
