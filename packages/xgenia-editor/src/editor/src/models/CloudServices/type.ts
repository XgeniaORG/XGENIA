import { Environment } from '@xgenia-models/CloudServices';
import { ProjectModel } from '@xgenia-models/projectmodel';
import { IModel } from '@xgenia-utils/model';

// Import CloudServiceType enum
export enum CloudServiceType {
  PARSE_SERVER = 'parse_server',
  SUPABASE = 'supabase'
}

// Base request interface
export interface BaseCreateEnvironmentRequest {
  name: string | undefined;
  description?: string | undefined;
  type?: CloudServiceType;
}

// Parse Server create request
export interface ParseServerCreateRequest extends BaseCreateEnvironmentRequest {
  type?: CloudServiceType.PARSE_SERVER;
  appId: string;
  url: string;
  masterKey: string;
}

// Supabase create request
export interface SupabaseCreateRequest extends BaseCreateEnvironmentRequest {
  type: CloudServiceType.SUPABASE;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey?: string;
  supabaseAccessToken?: string; // For Edge Functions management
  supabaseEnableRealtime?: boolean;
}

// Legacy create request (for backward compatibility)
export interface LegacyCreateRequest {
  name: string | undefined;
  description?: string | undefined;
  appId: string;
  url: string;
  masterKey: string;
}

export type CreateEnvironmentRequest = ParseServerCreateRequest | SupabaseCreateRequest | LegacyCreateRequest;

// Update request types
export interface BaseUpdateEnvironmentRequest {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
}

export interface ParseServerUpdateRequest extends BaseUpdateEnvironmentRequest {
  appId?: string | undefined;
  masterKey?: string | undefined;
  url?: string | undefined;
}

export interface SupabaseUpdateRequest extends BaseUpdateEnvironmentRequest {
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
  supabaseServiceRoleKey?: string | undefined;
  supabaseAccessToken?: string | undefined; // For Edge Functions management
  supabaseEnableRealtime?: boolean | undefined;
}

export type UpdateEnvironmentRequest = ParseServerUpdateRequest | SupabaseUpdateRequest;

// Base response interface
export interface BaseCreateEnvironment {
  id: string;
  type?: CloudServiceType;
}

// Parse Server create response
export interface ParseServerCreateResponse extends BaseCreateEnvironment {
  type?: CloudServiceType.PARSE_SERVER;
  masterKey: string;
  appId: string;
  url: string;
}

// Supabase create response
export interface SupabaseCreateResponse extends BaseCreateEnvironment {
  type: CloudServiceType.SUPABASE;
  url: string;
  anonKey: string;
  serviceRoleKey?: string;
  accessToken?: string; // For Edge Functions management
}

// Legacy response (for backward compatibility)
export interface LegacyCreateResponse {
  id: string;
  masterKey: string;
  appId: string;
  url: string;
}

export type CreateEnvironment = ParseServerCreateResponse | SupabaseCreateResponse | LegacyCreateResponse;

// Type guards for request types
export function isSupabaseCreateRequest(req: CreateEnvironmentRequest): req is SupabaseCreateRequest {
  return 'type' in req && req.type === CloudServiceType.SUPABASE;
}

export function isParseServerCreateRequest(req: CreateEnvironmentRequest): req is ParseServerCreateRequest {
  return 'type' in req && req.type === CloudServiceType.PARSE_SERVER;
}

export function isLegacyCreateRequest(req: CreateEnvironmentRequest): req is LegacyCreateRequest {
  return !('type' in req) && 'appId' in req && 'masterKey' in req;
}

export function isSupabaseUpdateRequest(req: UpdateEnvironmentRequest): req is SupabaseUpdateRequest {
  return (
    'supabaseUrl' in req ||
    'supabaseAnonKey' in req ||
    'supabaseServiceRoleKey' in req ||
    'supabaseAccessToken' in req ||
    'supabaseEnableRealtime' in req
  );
}

export interface ICloudBackendService {
  get isLoading(): boolean;
  get items(): Environment[];

  fetch(): Promise<Environment[]>;
  fromProject(project: ProjectModel): Promise<Environment> | undefined;
  create(options: CreateEnvironmentRequest): Promise<CreateEnvironment>;
  update(options: UpdateEnvironmentRequest): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export enum CloudServiceEvent {
  ConfigUpdated,
  BackendUpdated
}

export type CloudServiceEvents = {
  [CloudServiceEvent.ConfigUpdated]: () => void;
  [CloudServiceEvent.BackendUpdated]: () => void;
};

export interface ICloudService extends IModel<CloudServiceEvent, CloudServiceEvents> {
  /** Reset the current session token. */
  reset(): void;

  getActiveEnvironment(project: ProjectModel): Promise<Environment>;

  get backend(): ICloudBackendService;
}
