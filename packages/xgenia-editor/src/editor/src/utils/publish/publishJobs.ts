// Background jobs for the AI's publish commands (EditorBridge `publish.start` /
// `publish.job`).
//
// A publish takes minutes — a UI build, a GitHub push, and up to two minutes of
// Vercel polling — and the AI reaches the editor through a relay that gives each
// command 30 seconds. So the command only STARTS the work and answers with a job
// id at once; the caller then polls the job for its steps and, eventually, its
// result. One job at a time: two publishes would fight over the same toast, the
// same publish state and, for a game, the same project copy on disk.
//
// Deliberately dependency-free: this module is unit-tested under plain Node
// (tests/deploy/publishJobs.test.ts), so it must not pull in editor models.

export type PublishJobKind = 'maths' | 'game';
export type PublishJobState = 'running' | 'done' | 'failed';

export interface PublishJobStep {
  /** ms since epoch. */
  at: number;
  text: string;
}

/** What `publish.job` answers — a plain object, so it survives postMessage. */
export interface PublishJobSnapshot {
  jobId: string;
  kind: PublishJobKind;
  state: PublishJobState;
  /** The latest progress line, '' before the first. */
  step: string;
  steps: PublishJobStep[];
  startedAt: number;
  finishedAt?: number;
  /** The job's return value, once done. */
  result?: any;
  /** Why it failed, once failed. */
  error?: string;
}

/** What `publish.start` answers: the new job, or why none was started. */
export interface PublishJobStart {
  jobId?: string;
  kind?: PublishJobKind;
  startedAt?: number;
  error?: string;
}

/** The job body: report progress through `progress`, resolve with the result, throw to fail. */
export type PublishJobRun = (progress: (text: string) => void) => Promise<any>;

export interface PublishJobRegistry {
  /** Start a job unless one is running. Never throws, and never runs `run` when refusing. */
  start(kind: PublishJobKind, run: PublishJobRun): PublishJobStart;
  /** A job by id; with no id, the running job or else the most recent one. Null when unknown. */
  get(jobId?: string | null): PublishJobSnapshot | null;
  /** The running job, if any. */
  running(): PublishJobSnapshot | null;
  /** Resolves once the job has finished, whatever the outcome. For tests and awaiting callers. */
  settled(jobId: string): Promise<void>;
}

export interface PublishJobRegistryOptions {
  now?: () => number;
  newId?: () => string;
  /** How many FINISHED jobs to remember, so a poll after a reconnect still finds the result. */
  keepFinished?: number;
  /** Cap on recorded steps per job; the oldest are dropped first. */
  maxSteps?: number;
  /**
   * A job still running after this long is reported failed, so a request that never answers (the
   * GitHub/Vercel helper sets no socket timeout) cannot hold the registry 'running' for good and block
   * every later start. The work itself is not cancelled. Unset = no limit.
   */
  maxRunMs?: number;
}

function defaultId(): string {
  return `pub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createPublishJobRegistry(options: PublishJobRegistryOptions = {}): PublishJobRegistry {
  const now = options.now || (() => Date.now());
  const newId = options.newId || defaultId;
  const keepFinished = Math.max(1, options.keepFinished ?? 10);
  const maxSteps = Math.max(1, options.maxSteps ?? 200);
  const maxRunMs = options.maxRunMs && options.maxRunMs > 0 ? options.maxRunMs : 0;

  // Insertion order is start order, which is what "most recent" and the
  // finished-job eviction below both go by.
  const jobs = new Map<string, PublishJobSnapshot>();
  const done = new Map<string, Promise<void>>();

  // Callers get copies: a snapshot goes straight back over postMessage, and an
  // edit to it must not rewrite the job.
  const copy = (job: PublishJobSnapshot): PublishJobSnapshot => ({ ...job, steps: job.steps.slice() });

  const runningJob = (): PublishJobSnapshot | null => {
    for (const job of jobs.values()) if (job.state === 'running') return job;
    return null;
  };

  const evictFinished = () => {
    const finished = Array.from(jobs.values()).filter((j) => j.state !== 'running');
    for (const job of finished.slice(0, Math.max(0, finished.length - keepFinished))) {
      jobs.delete(job.jobId);
      done.delete(job.jobId);
    }
  };

  return {
    start(kind, run) {
      const busy = runningJob();
      if (busy) return { error: 'A publish is already running', jobId: busy.jobId };

      const job: PublishJobSnapshot = { jobId: newId(), kind, state: 'running', step: '', steps: [], startedAt: now() };
      jobs.set(job.jobId, job);

      const progress = (text: string) => {
        if (job.state !== 'running') return;
        const line = String(text ?? '');
        job.step = line;
        job.steps.push({ at: now(), text: line });
        if (job.steps.length > maxSteps) job.steps.splice(0, job.steps.length - maxSteps);
      };

      // Started on a microtask, not inline: `start` answers first, and a body
      // that throws synchronously still lands in the catch below.
      const finished = Promise.resolve()
        .then(() => (maxRunMs ? withTimeout(Promise.resolve(run(progress)), maxRunMs, 'The publish') : run(progress)))
        .then(
          (result) => {
            job.state = 'done';
            job.result = result;
          },
          (e: any) => {
            job.state = 'failed';
            job.error = String(e?.message || e || 'failed');
          }
        )
        .then(() => {
          job.finishedAt = now();
          evictFinished();
        });
      done.set(job.jobId, finished);

      return { jobId: job.jobId, kind, startedAt: job.startedAt };
    },

    get(jobId) {
      if (jobId) {
        const job = jobs.get(jobId);
        return job ? copy(job) : null;
      }
      const active = runningJob();
      if (active) return copy(active);
      const all = Array.from(jobs.values());
      return all.length > 0 ? copy(all[all.length - 1]) : null;
    },

    running() {
      const job = runningJob();
      return job ? copy(job) : null;
    },

    settled(jobId) {
      return done.get(jobId) || Promise.resolve();
    }
  };
}

/**
 * Resolve with `promise`, or reject with "<label> did not answer within N s".
 *
 * The underlying work is NOT cancelled — there is no way to cancel a fetch or a
 * Node request from here — it is only stopped from holding up an answer that
 * has a deadline (a bridge command has 30 s in all).
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not answer within ${Math.ceil(ms / 1000)} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
