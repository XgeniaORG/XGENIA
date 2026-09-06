import classNames from 'classnames';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { RailPresence } from '@xgenia-models/railpresence';
import { GitStatus } from '@xgenia-models/gitstatus';
import { AiActivity, AiActivitySnapshot } from '@xgenia-models/aiactivity';

import { Keybindings } from '../../constants/Keybindings';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { ToastLayer } from '../ToastLayer';
import { importFiles } from '../panels/AssetPanel/assetOps';
import { IdentityChip } from './IdentityChip';
import { RailButton, RailButtonProps } from './RailButton';
import { activePanelId } from './railLayout';
import { badgeFor, tooltipSuffixFor } from './railBadges';
import { arrangeRail, railCapacity, RAIL_SLOT } from './railOrder';
import { useTooltipGroup } from './useTooltipGroup';
import css from './Rail.module.scss';

type PresenceState = Record<string, { unseen: number; lastAt: number }>;

/** A press-and-hold reorder in progress. `from`/`to` are indices into the visible top
 *  cluster (`arrangement.top`) — the only items a hold can reach. `y` is the live pointer
 *  offset from the press-down point, driving the dragged item's transform directly. */
interface RailDragState {
  id: string;
  from: number;
  to: number;
  y: number;
}

/**
 * The chat item's tooltip carries a live "· AI working · 14s" suffix while a turn runs.
 * That elapsed text needs a per-second tick to stay accurate, but ticking state in Rail
 * itself would re-render the sliding indicator, every other button and the tooltip group
 * once a second for the whole time the AI works. Isolating the tick in this small wrapper
 * means only this one button's subtree re-renders — the badge (the ring) is still composed
 * once by badgeFor and passed straight through untouched.
 */
function ChatRailButton(props: RailButtonProps & { ai: AiActivitySnapshot; aiSince: React.MutableRefObject<number | null> }) {
  const { ai, aiSince, ...rest } = props;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!ai.active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [ai.active]);
  const tooltipSuffix = ai.active
    ? `· ${ai.label || 'working'} · ${Math.round((Date.now() - (aiSince.current ?? Date.now())) / 1000)}s`
    : undefined;
  return <RailButton {...rest} tooltipSuffix={tooltipSuffix} />;
}

