// Live engine (2026-10-04, final review): the signing key never shares a job with npm, and no
// workflow input is pasted into a shell script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wf = yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows/live-engine.yml'), 'utf8'));

test('the signing key is only given to jobs that install no dependencies, in the live-engine environment', () => {
  const holders = Object.entries(wf.jobs).filter(([, job]) => JSON.stringify(job).includes('secrets.ENGINE_SIGNING_KEY'));
  assert.ok(holders.length >= 1);
  for (const [name, job] of holders) {
    assert.ok(!/npm (install|ci)|npx /.test(JSON.stringify(job.steps)), `${name} installs dependencies and holds the signing key`);
    assert.equal(job.environment, 'live-engine', `${name} must run in the live-engine environment`);
  }
});

test('no workflow input is expanded inside a shell script', () => {
  for (const [name, job] of Object.entries(wf.jobs)) {
    for (const step of job.steps || []) assert.ok(!/\$\{\{\s*(inputs|github\.event)\./.test(step.run || ''), `${name}: ${step.name}`);
  }
});
