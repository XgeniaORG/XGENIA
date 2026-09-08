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

  it('finds at least one of the mutually exclusive busy/idle buttons', () => {
    // Stop and Send are mutually exclusive by design (busy vs idle panel
    // state), so this only asserts that one of them is present -- not which.
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

  it("capture script's page-finder matches SELECTORS.editorPageUrlSuffix", () => {
    // capture-fixtures.mjs is a plain .mjs run directly by node -- it cannot
    // import selectors.ts without a build step, so it hardcodes its own copy
    // of the editor page URL suffix to find the right CDP target. This test
    // is what keeps that copy honest: if it drifts from SELECTORS here, the
    // capture script silently stops finding the editor page (or someone
    // "fixes" the script and this constant goes stale instead).
    const scriptPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'scripts',
      'capture-fixtures.mjs'
    );
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');
    expect(scriptSource).toContain(SELECTORS.editorPageUrlSuffix);
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

describe('login screen selectors', () => {
  // Captured live (scripts/capture-fixtures.mjs --login) from the real
  // unauthenticated login screen: Task 15's Defect 1 fixture. The login
  // screen is inline-styled React with no class names or ids, which is
  // exactly why isLoginScreen (editor-state.ts) matches on the structural
  // presence of both inputs rather than one CSS class or the literal
  // "Login with XGENIA" copy.
  const doc = load('login-screen.html');

  it('finds the login email input', () => {
    expect(doc.querySelector(SELECTORS.loginEmailInput)).not.toBeNull();
  });

  it('finds the login password input', () => {
    expect(doc.querySelector(SELECTORS.loginPasswordInput)).not.toBeNull();
  });
});

describe('login-screen false positives', () => {
  // The other three real captured screens must never look like the login
  // screen -- if either did, an authenticated editor or an open project
  // would misreport as not-authenticated.
  it.each([
    ['editor-page.html'],
    ['projects-screen.html'],
    ['chat-frame.html']
  ])('%s has neither a login email nor a login password input', (fixture) => {
    const fixtureDoc = load(fixture);
    expect(fixtureDoc.querySelector(SELECTORS.loginEmailInput)).toBeNull();
    expect(fixtureDoc.querySelector(SELECTORS.loginPasswordInput)).toBeNull();
  });
});
