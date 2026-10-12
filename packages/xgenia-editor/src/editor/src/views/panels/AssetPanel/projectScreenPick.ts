// Which screen size turns a 0..1 placement into pixels. Pure.
//
// The bible's `screen` is a decision someone made and every split inherits it, so it wins. The
// device pinned in the top bar is the user's visible choice and is the next best. A measured
// preview-pane size is NOT used: a docked panel and a phone preset measure alike.

export interface ProjectScreen {
  width: number;
  height: number;
  source: 'bible' | 'pinned';
}

const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function pickProjectScreen(bible: any, pinned: any): ProjectScreen | null {
  const w = Number(bible?.screen?.width);
  const h = Number(bible?.screen?.height);
  if (usable(w) && usable(h)) return { width: Math.round(w), height: Math.round(h), source: 'bible' };
  if (usable(pinned?.width) && usable(pinned?.height)) {
    return { width: Math.round(pinned.width), height: Math.round(pinned.height), source: 'pinned' };
  }
  return null;
}
