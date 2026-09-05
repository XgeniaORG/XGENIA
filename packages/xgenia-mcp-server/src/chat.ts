import { connect, getChatFrame } from './connection.js';
import { SELECTORS } from './selectors.js';
import { readChatState, summariseMessages, type ChatMessage, type ChatMessageOut } from './editor-state.js';

const MESSAGE_CAP = 2000;

/**
 * Chrome lines the panel prints above the transcript.
 *
 * These carry no conversation content and change on every render (costs, token
 * counts), so keeping them would make every read look different from the last.
 */
const CHROME = [
  /^▶$/,
  /^Chat \(\d+ messages?\)$/,
  /^\$[\d.]+$/,
  /^Dashboard$/,
  /^[\d.]+% of context$/,
  /^[\d.]+k \/ [\d.]+k · \d+ msgs$/,
  /^Load \d+ older messages?$/
];

export function parseTranscript(innerText: string): ChatMessage[] {
  const lines = innerText.split('\n');
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (line === '' || CHROME.some((re) => re.test(line))) {
      start += 1;
      continue;
    }
    break;
  }
  const body = lines.slice(start).join('\n').trim();
  if (!body) return [];
  // The panel does not expose per-message roles in innerText. One block is
  // returned; callers that need turn boundaries use messageCount from
  // readChatState, which counts the per-message copy buttons.
  return [{ role: 'assistant', text: body }];
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

  const raw = await frame.evaluate(() => document.body.innerText);
  const messages = parseTranscript(raw);

  const out: ChatMessageOut[] = summariseMessages(
    messages,
    opts.since ?? 0,
    opts.limit ?? 20,
    MESSAGE_CAP
  );

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
