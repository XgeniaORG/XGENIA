#!/usr/bin/env node
/**
 * Game probe — play a running XGENIA build and grade it.
 *
 * WHY THIS EXISTS. On 2026-09-08 the panel AI built a slot that charged every spin and never paid,
 * and could not reproduce the fault when told about it: it has no way to click its own button. This
 * script is the oracle the AI lacks, and the exit criterion for every phase of the AI reset
 * (docs/superpowers/specs/2026-09-08-xgenia-ai-reset-design.md). It is deliberately game-agnostic —
 * it knows about buttons and readouts by NODE LABEL, not about slots.
 *
 * It addresses the preview iframe directly by URL. It must never be answered by the empty
 * `external/cloudruntime` page, which is the surface that makes the panel's own runtime tools report
 * a mounted game as not_mounted.
 *
 * Usage:
 *   node tools/game-probe/probe.mjs --spins 20 --button SpinButton \
 *        --read credit=BalanceText --read win=WinText --out ./run
 *   node tools/game-probe/probe.mjs --labels          # list what the running build exposes
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);
const multi = (name) =>
  argv.reduce((acc, a, i) => (a === `--${name}` ? [...acc, argv[i + 1]] : acc), []);

const PORT = Number(flag('port', 9223));
const SPINS = Number(flag('spins', 20));
const BUTTON = flag('button', 'SpinButton');
const SETTLE_MS = Number(flag('settle', 4500));
const OUT = flag('out', null);
const SHOTS = Number(flag('shots', 0));

/** `--read name=NodeLabel`, repeatable. Defaults suit a slot but nothing here assumes one. */
const READS = (multi('read').length ? multi('read') : ['credit=BalanceText', 'win=WinText'])
  .map((pair) => {
    const [key, label] = pair.split('=');
    return { key, label };
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => {
  if (s == null) return null;
  const cleaned = String(s).replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/**
 * Never throw. Like the MCP harness this sits beside, every failure is a reported result with a
 * `hint` saying what to do next — an uncaught stack tells a caller nothing actionable.
 */
let browser;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20_000 });
} catch (e) {
  console.log(
    JSON.stringify(
      {
        error: 'not-running',
        tried: `connectOverCDP http://127.0.0.1:${PORT}`,
        hint: 'XGENIA is not listening on that port. Launch the editor (xgenia_launch) and open a project first.',
        detail: String(e.message ?? e).split('\n')[0]
      },
      null,
      2
    )
  );
  process.exit(1);
}
const pages = browser.contexts().flatMap((c) => c.pages());
const editor = pages.find((p) => p.url().includes('/src/editor/index.html'));
if (!editor) {
  console.log(JSON.stringify({ error: 'no-editor-page', saw: pages.map((p) => p.url()) }, null, 2));
  process.exit(1);
}

/**
 * The preview is a local http origin that is NOT the editor page. The cloud-runtime shell is a
 * file:// URL, so it can never match this and can never be probed by mistake.
 */
const frame = editor
  .frames()
  .find((f) => /^https?:\/\/(localhost|127\.0\.0\.1):\d+\//.test(f.url()) && !f.url().includes('/src/editor/'));
if (!frame) {
  console.log(
    JSON.stringify(
      { error: 'no-preview-frame', hint: 'Open a project and start the preview.', frames: editor.frames().map((f) => f.url()) },
      null,
      2
    )
  );
  process.exit(1);
}

/**
 * Console noise that is the DEV TOOLING talking, not the game.
 *
 * The first run of this probe reported "1/12 rounds logged errors" and two rounds that failed to
 * charge — all three caused by a webpack hot-recompile while source files were being edited, nothing
 * to do with the build under test. A probe that blames the game for its own environment is exactly
 * the kind of lying instrument this whole workstream exists to remove, so this is filtered out and
 * reported separately as `environment`.
 */
const ENV_NOISE = /webpack|dev-server|HMR|\[hmr\]|Reload prevented|Download the React DevTools|sourcemap/i;
const logs = [];
const envLogs = [];
const record = (text) => (ENV_NOISE.test(text) ? envLogs : logs).push(text);
editor.on('console', (m) => record(m.text().slice(0, 300)));
editor.on('pageerror', (e) => record(`PAGEERROR ${String(e).slice(0, 300)}`));

const listLabels = () =>
  frame.evaluate(() =>
    [...document.querySelectorAll('[data-xgenia-node-label]')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          label: el.getAttribute('data-xgenia-node-label'),
          text: (el.textContent || '').trim().slice(0, 24),
          w: Math.round(r.width),
          h: Math.round(r.height)
        };
      })
      .filter((e) => e.w > 0 && e.h > 0)
  );

if (has('labels')) {
  console.log(JSON.stringify({ previewUrl: frame.url(), labels: await listLabels() }, null, 2));
  await browser.close();
  process.exit(0);
}

const readAll = () =>
  frame.evaluate((reads) => {
    const out = {};
    for (const { key, label } of reads) {
      const el = document.querySelector(`[data-xgenia-node-label="${label}"]`);
      out[key] = el ? (el.textContent || '').trim() : null;
    }
    return out;
  }, READS);

