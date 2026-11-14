/**
 * The Stake shell (2026-11-11, design doc "XGENIA for Stake — product design", phase 2): what every Stake build
 * gets around the game, so neither the studio nor the AI builds Stake's required screens and controls by hand.
 *
 * WHY. Stake's reviewers check the same things in every game: a rules screen with the mandatory disclaimer and
 * each mode's payout and top win, a sound toggle, the spacebar placing a bet, a confirmation before any mode
 * costing more than 2× the bet, and the social-mode wording on Stake.US. They were left to the AI, which spent
 * 190 of 205 calls on one rules popup (debug export 1794403218540) and hunted for a social-mode signal that only
 * exists in the build (export 1794421485474). The build now adds them itself, from facts it already has:
 *
 *   stake-shell.js    — STAKE_SHELL_JS below, loaded FIRST in index.html's <head> (so it sees every AudioContext
 *                       and media element the game makes, for the sound toggle);
 *   stake-shell.json  — stakeShellData(): the game's name, every mode with its price and the payout and top win
 *                       measured on the very books being uploaded, the feature lines, the disclaimer, and which
 *                       elements are the Spin button (for the spacebar).
 *
 * The Book Connector (xgenia-runtime stake-book-session.js) asks the shell — window.__xgeniaStakeShell.confirmMode —
 * before playing a mode over 2×; a "no" plays and charges nothing.
 *
 * Not covered, by design, and still listed for the studio: the game's own paytable and feature explanation (the
 * shell cannot know symbol pays), autoplay's confirmation, the win counting up, and text drawn on a canvas or
 * baked into images (the social-mode swap works on page text only).
 *
 * Pure apart from the script text: tests/deploy/stakeShell.test.ts (data, injection) and
 * tests/deploy/stakeShell.browser.test.ts (the script itself, in Chromium).
 */
import { STAKE_RULES } from './stakeRules';

export const STAKE_SHELL_FILE = 'stake-shell.js';
export const STAKE_SHELL_DATA_FILE = 'stake-shell.json';

export interface StakeShellMode {
  name: string;
  label: string;
  /** × the bet. */
  cost: number;
  /** Measured on the uploaded books, as a fraction; null when not measured. */
  rtp: number | null;
  /** Largest win in the uploaded books, × the bet. */
  maxWin: number | null;
}

export interface StakeShellData {
  version: string;
  game: string;
  modes: StakeShellMode[];
  features: string[];
  disclaimer: string;
  /** Node ids of the Spin button(s): the spacebar presses the first one on screen. */
  spinNodeIds: string[];
  /** A mode costing more than this × the bet is confirmed before it is played. */
  confirmAbove: number;
  /** Social mode: word → replacement (lower case; the shell keeps the case it finds). */
  social: Record<string, string>;
}

/** The social-mode replacements the shell applies: Stake's rule set, plus the forms Stake.US also refuses. */
export const STAKE_SOCIAL_WORDS: Record<string, string> = {
  ...STAKE_RULES.socialReplacements,
  bets: 'plays',
  betting: 'playing',
  bought: 'played',
  purchase: 'play',
  paid: 'awarded',
  payout: 'win',
  payouts: 'wins',
  wager: 'play',
  wagers: 'plays',
  gamble: 'play',
  gambling: 'playing',
  money: 'coins',
  deposit: 'add coins',
  withdraw: 'redeem'
};

export function stakeShellData(o: {
  game: string;
  modes: Array<{ name: string; label?: string; cost: number; rtp?: number | null; maxWin?: number | null }>;
  summary?: { freeSpins?: string; betModes?: boolean; pickBonus?: boolean } | null;
  spinNodeIds?: string[];
}): StakeShellData {
  const features: string[] = [];
  const s = o.summary || {};
  if (s.freeSpins && s.freeSpins !== 'none') features.push('Free spins are played in full from the round that triggers them; the whole bonus is one bet.');
  if (o.modes.some((m) => m.cost > 1)) features.push('Other bet modes cost a multiple of the bet, shown below; a bought bonus starts straight away.');
  if (s.pickBonus) features.push('In a pick bonus the prizes are decided when the bet is placed; picking only reveals them.');
  features.push('All wins are multiples of the bet. The largest win of each mode is listed below.');
  return {
    version: STAKE_RULES.version,
    game: o.game,
    modes: o.modes.map((m) => ({ name: m.name, label: m.label || m.name, cost: m.cost, rtp: m.rtp ?? null, maxWin: m.maxWin ?? null })),
    features,
    disclaimer: STAKE_RULES.disclaimer,
    spinNodeIds: Array.from(new Set(o.spinNodeIds || [])),
    confirmAbove: 2,
    social: STAKE_SOCIAL_WORDS
  };
}

