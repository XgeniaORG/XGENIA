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
  /** null when the splitter could not measure the layer's canvas. */
  canvasInRoot: LayoutBox | null;
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

// Words in a split layer's own name that name a role directly. Order matters: a name describes the
// OUTER thing last-to-first ("coin counter plate", "gem icon"), so the container and icon words are
// checked before the sprite nouns that often appear inside them; "title" alone is a logo only when
// nothing names a bar or panel.
const LAYER_NAME_ROLES: Array<[RegExp, BuiltInRole]> = [
  [/\b(background|backdrop|sky|floor)\b/i, 'background'],
  [/\b(logo|wordmark)\b/i, 'logo'],
  [/\b(icon)\b/i, 'icon'],
  [/\b(ui|hud|panel|button|frame|bar|plate)\b/i, 'ui'],
  [/\b(symbol|character|card|token|gem|coin|chip)\b/i, 'sprite'],
  [/\b(title)\b/i, 'logo']
];

/** Where the AI's split tool saves a piece when no slot matched. A folder a program picked, not a person. */
const SPLIT_DEFAULT_FOLDER = 'assets/ui';

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

  // 0. A split piece in the splitter's default folder: a program picked that folder, so the piece's
  //    own evidence — a role its layer name names, or background-sized coverage — decides first.
  const folder = input.path.split('/').slice(0, -1).join('/');
  if (folder === SPLIT_DEFAULT_FOLDER && input.lineage && input.lineage.depth >= 1) {
    const named = layerNameRole(input.lineage.layerName);
    if (named) return done(named);
    if (coversRoot(input.lineage)) return done('background');
  }

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
  if (input.lineage && input.lineage.depth >= 1) {
    return done(layerNameRole(input.lineage.layerName) ?? (coversRoot(input.lineage) ? 'background' : 'sprite'));
  }

  // 3. Extension class alone.
  if (input.kind === 'audio') return done('sfx');
  if (input.kind === 'video') return done('video');
  if (input.kind === 'font') return done('font');

  return done('other');
}

/** The role a split layer's own name names, if any. */
function layerNameRole(layerName: string | null | undefined): BuiltInRole | null {
  if (!layerName) return null;
  for (const [pattern, role] of LAYER_NAME_ROLES) if (pattern.test(layerName)) return role;
  return null;
}

/**
 * Does the piece cover most of its ROOT art? boxInRoot is fractions of the root (area 1), except in
 * records written before the fractions rule, which carried pixels against canvasInRoot. canvasInRoot
 * is null whenever the splitter could not measure the layer; reading `.width` off it threw and took
 * the whole index scan down (2026-09-17). A zero-area canvas is "unknown", never "tiny".
 */
function coversRoot(lineage: RoleInferenceLineage): boolean {
  const box = lineage.boxInRoot;
  if (!box) return false;
  const fractions = box.x + box.width <= 1.002 && box.y + box.height <= 1.002;
  const canvas = lineage.canvasInRoot;
  const canvasArea = fractions ? 1 : canvas ? canvas.width * canvas.height : 0;
  return canvasArea > 0 && (box.width * box.height) / canvasArea >= BACKGROUND_COVERAGE;
}
