import classNames from 'classnames';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';

import { MenuDialogWidth } from '@xgenia-core-ui/components/popups/MenuDialog';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { TimelineState, type TimelineNodeLike, type TimelineStateSnapshot } from '../../models/timelineState';
import {
  evaluateTrack,
  lastKeyTime,
  moveKeys,
  parseTimeline,
  removeKeys,
  removeTrack,
  serializeTimeline,
  setKeyEase,
  upsertKey,
  type KeyRef,
  type TimelineDoc,
  type TimelineEase,
  type TimelineTrack
} from '../../utils/timelineModel';
import { animatableParams, baseValue, nodeLabel, paramLabel, sameComponent } from '../../utils/timelineTargets';
import { showContextMenuInPopup } from '../ShowContextMenuInPopup';
import css from './TimelineDock.module.scss';
import {
  clampZoom,
  DEFAULT_PX_PER_SECOND,
  dragDelta,
  formatTime,
  majorTickStep,
  rulerTicks,
  scrollForZoom,
  snapTime
} from './timelineDockMath';

const LABEL_WIDTH = 200;
/** Lane padding so a key at 0 s is not cut in half. */
const LANE_PAD = 12;
const POLL_MS = 33;

export function useTimelineState(): TimelineStateSnapshot {
  return useSyncExternalStore(TimelineState.subscribe, TimelineState.get, TimelineState.get);
}

/** Re-render when a node's parameters change (undo, the property panel, the AI). */
function useNodeVersion(node: TimelineNodeLike | undefined): number {
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const model = node as any;
    if (!model || typeof model.on !== 'function') return;
    const group = {};
    model.on(['parametersChanged', 'labelChanged'], () => bump(), group);
    return () => model.off(group);
  }, [node]);
  return version;
}

const keyId = (trackId: string, t: number) => `${trackId}@${t}`;

function sameTime(a: number, b: number) {
  return Math.abs(a - b) < 1e-5;
}

const EASE_ITEMS: { label: string; ease: TimelineEase | undefined }[] = [
  { label: 'Linear', ease: undefined },
  { label: 'Ease In', ease: 'easeIn' },
  { label: 'Ease Out', ease: 'easeOut' },
  { label: 'Ease In Out', ease: 'easeInOut' },
  { label: 'Step (hold)', ease: 'step' }
];

export interface TimelineDockProps {
  height: number;
}

/**
 * The Timeline dock: ruler, playhead, play controls, one row per track with keyframe diamonds,
 * and Unity's Record toggle. Edits write the Timeline node's `tracks` parameter with undo;
 * scrubbing and playback drive the live preview through TimelineState.preview.
 */
