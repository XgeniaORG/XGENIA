import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { PanelHost } from './PanelHost';
import {
  clampPanelWidth, maxPanelWidth, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MIN, readPanelWidth, snapPanelWidth, writePanelWidth
} from './panelWidth';
import css from './LeftPanelCard.module.scss';

// Matches --rail-width in styles/custom-properties/glass.css. The card's available width
// is the window minus this strip; panelWidth.ts stays free of any window/DOM read, so the
// subtraction happens here rather than inside it.
const RAIL_WIDTH = 48;

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

/** The real ceiling for this render: nearly the full window, minus the rail and a sliver
 *  of canvas — see panelWidth.ts's `maxPanelWidth`. Computed fresh (not memoized) so a
 *  window resize is picked up the next time anything here re-renders. */
function currentMaxWidth(): number {
  return maxPanelWidth(typeof window !== 'undefined' ? window.innerWidth - RAIL_WIDTH : undefined);
}

function usePanelWidth(panelId: string | null, max: number) {
  const item = panelId ? SidebarModel.instance.getPanel(panelId) : null;
  const fallback = item?.defaultWidth ?? PANEL_WIDTH_DEFAULT;
  const [width, setWidth] = useState(() => (panelId ? readPanelWidth(storage, panelId, fallback, max) : fallback));
  useEffect(() => {
    if (panelId) setWidth(readPanelWidth(storage, panelId, fallback, max));
  }, [panelId, fallback, max]);
  const commit = useCallback(
    (w: number) => {
      const c = clampPanelWidth(w, max);
      setWidth(c);
      if (panelId) writePanelWidth(storage, panelId, c, max);
    },
    [panelId, max]
  );
  return { width, setWidth, commit, fallback };
}

interface CardProps {
  panelId: string;
  /** The card is closed: hidden, but still mounted, so the panels inside keep their state. */
  isHidden: boolean;
}

export function PanelCard({ panelId, isHidden }: CardProps) {
  const maxWidth = currentMaxWidth();
  const { width, setWidth, commit, fallback } = usePanelWidth(panelId, maxWidth);
  const [isResizing, setIsResizing] = useState(false);
  const drag = useRef<{ startX: number; startWidth: number; max: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  // The raw (unsnapped, but clamped) width while a drag is live — kept in a ref, not just
  // state, so pointercancel/blur (which carry no usable clientX of their own) can still
  // commit the last width the user actually saw instead of either freezing or reverting.
  const liveWidthRef = useRef(width);

  // Live width readout while dragging the edge. `chip` holds the last live value shown
  // during (and briefly after) a drag; the fade-out timer lives in a ref — not local to the
  // resize effect below — so an unmount mid-drag can still clear it in the dedicated cleanup
  // effect instead of letting a detached setTimeout fire setState on an unmounted component.
  const [chip, setChip] = useState<number | null>(null);
  const chipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (chipTimer.current) clearTimeout(chipTimer.current);
    };
  }, []);

  // Pointer events with capture, mirroring the rail's press-and-hold reorder gesture in
  // Rail.tsx: a plain mousemove/mouseup pair loses the drag the instant a fast movement
  // crosses the preview `<webview>`, which swallows mouse events wholesale. Capturing the
  // pointer on the handle keeps every subsequent event routed here regardless of what the
  // cursor passes over, and the gesture ends cleanly on pointerup, pointercancel or the
  // window losing focus — none of which the old mouse-based drag handled at all.
  useEffect(() => {
    if (!isResizing) return;
    const pointerId = pointerIdRef.current;
    const handle = handleRef.current;

    const onMove = (ev: PointerEvent) => {
      if (pointerId !== null && ev.pointerId !== pointerId) return;
      const d = drag.current;
      if (!d) return;
      const raw = clampPanelWidth(d.startWidth + (ev.clientX - d.startX), d.max);
      liveWidthRef.current = raw;
      setWidth(raw);
      // The live width, not a snapped one — snapping only happens once, on release (see
      // endResize below), so the edge tracks the pointer exactly instead of fighting it.
      setChip(raw);
    };

    const endResize = () => {
      const d = drag.current;
      drag.current = null;
      setIsResizing(false);
      if (d) commit(snapPanelWidth(liveWidthRef.current));
      if (chipTimer.current) clearTimeout(chipTimer.current);
      chipTimer.current = setTimeout(() => {
        chipTimer.current = null;
        setChip(null);
      }, 600);
      if (pointerId !== null && handle?.hasPointerCapture?.(pointerId)) {
        try { handle.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      pointerIdRef.current = null;
    };

    const onUp = (ev: PointerEvent) => { if (pointerId === null || ev.pointerId === pointerId) endResize(); };
    const onCancel = (ev: PointerEvent) => { if (pointerId === null || ev.pointerId === pointerId) endResize(); };
    // `blur` carries no pointerId — the window losing focus mid-drag ends whatever gesture
    // this effect instance owns regardless of which pointer started it.
    const onBlur = () => endResize();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
    };
  }, [isResizing, commit]);

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Abandon exactly as the rail's reorder gesture does on the same failure: no drag
      // ever started, so there is nothing to undo, only ownership to release (nothing was
      // ever captured, so nothing further is needed here).
      return;
    }
    pointerIdRef.current = e.pointerId;
    liveWidthRef.current = width;
    drag.current = { startX: e.clientX, startWidth: width, max: maxWidth };
    setIsResizing(true);
  };

  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowRight') commit(width + step);
    else if (e.key === 'ArrowLeft') commit(width - step);
    else if (e.key === 'Home') commit(PANEL_WIDTH_MIN);
    else if (e.key === 'End') commit(maxWidth);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={classNames(css.Card, isResizing && css['is-resizing'])}
      style={{ width, display: isHidden ? 'none' : undefined }}
      data-test="left-card"
      data-panel-id={panelId}
    >
      <div className={css.Content}>
        <PanelHost visibleId={isHidden ? null : panelId} />
      </div>
      <div
        ref={handleRef}
        className={css.ResizeHandle}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        aria-valuenow={width}
        aria-valuemin={PANEL_WIDTH_MIN}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={onHandleKeyDown}
        onDoubleClick={() => commit(fallback)}
        title="Drag to resize — double-click to reset"
      />
      {chip !== null && <div className={css.WidthChip} aria-hidden="true">{chip}</div>}
    </div>
  );
}

