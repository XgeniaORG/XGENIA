// Stub: @xgenia-ai/ChatPanel/AiBrowserManager (private module not available)
export interface AiBrowserState {
  tabs: any[];
  activeTabId: string | null;
  active: boolean;
  url: string;
  title: string;
  ready: boolean;
}
const noop = () => {};
const noopUnsubscribe = () => {};
export const AiBrowserManager: any = {
  getState: (): AiBrowserState => ({ tabs: [], activeTabId: null, active: false, url: '', title: '', ready: false }),
  onStateChange: () => noopUnsubscribe,
  getWebviewElement: () => null,
  returnWebviewToHiddenContainer: noop,
  close: () => ({ success: true }),
  getConsoleLogs: () => [],
  // The AI browser ships with the private AI module; say so instead of failing obscurely.
  open: async () => unavailable(),
  screenshot: async () => unavailable(),
  nativeClick: async () => unavailable(),
  click: async () => unavailable(),
  type: async () => unavailable(),
  evaluate: async () => unavailable(),
  getPageInfo: async () => ({ title: '', url: '', active: false }),
};
function unavailable() {
  return { success: false, error: 'The AI browser is not available in this build of XGENIA.' };
}
