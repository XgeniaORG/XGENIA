import { useKeyboardCommands } from '@xgenia-hooks/useKeyboardCommands';
import { TopbarImport, TopbarPanelOpen, TopbarPanelClose } from '../SidePanel/SidebarIcons';

import { useTriggerRerender } from '@xgenia-hooks/useTriggerRerender';
import classNames from 'classnames';
import { ipcRenderer } from 'electron';
import React, { useEffect, useRef, useState } from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { Keybindings } from '@xgenia-constants/Keybindings';
import { WarningsModel } from '@xgenia-models/warningsmodel';
import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';

import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonState, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { PrimaryButton } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';
import { ToggleSwitch } from '@xgenia-core-ui/components/inputs/ToggleSwitch';
import { MenuDialog, MenuDialogWidth, MenuDialogItem } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { Label } from '@xgenia-core-ui/components/typography/Label';
import { TextType } from '@xgenia-core-ui/components/typography/Text';
import { useTrackBounds } from '@xgenia-core-ui/hooks/useTrackBounds';

import { ProjectModel } from '@xgenia-models/projectmodel';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { CreateNewNodePanel } from '../createnewnodepanel';
import { DeployPopup } from '../DeployPopup/DeployPopup';
import { ToastLayer } from '../ToastLayer/ToastLayer';
// Compile-only button retired — Publish compiles as its first step, so the standalone
// button was a second way to do half of Publish. Kept commented rather than deleted so
// it can be restored; the compiler itself is untouched and still used by
// XgeniaDeployTab (its own `compileProject` import).
// import { compileProject } from '../../utils/compile';
import { FigmaImportDialog } from './FigmaImportDialog';
import { TitleBar } from '../documents/EditorDocument/titlebar';
import { NodeGraphEditor } from '../nodegrapheditor';
import PopupLayer from '../popuplayer';
import css from './EditorTopbar.module.scss';
import { returnWarningItems } from './EditorTopbar.returnWarningItems';
import {
  screenSizesWithDividers,
  getScreenSizeObjectFromMeasurements,
  getIconFromScreenSizeGroupName
} from './ScreenSizes';

export interface EditorTopbarProps {
  instance: TitleBar;
  routes: string[];
  onRouteChanged: (value: string) => void;
  setDocumentLayout: (value: 'vertical' | 'horizontal' | 'detachedPreview') => void;
  documentLayout: string;
  zoomFactor: number;
  setZoomFactor: (factor: number) => void;
  onUrlNavigateBack: () => void;
  onUrlNavigateForward: () => void;
  navigationState: { canGoBack: boolean; canGoForward: boolean; route: string };
  onPreviewSizeChanged: (width: number, height: number, deviceName: string) => void;
  previewSize: { width: number; height: number };
  previewMode: boolean;
  onPreviewModeChanged: (previewMode: boolean) => void;
  nodeGraph: NodeGraphEditor;
  deployIsDisabled: boolean;
}

