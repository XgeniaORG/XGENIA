// Stub: @xgenia-ai/ChatPanel/types/ai-types (private module not available)
export interface NodeCreationContext {
  nodeGraph: any;
  nodeLibrary: any;
  projectModel: any;
  undoQueue: any;
}
export interface NodeCreationRequest {
  type: string;
  [key: string]: any;
}
export interface NodeCreationResult {
  success: boolean;
  createdNodes: any[];
  error?: string;
}
