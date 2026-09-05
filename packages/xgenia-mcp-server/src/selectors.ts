/**
 * Every DOM selector the harness depends on, in one place.
 *
 * These are contracts with code the harness does not own. The Chat panel in
 * particular deploys from Vercel independently of XGENIA releases, so these can
 * break without any version number changing. selectors.test.ts asserts them
 * against captured fixtures; xgenia_probe asserts them at runtime.
 */
const CHAT_APP_URL_SUBSTRING = 'xgenia-ai-app';

export const SELECTORS = Object.freeze({
  /** The editor page, distinguished from the viewer and cloud-runtime targets. */
  editorPageUrlSuffix: '/src/editor/index.html',
  /** URL substring identifying the AI Chat panel iframe. */
  chatFrameUrlSubstring: CHAT_APP_URL_SUBSTRING,
  /** The AI Chat panel iframe. Cross-origin; addressed as a Playwright frame. */
  chatIframe: `iframe[src*="${CHAT_APP_URL_SUBSTRING}"]`,
  /** Contenteditable div, not a textarea. Carries data-empty. */
  chatInput: '.rich-chat-input',
  /** Present only while the panel is generating. */
  chatStop: '[aria-label="Stop generating"]',
  /** Present only while the panel is idle. */
  chatSend: '[aria-label="Send message"]',
  /** A project tile on the projects screen. */
  projectItem: '.projects-item',
  /** The visible label inside a project tile. */
  projectItemLabel: '.projects-item-label span',
  /** The node graph canvas element. */
  canvas: 'canvas',
  /**
   * An icon button in the left sidebar rail (Add node, Chat, Assets,
   * Settings, Exit project, ...).
   *
   * CSS Modules append a build-specific hash to the class name at bundle
   * time (e.g. `IconButton-module__Root___a1b2c`), so matching the literal
   * string would break on the very next rebuild. `[class*=...]` instead
   * matches the stable, source-file-derived prefix — it only changes if the
   * component itself is renamed or moved, exactly like the rest of this
   * file's other `[class*=...]` selectors.
   *
   * None of these buttons carry an id, an aria-label or a data-testid, so
   * there is no way to identify a specific one (e.g. "Chat") except by
   * hovering it and reading its `tooltip` (below). This selector alone also
   * matches icon buttons elsewhere in the app that happen to reuse the same
   * component — verified live, the sidebar rail's own buttons all sit at
   * `x < 58` CSS pixels, which is what actually narrows a match down to the
   * rail.
   */
  sidebarIconButton: 'button[class*=IconButton-module__Root]',
  /**
   * A tooltip bubble revealed on hover. Matched three ways because which
   * one actually renders was determined empirically (hover a button, wait
   * ~450ms, read whichever of these has non-empty text), not read off the
   * tooltip library's source — and, like sidebarIconButton, by substring so
   * a CSS-module hash suffix can't break it.
   */
  tooltip: '[class*=Tooltip], [class*=tooltip], [role=tooltip]',
  /**
   * Login form's email input. The login screen carries no class names or
   * ids at all -- it's inline-styled React -- so the detector matches on
   * the presence of BOTH this and loginPasswordInput (see isLoginScreen in
   * editor-state.ts) rather than one exact selector or sentence. Copy like
   * "Login with XGENIA" changes far more easily than a form needing an
   * email + password field to actually authenticate, which is why the
   * detector keys on structure, not text.
   */
  loginEmailInput: 'input[type="email"]',
  /** Login form's password input. See loginEmailInput. */
  loginPasswordInput: 'input[type="password"]'
});

export type SelectorKey = keyof typeof SELECTORS;
