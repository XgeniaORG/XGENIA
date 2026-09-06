import { nextTick } from 'process';
import React, { ReactNode, useEffect, useState } from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary';

import { PanelActiveContext } from '../panels/useIsActivePanel';
import css from './LeftPanelCard.module.scss';

interface Props {
  /** The panel to show. Others stay mounted and hidden when `keepMounted` is true. */
  visibleId: string | null;
  keepMounted: boolean;
}

/**
 * Every panel opened in this host stays mounted and is hidden with `display: none`, so
 * switching back is instant and keeps its state — and, for remote iframes, avoids
 * re-booting a whole application on every switch. `PanelActiveContext` tells a hidden
 * panel it is off screen so the expensive ones can idle. `unmountWhenHidden` on the item
 * is the stronger opt-out. This is the same policy the old SidePanel had.
 */
export function PanelHost({ visibleId, keepMounted }: Props) {
  const [panels, setPanels] = useState<Record<string, ReactNode>>({});

  useEffect(() => {
    if (!visibleId) return;
    setPanels((prev) => {
      const item = SidebarModel.instance.getPanel(visibleId);
      const component = SidebarModel.instance.getPanelComponent(visibleId);
      if (!component) return prev;
      if (prev[visibleId] && !item?.transient) return prev;
      return { ...prev, [visibleId]: React.createElement(component) };
    });
  }, [visibleId]);

  useEffect(() => {
    const group = {};
    SidebarModel.instance.on(
      SidebarModelEvent.HotReload,
      () => nextTick(() => setPanels({})),
      group
    );
    return () => SidebarModel.instance.off(group);
  }, []);

  return (
    <div className={css.Host}>
      {Object.entries(panels).map(([id, panel]) => {
        const isActive = id === visibleId;
        const item = SidebarModel.instance.getPanel(id);
        if (!isActive && (!keepMounted || item?.unmountWhenHidden)) return null;
        return (
          <div key={id} data-panel-id={id} className={css.PanelItem} style={{ display: isActive ? 'block' : 'none' }}>
            <ErrorBoundary
              showTryAgain
              onTryAgain={() =>
                setPanels((prev) => {
                  const component = SidebarModel.instance.getPanelComponent(id);
                  return component ? { ...prev, [id]: React.createElement(component) } : prev;
                })
              }
            >
              <PanelActiveContext.Provider value={isActive}>{panel}</PanelActiveContext.Provider>
            </ErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
