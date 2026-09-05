import type { Frame } from 'playwright-core';
import { connect, getChatFrame } from './connection.js';
import { SELECTORS } from './selectors.js';
import { readChatState, summariseMessages, type ChatMessage, type ChatMessageOut } from './editor-state.js';

const MESSAGE_CAP = 2000;
const DEFAULT_TAIL_LIMIT = 5;

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
 * Fold `readChatState`'s unavailable reason into a hint, so a caller told
 * "the panel isn't usable" can tell "no iframe at all" apart from "the iframe
 * is there but the read inside it is throwing" instead of chasing the wrong
 * cause.
 */
function unavailableHint(state: { unavailable?: 'no-frame' | 'evaluate-failed'; error?: string }): string {
  if (state.unavailable === 'evaluate-failed') {
    return `The AI panel's read failed: ${state.error ?? '(no message)'}`;
  }
  if (state.unavailable === 'no-frame') {
    return 'Open the AI panel in XGENIA.';
  }
  return 'Open the AI panel in XGENIA.';
}

export async function chatRead(opts: { since?: number; limit?: number } = {}) {
  const { page } = await connect();
  const frame = getChatFrame(page);
  if (!frame) return fail('chat-frame-missing', SELECTORS.chatIframe, 'Open the AI panel in XGENIA.');

  const state = await readChatState(page);
  if (state.unavailable) {
    return fail('chat-frame-missing', SELECTORS.chatIframe, unavailableHint(state));
  }

  const messages = await readStructuredMessages(frame);
  const limit = opts.limit ?? DEFAULT_TAIL_LIMIT;
  const since = resolveReadWindow(messages.length, opts.since, limit);

  const out: ChatMessageOut[] = summariseMessages(messages, since, limit, MESSAGE_CAP);

  return { total: messages.length, messageCount: state.messageCount, busy: state.busy, messages: out };
}

export async function chatWaitIdle(timeoutMs = 300_000) {
  const { page } = await connect();
  const startedAt = Date.now();
  const before = (await readChatState(page)).messageCount;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await readChatState(page);
    if (!state.mounted) {
      return fail('chat-frame-missing', SELECTORS.chatInput, unavailableHint(state));
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
  const frame = getChatFrame(page);
  if (!frame) return fail('chat-frame-missing', SELECTORS.chatIframe, 'Open the AI panel in XGENIA.');

  const before = await readChatState(page);
  if (before.unavailable) {
    return fail('chat-frame-missing', SELECTORS.chatIframe, unavailableHint(before));
  }
  if (!before.mounted) {
    return fail('selector-missing', SELECTORS.chatInput, 'Run xgenia_probe to see what resolved.');
  }
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
