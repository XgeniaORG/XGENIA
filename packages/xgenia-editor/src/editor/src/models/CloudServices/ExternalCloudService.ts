import { JSONStorage } from '@xgenia/platform';

import {
  CreateEnvironment,
  CreateEnvironmentRequest,
  UpdateEnvironmentRequest,
  CloudServiceType,
  isSupabaseCreateRequest,
  isSupabaseUpdateRequest
} from '@xgenia-models/CloudServices';

// Base environment interface
export interface BaseEnvironmentData {
  enabled: boolean;
  id: string;
  name: string;
  description: string;
  type: CloudServiceType;
}

// Parse Server specific environment
export interface ParseServerEnvironmentData extends BaseEnvironmentData {
  type: CloudServiceType.PARSE_SERVER;
  masterKey: string;
  appId: string;
  endpoint: string;
}

// Supabase specific environment
export interface SupabaseEnvironmentData extends BaseEnvironmentData {
  type: CloudServiceType.SUPABASE;
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  accessToken?: string;
  enableRealtime?: boolean;
}

/** The data format is separated from our internal model. */
export type EnvironmentDataFormat =
  | ParseServerEnvironmentData
  | SupabaseEnvironmentData
  | {
      // Legacy format for backward compatibility
      enabled: boolean;
      id: string;
      name: string;
      description: string;
      masterKey: string;
      appId: string;
      endpoint: string;
      type?: never; // This distinguishes legacy from new format
    };

// Type guards to help with discriminating between different environment types
export function isParseServerEnvironment(env: EnvironmentDataFormat): env is ParseServerEnvironmentData {
  return env.type === CloudServiceType.PARSE_SERVER || (!env.type && 'masterKey' in env && 'appId' in env);
}

export function isSupabaseEnvironment(env: EnvironmentDataFormat): env is SupabaseEnvironmentData {
  return env.type === CloudServiceType.SUPABASE;
}

export function isLegacyEnvironment(env: EnvironmentDataFormat): env is EnvironmentDataFormat & { type?: never } {
  return !env.type && 'masterKey' in env && 'appId' in env && 'endpoint' in env;
}

export class ExternalCloudService {
  async list(): Promise<EnvironmentDataFormat[]> {
    const local = await JSONStorage.get('externalBrokers');
    const brokers = local.brokers || [];

    // Convert legacy format to new format for consistency
    return brokers.map((broker: any) => {
      if (!broker.type && broker.masterKey && broker.appId && broker.endpoint) {
        // Legacy Parse Server format - add type
        return {
          ...broker,
          type: CloudServiceType.PARSE_SERVER
        } as ParseServerEnvironmentData;
      }
      return broker as EnvironmentDataFormat;
    });
  }

  async create(options: CreateEnvironmentRequest): Promise<CreateEnvironment> {
    // Handle different service types in CreateEnvironmentRequest
    let newBroker: EnvironmentDataFormat;
    let id: string;

    if (isSupabaseCreateRequest(options)) {
      // Supabase environment
      const cleanUrl =
        typeof options.supabaseUrl === 'string'
          ? options.supabaseUrl.replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-')
          : 'unknown-supabase';
      id = `supabase-${cleanUrl}`;
      newBroker = {
        enabled: true,
        id,
        name: options.name,
        description: options.description,
        type: CloudServiceType.SUPABASE,
        url: options.supabaseUrl,
        anonKey: options.supabaseAnonKey || '',
        serviceRoleKey: options.supabaseServiceRoleKey,
        accessToken: options.supabaseAccessToken,
        enableRealtime: options.supabaseEnableRealtime !== false
      } as SupabaseEnvironmentData;
    } else {
      // Parse Server environment (legacy or explicit)
      const parseOptions = options as any; // Type assertion for legacy compatibility
      id = `${parseOptions.url}-${parseOptions.appId}`;
      newBroker = {
        enabled: true,
        id,
        name: parseOptions.name,
        description: parseOptions.description,
        type: CloudServiceType.PARSE_SERVER,
        masterKey: parseOptions.masterKey,
        appId: parseOptions.appId,
        endpoint: parseOptions.url
      } as ParseServerEnvironmentData;
    }

    const local = await JSONStorage.get('externalBrokers');
    const brokers: EnvironmentDataFormat[] = local.brokers || [];
    await JSONStorage.set('externalBrokers', { brokers: [...brokers, newBroker] });

    // Return response based on service type
    if (isSupabaseEnvironment(newBroker)) {
      return {
        id: newBroker.id,
        type: CloudServiceType.SUPABASE,
        url: newBroker.url,
        anonKey: newBroker.anonKey,
        serviceRoleKey: newBroker.serviceRoleKey,
        accessToken: newBroker.accessToken
      } as any; // Type assertion needed due to union type complexity
    } else {
      return {
        id: newBroker.id,
        appId: (newBroker as ParseServerEnvironmentData).appId,
        url: (newBroker as ParseServerEnvironmentData).endpoint,
        masterKey: (newBroker as ParseServerEnvironmentData).masterKey
      };
    }
  }

