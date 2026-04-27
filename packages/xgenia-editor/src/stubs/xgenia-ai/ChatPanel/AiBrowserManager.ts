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
  close: noop,
};
