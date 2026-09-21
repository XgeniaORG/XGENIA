/**
 * xgenia_preview_click — press a control in the running game.
 *
 * `xgenia_preview_text` closed half of the verification loop: you can see what a player
 * sees. This closes the other half, so a supervisor can run the whole check without asking
 * the builder to do it — read the screen, press the button, read it again, and judge from
 * the difference.
 *
 * That independence is the point. "I clicked SPIN and the balance updated" is exactly the
 * kind of claim that should never be taken on trust, because it is the claim that decides
 * whether a build is finished, and the one most likely to be reported optimistically. A
 * build in this project had a fully verified spin chain — real RNG, a real win, capital
 * moving in the model — while every readout on screen stayed at its default.
 *
 * Elements are found by their visible text, because that is what a person would describe
 * and it survives refactors that break selectors. The match is case-insensitive and tries
 * an EXACT text match first, falling back to substring only if nothing matches exactly;
 * among equals it takes the smallest element, so "SPIN" presses the button rather than the
 * panel around it. The exact-first rule is not a nicety — substring alone matched the win
 * ledger's "No wins yet - spin to populate" and silently pressed a paragraph five times,
 * which looks precisely like a dead game. A substring fallback is reported as such.
 *
 * This dispatches a real click in the preview iframe. It only ever touches the local dev
 * preview of the project that is already open.
 */

import { connect } from './connection.js';

const PREVIEW_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//;

/**
 * Choose which of several text matches is the control the caller meant.
 *
 * Extracted and pure so the rule that actually bit can be tested: asking for "SPIN" on a
 * slot game matched the win ledger's "No wins yet - spin to populate", which is physically
 * smaller than the button, so a smallest-element rule picked the paragraph. Clicks landed
 * on text, nothing happened, and it looked exactly like a dead game.
 *
 * Exact text wins over any substring, however small. Among equals, the smallest element is
 * the control rather than a panel containing it.
 */
export function pickTarget(
  candidates: { text: string; area: number }[],
  want: string
): { index: number; matchKind: 'exact' | 'substring' } | null {
  const needle = want.trim().toLowerCase();
  const norm = (t: string) => t.trim().toLowerCase();
  const rank = (pred: (t: string) => boolean) =>
    candidates
      .map((c, index) => ({ ...c, index }))
      .filter((c) => pred(norm(c.text)))
      .sort((a, b) => a.area - b.area);

  const exact = rank((t) => t === needle);
  if (exact.length) return { index: exact[0]!.index, matchKind: 'exact' };
  const sub = rank((t) => t.includes(needle));
  if (sub.length) return { index: sub[0]!.index, matchKind: 'substring' };
  return null;
}

export interface PreviewClickOptions {
  /** Visible text of the control to press, e.g. "SPIN". */
  text: string;
  /** Wait this long after clicking before returning, so the result has settled. Default 1200ms. */
  settleMs?: number;
}

export async function previewClick(options: PreviewClickOptions) {
  const { text, settleMs = 1200 } = options;
  if (!text || !text.trim()) {
    return { error: 'no-text', hint: 'Pass the visible text of the control to press, e.g. { text: "SPIN" }.' };
  }
  const { page } = await connect();

  const frame = page
    .frames()
    .find((f) => PREVIEW_ORIGIN.test(f.url()) && !f.url().includes('/src/editor/'));
  if (!frame) {
    return {
      error: 'preview-frame-missing',
      tried: 'find the preview iframe (a local http origin that is not the editor page)',
      hint: 'The preview is not mounted. Open a project so the game renders, then retry.',
      frames: page.frames().map((f) => f.url())
    };
  }

  // Two passes on purpose: collect candidates in the page, decide in Node with the tested
  // pickTarget(), then click the chosen one by index. Duplicating the ranking rule inside
  // the browser would leave the tested function and the shipped behaviour free to drift —
  // and the ranking rule is precisely what went wrong before.
  let candidates: { text: string; area: number }[];
  try {
    candidates = await frame.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('*'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { text: (el.innerText ?? '').trim(), area: r.width * r.height, w: r.width, h: r.height };
        })
        .filter((c) => c.w > 0 && c.h > 0 && c.text.length > 0)
        .map(({ text, area }) => ({ text, area }))
    );
  } catch (e) {
    return {
      error: 'preview-click-failed',
      detail: (e as Error).message.slice(0, 200),
      hint: 'The preview frame exists but would not evaluate. If the renderer is wedged, xgenia_editor_probe will say so.'
    };
  }

  const choice = pickTarget(candidates, text);
  if (!choice) {
    return {
      clicked: false,
      error: 'no-matching-control',
      lookedFor: text,
      visibleText: [...new Set(candidates.map((c) => c.text.split('\n')[0]!))].filter((t) => t.length < 40).slice(0, 25),
      hint: 'No visible element matched that text. Check visibleText for what is actually on screen — the control may be an image or canvas with no text of its own.'
    };
  }

  let result: { clicked: boolean; matched?: string };
  try {
    result = await frame.evaluate((idx: number) => {
      const target = Array.from(document.querySelectorAll<HTMLElement>('*'))
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { el, text: (el.innerText ?? '').trim(), w: r.width, h: r.height, r };
        })
        .filter((c) => c.w > 0 && c.h > 0 && c.text.length > 0)[idx];
      if (!target) return { clicked: false };
      const cx = target.r.left + target.r.width / 2;
      const cy = target.r.top + target.r.height / 2;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        target.el.dispatchEvent(
          new MouseEvent(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy })
        );
      }
      return { clicked: true, matched: target.text.slice(0, 60) };
    }, choice.index);
  } catch (e) {
    return {
      error: 'preview-click-failed',
      detail: (e as Error).message.slice(0, 200),
      hint: 'The click evaluate failed after the target was chosen; the page may have changed underneath it. Retry.'
    };
  }

  if (!result.clicked) {
    return {
      clicked: false,
      error: 'target-vanished',
      lookedFor: text,
      hint: 'The chosen element was gone by the time the click ran — the screen changed between passes. Retry.'
    };
  }

  await new Promise((r) => setTimeout(r, Math.min(Math.max(settleMs, 0), 15_000)));
  return {
    clicked: true,
    matched: result.matched,
    matchKind: choice.matchKind,
    ...(choice.matchKind === 'substring'
      ? { warning: `No element's text was exactly "${text}" — clicked the smallest element CONTAINING it. Check "matched" is really the control you meant.` }
      : {}),
    settledMs: settleMs,
    hint: 'Now read xgenia_preview_text again and compare against the reading you took before this click. A control that fires but changes nothing on screen is the failure worth catching.'
  };
}
