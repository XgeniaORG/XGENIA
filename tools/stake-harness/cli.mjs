#!/usr/bin/env node
/**
 * Stake Engine harness — is this game ready for Stake? One command an agent can run and read.
 *
 *   node tools/stake-harness/cli.mjs check <math-dir> [--game <build-dir> | --game-url <url> | --game reference]
 *   node tools/stake-harness/cli.mjs validate <math-dir> [--json] [--strict]
 *   node tools/stake-harness/cli.mjs emulate <math-dir> [--port 5050] [--game <build-dir>] [--tls]
 *   node tools/stake-harness/cli.mjs bot <math-dir> [--soak 200]
 *   node tools/stake-harness/cli.mjs browser <math-dir> (--game <dir> | --game-url <url>) [--buy-steps "#buy,#confirm-yes"]
 *   node tools/stake-harness/cli.mjs rebalance <math-dir> --rtp 0.963 [--into <dir>]
 *   node tools/stake-harness/cli.mjs fixture <out-dir> [--flavour standard|xrgs|drop-free-spins|...]
 *
 * <math-dir> is the directory you upload to Stake as the maths (the editor writes
 * <folder>/math/publish_files). See README.md for what each check means and why it exists.
 * Exit code: 0 pass, 1 fail, 2 usage error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPackage } from './lib/package.mjs';
import { validatePackage, formatReport } from './lib/validate.mjs';
import { createEmulator, API_MULTIPLIER } from './lib/emulator.mjs';
import { runBot } from './lib/bot.mjs';
import { rebalancePackage } from './lib/rebalance.mjs';
import { writeFixture } from './lib/fixture.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = argv.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(arr[i - 1] || '').startsWith('--'));
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const list = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);

function usage(msg) {
  if (msg) console.error(msg);
  console.error(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(2, 16).join('\n'));
  process.exit(2);
}

function emulatorOptions() {
  const game = flag('game');
  return {
    seed: Number(flag('seed', 1)),
    minRoundMs: Number(flag('min-round-ms', 0)),
    autoEndRoundDisabled: list(flag('auto-end-round-disabled')),
    betLevels: list(flag('bet-levels')).map((d) => Math.round(Number(d) * API_MULTIPLIER)),
    gameDir: game && game !== true && game !== 'reference' ? path.resolve(game) : undefined,
    tls: !!flag('tls'),
    jurisdiction: flag('social') ? { socialCasino: true } : undefined,
  };
}

function gameUrlFor(emu) {
  const game = flag('game');
  const url = flag('game-url');
  if (url && url !== true) return url;
  if (game === 'reference') return `${emu.origin}/reference/index.html`;
  if (game && game !== true) return `${emu.origin}/game/${flag('entry', 'index.html')}`;
  return null;
}

function browserOptions(emu) {
  const reference = flag('game') === 'reference';
  return {
    gameUrl: gameUrlFor(emu),
    spinKey: flag('spin-key', 'Space'),
    spinSelector: flag('spin-selector') || undefined,
    buySteps: list(flag('buy-steps')).length ? list(flag('buy-steps')) : reference ? ['#buy', '#confirm-yes'] : undefined,
    buyMode: flag('buy-mode') || undefined,
    replaySelector: flag('replay-selector') || (reference ? '#replay-play' : undefined),
    settleMs: Number(flag('settle-ms', 1500)),
    roundTimeoutMs: Number(flag('round-timeout-ms', 60_000)),
    out: flag('out', 'stake-harness-report'),
    headed: !!flag('headed'),
    extraParams: flag('bug') ? { bug: flag('bug') } : undefined,
  };
}

function printScenarios(title, r) {
  console.log(`\n${title}: ${r.ok ? 'PASS' : 'FAIL'}`);
  for (const s of r.scenarios) console.log(`  ${s.pass ? 'ok  ' : 'FAIL'} ${s.name}${s.detail ? ` — ${s.detail}` : ''}`);
  if (r.consoleErrors?.length) {
    console.log(`  console errors (${r.consoleErrors.length}):`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    [${e.scenario}] ${e.text}`);
  }
}

async function main() {
  const dir = positional[0];
  switch (cmd) {
    case 'validate': {
      if (!dir) usage('validate needs <math-dir>');
      const r = validatePackage(dir, { requireStandard: !!flag('strict'), buyModes: list(flag('buy-modes')), expectFeature: !!flag('expect-feature') });
      console.log(flag('json') ? JSON.stringify(r, null, 2) : formatReport(r));
      return r.ok ? 0 : 1;
    }
    case 'emulate': {
      if (!dir) usage('emulate needs <math-dir>');
      const pkg = loadPackage(dir);
      const emu = await createEmulator(pkg, emulatorOptions()).listen(Number(flag('port', 5050)), flag('host', '127.0.0.1'));
      console.log(`Stake RGS emulator on ${emu.origin} serving ${pkg.modes.map((m) => `${m.name} (${m.cost}×, ${m.bookCount} books)`).join(', ')}`);
      const g = gameUrlFor(emu) || `${emu.origin}/reference/index.html`;
      console.log(`Open: ${emu.launchUrl(g)}`);
      console.log(`Harness: GET ${emu.controlOrigin}/__harness/state   POST ${emu.controlOrigin}/__harness/force {"mode":"base","kind":"featureWin"}`);
      await new Promise(() => {});
      return 0;
    }
    case 'bot': {
      if (!dir) usage('bot needs <math-dir>');
      const pkg = loadPackage(dir);
      const emu = await createEmulator(pkg, emulatorOptions()).listen();
      const r = await runBot(emu.controlOrigin, pkg, { soak: Number(flag('soak', 200)) });
      await emu.close();
      printScenarios('Protocol bot', r);
      return r.ok ? 0 : 1;
    }
    case 'browser': {
      if (!dir) usage('browser needs <math-dir>');
      const pkg = loadPackage(dir);
      const emu = await createEmulator(pkg, emulatorOptions()).listen();
      const o = browserOptions(emu);
      if (!o.gameUrl) usage('browser needs --game <build-dir>, --game reference or --game-url <url>');
      const { runBrowser } = await import('./lib/browser.mjs');
      const r = await runBrowser(emu, pkg, o);
      await emu.close();
      printScenarios('Browser', r);
      console.log(`\nScreenshots and transcript: ${path.resolve(o.out)}`);
      return r.ok ? 0 : 1;
    }
    case 'check': {
      if (!dir) usage('check needs <math-dir>');
      const out = path.resolve(flag('out', 'stake-harness-report'));
      fs.mkdirSync(out, { recursive: true });
      const report = { when: new Date().toISOString(), mathDir: path.resolve(dir), validate: null, bot: null, browser: null };

      const v = validatePackage(dir, { requireStandard: !!flag('strict'), buyModes: list(flag('buy-modes')), expectFeature: !!flag('expect-feature') });
      report.validate = v;
      console.log(formatReport(v));
      if (!v.modes.length) {
        fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
        console.log('\nOVERALL: FAIL (the package could not be read)');
        return 1;
      }
      const pkg = loadPackage(dir);
      const emu = await createEmulator(pkg, emulatorOptions()).listen();
      report.bot = await runBot(emu.controlOrigin, pkg, { soak: Number(flag('soak', 200)) });
      printScenarios('Protocol bot (books played by a correct client)', report.bot);
      const o = browserOptions(emu);
      if (o.gameUrl) {
        await fetch(`${emu.controlOrigin}/__harness/reset`, { method: 'POST' });
        const { runBrowser } = await import('./lib/browser.mjs');
        report.browser = await runBrowser(emu, pkg, { ...o, out });
        printScenarios('Browser (the real game against the emulator)', report.browser);
      } else {
        console.log('\nBrowser: SKIPPED (no --game/--game-url; the frontend was not tested)');
      }
      await emu.close();
      const ok = v.ok && report.bot.ok && (report.browser ? report.browser.ok : true);
      report.ok = ok;
      report.frontendTested = !!report.browser;
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, (k, val) => (typeof val === 'bigint' ? val.toString() : val), 2));
      console.log(`\nOVERALL: ${ok ? 'PASS' : 'FAIL'}${report.browser ? '' : ' (maths only — the frontend was not tested)'}`);
      console.log(`Report: ${path.join(out, 'report.json')}`);
      return ok ? 0 : 1;
    }
    case 'rebalance': {
      if (!dir) usage('rebalance needs <math-dir>');
      const rtp = Number(flag('rtp', 0.963));
      const r = rebalancePackage(dir, rtp, flag('into') && flag('into') !== true ? flag('into') : null);
      for (const m of r.modes) console.log(`${m.mode}: RTP ${(m.achieved * 100).toFixed(4)}% (weights ${m.wH} / ${m.wL})`);
      console.log(`Lookup tables written to ${r.dir}. Run validate: hit rate and feature frequency changed too.`);
      return 0;
    }
    case 'fixture': {
      if (!dir) usage('fixture needs <out-dir>');
      writeFixture(path.resolve(dir), { flavour: flag('flavour', 'standard'), seed: Number(flag('seed', 7)) });
      console.log(`Fixture (${flag('flavour', 'standard')}) written to ${path.resolve(dir)}`);
      return 0;
    }
    default:
      usage(cmd ? `unknown command "${cmd}"` : null);
  }
  return 2;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e?.code ? `${e.code}: ${e.message}` : e?.stack || e);
    process.exit(1);
  },
);
