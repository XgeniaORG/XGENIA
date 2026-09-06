import classNames from 'classnames';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { RailPresence } from '@xgenia-models/railpresence';
import { GitStatus } from '@xgenia-models/gitstatus';
import { AiActivity, AiActivitySnapshot } from '@xgenia-models/aiactivity';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { MenuDialog } from '@xgenia-core-ui/components/popups/MenuDialog';

import { Keybindings } from '../../constants/Keybindings';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { ToastLayer } from '../ToastLayer';
import { importFiles } from '../panels/AssetPanel/assetOps';
import { SideMore } from '../SidePanel/SidebarIcons';
import { AddNodeButton } from './AddNodeButton';
import { IdentityChip } from './IdentityChip';
import { RailButton, RailButtonProps } from './RailButton';
import { activePanelId } from './railLayout';
import { badgeFor, tooltipSuffixFor, type RailBadge } from './railBadges';
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
  // `railHidden` panels (Settings) stay fully registered and dispatchable — they are just
  // not rendered as a rail button, so a rail-only filter here is the whole change; nothing
  // else reads `items` from this component.
  const items = sidebar.getVisibleItems().filter((i) => !i.railHidden);
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
  // 99 before the first ResizeObserver measurement: with no real height yet, `railCapacity`
  // has nothing to divide, and a capacity of 0 would render everything into overflow (or,
  // worse, nothing at all) for that first frame. 99 comfortably exceeds any real top
  // cluster, so nothing folds until a real measurement replaces it.
  const capacity = height ? railCapacity(height, bottomCount) : 99;
  const arrangement = useMemo(() => {
    const userOrder = sidebar.getUserOrder();
    const first = arrangeRail(items, userOrder, capacity);
    if (first.overflow.length === 0) return first;
    // The ⋯ button that will hold the overflow is itself a slot in the same column — fit
    // one fewer top item so it doesn't get pushed out by the very button meant to hold it.
    // Overflow is already non-empty at `capacity`, so dropping one more slot can only ever
    // keep it non-empty (never re-empty it) — a single recompute is enough, no loop needed.
    return arrangeRail(items, userOrder, Math.max(0, capacity - 1));
  }, [items, capacity, sidebar]);

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

  // The gesture in progress, if any: which pointer owns it, which item it started on, and
  // where it started. Set once at pointerdown and never mutated for the life of the
  // gesture (unlike `dragRef`, which tracks the moving `from`/`to`) — this is what makes a
  // second pointer's pointerdown a no-op (see the single-owner check below) and what lets
  // the window listeners below filter every event to this one pointer.
  const gestureRef = useRef<{ pointerId: number; startY: number; target: HTMLDivElement } | null>(null);
  // Mirrors whether a gesture is active, purely to gate the effect that owns the window
  // listeners — the effect reads gesture details from `gestureRef`, not from this state.
  const [gesturePointerId, setGesturePointerId] = useState<number | null>(null);

  const onItemPointerDown = (id: string, index: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Single-owner: a second pointer pressing a different item while a hold is pending or
    // a drag is running must not steal or corrupt the first gesture — ignore it outright.
    if (gestureRef.current) return;
    justDraggedRef.current = false;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    gestureRef.current = { pointerId, startY: e.clientY, target };
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      // The pointer can be gone by the time this fires — released outside the window
      // before 400ms elapsed, with no pointerup/pointercancel/blur ever reaching us to run
      // `endGesture`. `setPointerCapture` on an already-inactive pointer (or a target that
      // stopped being part of the top cluster while the hold was pending) throws. Every
      // path out of this callback must release ownership — the single-owner guard above
      // means an ungoverned throw here would leave `gestureRef` populated forever and
      // permanently disable press-and-hold for the rest of the session.
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Abandon exactly as a cancelled gesture would: no drag ever started, so there is
        // nothing to undo in `dragRef`/`drag`, only ownership to release. Clearing both
        // `gestureRef` and `gesturePointerId` (not just the ref) also tears down the
        // listener effect below, so no window listener is left attached to this dead
        // pointer either.
        gestureRef.current = null;
        setGesturePointerId(null);
        return;
      }
      applyDrag({ id, from: index, to: index, y: 0 });
    }, 400);
    // Triggers the effect below to attach the window listeners for this gesture; it stays
    // live through the pending-hold phase too, since an early move past the threshold has
    // to be able to cancel the pending hold.
    setGesturePointerId(pointerId);
  };

  // The window listeners for an in-progress gesture live in an effect gated on
  // `gesturePointerId`, not attached imperatively inside the pointerdown handler, so that
  // if Rail unmounts mid-gesture React's own cleanup removes them — mirroring how
  // LeftPanelCard's resize drag (and RightPropertyPanel's) attaches its listeners.
  useEffect(() => {
    if (gesturePointerId === null) return;
    const g = gestureRef.current;
    if (!g) return;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== g.pointerId) return; // ignore any other pointer
      // A move past a small threshold before the hold has fired reads as a scroll-ish
      // gesture, not a hold: cancel the pending timer so it never turns into a drag.
      if (holdTimer.current && Math.abs(ev.clientY - g.startY) > 4) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      const current = dragRef.current;
      if (!current) return;
      const dy = ev.clientY - g.startY;
      const to = Math.max(0, Math.min(topRef.current.length - 1, current.from + Math.round(dy / RAIL_SLOT)));
      applyDrag({ ...current, y: dy, to });
    };

    // Every way a drag can end funnels through here: a normal release (commit), the
    // pointer being cancelled by the platform, or the window losing focus mid-hold —
    // either of the latter two must abandon the reorder rather than apply a half-formed
    // one, and all three must equally release the pointer capture and hand the gesture
    // back (nulling `gestureRef` and the `gesturePointerId` state that gates this effect,
    // whose cleanup below then removes these listeners).
    const endGesture = (commit: boolean) => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      // `persistReorder` calls out to `SidebarModel.setUserOrder` (EditorSettings I/O) —
      // if that throws, ownership must still be released: the `finally` below is what
      // makes this hold regardless, the same invariant the hold-timer's catch above
      // upholds for its own failure mode.
      try {
        const finished = dragRef.current;
        if (finished) {
          justDraggedRef.current = true;
          if (commit && finished.from !== finished.to) persistReorder(finished.from, finished.to);
        }
      } finally {
        applyDrag(null);
        if (g.target.hasPointerCapture?.(g.pointerId)) {
          try { g.target.releasePointerCapture(g.pointerId); } catch { /* already released */ }
        }
        gestureRef.current = null;
        setGesturePointerId(null);
      }
    };
    const onUp = (ev: PointerEvent) => { if (ev.pointerId === g.pointerId) endGesture(true); };
    const onCancel = (ev: PointerEvent) => { if (ev.pointerId === g.pointerId) endGesture(false); };
    // `blur` carries no pointerId — the window losing focus abandons whatever gesture this
    // effect instance owns, regardless of which pointer it was.
    const onBlur = () => endGesture(false);

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
  }, [gesturePointerId]);

  // A hold still pending (its 400ms timer not yet fired) when Rail unmounts would otherwise
  // fire later and call `applyDrag` — a setState on an unmounted component. Every other way
  // a gesture ends already clears this timer (see `endGesture` above); this is only for the
  // unmount case none of those cover.
  useEffect(() => {
    return () => {
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

  // Render-time only: `drag` (state, always fresh during a render) is fine to read here,
  // unlike inside the listeners above.
  const shiftFor = (index: number): string => {
    if (!drag || index === drag.from) return 'none';
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return `translateY(-${RAIL_SLOT}px)`;
    if (drag.from > drag.to && index >= drag.to && index < drag.from) return `translateY(${RAIL_SLOT}px)`;
    return 'none';
  };

  // Task 19: fold the tail of the top cluster into a ⋯ menu at short heights.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);
  // The window growing tall enough that nothing overflows any more removes the ⋯ button
  // (and its ref target) out from under an open menu — close it rather than leave a
  // dialog anchored to nothing.
  useEffect(() => {
    if (arrangement.overflow.length === 0) setOverflowOpen(false);
  }, [arrangement.overflow.length]);

  // One badge per folded item, computed once via the shared composition helper (never a
  // second, divergent "does anything in here want attention" rule) and reused both for the
  // ⋯ button's own rolled-up badge and for marking which menu row it came from.
  const overflowItemBadges: Record<string, RailBadge> = {};
  for (const item of arrangement.overflow) {
    overflowItemBadges[item.id] = badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai, showsAiActivity: item.showsAiActivity });
  }
  const overflowBadge: RailBadge = {
    unseen: arrangement.overflow.some((item) => overflowItemBadges[item.id].unseen),
    ring: arrangement.overflow.some((item) => overflowItemBadges[item.id].ring)
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
      <AddNodeButton showAfterMs={tips.showAfterMs} onTooltipClosed={tips.noteClosed} />

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
          const button = item.showsAiActivity
            ? <ChatRailButton {...common} badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai, showsAiActivity: item.showsAiActivity })} ai={ai} aiSince={aiSince} />
            : (
              <RailButton
                {...common}
                badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai, showsAiActivity: item.showsAiActivity })}
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
        {arrangement.overflow.length > 0 && (
          <div ref={overflowRef}>
            <RailButton
              id="rail-overflow"
              name="More panels"
              icon={SideMore}
              isActive={arrangement.overflow.some((item) => item.id === active)}
              showAfterMs={tips.showAfterMs}
              onTooltipClosed={tips.noteClosed}
              badge={overflowBadge}
              onClick={() => setOverflowOpen((v) => !v)}
            />
          </div>
        )}
        {arrangement.overflow.length > 0 && (
          <MenuDialog
            isVisible={overflowOpen}
            onClose={() => setOverflowOpen(false)}
            triggerRef={overflowRef}
            renderDirection={DialogRenderDirection.Horizontal}
            items={arrangement.overflow.map((item) => ({
              key: item.id,
              label: overflowItemBadges[item.id].unseen ? `${item.name} •` : item.name,
              onClick: () => {
                setOverflowOpen(false);
                SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              }
            }))}
          />
        )}
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
            badge={badgeFor({ itemId: item.id, presenceEntry: presence[item.id], gitCount: git.count, ai, showsAiActivity: item.showsAiActivity })}
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
