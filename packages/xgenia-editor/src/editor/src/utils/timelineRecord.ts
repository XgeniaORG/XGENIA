import { TimelineState, type TimelineNodeLike, type TimelineStateModel } from '../models/timelineState';
import { numericValue, parseTimeline, serializeTimeline, trackFor, upsertKey, valuesAt, type TimelineDoc } from './timelineModel';
import { sameComponent, unitForParam } from './timelineTargets';

/**
 * Record mode (Unity's red button) for viewport gestures. editorapi.viewportGesture wires it:
 *
 *   const params = recordingParamsFor(node) || node.parameters || {};
 *   const result = resolveGesture(target, { parameters: params, ... });
 *   if (recordWrites(node, result.writes, group)) { applied++; continue; }
 *   ...otherwise write base params as today
 *
 * While recording on the dock's Timeline, and `node` is in that Timeline's component, a drag
 * resolves against where the node is ON SCREEN at the playhead and lands as keys at the
 * playhead instead of base values.
 */

export interface RecordingContext {
  timeline: TimelineNodeLike;
  doc: TimelineDoc;
  time: number;
}

export interface RecordOptions {
  /** Undo label (default "Record keyframe"). */
  label?: string;
  /** For tests; defaults to the editor's TimelineState. */
  state?: TimelineStateModel;
}

/** The recording timeline for this node, or null when edits should go to base params. */
export function activeRecording(node: TimelineNodeLike | null | undefined, state: TimelineStateModel = TimelineState): RecordingContext | null {
  if (!node) return null;
  const s = state.get();
  if (!s.recording || !s.open || !s.timelineNodeId) return null;
  const timeline = state.findNode(s.timelineNodeId);
  if (!timeline || timeline === node || timeline.id === node.id) return null;
  if (!sameComponent(node, timeline)) return null;
  return { timeline, doc: parseTimeline(timeline.parameters?.tracks), time: s.time };
}

/**
 * Parameters to resolve a gesture against while recording: node.parameters with every tracked
 * param replaced by its value at the playhead. null when not recording for this node.
 */
export function recordingParamsFor(node: TimelineNodeLike | null | undefined, state: TimelineStateModel = TimelineState): Record<string, any> | null {
  const ctx = activeRecording(node, state);
  if (!ctx || !node) return null;
  const params: Record<string, any> = { ...(node.parameters || {}) };
  const values = valuesAt(ctx.doc, node.id, ctx.time);
  for (const param of Object.keys(values)) {
    const v = values[param];
    if (typeof v === 'number') {
      params[param] = v;
    } else {
      // Keep the rest of a dimension object (isFixed) so the panel-canonical write survives.
      const base = params[param];
      params[param] =
        base && typeof base === 'object' && !Array.isArray(base) ? { ...base, value: v.value, unit: v.unit } : { value: v.value, unit: v.unit };
    }
  }
  return params;
}

/**
 * While recording, turn a gesture's writes into keys at the playhead on the dock's Timeline (one
 * undoable `tracks` write in `undoGroup`) and re-pose the preview. Numeric writes ({value, unit},
 * numbers, '12px') become keys; others (sizeMode, alignX) are written to the node as usual, in
 * the same undo group. Returns true when handled — the caller then skips its base writes.
 * Returns false when not recording, or when nothing in `writes` can be keyed.
 */
export function recordWrites(
  node: TimelineNodeLike | null | undefined,
  writes: Array<{ param: string; value: any }>,
  undoGroup: any,
  options: RecordOptions = {}
): boolean {
  const state = options.state || TimelineState;
  const ctx = activeRecording(node, state);
  if (!ctx || !node || !Array.isArray(writes) || writes.length === 0) return false;

  const label = options.label || 'Record keyframe';
  let doc = ctx.doc;
  let keyed = 0;
  const passthrough: Array<{ param: string; value: any }> = [];

  for (const w of writes) {
    if (!w || typeof w.param !== 'string') continue;
    const num = numericValue(w.value);
    if (!num) {
      passthrough.push(w);
      continue;
    }
    const existing = trackFor(doc, node.id, w.param);
    const unit = num.unit || (existing && existing.unit) || unitForParam(node, w.param);
    doc = upsertKey(doc, { nodeId: node.id, param: w.param, unit, t: ctx.time, v: num.value });
    keyed++;
  }
  if (keyed === 0) return false;

  const json = serializeTimeline(doc);
  if (typeof ctx.timeline.setParameter === 'function') {
    ctx.timeline.setParameter('tracks', json, { undo: undoGroup, label });
  }
  for (const w of passthrough) {
    if (JSON.stringify(node.parameters?.[w.param]) === JSON.stringify(w.value)) continue;
    if (typeof node.setParameter === 'function') node.setParameter(w.param, w.value, { undo: undoGroup, label });
  }

  // The parameter reaches the preview a moment later; pose it now with the new tracks.
  state.scrubPreview(json);
  return true;
}
