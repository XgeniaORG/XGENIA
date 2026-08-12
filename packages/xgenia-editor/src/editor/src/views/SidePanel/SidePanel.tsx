import { nextTick } from 'process';
import { useModernModel } from '@xgenia-hooks/useModel';
import React, { useState, useEffect } from 'react';
import { ReactNode } from 'react';


import { App } from '@xgenia-models/app';
import { SidebarItem, SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { FeedbackType } from '@xgenia-constants/FeedbackType';

// We might not need IconName anymore if we use Lucide directly
// import { IconName } from '@xgenia-core-ui/components/common/Icon';

import { SideNavigation, SideNavigationButton } from '@xgenia-core-ui/components/app/SideNavigation';
import { IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { ErrorBoundary } from '@xgenia-core-ui/components/common/ErrorBoundary';
import { Container, ContainerDirection } from '@xgenia-core-ui/components/layout/Container';

import {
  SideComponents,
  SideSearch,
  SideVersionControl,
  SideCloud,
  SideCloudFunctions,
  SideSettings,
  SideChatPanel,
  SideAiPanel,
  SideProjectStyles,
  SideNodeReferences,
  SideFeedback,
  SideImageEditor,
  SideMemoryPanel,
  SideMaths,
  SideAssets,
  SideAddNode,
  SideLogout
} from './SidebarIcons';

import { PanelActiveContext } from '../panels/useIsActivePanel';

import css from './SidePanel.model.scss';

// Map IDs to Hugeicon wrapper components
const iconMap: Record<string, React.ElementType> = {
  'components': SideComponents,
  'search': SideSearch,
  'versioncontrol': SideVersionControl,
  'cloudservice': SideCloud,
  'cloud-functions': SideCloudFunctions,
  'settings': SideSettings,
  'chat-panel': SideChatPanel,
  'ChatPanel': SideChatPanel,
  'ai-panel': SideAiPanel,
  'project-styles': SideProjectStyles,
  'node-references': SideNodeReferences,
  'feedback-panel': SideFeedback,
  'image-editor': SideImageEditor,
  'memory-panel': SideMemoryPanel,
  'maths-panel': SideMaths,
  'assets': SideAssets
};

export function SidePanel() {
  const [group] = useState({});

  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.itemsChanged]);

  const items = sidebar.getVisibleItems();

  const [activeId, setActiveId] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<string, ReactNode>>({});
  useEffect(() => {
    const currentPanelId = SidebarModel.instance.ActiveId;

    setPanels((prev) => {
      const component = SidebarModel.instance.getPanelComponent(currentPanelId);
      if (component) {
        prev[currentPanelId] = React.createElement(component);
      }
      return { ...prev };
    });

    setActiveId(currentPanelId);

    SidebarModel.instance.on(
      SidebarModelEvent.activeChanged,
      (panelId) => {
        const panel = SidebarModel.instance.getPanel(panelId);

        if (panel.transient || !panels[panelId]) {
          setPanels((prev) => {
            const component = SidebarModel.instance.getPanelComponent(panelId);
            if (component) {
              return { ...prev, [panelId]: React.createElement(component) };
            }
            return prev;
          });
        }

        setActiveId(panelId);
      },
      group
    );

    SidebarModel.instance.on(SidebarModelEvent.HotReload, () => {
      nextTick(() => {
        console.log('[hot-reload] Side Panel');

        const currentPanelId = SidebarModel.instance.ActiveId;
        if (!currentPanelId) return;
        const component = SidebarModel.instance.getPanelComponent(currentPanelId);

        if (component) {
          setPanels({
            [currentPanelId]: React.createElement(component)
          });
        } else {
          setPanels({});
        }

        setActiveId(currentPanelId);
      });
    });

    return function () {
      SidebarModel.instance.off(group);
    };
  }, []);

  function onItemClick(item: SidebarItem) {
    sidebar.switch(item.id);
    item.onClick && item.onClick();
  }

  // Header: centered bright green plus
  const header = (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <Tooltip content="Add node" renderDirection={DialogRenderDirection.Horizontal} showAfterMs={200}>
        <IconButton
          icon={SideAddNode}
          variant={IconButtonVariant.Default}
          iconVariant={FeedbackType.Success}
          UNSAFE_style={{
            backgroundColor: '#67DE92',
            width: 26,
            height: 26,
            borderRadius: 8,
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 0 rgba(0,0,0,0)'
          }}
          iconColor="#0b1b14"
          onClick={() => {
            SidebarModel.instance.switch('node-picker');
          }}
        />
      </Tooltip>
    </div>
  );

  return (
    <SideNavigation
      header={header}
      onExitClick={() => App.instance.exitProject()}
      toolbar={
        // Filter items for layout
        (() => {
          // IDs that belong in the bottom settings cluster
          const bottomIds = new Set([
            'project-styles',
            'versioncontrol',
            'cloudservice',
            'settings',
            'feedback-panel'
          ]);

          const bottomItems = items
            .filter(item => bottomIds.has(item.id))
            .sort((a, b) => a.order - b.order);

          const centerItems = items
            .filter(item => !bottomIds.has(item.id))
            .map(i => ({ ...i }))
            .sort((a, b) => a.order - b.order);

          return (
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>

              {/* Container for the centered icons */}
              <Container
                direction={ContainerDirection.Vertical}
                UNSAFE_style={{
                  flexGrow: 1,
                  justifyContent: 'center',
                  alignItems: 'center'
                }}
              >
                <Container
                  direction={ContainerDirection.Vertical}
                  UNSAFE_style={{
                    flexGrow: 1,
                    justifyContent: 'center',
                    alignItems: 'center'
                  }}
                >
                  <Container
                    direction={ContainerDirection.Vertical}
                    UNSAFE_style={{
                      padding: '0px',
                      marginBlock: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '12px'
                    }}
                  >
                    {centerItems.map((item) => {
                      const IconComponent = iconMap[item.id];
                      if (!IconComponent) {
                        console.warn(`No icon mapped for ID: ${item.id}. Using default.`);
                        return null;
                      }
                      return (
                        <SideNavigationButton
                          key={item.id}
                          isActive={item.id === activeId}
                          icon={IconComponent}
                          size={IconSize.Small}
                          onClick={() => onItemClick(item)}
                          label={item.name}
                          fineType={item.fineType}
                          isDisabled={item.isDisabled}
                          testId={item.id + '-panel'}
                        />
                      );
                    })}
                  </Container>
                </Container>
              </Container>

              {/* Bottom settings cluster: styles, git, editor settings, cloud, feedback, settings, logout */}
              {bottomItems.length > 0 && (
                <Container direction={ContainerDirection.Vertical} UNSAFE_style={{ alignItems: 'center', paddingBottom: 16, gap: '6px' }}>
                  {/* Thin separator line */}
                  <div style={{ width: 20, height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 4 }} />

                  {bottomItems.map((item) => {
                    const IconComponent = iconMap[item.id];
                    if (!IconComponent) {
                      console.warn(`No icon mapped for ID: ${item.id}. Using default.`);
                      return null;
                    }
                    return (
                      <SideNavigationButton
                        key={item.id}
                        isActive={item.id === activeId}
                        icon={IconComponent}
                        size={IconSize.Small}
                        onClick={() => onItemClick(item)}
                        label={item.name}
                        fineType={item.fineType}
                        isDisabled={item.isDisabled}
                        testId={item.id + '-panel'}
                      />
                    );
                  })}

                  <Tooltip content="Exit project" renderDirection={DialogRenderDirection.Horizontal} showAfterMs={300}>
                    <IconButton
                      icon={SideLogout}
                      variant={IconButtonVariant.Transparent}
                      UNSAFE_style={{
                        backgroundColor: 'transparent',
                        width: 26,
                        height: 26,
                        borderRadius: 8,
                        marginTop: 6,
                        marginBottom: 2,
                        opacity: 0.6
                      }}
                      onClick={() => App.instance.exitProject()}
                    />
                  </Tooltip>
                </Container>
              )}
            </div>
          );
        })()
      }
      panel={
        <div style={{ height: '100%' }}>
          {/*
            Every panel the user has opened stays mounted and is hidden with
            `display: none`, so switching back is instant and keeps its state —
            and, for the panels that are remote iframes, avoids re-downloading and
            re-booting a whole application on every switch.

            The cost is that React has no idea a panel is off screen: hidden
            panels keep their timers, keep their model subscriptions and keep
            reconciling. `PanelActiveContext` is how a panel finds out, so the
            expensive ones can idle instead. `unmountWhenHidden` is the stronger
            opt-out for a panel that genuinely should not persist; it is off by
            default because taking it costs that panel's state.
          */}
          {Object.entries(panels).map(([id, panel]) => {
            const isActive = id === activeId;
            const unmountWhenHidden = SidebarModel.instance.getPanel(id)?.unmountWhenHidden === true;
            if (!isActive && unmountWhenHidden) return null;

            return (
              <div
                key={id}
                data-panel-id={id}
                className={css['PanelItem']}
                style={{
                  display: isActive ? 'block' : 'none'
                }}
              >
                <ErrorBoundary
                  showTryAgain
                  onTryAgain={() => {
                    setPanels({});

                    nextTick(() => {
                      const currentPanelId = SidebarModel.instance.ActiveId;
                      if (!currentPanelId) return;
                      const component = SidebarModel.instance.getPanelComponent(currentPanelId);

                      if (component) {
                        setPanels({ [currentPanelId]: React.createElement(component) });
                      } else {
                        setPanels({});
                      }

                      setActiveId(currentPanelId);
                    });
                  }}
                >
                  <PanelActiveContext.Provider value={isActive}>{panel}</PanelActiveContext.Provider>
                </ErrorBoundary>
              </div>
            );
          })}
        </div>
      }
    />
  );
}