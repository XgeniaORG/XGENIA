// Pure. No editor imports — this file is unit-tested with Node's runner.

export type RouteInfo = { path: string; title: string; componentName?: string; nodeCount?: number };
export type PresetLite = { name: string; group: string; width: number | null; height: number | null };
export type CommandId =
  | 'preset' | 'fit' | 'size' | 'zoom' | 'detach' | 'split' | 'devtools' | 'import' | 'publish' | 'refresh';

export type TopbarMatch =
  | { kind: 'route'; path: string; title: string }
  | { kind: 'command'; id: 'preset'; group: PresetGroup; label: string }
  | { kind: 'command'; id: 'size'; width: number; height: number; label: string }
  | { kind: 'command'; id: 'zoom'; factor: number; label: string }
  | { kind: 'command'; id: 'split'; direction: 'vertical' | 'horizontal'; label: string }
  | { kind: 'command'; id: 'fit' | 'detach' | 'devtools' | 'import' | 'publish' | 'refresh'; label: string }
  | { kind: 'none' };

/** Groups the bar can jump to by name. A machine group resolves to the first preset in
 *  its family — the shape everything else in that family is a variation of. */
export type PresetGroup = 'Slot' | 'Table' | 'Betting' | 'Bingo' | 'Arcade' | 'Mobile' | 'Tablet' | 'Desktop';

const MIN_SIDE = 320;
const MAX_W = 3840;
// 3840 both ways: a slot cabinet screen is a 4K panel stood on its end (2160x3840).
const MAX_H = 3840;

/** The industry words deliberately kept OUT of the preset labels live here instead:
 *  type `etg` or `ssbt` and you land on the right shape without the UI ever printing
 *  the jargon at someone who does not know it. */
const PRESET_WORDS: Record<string, PresetGroup> = {
  slot: 'Slot', cabinet: 'Slot', reels: 'Slot', egm: 'Slot', agm: 'Slot',
  table: 'Table', roulette: 'Table', etg: 'Table', blackjack: 'Table',
  betting: 'Betting', sportsbook: 'Betting', ssbt: 'Betting', kiosk: 'Betting', terminal: 'Betting',
  bingo: 'Bingo', lottery: 'Bingo', vlt: 'Bingo',
  arcade: 'Arcade',
  phone: 'Mobile', mobile: 'Mobile', iphone: 'Mobile',
  tablet: 'Tablet', ipad: 'Tablet',
  desktop: 'Desktop', pc: 'Desktop'
};

/** Plain-word name for a group, for the label a match carries into the suggestion list. */
const PRESET_NOUNS: Record<PresetGroup, string> = {
  Slot: 'Slot cabinet',
  Table: 'Roulette terminal',
  Betting: 'Betting terminal',
  Bingo: 'Bingo unit',
  Arcade: 'Arcade upright',
  Mobile: 'Phone',
  Tablet: 'Tablet',
  Desktop: 'Desktop'
};

const PLAIN: Record<string, TopbarMatch> = deepFreeze({
  fit: { kind: 'command', id: 'fit', label: 'Fit to window' },
  detach: { kind: 'command', id: 'detach', label: 'Detach preview' },
  devtools: { kind: 'command', id: 'devtools', label: 'Open dev tools' },
  import: { kind: 'command', id: 'import', label: 'Import design' },
  publish: { kind: 'command', id: 'publish', label: 'Publish' },
  refresh: { kind: 'command', id: 'refresh', label: 'Refresh preview' }
});

/** Freeze the table and every entry in it, preserving the declared type. */
function deepFreeze(table: Record<string, TopbarMatch>): Record<string, TopbarMatch> {
  Object.values(table).forEach((m) => Object.freeze(m));
  return Object.freeze(table);
}

/** Frozen: both exports hand these back by reference, and a consumer that decorates a
 *  match in place (adding `selected`, sorting, annotating) would otherwise rewrite the
 *  parser's own tables for the rest of the session. */