/** True for an editable element (a text field, or anything with contenteditable) and for
 *  anything inside a menu/popover — a `[data-glass-popover]` (GlassPopover, e.g. the
 *  project menu) or a `role="menu"`/`role="dialog"`/`role="listbox"` container. Escape
 *  reaching the card while either is true means some inner control wants the key for
 *  itself; the card's own go-home behaviour must stay out of the way. */
function wantsOwnEscape(target: Element | null): boolean {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((target as HTMLElement).isContentEditable) return true;
  return !!target.closest('[data-glass-popover], [role="menu"], [role="dialog"], [role="listbox"]');
}

export function LeftPanelCard() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.layoutChanged]);
  const layout = sidebar.Layout;

  // Escape returns home, but only when it originates inside the card (via `data-test`, so
  // no extra wrapper element is needed around the card itself), and only when the card
  // isn't already showing home — the canvas uses Escape too, and this must not swallow it
  // once there is nowhere further home to go.
  //
  // This listens on the window's BUBBLE phase, not the capture phase, and never calls
  // `stopPropagation`. A capture-phase listener runs before the event even reaches its
  // target, so calling `stopPropagation` there — as this used to — killed the event before
  // any input, menu or panel-local Escape handler ever saw it (an in-progress asset rename
  // would never see its own cancel, and `onBlur={commitRename}` would then commit it
  // instead). Listening on the bubble phase means every inner handler runs first; this is
  // the last stop, and only acts when nothing closer to the key wanted it.
  useEffect(() => {
    if (!layout.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      const t = e.target as Element | null;
      if (wantsOwnEscape(t)) return;
      if (!t?.closest('[data-test="left-card"]')) return;
      if (layout.activeId === layout.homeId) return;
      SidebarModel.instance.goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout.open, layout.activeId, layout.homeId]);

  // Closing the card hides it; it is never unmounted. PanelHost's whole contract is that
  // opened panels stay mounted so switching back is instant and keeps their state — and the
  // chat and image editor are remote iframes, so re-mounting them re-boots a whole
  // application, with its loading screen on show. Returning null here threw that guarantee
  // away one layer above the code that makes it, and the topbar button and its keybinding
  // toggle this constantly. Passing `null` for the visible id while closed also tells every
  // panel it is off screen, so the expensive ones idle exactly as they do when hidden behind
  // another panel.
  //
  // Closing is still reachable: ⌘B (toggleCard) and clicking the active panel's own rail
  // icon (SidebarModel's `click` reducer case). The card itself carries no close button —
  // see the header removal above.
  return <PanelCard panelId={layout.activeId} isHidden={!layout.open} />;
}
