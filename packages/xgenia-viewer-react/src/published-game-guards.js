// Runs in published games only (index.deploy.js), never in the editor preview.
//
// 1. Uncaught errors. Before this nothing in a published game listened for them: a thrown error
//    could freeze a round with no message. Every error is kept in window.XGENIA_ERRORS (last 20)
//    and sent as a window 'xgenia:error' event so an operator wrapper or telemetry can forward
//    it. A thrown error also shows a small banner offering a reload; a rejected promise does
//    not, because audio play() rejections on mobile are routine and harmless.
// 2. Hidden tab. Audio kept playing after the player switched tabs or locked the phone. Hiding
//    the page mutes Howler and any <audio>/<video>; showing it again restores only what this
//    muted, so a game's own mute setting is left alone.

const MAX_KEPT = 20;
// Not ours or not fatal: cross-origin scripts (extensions, an operator wrapper) report only
// "Script error." with no detail, and ResizeObserver loop notices are browser noise.
const IGNORED = [/^Script error\.?$/i, /ResizeObserver loop/i];

function engineLabel() {
  const engine = window.XGENIA_ENGINE;
  return engine ? engine.version + ' ' + engine.commit : 'unknown';
}

function record(kind, error, message) {
  const entry = {
    kind,
    time: new Date().toISOString(),
    message: String(message || (error && error.message) || error || 'Unknown error'),
    stack: error && error.stack ? String(error.stack) : undefined,
    engine: engineLabel()
  };
  const kept = (window.XGENIA_ERRORS = window.XGENIA_ERRORS || []);
  kept.push(entry);
  if (kept.length > MAX_KEPT) kept.splice(0, kept.length - MAX_KEPT);
  console.error('[XGENIA] ' + kind + ' (engine ' + entry.engine + '):', error || entry.message);
  try {
    window.dispatchEvent(new CustomEvent('xgenia:error', { detail: entry }));
  } catch (e) {
    // A listener threw; never let reporting raise a second error.
  }
}

let bannerShown = false;

function showBanner() {
  if (bannerShown || !document.body) return;
  bannerShown = true;
  const bar = document.createElement('div');
  bar.setAttribute('role', 'alert');
  bar.style.cssText =
    'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;' +
    'display:flex;align-items:center;gap:12px;max-width:calc(100% - 32px);box-sizing:border-box;' +
    'padding:10px 12px 10px 16px;border-radius:8px;background:rgba(20,20,24,0.92);color:#fff;' +
    'font:14px/1.3 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);';
  const text = document.createElement('span');
  text.textContent = 'Something went wrong.';
  const reload = document.createElement('button');
  reload.textContent = 'Reload';
  reload.style.cssText =
    'border:0;border-radius:6px;padding:6px 12px;background:#fff;color:#111;font:inherit;cursor:pointer;';
  reload.onclick = () => window.location.reload();
  const close = document.createElement('button');
  close.textContent = '×';
  close.setAttribute('aria-label', 'Dismiss');
  close.style.cssText = 'border:0;background:none;color:#fff;font:20px/1 system-ui,sans-serif;cursor:pointer;';
  close.onclick = () => bar.remove();
  bar.append(text, reload, close);
  document.body.appendChild(bar);
}

function installErrorGuard() {
  window.addEventListener('error', (event) => {
    // Failed <img>/<script> loads do not bubble to window, so this is a thrown error.
    const message = event.message || (event.error && event.error.message) || '';
    if (IGNORED.some((re) => re.test(message))) return;
    record('uncaught error', event.error, message);
    showBanner();
  });
  window.addEventListener('unhandledrejection', (event) => {
    record('unhandled rejection', event.reason);
  });
}

function installHiddenTabMute() {
  let howlerMutedByUs = false;
  let mediaMutedByUs = [];
  document.addEventListener('visibilitychange', () => {
    const howler = window.Howler;
    if (document.hidden) {
      if (howler && typeof howler.mute === 'function' && !howler._muted) {
        howler.mute(true);
        howlerMutedByUs = true;
      }
      document.querySelectorAll('audio, video').forEach((el) => {
        if (!el.muted) {
          el.muted = true;
          mediaMutedByUs.push(el);
        }
      });
    } else {
      if (howlerMutedByUs && howler && typeof howler.mute === 'function') howler.mute(false);
      howlerMutedByUs = false;
      mediaMutedByUs.forEach((el) => {
        el.muted = false;
      });
      mediaMutedByUs = [];
    }
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.__xgeniaGameGuards) {
  window.__xgeniaGameGuards = true;
  installErrorGuard();
  installHiddenTabMute();
}
