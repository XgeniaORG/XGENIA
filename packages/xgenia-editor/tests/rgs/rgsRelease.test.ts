import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGamePayload,
  createReleaseGame,
  defaultReleaseGameForm,
  describeCertification,
  downloadPrecertPack,
  fetchCertificationStatus,
  filenameFromDisposition,
  GAME_FORM_MESSAGES,
  gameFormProblem,
  isCertificationActive,
  startCertification,
  toCertificationStatus,
  toMinorUnits
} from '../../src/editor/src/utils/rgs/rgsRelease';

const BASE = { functionsUrl: 'https://x.test/functions/v1', headers: { 'X-Operator-Key': 'k' } };

function fake(answers: Array<{ match: (url: string, body: any) => boolean; status: number; body: any; headers?: Record<string, string>; binary?: ArrayBuffer }>, calls: any[] = []) {
  return async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const a = answers.find((x) => x.match(url, body));
    if (!a) throw new Error('offline');
    const h = a.headers || { 'content-type': 'application/json' };
    return {
      ok: a.status < 300,
      status: a.status,
      headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
      text: async () => JSON.stringify(a.body),
      arrayBuffer: async () => a.binary as ArrayBuffer
    };
  };
}

test('money is typed in major units and sent as exact integer minor units, per currency', () => {
  assert.equal(toMinorUnits('0.20', 'EUR'), 20);
  assert.equal(toMinorUnits('0.29', 'EUR'), 29); // not 28 — no float multiply
  assert.equal(toMinorUnits('100', 'EUR'), 10000);
  assert.equal(toMinorUnits('1,5', 'EUR'), 150);
  assert.equal(toMinorUnits('100', 'JPY'), 100);
  assert.equal(toMinorUnits('1.5', 'JPY'), null); // yen has no minor unit
  assert.equal(toMinorUnits('0.125', 'KWD'), 125);
  assert.equal(toMinorUnits('0.125', 'EUR'), null);
  assert.equal(toMinorUnits('-1', 'EUR'), null);
  assert.equal(toMinorUnits('abc', 'EUR'), null);
});

test('the game form opens with the project name and launch defaults, and validates in plain words', () => {
  const form = defaultReleaseGameForm('__Crash Space__');
  assert.deepEqual(form, { name: 'Crash Space', rtp: '96', minBet: '0.20', maxBet: '100.00', maxWin: '5000' });
  assert.equal(gameFormProblem(form, 'EUR'), '');
  assert.equal(gameFormProblem({ ...form, name: '  ' }, 'EUR'), GAME_FORM_MESSAGES.name);
  assert.equal(gameFormProblem({ ...form, rtp: '100' }, 'EUR'), GAME_FORM_MESSAGES.rtp); // a game may not pay back everything
  assert.equal(gameFormProblem({ ...form, rtp: '70' }, 'EUR'), GAME_FORM_MESSAGES.rtp);
  assert.equal(gameFormProblem({ ...form, minBet: '0' }, 'EUR'), GAME_FORM_MESSAGES.minBet);
  assert.equal(gameFormProblem({ ...form, maxBet: '0.10' }, 'EUR'), GAME_FORM_MESSAGES.maxBet);
  assert.equal(gameFormProblem({ ...form, maxWin: '2.5' }, 'EUR'), GAME_FORM_MESSAGES.maxWin);
});

test('create-game carries the declared RTP, bet range and max win, always as a demo draft', () => {
  const p = createGamePayload({ name: 'Crash Space', rtp: '96.5', minBet: '0.20', maxBet: '100', maxWin: '5000' }, 'EUR');
  assert.deepEqual(p, {
    action: 'create-game',
    name: 'Crash Space',
    slug: 'crash-space',
    description: '',
    mode: 'demo',
    status: 'draft',
    declared_rtp: 96.5,
    min_bet: 20,
    max_bet: 10000,
    max_win_multiplier: 5000
  });
  assert.throws(() => createGamePayload({ name: 'x', rtp: '101', minBet: '1', maxBet: '2', maxWin: '1' }, 'EUR'), {
    message: GAME_FORM_MESSAGES.rtp
  });
});

test('a server that stores the range answers once; one that ignores it gets set-bet-range', async () => {
  const form = defaultReleaseGameForm('Gem Slot');
  const echoes: any[] = [];
  const g = await createReleaseGame(
    BASE,
    form,
    'EUR',
    fake([{ match: (_u, b) => b.action === 'create-game', status: 200, body: { game_id: 'g1', slug: 'gem-slot', game: { id: 'g1', name: 'Gem Slot', min_bet: 20, max_bet: 10000 } } }], echoes)
  );
  assert.deepEqual(g, { id: 'g1', slug: 'gem-slot', name: 'Gem Slot', existing: false });
  assert.equal(echoes.length, 1);

  const old: any[] = [];
  await createReleaseGame(
    BASE,
    form,
    'EUR',
    fake(
      [
        { match: (_u, b) => b.action === 'create-game', status: 200, body: { game_id: 'g2', slug: 'gem-slot' } },
        { match: (_u, b) => b.action === 'set-bet-range', status: 200, body: { ok: true } }
      ],
      old
    )
  );
  assert.deepEqual(old[1].body, { action: 'set-bet-range', game_id: 'g2', min_bet: 20, max_bet: 10000 });
});

