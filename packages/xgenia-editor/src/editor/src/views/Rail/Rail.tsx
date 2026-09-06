import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { Keybindings } from '../../constants/Keybindings';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { IdentityChip } from './IdentityChip';
import { RailButton } from './RailButton';
import { activePanelId } from './railLayout';
import { arrangeRail, railCapacity, RAIL_SLOT } from './railOrder';
import { useTooltipGroup } from './useTooltipGroup';
import css from './Rail.module.scss';

export function Rail() {
  const sidebar = useModernModel(SidebarModel.instance, [SidebarModelEvent.itemsChanged, SidebarModelEvent.layoutChanged]);
  const items = sidebar.getVisibleItems();
  const layout = sidebar.Layout;
  const active = layout.open ? activePanelId(layout) : null;
  const tips = useTooltipGroup();

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

  // Hover-peek: dwelling on the rail while the card is fully collapsed brings the docked
  // panel back as a temporary peek, so a glance doesn't require permanently reopening it.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPeeked = useRef(false);

  const onRailEnter = () => {
    if (layoutRef.current.open) return;
    if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; }
    hoverTimer.current = setTimeout(() => {
      hoverPeeked.current = true;
      SidebarModel.instance.dispatch({ type: 'peek', id: layoutRef.current.dockedId });
    }, 400);
  };
  const onRailLeave = () => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null; }
  };

  useEffect(() => {
    // The hover-peek closes 300ms after the pointer leaves both the rail and the peek card,
    // unless the user clicked inside it (then Esc/click-away own it). `esc` alone would leave
    // `open: true` (a peek dropped on top of an open card) — since this peek was opened from
    // a COLLAPSED card, follow it with `toggle` to actually return to collapsed.
    const onMove = (e: PointerEvent) => {
      if (!hoverPeeked.current) return;
      const t = e.target as Element | null;
      const inside = !!t && (!!t.closest('[data-test="rail"]') || !!t.closest('[data-test="left-card-peek"]'));
      if (inside) { if (leaveTimer.current) { clearTimeout(leaveTimer.current); leaveTimer.current = null; } return; }
      if (!leaveTimer.current) leaveTimer.current = setTimeout(() => {
        hoverPeeked.current = false;
        leaveTimer.current = null;
        SidebarModel.instance.dispatch({ type: 'esc' });
        SidebarModel.instance.dispatch({ type: 'toggle' });
      }, 300);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t?.closest('[data-test="left-card-peek"]')) hoverPeeked.current = false;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerdown', onDown, true);
    return () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerdown', onDown, true); };
  }, []);

  return (
    <div
      ref={rootRef}
      className={css.Root}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Panels"
      data-test="rail"
      onPointerEnter={onRailEnter}
      onPointerLeave={onRailLeave}
    >
      <IdentityChip />

      <div className={css.Top}>
        {indicatorY !== null && <span className={css.Indicator} style={{ transform: `translateY(${indicatorY}px)` }} aria-hidden="true" />}
        {arrangement.top.map((item, index) => (
          <RailButton
            key={item.id}
            id={item.id}
            name={item.name}
            icon={item.icon as React.ElementType}
            fineType={item.fineType ?? (index < 9 ? Keybindings.RAIL_ITEMS[index].label : undefined)}
            digit={showDigits ? index + 1 : undefined}
            isActive={item.id === active}
            isDisabled={item.isDisabled}
            showAfterMs={tips.showAfterMs}
            onTooltipClosed={tips.noteClosed}
            onClick={(e) => {
              const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.();
              const root = rootRef.current?.getBoundingClientRect();
              if (r && root) EventDispatcher.instance.emit('rail-origin-y', r.top - root.top + r.height / 2);
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
          />
        ))}
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
            onClick={(e) => {
              const r = (e?.currentTarget as HTMLElement | undefined)?.getBoundingClientRect?.();
              const root = rootRef.current?.getBoundingClientRect();
              if (r && root) EventDispatcher.instance.emit('rail-origin-y', r.top - root.top + r.height / 2);
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }}
          />
        ))}
      </div>
    </div>
  );
}