  async update(options: UpdateEnvironmentRequest): Promise<boolean> {
    const local = await JSONStorage.get('externalBrokers');
    const brokers: EnvironmentDataFormat[] = local.brokers || [];

    // Find and update
    const broker = brokers.find((x) => x.id === options.id);
    if (!broker) return false;

    // Update common fields
    if (typeof options.name !== 'undefined') broker.name = options.name;
    if (typeof options.description !== 'undefined') broker.description = options.description;

    // Update type-specific fields
    if (isSupabaseUpdateRequest(options) && isSupabaseEnvironment(broker)) {
      const supabaseOptions = options as any; // Type assertion for Supabase update
      if (typeof supabaseOptions.supabaseUrl !== 'undefined') broker.url = supabaseOptions.supabaseUrl;
      if (typeof supabaseOptions.supabaseAnonKey !== 'undefined') broker.anonKey = supabaseOptions.supabaseAnonKey;
      if (typeof supabaseOptions.supabaseServiceRoleKey !== 'undefined')
        broker.serviceRoleKey = supabaseOptions.supabaseServiceRoleKey;
      if (typeof supabaseOptions.supabaseAccessToken !== 'undefined')
        broker.accessToken = supabaseOptions.supabaseAccessToken;
      if (typeof supabaseOptions.supabaseEnableRealtime !== 'undefined')
        broker.enableRealtime = supabaseOptions.supabaseEnableRealtime;
    } else if (isParseServerEnvironment(broker)) {
      const parseOptions = options as any; // Type assertion for Parse Server update
      if (typeof parseOptions.appId !== 'undefined') broker.appId = parseOptions.appId;
      if (typeof parseOptions.masterKey !== 'undefined') broker.masterKey = parseOptions.masterKey;
      if (typeof parseOptions.url !== 'undefined') broker.endpoint = parseOptions.url;
    }

    await JSONStorage.set('externalBrokers', { brokers });
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const local = await JSONStorage.get('externalBrokers');
    const brokers: EnvironmentDataFormat[] = local.brokers || [];

    // Find the environment
    const found = brokers.find((b) => b.id === id);
    if (found) {
      // Delete the environment
      brokers.splice(brokers.indexOf(found), 1);
    }

    // Save the list
    await JSONStorage.set('externalBrokers', { brokers });
    return true;
  }
}

export class Environment {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  masterKeyUpdatedAt: string;
  type: CloudServiceType;

  // Parse Server fields
  masterKey?: string;
  appId?: string;
  url?: string;

  // Supabase fields
  supabaseUrl?: string;
  anonKey?: string;
  accessToken?: string;
  serviceRoleKey?: string;
  enableRealtime?: boolean;

  constructor(item: EnvironmentDataFormat) {
    this.id = item.id;
    this.name = item.name;
    this.description = item.description;
    this.createdAt = '';
    this.masterKeyUpdatedAt = '';

    // Determine type and set appropriate fields
    if (isSupabaseEnvironment(item)) {
      this.type = CloudServiceType.SUPABASE;
      this.supabaseUrl = item.url;
      this.url = item.url; // For compatibility
      this.anonKey = item.anonKey;
      this.serviceRoleKey = item.serviceRoleKey;
      this.accessToken = item.accessToken;
      this.enableRealtime = item.enableRealtime;
    } else if (isParseServerEnvironment(item)) {
      this.type = CloudServiceType.PARSE_SERVER;
      this.masterKey = item.masterKey;
      this.appId = item.appId;
      this.url = item.endpoint;
    } else {
      // Legacy format - assume Parse Server
      this.type = CloudServiceType.PARSE_SERVER;
      this.masterKey = (item as any).masterKey;
      this.appId = (item as any).appId;
      this.url = (item as any).endpoint;
    }
  }

  // Helper methods
  isParseServer(): boolean {
    return this.type === CloudServiceType.PARSE_SERVER;
  }

  isSupabase(): boolean {
    return this.type === CloudServiceType.SUPABASE;
  }

  getDisplayName(): string {
    if (this.isSupabase()) {
      return `${this.name} (Supabase)`;
    } else {
      return `${this.name} (Parse Server)`;
    }
  }
}
