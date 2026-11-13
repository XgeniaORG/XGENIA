/**
 * A correct Stake client, played against the emulator: proves the BOOKS play end to end before any
 * frontend is involved, and reconciles every cent.
 *
 * It follows the contract the official web-sdk follows (createPrimaryMachines.ts):
 * authenticate → play → walk the book, posting /bet/event at each round start of a multi-round
 * book → end-round when the round is still active → balance. If this bot cannot finish a bonus, no
 * frontend can; if it can and the game cannot, the fault is in the game.
 *
 * Scenarios (each with a fresh session, so one failure never hides behind another):
 *   loss, single-win, base-bonus          forced book kinds in the base mode
 *   buy:<mode>                            every mode other than base, forced into a feature book
 *   resume-mid-bonus                      play a bonus, save progress half-way, "reload"
 *                                         (re-authenticate), finish from the saved event, end it
 *   replay                                GET /bet/replay of a bonus book, no session at all
 *   play-while-active-refused             the emulator must refuse a second play (negative check)
 *   soak:<mode>                           N weighted draws; the balance must reconcile exactly
 */
import { API_MULTIPLIER } from './emulator.mjs';
import { roundStarts } from './rounds.mjs';

async function post(origin, p, body) {
  const r = await fetch(origin + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let json = null;
  try {
    json = await r.json();
  } catch {
    /* empty */
  }
  return { status: r.status, json };
}

async function force(origin, f) {
  await post(origin, '/__harness/force', f);
}

class Fail extends Error {}
const must = (cond, msg) => {
  if (!cond) throw new Fail(msg);
};

/** Play one paid round the way a correct frontend does. Returns what happened. */
export async function playRound(origin, sessionID, { mode = 'base', amount = API_MULTIPLIER, saveAt = null, stopAfterSave = false } = {}) {
  const before = await post(origin, '/wallet/balance', { sessionID });
  must(before.status === 200, `balance failed: ${JSON.stringify(before.json)}`);
  const play = await post(origin, '/wallet/play', { sessionID, amount, mode });
  must(play.status === 200, `play refused: ${JSON.stringify(play.json)}`);
  const round = play.json.round;
  must(Array.isArray(round?.state) && round.state.length > 0, 'round.state is empty');
  const starts = roundStarts(round.state);
  const multi = starts.length > 1;
  const saved = [];
  for (const k of starts) {
    if (multi && round.active) {
      const e = await post(origin, '/bet/event', { sessionID, event: String(k) });
      must(e.status === 200, `/bet/event ${k} refused: ${JSON.stringify(e.json)}`);
      saved.push(k);
    }
    if (saveAt !== null && k >= saveAt && stopAfterSave) return { round, starts, saved, abandoned: true, before: before.json.balance.amount };
  }
  let after = play.json.balance.amount;
  if (round.active) {
    const end = await post(origin, '/wallet/end-round', { sessionID });
    must(end.status === 200, `end-round refused: ${JSON.stringify(end.json)}`);
    after = end.json.balance.amount;
  }
  const charged = Math.round(amount * round.costMultiplier);
  const expected = before.json.balance.amount - charged + round.payout;
  must(after === expected, `balance does not reconcile: had ${before.json.balance.amount}, charged ${charged}, won ${round.payout}, expected ${expected}, got ${after}`);
  must(Math.round(amount * round.payoutMultiplier) === round.payout, `payout ${round.payout} ≠ amount × payoutMultiplier (${amount} × ${round.payoutMultiplier})`);
  return { round, starts, saved, abandoned: false };
}

export async function runBot(origin, pkg, { soak = 200 } = {}) {
  const results = [];
  let n = 0;
  const sid = (name) => `bot-${name}-${++n}`;
  const auth = async (sessionID) => {
    const a = await post(origin, '/wallet/authenticate', { sessionID, language: 'en' });
    must(a.status === 200, `authenticate failed: ${JSON.stringify(a.json)}`);
    return a.json;
  };
  const scenario = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, pass: true, detail: detail ?? '' });
    } catch (e) {
      results.push({ name, pass: false, detail: e instanceof Fail ? e.message : String(e?.stack || e) });
    }
  };

  const base = pkg.modes.find((m) => m.cost === 1) || pkg.modes[0];
  const classes = async (mode) => (await fetch(`${origin}/__harness/classes?mode=${encodeURIComponent(mode)}`)).json();
  const baseClasses = await classes(base.name);

  await scenario('loss', async () => {
    must(baseClasses.loss.length > 0, `mode ${base.name} has no losing book`);
    const s = sid('loss');
    await auth(s);
    await force(origin, { mode: base.name, kind: 'loss', sessionID: s });
    const r = await playRound(origin, s, { mode: base.name });
    return `book ${r.round.payoutMultiplier}×, ${r.round.active ? 'ended by client' : 'auto-closed'}`;
  });
  await scenario('single-win', async () => {
    must(baseClasses.single.length > 0, `mode ${base.name} has no single-round winning book`);
    const s = sid('win');
    await auth(s);
    await force(origin, { mode: base.name, kind: 'single', sessionID: s });
    const r = await playRound(origin, s, { mode: base.name });
    return `won ${r.round.payoutMultiplier}×`;
  });
  await scenario('base-bonus', async () => {
    must(baseClasses.feature.length > 0, `mode ${base.name} never produces a multi-round book: the base game cannot reach its bonus (free spins dropped at export, or the trigger never fires)`);
    const s = sid('bonus');
    await auth(s);
    await force(origin, { mode: base.name, kind: 'feature', sessionID: s });
    const r = await playRound(origin, s, { mode: base.name });
    must(r.starts.length > 1, 'forced feature book has one round');
    return `${r.starts.length} rounds, ${r.round.payoutMultiplier}×, ${r.saved.length} progress saves`;
  });
  for (const m of pkg.modes) {
    if (m === base) continue;
    await scenario(`buy:${m.name}`, async () => {
      const c = await classes(m.name);
      const s = sid(`buy-${m.name}`);
      await auth(s);
      if (c.feature.length) await force(origin, { mode: m.name, kind: 'feature', sessionID: s });
      const r = await playRound(origin, s, { mode: m.name });
      return `cost ${m.cost}×, ${r.starts.length} rounds, ${r.round.payoutMultiplier}×${c.feature.length ? '' : ' (mode has no feature book)'}`;
    });
  }
  await scenario('resume-mid-bonus', async () => {
    const pool = baseClasses.feature.length ? { mode: base.name } : null;
    const buy = pkg.modes.find((m) => m !== base);
    const mode = pool ? base.name : buy?.name;
    must(mode, 'no mode can produce a bonus to resume');
    const s = sid('resume');
    await auth(s);
    await force(origin, { mode, kind: 'featureWin', sessionID: s });
    const play = await post(origin, '/wallet/play', { sessionID: s, amount: API_MULTIPLIER, mode });
    must(play.status === 200, `play refused: ${JSON.stringify(play.json)}`);
    const starts = roundStarts(play.json.round.state);
    must(starts.length > 1, 'forced feature book is a single round');
    must(play.json.round.active, 'a bonus round auto-closed: it paid 0 and the mode closes 0-wins, so it cannot be resumed');
    const mid = starts[Math.floor(starts.length / 2)];
    for (const k of starts.filter((x) => x <= mid)) await post(origin, '/bet/event', { sessionID: s, event: String(k) });
    // "reload": a new page authenticates again
    const again = await auth(s);
    must(again.round && again.round.active, 'authenticate after a reload did not return the active round');
    must(again.round.event === String(mid), `authenticate returned event ${JSON.stringify(again.round.event)}, expected "${mid}"`);
    const rest = again.round.state.slice(Number(again.round.event)); // web-sdk slices by array position
    must(rest[0]?.index === mid, `resume point is event index ${rest[0]?.index}, expected ${mid}: event index ≠ array position`);
    const remaining = starts.filter((x) => x > mid);
    for (const k of remaining) await post(origin, '/bet/event', { sessionID: s, event: String(k) });
    const end = await post(origin, '/wallet/end-round', { sessionID: s });
    must(end.status === 200, `end-round after resume refused: ${JSON.stringify(end.json)}`);
    return `resumed at event ${mid} of ${play.json.round.state.length}, ${remaining.length} rounds left, ended`;
  });
  await scenario('replay', async () => {
    const mode = baseClasses.feature.length ? base.name : pkg.modes.find((m) => m !== base)?.name ?? base.name;
    const c = await classes(mode);
    const id = (c.feature[0] ?? c.win[0] ?? c.loss[0]);
    must(id !== undefined, 'no book to replay');
    const r = await fetch(`${origin}/bet/replay/local/1/${mode}/${id}`);
    must(r.status === 200, `replay returned ${r.status}`);
    const j = await r.json();
    must(Array.isArray(j.state) && j.state.length > 0 && typeof j.payoutMultiplier === 'number' && typeof j.costMultiplier === 'number', 'replay response lacks state/payoutMultiplier/costMultiplier');
    return `mode ${mode} book ${id}: ${j.state.length} events, ${j.payoutMultiplier}×, cost ${j.costMultiplier}×`;
  });
  await scenario('play-while-active-refused', async () => {
    must(baseClasses.win.length > 0, 'no winning book');
    const s = sid('double');
    await auth(s);
    await force(origin, { mode: base.name, kind: 'win', sessionID: s });
    const a = await post(origin, '/wallet/play', { sessionID: s, amount: API_MULTIPLIER, mode: base.name });
    must(a.status === 200 && a.json.round.active, 'first play did not leave an active round');
    const b = await post(origin, '/wallet/play', { sessionID: s, amount: API_MULTIPLIER, mode: base.name });
    must(b.status === 400 && b.json.error === 'ERR_BE', `second play while active was not refused (got ${b.status} ${JSON.stringify(b.json)})`);
    await post(origin, '/wallet/end-round', { sessionID: s });
    return 'second play refused with ERR_BE, as on Stake';
  });
  for (const m of pkg.modes) {
    if (!soak) break;
    await scenario(`soak:${m.name}`, async () => {
      const s = sid(`soak-${m.name}`);
      await auth(s);
      let features = 0;
      let paid = 0;
      const count = m.cost >= 10 ? Math.max(10, Math.floor(soak / 10)) : soak;
      for (let i = 0; i < count; i++) {
        const r = await playRound(origin, s, { mode: m.name });
        if (r.starts.length > 1) features++;
        paid += r.round.payout;
      }
      return `${count} rounds reconciled, ${features} bonus, paid ${(paid / API_MULTIPLIER).toFixed(2)} on ${(count * m.cost).toFixed(2)} staked`;
    });
  }
  // The emulator saw every call: a contract breach it recorded is a failure even if a scenario
  // passed (except the one breach we provoked on purpose).
  const st = await (await fetch(`${origin}/__harness/state`)).json();
  const breaches = st.violations.filter((v) => !(v.code === 'PLAY_WHILE_ACTIVE' && String(v.sessionID).startsWith('bot-double')));
  results.push({ name: 'no-contract-breaches', pass: breaches.length === 0, detail: breaches.length ? breaches.map((v) => `${v.code}: ${v.message}`).join('; ') : 'none' });
  return { ok: results.every((r) => r.pass), scenarios: results };
}
