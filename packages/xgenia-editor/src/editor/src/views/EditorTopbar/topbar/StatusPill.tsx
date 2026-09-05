// StatusPill.tsx — the single control in the middle of the top bar.
//
// It is one element that morphs: route + surface when nothing is happening, a text field
// when the user types, and a progress / AI / browsing / publish read-out when something is.
// Every decision about *which* of those to show lives in statusPillState.ts (pure, unit
// tested); this file only renders the answer and owns the three pieces of state that are
// genuinely local to the bar: the preview surface, the typed text, and a clock.
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { AiBrowserManager, AiBrowserState } from '@xgenia-ai/ChatPanel/AiBrowserManager';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { GlassPopover } from './GlassPopover';
import { Hi } from './icons';
import { PageMenu } from './PageMenu';
import css from './StatusPill.module.scss';
import {
  derivePillState,
  FAILED_HOLD_MS,
  LIVE_HOLD_MS,
  PillInputs,
  PillState,
  Surface
} from './statusPillState';
import { parseTopbarInput, RouteInfo, TopbarMatch } from './topbarCommands';

export interface StatusPillProps {
  /** `navigationState.route`; a query string is stripped here, not by the caller. */
  route: string;
  routeInfos: RouteInfo[];
  warnings: number;
  onNavigate: (path: string) => void;
  /** Only ever called with `kind: 'command'` matches. */
  onCommand: (m: TopbarMatch) => void;
  onShowWarnings: () => void;
  /** The parent sets `.current` to a focus function it can call on ⌘L. */
  focusRef?: React.MutableRefObject<(() => void) | null>;
  /**
   * Receives the pill's root element, so the parent can anchor its own dialogs (the
   * warnings menu) to the pill. The pill's own popover uses an internal ref and does
   * not need this.
   */
  anchorRef?: React.MutableRefObject<HTMLDivElement | null>;
  // Phase 2 wires these; the idle defaults keep Phase 1 compiling before the stores exist.
  ai?: PillInputs['ai'];
  publish?: PillInputs['publish'];
}

// Module-level so the default props keep a stable identity across renders — this
// component re-renders more than anything else in the editor, and a fresh object literal
// per render would defeat every dependency array below.
const IDLE_AI = { active: false, label: '' };
const IDLE_PUBLISH = { phase: 'idle' as const };

function readBrowser(): { active: boolean; url: string } {
  const s: AiBrowserState = AiBrowserManager.getState();
  return { active: !!(s && s.active), url: (s && s.url) || '' };
}

