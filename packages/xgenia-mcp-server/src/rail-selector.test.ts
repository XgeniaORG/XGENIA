// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { SELECTORS } from './selectors.js';

// The three rail shapes the harness has to drive. Each must yield the Chat button, or
// xgenia_open_chat_panel reports "no rail buttons found at all" (2026-11-03, a build between the
// labelled rail and #244: data-rail-id only).
const SHAPES: Record<string, string> = {
  'old icon rail': '<button class="IconButton-module__Root--x" aria-label="Chat"></button>',
  'labelled rail before #244': '<div data-rail-id="chat"><div><button class="Rail-module__Button--a" aria-label="Chat"></button></div></div>',
  'labelled rail with data-guide': '<div data-rail-id="chat" data-guide="rail.chat"><div><button class="Rail-module__Button--a" aria-label="Chat"></button></div></div>'
};

describe('SELECTORS.sidebarIconButton', () => {
  for (const [name, html] of Object.entries(SHAPES)) {
    it(`finds the Chat button on the ${name}`, () => {
      document.body.innerHTML = html;
      const labels = [...document.querySelectorAll(SELECTORS.sidebarIconButton)].map((b) => b.getAttribute('aria-label'));
      expect(labels).toEqual(['Chat']);
    });
  }
});