const ALL_COMMANDS: readonly TopbarMatch[] = ([
  { kind: 'command', id: 'preset', group: 'Mobile', label: 'Phone preview' },
  { kind: 'command', id: 'fit', label: 'Fit to window' },
  { kind: 'command', id: 'detach', label: 'Detach preview' },
  // After 'detach': the first three entries are what an empty bar suggests, and that
  // default trio is pinned by a test.
  { kind: 'command', id: 'preset', group: 'Slot', label: 'Slot cabinet preview' },
  { kind: 'command', id: 'preset', group: 'Table', label: 'Roulette terminal preview' },
  { kind: 'command', id: 'preset', group: 'Betting', label: 'Betting terminal preview' },
  { kind: 'command', id: 'preset', group: 'Bingo', label: 'Bingo unit preview' },
  { kind: 'command', id: 'preset', group: 'Arcade', label: 'Arcade upright preview' },
  { kind: 'command', id: 'preset', group: 'Tablet', label: 'Tablet preview' },
  { kind: 'command', id: 'preset', group: 'Desktop', label: 'Desktop preview' },
  { kind: 'command', id: 'split', direction: 'vertical', label: 'Split vertically' },
  { kind: 'command', id: 'split', direction: 'horizontal', label: 'Split horizontally' },
  PLAIN.devtools, PLAIN.import, PLAIN.publish, PLAIN.refresh
] as TopbarMatch[]).map((m) => Object.freeze(m));

function stripHash(p: string): string {
  return p.replace(/^\/#/, '');
}

function parseCommand(raw: string): TopbarMatch {
  const t = raw.toLowerCase();
  if (PRESET_WORDS[t]) {
    const group = PRESET_WORDS[t];
    return { kind: 'command', id: 'preset', group, label: `${PRESET_NOUNS[group]} preview` };
  }
  if (PLAIN[t]) return PLAIN[t];

  const size = /^(\d{2,4})\s*[x×]\s*(\d{2,4})$/i.exec(t);
  if (size) {
    const width = Number(size[1]);
    const height = Number(size[2]);
    if (width >= MIN_SIDE && width <= MAX_W && height >= MIN_SIDE && height <= MAX_H) {
      return { kind: 'command', id: 'size', width, height, label: `${width} × ${height}` };
    }
    return { kind: 'none' };
  }

  const zoom = /^zoom\s+(\d+(?:\.\d+)?)%?$/.exec(t);
  if (zoom) {
    const n = Number(zoom[1]);
    const factor = n > 1 ? n / 100 : n;
    if (factor >= 0.1 && factor <= 1) return { kind: 'command', id: 'zoom', factor, label: `Zoom ${Math.round(factor * 100)}%` };
    return { kind: 'none' };
  }

  const split = /^split\s+(v|vertical|h|horizontal)$/.exec(t);
  if (split) {
    const direction = split[1].startsWith('v') ? 'vertical' : 'horizontal';
    return { kind: 'command', id: 'split', direction, label: `Split ${direction === 'vertical' ? 'vertically' : 'horizontally'}` };
  }
  return { kind: 'none' };
}

function parseRoute(raw: string, routes: RouteInfo[]): TopbarMatch {
  const t = raw.toLowerCase();
  const sorted = [...routes].sort((a, b) => a.path.localeCompare(b.path));
  const exact = sorted.find((r) => r.path.toLowerCase() === t || stripHash(r.path).toLowerCase() === t);
  if (exact) return { kind: 'route', path: exact.path, title: exact.title };
  const prefix = sorted.find(
    (r) =>
      r.path.toLowerCase().startsWith(t) ||
      stripHash(r.path).toLowerCase().startsWith(t) ||
      r.title.toLowerCase().startsWith(t)
  );
  if (prefix) return { kind: 'route', path: prefix.path, title: prefix.title };

  // Anything path-shaped navigates even when it matches no known page. The bar this
  // replaces was a free-text URL field, and routes are frequently typed before they
  // are indexed — a Router path with a parameter, a page added seconds ago, a deep
  // link a designer was given. Refusing to navigate would be a silent no-op on Enter.
  if (raw.startsWith('/') || raw.startsWith('#')) {
    return { kind: 'route', path: raw, title: raw };
  }
  return { kind: 'none' };
}

export function parseTopbarInput(text: string, ctx: { routes: RouteInfo[] }): TopbarMatch {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };
  const cmd = parseCommand(raw);
  if (cmd.kind !== 'none') return cmd;
  return parseRoute(raw, ctx.routes);
}

export function suggestCommands(text: string, _ctx: { routes: RouteInfo[] }, limit = 3): TopbarMatch[] {
  // Array.slice(0, -1) drops the last element rather than returning nothing, so a
  // non-positive limit has to be handled before it reaches slice.
  const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0;
  if (n === 0) return [];
  const t = text.trim().toLowerCase();
  if (!t) return ALL_COMMANDS.slice(0, n);
  return ALL_COMMANDS.filter((m) => m.kind === 'command' && m.label.toLowerCase().includes(t)).slice(0, n) as TopbarMatch[];
}