/**
 * Which elements are the Spin button: the one chosen for telemetry on publish when there is one, then every
 * button whose label or text says spin / play / bet (project JSON; the built page stamps data-xgenia-node-id).
 */
export function findSpinButtonIds(projectJson: any, chosenNodeId?: string | null): string[] {
  const ids: string[] = chosenNodeId ? [chosenNodeId] : [];
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    const type = String(n.type || '');
    const words = [n.label, n.parameters?.label, n.parameters?.text].filter((x) => typeof x === 'string').join(' ');
    if (/button/i.test(type) && /\b(spin|play|bet)\b/i.test(words.replace(/([a-z])([A-Z])/g, '$1 $2'))) ids.push(String(n.id));
    for (const c of n.children || []) walk(c);
  };
  for (const comp of projectJson?.components || []) {
    if (String(comp?.name || '').startsWith('/#__maths__/')) continue;
    for (const r of comp?.graph?.roots || []) walk(r);
  }
  return Array.from(new Set(ids));
}

/** index.html with the shell loaded first in <head> (once). */
export function injectStakeShell(html: string): string {
  const tag = `<script src="${STAKE_SHELL_FILE}"></script>`;
  if (html.includes(tag)) return html;
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length);
  return tag + html;
}

/**
 * The shell's runtime. Plain browser JS, no dependencies, no backticks (it lives in a String.raw template).
 * window.__xgeniaStakeShell = { confirmMode, setMuted, isMuted, openRules, closeRules, socialize, ready }.
 */
