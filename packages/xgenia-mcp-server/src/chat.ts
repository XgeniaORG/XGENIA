import type { Frame, Page } from 'playwright-core';
import { connect, getChatFrame } from './connection.js';
import { SELECTORS } from './selectors.js';
import {
  readChatState,
  summariseMessages,
  waitForChatReady,
  type ChatMessage,
  type ChatMessageOut,
  type ChatState
} from './editor-state.js';

const MESSAGE_CAP = 2000;
const DEFAULT_TAIL_LIMIT = 5;

/**
 * How long `chatRead`/`chatSend`/`chatWaitIdle` retry when the chat panel is
 * not yet ready before giving up and reporting `chat-frame-missing`.
 *
 * Deliberately much shorter than `openProject`'s chat-readiness wait
 * (project.ts's `CHAT_READY_TIMEOUT_MS`): a caller that opened the project
 * through this harness has already waited out the mounting race documented
 * there, so by the time these functions are reached directly the panel is
 * normally already up. This is a smaller safety net for a caller that skips
 * that step, or catches a fresh toggle of the panel mid-mount — not the
 * primary wait.
 */
const CHAT_FRAME_RETRY_MS = 6_000;

/**
 * Chrome lines the panel prints in and around the transcript.
 *
 * These carry no conversation content and change on every render (costs, token
 * counts, "N older messages" counters), so keeping them would make every read
 * look different from the last. They can appear anywhere in the innerText —
 * not just as a leading preamble — so every line is checked, not only a
 * leading run.
 */
const CHROME = [
  /^▶$/,
  /^Chat \(\d+ messages?\)$/,
  /^\$[\d.]+$/,
  /^Dashboard$/,
  /^[\d.]+% of context$/,
  /^[\d.]+k \/ [\d.]+k · \d+ msgs$/,
  /^Load \d+ older messages?$/,
  /^Showing last \d+ of \d+ messages for performance\.?(\s*Full conversation saved\.?)?$/,
  /^Full conversation saved\.?$/
];

/**
 * Fallback parser for a panel that renders no `.message-container` elements at
 * all (unexpected version, or one that only exposes the flat transcript).
 *
 * The panel exposes no per-message role in plain innerText, so the whole body
 * comes back as one block with role 'unknown' — inventing 'assistant' here
 * would be a confident guess with nothing behind it. `readStructuredMessages`
 * is the real path; this is only reached when that finds zero containers.
 */
export function parseTranscript(innerText: string): ChatMessage[] {
  const lines = innerText.split('\n');
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (trimmed === '') return false;
    return !CHROME.some((re) => re.test(trimmed));
  });
  const body = kept.join('\n').trim();
  if (!body) return [];
  return [{ role: 'unknown', text: body }];
}

interface RawMessageRow {
  /** The message container's parent element's class list, as read live. */
  parentClasses: string[];
  text: string;
}

/**
 * A container's parent class is the only role signal the DOM exposes.
 * `assistant-group` means assistant; nothing marks a user turn (there is no
 * `user-group` and no `data-*` role attribute), so anything else is
 * 'unknown' rather than an assumed 'user'.
 */
function mapRawRow(row: RawMessageRow): ChatMessage {
  return {
    role: row.parentClasses.includes('assistant-group') ? 'assistant' : 'unknown',
    text: row.text.trim()
  };
}

/**
 * Read the transcript as real per-message DOM nodes: one `.message-container`
 * per message, matching `messageCount` exactly. This is what makes "the last
 * reply" reachable at all — the innerText blob has no message boundaries, so
 * `parseTranscript` alone could never return less than the entire transcript.
 */
export async function readStructuredMessages(frame: Frame): Promise<ChatMessage[]> {
  const rows = (await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.message-container')).map((el) => ({
      parentClasses: el.parentElement ? Array.from(el.parentElement.classList) : [],
      text: (el as HTMLElement).innerText
    }))
  )) as RawMessageRow[];

  if (rows.length === 0) {
    // Structured query found nothing — degrade to the whole-blob parse
    // instead of reporting an empty transcript.
    const raw = (await frame.evaluate(() => document.body.innerText)) as string;
    return parseTranscript(raw);
  }

  return rows.map(mapRawRow);
}

