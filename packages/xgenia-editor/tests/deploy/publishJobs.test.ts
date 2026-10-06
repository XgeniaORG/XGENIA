import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublishJobRegistry, withTimeout } from '../../src/editor/src/utils/publish/publishJobs';

function registry(keepFinished = 10) {
  let clock = 1000;
  let ids = 0;
  return createPublishJobRegistry({ now: () => clock++, newId: () => `job-${++ids}`, keepFinished });
}

/** A job body the test finishes by hand. */
function gate<T>() {
  let open!: (value: T) => void;
  let fail!: (e: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  return { promise, open, fail };
}

test('start answers at once; the job reports its steps, then its result', async () => {
  const jobs = registry();
  const g = gate<{ liveUrl: string }>();
  const started = jobs.start('game', async (progress) => {
    progress('Building UI bundle...');
    progress('Deploying to Vercel...');
    return g.promise;
  });
  assert.deepEqual(started, { jobId: 'job-1', kind: 'game', startedAt: 1000 });

  await Promise.resolve();
  await Promise.resolve();
  const running = jobs.get('job-1')!;
  assert.equal(running.state, 'running');
  assert.equal(running.step, 'Deploying to Vercel...');
  assert.deepEqual(running.steps.map((s) => s.text), ['Building UI bundle...', 'Deploying to Vercel...']);
  assert.equal(running.finishedAt, undefined);

  g.open({ liveUrl: 'https://keno.vercel.app' });
  await jobs.settled('job-1');
  const done = jobs.get('job-1')!;
  assert.equal(done.state, 'done');
  assert.deepEqual(done.result, { liveUrl: 'https://keno.vercel.app' });
  assert.ok(done.finishedAt! > done.startedAt);
  // A snapshot is plain data — it has to survive postMessage.
  assert.deepEqual(JSON.parse(JSON.stringify(done)), done);
});

test('only one job at a time; the refusal names the running job and never runs the body', async () => {
  const jobs = registry();
  const g = gate<void>();
  jobs.start('maths', () => g.promise);
  let ranSecond = false;
  const refused = jobs.start('game', async () => {
    ranSecond = true;
  });
  assert.deepEqual(refused, { error: 'A publish is already running', jobId: 'job-1' });
  g.open();
  await jobs.settled('job-1');
  await Promise.resolve();
  assert.equal(ranSecond, false);
  // Once it has finished, the next one may start.
  assert.equal(jobs.start('game', async () => 'ok').jobId, 'job-2');
});

test('a throwing body fails the job with its message, synchronous throws included', async () => {
  const jobs = registry();
  const { jobId } = jobs.start('game', () => {
    throw new Error('Domain name is already in use on Vercel.');
  });
  await jobs.settled(jobId!);
  const failed = jobs.get(jobId)!;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.error, 'Domain name is already in use on Vercel.');
  assert.equal(failed.result, undefined);
});

test('progress after the job finished is ignored', async () => {
  const jobs = registry();
  let late: ((text: string) => void) | null = null;
  const { jobId } = jobs.start('maths', async (progress) => {
    late = progress;
    progress('Compiling…');
    return 1;
  });
  await jobs.settled(jobId!);
  late!('too late');
  assert.deepEqual(jobs.get(jobId)!.steps.map((s) => s.text), ['Compiling…']);
});

test('without an id, get answers the running job, else the latest; unknown ids are null', async () => {
  const jobs = registry();
  assert.equal(jobs.get(), null);
  const first = jobs.start('maths', async () => 1);
  await jobs.settled(first.jobId!);
  const g = gate<number>();
  const second = jobs.start('game', () => g.promise);
  assert.equal(jobs.get()!.jobId, second.jobId);
  g.open(2);
  await jobs.settled(second.jobId!);
  assert.equal(jobs.get()!.jobId, second.jobId);
  assert.equal(jobs.get('nope'), null);
});

test('finished jobs are kept for the last N only', async () => {
  const jobs = registry(2);
  for (let i = 0; i < 4; i++) {
    const { jobId } = jobs.start('maths', async () => i);
    await jobs.settled(jobId!);
  }
  assert.equal(jobs.get('job-1'), null);
  assert.equal(jobs.get('job-2'), null);
  assert.equal(jobs.get('job-3')!.result, 2);
  assert.equal(jobs.get('job-4')!.result, 3);
});

test('a snapshot cannot be used to rewrite the job', async () => {
  const jobs = registry();
  const { jobId } = jobs.start('maths', async (progress) => {
    progress('one');
    return 1;
  });
  await jobs.settled(jobId!);
  const snap = jobs.get(jobId)!;
  snap.steps.push({ at: 0, text: 'forged' });
  snap.state = 'failed';
  assert.equal(jobs.get(jobId)!.state, 'done');
  assert.equal(jobs.get(jobId)!.steps.length, 1);
});

test('withTimeout answers with the value, or rejects naming what was slow', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'Fast'), 7);
  await assert.rejects(
    withTimeout(new Promise(() => { /* never */ }), 20, 'The availability check'),
    /The availability check did not answer within 1 s/
  );
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 50, 'X'), /boom/);
});

test('a body that never settles is failed at maxRunMs, and the next start is not blocked', async () => {
  const reg = createPublishJobRegistry({ maxRunMs: 20 });
  const hung = reg.start('game', () => new Promise(() => { /* a request that never answers */ }));
  await reg.settled(hung.jobId!);
  const job = reg.get(hung.jobId)!;
  assert.equal(job.state, 'failed');
  assert.match(String(job.error), /The publish did not answer within/);
  const next = reg.start('maths', async () => 'ok');
  assert.ok(next.jobId, 'a new job starts once the hung one is failed');
});
