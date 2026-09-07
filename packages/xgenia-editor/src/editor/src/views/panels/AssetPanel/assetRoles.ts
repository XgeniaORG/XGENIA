// What an asset IS in a game, independent of where it sits on disk.
//
// XGENIA builds slots, crash games, card games, arcade titles and more, so this
// vocabulary is deliberately generic: `sprite` covers a slot symbol, a character, a
// playing card and a physics prop alike. Adding a game-specific role here is a mistake —
// a project that needs one adds a CUSTOM role string instead (see AssetRole below).

export const BUILT_IN_ROLES = [
  'keyart',
  'background',
  'sprite',
  'ui',
  'icon',
  'logo',
  'sfx',
  'music',
  'video',
  'font',
  'other'
] as const;

export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

/** A built-in role, or a project-defined custom role string. */
export type AssetRole = BuiltInRole | (string & {});

export function isBuiltInRole(value: string): value is BuiltInRole {
  return (BUILT_IN_ROLES as readonly string[]).includes(value);
}

const ROLE_LABELS: Record<BuiltInRole, string> = {
  keyart: 'Key art',
  background: 'Backgrounds',
  sprite: 'Sprites',
  ui: 'UI',
  icon: 'Icons',
  logo: 'Logos',
  sfx: 'SFX',
  music: 'Music',
  video: 'Video',
  font: 'Fonts',
  other: 'Other'
};

/** Display name for a role chip. Custom roles are sentence-cased from their slug. */
export function roleLabel(role: string): string {
  if (isBuiltInRole(role)) return ROLE_LABELS[role];
  const words = role.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Other';
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoleInferenceLineage {
  depth: number;
  layerName: string | null;
  boxInRoot: LayoutBox;
  canvasInRoot: LayoutBox;
}

export interface RoleInferenceInput {
  /** Project-relative path, e.g. 'assets/ui/panel.png'. */
  path: string;
  /** Extension class from asset-classification.ts. */
  kind: 'image' | 'audio' | 'font' | 'video' | 'document' | 'unknown';
  /** Present only for assets cut out of other art. */
  lineage?: RoleInferenceLineage;
}

// Folder segment → role. Checked against every segment, deepest first, so
// 'assets/ui/icons/close.png' is an icon rather than ui.
const FOLDER_ROLES: Array<[RegExp, BuiltInRole]> = [
  [/^(keyart|key-art|key_art|hero)$/, 'keyart'],
  [/^(backgrounds?|bg|backdrops?)$/, 'background'],
  [/^(symbols?|sprites?|characters?|props?|pieces?|cards?|tokens?)$/, 'sprite'],
  [/^(ui|hud|panels?|buttons?)$/, 'ui'],
  [/^icons?$/, 'icon'],
  [/^(logos?|titles?)$/, 'logo'],
  [/^(sfx|sounds?|audio)$/, 'sfx'],
  [/^music$/, 'music'],
  [/^videos?$/, 'video'],
  [/^fonts?$/, 'font']
];

// Words in a split layer's own name that name a role directly.
const LAYER_NAME_ROLES: Array<[RegExp, BuiltInRole]> = [
  [/\b(ui|hud|panel|button|frame|bar)\b/i, 'ui'],
  [/\b(icon)\b/i, 'icon'],
  [/\b(logo|title|wordmark)\b/i, 'logo'],
  [/\b(background|backdrop|sky|floor)\b/i, 'background']
];

/** A piece covering at least this share of its root canvas reads as a background plate. */
const BACKGROUND_COVERAGE = 0.8;

/**
 * Best guess at an asset's role. ALWAYS reports `inferred: true` — an authored role never
 * comes from here, and the caller must not store this without the `roleInferred` flag, or
 * a later scan will silently overwrite what the user chose.
 *
 * Order is deliberate: an explicit folder is the strongest signal a human left, so it beats
 * lineage geometry, which in turn beats the bare file extension.
 */
export function inferRole(input: RoleInferenceInput): { role: AssetRole; inferred: true } {
  const done = (role: AssetRole) => ({ role, inferred: true as const });

  // 1. Folder segments, deepest first. The filename itself is excluded.
  const segments = input.path.split('/').slice(0, -1).filter((s) => s && s !== 'assets');
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i].toLowerCase();
    for (const [pattern, role] of FOLDER_ROLES) {
      if (pattern.test(seg)) {
        // 'sfx'/'sounds' and 'music' are audio words; do not let them retype an image.
        if ((role === 'sfx' || role === 'music') && input.kind !== 'audio') continue;
        return done(role);
      }
    }
  }

  // 2. Lineage: what the split said, then how much of the root canvas it covers.
  const lineage = input.lineage;
  if (lineage && lineage.depth >= 1) {
    if (lineage.layerName) {
      for (const [pattern, role] of LAYER_NAME_ROLES) {
        if (pattern.test(lineage.layerName)) return done(role);
      }
    }
    const canvasArea = lineage.canvasInRoot.width * lineage.canvasInRoot.height;
    const boxArea = lineage.boxInRoot.width * lineage.boxInRoot.height;
    // A zero-area canvas means the endpoint gave us nothing usable. Do not divide by it,
    // and do not read "0 coverage" as a meaningful small piece.
    if (canvasArea > 0 && boxArea / canvasArea >= BACKGROUND_COVERAGE) return done('background');
    return done('sprite');
  }

  // 3. Extension class alone.
  if (input.kind === 'audio') return done('sfx');
  if (input.kind === 'video') return done('video');
  if (input.kind === 'font') return done('font');

  return done('other');
}