/**
 * Which absolute index to start a read from when the caller did not specify
 * `since`. Monitoring a live conversation wants the newest messages, so the
 * default is the tail of the transcript, not the head — the head is what a
 * naive `since ?? 0` gives you, and it is useless for "what did it just say".
 */
export function resolveReadWindow(total: number, since: number | undefined, limit: number): number {
  if (since !== undefined) return since;
  return Math.max(0, total - limit);
}

function fail(code: string, tried: string, hint: string) {
  return { error: code, tried, hint };
}

/** Collapse runs of whitespace to a single space and trim, so a re-wrapped or reflowed render still compares equal to the original. */
export function normaliseWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

/**
 * Strip the markdown punctuation the panel CONSUMES when it renders.
 *
 * (2026-09-06) Sending `/#__maths__/NeonMaths` reported the send unconfirmed — the input had
 * cleared and the message was plainly in the transcript, but `promptFoundInTranscript` was false.
 * The panel renders `__maths__` as BOLD, so the rendered text reads `/#maths/NeonMaths` and the
 * underscores the comparison was looking for no longer exist anywhere on screen. The send was
 * fine; the check was wrong, and it reported a real success as a possible failure.
 *
 * So the emphasis characters are removed from BOTH sides before comparing: what was typed and
 * what was rendered. This costs a little precision — two prompts differing only in emphasis
 * punctuation now compare equal — which is the right trade for a confirmation whose job is to
 * avoid claiming a send that did not happen, not to fingerprint the prompt.
 */