test('an existing game of the same name is reused as it is — its bet range is not rewritten', async () => {
  const calls: any[] = [];
  const g = await createReleaseGame(
    BASE,
    defaultReleaseGameForm('Gem Slot'),
    'EUR',
    fake([{ match: (_u, b) => b.action === 'create-game', status: 200, body: { created: false, game_id: 'g9', slug: 'gem-slot', game: { id: 'g9', name: 'Gem Slot', min_bet: 50, max_bet: 500 } } }], calls)
  );
  assert.equal(g.existing, true);
  assert.equal(calls.length, 1); // no set-bet-range
});

test('a refused create says why', async () => {
  await assert.rejects(
    createReleaseGame(BASE, defaultReleaseGameForm('X'), 'EUR', fake([{ match: () => true, status: 400, body: { error: 'A game with this slug already exists.' } }])),
    { message: 'A game with this slug already exists.' }
  );
});

test('certification start and status follow the contract, and resume by game after a restart', async () => {
  const calls: any[] = [];
  const f = fake(
    [
      { match: (_u, b) => b.action === 'certify-game', status: 200, body: { job_id: 'j1', status: 'queued', reused: false, message: 'Started.' } },
      { match: (_u, b) => b.action === 'certify-status', status: 200, body: { job_id: 'j1', status: 'running', progress: 0.42, rounds_done: 42_000_000, rounds_total: 100_000_000 } }
    ],
    calls
  );
  const started = await startCertification(BASE, 'g1', false, f);
  assert.equal(started.jobId, 'j1');
  assert.equal(isCertificationActive(started), true);
  assert.deepEqual(calls[0].body, { action: 'certify-game', game_id: 'g1', quick: false });
  assert.equal(calls[0].url, 'https://x.test/functions/v1/rtp-certify');

  const byGame = await fetchCertificationStatus(BASE, { gameId: 'g1' }, f);
  assert.deepEqual(calls[1].body, { action: 'certify-status', game_id: 'g1' });
  assert.equal(byGame.progress, 0.42);
  assert.match(describeCertification(byGame).text, /42%.*42,000,000 of 100,000,000/);
});

test('results read in plain words: certified, preview, fails its declared RTP, none', () => {
  const passed = toCertificationStatus({ status: 'passed', measured_rtp: 96.02, declared_rtp: 96, within_tolerance: true });
  assert.deepEqual(describeCertification(passed), { tone: 'good', text: 'Certified: pays 96.02% against a declared 96.00%.' });
  const preview = toCertificationStatus({ status: 'passed', quick: true, measured_rtp: 95.9, declared_rtp: 96, within_tolerance: true });
  assert.match(describeCertification(preview).text, /^Preview passed \(not a certificate\)/);
  const failed = toCertificationStatus({ status: 'failed', measured_rtp: 94.6, declared_rtp: 96, within_tolerance: false });
  assert.equal(describeCertification(failed).tone, 'bad');
  assert.match(describeCertification(failed).text, /Pays 94\.60% but declares 96\.00%/);
  // A "passed" the server marks out of tolerance is never shown as good.
  assert.equal(describeCertification(toCertificationStatus({ status: 'passed', within_tolerance: false })).tone, 'bad');
  assert.equal(describeCertification(toCertificationStatus({})).tone, 'idle');
  // The server's own sentence wins when it gives one.
  assert.equal(describeCertification(toCertificationStatus({ status: 'failed', message: 'Maths changed since the run.' })).text, 'Maths changed since the run.');
});

test('the pack downloads as bytes with the server filename; a JSON error is shown, not saved', async () => {
  const zip = new Uint8Array([0x50, 0x4b, 3, 4]).buffer;
  const ok = await downloadPrecertPack(
    BASE,
    { id: 'g1', slug: 'gem-slot' },
    fake([{ match: (_u, b) => b.action === 'pack', status: 200, body: null, binary: zip, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="gem-slot-precert-pack.zip"' } }])
  );
  assert.equal(ok.filename, 'gem-slot-precert-pack.zip');
  assert.equal(ok.bytes.byteLength, 4);
  await assert.rejects(
    downloadPrecertPack(BASE, { id: 'g1', slug: 'gem-slot' }, fake([{ match: () => true, status: 404, body: { error: 'This game has no deployed maths yet.' } }])),
    { message: 'This game has no deployed maths yet.' }
  );
  assert.equal(filenameFromDisposition('attachment; filename="../../evil.zip"', 'x.zip'), '..-..-evil.zip');
  assert.equal(filenameFromDisposition(null, 'fallback.zip'), 'fallback.zip');
});
