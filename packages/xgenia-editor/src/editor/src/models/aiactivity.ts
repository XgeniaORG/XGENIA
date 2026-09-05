// src/editor/src/models/aiactivity.ts — "is the AI touching the project right now?"
// Fed by EditorBridge's undo bursts, read by the topbar status pill.
import { EventDispatcher } from '../../../shared/utils/EventDispatcher';

export interface AiActivitySnapshot {
  active: boolean;
  label: string;
}

/**
 * A missed `end()` (bridge crash, panel reload, a burst that never flushes) would leave
 * the pill claiming "AI working" forever. Every `begin()` re-arms this, so the pill can
 * only stick for 30s past the last sign of life.
 */
const SAFETY_MS = 30_000;

let snap: AiActivitySnapshot = { active: false, label: '' };
let safety: ReturnType<typeof setTimeout> | null = null;

function set(next: AiActivitySnapshot) {
  if (next.active === snap.active && next.label === snap.label) return;
  snap = next;
  EventDispatcher.instance.emit('ai-activity-changed', { ...snap });
}

export const AiActivity = {
  /** A copy: the snapshot goes straight into React state, where an in-place edit would
   *  otherwise rewrite this module's single source of truth. */
  getSnapshot(): AiActivitySnapshot {
    return { ...snap };
  },

  begin(label?: string) {
    set({ active: true, label: label || snap.label || 'AI working' });
    // Re-armed even when the snapshot did not change, so a long burst of identical
    // begins keeps the pill alive instead of timing out mid-run.
    if (safety) clearTimeout(safety);
    safety = setTimeout(() => AiActivity.end(), SAFETY_MS);
  },

  end() {
    if (safety) {
      clearTimeout(safety);
      safety = null;
    }
    set({ active: false, label: '' });
  }
};
