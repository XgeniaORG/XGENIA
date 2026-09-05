import type { Frame } from 'playwright-core';
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
 * How much of the sent text must match, whitespace-normalised, in the
 * rendered transcript to count as confirmed. Long enough that a coincidental
 * substring match is unlikely, short enough to survive the panel truncating a
 * long prompt or inserting markup between words partway through it — so a
 * whole-string match would false-negative on a prompt that genuinely landed.
 */
export const CONFIRM_SLICE_LEN = 60;

/** The leading, whitespace-normalised slice of `text` that `transcriptContainsPrompt` looks for. */
export function promptSlice(text: string, maxLen: number = CONFIRM_SLICE_LEN): string {
  return normaliseWhitespace(text).slice(0, maxLen);
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
  return normaliseWhitespace(transcriptText).includes(slice);
}

export interface SendConfirmation {
  confirmed: boolean;
  inputCleared: boolean;
  promptFoundInTranscript: boolean;
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
export async function confirmSent(
  frame: Frame,
  text: string,
  deadlineMs = 10_000,
  pollMs = 250
): Promise<SendConfirmation> {
  const slice = promptSlice(text);
  const deadline = Date.now() + deadlineMs;
  let cleared = false;
  let promptFound = false;
  while (Date.now() < deadline) {
    cleared = await frame
      .evaluate(
        (sel) => document.querySelector(sel)?.getAttribute('data-empty') === 'true',
        SELECTORS.chatInput
      )
      .catch(() => false);
    const transcriptText = await frame.evaluate(() => document.body.innerText).catch(() => '');
    promptFound = transcriptContainsPrompt(transcriptText, text);
    if (cleared && promptFound) break;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { confirmed: cleared && promptFound, inputCleared: cleared, promptFoundInTranscript: promptFound, matchedSlice: slice };
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
    return fail(
      'timeout',
      `typed ${text.length} chars into ${SELECTORS.chatInput}, waited 10s for confirmation`,
      `Input cleared: ${confirmation.inputCleared}. Prompt text found in transcript: ${confirmation.promptFoundInTranscript}. The prompt may not have been sent.`
    );
  }

  if (!opts.waitIdle) {
    const after = await readChatState(page);
    return { sent: true, busy: after.busy, evidence: confirmation };
  }

  const waited = await chatWaitIdle(opts.timeoutMs ?? 300_000);
  return { sent: true, evidence: confirmation, ...waited };
}
