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
const instance = {
  getServers: (): AIMcpServerInfo[] => [],
  getTools: (): AIMcpTool[] => [],
  connect: async () => {},
  disconnect: async () => {},
  on: () => {},
  off: () => {},
  initialize: async () => {},
  getRawConfig: (): AIMcpConfig | null => null,
  setRawConfig: (_config: AIMcpConfig) => {},
  addServer: (_name: string, _config: any) => {},
  removeServer: (_name: string) => {},
  reconnectServer: (_name: string) => {},
  onServersChanged: (_callback: () => void) => () => {},
  dispose: () => {},
  getConfigPath: () => '',
};
export class AIMcpService {
  static getInstance() {
    return instance;
  }
}
