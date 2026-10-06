import type { Frame, Page } from 'playwright-core';
import { connect } from './connection.js';

/**
 * Read and poke the running game directly, without going through the panel AI.
 *
 * The panel's own reports ("the label now shows 3") are the AI's reading of the
 * same DOM, filtered through its reasoning. When the question is what the game
 * actually displays, a driver needs to read it first-hand — and to press the
 * button itself — so a confident wrong answer from the panel is caught rather
 * than repeated. These tools are that first-hand read.
 */

/** Which frame is the preview: a local http origin that is neither the editor page nor the chat panel. */
export function isPreviewFrameUrl(url: string): boolean {
  return (
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//.test(url) &&
    !url.includes('/src/editor/') &&
    !url.includes('xgenia-ai-app')
  );
}

export function findPreviewFrame(page: Page): Frame | null {
  return page.frames().find((f) => isPreviewFrameUrl(f.url())) ?? null;
}

function fail(code: string, tried: string, hint: string, extra: Record<string, unknown> = {}) {
  return { error: code, tried, hint, ...extra };
}

const LABEL_ATTR = 'data-xgenia-node-label';

/** Build the selector for a node by its editor label — the same attribute the viewer stamps on every rendered node's element. */
export function selectorForLabel(label: string): string {
  return `[${LABEL_ATTR}=${JSON.stringify(label)}]`;
}

export interface LabelledElement {
  label: string;
  nodeId: string | null;
  component: string | null;
  tag: string;
  text: string;
  visible: boolean;
}

export interface PreviewReadOptions {
  /** CSS selector to read instead of the whole body. */
  selector?: string;
  /** Node label (editor name) to read — shorthand for the data-xgenia-node-label selector. */
  label?: string;
  /** Cap on the returned innerText. Default 4000. */
  maxChars?: number;
}

/** Clip a string to maxChars, marking the cut so a truncated read is visible rather than silent. */
export function clip(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + `… [+${text.length - maxChars} chars]`, truncated: true };
}

async function previewFrameOrFail(page: Page) {
  const frame = findPreviewFrame(page);
  if (!frame) {
    return {
      frame: null,
      failure: fail(
        'preview-frame-missing',
        'find the preview iframe (a local http origin that is neither the editor page nor the chat panel)',
        'The preview is not mounted. Open a project and start the preview, then retry.',
        { frames: page.frames().map((f) => f.url()) }
      )
    };
  }
  return { frame, failure: null };
}

/**
 * Read what the running game is showing: the visible text of the whole page or
 * of one element, plus every rendered node that carries an editor label with
 * its current text — the map a driver needs to name things in the next call.
 */
export async function previewRead(options: PreviewReadOptions = {}) {
  const { maxChars = 4000 } = options;
  const { page } = await connect();
  const { frame, failure } = await previewFrameOrFail(page);
  if (!frame) return failure;

  const selector = options.selector ?? (options.label ? selectorForLabel(options.label) : null);

  let result: {
    matched: number;
    text: string;
    labelled: LabelledElement[];
    title: string;
  };
  try {
    result = await frame.evaluate(
      ({ selector, attr }) => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
        };
        const labelled = Array.from(document.querySelectorAll(`[${attr}]`)).map((el) => ({
          label: el.getAttribute(attr) ?? '',
          nodeId: el.getAttribute('data-xgenia-node-id'),
          component: el.getAttribute('data-xgenia-component'),
          tag: el.tagName.toLowerCase(),
          text: ((el as HTMLElement).innerText ?? '').trim().slice(0, 200),
          visible: visible(el)
        }));
        if (selector) {
          const els = Array.from(document.querySelectorAll(selector));
          return {
            matched: els.length,
            text: els.map((el) => ((el as HTMLElement).innerText ?? el.textContent ?? '').trim()).join('\n---\n'),
            labelled,
            title: document.title
          };
        }
        return {
          matched: 1,
          text: (document.body.innerText ?? '').trim(),
          labelled,
          title: document.title
        };
      },
      { selector, attr: LABEL_ATTR }
    );
  } catch (e) {
    return fail(
      'preview-read-failed',
      `evaluate in ${frame.url()}`,
      `The preview frame exists but the read threw: ${(e as Error).message}`,
      { previewUrl: frame.url() }
    );
  }

  if (selector && result.matched === 0) {
    return fail(
      'selector-missing',
      selector,
      `Nothing in the running game matches ${selector}. The labelled nodes currently rendered are listed under labelled — use one of those.`,
      { previewUrl: frame.url(), labelled: result.labelled }
    );
  }

  const clipped = clip(result.text, maxChars);
  return {
    previewUrl: frame.url(),
    title: result.title,
    selector,
    matched: result.matched,
    text: clipped.text,
    truncated: clipped.truncated,
    labelled: result.labelled,
    hint: 'This is read straight from the preview DOM, not from the panel AI. Re-read after any interaction; nothing here is cached.'
  };
}

export interface PreviewClickOptions {
  /** Node label (editor name) of the element to click. */
  label?: string;
  /** CSS selector of the element to click, when a label is not enough. */
  selector?: string;
  /** How many times to click. Default 1. */
  times?: number;
  /** Wait after each click for the game to react before reading. Default 300. */
  settleMs?: number;
  /** Node label whose text to report after each click — the thing the click is supposed to change. */
  readLabel?: string;
}

/**
 * Click a rendered node in the running game and report what another node
 * displays after each press — the driver's own evidence, not the panel's.
 */
export async function previewClick(options: PreviewClickOptions = {}) {
  const { times = 1, settleMs = 300 } = options;
  const { page } = await connect();
  const { frame, failure } = await previewFrameOrFail(page);
  if (!frame) return failure;

  const selector = options.selector ?? (options.label ? selectorForLabel(options.label) : null);
  if (!selector) {
    return fail('bad-arguments', 'previewClick', 'Pass label or selector for the element to click.');
  }
  const readSelector = options.readLabel ? selectorForLabel(options.readLabel) : null;

  const target = frame.locator(selector).first();
  if ((await frame.locator(selector).count()) === 0) {
    const labelled = await frame
      .evaluate((attr) => Array.from(document.querySelectorAll(`[${attr}]`)).map((el) => el.getAttribute(attr)), LABEL_ATTR)
      .catch(() => []);
    return fail(
      'selector-missing',
      selector,
      'Nothing in the running game matches that. The labelled nodes currently rendered are listed under labelled.',
      { previewUrl: frame.url(), labelled }
    );
  }

  const readText = async () => {
    if (!readSelector) return null;
    return frame
      .evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return el ? (el.innerText ?? el.textContent ?? '').trim() : null;
      }, readSelector)
      .catch(() => null);
  };

  const before = await readText();
  const after: (string | null)[] = [];
  for (let i = 0; i < times; i++) {
    try {
      await target.click({ timeout: 5000 });
    } catch (e) {
      return fail(
        'click-failed',
        `${selector} click #${i + 1}`,
        `Playwright could not click the element: ${(e as Error).message}`,
        { previewUrl: frame.url(), before, after }
      );
    }
    await new Promise((r) => setTimeout(r, settleMs));
    after.push(await readText());
  }

  return {
    previewUrl: frame.url(),
    clicked: selector,
    times,
    ...(readSelector ? { read: readSelector, before, after } : {}),
    hint: readSelector
      ? 'before/after are the read node\'s visible text as the preview DOM held it, sampled settleMs after each click.'
      : 'Pass readLabel to have the text of another node reported after each click.'
  };
}
