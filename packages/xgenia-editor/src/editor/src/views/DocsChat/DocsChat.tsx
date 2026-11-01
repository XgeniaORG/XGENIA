import { useCallback, useEffect, useState } from 'react';

import { SidebarModel, SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { NodeGraphContextTmp } from '../../contexts/NodeGraphContext/NodeGraphContext';

/**
 * "Ask the docs": the docs site's AI chat (docsapp.xgenia.com/embed/chat/), opened from the "?" menu
 * or Help > Ask the Docs (AI).
 *
 * It runs in a window of its own, opened by the main process (openDocsChatWindow in main.js): always
 * above the editor, movable and resizable, in its own session with no preload and no access to the
 * editor bridge. It used to be a <webview> floating over the node graph, which under the editor's UI
 * zoom stopped repainting: a stale, cut-off frame where nothing typed appeared (2026-11-01).
 *
 * The only thing the editor tells it is which docs page belongs to the selected node, so "what does
 * this node do?" works.
 */

/** Emit this on EventDispatcher to open the chat from elsewhere in the editor. */
export const OPEN_DOCS_CHAT_EVENT = 'openDocsChat';

const SELECTION_POLL_MS = 1000;

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

function ipc(): { invoke(channel: string, ...args: unknown[]): Promise<unknown>; on: Function; removeListener: Function } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('electron').ipcRenderer;
  } catch {
    return null; // not in Electron
  }
}

/** Renders nothing: it opens the docs chat window and keeps it told which node is selected. */
export function DocsChat() {
  // Set once the window has been opened; from then on the selection is followed.
  const [opened, setOpened] = useState(false);
  const context = useSelectedNodeDocs(opened);

  const openChat = useCallback(() => {
    const renderer = ipc();
    if (!renderer) return;
    void renderer.invoke('docs-chat:open', chatUrl(readSelectedNodeDocs())).then(
      (ok) => {
        if (ok) setOpened(true);
      },
      () => undefined
    );
  }, []);

  // Open from the "?" menu (EventDispatcher) and from Help > Ask the Docs (AI) (main-process menu).
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on(OPEN_DOCS_CHAT_EVENT, openChat, group);
    const renderer = ipc();
    const onMenu = (_event: unknown, args: { command?: string }) => {
      if (args && args.command === 'openDocsChat') openChat();
    };
    renderer?.on('editor-menu-command', onMenu);
    return () => {
      EventDispatcher.instance.off(group);
      renderer?.removeListener('editor-menu-command', onMenu);
    };
  }, [openChat]);

  // Tell the chat which node is selected. One-way: plain data, no channel back into the editor.
  useEffect(() => {
    if (!opened) return;
    void ipc()?.invoke('docs-chat:context', context).catch(() => undefined);
  }, [opened, context]);

  return null;
}
