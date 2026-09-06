/**
 * templateTagline.ts — one line saying what a template is.
 *
 * The template feed (`projecttemplates/index.json`) carries a `desc` written as marketing copy
 * for a full-width card:
 *
 *   "Begin your project with a crash game template that offers clear structure and easy
 *    customization for efficient development."
 *   "Start your project with a Wheel of Fortune game template featuring smooth spin mechanics,
 *    reward segments, and a flexible structure for rapid customization and development."
 *
 * On a tile that is one line, which means every template in the grid reads "Begin your project
 * with a…" and none of them says what it is. Every one of those sentences has the same shape,
 * and the useful part is the noun phrase in the middle.
 *
 * The durable fix is a `tagline` field on the feed itself, which this reads first. Until the
 * feed has one, the noun phrase is recovered here.
 */

/** How much of a tagline fits on a template tile. */
export const TEMPLATE_TAGLINE_MAX = 52;

/** "Begin your project with a …", "Start your project from the …". */
const OPENER =
  /^(?:you can\s+)?(?:begin|start|kick\s*off|jump\s*start)\s+(?:your|a|the)\s+(?:new\s+)?project\s+(?:with|from|using)\s+(?:the|an|a)?\s*/i;

/** A bare leading article, left behind by "A simple application template with…". */
const ARTICLE = /^(?:the|an|a)\s+/i;

/**
 * The word "template" and everything after it.
 *
 * Every one of these descriptions puts the noun phrase immediately before that word — "a crash
 * game template that offers…", "a Dark Alice themed slot game template crafted for…", "A simple
 * application template with just a Group and a Text node" — so this single cut does most of the
 * work, and it does not care which selling clause follows.
 */
const FROM_TEMPLATE = /\s*\btemplates?\b.*$/i;

/**
 * Where a description with no "template" in it stops describing and starts selling.
 *
 * "Slot engine TO SUPPORT your slot game development".
 */
const TAIL =
  /\s+(?:that\b|which\b|crafted\b|featuring\b|offering\b|designed\b|built\b|to support\b|for \w+ (?:development|customization|customisation)\b).*$/i;

/**
 * A one-line description of a template.
 *
 * `tagline` on the feed wins if it is ever added. Otherwise the marketing sentence is cut back
 * to its noun phrase. Returns '' when there is nothing usable — the tile then shows its title
 * alone, which is honest.
 */
export function templateTagline(item: { desc?: string; tagline?: string } | null | undefined): string {
  const provided = typeof item?.tagline === 'string' ? item.tagline.trim() : '';
  if (provided) return clamp(provided);

  const desc = typeof item?.desc === 'string' ? item.desc.trim() : '';
  if (!desc) return '';

  // First sentence only: everything after it is elaboration.
  let text = desc.split(/(?<=[.;])\s/)[0].trim();

  text = text.replace(OPENER, '');
  text = text.replace(FROM_TEMPLATE, '');
  text = text.replace(TAIL, '');
  text = text.replace(ARTICLE, '');
  text = text.replace(/[.,;:\s]+$/, '').trim();

  if (!text) return '';

  return clamp(text.charAt(0).toUpperCase() + text.slice(1));
}

function clamp(text: string): string {
  if (text.length <= TEMPLATE_TAGLINE_MAX) return text;

  const cut = text.slice(0, TEMPLATE_TAGLINE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TEMPLATE_TAGLINE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '')}…`;
}
