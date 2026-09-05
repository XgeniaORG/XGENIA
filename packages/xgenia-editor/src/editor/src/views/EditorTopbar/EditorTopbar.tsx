// EditorTopbar — one glass row, four clusters, and almost no logic of its own.
//
//   [panel toggle | back forward refresh]      (StatusPill)      [FrameChip] [Edit|Preview] [⋯] [Publish]
//
// Everything that used to be spelled out here as inline-styled markup now lives in a
// component under ./topbar. What is left is composition: the props each component needs,
// the two dialogs anchored to elements in the bar, one command dispatcher shared by the
// pill's typed commands and the keyboard, and exactly one store subscription effect.
import { useKeyboardCommands } from '@xgenia-hooks/useKeyboardCommands';
import { useTriggerRerender } from '@xgenia-hooks/useTriggerRerender';
import { ipcRenderer } from 'electron';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { AiActivity, AiActivitySnapshot } from '@xgenia-models/aiactivity';
import { PublishSnapshot } from '@xgenia-models/publishStore';
import { PublishState, wirePublishState } from '@xgenia-models/publishstate';
import { WarningsModel } from '@xgenia-models/warningsmodel';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { MenuDialog, MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { DeployPopup } from '../DeployPopup/DeployPopup';
import { TitleBar } from '../documents/EditorDocument/titlebar';
import { NodeGraphEditor } from '../nodegrapheditor';
import { TopbarPanelClose, TopbarPanelOpen } from '../SidePanel/SidebarIcons';
import css from './EditorTopbar.module.scss';
import { returnWarningItems } from './EditorTopbar.returnWarningItems';
import { FigmaImportDialog } from './FigmaImportDialog';
import { ScreenSize, screenSizesWithDividers } from './ScreenSizes';
import { FrameChip } from './topbar/FrameChip';
import { ModeSegment } from './topbar/ModeSegment';
import { OverflowMenu } from './topbar/OverflowMenu';
import { PublishButton } from './topbar/PublishButton';
import { StatusPill } from './topbar/StatusPill';
import { RouteInfo, TopbarMatch } from './topbar/topbarCommands';

export interface EditorTopbarProps {
  instance: TitleBar;
  /**
   * Legacy plain route list. The bar itself reads `routeInfos`; this stays declared (and
   * optional) so `EditorDocument` compiles whether or not it still passes it.
   */
  /** Pages with titles and node counts, for the pill's page menu and typed navigation. */
  routeInfos: RouteInfo[];
  onRouteChanged: (value: string) => void;
  setDocumentLayout: (value: 'vertical' | 'horizontal' | 'detachedPreview') => void;
  documentLayout: string;
  zoomFactor: number;
  setZoomFactor: (factor: number) => void;
  onUrlNavigateBack: () => void;
  onUrlNavigateForward: () => void;
  navigationState: { canGoBack: boolean; canGoForward: boolean; route: string };
  onPreviewSizeChanged: (width: number | null, height: number | null, deviceName: string | null) => void;
  previewSize: { width: number | null; height: number | null };
  previewMode: boolean;
  onPreviewModeChanged: (previewMode: boolean) => void;
  nodeGraph: NodeGraphEditor;
  deployIsDisabled: boolean;
}

export function EditorTopbar({
  instance,
  routeInfos,
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
  // Anchors. `figmaButtonRef` is deliberately shared: OverflowMenu puts it on its own
  // wrapper so the import dialog opens under the ⋯ button that launched it.
  const deployButtonRef = useRef<HTMLDivElement>(null);
  const figmaButtonRef = useRef<HTMLDivElement>(null);
  const pillAnchorRef = useRef<HTMLDivElement>(null);
  /** The pill writes its own focus function here; ⌘L calls it. */
  const pillFocusRef = useRef<(() => void) | null>(null);

  const [isDeployVisible, setIsDeployVisible] = useState(false);
  const [isFigmaDialogVisible, setIsFigmaDialogVisible] = useState(false);
  const [isWarningsDialogVisible, setIsWarningsDialogVisible] = useState(false);
  const [isLeftPanelVisible, setIsLeftPanelVisible] = useState(true);
  const [publishSnap, setPublishSnap] = useState<PublishSnapshot>(() => PublishState.getSnapshot());
  const [aiSnap, setAiSnap] = useState<AiActivitySnapshot>(() => AiActivity.getSnapshot());

  const triggerRerender = useTriggerRerender();

  // Mounted once. Without the dependency array this tore down and rebuilt every
  // subscription after EVERY render of the topbar, which is the most-rendered component
  // in the editor.
  //
  // Order matters: the listeners are registered BEFORE `wirePublishState()`, because
  // wiring ends by loading the persisted record for the open project and that load
  // notifies subscribers. Wiring first would drop that one notification on the floor and
  // the Publish button would show a fresh "Publish" until the next state change.
  useEffect(() => {
    const eventGroup = {};

    WarningsModel.instance.on('warningsChanged', () => triggerRerender(), eventGroup);

    EventDispatcher.instance.on(
      'publish-state-changed',
      (snapshot: PublishSnapshot) => setPublishSnap(snapshot),
      eventGroup
    );
    EventDispatcher.instance.on(
      'ai-activity-changed',
      (snapshot: AiActivitySnapshot) => setAiSnap(snapshot),
      eventGroup
    );

    wirePublishState();

    return () => {
      WarningsModel.instance.off(eventGroup);
      EventDispatcher.instance.off(eventGroup);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2026-08-12 perf audit: a `glowIntensity` state was advanced by a 60ms interval —
  // ~17 re-renders per second of the always-mounted topbar, forever — and the value was
  // never read anywhere in this file. Deleted outright rather than throttled: there is
  // no glow to animate.

  /**
   * The single place a topbar command is executed. The pill's typed commands and the
   * keyboard shortcuts both funnel through here, so a command can never mean two
   * different things depending on how it was invoked.
   */
  const runTopbarCommand = useCallback(
    (match: TopbarMatch) => {
      if (match.kind !== 'command') return;
      switch (match.id) {
        case 'preset': {
          // `screenSizesWithDividers` mixes preset objects with the literal 'divider'.
          // First match by group is the largest preset in that group (list order).
          const preset = screenSizesWithDividers.find(
            (entry): entry is ScreenSize => typeof entry !== 'string' && entry.group === match.group
          );
          if (preset) onPreviewSizeChanged(preset.width, preset.height, preset.name);
          break;
        }
        case 'fit':
          onPreviewSizeChanged(null, null, null);
          break;
        case 'size':
          onPreviewSizeChanged(match.width, match.height, 'Custom');
          break;
        case 'zoom':
          setZoomFactor(match.factor);
          break;
        case 'split':
          setDocumentLayout(match.direction);
          break;
        case 'detach':
          setDocumentLayout('detachedPreview');
          ipcRenderer.send('viewer-focus');
          break;
        case 'devtools':
          EventDispatcher.instance.emit('viewer-open-devtools');
          break;
        case 'import':
          setIsFigmaDialogVisible(true);
          break;
        case 'publish':
          // Same gate as the Publish button and the ⌘⏎ binding. Lessons cannot deploy.
          if (!deployIsDisabled) setIsDeployVisible(true);
          break;
        case 'refresh':
          EventDispatcher.instance.emit('viewer-refresh');
          break;
      }
    },
    [onPreviewSizeChanged, setZoomFactor, setDocumentLayout, deployIsDisabled]
  );

  useKeyboardCommands(
    () => [
      { keybinding: Keybindings.FOCUS_TOPBAR.hash, handler: () => pillFocusRef.current?.() },
      {
        keybinding: Keybindings.PREVIEW_PRESET_PHONE.hash,
        handler: () => runTopbarCommand({ kind: 'command', id: 'preset', group: 'Mobile', label: '' })
      },
      {
        keybinding: Keybindings.PREVIEW_PRESET_TABLET.hash,
        handler: () => runTopbarCommand({ kind: 'command', id: 'preset', group: 'Tablet', label: '' })
      },
      {
        keybinding: Keybindings.PREVIEW_PRESET_DESKTOP.hash,
        handler: () => runTopbarCommand({ kind: 'command', id: 'preset', group: 'Desktop', label: '' })
      },
      { keybinding: Keybindings.PREVIEW_FIT.hash, handler: () => runTopbarCommand({ kind: 'command', id: 'fit', label: '' }) },
      {
        keybinding: Keybindings.DETACH_PREVIEW.hash,
        handler: () => runTopbarCommand({ kind: 'command', id: 'detach', label: '' })
      },
      {
        keybinding: Keybindings.PUBLISH.hash,
        handler: () => {
          if (!deployIsDisabled) setIsDeployVisible(true);
        }
      }
    ],
    [runTopbarCommand, deployIsDisabled]
  );

  const navigateToRoute = useCallback(
    (path: string) => {
      // Query parameters belong to the page that set them. The old route dropdown
      // called onRouteChanged(url) verbatim for exactly this reason; only the
      // free-text field preserved the query, and only because the user was editing
      // the current URL in place. Carrying it across pages produced
      // `/#/game?level=3` -> `/#/menu?level=3`.
      if (path.includes('?')) {
        onRouteChanged(path);
        return;
      }
      const current = navigationState.route || '';
      const [currentPath, query] = current.split('?');
      // Same page, no query typed: keep what is already there rather than dropping it.
      onRouteChanged(query && currentPath === path ? `${path}?${query}` : path);
    },
    [navigationState.route, onRouteChanged]
  );

  const showWarnings = useCallback(() => setIsWarningsDialogVisible(true), []);
  const openDeploy = useCallback(() => setIsDeployVisible(true), []);
  const openImport = useCallback(() => setIsFigmaDialogVisible(true), []);

  // A fresh object literal here would re-run the pill's hold-expiry effect on every
  // render of the most-rendered component in the editor.
  const publishForPill = useMemo(
    () => ({
      phase: publishSnap.phase,
      label: publishSnap.label,
      url: publishSnap.url,
      changedAt: publishSnap.changedAt,
      error: publishSnap.error
    }),
    [publishSnap.phase, publishSnap.label, publishSnap.url, publishSnap.changedAt, publishSnap.error]
  );

  return (
    <div className={css.Root}>
      <div className={css.Left}>
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

      <div className={css.Center}>
        <StatusPill
          route={navigationState.route || '/'}
          routeInfos={routeInfos}
          warnings={instance.warningsAmount}
          onNavigate={navigateToRoute}
          onCommand={runTopbarCommand}
          onShowWarnings={showWarnings}
          focusRef={pillFocusRef}
          anchorRef={pillAnchorRef}
          ai={aiSnap}
          publish={publishForPill}
        />
      </div>

      <div className={css.Right}>
        <FrameChip
          previewSize={previewSize}
          zoomFactor={zoomFactor}
          onPreviewSizeChanged={onPreviewSizeChanged}
          setZoomFactor={setZoomFactor}
        />
        <ModeSegment previewMode={previewMode} onChange={onPreviewModeChanged} />
        <OverflowMenu
          documentLayout={documentLayout}
          setDocumentLayout={setDocumentLayout}
          onImport={openImport}
          anchorRef={figmaButtonRef}
        />
        <PublishButton
          snapshot={publishSnap}
          onOpenDeploy={openDeploy}
          anchorRef={deployButtonRef}
          isDisabled={deployIsDisabled}
        />
      </div>

      <DeployPopup isVisible={isDeployVisible} onClose={() => setIsDeployVisible(false)} triggerRef={deployButtonRef} />

      <FigmaImportDialog
        isVisible={isFigmaDialogVisible}
        onClose={() => setIsFigmaDialogVisible(false)}
        triggerRef={figmaButtonRef}
      />

      <MenuDialog
        title="Warnings"
        isVisible={isWarningsDialogVisible}
        onClose={() => setIsWarningsDialogVisible(false)}
        triggerRef={pillAnchorRef}
        items={[...returnWarningItems(instance.allWarnings, nodeGraph)]}
        width={MenuDialogWidth.Large}
      />
    </div>
  );
}
