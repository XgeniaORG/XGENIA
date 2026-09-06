// "The AI just touched this panel's domain." Fed by EditorBridge for every tool command;
// read by the rail for the amber dot and the tooltip count. The Version control family
// only recounts the git badge (Task 14), so it is never left "unseen".
import { EventDispatcher } from '../../../shared/utils/EventDispatcher';
import { familyOf, PresenceState, reducePresence } from './railpresence.core';

let state: PresenceState = {};

function set(next: PresenceState) {
  if (next === state) return;
  state = next;
  EventDispatcher.instance.emit('rail-presence-changed', { ...state });
}

export const RailPresence = {
  getSnapshot(): PresenceState {
    return { ...state };
  },
  noteCommand(command: string, at: number = Date.now()) {
    const panelId = familyOf(command);
    if (!panelId || panelId === 'versioncontrol') return;
    set(reducePresence(state, { type: 'command', panelId, at }));
  },
  markSeen(panelId: string) {
    set(reducePresence(state, { type: 'seen', panelId }));
  },
  reset() {
    set({});
  }
};
