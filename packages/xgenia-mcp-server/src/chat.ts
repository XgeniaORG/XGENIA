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
 * Success requires evidence: the input must have cleared AND the message count
 * must have grown. A keypress that went nowhere leaves both unchanged, and
 * reporting success there would strand the caller waiting for a reply to a
 * prompt that was never sent.
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

  // Give the panel a moment to clear the box and append the turn.
  const deadline = Date.now() + 10_000;
  let cleared = false;
  let grew = false;
  while (Date.now() < deadline) {
    const now = await readChatState(page);
    const empty = await frame
      .evaluate(
        (sel) => document.querySelector(sel)?.getAttribute('data-empty') === 'true',
        SELECTORS.chatInput
      )
      .catch(() => false);
    cleared = empty;
    grew = now.messageCount > before.messageCount || now.busy;
    if (cleared && grew) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!cleared || !grew) {
    return fail(
      'timeout',
      `typed ${text.length} chars into ${SELECTORS.chatInput}, waited 10s for confirmation`,
      `Input cleared: ${cleared}. Transcript advanced: ${grew}. The prompt may not have been sent.`
    );
  }

  if (!opts.waitIdle) return { sent: true, busy: true };

  const waited = await chatWaitIdle(opts.timeoutMs ?? 300_000);
  return { sent: true, ...waited };
}