export function TimelineDock({ height }: TimelineDockProps) {
  const state = useTimelineState();
  const timelineNode = state.timelineNodeId ? TimelineState.findNode(state.timelineNodeId) : undefined;
  const version = useNodeVersion(timelineNode);

  const doc: TimelineDoc = useMemo(
    () => parseTimeline(timelineNode?.parameters?.tracks),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timelineNode, version]
  );
  // Same reading as the runtime node: unset is the port default (2 s), anything else non-positive is 0.
  const durationRaw = timelineNode?.parameters?.duration;
  const durationNum = Number(durationRaw);
  const duration = durationRaw === undefined ? 2 : Number.isFinite(durationNum) && durationNum > 0 ? durationNum : 0;
  const loop = !!timelineNode?.parameters?.loop;

  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SECOND);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<KeyRef[]>([]);
  const [dragDt, setDragDt] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const pxRef = useRef(pxPerSecond);
  pxRef.current = pxPerSecond;
  const pendingScrollRef = useRef<number | null>(null);

  const timelineId = state.timelineNodeId;
  const total = Math.max(duration, lastKeyTime(doc)) + 1;
  const laneWidth = Math.max(total * pxPerSecond + LANE_PAD * 2, 200);

  // A different timeline (or none) clears the key selection and stops our playback polling.
  useEffect(() => {
    setSelected([]);
    setPlaying(false);
  }, [timelineId]);

  // ---- writes ---------------------------------------------------------------------------

  const writeDoc = useCallback(
    (next: TimelineDoc, label: string) => {
      const node = TimelineState.timelineNode();
      if (!node || typeof node.setParameter !== 'function') return;
      const json = serializeTimeline(next);
      if (json === serializeTimeline(doc)) return;
      node.setParameter('tracks', json, { undo: true, label });
      // Show the edit in the preview now, ahead of the parameter round trip.
      if (!playing) TimelineState.scrubPreview(json);
    },
    [doc, playing]
  );

  const writeParam = useCallback((name: string, value: unknown, label: string) => {
    const node = TimelineState.timelineNode();
    if (!node || typeof node.setParameter !== 'function') return;
    if (node.parameters?.[name] === value) return;
    node.setParameter(name, value, { undo: true, label });
  }, []);

  // ---- playback -------------------------------------------------------------------------

  useEffect(() => {
    if (!playing || !timelineId) return;
    const timer = setInterval(() => {
      TimelineState.preview.getState(timelineId, (s) => {
        if (!s) return;
        TimelineState.setTime(s.time);
        if (!s.playing) setPlaying(false);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [playing, timelineId]);

  const onPlayPause = useCallback(() => {
    if (!timelineId) return;
    if (playing) {
      TimelineState.preview.pause(timelineId);
      setPlaying(false);
      return;
    }
    // Play from the playhead: pose there first, then run.
    const start = duration > 0 && TimelineState.get().time >= duration ? 0 : TimelineState.get().time;
    TimelineState.setTime(start);
    TimelineState.preview.scrub(timelineId, start);
    TimelineState.preview.play(timelineId);
    TimelineState.set({ previewing: true });
    setPlaying(true);
  }, [timelineId, playing, duration]);

  const onStop = useCallback(() => {
    if (!timelineId) return;
    TimelineState.preview.stop(timelineId);
    setPlaying(false);
    TimelineState.set({ time: 0, previewing: false });
  }, [timelineId]);

  const onToStart = useCallback(() => {
    if (playing && timelineId) {
      TimelineState.preview.pause(timelineId);
      setPlaying(false);
    }
    TimelineState.setTime(0);
    if (TimelineState.get().previewing) TimelineState.scrubPreview();
  }, [playing, timelineId]);

  // ---- scrubbing ------------------------------------------------------------------------

  const timeAtClientX = useCallback((clientX: number, el: HTMLElement | null) => {
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left - LANE_PAD) / pxRef.current);
  }, []);

  const scrubTo = useCallback(
    (t: number) => {
      if (playing) setPlaying(false);
      TimelineState.setTime(t);
      TimelineState.scrubPreview();
    },
    [playing]
  );

  const onRulerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0 || !timelineId) return;
      e.preventDefault();
      rootRef.current?.focus();
      const ruler = rulerRef.current;
      let frame = 0;
      let pending: number | null = null;
      const flush = () => {
        frame = 0;
        if (pending !== null) scrubTo(pending);
        pending = null;
      };
      const at = (ev: PointerEvent | React.PointerEvent) => snapTime(timeAtClientX(ev.clientX, ruler), !ev.altKey);
      scrubTo(at(e));
      const move = (ev: PointerEvent) => {
        pending = at(ev);
        if (!frame) frame = requestAnimationFrame(flush);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (frame) cancelAnimationFrame(frame);
        flush();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [timelineId, scrubTo, timeAtClientX]
  );

  // ---- keys -----------------------------------------------------------------------------

  const isSelected = useCallback(
    (trackId: string, t: number) => selected.some((r) => r.trackId === trackId && sameTime(r.t, t)),
    [selected]
  );

  const onKeyPointerDown = useCallback(
    (e: React.PointerEvent, track: TimelineTrack, t: number) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      rootRef.current?.focus();

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let selection = selected;
      if (additive) {
        selection = isSelected(track.id, t)
          ? selected.filter((r) => !(r.trackId === track.id && sameTime(r.t, t)))
          : [...selected, { trackId: track.id, t }];
        setSelected(selection);
        return;
      }
      if (!isSelected(track.id, t)) {
        selection = [{ trackId: track.id, t }];
        setSelected(selection);
      }

      const startX = e.clientX;
      const earliest = Math.min(...selection.map((r) => r.t));
      let dt = 0;
      const move = (ev: PointerEvent) => {
        const raw = (ev.clientX - startX) / pxRef.current;
        dt = dragDelta(t, raw, earliest, !ev.altKey);
        setDragDt(dt);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragDt(0);
        if (dt !== 0) {
          writeDoc(moveKeys(doc, selection, dt), selection.length > 1 ? 'Move keyframes' : 'Move keyframe');
          setSelected(selection.map((r) => ({ trackId: r.trackId, t: Math.round(Math.max(0, r.t + dt) * 1e6) / 1e6 })));
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [selected, isSelected, doc, writeDoc]
  );

  const onKeyContextMenu = useCallback(
    (e: React.MouseEvent, track: TimelineTrack, t: number) => {
      e.preventDefault();
      e.stopPropagation();
      const key = track.keys.find((k) => sameTime(k.t, t));
      const current = JSON.stringify(key?.ease === 'linear' ? undefined : key?.ease);
      showContextMenuInPopup({
        title: `Key at ${formatTime(t)}`,
        width: MenuDialogWidth.Default,
        items: [
          ...EASE_ITEMS.map((item) => ({
            label: item.label + (current === JSON.stringify(item.ease) ?'  ✓' : ''),
            onClick: () => writeDoc(setKeyEase(doc, track.id, t, item.ease), 'Change keyframe ease')
          })),
          'divider' as const,
          {
            label: 'Delete key',
            isDangerous: true,
            onClick: () => {
              writeDoc(removeKeys(doc, [{ trackId: track.id, t }]), 'Delete keyframe');
              setSelected((s) => s.filter((r) => !(r.trackId === track.id && sameTime(r.t, t))));
            }
          }
        ]
      });
    },
    [doc, writeDoc]
  );

  const onLaneDoubleClick = useCallback(
    (e: React.MouseEvent, track: TimelineTrack) => {
      const t = snapTime(timeAtClientX(e.clientX, e.currentTarget as HTMLElement), !e.altKey);
      const target = TimelineState.findNode(track.nodeId);
      const evaluated = evaluateTrack(track, t);
      const v = evaluated !== undefined ? evaluated : target ? baseValue(target, track.param).value : 0;
      writeDoc(upsertKey(doc, { nodeId: track.nodeId, param: track.param, unit: track.unit, t, v }), 'Add keyframe');
      setSelected([{ trackId: track.id, t }]);
    },
    [doc, writeDoc, timeAtClientX]
  );

  const deleteSelected = useCallback(() => {
    if (!selected.length) return false;
    writeDoc(removeKeys(doc, selected), selected.length > 1 ? 'Delete keyframes' : 'Delete keyframe');
    setSelected([]);
    return true;
  }, [selected, doc, writeDoc]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Always stop here while the dock has focus: the node graph's own Delete would remove
        // the selected node — often this Timeline itself.
        e.preventDefault();
        e.stopPropagation();
        deleteSelected();
      } else if (e.key === ' ' && !e.metaKey && !e.ctrlKey && tag !== 'BUTTON') {
        e.preventDefault();
        e.stopPropagation();
        onPlayPause();
      } else if (e.key === 'Escape' && selected.length) {
        e.stopPropagation();
        setSelected([]);
      }
    },
    [deleteSelected, onPlayPause, selected.length]
  );

  // ---- tracks ---------------------------------------------------------------------------

  const onAddTrack = useCallback(() => {
    if (!timelineNode) return;
    const target = TimelineState.findNode(TimelineState.get().selectedTargetId);
    const time = TimelineState.get().time;
    if (!target || target.id === timelineNode.id) {
      showContextMenuInPopup({
        title: 'Add track',
        items: [{ label: 'Select a node in the preview or node graph first', isDisabled: true }]
      });
      return;
    }
    if (!sameComponent(target, timelineNode)) {
      showContextMenuInPopup({
        title: 'Add track',
        items: [{ label: `${nodeLabel(target)} is in another component than this Timeline`, isDisabled: true }]
      });
      return;
    }
    const tracked = new Set(doc.tracks.filter((tr) => tr.nodeId === target.id).map((tr) => tr.param));
    const params = animatableParams(target);
    const items = params.map((p) => ({
      label: p.label,
      isDisabled: tracked.has(p.param),
      onClick: () => {
        const base = baseValue(target, p.param);
        writeDoc(
          upsertKey(doc, { nodeId: target.id, param: p.param, unit: base.unit || p.unit, t: time, v: base.value }),
          'Add timeline track'
        );
      }
    }));
    showContextMenuInPopup({
      title: `Animate ${nodeLabel(target)}`,
      width: MenuDialogWidth.Default,
      items: items.length ? items : [{ label: 'No animatable properties on this node', isDisabled: true }]
    });
  }, [timelineNode, doc, writeDoc]);

  const onRemoveTrack = useCallback(
    (track: TimelineTrack) => {
      writeDoc(removeTrack(doc, track.id), 'Remove timeline track');
      setSelected((s) => s.filter((r) => r.trackId !== track.id));
    },
    [doc, writeDoc]
  );

  const selectNodeInGraph = useCallback((nodeId: string) => {
    EventDispatcher.instance.emit('inspectNodes', { nodeIds: [nodeId] });
  }, []);

  // ---- zoom -----------------------------------------------------------------------------

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorOffset = e.clientX - rect.left;
      const laneOrigin = LABEL_WIDTH + LANE_PAD;
      const t = Math.max(0, (el.scrollLeft + cursorOffset - laneOrigin) / pxRef.current);
      const next = clampZoom(pxRef.current * Math.exp(-e.deltaY * 0.002));
      if (next === pxRef.current) return;
      pendingScrollRef.current = scrollForZoom(t, next, cursorOffset, laneOrigin);
      setPxPerSecond(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [timelineNode]);

  useLayoutEffect(() => {
    if (pendingScrollRef.current !== null && scrollRef.current) {
      scrollRef.current.scrollLeft = pendingScrollRef.current;
      pendingScrollRef.current = null;
    }
  }, [pxPerSecond]);

  // ---- render ---------------------------------------------------------------------------

  const ticks = useMemo(() => rulerTicks(total, pxPerSecond), [total, pxPerSecond]);
  const tickStep = majorTickStep(pxPerSecond);
  const xOf = (t: number) => LANE_PAD + t * pxPerSecond;

  const header = (
    <div className={css.Toolbar}>
      <button
        type="button"
        className={classNames(css.IconBtn, css.Record, state.recording && css.isRecording)}
        title={state.recording ? 'Recording: viewport edits become keys at the playhead' : 'Record: viewport edits become keys'}
        aria-pressed={state.recording}
        disabled={!timelineNode}
        onClick={() => TimelineState.setRecording(!state.recording)}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <circle cx="6" cy="6" r="4.5" fill="currentColor" />
        </svg>
      </button>
      <span className={css.Sep} />
      <button type="button" className={css.IconBtn} title="Go to start" disabled={!timelineNode} onClick={onToStart}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <rect x="2" y="2" width="1.6" height="8" fill="currentColor" />
          <path d="M10 2 L4.5 6 L10 10 Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className={classNames(css.IconBtn, playing && css.isOn)}
        title={playing ? 'Pause (Space)' : 'Play in preview (Space)'}
        disabled={!timelineNode}
        onClick={onPlayPause}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2.5" y="2" width="2.4" height="8" fill="currentColor" />
            <rect x="7.1" y="2" width="2.4" height="8" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M3 1.8 L10.2 6 L3 10.2 Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button type="button" className={css.IconBtn} title="Stop: back to 0 and base values" disabled={!timelineNode} onClick={onStop}>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <rect x="2.5" y="2.5" width="7" height="7" fill="currentColor" />
        </svg>
      </button>
      <span className={css.Time}>{state.time.toFixed(2)}s</span>
      <span className={css.Sep} />
      <label className={css.Field} title="Timeline duration in seconds">
        <span>Duration</span>
        <DurationInput value={duration} disabled={!timelineNode} onCommit={(v) => writeParam('duration', v, 'Change timeline duration')} />
      </label>
      <button
        type="button"
        className={classNames(css.Chip, loop && css.ChipActive)}
        aria-pressed={loop}
        disabled={!timelineNode}
        onClick={() => writeParam('loop', !loop, loop ? 'Turn timeline loop off' : 'Turn timeline loop on')}
      >
        Loop
      </button>
      <span className={css.Sep} />
      <button type="button" className={css.Chip} disabled={!timelineNode} onClick={onAddTrack} title="Animate a property of the selected node">
        + Add track
      </button>
      <span className={css.Spacer} />
      {timelineNode && (
        <button type="button" className={css.Name} title="Select this Timeline node" onClick={() => selectNodeInGraph(timelineNode.id)}>
          {nodeLabel(timelineNode)}
        </button>
      )}
      <button type="button" className={css.IconBtn} title="Close timeline" onClick={() => TimelineState.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
    </div>
  );

  if (!timelineNode) {
    return (
      <div className={css.Root} style={{ height }} ref={rootRef} tabIndex={-1}>
        {header}
        <div className={css.Empty}>
          Select a Timeline node in the node graph to edit it here. Add one from the node picker under Animation &rsaquo; Timeline.
        </div>
      </div>
    );
  }

  const playheadX = LABEL_WIDTH + xOf(state.time);

  return (
    <div
      className={classNames(css.Root, state.recording && css.isRecording)}
      style={{ height }}
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {header}
      <div className={css.Scroll} ref={scrollRef}>
        <div className={css.Content} style={{ width: LABEL_WIDTH + laneWidth }}>
          <div className={css.RulerRow}>
            <div className={css.Corner} style={{ width: LABEL_WIDTH }}>
              {doc.tracks.length} {doc.tracks.length === 1 ? 'track' : 'tracks'}
            </div>
            <div className={css.Ruler} style={{ width: laneWidth }} ref={rulerRef} onPointerDown={onRulerPointerDown}>
              <div className={css.PastEnd} style={{ left: xOf(duration) }} />
              {ticks.map((tick) => (
                <div
                  key={tick.t}
                  className={classNames(css.Tick, tick.major && css.TickMajor)}
                  style={{ left: xOf(tick.t) }}
                >
                  {tick.major && <span>{formatTime(tick.t, tickStep)}</span>}
                </div>
              ))}
              <div className={css.PlayheadHandle} style={{ left: xOf(state.time) }} />
            </div>
          </div>

          {doc.tracks.map((track) => {
            const target = TimelineState.findNode(track.nodeId);
            return (
              <div key={track.id} className={css.Row}>
                <div className={classNames(css.Label, !target && css.isMissing)} style={{ width: LABEL_WIDTH }}>
                  <button
                    type="button"
                    className={css.LabelText}
                    title={target ? 'Select this node' : 'This node no longer exists'}
                    onClick={() => target && selectNodeInGraph(target.id)}
                  >
                    {nodeLabel(target)} &middot; {paramLabel(target, track.param)}
                  </button>
                  <button type="button" className={css.RemoveTrack} title="Remove track" onClick={() => onRemoveTrack(track)}>
                    <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden>
                      <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </div>
                <div
                  className={css.Lane}
                  style={{ width: laneWidth }}
                  onPointerDown={(e) => {
                    if (e.button === 0 && !(e.shiftKey || e.metaKey || e.ctrlKey)) setSelected([]);
                    rootRef.current?.focus();
                  }}
                  onDoubleClick={(e) => onLaneDoubleClick(e, track)}
                >
                  <div className={css.PastEnd} style={{ left: xOf(duration) }} />
                  {track.keys.map((key, i) => {
                    const sel = isSelected(track.id, key.t);
                    const t = sel ? Math.max(0, key.t + dragDt) : key.t;
                    return (
                      <div
                        key={keyId(track.id, i)}
                        className={classNames(css.Key, sel && css.isSelected, key.ease === 'step' && css.isStep)}
                        style={{ left: xOf(t) }}
                        title={`${formatTime(t)} · ${Math.round(key.v * 1000) / 1000}${track.unit || ''}`}
                        onPointerDown={(e) => onKeyPointerDown(e, track, key.t)}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onContextMenu={(e) => onKeyContextMenu(e, track, key.t)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {doc.tracks.length === 0 && (
            <div className={css.EmptyRows} style={{ paddingLeft: LABEL_WIDTH + LANE_PAD }}>
              No tracks yet. Select a node, then Add track, or turn on Record and move it in the preview.
            </div>
          )}

          <div className={css.Playhead} style={{ left: playheadX }} />
        </div>
      </div>
    </div>
  );
}

function DurationInput({ value, disabled, onCommit }: { value: number; disabled?: boolean; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) {
      const rounded = Math.round(n * 1000) / 1000;
      if (rounded !== value) onCommit(rounded);
      setText(String(rounded));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      className={css.Input}
      type="number"
      min={0.1}
      step={0.1}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          setText(String(value));
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}
