import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { SELECTORS } from './selectors.js';

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const load = (name: string) =>
  new JSDOM(fs.readFileSync(path.join(fixtures, name), 'utf8')).window.document;

describe('chat frame selectors', () => {
  const doc = load('chat-frame.html');

  it('finds the chat input', () => {
    expect(doc.querySelector(SELECTORS.chatInput)).not.toBeNull();
  });

  it('the chat input is contenteditable and reports emptiness', () => {
    const el = doc.querySelector(SELECTORS.chatInput)!;
    expect(el.getAttribute('contenteditable')).toBe('true');
    expect(el.hasAttribute('data-empty')).toBe(true);
  });

  it('finds exactly one of the busy/idle buttons', () => {
    const stop = doc.querySelectorAll(SELECTORS.chatStop).length;
    const send = doc.querySelectorAll(SELECTORS.chatSend).length;
    expect(stop + send).toBeGreaterThan(0);
  });
});

describe('editor page selectors', () => {
  const doc = load('editor-page.html');

  it('finds the chat iframe', () => {
    expect(doc.querySelector(SELECTORS.chatIframe)).not.toBeNull();
  });
});

describe('projects screen selectors', () => {
  const doc = load('projects-screen.html');

  it('finds a project tile', () => {
    expect(doc.querySelector(SELECTORS.projectItem)).not.toBeNull();
  });

  it('reads the project name from the tile label', () => {
    // The fixture is captured verbatim from a running editor (see
    // scripts/capture-fixtures.mjs --projects). The first tile's real label
    // has a trailing space, and `findRecent` in src/recents.ts matches names
    // with strict `===`, so this asserts the untrimmed value on purpose.
    const label = doc.querySelector(SELECTORS.projectItemLabel);
    expect(label?.textContent).toBe('Amazing Game ');
  });
});
