import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import { GlassPopover } from './GlassPopover';
import { Hi } from './icons';
import css from './ModeSegment.module.scss';

interface TimeState {
  paused: boolean;
  speed: number;
  safe: 'off' | 'device' | 'title';
}

interface StatesNode {
  index: number;
  label: string;
  states: string[];
  current: string | null;
}

const SPEEDS = [0.25, 0.5, 1, 2];

/** Run code in the live preview (CanvasView's 'preview-eval' channel). */
function previewEval<T>(code: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    EventDispatcher.instance.emit('preview-eval', {
      code,
      callback: (result: T, error?: unknown) => resolve(error ? undefined : result)
    });
  });
}

const api = (call: string) => `(window.XgeniaEditorTimeAPI ? window.XgeniaEditorTimeAPI.${call} : undefined)`;

/**
 * Unity's Pause / Step / time-scale for the running game, next to Edit | Preview, plus the
 * safe-area overlay and the state scrubber (jump the game to any state of any States node).
 * The preview implements all of it (webview-preload-viewer.js XgeniaEditorTimeAPI); nothing
 * here is saved to the project.
 */
export function PreviewTimeControls() {
  const [state, setState] = useState<TimeState>({ paused: false, speed: 1, safe: 'off' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [statesNodes, setStatesNodes] = useState<StatesNode[]>([]);
  const menuRef = useRef<HTMLButtonElement>(null);

  const apply = useCallback((code: string) => {
    void previewEval<TimeState>(code).then((s) => s && setState(s));
  }, []);

  // A preview reload brings a fresh clock: read it back whenever the preview reloads.
  useEffect(() => {
    const group = {};
    const read = () => setTimeout(() => apply(api('getState()')), 300);
    EventDispatcher.instance.on('viewer-refresh', read, group);
    read();
    return () => EventDispatcher.instance.off(group);
  }, [apply]);

  const refreshStates = useCallback(() => {
    void previewEval<StatesNode[]>(api('listStates()')).then((list) => setStatesNodes(Array.isArray(list) ? list : []));
  }, []);

  useEffect(() => {
    if (menuOpen) refreshStates();
  }, [menuOpen, refreshStates]);

  const goToState = (index: number, name: string, jump: boolean) => {
    void previewEval(api(`goToState(${index}, ${JSON.stringify(name)}, ${jump})`)).then(() => setTimeout(refreshStates, 60));
  };

  const speedLabel = state.speed === 0.25 ? '¼×' : state.speed === 0.5 ? '½×' : `${state.speed}×`;
  const busy = state.paused || state.speed !== 1 || state.safe !== 'off';

  return (
    <div className={css.Seg} role="group" aria-label="Preview time">
      <button
        type="button"
        className={classNames(css.SegBtn, css.IconBtn, state.paused && css.isPreview)}
        onClick={() => apply(api(`setPaused(${!state.paused})`))}
        title={state.paused ? 'Resume the game' : 'Pause the game'}
        aria-label={state.paused ? 'Resume' : 'Pause'}
        aria-pressed={state.paused}
      >
        <Hi icon={state.paused ? 'play' : 'pause'} size={13} />
      </button>
      <button
        type="button"
        className={classNames(css.SegBtn, css.IconBtn)}
        onClick={() => apply(api('step()'))}
        title="Step one frame (pauses the game)"
        aria-label="Step one frame"
      >
        <Hi icon="next" size={13} />
      </button>
      <button
        ref={menuRef}
        type="button"
        className={classNames(css.SegBtn, (menuOpen || busy) && css.isActive)}
        onClick={() => setMenuOpen((o) => !o)}
        title="Game speed, safe area and states"
        aria-label="Game speed, safe area and states"
      >
        {speedLabel}
        <Hi icon="caret" size={10} />
      </button>
      <GlassPopover triggerRef={menuRef} isVisible={menuOpen} onClose={() => setMenuOpen(false)} width={280}>
        <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
          <div>
            <div style={{ opacity: 0.6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Game speed
            </div>
            <div className={css.Seg} style={{ width: 'fit-content' }}>
              {SPEEDS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className={classNames(css.SegBtn, state.speed === v && css.isActive)}
                  onClick={() => apply(api(`setSpeed(${v})`))}
                  aria-pressed={state.speed === v}
                >
                  {v === 0.25 ? '¼×' : v === 0.5 ? '½×' : `${v}×`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Safe area
            </div>
            <div className={css.Seg} style={{ width: 'fit-content' }}>
              {(['off', 'device', 'title'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={classNames(css.SegBtn, state.safe === m && css.isActive)}
                  onClick={() => apply(api(`setSafeArea(${JSON.stringify(m)})`))}
                >
                  {m === 'off' ? 'Off' : m === 'device' ? 'Notch (est.)' : 'Title safe'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ opacity: 0.6, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Jump to state · not saved
            </div>
            {statesNodes.length === 0 ? (
              <div style={{ opacity: 0.6 }}>No States nodes running in the preview.</div>
            ) : (
              statesNodes.map((n) => (
                <div key={n.index} style={{ marginBottom: 8 }}>
                  <div style={{ marginBottom: 4 }}>{n.label}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {n.states.map((st) => (
                      <button
                        key={st}
                        type="button"
                        className={classNames(css.SegBtn, n.current === st && css.isActive)}
                        style={{ border: '1px solid var(--glass-ctrl-border)' }}
                        onClick={(e) => goToState(n.index, st, e.altKey)}
                        title="Click: animate to this state · Alt-click: jump"
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </GlassPopover>
    </div>
  );
}
