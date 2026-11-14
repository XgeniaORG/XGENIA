import { EventDispatcher } from '../../../shared/utils/EventDispatcher';

/**
 * The Timeline dock's line to the live preview. Each runtime Timeline node registers itself in
 * the preview frame's window.__XGENIA_TIMELINES (Map nodeId -> api); calls reach it through
 * CanvasView's 'preview-eval' event, which runs code in the preview frame and hands back the
 * result. Nothing here throws: no preview, no timeline or a detached viewer is a no-op.
 */

export interface TimelinePreviewState {
  time: number;
  duration: number;
  playing: boolean;
  scrubbing?: boolean;
}

export interface TimelinePreviewBridge {
  /** Pose the targets at t without playing. `tracks` (JSON) is used at once, ahead of the parameter round trip. */
  scrub(timelineId: string, t: number, tracks?: string): void;
  /** Leave scrubbing: targets go back to their base values. */
  endScrub(timelineId: string): void;
  play(timelineId: string): void;
  pause(timelineId: string): void;
  stop(timelineId: string): void;
  getState(timelineId: string, callback: (state: TimelinePreviewState | null) => void): void;
}

type Method = 'scrub' | 'endScrub' | 'play' | 'pause' | 'stop' | 'getState';

/** JS run in the preview frame: call one api method, return its result as JSON (or null). */
export function timelineCallCode(timelineId: string, method: Method, args: unknown[] = []): string {
  const id = JSON.stringify(String(timelineId));
  const argList = args
    .filter((a) => a !== undefined)
    .map((a) => JSON.stringify(a))
    .join(',');
  return (
    '(function(){try{' +
    'var m=window.__XGENIA_TIMELINES;' +
    `var a=m&&typeof m.get==='function'?m.get(${id}):null;` +
    `if(!a||typeof a.${method}!=='function')return null;` +
    `var r=a.${method}(${argList});` +
    'return r===undefined||r===null?null:JSON.stringify(r);' +
    '}catch(e){return null;}})()'
  );
}

function parseState(result: unknown): TimelinePreviewState | null {
  let value: any = result;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || typeof value.time !== 'number') return null;
  return {
    time: value.time,
    duration: typeof value.duration === 'number' ? value.duration : 0,
    playing: !!value.playing,
    scrubbing: !!value.scrubbing
  };
}

function evalInPreview(code: string, callback?: (result: unknown, error?: unknown) => void) {
  try {
    EventDispatcher.instance.emit('preview-eval', { code, callback });
  } catch (e) {
    callback && callback(null, e);
  }
}

export const previewEvalBridge: TimelinePreviewBridge = {
  scrub(timelineId, t, tracks) {
    evalInPreview(timelineCallCode(timelineId, 'scrub', tracks !== undefined ? [t, tracks] : [t]));
  },
  endScrub(timelineId) {
    evalInPreview(timelineCallCode(timelineId, 'endScrub'));
  },
  play(timelineId) {
    evalInPreview(timelineCallCode(timelineId, 'play'));
  },
  pause(timelineId) {
    evalInPreview(timelineCallCode(timelineId, 'pause'));
  },
  stop(timelineId) {
    evalInPreview(timelineCallCode(timelineId, 'stop'));
  },
  getState(timelineId, callback) {
    evalInPreview(timelineCallCode(timelineId, 'getState'), (result, error) => {
      callback(error ? null : parseState(result));
    });
  }
};
