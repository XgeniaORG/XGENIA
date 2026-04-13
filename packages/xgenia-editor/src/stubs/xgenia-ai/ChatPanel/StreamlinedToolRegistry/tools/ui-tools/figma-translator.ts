// Stub: @xgenia-ai/ChatPanel/StreamlinedToolRegistry/tools/ui-tools/figma-translator (private module not available)
const warn = () => console.warn('[Figma Translator] Not available in open-source build');

export const parseFigmaUrl = (_url: string) => {
  warn();
  return null;
};
export const fetchFigmaFile = async (_fileKey: string, _token: string, _nodeId?: string) => {
  warn();
  return null;
};
export const listFrames = (_file: any) => {
  warn();
  return [];
};
export const translateFigmaToXgeniaXml = (_node: any, _depth?: number, _imageMap?: Map<string, string>): string => {
  warn();
  return '';
};
export const extractDesignTokens = (_file: any): any => {
  warn();
  return null;
};
export const findFrameByName = (_file: any, _frameName: string) => {
  warn();
  return null;
};
export const collectImageRefs = (_node: any): { imageRefs: Map<string, string>; vectorNodeIds: string[] } => {
  warn();
  return { imageRefs: new Map(), vectorNodeIds: [] };
};
export const downloadAndSaveImages = async (
  _fileKey: string,
  _token: string,
  _nodeIds: string[],
  _projectRoot: string
): Promise<Map<string, string>> => {
  warn();
  return new Map();
};