const clickButton = () =>
  frame.evaluate((label) => {
    const el = document.querySelector(`[data-xgenia-node-label="${label}"]`);
    if (!el) return false;
    for (const type of ['pointerdown', 'pointerup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true }));
    }
    return true;
  }, BUTTON);

const labels = await listLabels();
if (!labels.some((l) => l.label === BUTTON)) {
  console.log(
    JSON.stringify(
      {
        error: 'button-not-found',
        button: BUTTON,
        hint: 'Pass --button with one of the labels below, or --labels to list them.',
        candidates: labels.map((l) => l.label)
      },
      null,
      2
    )
  );
  await browser.close();
  process.exit(1);
}

if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = async (name) => {
  if (!OUT || !SHOTS) return;
  try {
    await editor.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 70, timeout: 8000 });
  } catch {
    /* a screenshot is never worth failing a run for */
  }
};

const rounds = [];
const before = await readAll();
await shot('00-before');

for (let i = 1; i <= SPINS; i++) {
  const pre = await readAll();
  logs.length = 0;
  envLogs.length = 0;
  await clickButton();
  await sleep(SETTLE_MS);
  const post = await readAll();
  const errors = logs.filter((l) => /error|Error|NaN|not defined|undefined is not/.test(l));
  rounds.push({
    i,
    pre,
    post,
    errors: errors.slice(0, 5),
    environmentDisturbed: envLogs.length > 0,
    environment: envLogs.slice(0, 2)
  });
  if (SHOTS && i <= SHOTS) await shot(`spin${i}`);
}

const after = await readAll();

/**
 * Deltas per read key. `credit` is treated as the money readout when present: a game that never
 * changes it is not billing, and one that only ever decreases is not paying.
 */
const summary = {};
for (const { key } of READS) {
  const deltas = rounds
    .map((r) => {
      const a = num(r.pre[key]);
      const b = num(r.post[key]);
      return a == null || b == null ? null : b - a;
    })
    .filter((d) => d != null);
  const nonZeroPost = rounds.filter((r) => {
    const v = num(r.post[key]);
    return v != null && v !== 0;
  }).length;
  summary[key] = {
    first: before[key],
    last: after[key],
    changedInRounds: deltas.filter((d) => d !== 0).length,
    increases: deltas.filter((d) => d > 0).length,
    decreases: deltas.filter((d) => d < 0).length,
    net: deltas.length ? deltas.reduce((a, b) => a + b, 0) : null,
    roundsWithNonZeroValue: nonZeroPost
  };
}

const credit = summary.credit;
const win = summary.win;
const verdicts = [];
if (credit) {
  verdicts.push(
    credit.decreases === SPINS
      ? { check: 'charged every round', verdict: 'PASS', evidence: `credit fell in ${credit.decreases}/${SPINS}` }
      : { check: 'charged every round', verdict: 'FAIL', evidence: `credit fell in ${credit.decreases}/${SPINS}` }
  );
  verdicts.push(
    credit.increases > 0
      ? { check: 'ever pays', verdict: 'PASS', evidence: `credit rose in ${credit.increases}/${SPINS}` }
      : { check: 'ever pays', verdict: 'FAIL', evidence: `credit never rose across ${SPINS} rounds; net ${credit.net}` }
  );
}
if (win) {
  verdicts.push(
    win.roundsWithNonZeroValue > 0
      ? { check: 'win readout ever non-zero', verdict: 'PASS', evidence: `${win.roundsWithNonZeroValue}/${SPINS}` }
      : { check: 'win readout ever non-zero', verdict: 'FAIL', evidence: `0/${SPINS}` }
  );
}
const errorRounds = rounds.filter((r) => r.errors.length).length;
verdicts.push(
  errorRounds === 0
    ? { check: 'no console errors', verdict: 'PASS', evidence: '0 rounds with errors' }
    : { check: 'no console errors', verdict: 'FAIL', evidence: `${errorRounds}/${SPINS} rounds logged errors` }
);

/**
 * A run disturbed by a hot reload can miss clicks through no fault of the build, so the result says so
 * rather than quietly folding it into the verdicts. Re-run on a quiet tree before trusting a FAIL.
 */
const disturbed = rounds.filter((r) => r.environmentDisturbed).map((r) => r.i);

const report = {
  previewUrl: frame.url(),
  button: BUTTON,
  spins: SPINS,
  settleMs: SETTLE_MS,
  reads: READS,
  before,
  after,
  summary,
  verdicts,
  failed: verdicts.filter((v) => v.verdict === 'FAIL').map((v) => v.check),
  environmentDisturbedRounds: disturbed,
  trustworthy: disturbed.length === 0,
  ...(disturbed.length
    ? { warning: `Rounds ${disturbed.join(', ')} overlapped a dev-server recompile. Missed clicks and console errors in those rounds may be tooling, not the build. Re-run on a quiet tree.` }
    : {}),
  rounds: OUT ? undefined : rounds
};

if (OUT) {
  fs.writeFileSync(path.join(OUT, 'rounds.json'), JSON.stringify(rounds, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
await browser.close();
process.exit(report.failed.length ? 2 : 0);