export function StatusPill({
  route,
  routeInfos,
  warnings,
  onNavigate,
  onCommand,
  onShowWarnings,
  focusRef,
  anchorRef,
  ai = IDLE_AI,
  publish = IDLE_PUBLISH
}: StatusPillProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [surface, setSurface] = useState<Surface>('viewport');
  const [browser, setBrowser] = useState<{ active: boolean; url: string }>(readBrowser);
  const [typing, setTyping] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const isTyping = typing !== null;

  // One element, two consumers: the popover anchors off `rootRef`, the parent's dialogs
  // off `anchorRef`. A callback ref fills both at commit time.
  const setRootEl = useCallback(
    (el: HTMLDivElement | null) => {
      rootRef.current = el;
      if (anchorRef) anchorRef.current = el;
    },
    [anchorRef]
  );

  // Subscribe once. Never per render — this bar is the most-rendered component in the editor.
  useEffect(() => {
    const group = {};
    const unsub = AiBrowserManager.onStateChange((s: AiBrowserState) =>
      setBrowser({ active: !!(s && s.active), url: (s && s.url) || '' })
    );
    // The manager can have navigated between the useState initializer and this line;
    // re-read once so a browser opened during mount is not missed until its next event.
    setBrowser(readBrowser());
    EventDispatcher.instance.on(
      'preview-surface-changed',
      (s: Surface) => {
        // Fail closed on a malformed payload: an unrecognised value would otherwise fall
        // into the 'browser' branch of every ternary below and show the wrong icon.
        if (s === 'viewport' || s === 'browser') setSurface(s);
      },
      group
    );
    return () => {
      if (typeof unsub === 'function') unsub();
      EventDispatcher.instance.off(group);
    };
  }, []);

  // Only the held states ('live', 'failed') expire on a clock, and each expires exactly
  // once — so this schedules a single timeout at the deadline rather than an interval
  // that would keep re-rendering the top bar for the rest of the session.
  useEffect(() => {
    const phase = publish.phase;
    if (phase !== 'live' && phase !== 'failed') return undefined;
    // derivePillState never shows 'live' without a timestamp and holds a 'failed' with a
    // corrupt one forever, so neither has a deadline to tick towards.
    if (!Number.isFinite(publish.changedAt as number)) return undefined;
    const changedAt = publish.changedAt as number;
    const hold = phase === 'live' ? LIVE_HOLD_MS : FAILED_HOLD_MS;
    // Clamped: a changedAt in the future (clock skew, a restored session) would schedule
    // past setTimeout's 2^31-1 ms ceiling, which fires immediately and spins. The hold is
    // the longest wait that can ever be correct.
    const delay = Math.max(0, Math.min(hold, changedAt + hold - Date.now()));
    const id = setTimeout(() => setNow(Date.now()), delay + 16);
    return () => clearTimeout(id);
  }, [publish.phase, publish.changedAt]);

  const beginTyping = useCallback(() => {
    setTyping('');
    setMenuOpen(true);
    // Focuses when the field is already mounted (a second ⌘L); the effect below covers
    // the first press, when the input does not exist yet.
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isTyping) inputRef.current?.focus();
  }, [isTyping]);

  useEffect(() => {
    if (!focusRef) return undefined;
    focusRef.current = beginTyping;
    return () => {
      focusRef.current = null;
    };
  }, [focusRef, beginTyping]);

  const endTyping = useCallback(() => {
    setTyping(null);
    setMenuOpen(false);
  }, []);

  const runMatch = useCallback(
    (m: TopbarMatch) => {
      // Enter on text that matches nothing keeps the field open with the text intact,
      // rather than silently discarding what was typed.
      if (m.kind === 'none') return;
      if (m.kind === 'route') onNavigate(m.path);
      else onCommand(m);
      endTyping();
    },
    [onNavigate, onCommand, endTyping]
  );

  const toggleSurface = useCallback(() => {
    const next: Surface = surface === 'viewport' ? 'browser' : 'viewport';
    setSurface(next);
    EventDispatcher.instance.emit('preview-surface', next);
  }, [surface]);

  const state: PillState = derivePillState({
    route: route.split('?')[0] || '/',
    surface,
    browser,
    warnings,
    ai,
    publish,
    typing,
    now
  });

  const warn = state.warnings > 0 && state.kind !== 'typing' && (
    <>
      <span className={css.Divider} />
      <span className={classNames(css.Seg, css.Danger)} onClick={onShowWarnings} title="Show warnings">
        <Hi icon="warning" size={13} color="var(--theme-color-danger)" />
        {state.warnings}
      </span>
    </>
  );

  let body: React.ReactNode;
  switch (state.kind) {
    case 'typing':
      body = (
        <>
          <span className={css.Shy}>
            <Hi icon="home" size={14} />
          </span>
          <input
            ref={inputRef}
            className={css.Input}
            value={state.text}
            placeholder="Page or command…"
            spellCheck={false}
            onChange={(e) => setTyping(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runMatch(parseTopbarInput(state.text, { routes: routeInfos }));
              if (e.key === 'Escape') endTyping();
            }}
          />
          <span className={css.Kbd}>↵</span>
        </>
      );
      break;
    case 'publishing':
      body = (
        <>
          <span className={classNames(css.Seg, css.Publish)}>
            <Hi icon="arrowUp" size={15} color="var(--theme-color-publish)" />
            <span className={css.Route}>{state.label}</span>
          </span>
          <span className={css.Hairline}>
            <span className={classNames(css.HairlineBar, css.isPublish)} />
          </span>
        </>
      );
      break;
    case 'live':
      body = (
        <>
          <span
            className={css.Seg}
            onClick={() => navigator.clipboard?.writeText(state.url)}
            title="Copy live URL"
          >
            <Hi icon="check" size={15} color="var(--theme-color-publish)" />
            <span className={css.Route}>Live</span>
          </span>
          <span className={css.Divider} />
          <span
            className={classNames(css.Seg, css.Muted)}
            onClick={() => navigator.clipboard?.writeText(state.url)}
            title="Copy live URL"
          >
            {state.url.replace(/^https?:\/\//, '')}
            <Hi icon="copy" size={13} color="var(--theme-color-fg-default-shy)" />
          </span>
        </>
      );
      break;
    case 'failed':
      body = (
        <span className={classNames(css.Seg, css.Danger)} title={state.label}>
          <Hi icon="warning" size={15} color="var(--theme-color-danger)" />
          <span className={css.Route}>{state.label}</span>
        </span>
      );
      break;
    case 'ai':
      body = (
        <>
          <span className={classNames(css.Seg, css.Primary)}>
            <Hi icon="sparkle" size={15} color="var(--theme-color-primary)" />
            <span className={css.RouteStrong}>{state.label}</span>
          </span>
          <span className={css.Hairline}>
            <span className={css.HairlineBar} />
          </span>
        </>
      );
      break;
    case 'browsing':
      body = (
        <>
          <span className={css.Seg} onClick={toggleSurface} title="Back to viewport">
            <span className={css.Pulse} />
            <Hi icon="globe" size={15} />
            <span className={css.Route}>Browsing {state.url}</span>
          </span>
          <span className={css.Shy}>
            <Hi icon="chevRight" size={13} />
          </span>
        </>
      );
      break;
    default:
      body = (
        <>
          <span
            className={css.Seg}
            onClick={toggleSurface}
            title={state.surface === 'viewport' ? 'Show AI browser' : 'Show viewport'}
          >
            <Hi icon={state.surface === 'viewport' ? 'monitor' : 'globe'} size={15} />
            {state.browserActive && state.surface === 'viewport' && <span className={css.Pulse} />}
          </span>
          <span className={css.Divider} />
          <span className={css.Seg} onClick={beginTyping} title="Pages and commands (⌘L)">
            <span className={css.Muted}>
              <Hi icon="home" size={14} />
            </span>
            <span className={css.Route}>{state.route.replace(/^\/#/, '') || '/'}</span>
            <span className={classNames(css.Caret, css.Shy, menuOpen && css.isOpen)}>
              <Hi icon="caret" size={13} />
            </span>
          </span>
        </>
      );
  }

  return (
    <>
      <div ref={setRootEl} className={css.Pill}>
        {body}
        {warn}
      </div>
      <GlassPopover triggerRef={rootRef} isVisible={menuOpen} onClose={endTyping} width={380}>
        <PageMenu
          routeInfos={routeInfos}
          currentRoute={route.split('?')[0]}
          typed={typing ?? ''}
          onNavigate={(p) => runMatch({ kind: 'route', path: p, title: p })}
          onCommand={runMatch}
        />
      </GlassPopover>
    </>
  );
}
