/**
 * lobbyMeta.core.ts — reading a game's identity out of its chat history.
 *
 * Split from `lobbyMeta.ts` so it can be tested: that module imports `@xgenia/platform` and the
 * shared Model base, neither of which loads outside the renderer. Everything here is arithmetic
 * over plain objects.
 */

/** One conversation as `.xgenia/chat/index.json` stores it. */
interface ChatIndexEntry {
  id?: string;
  title?: string;
  messageCount?: number;
  lastActivity?: number;
}

/** Taglines longer than this are ellipsised. One line on a card is about this many characters. */
export const TAGLINE_MAX = 68;

/**
 * Words a truncated title is allowed to end on being cut back to.
 *
 * The panel truncates titles with an ellipsis wherever it lands, so a tagline routinely ends
 * "…slot game called" or "…and what I". Trimming back past those is the difference between a
 * line that describes a game and one that stops mid-thought.
 */
const DANGLING = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'called', 'can', 'for', 'from', 'i',
  'in', 'is', 'it', 'like', 'me', 'my', 'named', 'of', 'on', 'or', 'so', 'that', 'the', 'their',
  'then', 'this', 'to', 'was', 'we', 'what', 'when', 'where', 'which', 'with', 'you', 'your'
]);

/**
 * Openers that address the AI rather than describe the game.
 *
 * Real titles from a profile here: "Build a polished 5-reel, 3-row slot game called…",
 * "So I want an amazing 5x3 reel game, and what I…". The instruction is noise; what follows it
 * is the description. The article alternation is longest-first on purpose — `a|an` matches the
 * "a" of "an" and leaves a stray "n" at the front of every tagline that used one.
 */
const OPENER =
  /^(?:so\s+)?(?:please\s+)?(?:can you\s+|could you\s+|help me\s+|let'?s\s+)?(?:build|create|make|design|generate|develop|implement|add|want|need)\s+(?:me\s+)?(?:to\s+(?:build|create|make)\s+)?(?:the|an|a)?\s*/i;

/** "So I want an X" / "I need a Y" — the pronoun form of the same opener. */
const PRONOUN_OPENER = /^(?:so\s+)?i\s+(?:want|need|would like)\s+(?:to\s+(?:build|create|make)\s+)?(?:the|an|a)?\s*/i;

/**
 * Turn a conversation title into a tagline.
 *
 * Titles are written from a prompt, so they open with an instruction to the AI and are cut off
 * by the panel at an arbitrary point. Both have to go before the remainder reads as a
 * description of a game.
 */
export function taglineFromTitle(title: string | undefined): string | undefined {
  if (!title || typeof title !== 'string') return undefined;

  const raw = title.trim();
  if (!raw) return undefined;

  // Whether the panel cut this off. A truncated title gets its dangling tail trimmed and its
  // ellipsis put back; a complete one is left as the author wrote it.
  const truncated = /(\.\.\.|…)$/.test(raw);

  let text = raw.replace(/[.…\s]+$/, '');
  if (!text) return undefined;

  text = text.replace(PRONOUN_OPENER, '').replace(OPENER, '');
  if (!text) return undefined;

  if (truncated) {
    // Cut back word by word: "…slot game called" and "…game, and what I" both end on words that
    // only make sense with what came after them.
    let words = text.split(/\s+/);
    while (words.length > 1 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[^a-z']/g, ''))) {
      words.pop();
    }
    text = words.join(' ').replace(/[,;:\-\s]+$/, '');
  }

  if (!text) return undefined;

  text = text.charAt(0).toUpperCase() + text.slice(1);

  if (text.length > TAGLINE_MAX) {
    // Cut at a word boundary rather than mid-word; fall back to a hard cut for one long token.
    const cut = text.slice(0, TAGLINE_MAX);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > TAGLINE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '')}…`;
  }

  return truncated ? `${text}…` : text;
}

/**
 * Fold a chat index into a tagline and a message count.
 *
 * Exported and pure so the parsing can be tested without a filesystem. The count sums every
 * conversation, because that is the honest measure of how much work went into a game.
 */
export function summariseChatIndex(raw: unknown): { tagline?: string; messageCount: number } {
  const list: ChatIndexEntry[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.conversations)
      ? (raw as any).conversations
      : [];

  let messageCount = 0;
  let first: ChatIndexEntry | undefined;

  for (const c of list) {
    if (!c || typeof c !== 'object') continue;

    const n = Number(c.messageCount);
    if (Number.isFinite(n) && n > 0) messageCount += n;

    // The OLDEST conversation, not the newest. Verified against real projects: the first
    // conversation is the one that says what the game is ("So I want an amazing 5x3 reel
    // game…"), and every later one is an edit to it ("I want you look at the reel
    // controller…"). Taking the newest produced taglines describing yesterday's bug fix.
    if (!first || Number(c.lastActivity || 0) < Number(first.lastActivity || 0)) first = c;
  }

  return { tagline: taglineFromTitle(first?.title), messageCount };
}
