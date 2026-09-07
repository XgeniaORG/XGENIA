// Pure layout reducer for the left rail + panel card. No editor imports: tested with Node's
// runner. One panel shows at a time: `activeId` is the panel in the card, `homeId` is the panel
// a second click or Escape returns to (the chat), and `open` is whether the card shows at all.

export interface RailLayout {
  /** The panel currently in the card. */
  activeId: string;
  /** The panel a second click, or Escape, returns to. The chat. */
  homeId: string;
  /** Whether the card is showing at all. */
  open: boolean;
}

export type RailAction =
  | { type: 'click'; id: string }
  | { type: 'home' }
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'restore'; homeId: string; activeId: string; open: boolean };

/** The panel the user is looking at (or would be, if the card were open). */
export function activePanelId(state: RailLayout): string {
  return state.activeId;
}

export function reduceRailLayout(state: RailLayout, action: RailAction): RailLayout {
  switch (action.type) {
    case 'click': {
      if (action.id !== state.activeId) return { ...state, activeId: action.id, open: true };
      if (!state.open) return { ...state, open: true };
      if (state.activeId !== state.homeId) return { ...state, activeId: state.homeId };
      return { ...state, open: false };
    }
    case 'home':
      if (state.activeId === state.homeId && state.open) return state;
      return { ...state, activeId: state.homeId, open: true };
    case 'toggle':
      return { ...state, open: !state.open };
    case 'close':
      if (!state.open) return state;
      return { ...state, open: false };
    case 'restore':
      if (state.homeId === action.homeId && state.activeId === action.activeId && state.open === action.open) {
        return state;
      }
      return { homeId: action.homeId, activeId: action.activeId, open: action.open };
    default:
      return state;
  }
}
