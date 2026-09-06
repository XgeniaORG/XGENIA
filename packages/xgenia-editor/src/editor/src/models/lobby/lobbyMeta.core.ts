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
 * Turn a conversation title into a tagline.
 *
 * The titles are written from the first prompt, so they open with an instruction to the AI —
 * "Build a polished 5-reel…", "Create a crash game…". Stripping that opener is what turns a
 * command into a description of the thing. Titles are also already truncated with an ellipsis by
 * the panel, which has to come off before the length check or every tagline ends "slot game
 * called…" at exactly the wrong point.
 */
export function taglineFromTitle(title: string | undefined): string | undefined {
  if (!title || typeof title !== 'string') return undefined;

  let text = title.trim().replace(/[.…\s]+$/, '');
  if (!text) return undefined;

  // The article alternation is longest-first on purpose: `a|an` matches the "a" of "an" and
  // leaves a stray "n" at the front of every tagline that used one.
  text = text.replace(
    /^(?:please\s+)?(?:can you\s+)?(?:build|create|make|design|generate|develop|implement|add)\s+(?:me\s+)?(?:the|an|a)?\s*/i,
    ''
  );
  if (!text) return undefined;

  text = text.charAt(0).toUpperCase() + text.slice(1);

  if (text.length <= TAGLINE_MAX) return text;

  // Cut at a word boundary rather than mid-word; fall back to a hard cut for one long token.
  const cut = text.slice(0, TAGLINE_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > TAGLINE_MAX * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * Fold a chat index into a tagline and a message count.
 *
 * Exported and pure so the parsing can be tested without a filesystem. The newest conversation
 * wins the tagline — it describes what the project became, not what it started as — while the
 * count sums all of them, because that is the honest measure of how much work went in.
 */
export function summariseChatIndex(raw: unknown): { tagline?: string; messageCount: number } {
  const list: ChatIndexEntry[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as any)?.conversations)
      ? (raw as any).conversations
      : [];

  let messageCount = 0;
  let newest: ChatIndexEntry | undefined;

  for (const c of list) {
    if (!c || typeof c !== 'object') continue;

    const n = Number(c.messageCount);
    if (Number.isFinite(n) && n > 0) messageCount += n;

    if (!newest || Number(c.lastActivity || 0) > Number(newest.lastActivity || 0)) newest = c;
  }

  return { tagline: taglineFromTitle(newest?.title), messageCount };
}