export function stripMarkdownEmphasis(s: string): string {
  return s
    .replace(/[*_]{1,3}/g, '')   // bold / italic / bold-italic, in either character
    .replace(/`+/g, '')          // inline code and fences
    .replace(/~~/g, '');         // strikethrough
}

/** Both normalisations, in the order the comparison uses them. */
function comparable(s: string): string {
  return stripMarkdownEmphasis(normaliseWhitespace(s));
}

/**
 * How much of the sent text must match, whitespace-normalised, in the
 * rendered transcript to count as confirmed. Long enough that a coincidental
 * substring match is unlikely, short enough to survive the panel truncating a
 * long prompt or inserting markup between words partway through it — so a
 * whole-string match would false-negative on a prompt that genuinely landed.
 */
export const CONFIRM_SLICE_LEN = 60;

/** The leading, whitespace-normalised slice of `text` that `transcriptContainsPrompt` looks for. */
export function promptSlice(text: string, maxLen: number = CONFIRM_SLICE_LEN): string {
  return comparable(text).slice(0, maxLen);
}

/**
 * Whether the transcript shows the sent prompt actually landed.
 *
 * Matches a leading, whitespace-normalised slice of `sentText` against the
 * whitespace-normalised `transcriptText`, never the whole string: the panel
 * may re-wrap or collapse whitespace on either side, and for a long prompt it
 * may truncate the rendered copy or insert markup mid-string, so anchoring on
 * the complete text would false-negative on a prompt that genuinely landed.
 * An empty (or whitespace-only) `sentText` has nothing distinctive to look
 * for, so it never confirms.
 */
export function transcriptContainsPrompt(transcriptText: string, sentText: string): boolean {
  const slice = promptSlice(sentText);
  if (!slice) return false;
  return comparable(transcriptText).includes(slice);
}

export interface SendConfirmation {
  confirmed: boolean;
  inputCleared: boolean;
  promptFoundInTranscript: boolean;
  /**
   * Whether the INPUT itself still holds the prompt text.
   *
   * The transcript check reads the whole frame body, and the input is contenteditable — so before
   * a submit the typed text is in that body too. This is what tells the two apart: a match in the
   * body while the input no longer holds the text can only have come from the transcript.
   */
  inputStillHoldsPrompt: boolean;
  matchedSlice: string;
}

/**
 * Poll the chat frame for the two facts that together confirm a send: the
 * input actually cleared, and the sent text actually rendered into the
 * transcript. Bounded by `deadlineMs` from the moment this is called.
 *
 * This replaced a `messageCount`-based check (`now.messageCount >
 * before.messageCount || now.busy`) that broke in exactly the situation it
 * was written for. `messageCount` — the count of
 * `[aria-label="Copy message to clipboard"]` elements — is NOT monotonic: the
 * panel virtualises its transcript ("Showing last 100 of N messages"), so the
 * count moves in both directions as the list re-renders; measured live across
 * a single send, it went 19 down to 17. And `|| now.busy` made that
 * (already-unsound) count irrelevant on precisely the busy-panel case `force`
 * exists for, since a busy panel makes the whole OR trivially true regardless
 * of whether anything was actually sent. Evidence here is instead: did the
 * input clear, and does the sent text (or a distinctive leading slice of it —
 * see `transcriptContainsPrompt`) now appear in the rendered transcript. Both
 * conditions are read from the SAME iteration before declaring success, so by
 * the time `promptFoundInTranscript` is true alongside `inputCleared`, the
 * input has already emptied and cannot be the (contenteditable, so
 * text-bearing) source of that match — the transcript body is what's left.
 */
/**
 * How long to wait for the panel to both clear the input and render the message.
 *
 * (2026-09-06) This was 10s, which is fine for a warm panel and not for a cold one: the first
 * send after an editor restart timed out while the message was, in fact, already in the
 * transcript — the panel was still finishing its boot and had not painted it yet.
 */
export const CONFIRM_DEADLINE_MS = 25_000;

/**
 * What an unconfirmed send actually means, and whether resending is safe.
 *
 * (2026-09-06) The old failure said "The prompt may not have been sent" for BOTH unconfirmed
 * shapes, and that is only true for one of them. The chat input is cleared by the panel's own
 * submit handler, so `inputCleared` is the panel saying it took the text. When it is true and only
 * the rendered copy is missing, the message is on its way to a model — and telling the caller it
 * might not have been sent is an invitation to send it a second time, which costs a second turn,
 * doubles the transcript, and can leave two builds racing each other in the same project.
 *
 * So the two are reported as what they are: one is "sent, not yet visible — read, do not resend",
 * the other is "never submitted — resending is safe".
 */
export function describeUnconfirmedSend(c: {
  inputCleared: boolean;
  promptFoundInTranscript: boolean;
  inputStillHoldsPrompt?: boolean;
}): { code: 'render-lag' | 'not-submitted'; hint: string } {
  // (2026-09-06, second pass) The first version keyed only on `inputCleared`, and live use
  // immediately produced its mirror image: `inputCleared: false` on a send whose prompt was
  // already in the transcript and being answered. Advising a resend there is the same expensive
  // mistake in the other direction. The transcript is the stronger evidence, so it is read first.
  if (c.promptFoundInTranscript && !c.inputStillHoldsPrompt) {
    return {
      code: 'render-lag',
      hint:
        'The prompt is already in the transcript and is no longer in the input, so it WAS sent — '
        + 'only the input\'s cleared flag did not confirm it in time. Treat this as SENT: read with '
        + 'xgenia_chat_read or wait with xgenia_chat_wait_idle. Do NOT send it again.',
    };
  }
  if (c.inputCleared) {
    return {
      code: 'render-lag',
      hint:
        'The panel cleared the input, which is its own submit handler acknowledging the text, but '
        + 'the message had not been painted into the transcript before the wait ran out — usually a '
        + 'panel that is still finishing its boot. Treat this as SENT. Read the transcript with '
        + 'xgenia_chat_read (or wait with xgenia_chat_wait_idle) before doing anything else. Do NOT '
        + 'send it again: that would run a second turn on the same request.',
    };
  }
  return {
    code: 'not-submitted',
    hint:
      'The input still holds the text, so the panel never submitted it — the send did not happen. '
      + 'Check xgenia_probe for the input and send selectors, then send again; a resend here is safe.',
  };
}

export async function confirmSent(
  frame: Frame,
  text: string,
  deadlineMs = CONFIRM_DEADLINE_MS,
  pollMs = 250
): Promise<SendConfirmation> {
  const slice = promptSlice(text);
  const deadline = Date.now() + deadlineMs;
  let cleared = false;
  let promptFound = false;
  let inputHolds = false;
  while (Date.now() < deadline) {
    const read = await frame
      .evaluate(
        (sel) => {
          const el = document.querySelector(sel);
          return {
            cleared: el?.getAttribute('data-empty') === 'true',
            inputText: (el as HTMLElement | null)?.innerText ?? '',
            bodyText: document.body.innerText,
          };
        },
        SELECTORS.chatInput
      )
      .catch(() => ({ cleared: false, inputText: '', bodyText: '' }));
    cleared = read.cleared;
    promptFound = transcriptContainsPrompt(read.bodyText, text);
    inputHolds = transcriptContainsPrompt(read.inputText, text);
    // Rendered in the transcript and gone from the input is proof on its own — `data-empty` has
    // been observed false on a send that had already landed, so it cannot be the sole gate.
    if (promptFound && (cleared || !inputHolds)) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return {
    confirmed: promptFound && (cleared || !inputHolds),
    inputCleared: cleared,
    promptFoundInTranscript: promptFound,
    inputStillHoldsPrompt: inputHolds,
    matchedSlice: slice,
  };
}

/**
 * Hint for a `chat-frame-missing` failure once the retry window
 * (`CHAT_FRAME_RETRY_MS`) has elapsed without the panel becoming ready.
 *
 * Distinguishes three very different situations `readChatState` can report,
 * rather than always saying "Open the AI panel in XGENIA" — a caller who
 * opened a project moments earlier does not need to open anything; the panel
 * is not missing, it just did not finish mounting within the wait:
 *  - `no-frame`: the iframe never appeared in the DOM at all.
 *  - `evaluate-failed`: the iframe is there, but the read inside it threw.
 *  - neither: the iframe is there and readable, but its input never
 *    rendered — could still be a genuinely closed or entitlement-gated
 *    panel, which is why this never claims the panel is "missing" outright.
 */
export function chatNotReadyHint(state: Pick<ChatState, 'unavailable' | 'error'>, waitedMs: number): string {
  if (state.unavailable === 'evaluate-failed') {
    return `The AI panel's read failed after waiting ${waitedMs}ms: ${state.error ?? '(no message)'}`;
  }
  if (state.unavailable === 'no-frame') {
    return `The AI chat panel's iframe did not appear in the DOM within ${waitedMs}ms. If it is genuinely closed or entitlement-gated, open it in XGENIA; if it should already be open, run xgenia_probe.`;
  }
  return `The AI chat panel's iframe is present, but its input never rendered within ${waitedMs}ms. If the panel is genuinely closed or entitlement-gated, open it in XGENIA; otherwise run xgenia_probe.`;
}

