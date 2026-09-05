#!/usr/bin/env node
/**
 * Refresh the DOM fixtures from a running XGENIA.
 *
 * Usage:
 *   node scripts/capture-fixtures.mjs [--port 9223]
 *     Captures fixtures/editor-page.html and fixtures/chat-frame.html.
 *     Requires: a project OPEN in XGENIA, with the AI chat panel visible
 *     (the chat iframe mounted and `.rich-chat-input` present in it).
 *
 *   node scripts/capture-fixtures.mjs --projects [--port 9223]
 *     Captures fixtures/projects-screen.html: the `.projects-list` wrapper
 *     plus the outerHTML of the first 3 `.projects-item` tiles.
 *     Requires: the projects screen showing (no project open).
 *
 * Both modes connect to a running XGENIA over CDP (`--remote-debugging-port`,
 * default 9223) and capture real markup so selectors.test.ts can assert
 * SELECTORS (src/selectors.ts) against it without a running app.
 *
 * Sanitisation: the default mode's fixtures can hold the user's real chat
 * transcript and project chrome. Before writing, every non-whitespace TEXT
 * NODE anywhere in the captured document is replaced with a short
 * placeholder ('x') -- tags, attributes, classes and structure are left
 * untouched, which is all selectors.test.ts ever asserts on. The contents of
 * <style> and <script> elements are cleared, and any `data:` URI found in an
 * attribute value is replaced with a short placeholder -- both are bulk
 * (component-scoped CSS, inlined thumbnails) that no selector depends on and
 * that would otherwise bloat the fixture to well over a megabyte.
 *
 * The --projects fixture is captured WITHOUT this sanitisation: it exists
 * specifically to pin real project-tile markup including the label text (see
 * selectors.test.ts and Task 4 brief Override 1), and only ever holds project
 * names, never chat content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { JSDOM } from 'jsdom';

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const port = portArg > -1 ? Number(args[portArg + 1]) : 9223;
const projectsMode = args.includes('--projects');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/**
 * Replace the TEXT CONTENT of every node with a short placeholder, and clear
 * <style>/<script> bodies and `data:` URIs, while preserving every tag,
 * attribute, class and the overall structure. Used so a fixture captured
 * from a live editor can be committed without the user's real chat
 * transcript or megabytes of incidental CSS/inlined images.
 */
function sanitizeHtml(html) {
  const dom = new JSDOM(html);
  const { document } = dom.window;
  const NodeFilter = dom.window.NodeFilter;

  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);
  for (const textNode of textNodes) {
    if (!textNode.nodeValue || !textNode.nodeValue.trim()) continue; // leave whitespace-only text alone
    textNode.nodeValue = 'x';
  }

  for (const el of document.querySelectorAll('style, script')) {
    el.textContent = '';
  }

  const DATA_URI = /data:[^"')\s]+/g;
  const all = document.querySelectorAll('*');
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value.includes('data:')) {
        el.setAttribute(attr.name, attr.value.replace(DATA_URI, 'data:placeholder'));
      }
    }
  }

  return dom.serialize();
}

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const pages = browser.contexts().flatMap((c) => c.pages());
const page = pages.find((p) => p.url().includes('/src/editor/index.html'));
if (!page) throw new Error('No editor page found. Is XGENIA running?');

fs.mkdirSync(dir, { recursive: true });

if (projectsMode) {
  const html = await page.evaluate(() => {
    const list = document.querySelector('.projects-list');
    if (!list) return null;
    const items = Array.from(document.querySelectorAll('.projects-item')).slice(0, 3);
    const wrapper = document.createElement('div');
    wrapper.className = 'projects-list';
    for (const item of items) wrapper.appendChild(item.cloneNode(true));
    return wrapper.outerHTML;
  });
  if (!html) {
    throw new Error('No .projects-list found. Is the projects screen showing (no project open)?');
  }
  fs.writeFileSync(path.join(dir, 'projects-screen.html'), html);
  console.log('Captured fixtures/projects-screen.html (unsanitised, labels intact) to', dir);
} else {
  const editorHtml = await page.content();
  fs.writeFileSync(path.join(dir, 'editor-page.html'), sanitizeHtml(editorHtml));

  const chat = page.frames().find((f) => f.url().includes('xgenia-ai-app'));
  if (!chat) throw new Error('No chat frame found. Is the AI panel open?');
  const chatHtml = await chat.content();
  fs.writeFileSync(path.join(dir, 'chat-frame.html'), sanitizeHtml(chatHtml));

  console.log('Captured sanitised fixtures/editor-page.html and fixtures/chat-frame.html to', dir);
}

await browser.close();
