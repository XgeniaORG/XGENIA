import { previewEvalBridge, type TimelinePreviewBridge } from '../utils/timelinePreview';

/**
 * Editor state of the Timeline dock: which Timeline node it edits, the playhead, Record, and
 * whether the dock is open. A singleton like the other editor models, with plain listeners
 * (subscribe for React's useSyncExternalStore, on/off with a group like Model).
 *
 * Node lookup and the preview bridge are injected — the dock host installs
 * ProjectModel.findNodeWithId and the 'preview-eval' bridge — so the record hook and its tests
 * never import the project model.
 */

export interface TimelineStateSnapshot {
  /** The Timeline node the dock edits (null: empty dock). */
  timelineNodeId: string | null;
  /** Playhead, seconds. */
  time: number;
  /** Unity's red Record: viewport edits become keys at `time` instead of base values. */
  recording: boolean;
  open: boolean;
  /** The preview is posed by (or playing) this timeline rather than showing base values. */
  previewing: boolean;
  /** Last non-Timeline node selected in the graph — the "Add track" target. */
  selectedTargetId: string | null;
}

/** The slice of NodeGraphNode the timeline code reads. */
export interface TimelineNodeLike {
  id: string;
  typename?: string;
  parameters?: Record<string, any>;
  owner?: any;
  label?: string;
  setParameter?: (name: string, value: any, args?: any) => void;
  getPort?: (name: string, filter?: 'input' | 'output') => any;
  getPorts?: (filter?: 'input' | 'output') => any[];
}

export type TimelineNodeLookup = (id: string) => TimelineNodeLike | undefined | null;

type Listener = () => void;

const INITIAL: TimelineStateSnapshot = {
  timelineNodeId: null,
  time: 0,
  recording: false,
  open: false,
  previewing: false,
  selectedTargetId: null
};

export class TimelineStateModel {
  private state: TimelineStateSnapshot = INITIAL;
  private listeners = new Set<Listener>();
  private groups = new Map<unknown, Listener[]>();
  private lookup: TimelineNodeLookup = () => undefined;
  private bridge: TimelinePreviewBridge = previewEvalBridge;

  get = (): TimelineStateSnapshot => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  on(_event: 'changed', listener: Listener, group: unknown) {
    const unsubscribe = this.subscribe(listener);
    const list = this.groups.get(group) || [];
    list.push(unsubscribe);
    this.groups.set(group, list);
  }

  off(group: unknown) {
    const list = this.groups.get(group);
    if (!list) return;
    list.forEach((unsubscribe) => unsubscribe());
    this.groups.delete(group);
  }

  set(patch: Partial<TimelineStateSnapshot>) {
    const next = { ...this.state, ...patch };
    if (next.time < 0 || !Number.isFinite(next.time)) next.time = 0;
    const changed = (Object.keys(next) as (keyof TimelineStateSnapshot)[]).some((k) => next[k] !== this.state[k]);
    if (!changed) return;
    this.state = next;
    this.listeners.forEach((l) => {
      try {
        l();
      } catch (e) {
        console.error('[TimelineState] listener failed', e);
      }
    });
  }

  reset() {
    this.state = INITIAL;
    this.listeners.forEach((l) => l());
  }

  // ---- injected services ----

  setNodeLookup(lookup: TimelineNodeLookup | null) {
    this.lookup = lookup || (() => undefined);
  }

  findNode(id: string | null | undefined): TimelineNodeLike | undefined {
    if (!id) return undefined;
    try {
      return this.lookup(id) || undefined;
    } catch {
      return undefined;
    }
  }

  setPreviewBridge(bridge: TimelinePreviewBridge | null) {
    this.bridge = bridge || previewEvalBridge;
  }

  get preview(): TimelinePreviewBridge {
    return this.bridge;
  }

  // ---- actions ----

  /** Point the dock at a Timeline node (and open it). The previous timeline stops posing the preview. */
  openOn(timelineNodeId: string) {
    const prev = this.state.timelineNodeId;
    if (prev && prev !== timelineNodeId) this.endPreview();
    this.set({
      timelineNodeId,
      open: true,
      ...(prev !== timelineNodeId ? { time: 0, recording: false } : {})
    });
  }

  open() {
    this.set({ open: true });
  }

  /** Close the dock: Record off, preview back to base values. */
  close() {
    this.endPreview();
    this.set({ open: false, recording: false });
  }

  toggle() {
    if (this.state.open) this.close();
    else this.open();
  }

  setTime(time: number) {
    this.set({ time: Math.max(0, Number.isFinite(time) ? time : 0) });
  }

  setRecording(recording: boolean) {
    this.set({ recording });
    // Recording edits the pose at the playhead, so the preview must show that pose.
    if (recording) this.scrubPreview();
  }

  /** Pose the preview at the playhead (optionally with tracks not yet round-tripped). */
  scrubPreview(tracks?: string) {
    const id = this.state.timelineNodeId;
    if (!id) return;
    this.bridge.scrub(id, this.state.time, tracks);
    this.set({ previewing: true });
  }

  /** Release the preview back to base values. */
  endPreview() {
    const id = this.state.timelineNodeId;
    if (id && this.state.previewing) this.bridge.endScrub(id);
    if (this.state.previewing) this.set({ previewing: false });
  }

  /** The node the dock edits, when it still exists. */
  timelineNode(): TimelineNodeLike | undefined {
    return this.findNode(this.state.timelineNodeId);
  }
}

export const TimelineState = new TimelineStateModel();