/**
 * Max x-coordinate (CSS px) of a genuine sidebar rail button. Verified live
 * against a running editor: every rail icon sits at x < 58; anything found
 * by `SELECTORS.sidebarIconButton` further right belongs to some other icon
 * button reusing the same component elsewhere in the app, not the rail.
 */
const SIDEBAR_RAIL_MAX_X = 58;

/** How long to wait, after moving the mouse onto a button, for its Tooltip to actually render. Verified live: ~450ms. */
const TOOLTIP_HOVER_DELAY_MS = 450;

/**
 * A real tooltip label is short. This filters out any element matched by
 * `SELECTORS.tooltip` that is coincidentally present but not a label bubble
 * (e.g. a much longer hint or an unrelated element that happens to share a
 * hashed class substring).
 */
const TOOLTIP_MAX_LEN = 40;

/** How long `ensureChatPanelOpen` waits, after clicking the identified button, for the panel to actually mount. */
const CHAT_OPEN_TIMEOUT_MS = 15_000;

/** The exact (case-insensitive, trimmed) label the sidebar button must carry. */
const CHAT_BUTTON_LABEL = 'chat';

/**
 * Whether a tooltip label identifies the Chat button.
 *
 * Case-insensitive and trimmed — real tooltip text is not guaranteed to
 * arrive in one exact casing — but requires an exact match, never a
 * substring: "AI Image Editor" must never match, and neither should a
 * future "Chat History" button that XGENIA might add later. `.includes()`
 * would silently start opening the wrong panel the day either exists.
 */