export const STAKE_SHELL_JS = String.raw`(function () {
  'use strict';
  if (window.__xgeniaStakeShell) return;
  var q = new URLSearchParams(location.search);
  var social = q.get('social') === 'true';
  var replay = q.get('replay') === 'true';
  var data = { game: document.title || 'Game', modes: [], features: [], disclaimer: '', spinNodeIds: [], confirmAbove: 2, social: {} };

  // ── sound: every AudioContext and media element the game makes, so one toggle silences all ──
  var muted = false;
  try { muted = localStorage.getItem('xgenia-stake-muted') === '1'; } catch (e) {}
  var contexts = [];
  var mediaMuted = [];
  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var Base = window[name];
    if (typeof Base !== 'function') return;
    var Shelled = class extends Base {
      constructor() {
        super(...arguments);
        contexts.push(this);
        if (muted) Base.prototype.suspend.call(this).catch(function () {});
      }
      resume() { return muted ? Promise.resolve() : Base.prototype.resume.call(this); }
    };
    window[name] = Shelled;
  });
  var mediaPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (muted && !this.muted) { this.muted = true; mediaMuted.push(this); }
    return mediaPlay.apply(this, arguments);
  };
  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('xgenia-stake-muted', muted ? '1' : '0'); } catch (e) {}
    contexts.forEach(function (c) {
      try { (muted ? c.suspend() : Object.getPrototypeOf(Object.getPrototypeOf(c)).resume.call(c)).catch(function () {}); } catch (e) {}
    });
    if (muted) {
      document.querySelectorAll('audio,video').forEach(function (el) { if (!el.muted) { el.muted = true; mediaMuted.push(el); } });
    } else {
      mediaMuted.splice(0).forEach(function (el) { el.muted = false; });
    }
    paintSound();
  }

  // ── social mode: Stake.US refuses money words in any text ──
  function keepCase(word, rep) {
    if (word === word.toUpperCase()) return rep.toUpperCase();
    if (word[0] === word[0].toUpperCase()) return rep[0].toUpperCase() + rep.slice(1);
    return rep;
  }
  function socialize(text) {
    var words = Object.keys(data.social || {});
    if (!words.length || !text) return text;
    var re = new RegExp('\\b(' + words.join('|') + ')\\b', 'gi');
    return String(text).replace(re, function (w) { return keepCase(w, data.social[w.toLowerCase()] || w); });
  }
  function socializeTree(root) {
    if (!social || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var n;
    while ((n = walker.nextNode())) {
      var p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') continue;
      var t = socialize(n.nodeValue);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
    if (root.querySelectorAll) {
      root.querySelectorAll('[placeholder],[title],[aria-label],input[type=button],input[type=submit]').forEach(function (el) {
        ['placeholder', 'title', 'aria-label', 'value'].forEach(function (a) {
          var v = el.getAttribute(a);
          if (v) { var t = socialize(v); if (t !== v) el.setAttribute(a, t); }
        });
      });
    }
  }

  // ── UI: an info button, a sound button, the rules screen, the confirmation ──
  var css = '.xg-stake-btn{position:fixed;top:10px;z-index:2147483000;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.45);color:#fff;font:600 16px/32px system-ui,sans-serif;text-align:center;cursor:pointer;padding:0}' +
    '.xg-stake-btn:focus-visible{outline:2px solid #fff}' +
    '.xg-stake-veil{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.xg-stake-card{background:#16181d;color:#e9e9ee;max-width:560px;width:100%;max-height:86vh;overflow:auto;border-radius:14px;padding:22px 22px 18px;font:14px/1.5 system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)}' +
    '.xg-stake-card h2{margin:0 0 10px;font-size:19px}.xg-stake-card h3{margin:16px 0 6px;font-size:14px;color:#b9bcc6;text-transform:uppercase;letter-spacing:.04em}' +
    '.xg-stake-card table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.xg-stake-card td,.xg-stake-card th{padding:6px 4px;border-bottom:1px solid #2a2d35;text-align:left}.xg-stake-card th{color:#9aa0ad;font-weight:500}' +
    '.xg-stake-row{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}.xg-stake-row button{font:600 14px system-ui,sans-serif;border-radius:9px;padding:9px 16px;cursor:pointer;border:1px solid #3a3e48;background:#262932;color:#fff}' +
    '.xg-stake-row button.xg-primary{background:#3fbf73;border-color:#3fbf73;color:#0c1a12}.xg-stake-note{color:#9aa0ad;font-size:12.5px;margin-top:14px}';
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = social ? socialize(text) : text;
    return e;
  }
  var veil = null;
  var onClose = null;
  function close(result) {
    if (veil) { veil.remove(); veil = null; }
    var f = onClose; onClose = null;
    if (f) f(result);
  }
  function open(card, cb) {
    close(false);
    veil = el('div', { class: 'xg-stake-veil', 'data-xg-stake': 'veil' });
    veil.appendChild(card);
    veil.addEventListener('click', function (e) { if (e.target === veil) close(false); });
    document.body.appendChild(veil);
    onClose = cb || null;
    var b = card.querySelector('button.xg-primary') || card.querySelector('button');
    if (b) b.focus();
  }
  function pct(x) { return x == null ? '—' : (x * 100).toFixed(2) + '%'; }
  function times(x) { return x == null ? '—' : Number(x).toLocaleString('en-US') + '×'; }
  function openRules() {
    var card = el('div', { class: 'xg-stake-card', role: 'dialog', 'aria-label': 'Game rules', 'data-xg-stake': 'rules' });
    card.appendChild(el('h2', null, data.game + ' — rules'));
    (data.features || []).forEach(function (f) { card.appendChild(el('p', null, f)); });
    if ((data.modes || []).length) {
      card.appendChild(el('h3', null, 'Bet modes'));
      var t = el('table');
      var head = el('tr');
      ['Mode', 'Cost', 'Return to player', 'Largest win'].forEach(function (h) { head.appendChild(el('th', null, h)); });
      t.appendChild(head);
      data.modes.forEach(function (m) {
        var r = el('tr', { 'data-mode': m.name });
        [m.label || m.name, times(m.cost) + ' bet', pct(m.rtp), times(m.maxWin)].forEach(function (c) { r.appendChild(el('td', null, c)); });
        t.appendChild(r);
      });
      card.appendChild(t);
    }
    card.appendChild(el('p', { class: 'xg-stake-note', 'data-xg-stake': 'disclaimer' }, data.disclaimer));
    var row = el('div', { class: 'xg-stake-row' });
    var ok = el('button', { class: 'xg-primary', type: 'button' }, 'Close');
    ok.addEventListener('click', function () { close(true); });
    row.appendChild(ok);
    card.appendChild(row);
    open(card);
  }
  function confirmMode(m) {
    if (replay || !m || !(Number(m.cost) > Number(data.confirmAbove || 2))) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var known = (data.modes || []).filter(function (x) { return x.name === m.mode; })[0];
      var card = el('div', { class: 'xg-stake-card', role: 'dialog', 'aria-label': 'Confirm', 'data-xg-stake': 'confirm' });
      card.appendChild(el('h2', null, (known && known.label) || m.mode));
      card.appendChild(el('p', null, 'This costs ' + Number(m.cost).toLocaleString('en-US') + '× your bet. Buy it?'));
      var row = el('div', { class: 'xg-stake-row' });
      var no = el('button', { type: 'button', 'data-xg-stake': 'cancel' }, 'Cancel');
      var yes = el('button', { class: 'xg-primary', type: 'button', 'data-xg-stake': 'confirm-yes' }, 'Buy');
      no.addEventListener('click', function () { close(false); });
      yes.addEventListener('click', function () { close(true); });
      row.appendChild(no); row.appendChild(yes); card.appendChild(row);
      open(card, resolve);
    });
  }

  var soundBtn = null;
  function paintSound() {
    if (!soundBtn) return;
    soundBtn.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    soundBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    soundBtn.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
  }
  function mount() {
    var style = el('style'); style.textContent = css; document.head.appendChild(style);
    var info = el('button', { class: 'xg-stake-btn', type: 'button', 'aria-label': 'Game rules', 'data-xg-stake': 'info', style: 'right:10px' }, 'i');
    info.addEventListener('click', function (e) { e.stopPropagation(); openRules(); });
    soundBtn = el('button', { class: 'xg-stake-btn', type: 'button', 'data-xg-stake': 'sound', style: 'right:52px' });
    soundBtn.addEventListener('click', function (e) { e.stopPropagation(); setMuted(!muted); });
    paintSound();
    document.body.appendChild(info);
    document.body.appendChild(soundBtn);
    if (social) {
      socializeTree(document.body);
      new MutationObserver(function (records) {
        records.forEach(function (r) {
          if (r.type === 'characterData') { var t = socialize(r.target.nodeValue); if (t !== r.target.nodeValue) r.target.nodeValue = t; }
          r.addedNodes && r.addedNodes.forEach(function (n) { if (n.nodeType === 3) { var t2 = socialize(n.nodeValue); if (t2 !== n.nodeValue) n.nodeValue = t2; } else socializeTree(n); });
        });
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  // ── spacebar: places a bet by pressing the game's Spin button ──
  function spinTarget() {
    var ids = data.spinNodeIds || [];
    for (var i = 0; i < ids.length; i++) {
      var host = document.querySelector('[data-xgenia-node-id="' + ids[i] + '"]');
      if (!host) continue;
      var b = host.matches('button,[role=button]') ? host : host.querySelector('button,[role=button]') || host;
      var r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && !b.disabled && b.getAttribute('aria-disabled') !== 'true') return b;
    }
    return null;
  }
  window.addEventListener('keydown', function (e) {
    if (e.code !== 'Space' && e.key !== ' ') return;
    if (veil) { e.preventDefault(); return; }
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.nodeName))) return;
    if (e.repeat) { e.preventDefault(); return; }
    var spin = spinTarget();
    if (!spin) return;
    e.preventDefault();
    spin.click();
  }, true);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && veil) close(false); });

  var ready = fetch('stake-shell.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) for (var k in d) data[k] = d[k]; })
    .catch(function () {});
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  ready.then(function () { if (social && document.body) socializeTree(document.body); });

  window.__xgeniaStakeShell = { confirmMode: confirmMode, setMuted: setMuted, isMuted: function () { return muted; }, openRules: openRules, closeRules: function () { close(true); }, socialize: socialize, ready: ready };
})();
`;
