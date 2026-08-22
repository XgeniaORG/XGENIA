import { createContext, useContext, useEffect, useState } from 'react';

import { SidebarModel, SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

export function useIsActivePanel(panelId: string) {
  const [isActivePanel, setActivePanel] = useState(SidebarModel.instance.getCurrent().id === panelId);

  useEffect(() => {
    const eventRef = {};
    SidebarModel.instance.on(
      SidebarModelEvent.activeChanged,
      () => {
        setActivePanel(SidebarModel.instance.getCurrent().id === panelId);
      },
      eventRef
    );

    return () => {
      SidebarModel.instance.off(eventRef);
    };
  }, []);

  return isActivePanel;
}

/**
 * Whether the panel rendering this subtree is the one on screen.
 *
 * SidePanel keeps every panel the user has opened MOUNTED, hidden with
 * `display: none`, so it can be switched back to instantly and with its state
 * intact. React knows nothing about that: a hidden panel still runs its timers,
 * still receives its model events, and still reconciles on every one of them.
 * That cost accumulates for the whole session as more panels are opened.
 *
 * Supplied by the panel host, so a panel does not have to know its own id — which
 * is what `useIsActivePanel` above requires, and why in practice only one panel
 * ever adopted it.
 *
 * Defaults to `true` for anything rendered outside a panel host, so a component
 * used in both places behaves normally.
 */
export const PanelActiveContext = createContext(true);

export function usePanelActive(): boolean {
  return useContext(PanelActiveContext);
}