export function isChatButtonLabel(label: string): boolean {
  return label.trim().toLowerCase() === CHAT_BUTTON_LABEL;
}

interface SidebarButtonPoint {
  /** Viewport-relative center point to hover/click, in CSS pixels. */
  cx: number;
  cy: number;
}

/**
 * Read the center point of every sidebar rail button currently in the DOM.
 *
 * Filtering by `x < SIDEBAR_RAIL_MAX_X` and a non-zero box happens inside
 * the page, not here, because the whole point is one round trip per scan
 * rather than one per candidate.
 */
async function readSidebarButtonPoints(page: Page): Promise<SidebarButtonPoint[]> {
  return page.evaluate(
    ({ sel, maxX }) => {
      const out: { cx: number; cy: number }[] = [];
      document.querySelectorAll(sel).forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.x < maxX) {
          out.push({ cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
        }
      });
      return out;
    },
    { sel: SELECTORS.sidebarIconButton, maxX: SIDEBAR_RAIL_MAX_X }
  );
}

/** The tooltip text currently rendered, if any — see SELECTORS.tooltip's doc comment for why three selectors and a length cap. */
async function readTooltipLabel(page: Page): Promise<string> {
  const texts = (await page.evaluate(
    (sel) => Array.from(document.querySelectorAll(sel)).map((el) => (el as HTMLElement).innerText ?? ''),
    SELECTORS.tooltip
  )) as string[];
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i].trim();
    if (t && t.length < TOOLTIP_MAX_LEN) return t;
  }
  return '';
}

/** Move the mouse onto a point, wait for its Tooltip to render, and read the label. `hoverDelayMs` is a test seam — production callers always use the default ~450ms. */
async function hoverAndReadLabel(page: Page, point: SidebarButtonPoint, hoverDelayMs: number): Promise<string> {
  await page.mouse.move(point.cx, point.cy);
  await new Promise((r) => setTimeout(r, hoverDelayMs));
  return readTooltipLabel(page);
}

/**
 * Cached location of the sidebar's Chat button, so a caller opening several
 * projects in one session does not pay the ~450ms-per-button hover scan
 * every time. Session-local (module state), never persisted.
 */
let cachedChatButtonPoint: SidebarButtonPoint | null = null;

/** Forget the cached Chat button location, forcing the next `ensureChatPanelOpen` to re-scan. Exported for tests. */
export function resetChatButtonCache(): void {
  cachedChatButtonPoint = null;
}

interface ChatButtonScan {
  point: SidebarButtonPoint | null;
  /** Every tooltip label actually observed, in scan order — the exact list a maintainer needs when XGENIA renames the button. */
  labelsSeen: string[];
}

/** Hover every sidebar rail button in turn until one's tooltip reads "Chat", or the rail is exhausted. */
async function scanForChatButton(page: Page, hoverDelayMs: number): Promise<ChatButtonScan> {
  const points = await readSidebarButtonPoints(page);
  const labelsSeen: string[] = [];
  for (const point of points) {
    const label = await hoverAndReadLabel(page, point, hoverDelayMs);
    labelsSeen.push(label);
    if (isChatButtonLabel(label)) return { point, labelsSeen };
  }
  return { point: null, labelsSeen };
}

export interface ChatPanelOpenResult {
  opened: boolean;
  /** True when the chat iframe was already present and nothing was clicked. */
  alreadyOpen: boolean;
  /** True when the sidebar button was actually clicked (whether or not the panel then rendered). */
  clicked: boolean;
  reason?: 'no-chat-button' | 'clicked-but-not-rendered';
  /** Present only when a scan actually ran (a cache hit skips it) — see scanForChatButton. */
  labelsSeen?: string[];
  hint?: string;
}

