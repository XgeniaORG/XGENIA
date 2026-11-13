// Pure logic for the History panel. The undo queue is a list of entries plus a pointer: the
// pointer counts the applied entries, so entry i is applied when i < pointer. Unit-tested.

export type HistoryEntryState = 'done' | 'current' | 'undone';

export interface HistoryRow {
  index: number;
  label: string;
  state: HistoryEntryState;
}

/** Oldest first; the newest entry is the last row. */
export function historyRows(labels: readonly (string | undefined)[], pointer: number): HistoryRow[] {
  return labels.map((label, index) => ({
    index,
    label: formatHistoryLabel(label),
    state: index === pointer - 1 ? 'current' : index < pointer ? 'done' : 'undone'
  }));
}

/** The pointer that leaves `index` as the last applied entry. -1 is the Start row. */
export function pointerForEntry(index: number): number {
  return Math.max(0, index + 1);
}

export interface HistoryJump {
  kind: 'undo' | 'redo' | 'none';
  steps: number;
}

/** How to walk from `pointer` to `target`, clamped to the queue. */
export function historyJump(pointer: number, length: number, target: number): HistoryJump {
  const to = Math.max(0, Math.min(length, target));
  if (to < pointer) return { kind: 'undo', steps: pointer - to };
  if (to > pointer) return { kind: 'redo', steps: to - pointer };
  return { kind: 'none', steps: 0 };
}

/** Undo labels are free text from every call site ("drag nodes", "", undefined): tidy them. */
export function formatHistoryLabel(label: string | undefined): string {
  const text = typeof label === 'string' ? label.trim() : '';
  if (!text) return 'Change';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The toast after a jump, in the same words as Cmd+Z ("Undo drag nodes"). */
export function jumpToastText(jump: HistoryJump, lastLabel: string | undefined): string | null {
  if (jump.kind === 'none' || jump.steps === 0) return null;
  const verb = jump.kind === 'undo' ? 'Undo' : 'Redo';
  if (jump.steps === 1) return `${verb} ${typeof lastLabel === 'string' && lastLabel.trim() ? lastLabel.trim() : 'change'}`;
  return `${verb} ${jump.steps} steps`;
}