export function EditorTopbar({
  instance,
  routes,
  onRouteChanged,
  setDocumentLayout,
  documentLayout,
  setZoomFactor,
  zoomFactor,
  previewSize,
  onUrlNavigateBack,
  onUrlNavigateForward,
  navigationState,
  onPreviewSizeChanged,
  previewMode,
  onPreviewModeChanged,
  nodeGraph,
  deployIsDisabled
}: EditorTopbarProps) {
  const urlBarRef = useRef<HTMLInputElement>(null);
  const deployButtonRef = useRef<HTMLDivElement>(null);
  const warningButtonRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const zoomLevelTrigger = useRef<HTMLDivElement>(null);
  const screenSizeTrigger = useRef<HTMLDivElement>(null);
  const previewLayoutTrigger = useRef<HTMLDivElement>(null);
  const [isDeployVisible, setIsDeployVisible] = useState(false);
  // Compile button state — retired with the button itself (see the JSX below).
  // const compileButtonRef = useRef<HTMLDivElement>(null);
  // const [isCompiling, setIsCompiling] = useState(false);
  const [isFigmaDialogVisible, setIsFigmaDialogVisible] = useState(false);
  const figmaButtonRef = useRef<HTMLDivElement>(null);
  const [isWarningsDialogVisible, setIsWarningsDialogVisible] = useState(false);
  const [isZoomDialogVisible, setIsZoomDialogVisible] = useState(false);
  const [isSizeDialogVisible, setIsSizeDialogVisible] = useState(false);
  const [isPreviewLayoutDialogVisible, setIsPreviewLayoutDialogVisible] = useState(false);
  const triggerRerender = useTriggerRerender();
  const [isRouteListVisible, setIsRouteListVisible] = useState(false);
  const currentScreenSize = getScreenSizeObjectFromMeasurements(previewSize.width, previewSize.height);
  const [routeTextInputValue, setRouteTextInputValue] = useState('');
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);

  // Right panel tab state — only visible when an AI node is selected
  const [rightPanelTab, setRightPanelTab] = useState<'properties' | 'chat'>('properties');
  const [isAiNodeSelected, setIsAiNodeSelected] = useState(false);

  useEffect(() => {
    const eventGroup = {};
    EventDispatcher.instance.on(
      'right-panel-mode',
      (data: { isAiNode: boolean; tab?: 'properties' | 'chat' }) => {
        setIsAiNodeSelected(data.isAiNode);
        if (data.tab) setRightPanelTab(data.tab);
        if (!data.isAiNode) setRightPanelTab('properties');
      },
      eventGroup
    );
    return () => { EventDispatcher.instance.off(eventGroup); };
  }, []);

  // Compile-only handler — retired with the button (see the JSX below). Publish runs
  // the same compileProject() as its first step, so nothing here is lost.
  // const handleCompile = async () => {
  //   if (isCompiling) return;
  //   const project = ProjectModel.instance;
  //   if (!project) {
  //     ToastLayer.showError('No project is open to compile.');
  //     return;
  //   }
  //   const activityId = 'compile';
  //   setIsCompiling(true);
  //   ToastLayer.showActivity('Compiling project…', activityId);
  //   try {
  //     const result = await compileProject(project);
  //     ToastLayer.hideActivity(activityId);
  //     ToastLayer.showSuccess(
  //       `Compiled to ${result.name} (${result.componentsCreated} logic component${
  //         result.componentsCreated === 1 ? '' : 's'
  //       }).`
  //     );
  //   } catch (e: any) {
  //     ToastLayer.hideActivity(activityId);
  //     ToastLayer.showError('Compile failed: ' + (e?.message || String(e)));
  //     console.error('[Compile] failed', e);
  //   } finally {
  //     setIsCompiling(false);
  //   }
  // };

  const zoomLevelOptions = [
    {
      label: '100%',
      value: 1
    },
    {
      label: '75%',
      value: 0.75
    },
    {
      label: '50%',
      value: 0.5
    },
    {
      label: '25%',
      value: 0.25
    }
  ];

  const [customWidth, setCustomWidth] = useState(previewSize.width || 1280);
  const [customHeight, setCustomHeight] = useState(previewSize.height || 720);

  if (previewSize.width) {
    zoomLevelOptions.unshift({
      label: 'Fit',
      value: 0
    });
  }

  useEffect(() => {
    // Strip query parameters from the route for display
    const routeWithoutQuery = navigationState.route?.split('?')[0] || '';
    setRouteTextInputValue(routeWithoutQuery);
  }, [navigationState?.route]);

  // Mounted once. Without the dependency array this tore down and rebuilt the
  // WarningsModel subscription after EVERY render of the topbar, which is the
  // most-rendered component in the editor.
  useEffect(() => {
    const eventGroup = {};
    WarningsModel.instance.on('warningsChanged', () => triggerRerender(), eventGroup);

    return () => {
      WarningsModel.instance.off(eventGroup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-08-12 perf audit: a `glowIntensity` state was advanced by a 60ms
  // interval — ~17 re-renders per second of the always-mounted topbar, forever —
  // and the value was never read anywhere in this file. Deleted outright rather
  // than throttled: there is no glow to animate.

  function showWarnings(e) {
    setIsWarningsDialogVisible(true);
  }

  function onAddClicked(evt: React.MouseEvent<HTMLButtonElement>) {
    evt.stopPropagation();

    const x = Math.round(Math.random() * 100 + 50);
    const y = Math.round(Math.random() * 100 + 50);

    const panAndScale = nodeGraph.getPanAndScale();
    const scaledPos = {
      x: x / panAndScale.scale - panAndScale.x,
      y: y / panAndScale.scale - panAndScale.y
    };

    const createNewNodePanel = new CreateNewNodePanel({
      attachToRoot: true,
      model: nodeGraph.model,
      pos: scaledPos,
      runtimeType: nodeGraph.runtimeType
    });
    createNewNodePanel.render();

    PopupLayer.instance.showPopup({
      content: createNewNodePanel,
      position: 'screen-center',
      isBackgroundDimmed: true,
      onClose: () => createNewNodePanel.dispose()
    });
  }
  const rootRef = useRef<HTMLDivElement>(null);

  const bounds = useTrackBounds(rootRef);
  const isSmall = bounds?.width < 850;
  const getActiveLayoutIcon = () => {
    switch (documentLayout) {
      case 'vertical':
        return IconName.VerticalSplit;
      case 'horizontal':
        return IconName.HorizontalSplit;
      default:
        return IconName.Cards;
    }
  };

  useKeyboardCommands(() => [
    {
      handler: () => {
        urlBarRef.current?.focus();
      },
      keybinding: KeyMod.CtrlCmd | KeyCode.KEY_L
    }
  ]);

  return (
    <div
      ref={rootRef}
      className={classNames(css['Root'], isSmall && css['is-small'])}
      style={{
        background: 'var(--theme-color-bg-2)',
        backdropFilter: 'none',
        boxShadow: 'none',
        borderBottom: 'none',
        height: '44px'
      }}
    >
      <div
        className={css['LeftSide']}
        style={{
          display: 'flex',
          alignItems: 'center'
        }}
      >
        {/* Hide/Show left panel toggle */}
        <div style={{ margin: '0 4px 0 8px' }}>
          <Tooltip content={isLeftPanelVisible ? 'Hide panel' : 'Show panel'}>
            <IconButton
              icon={isLeftPanelVisible ? TopbarPanelClose : TopbarPanelOpen}
              variant={IconButtonVariant.Transparent}
              size={IconSize.Small}
              onClick={() => {
                const next = !isLeftPanelVisible;
                setIsLeftPanelVisible(next);
                EventDispatcher.instance.emit('toggle-left-panel', next);
              }}
            />
          </Tooltip>
        </div>

        {/* Removed top bar plus button - add lives in sidebar */}

        <div
          className={css['is-padded']}
          style={{
            margin: '0 4px 0 4px',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            gap: '2px'
          }}
        >
          <Tooltip content="Navigate back">
            <IconButton
              variant={IconButtonVariant.Transparent}
              icon={IconName.CaretLeft}
              size={IconSize.Small}
              onClick={onUrlNavigateBack}
              isDisabled={!navigationState.canGoBack}
            />
          </Tooltip>
          <Tooltip content="Navigate forward">
            <IconButton
              variant={IconButtonVariant.Transparent}
              icon={IconName.CaretRight}
              size={IconSize.Small}
              onClick={onUrlNavigateForward}
              isDisabled={!navigationState.canGoForward}
            />
          </Tooltip>
          <Tooltip content="Refresh preview" fineType={Keybindings.REFRESH_PREVIEW.label}>
            <IconButton
              icon={IconName.Refresh}
              variant={IconButtonVariant.Transparent}
              size={IconSize.Small}
              onClick={() => EventDispatcher.instance.emit('viewer-refresh')}
            />
          </Tooltip>
        </div>

        <MenuDialog
          title="Preview routes"
          width={MenuDialogWidth.Large}
          isVisible={isRouteListVisible}
          onClose={() => setIsRouteListVisible(false)}
          triggerRef={urlInputRef}
          items={routes.map((url) => ({
            label: url,
            isHighlighted: routes.length > 1 && navigationState.route?.split('?')[0] === url,
            onClick: () => onRouteChanged(url)
          }))}
          UNSAFE_maxHeight="300px"
        />

        <div ref={urlInputRef} className={css.UrlBarWrapper}>
          <div style={{
            backgroundColor: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '6px',
            padding: '4px 8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            minWidth: '200px'
          }}>
            <Icon
              size={IconSize.Small}
              variant={TextType.Default}
              icon={IconName.Home}
              UNSAFE_style={{ opacity: 0.7 }}
            />
            <TextInput
              onRefChange={(ref) => {
                urlBarRef.current = ref.current;
              }}
              value={routeTextInputValue}
              onFocus={() => setIsRouteListVisible(true)}
              onChange={(e) => {
                setRouteTextInputValue(e.target.value);
                setIsRouteListVisible(false);
              }}
              onEnter={() => {
                // Preserve query parameters when navigating
                const currentQuery = navigationState.route?.includes('?') ? navigationState.route.split('?')[1] : '';
                const newRoute = currentQuery ? `${routeTextInputValue}?${currentQuery}` : routeTextInputValue;
                onRouteChanged(newRoute);
              }}
              UNSAFE_className={css.UrlBarTextInput}
              variant={TextInputVariant.OpaqueOnHover}
              slotAfterInput={
                <Icon icon={IconName.CaretDown} variant={TextType.Default} UNSAFE_style={{ marginTop: -2 }} />
              }
            />
          </div>
        </div>
      </div>

      <div
        className={css['RightSide']}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          marginLeft: 'auto'
        }}
      >
        {instance.warningsAmount > 0 && (
          <div
            // className={css['is-padded']}
            ref={warningButtonRef}
            style={{
              margin: '0 4px',
              transition: 'all 0.2s ease'
            }}
          >
            <Tooltip content="Show warnings">
              <IconButton
                id="editortopbar-warning-button"
                variant={IconButtonVariant.Transparent}
                iconVariant={FeedbackType.Danger}
                icon={IconName.WarningTriangle}
                size={IconSize.Small}
                onClick={showWarnings}
                label={String(instance.warningsAmount)}
              />
            </Tooltip>
          </div>
        )}

        <div
          ref={screenSizeTrigger}
          style={{
            margin: '0 4px'
          }}
        >
          <Tooltip content="Preview screen size" UNSAFE_triggerClassName={css.TooltipPositioner}>
            <div
              className={classNames(css['ZoomSelect'], css['TopbarSelect'])}
              onClick={() => setIsSizeDialogVisible(true)}
              style={{
                background: 'transparent',
                borderRadius: '0',
                padding: '0 6px',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s ease'
              }}
            >
              {/* <Icon icon={IconName.DeviceDesktop} /> */}
              <Icon size={IconSize.Small} icon={getIconFromScreenSizeGroupName(currentScreenSize.group)} />
              <Icon size={IconSize.Small} icon={IconName.CaretDown} />
            </div>
          </Tooltip>

          <MenuDialog
            title="Preview screen size"
            width={MenuDialogWidth.Medium}
            isVisible={isSizeDialogVisible}
            triggerRef={screenSizeTrigger}
            onClose={() => setIsSizeDialogVisible(false)}
            items={[
              ...screenSizesWithDividers.map((size) => {
                if (typeof size === 'string') return size;

                return {
                  label: size.name + (size.width ? ` (${size.width} x ${size.height})` : ''),
                  icon: getIconFromScreenSizeGroupName(size.group),
                  isHighlighted: size.width === previewSize.width && size.height === previewSize.height,
                  onClick: () => {
                    onPreviewSizeChanged(size.width, size.height, size.width ? size.name : null);
                    if (size.width && size.height) {
                      setCustomWidth(size.width);
                      setCustomHeight(size.height);
                    }
                  }
                };
              }),
              'divider',
              {
                label: 'Custom size',
                icon: IconName.Pencil,
                isHighlighted: !screenSizesWithDividers.some(s => typeof s !== 'string' && s.width === previewSize.width && s.height === previewSize.height),
                dontCloseMenuOnClick: true,
                component: (doCloseMenu) => (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 12px 10px 12px',
                      marginTop: '-4px'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ position: 'relative', flex: 1 }}>
                      <TextInput
                        type="number"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Number(e.target.value))}
                        placeholder="Width"
                        UNSAFE_className={css.CustomSizeInput}
                      />
                    </div>
                    <Label variant={TextType.DefaultContrast} UNSAFE_style={{ opacity: 0.5 }}>×</Label>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <TextInput
                        type="number"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Number(e.target.value))}
                        placeholder="Height"
                        UNSAFE_className={css.CustomSizeInput}
                      />
                    </div>
                    <IconButton
                      icon={IconName.Check}
                      size={IconSize.Small}
                      variant={IconButtonVariant.Transparent}
                      onClick={() => {
                        onPreviewSizeChanged(customWidth, customHeight, 'Custom');
                        doCloseMenu?.();
                      }}
                    />
                  </div>
                )
              }
            ]}
          />
        </div>

        <div
          ref={zoomLevelTrigger}
          style={{
            margin: '0 4px'
          }}
        >
          <Tooltip content="Preview zoom level" UNSAFE_triggerClassName={css.TooltipPositioner}>
            <div
              className={classNames(css['ZoomSelect'], css['TopbarSelect'])}
              onClick={() => setIsZoomDialogVisible(true)}
              style={{
                background: 'transparent',
                borderRadius: '0',
                padding: '0 6px',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                transition: 'all 0.2s ease'
              }}
            >
              <Label>{zoomLevelOptions.find((option) => option.value === zoomFactor)?.label}</Label>
              <Icon size={IconSize.Small} icon={IconName.CaretDown} />
            </div>
          </Tooltip>

          <MenuDialog
            title="Preview zoom level"
            width={MenuDialogWidth.Small}
            isVisible={isZoomDialogVisible}
            onClose={() => setIsZoomDialogVisible(false)}
            triggerRef={zoomLevelTrigger}
            items={zoomLevelOptions.map((level) => ({
              label: level.label,
              isHighlighted: zoomFactor === level.value,
              onClick: () => setZoomFactor(level.value)
            }))}
          />
        </div>

        {isSmall && (
          <div
            ref={previewLayoutTrigger}
            style={{
              margin: '0 4px'
            }}
          >
            <Tooltip content="Preview layout" UNSAFE_triggerClassName={css.TooltipPositioner}>
              <div
                className={classNames(css['ZoomSelect'], css['TopbarSelect'])}
                onClick={() => setIsPreviewLayoutDialogVisible(true)}
                style={{
                  background: 'transparent',
                  borderRadius: '0',
                  padding: '0 6px',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'all 0.2s ease'
                }}
              >
                <Icon size={IconSize.Small} icon={getActiveLayoutIcon()} />
                <Icon size={IconSize.Small} icon={IconName.CaretDown} />
              </div>
            </Tooltip>

            <MenuDialog
              title="Preview layout"
              width={MenuDialogWidth.Small}
              isVisible={isPreviewLayoutDialogVisible}
              onClose={() => setIsPreviewLayoutDialogVisible(false)}
              triggerRef={previewLayoutTrigger}
              items={[
                {
                  label: 'Vertical',
                  icon: IconName.VerticalSplit,
                  isHighlighted: documentLayout === 'vertical',
                  onClick: () => setDocumentLayout('vertical')
                },
                {
                  label: 'Horizontal',
                  icon: IconName.HorizontalSplit,
                  isHighlighted: documentLayout === 'horizontal',
                  onClick: () => setDocumentLayout('horizontal')
                },
                {
                  label: 'Detached',
                  icon: IconName.Cards,
                  isHighlighted: documentLayout === 'detachedPreview',
                  onClick: () => {
                    setDocumentLayout('detachedPreview');
                    ipcRenderer.send('viewer-focus');
                  }
                }
              ]}
            />
          </div>
        )}

        {!isSmall && (
          <div
            className={css['is-padded']}
            style={{
              margin: '0 4px',
              transition: 'all 0.2s ease',
              display: 'flex',
              alignItems: 'center',
              gap: '2px'
            }}
          >
            <Tooltip content="Split workspace vertically">
              <IconButton
                icon={IconName.VerticalSplit}
                variant={IconButtonVariant.Transparent}
                size={IconSize.Small}
                onClick={() => setDocumentLayout('vertical')}
                state={documentLayout === 'vertical' ? IconButtonState.Active : undefined}
              />
            </Tooltip>

            <Tooltip content="Split workspace horizontally">
              <IconButton
                icon={IconName.HorizontalSplit}
                variant={IconButtonVariant.Transparent}
                size={IconSize.Small}
                onClick={() => setDocumentLayout('horizontal')}
                state={documentLayout === 'horizontal' ? IconButtonState.Active : undefined}
              />
            </Tooltip>

            <Tooltip content="Detach preview from editor">
              <IconButton
                icon={IconName.Cards}
                variant={IconButtonVariant.Transparent}
                size={IconSize.Small}
                onClick={() => {
                  setDocumentLayout('detachedPreview');
                  ipcRenderer.send('viewer-focus');
                }}
                state={documentLayout === 'detachedPreview' ? IconButtonState.Active : undefined}
              />
            </Tooltip>
          </div>
        )}

        <Tooltip
          content={previewMode ? "Switch to Edit mode" : "Switch to Preview mode"}
          fineType={Keybindings.TOGGLE_PREVIEW_MODE.label}
          UNSAFE_triggerClassName={css.TooltipPositioner}
        >
          <div
            className={classNames(css.ModeToggleIcon, previewMode ? css.isPreviewMode : css.isDesignMode)}
            style={previewMode ? { backgroundColor: 'rgba(103, 222, 146, 0.15)', borderRadius: '6px' } : undefined}
          >
            <IconButton
              icon={previewMode ? IconName.UI : IconName.Pencil}
              variant={IconButtonVariant.Transparent}
              size={IconSize.Small}
              onClick={() => {
                onPreviewModeChanged(!previewMode);
              }}
            />
          </div>
        </Tooltip>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            marginRight: '4px'
          }}
        >
          <Tooltip content="Open dev tools" fineType={Keybindings.OPEN_DEVTOOLS.label}>
            <IconButton
              icon={IconName.Bug}
              variant={IconButtonVariant.Transparent}
              size={IconSize.Small}
              onClick={() => EventDispatcher.instance.emit('viewer-open-devtools')}
            />
          </Tooltip>
        </div>

        {/* Right panel tab toggle — AI nodes only */}
        {isAiNodeSelected && (
          <div className={css['PanelSegmented']}>
            <button
              className={classNames(css['PanelSegmentedBtn'], rightPanelTab === 'properties' && css['isActive'])}
              onClick={() => {
                setRightPanelTab('properties');
                EventDispatcher.instance.emit('right-panel-tab-changed', 'properties');
              }}
            >
              Properties
            </button>
            <button
              className={classNames(css['PanelSegmentedBtn'], rightPanelTab === 'chat' && css['isActive'])}
              onClick={() => {
                setRightPanelTab('chat');
                EventDispatcher.instance.emit('right-panel-tab-changed', 'chat');
              }}
            >
              AI Chat
            </button>
          </div>
        )}

        {/* Design Import Button */}
        <span ref={figmaButtonRef} style={{ margin: '0 4px' }}>
          <Tooltip content="Import Design (HTML / Figma)">
            <button
              onClick={() => setIsFigmaDialogVisible(!isFigmaDialogVisible)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px',
                padding: '3px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                color: '#CCC',
                fontSize: '11px',
                fontWeight: 500,
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'rgba(103,222,146,0.3)'; e.currentTarget.style.color = '#67DE92'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#CCC'; }}
            >
              <TopbarImport size={14} color="currentColor" />
              Import
            </button>
          </Tooltip>
        </span>

        {/* Compile button — removed from the topbar. Publish (below) compiles first and
            then deploys, so this only ever did half of what Publish does. Commented out
            rather than deleted; restoring it means uncommenting this block plus the ref,
            state, handler and `compileProject` import above.

        <span ref={compileButtonRef} style={{ margin: '0 4px', position: 'relative' }}>
          <Tooltip content="Compile: copy the project and extract logic into deployable cloud components">
            <button
              onClick={handleCompile}
              disabled={isCompiling}
              style={{
                background: '#FBBF24',
                borderRadius: '6px',
                boxShadow: 'none',
                border: 'none',
                transition: 'all 0.15s ease',
                position: 'relative',
                zIndex: 1,
                color: '#000000',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 9px',
                fontWeight: 600,
                fontSize: '11px',
                letterSpacing: 0.2,
                cursor: isCompiling ? 'wait' : 'pointer',
                opacity: isCompiling ? 0.6 : 1
              }}
            >
              <Icon icon={IconName.CloudFunction} UNSAFE_style={{ color: '#000000' }} size={IconSize.Tiny} />
              {isCompiling ? 'Compiling…' : 'Compile'}
            </button>
          </Tooltip>
        </span>
        */}

        <span
          ref={deployButtonRef}
          style={{
            margin: '0 8px 0 4px',
            position: 'relative'
          }}
        >
          <button
            onClick={() => setIsDeployVisible(true)}
            style={{
              background: '#34D399',
              borderRadius: '6px',
              boxShadow: 'none',
              border: 'none',
              transition: 'all 0.15s ease',
              position: 'relative',
              zIndex: 1,
              color: '#000000',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 9px',
              fontWeight: 600,
              fontSize: '11px',
              letterSpacing: 0.2,
              cursor: 'pointer'
            }}
          >
            <Icon icon={IconName.ArrowUp} UNSAFE_style={{ color: '#000000' }} size={IconSize.Tiny} />
            Publish
          </button>
        </span>
      </div>

      <DeployPopup isVisible={isDeployVisible} onClose={() => setIsDeployVisible(false)} triggerRef={deployButtonRef} />

      <FigmaImportDialog isVisible={isFigmaDialogVisible} onClose={() => setIsFigmaDialogVisible(false)} triggerRef={figmaButtonRef} />

      <MenuDialog
        title="Warnings"
        isVisible={isWarningsDialogVisible}
        onClose={() => setIsWarningsDialogVisible(false)}
        triggerRef={warningButtonRef}
        items={[...returnWarningItems(instance.allWarnings, nodeGraph)]}
        width={MenuDialogWidth.Large}
      />
    </div>
  );
}
