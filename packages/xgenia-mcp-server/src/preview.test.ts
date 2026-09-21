import { describe, it, expect } from 'vitest';
import { isPreviewFrameUrl, selectorForLabel, clip, findPreviewFrame } from './preview.js';
import type { Page } from 'playwright-core';

describe('isPreviewFrameUrl', () => {
  it('accepts the viewer dev-server origin', () => {
    expect(isPreviewFrameUrl('http://localhost:8574/?t=1789825699812')).toBe(true);
  });
  it('rejects the editor page, the chat panel, about:blank and file urls', () => {
    expect(isPreviewFrameUrl('http://localhost:8080/src/editor/index.html')).toBe(false);
    expect(isPreviewFrameUrl('https://xgenia-ai-app-xgenia.vercel.app/')).toBe(false);
    expect(isPreviewFrameUrl('about:blank')).toBe(false);
    expect(isPreviewFrameUrl('file:///Users/x/external/cloudruntime/index.html')).toBe(false);
  });
});

describe('findPreviewFrame', () => {
  it('picks the preview frame out of the editor frame tree, not the panel', () => {
    const frames = [
      'http://localhost:8080/src/editor/index.html',
      'about:blank',
      'http://localhost:8574/?t=1',
      'https://xgenia-ai-app-xgenia.vercel.app/'
    ].map((url) => ({ url: () => url }));
    const page = { frames: () => frames } as unknown as Page;
    expect(findPreviewFrame(page)?.url()).toBe('http://localhost:8574/?t=1');
  });
  it('returns null when no preview is mounted', () => {
    const page = { frames: () => [{ url: () => 'http://localhost:8080/src/editor/index.html' }] } as unknown as Page;
    expect(findPreviewFrame(page)).toBeNull();
  });
});

describe('selectorForLabel', () => {
  it('quotes the label so names with spaces and quotes survive', () => {
    expect(selectorForLabel('Add one')).toBe('[data-xgenia-node-label="Add one"]');
    expect(selectorForLabel('Bob\'s "Btn"')).toBe('[data-xgenia-node-label="Bob\'s \\"Btn\\""]');
  });
});

describe('clip', () => {
  it('returns short text untouched and marks a cut visibly', () => {
    expect(clip('abc', 10)).toEqual({ text: 'abc', truncated: false });
    expect(clip('abcdefghij', 4)).toEqual({ text: 'abcd… [+6 chars]', truncated: true });
  });
});
