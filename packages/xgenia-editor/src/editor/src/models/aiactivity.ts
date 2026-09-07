// src/editor/src/models/aiactivity.ts — "is the AI working right now?"
//
// Fed by EditorBridge: every command the chat panel sends is a sign of life, and the
// mutating ones supply a better label. Read by the topbar status pill.
//
// The editor cannot see the model thinking — the panel iframe posts only 'command' and
// 'handshake' — so activity is inferred from command traffic and ends on an idle
// window. That is why a turn made entirely of read-only tools still lights the pill,
// which an earlier version tied to undo bursts and therefore missed completely.
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

/**
 * Quiet period that ends a turn. Commands within one turn arrive far closer together
 * than this; the gap to the next user prompt is far longer. Deliberately longer than
 * EditorBridge's 1500ms undo-group window, so the pill does not blink off between the
 * tool batches of a single turn.
 */
const IDLE_MS = 4000;

let snap: AiActivitySnapshot = { active: false, label: '' };
let safety: ReturnType<typeof setTimeout> | null = null;
let idle: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (safety) {
    clearTimeout(safety);
    safety = null;
  }
  if (idle) {
    clearTimeout(idle);
    idle = null;
  }
}

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

  /**
   * Report a sign of life. `label` upgrades the description; a call without one keeps
   * whatever label is already showing, so a read-only command in the middle of an edit
   * burst does not downgrade "Building reel strip" to the generic text.
   */
  begin(label?: string) {
    set({ active: true, label: label || snap.label || 'AI working' });
    // Re-armed on every call, so a long turn keeps the pill alive instead of timing out
    // mid-run, and a turn that simply stops is cleaned up by the idle window.
    clearTimers();
    idle = setTimeout(() => AiActivity.end(), IDLE_MS);
    safety = setTimeout(() => AiActivity.end(), SAFETY_MS);
  },

  end() {
    clearTimers();
    set({ active: false, label: '' });
  }
};
