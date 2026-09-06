import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useModernModel } from '@xgenia-hooks/useModel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';
import { RailPresence } from '@xgenia-models/railpresence';
import { GitStatus } from '@xgenia-models/gitstatus';
import { AiActivity, AiActivitySnapshot } from '@xgenia-models/aiactivity';

import { Keybindings } from '../../constants/Keybindings';
import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { IdentityChip } from './IdentityChip';
import { RailButton, RailButtonProps } from './RailButton';
import { activePanelId } from './railLayout';
import { arrangeRail, railCapacity, RAIL_SLOT } from './railOrder';
import { useTooltipGroup } from './useTooltipGroup';
import css from './Rail.module.scss';

type RailBadge = { count?: number; unseen?: boolean; ring?: boolean };
type PresenceState = Record<string, { unseen: number; lastAt: number }>;

// The one RailButton renders the assets/versioncontrol/chat presence signals — the AI
// touched this panel's domain (Task 13, an amber dot), how many files are uncommitted
// (Task 14, a live count on Version control) and whether a turn is running (Task 15, a
// spinning ring on the chat item). Each task's brief independently said "set
// badge={{...}} on the RailButton call site"; taken literally the third overwrites the
// first two and every badge but the AI ring goes dark. This is the single composition
// point instead: every call site below reads badge={badgeFor(item)}, and each family of
// signal only ever touches its own field.
function badgeFor(
  item: { id: string },
  ctx: { presence: PresenceState; git: { count: number | null }; ai: AiActivitySnapshot }
): RailBadge {
  const badge: RailBadge = {};
  // Version control's badge is a live count, not a "did you miss something" dot — an
  // unseen dot on top of a count would just be noise, and RailPresence.noteCommand
  // already refuses to record 'versioncontrol' as a family, so this is never true for it.
  if ((ctx.presence[item.id]?.unseen ?? 0) > 0) badge.unseen = true;
  if (item.id === 'versioncontrol') badge.count = ctx.git.count ?? undefined;
  if (item.id === 'chat-panel') badge.ring = ctx.ai.active;
  return badge;
}

/** Static (non-ticking) tooltip suffix for every item except the chat panel, whose
 *  elapsed-time text is handled by ChatRailButton below so a per-second tick never
 *  has to re-render the rest of the rail. */
function tooltipSuffixFor(item: { id: string }, ctx: { presence: PresenceState; git: { count: number | null } }): string | undefined {
  if (item.id === 'versioncontrol') {
    return ctx.git.count ? `· ${ctx.git.count} uncommitted file${ctx.git.count === 1 ? '' : 's'}` : undefined;
  }
  const p = ctx.presence[item.id];
  return p?.unseen ? `· ${p.unseen} new since you looked` : undefined;
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
            onClick: () => {
              SidebarModel.instance.dispatch({ type: 'click', id: item.id });
              item.onClick?.();
            }
          };
          if (item.id === 'chat-panel') {
            return <ChatRailButton key={item.id} {...common} badge={badgeFor(item, { presence, git, ai })} ai={ai} aiSince={aiSince} />;
          }
          return (
            <RailButton
              key={item.id}
              {...common}
              badge={badgeFor(item, { presence, git, ai })}
              tooltipSuffix={tooltipSuffixFor(item, { presence, git })}
            />
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
            badge={badgeFor(item, { presence, git, ai })}
            tooltipSuffix={tooltipSuffixFor(item, { presence, git })}
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
