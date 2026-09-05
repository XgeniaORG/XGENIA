/**
 * Every DOM selector the harness depends on, in one place.
 *
 * These are contracts with code the harness does not own. The Chat panel in
 * particular deploys from Vercel independently of XGENIA releases, so these can
 * break without any version number changing. selectors.test.ts asserts them
 * against captured fixtures; xgenia_probe asserts them at runtime.
 */
export const SELECTORS = Object.freeze({
  /** The editor page, distinguished from the viewer and cloud-runtime targets. */
  editorPageUrlSuffix: '/src/editor/index.html',
  /** The AI Chat panel iframe. Cross-origin; addressed as a Playwright frame. */
  chatIframe: 'iframe[src*="xgenia-ai-app"]',
  /** Contenteditable div, not a textarea. Carries data-empty. */
  chatInput: '.rich-chat-input',
  /** Present only while the panel is generating. */
  chatStop: '[aria-label="Stop generating"]',
  /** Present only while the panel is idle. */
  chatSend: '[aria-label="Send message"]',
  /** A project tile on the projects screen. */
  projectItem: '.projects-item',
  /** The visible label inside a project tile. */
  projectItemLabel: '.projects-item-label span'
});

export type SelectorKey = keyof typeof SELECTORS;
