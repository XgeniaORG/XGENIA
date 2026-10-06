// Published games had no handler for uncaught errors (a thrown error could freeze a round with no
// message) and kept playing audio in a hidden tab. These run the real guard source in a jsdom
// window and drive it with the DOM events a browser would send.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.join(__dirname, '../src/published-game-guards.js'), 'utf8');

function boot() {
  const { window } = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  window.console.error = jest.fn();
  window.XGENIA_ENGINE = { version: 'test', commit: 'abc123' };
  window.eval(SOURCE);
  return window;
}

function throwUncaught(window, message, error = new window.Error(message)) {
  window.dispatchEvent(new window.ErrorEvent('error', { message, error }));
}

function banners(window) {
  return window.document.querySelectorAll('[role="alert"]');
}

function setHidden(window, hidden) {
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
}

describe('published game guards: uncaught errors', () => {
  test('a thrown error is kept, announced and shows one reload banner', () => {
    const window = boot();
    const announced = [];
    window.addEventListener('xgenia:error', (e) => announced.push(e.detail));

    throwUncaught(window, 'reel strip is undefined');

    expect(window.XGENIA_ERRORS).toHaveLength(1);
    expect(window.XGENIA_ERRORS[0]).toMatchObject({
      kind: 'uncaught error',
      message: 'reel strip is undefined',
      engine: 'test abc123'
    });
    expect(announced).toEqual([window.XGENIA_ERRORS[0]]);
    expect(banners(window)).toHaveLength(1);
    expect(banners(window)[0].textContent).toContain('Something went wrong.');
    expect([...banners(window)[0].querySelectorAll('button')].map((b) => b.textContent)).toContain('Reload');

    throwUncaught(window, 'second error');
    expect(window.XGENIA_ERRORS).toHaveLength(2);
    expect(banners(window)).toHaveLength(1);
  });

  test('the banner can be dismissed', () => {
    const window = boot();
    throwUncaught(window, 'boom');
    banners(window)[0].querySelector('[aria-label="Dismiss"]').click();
    expect(banners(window)).toHaveLength(0);
  });

  test('cross-origin "Script error." and ResizeObserver noise are ignored', () => {
    const window = boot();
    window.dispatchEvent(new window.ErrorEvent('error', { message: 'Script error.' }));
    throwUncaught(window, 'ResizeObserver loop completed with undelivered notifications.');
    expect(window.XGENIA_ERRORS).toBeUndefined();
    expect(banners(window)).toHaveLength(0);
  });

  test('a rejected promise is kept but shows no banner (mobile audio play() rejects routinely)', () => {
    const window = boot();
    const event = new window.Event('unhandledrejection');
    event.reason = new window.Error('play() failed because the user did not interact');
    window.dispatchEvent(event);
    expect(window.XGENIA_ERRORS).toHaveLength(1);
    expect(window.XGENIA_ERRORS[0].kind).toBe('unhandled rejection');
    expect(banners(window)).toHaveLength(0);
  });

  test('only the last 20 errors are kept', () => {
    const window = boot();
    for (let i = 0; i < 25; i++) throwUncaught(window, 'error ' + i);
    expect(window.XGENIA_ERRORS).toHaveLength(20);
    expect(window.XGENIA_ERRORS[0].message).toBe('error 5');
  });
});

describe('published game guards: hidden tab', () => {
  function fakeHowler(muted = false) {
    return {
      _muted: muted,
      mute: jest.fn(function (m) {
        this._muted = m;
      })
    };
  }

  test('hiding mutes Howler and media elements; showing restores them', () => {
    const window = boot();
    window.Howler = fakeHowler();
    const video = window.document.createElement('video');
    window.document.body.appendChild(video);

    setHidden(window, true);
    expect(window.Howler.mute).toHaveBeenLastCalledWith(true);
    expect(video.muted).toBe(true);

    setHidden(window, false);
    expect(window.Howler.mute).toHaveBeenLastCalledWith(false);
    expect(video.muted).toBe(false);
  });

  test("the game's own mute survives a hide and show", () => {
    const window = boot();
    window.Howler = fakeHowler(true);
    const video = window.document.createElement('video');
    video.muted = true;
    window.document.body.appendChild(video);

    setHidden(window, true);
    setHidden(window, false);
    expect(window.Howler.mute).not.toHaveBeenCalled();
    expect(window.Howler._muted).toBe(true);
    expect(video.muted).toBe(true);
  });

  test('works before any sound has loaded Howler', () => {
    const window = boot();
    expect(() => {
      setHidden(window, true);
      setHidden(window, false);
    }).not.toThrow();
  });
});
