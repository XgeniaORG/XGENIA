import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { IconName } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

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
  /** The card is closed: hidden, but still mounted, so the panels inside keep their state. */
  isHidden: boolean;
  onClose: () => void;
}

export function PanelCard({ panelId, isHidden, onClose }: CardProps) {
  const item = SidebarModel.instance.getPanel(panelId);
  const { width, setWidth, commit, fallback } = usePanelWidth(panelId);
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  // Skipped while the card is hidden: a `display: none` subtree has an empty rect, so the
  // observer would report the sentinel as off screen and leave the scrolled-state shadow
  // under the header, showing for a frame the next time the card opens.
  useEffect(() => {
    if (isHidden) return;
    const el = scrollRef.current;
    if (!el) return;
    const sentinel = document.createElement('div');
    sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
    el.prepend(sentinel);
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { root: el });
    io.observe(sentinel);
    return () => { io.disconnect(); sentinel.remove(); };
  }, [isHidden]);

  // Listeners live on window (not the handle) so the drag survives the pointer leaving the
  // 8px strip, and live in an effect gated on `isResizing` — not attached imperatively inside
  // the mousedown handler — so React's cleanup removes them if the card unmounts mid-drag
  // instead of leaving them to fire stale closures. Mirrors RightPropertyPanel.tsx's resize
  // effect.
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
      className={classNames(css.Card, isResizing && css['is-resizing'])}
      style={{ width, display: isHidden ? 'none' : undefined }}
      data-test="left-card"
      data-panel-id={panelId}
    >
      <div className={classNames(css.Header, chromeless && css['is-chromeless'], scrolled && css['is-scrolled'])}>
        {!chromeless && <span className={css.Title}>{item?.name}</span>}
        <span className={css.Grow} />
        {!chromeless && HeaderAction && <HeaderAction />}
        <Tooltip content="Close panel" renderDirection={DialogRenderDirection.Below}>
          <IconButton icon={IconName.Close} variant={IconButtonVariant.Transparent} onClick={onClose} />
        </Tooltip>
      </div>
      <div ref={scrollRef} className={css.Content}>
        <PanelHost visibleId={isHidden ? null : panelId} />
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

  // Escape returns home, but only when it originates inside the card (via `data-test`, so
  // no extra wrapper element is needed around the card itself), and only when the card
  // isn't already showing home — the canvas uses Escape too, and this must not swallow it
  // once there is nowhere further home to go.
  useEffect(() => {
    if (!layout.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as Element | null;
      if (!t?.closest('[data-test="left-card"]')) return;
      if (layout.activeId === layout.homeId) return;
      e.stopPropagation();
      SidebarModel.instance.goHome();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [layout.open, layout.activeId, layout.homeId]);

  // Closing the card hides it; it is never unmounted. PanelHost's whole contract is that
  // opened panels stay mounted so switching back is instant and keeps their state — and the
  // chat and image editor are remote iframes, so re-mounting them re-boots a whole
  // application, with its loading screen on show. Returning null here threw that guarantee
  // away one layer above the code that makes it, and the topbar button and its keybinding
  // toggle this constantly. Passing `null` for the visible id while closed also tells every
  // panel it is off screen, so the expensive ones idle exactly as they do when hidden behind
  // another panel.
  return (
    <PanelCard
      panelId={layout.activeId}
      isHidden={!layout.open}
      onClose={() => SidebarModel.instance.dispatch({ type: 'close' })}
    />
  );
}
