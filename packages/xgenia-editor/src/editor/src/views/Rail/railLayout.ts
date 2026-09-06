// Pure layout reducer for the left rail + panel card. No editor imports: tested with
// Node's runner. `dockedId` is the panel that lives in the card; `peekId` is a panel shown
// in a second card in front of it; `open` is whether the docked card is visible at all.

export interface RailLayout {
  dockedId: string;
  peekId: string | null;
  open: boolean;
}

export type RailAction =
  | { type: 'click'; id: string }
  | { type: 'peek'; id: string }
  | { type: 'pin' }
  | { type: 'close' }
  | { type: 'esc' }
  | { type: 'toggle' }
  | { type: 'dock'; id: string };

/** The panel the user is looking at (or would be, if the card were open). */
export function activePanelId(state: RailLayout): string {
  return state.peekId ?? state.dockedId;
}

export function reduceRailLayout(state: RailLayout, action: RailAction): RailLayout {
  switch (action.type) {
    case 'click': {
      if (action.id === state.peekId) return { ...state, peekId: null };
      if (action.id === state.dockedId) {
        if (state.peekId) return { ...state, peekId: null, open: true };
        return { ...state, open: !state.open };
      }
      return { ...state, peekId: action.id, open: true };
    }
    case 'peek':
      return { ...state, peekId: action.id, open: true };
    case 'pin':
      if (!state.peekId) return state;
      return { dockedId: state.peekId, peekId: null, open: true };
    case 'close':
      if (state.peekId) return { ...state, peekId: null };
      return { ...state, open: false };
    case 'esc':
      return state.peekId ? { ...state, peekId: null } : state;
    case 'toggle':
      return { ...state, peekId: null, open: !state.open };
    case 'dock':
      return { dockedId: action.id, peekId: null, open: true };
    default:
      return state;
  }
}