/**
 * Make sure the AI chat panel is showing, opening it from the sidebar if it
 * is not.
 *
 * Every newly created project (and plenty of existing ones) opens with this
 * panel hidden — its visibility is per-project UI state, not something
 * `newProject`'s no-template `project.json` carries — so with nothing to
 * act on that, every chat tool failed closed with `chat-frame-missing` even
 * though a human at the keyboard could fix it with one click. This is that
 * click, driven the only way it can be: the sidebar's icon buttons carry no
 * id, aria-label or data-testid, only a Tooltip revealed on hover, so
 * finding "the Chat button" means hovering candidates and reading their
 * tooltips until one matches (see `isChatButtonLabel`).
 *
 * Already open is a real short circuit: if `SELECTORS.chatIframe` already
 * resolves to a frame, this returns immediately without hovering or
 * clicking anything, exactly per spec — a caller must never see this nudge
 * a panel that was already showing.
 */
export async function ensureChatPanelOpen(
  page: Page,
  opts: { timeoutMs?: number; pollMs?: number; hoverDelayMs?: number } = {}
): Promise<ChatPanelOpenResult> {
  const timeoutMs = opts.timeoutMs ?? CHAT_OPEN_TIMEOUT_MS;
  const hoverDelayMs = opts.hoverDelayMs ?? TOOLTIP_HOVER_DELAY_MS;

  if (getChatFrame(page)) {
    return { opened: true, alreadyOpen: true, clicked: false };
  }

  let point: SidebarButtonPoint | null = null;
  let labelsSeen: string[] | undefined;

  // Re-verify the cached point before trusting it: the rail can reflow
  // (window resize, a panel toggling elsewhere), so a stale cached point
  // might now hover nothing, or something else entirely. Only a fresh,
  // passing tooltip read earns the click.
  if (cachedChatButtonPoint) {
    const label = await hoverAndReadLabel(page, cachedChatButtonPoint, hoverDelayMs);
    if (isChatButtonLabel(label)) {
      point = cachedChatButtonPoint;
    } else {
      cachedChatButtonPoint = null;
    }
  }

  if (!point) {
    const scan = await scanForChatButton(page, hoverDelayMs);
    labelsSeen = scan.labelsSeen;
    if (!scan.point) {
      return {
        opened: false,
        alreadyOpen: false,
        clicked: false,
        reason: 'no-chat-button',
        labelsSeen,
        hint: `No sidebar rail button's tooltip read "Chat". Tooltip labels actually seen, top to bottom: ${
          labelsSeen.length ? labelsSeen.map((l) => `"${l || '(empty)'}"`).join(', ') : '(none — no rail buttons found at all)'
        }. If XGENIA renamed the button, update what this harness looks for.`
      };
    }
    point = scan.point;
    cachedChatButtonPoint = point;
  }

  await page.mouse.click(point.cx, point.cy);

  const readiness = await waitForChatReady(page, timeoutMs, opts.pollMs);
  if (!readiness.ready) {
    return {
      opened: false,
      alreadyOpen: false,
      clicked: true,
      reason: 'clicked-but-not-rendered',
      labelsSeen,
      hint: `Clicked the sidebar's Chat button, but the panel never rendered: ${chatNotReadyHint(readiness.state, timeoutMs)}`
    };
  }

  return { opened: true, alreadyOpen: false, clicked: true };
}

/** `ensureChatPanelOpen`, attached to the live editor. What `xgenia_open_chat_panel` calls. */
export async function openChatPanel(opts: { timeoutMs?: number } = {}): Promise<ChatPanelOpenResult> {
  const { page } = await connect();
  return ensureChatPanelOpen(page, opts);
}

export async function chatRead(opts: { since?: number; limit?: number } = {}) {
  const { page } = await connect();

  const readiness = await waitForChatReady(page, CHAT_FRAME_RETRY_MS);
  if (!readiness.ready) {
    return fail(
      'chat-frame-missing',
      SELECTORS.chatIframe,
      chatNotReadyHint(readiness.state, CHAT_FRAME_RETRY_MS)
    );
  }

  const frame = getChatFrame(page);
  if (!frame) {
    // The mount was observed a moment ago but the frame is gone now (e.g. a
    // navigation raced this call) — report it the same way as never having
    // appeared, rather than pressing on with a null frame below.
    return fail(
      'chat-frame-missing',
      SELECTORS.chatIframe,
      chatNotReadyHint({ unavailable: 'no-frame' }, CHAT_FRAME_RETRY_MS)
    );
  }

  const messages = await readStructuredMessages(frame);
  const limit = opts.limit ?? DEFAULT_TAIL_LIMIT;
  const since = resolveReadWindow(messages.length, opts.since, limit);

  const out: ChatMessageOut[] = summariseMessages(messages, since, limit, MESSAGE_CAP);

  return {
    total: messages.length,
    messageCount: readiness.state.messageCount,
    busy: readiness.state.busy,
    messages: out
  };
}