export function Rail() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.itemsChanged, SidebarModelEvent.layoutChanged]);
  const items = sidebar.getVisibleItems();
  const layout = sidebar.Layout;
  const active = layout.open ? activePanelId(layout) : null;
  const tips = useTooltipGroup();

  // Presence (Task 13): which panel's domain the AI just touched.
  const [presence, setPresence] = useState<PresenceState>(RailPresence.getSnapshot);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-presence-changed', (s: PresenceState) => setPresence(s), group);
    return () => EventDispatcher.instance.off(group);
  }, []);
  // Opening a panel clears its own dot. Closed/inactive panels keep theirs.
  useEffect(() => {
    if (layout.open) RailPresence.markSeen(activePanelId(layout));
  }, [layout.open, layout.activeId]);

  // Git status (Task 14): uncommitted file count for the Version control badge.
  const [git, setGit] = useState(GitStatus.getSnapshot);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('git-status-changed', (s: { count: number | null }) => setGit(s), group);
    return () => EventDispatcher.instance.off(group);
  }, []);

  // AI activity (Task 15): drives the chat item's ring. `aiSince` is a ref, not state — it
  // only feeds ChatRailButton's own per-second tick and must never itself cause a re-render.
  const [ai, setAi] = useState(AiActivity.getSnapshot);
  const aiSince = useRef<number | null>(null);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('ai-activity-changed', (s: AiActivitySnapshot) => {
      if (s.active && !aiSince.current) aiSince.current = Date.now();
      if (!s.active) aiSince.current = null;
      setAi(s);
    }, group);
    return () => EventDispatcher.instance.off(group);
  }, []);

  // Task 17: dropping files from Finder onto the rail. `dropMode` is entered from a
  // window-level dragenter that actually carries files (a plain in-editor node drag has no
  // 'Files' type on the DataTransfer, so it never trips this) and only when the Assets
  // panel — experimental, togglable in settings — is currently registered: with it switched
  // off there is no target to land a drop on, so the whole rail must stay inert rather than
  // dimming every button with nothing highlighted. Depth is counted because dragenter/
  // dragleave fire per element as the pointer crosses child boundaries while it moves around
  // inside the window, not once for the window as a whole — a plain boolean would drop out
  // of drop mode the instant the pointer crossed into a child and flicker for the rest of
  // the drag. drop/dragend both hard-reset the counter so a drop, or the drag being
  // abandoned outside the window, can never leave the rail dimmed forever.
  const [dropMode, setDropMode] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || !SidebarModel.instance.getPanel('assets')) return;
      depth += 1;
      setDropMode(true);
    };
    const onLeave = () => {
      if (depth === 0) return;
      depth -= 1;
      if (depth === 0) setDropMode(false);
    };
    const onDrop = () => {
      depth = 0;
      setDropMode(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', onDrop);
    };
  }, []);

  const onDropAssets = async (files: FileList) => {
    // Re-check at drop time too: the panel could in principle be switched off in the
    // (small) window between dragenter and drop. Fails closed rather than throwing.
    if (!SidebarModel.instance.getPanel('assets')) return;
    try {
      await importFiles(files, 'assets');
      EventDispatcher.instance.emit('project-assets-changed', { path: 'assets' });
      // `switch`, not the removed `peek` — this design shows one panel at a time, and
      // `switch` is the "ensure this panel is visible" call every other rail-adjacent
      // caller already uses.
      SidebarModel.instance.switch('assets');
    } catch (error: any) {
      console.error('[Rail] import failed', error);
      ToastLayer.showError(`Import failed: ${error?.message || error}`);
    }
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    setHeight(el.getBoundingClientRect().height);
    return () => ro.disconnect();
  }, []);

  const bottomCount = items.filter((i) => i.placement === 'bottom').length;
  const capacity = height ? railCapacity(height, bottomCount) : 99;
  const arrangement = useMemo(
    () => arrangeRail(items, sidebar.getUserOrder(), capacity),
    [items, capacity, sidebar]
  );

  // Sliding indicator: index of the active item within the rendered top cluster.
  const activeTopIndex = arrangement.top.findIndex((i) => i.id === active);
  const indicatorY = activeTopIndex >= 0 ? activeTopIndex * RAIL_SLOT + 7 : null;

  // ⌘⌥ held for 250ms reveals the shortcut digits on the top cluster; released, or the
  // window loses focus mid-hold, hides them immediately so nothing is left stuck on screen.
  const [showDigits, setShowDigits] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (timer) clearTimeout(timer); timer = null; setShowDigits(false); };
    const onDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && !timer) timer = setTimeout(() => setShowDigits(true), 250);
    };
    const onUp = (e: KeyboardEvent) => { if (!(e.metaKey || e.ctrlKey) || !e.altKey) clear(); };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); window.removeEventListener('blur', clear); clear(); };
  }, []);

  // ⌘⌥1-9 opens the nth item of the top cluster. EditorPage owns the keybinding and emits
  // the zero-based index; read the live arrangement through a ref so this listener (attached
  // once) never dispatches against a stale top cluster.
  const topRef = useRef(arrangement.top);
  topRef.current = arrangement.top;
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on('rail-shortcut', (i: number) => {
      const item = topRef.current[i];
      if (item) SidebarModel.instance.dispatch({ type: 'click', id: item.id });
    }, group);
    return () => EventDispatcher.instance.off(group);
  }, []);

  // Task 18: press-and-hold to reorder the top cluster. The FULL top-cluster order (visible
  // + whatever Task 19 has folded into overflow), kept for persisting a reorder without
  // dropping a currently-hidden panel's place in the list — see persistReorder below.
  const topAllRef = useRef([...arrangement.top, ...arrangement.overflow]);
  topAllRef.current = [...arrangement.top, ...arrangement.overflow];

  // `dragRef` is the single source of truth read by the pointermove/pointerup listeners
  // below — those closures are created once, when the pointer goes down, and never see a
  // later React re-render, so a state variable read inside them would be frozen at
  // whatever it was at press time and the drag would stop tracking the pointer after the
  // very first move. `drag` (state) exists only so the render below can show the lift.
  const dragRef = useRef<RailDragState | null>(null);
  const [drag, setDrag] = useState<RailDragState | null>(null);
  const applyDrag = (next: RailDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set the instant a hold graduates into a drag and read by the click handler below so a
  // click that follows a completed hold never also switches panels. A ref, not state, for
  // the same reason as `dragRef`: it must be readable synchronously the moment `click`
  // fires, without waiting on a re-render that may not have landed yet.
  const justDraggedRef = useRef(false);

  // Persist a reorder by id, not by raw index, against the full top-cluster order (visible
  // + overflow) rather than the visible slice alone — a panel currently folded into the ⋯
  // menu is never `from`/`to` (a hold can't reach it) but must not be silently dropped from
  // what gets written to EditorSettings either. Rebuilding `full` from the live top-cluster
  // items on every call also means any id `setUserOrder` previously stored for a panel that
  // no longer exists (an experimental panel switched off, say) is dropped here for free —
  // arrangeRail already tolerates a stale id on read, this keeps what gets written sane too.
  const persistReorder = (from: number, to: number) => {
    const visible = topRef.current;
    const movedId = visible[from]?.id;
    const targetId = visible[to]?.id;
    if (!movedId || !targetId || movedId === targetId) return;
    const full = topAllRef.current.map((i) => i.id);
    const fromFull = full.indexOf(movedId);
    if (fromFull === -1) return;
    full.splice(fromFull, 1);
    let toFull = full.indexOf(targetId);
    if (toFull === -1) toFull = full.length;
    else if (to > from) toFull += 1; // moving down: land after the item it displaced
    full.splice(toFull, 0, movedId);
    SidebarModel.instance.setUserOrder(full);
  };

  const onItemPointerDown = (id: string, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    justDraggedRef.current = false;
    const startY = e.clientY;
    const target = e.currentTarget;
    const pointerId = e.pointerId;

    const onMove = (ev: PointerEvent) => {
      // A move past a small threshold before the hold has fired reads as a scroll-ish
      // gesture, not a hold: cancel the pending timer so it never turns into a drag.
      if (holdTimer.current && Math.abs(ev.clientY - startY) > 4) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      const current = dragRef.current;
      if (!current) return;
      const dy = ev.clientY - startY;
      const to = Math.max(0, Math.min(topRef.current.length - 1, current.from + Math.round(dy / RAIL_SLOT)));
      applyDrag({ ...current, y: dy, to });
    };

    // Every way a drag can end funnels through here: a normal release (commit), the
    // pointer being cancelled by the platform, or the window losing focus mid-hold —
    // either of the latter two must abandon the reorder rather than apply a half-formed
    // one, and all three must equally release the pointer capture and the listeners so
    // nothing is left lifted or leaking.
    const endDrag = (commit: boolean) => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      const finished = dragRef.current;
      if (finished) {
        justDraggedRef.current = true;
        if (commit && finished.from !== finished.to) persistReorder(finished.from, finished.to);
      }
      applyDrag(null);
      if (target.hasPointerCapture?.(pointerId)) {
        try { target.releasePointerCapture(pointerId); } catch { /* already released */ }
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
    };
    const onUp = () => endDrag(true);
    const onCancel = () => endDrag(false);

    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      target.setPointerCapture(pointerId);
      applyDrag({ id, from: index, to: index, y: 0 });
    }, 400);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
  };

  // Render-time only: `drag` (state, always fresh during a render) is fine to read here,
  // unlike inside the listeners above.
  const shiftFor = (index: number): string => {
    if (!drag || index === drag.from) return 'none';
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return `translateY(-${RAIL_SLOT}px)`;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return `translateY(${RAIL_SLOT}px)`;
    return 'none';
  };

  return (
    <div
      ref={rootRef}
      className={css.Root}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Panels"
      data-test="rail"
    >
      <IdentityChip />

      <div className={css.Top}>
        {indicatorY !== null && <span className={css.Indicator} style={{ transform: `translateY(${indicatorY}px)` }} aria-hidden="true" />}
        {arrangement.top.map((item, index) => {
          const isLifted = drag?.id === item.id;
          const common = {
            id: item.id,
            name: item.name,
            icon: item.icon as React.ElementType,
            fineType: item.fineType ?? (index < 9 ? Keybindings.RAIL_ITEMS[index].label : undefined),
            digit: showDigits ? index + 1 : undefined,
            isActive: item.id === active,
            isDisabled: item.isDisabled,
            showAfterMs: tips.showAfterMs,
            onTooltipClosed: tips.noteClosed,
            isDropTarget: dropMode && item.id === 'assets',
            isDropDimmed: dropMode && item.id !== 'assets',
            onDrop: item.id === 'assets' ? onDropAssets : undefined,
            onPointerDownCapture: onItemPointerDown(item.id, index),
            onClick: () => {
              // A completed hold must not also switch panels — justDraggedRef is set the
              // instant that hold's pointerup/cancel/blur lands, synchronously, so this is
              // never stale even if the re-render from setDrag(null) hasn't landed yet.
              if (justDraggedRef.current) {
                justDraggedRef.current = false;
                return;
              }
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }
          };
          const button = item.id === 'chat-panel'
            ? <ChatRailButton {...common} badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai })} ai={ai} aiSince={aiSince} />
            : (
              <RailButton
                {...common}
                badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai })}
                tooltipSuffix={tooltipSuffixFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count })}
              />
            );
          return (
            <div
              key={item.id}
              className={classNames(css.DragSlot, isLifted && css['is-lifting'])}
              style={isLifted ? { transform: `translateY(${drag!.y}px) scale(1.06)`, zIndex: 2 } : { transform: shiftFor(index) }}
            >
              {button}
            </div>
          );
        })}
      </div>

      <div className={css.Bottom}>
        {arrangement.bottom.map((item) => (
          <RailButton
            key={item.id}
            id={item.id}
            name={item.name}
            icon={item.icon as React.ElementType}
            fineType={item.fineType}
            isActive={item.id === active}
            isDisabled={item.isDisabled}
            showAfterMs={tips.showAfterMs}
            onTooltipClosed={tips.noteClosed}
            badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai })}
            tooltipSuffix={tooltipSuffixFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count })}
            isDropTarget={dropMode && item.id === 'assets'}
            isDropDimmed={dropMode && item.id !== 'assets'}
            onDrop={item.id === 'assets' ? onDropAssets : undefined}
            onClick={() => {
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}
