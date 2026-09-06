import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { TopbarPinned } from '../SidePanel/SidebarIcons';
import { PanelHost } from './PanelHost';
import {
  clampPanelWidth, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, readPanelWidth, writePanelWidth
} from './panelWidth';
import css from './LeftPanelCard.module.scss';

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Some contexts (locked-down webviews, certain privacy modes) throw on the accessor
    // itself rather than on a call — readPanelWidth/writePanelWidth already tolerate a
    // null storage, so failing closed here removes the whole class of module-load crashes.
    return null;
  }
}

const storage = getStorage();

function usePanelWidth(panelId: string | null) {
  const item = panelId ? SidebarModel.instance.getPanel(panelId) : null;
  const fallback = item?.defaultWidth ?? PANEL_WIDTH_DEFAULT;
  const [width, setWidth] = useState(() => (panelId ? readPanelWidth(storage, panelId, fallback) : fallback));
  useEffect(() => {
    if (panelId) setWidth(readPanelWidth(storage, panelId, fallback));
  }, [panelId, fallback]);
  const commit = useCallback(
    (w: number) => {
      const c = clampPanelWidth(w);
      setWidth(c);
      if (panelId) writePanelWidth(storage, panelId, c);
    },
    [panelId]
  );
  return { width, setWidth, commit, fallback };
}

interface CardProps {
  panelId: string;
  mode: 'docked' | 'peek';
  onClose: () => void;
  onPin?: () => void;
}

export function PanelCard({ panelId, mode, onClose, onPin }: CardProps) {
  const item = SidebarModel.instance.getPanel(panelId);
  const { width, setWidth, commit, fallback } = usePanelWidth(panelId);
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
    el.prepend(sentinel);
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { root: el });
    io.observe(sentinel);
    return () => { io.disconnect(); sentinel.remove(); };
  }, []);

  // Listeners live on window (not the handle) so the drag survives the pointer leaving the
  // 8px strip, and live in an effect gated on `isResizing` — not attached imperatively inside
  // the mousedown handler — so React's cleanup removes them if the card unmounts mid-drag
  // (e.g. a later task's Escape-closes-peek) instead of leaving them to fire stale closures.
  // Mirrors RightPropertyPanel.tsx's resize effect.
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (ev: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      setWidth(clampPanelWidth(d.startWidth + (ev.clientX - d.startX)));
    };
    const onUp = (ev: MouseEvent) => {
      const d = drag.current;
      drag.current = null;
      setIsResizing(false);
      if (d) commit(d.startWidth + (ev.clientX - d.startX));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing, commit]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    setIsResizing(true);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowRight') commit(width + step);
    else if (e.key === 'ArrowLeft') commit(width - step);
    else if (e.key === 'Home') commit(PANEL_WIDTH_MIN);
    else if (e.key === 'End') commit(PANEL_WIDTH_MAX);
    else return;
    e.preventDefault();
  };

  const HeaderAction = item?.headerAction;
  const chromeless = !!item?.chromeless;

  return (
    <div
      className={classNames(css.Card, mode === 'peek' && css['is-peek'], isResizing && css['is-resizing'])}
      style={{ width }}
      data-test={`left-card-${mode}`}
      data-panel-id={panelId}
    >
      <div className={classNames(css.Header, chromeless && css['is-chromeless'], scrolled && css['is-scrolled'])}>
        {!chromeless && <span className={css.Title}>{item?.name}</span>}
        <span className={css.Grow} />
        {!chromeless && HeaderAction && <HeaderAction />}
        {mode === 'peek' && onPin && (
          <Tooltip content="Pin panel" renderDirection={DialogRenderDirection.Below}>
            <IconButton icon={TopbarPinned} variant={IconButtonVariant.Transparent} onClick={onPin} />
          </Tooltip>
        )}
        <Tooltip content="Close panel" renderDirection={DialogRenderDirection.Below}>
          <IconButton icon={IconName.Close} variant={IconButtonVariant.Transparent} onClick={onClose} />
        </Tooltip>
      </div>
      <div ref={scrollRef} className={css.Content}>
        <PanelHost visibleId={panelId} keepMounted={mode === 'docked'} />
      </div>
      <div
        className={css.ResizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH_MIN}
        aria-valuemax={PANEL_WIDTH_MAX}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={onHandleKeyDown}
        onDoubleClick={() => commit(fallback)}
        title="Drag to resize — double-click to reset"
      />
    </div>
  );
}

export function LeftPanelCard() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.layoutChanged]);
  const layout = sidebar.Layout;
  const peekRef = useRef<HTMLDivElement>(null);
  const [originY, setOriginY] = useState(60);

  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-origin-y', (y: number) => setOriginY(y), group);
    return () => EventDispatcher.instance.off(group);
  }, []);

  // Esc and click-away close a peek. The rail is excluded so a second rail click reaches
  // the reducer (which treats "click the peeked id" as close, and "click another" as switch).
  useEffect(() => {
    if (!layout.peekId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); SidebarModel.instance.dispatch({ type: 'esc' }); }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t) return;
      if (peekRef.current?.contains(t)) return;
      if (t.closest('[data-test="rail"]')) return;
      if (t.closest('[role="dialog"], [data-glass-popover]')) return; // popovers spawned from the peek
      SidebarModel.instance.dispatch({ type: 'esc' });
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [layout.peekId]);

  if (!layout.open) return null;

  return (
    <>
      <div className={classNames(css.Docked, layout.peekId && css['is-under'])}>
        <PanelCard panelId={layout.dockedId} mode="docked" onClose={() => SidebarModel.instance.dispatch({ type: 'close' })} />
      </div>
      {layout.peekId && (
        <div ref={peekRef} className={css.PeekLayer} style={{ ['--origin-y' as any]: `${originY}px` }}>
          <PanelCard
            key={layout.peekId}
            panelId={layout.peekId}
            mode="peek"
            onClose={() => SidebarModel.instance.dispatch({ type: 'esc' })}
            onPin={() => SidebarModel.instance.pin()}
          />
        </div>
      )}
    </>
  );
}
