// Stub: @xgenia-ai/ChatPanel/services/AIMcpService (private module not available)
export interface AIMcpServerInfo {
  name: string;
  status: string;
}
export interface AIMcpTool {
  name: string;
}
export interface AIMcpConfig {
  mcpServers: Record<string, any>;
}
export class AIMcpService {
  private static _instance: AIMcpService = new AIMcpService();
  static getInstance(): AIMcpService {
    return AIMcpService._instance;
  }
  getServers(): AIMcpServerInfo[] { return []; }
  getTools(): AIMcpTool[] { return []; }
  async connect() {}
  async disconnect() {}
  on() {}
  off() {}
  async initialize() {}
  getRawConfig(): AIMcpConfig | null { return null; }
  async setRawConfig(_config: AIMcpConfig) {}
  async addServer(_name: string, _config: any) {}
  async removeServer(_name: string) {}
  async reconnectServer(_name: string) {}
  onServersChanged(_callback: () => void): () => void { return () => {}; }
  dispose() {}
  getConfigPath(): string { return ''; }
}
