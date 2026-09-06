import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { TopbarPinned } from '../SidePanel/SidebarIcons';
import { PanelHost } from './PanelHost';
import {
  clampPanelWidth, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, readPanelWidth, writePanelWidth
} from './panelWidth';
import css from './LeftPanelCard.module.scss';

const storage = typeof window !== 'undefined' ? window.localStorage : null;

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

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: width };
    setIsResizing(true);
    const onMove = (ev: MouseEvent) => {
      if (!drag.current) return;
      setWidth(clampPanelWidth(drag.current.startWidth + (ev.clientX - drag.current.startX)));
    };
    const onUp = (ev: MouseEvent) => {
      if (drag.current) commit(drag.current.startWidth + (ev.clientX - drag.current.startX));
      drag.current = null;
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
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
  if (!layout.open) return null;
  return (
    <PanelCard panelId={layout.dockedId} mode="docked" onClose={() => SidebarModel.instance.dispatch({ type: 'close' })} />
  );
}
