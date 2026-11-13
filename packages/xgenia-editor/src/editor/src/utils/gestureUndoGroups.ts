import { UndoActionGroup, UndoQueue } from '../models/undo-queue-model';

/** How long consecutive nudges of the same selection keep landing in one undo entry. */
export const NUDGE_COALESCE_MS = 1000;

export interface GestureGroupRequest {
  label?: string;
  /** A follow-up write of the gesture that returned this id (the preload's resize correction). */
  amendGroupId?: string;
  /** Requests sharing this key within NUDGE_COALESCE_MS join one entry (arrow-key nudges). */
  coalesce?: string;
}

/**
 * One user action, one undo entry, for writes made from the viewport. A resize whose anchor
 * shifted the element is followed by a corrective move, and a held arrow key sends a nudge per
 * repeat; Cmd+Z should take back the whole action either way. A follow-up joins the entry on
 * top of the history only while that entry is still the latest one — anything recorded in
 * between (a property edit, an AI change, an undo) starts a fresh entry.
 */
export class GestureUndoGroups {
  private last: { id: string; group: UndoActionGroup; coalesce: string | null; at: number } | null = null;
  private seq = 0;

  constructor(
    private readonly queue: UndoQueue = UndoQueue.instance,
    private readonly now: () => number = Date.now
  ) {}

  /** The group a gesture's writes go into; `reused` groups are already in the history. */
  begin(req: GestureGroupRequest): { group: UndoActionGroup; reused: boolean } {
    const reusable = this.reusable(req);
    if (reusable) return { group: reusable, reused: true };
    return { group: new UndoActionGroup({ label: req.label || 'Edit in viewport' }), reused: false };
  }

  /** After the writes: records a new non-empty group. Returns its id, or null when nothing was written. */
  end(group: UndoActionGroup, reused: boolean, req: GestureGroupRequest): string | null {
    if (group.isEmpty()) return null;
    if (!reused) this.queue.push(group);
    let id: string;
    if (this.last && this.last.group === group) {
      id = this.last.id;
    } else {
      this.seq += 1;
      id = 'g' + this.seq;
    }
    this.last = { id, group, coalesce: req.coalesce || null, at: this.now() };
    return id;
  }

  private reusable(req: GestureGroupRequest): UndoActionGroup | null {
    const last = this.last;
    if (!last) return null;
    const ptr = this.queue.getHistoryLocation();
    if (ptr === 0 || this.queue.getHistory()[ptr - 1] !== last.group) return null;
    if (req.amendGroupId && req.amendGroupId === last.id) return last.group;
    if (req.coalesce && req.coalesce === last.coalesce && this.now() - last.at < NUDGE_COALESCE_MS) return last.group;
    return null;
  }
}
