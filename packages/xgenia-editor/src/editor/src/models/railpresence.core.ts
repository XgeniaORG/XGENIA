// Which rail item an AI tool call belongs to, and the "changed since you looked" counters.
// Pure; no editor imports.

const FAMILIES: Array<[RegExp, string]> = [
  [/^fs\.write(File|Json|FileBinary)$/, 'assets'],
  [/^assetMeta\./, 'assets'],
  [/^imageEditor\./, 'image-editor'],
  [/^fal\./, 'image-editor'],
  [/^gemini\./, 'image-editor'],
  [/^style\./, 'project-styles'],
  [/^xrgs\./, 'maths-panel'],
  [/^component\./, 'components'],
  [/^nodelibrary\./, 'components'],
  [/^git\.(commit|push)$/, 'versioncontrol']
];

export function familyOf(command: string): string | null {
  if (!command) return null;
  for (const [re, panelId] of FAMILIES) if (re.test(command)) return panelId;
  return null;
}

export interface PresenceEntry {
  unseen: number;
  lastAt: number;
}
export type PresenceState = Record<string, PresenceEntry>;
export type PresenceEvent =
  | { type: 'command'; panelId: string; at: number }
  | { type: 'seen'; panelId: string };

export function reducePresence(state: PresenceState, ev: PresenceEvent): PresenceState {
  if (ev.type === 'command') {
    const prev = state[ev.panelId] ?? { unseen: 0, lastAt: 0 };
    return { ...state, [ev.panelId]: { unseen: prev.unseen + 1, lastAt: ev.at } };
  }
  const prev = state[ev.panelId];
  if (!prev || prev.unseen === 0) return state;
  return { ...state, [ev.panelId]: { unseen: 0, lastAt: prev.lastAt } };
}