export async function chatWaitIdle(timeoutMs = 300_000) {
  const { page } = await connect();
  const startedAt = Date.now();

  // Give the panel the same short retry window as chatRead/chatSend before
  // concluding it is genuinely absent — see CHAT_FRAME_RETRY_MS.
  const initial = await waitForChatReady(page, CHAT_FRAME_RETRY_MS);
  if (!initial.ready) {
    return fail(
      'chat-frame-missing',
      SELECTORS.chatInput,
      chatNotReadyHint(initial.state, CHAT_FRAME_RETRY_MS)
    );
  }
  const before = initial.state.messageCount;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await readChatState(page);
    if (!state.mounted) {
      // Readiness was already established above; a panel that disappears
      // partway through a long wait (project closed, editor reloaded) is a
      // genuine loss, not the initial mounting race — fail immediately here.
      return fail(
        'chat-frame-missing',
        SELECTORS.chatInput,
        chatNotReadyHint(state, Date.now() - startedAt)
      );
    }
    if (!state.busy) {
      return {
        idle: true,
        waitedMs: Date.now() - startedAt,
        timedOut: false,
        newMessages: state.messageCount - before
      };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const final = await readChatState(page);
  return {
    idle: false,
    waitedMs: Date.now() - startedAt,
    timedOut: true,
    newMessages: final.messageCount - before
  };
}

/**
 * Type a prompt into the panel and send it.
 *
 * Success requires evidence: the input must have cleared AND the sent text
 * must actually appear in the rendered transcript (see `confirmSent`). A
 * keypress that went nowhere leaves both unchanged, and reporting success
 * there would strand the caller waiting for a reply to a prompt that was
 * never sent.
 */
export async function chatSend(
  text: string,
  opts: { waitIdle?: boolean; force?: boolean; timeoutMs?: number } = {}
) {
  const { page } = await connect();

  const readiness = await waitForChatReady(page, CHAT_FRAME_RETRY_MS);
  if (!readiness.ready) {
    return fail(
      'chat-frame-missing',
      SELECTORS.chatIframe,
      chatNotReadyHint(readiness.state, CHAT_FRAME_RETRY_MS)
    );
  }

  const frame = getChatFrame(page);
  if (!frame) {
    return fail(
      'chat-frame-missing',
      SELECTORS.chatIframe,
      chatNotReadyHint({ unavailable: 'no-frame' }, CHAT_FRAME_RETRY_MS)
    );
  }

  const before = readiness.state;
  if (before.busy && !opts.force) {
    return fail(
      'busy-refused',
      SELECTORS.chatStop,
      'The panel is mid-generation. Wait with xgenia_chat_wait_idle, or pass force to send anyway.'
    );
  }

  const input = frame.locator(SELECTORS.chatInput);
  await input.click();
  await input.fill('');
  await input.type(text, { delay: 5 });
  await page.keyboard.press('Enter');

  const confirmation = await confirmSent(frame, text);
  if (!confirmation.confirmed) {
    const outcome = describeUnconfirmedSend(confirmation);
    return {
      ...fail(
        outcome.code,
        `typed ${text.length} chars into ${SELECTORS.chatInput}, waited ${CONFIRM_DEADLINE_MS}ms for confirmation`,
        outcome.hint
      ),
      evidence: confirmation,
    };
  }

  if (!opts.waitIdle) {
    const after = await readChatState(page);
    return { sent: true, busy: after.busy, evidence: confirmation };
  }

  const waited = await chatWaitIdle(opts.timeoutMs ?? 300_000);
  return { sent: true, evidence: confirmation, ...waited };
}
