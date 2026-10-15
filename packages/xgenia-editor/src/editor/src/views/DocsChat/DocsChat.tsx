import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { SidebarModel, SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';
import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { Portal } from '@xgenia-core-ui/components/layout/Portal';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { NodeGraphContextTmp } from '../../contexts/NodeGraphContext/NodeGraphContext';
import css from './DocsChat.module.scss';

/**
 * "Ask the docs": the docs site's AI chat (docsapp.xgenia.com/embed/chat/) in a
 * floating window over the node graph, opened from a button next to the "?"
 * help button, the "?" menu, or Help > Ask the Docs (AI).
 *
 * It is reference documentation, so it floats instead of taking a side panel,
 * and it is deliberately separate from the builder AI: a <webview> in its own
 * session (partition), with no preload and no access to the editor bridge. The
 * main process enforces that (installDocsChatWebviewGuards in main.js). The
 * only thing the editor tells it is which docs page belongs to the selected
 * node, so "what does this node do?" works.
 */

/** Emit this on EventDispatcher to open the chat from elsewhere in the editor. */
export const OPEN_DOCS_CHAT_EVENT = 'openDocsChat';

const PARTITION = 'persist:xgenia-docs-chat';
const CONTEXT_EVENT = 'xgenia:docs-context';
const SELECTION_POLL_MS = 1000;
const GAP = 12;

interface DocsContext {
  path: string;
  title: string;
}

const NO_CONTEXT: DocsContext = { path: '/', title: '' };

/** For local testing, e.g. XGENIA_DOCS_CHAT_URL=http://localhost:3000/embed/chat/ (with `npm run dev:chat` in the docs repo). */
function chatUrl(context: DocsContext) {
  const base =
    (process && process.env && process.env.XGENIA_DOCS_CHAT_URL) || `${getDocsEndpoint()}/embed/chat/`;
  const url = new URL(base);
  if (context.path !== '/') {
    url.searchParams.set('path', context.path);
    url.searchParams.set('title', context.title);
  }
  return url.href;
}

/** The docs page of the selected node, if it has one. */
function readSelectedNodeDocs(): DocsContext {
  try {
    const node = NodeGraphContextTmp.nodeGraph?.getSelectedNodes?.()[0]?.model;
    const type = node?.type as { docs?: string; displayName?: string; name?: string } | undefined;
    if (!type?.docs) return NO_CONTEXT;
    return { path: new URL(type.docs).pathname, title: type.displayName || type.name || '' };
  } catch {
    return NO_CONTEXT;
  }
}

const sameContext = (a: DocsContext, b: DocsContext) => a.path === b.path && a.title === b.title;

/** Follows the node selection while `active`, using the same signals as the Hierarchy panel. */
function useSelectedNodeDocs(active: boolean): DocsContext {
  const [context, setContext] = useState<DocsContext>(NO_CONTEXT);

  useEffect(() => {
    if (!active) return;
    const read = () => {
      const next = readSelectedNodeDocs();
      setContext((prev) => (sameContext(prev, next) ? prev : next));
    };
    read();

    // Selection reaches the sidebar a tick after the click; read once it settles.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(read, 15);
    };
    const group = {};
    const graph = NodeGraphContextTmp.nodeGraph;
    graph?.on?.('deselect', soon, group);
    graph?.on?.('activeComponentChanged', soon, group);
    SidebarModel.instance.on(SidebarModelEvent.nodeSelected, soon, group);
    EventDispatcher.instance.on(['inspectNodes', 'viewportSelectNodes'], soon, group);
    const poll = setInterval(read, SELECTION_POLL_MS);

    return () => {
      graph?.off?.(group);
      SidebarModel.instance.off(group);
      EventDispatcher.instance.off(group);
      clearInterval(poll);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [active]);

  return context;
}

/** Electron's <webview> element, as far as this component uses it. */
type WebviewElement = HTMLElement & { executeJavaScript(code: string): Promise<unknown> };

export function DocsChat() {
  const [open, setOpen] = useState(false);
  // The webview is created on first open and kept afterwards, so the conversation survives closing.
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [src, setSrc] = useState('');
  const [position, setPosition] = useState<{ right: number; bottom: number; maxHeight: number } | null>(null);

  const launcherRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewElement | null>(null);
  const readyRef = useRef(false);

  const context = useSelectedNodeDocs(open);
  const portalRoot = document.querySelector('.help-center-layer');

  const openChat = useCallback(() => {
    if (!loaded) {
      setSrc(chatUrl(readSelectedNodeDocs()));
      setLoaded(true);
    }
    setOpen(true);
  }, [loaded]);

  // Open from the "?" menu (EventDispatcher) and from Help > Ask the Docs (AI) (main-process menu).
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on(OPEN_DOCS_CHAT_EVENT, openChat, group);
    let ipc: { on: Function; removeListener: Function } | undefined;
    const onMenu = (_event: unknown, args: { command?: string }) => {
      if (args && args.command === 'openDocsChat') openChat();
    };
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ipc = require('electron').ipcRenderer;
      ipc.on('editor-menu-command', onMenu);
    } catch {
      // not in Electron
    }
    return () => {
      EventDispatcher.instance.off(group);
      ipc?.removeListener('editor-menu-command', onMenu);
    };
  }, [openChat]);

  // Esc closes it (when focus is in the editor; inside the chat, Esc belongs to the chat).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Anchor the window just above the launcher, following it when panels resize the canvas.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = launcherRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        right: Math.max(GAP, window.innerWidth - rect.right),
        bottom: window.innerHeight - rect.top + GAP,
        maxHeight: Math.max(240, rect.top - GAP * 2)
      });
    };
    place();
    const observer = new ResizeObserver(place);
    const host = launcherRef.current?.closest('.help-center-layer')?.parentElement;
    if (host) observer.observe(host);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [open]);

  // Tell the chat which node is selected. One-way: plain data, no channel back into the editor.
  const pushContext = useCallback((value: DocsContext) => {
    const webview = webviewRef.current;
    if (!webview || !readyRef.current) return;
    const json = JSON.stringify(value);
    webview
      .executeJavaScript(
        `window.__xgeniaDocsContext=${json};` +
          `window.dispatchEvent(new CustomEvent(${JSON.stringify(CONTEXT_EVENT)},{detail:window.__xgeniaDocsContext}));`
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    pushContext(context);
  }, [context, pushContext]);

  const attachWebview = useCallback(
    (element: WebviewElement | null) => {
      if (webviewRef.current === element) return;
      webviewRef.current = element;
      readyRef.current = false;
      if (!element) return;
      element.addEventListener('dom-ready', () => {
        readyRef.current = true;
        pushContext(readSelectedNodeDocs());
      });
    },
    [pushContext]
  );

  if (!portalRoot) return null;

  return (
    <>
      <Portal portalRoot={portalRoot}>
        <div
          ref={launcherRef}
          className={`${css['Launcher']} ${open ? css['is-open'] : ''}`}
          title="Ask the docs (AI)"
          onClick={() => (open ? setOpen(false) : openChat())}
        >
          <IconButton icon={IconName.Chat} variant={IconButtonVariant.OpaqueOnHover} size={IconSize.Large} />
        </div>
      </Portal>

      {loaded && (
        <Portal portalRoot={document.body}>
          <div
            className={`${css['Window']} ${open ? css['is-open'] : ''} ${expanded ? css['is-expanded'] : ''}`}
            style={position ? { right: position.right, bottom: position.bottom, maxHeight: position.maxHeight } : undefined}
            role="dialog"
            aria-label="Ask the docs"
            aria-hidden={!open}
          >
            <div className={css['TitleBar']}>
              <span className={css['Title']}>Ask the docs</span>
              <span className={css['Badge']}>AI</span>
              <div className={css['Actions']}>
                <button
                  type="button"
                  className={css['TitleButton']}
                  title={expanded ? 'Shrink' : 'Enlarge'}
                  aria-label={expanded ? 'Shrink chat window' : 'Enlarge chat window'}
                  onClick={() => setExpanded((e) => !e)}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path
                      d={expanded ? 'M10 4v6H4M14 20v-6h6M10 10L4 4M14 14l6 6' : 'M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7'}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  className={css['TitleButton']}
                  title="Close"
                  aria-label="Close docs chat"
                  onClick={() => setOpen(false)}
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
            {React.createElement('webview', {
              ref: attachWebview,
              src,
              partition: PARTITION,
              // main.js forces these anyway (will-attach-webview); stated here so the intent is visible.
              webpreferences: 'contextIsolation=yes, sandbox=yes, nodeIntegration=no',
              // Lets target=_blank links reach main's window-open handler, which opens them in the browser.
              allowpopups: 'true',
              className: css['Webview']
            })}
          </div>
        </Portal>
      )}
    </>
  );
}
