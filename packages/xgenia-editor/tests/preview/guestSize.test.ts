import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GUEST_UNSIZED,
  guestSizeVerdict,
  guestUnsizedMessage,
  shouldCaptureOffscreen
} from '../../src/editor/src/views/VisualCanvas/guestSize';

test('a guest the size of its frame is ok', () => {
  assert.equal(guestSizeVerdict({ w: 1157, h: 504 }, { w: 1157, h: 504 }), 'ok');
  assert.equal(guestSizeVerdict({ w: 1157, h: 504 }, { w: 1159, h: 503 }), 'ok');
});

test('content zoom counts as a match either way the engine applies it', () => {
  assert.equal(guestSizeVerdict({ w: 1000, h: 500 }, { w: 2000, h: 1000 }, 0.5), 'ok');
  assert.equal(guestSizeVerdict({ w: 1000, h: 500 }, { w: 500, h: 250 }, 0.5), 'ok');
});

test('a guest reporting 0x0, or nothing, is unsized', () => {
  assert.equal(guestSizeVerdict({ w: 1920, h: 1080 }, { w: 0, h: 0 }), 'unsized');
  assert.equal(guestSizeVerdict({ w: 1920, h: 1080 }, null), 'unsized');
  assert.equal(guestSizeVerdict({ w: 1920, h: 1080 }, { w: 1920, h: 0 }), 'unsized');
});

test('a guest stuck at another real size is stuck', () => {
  assert.equal(guestSizeVerdict({ w: 1920, h: 1080 }, { w: 1157, h: 504 }), 'stuck');
});

test('a collapsed frame proves nothing', () => {
  assert.equal(guestSizeVerdict({ w: 0, h: 0 }, { w: 0, h: 0 }), 'ok');
});

test('the refusal names the fault the way the AI parser reads it', () => {
  const m = guestUnsizedMessage('screenshot', { w: 1157, h: 504 }, { w: 0, h: 0 });
  assert.match(m, /\(it reports 0x0 while its frame is 1157x504\)/);
  assert.equal(GUEST_UNSIZED, 'GUEST_UNSIZED');
});

test('every in-place failure falls back offscreen except a missing size', () => {
  assert.equal(shouldCaptureOffscreen({ success: false, code: GUEST_UNSIZED, message: 'x' }), true);
  assert.equal(shouldCaptureOffscreen({ success: false, stale: true, message: 'window minimized' }), true);
  assert.equal(shouldCaptureOffscreen({ success: false, timedOut: true }), true);
  assert.equal(shouldCaptureOffscreen({ success: false, message: 'design capture: no size was given, and there is no default' }), false);
  assert.equal(shouldCaptureOffscreen({ success: true }), false);
  assert.equal(shouldCaptureOffscreen(null), false);
});
