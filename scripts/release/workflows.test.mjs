// Private pointer bot + nightly pre-releases (2026-10-06): what the release workflows promise each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.github/workflows');
const load = (name) => yaml.load(fs.readFileSync(path.join(DIR, name), 'utf8'));
const steps = (wf) => Object.entries(wf.jobs).flatMap(([job, j]) => (j.steps || []).map((s) => ({ job, ...s })));

test('no workflow input or event field is expanded inside a shell script', () => {
  for (const name of ['private-pointer.yml', 'nightly.yml', 'release.yml', 'nightly-builds.yml', 'pr-checks.yml', 'pull-release.yml']) {
    for (const s of steps(load(name))) {
      assert.ok(!/\$\{\{\s*(inputs|github\.event)\./.test(s.run || ''), `${name} ${s.job}: ${s.name}`);
    }
  }
});

test('builds ship the pinned private commit, not the latest private main', () => {
  for (const name of ['nightly-builds.yml', 'nightly-builds-internal.yml', 'pr-checks.yml']) {
    const text = fs.readFileSync(path.join(DIR, name), 'utf8');
    assert.ok(!/submodule update[^\n]*--remote/.test(text), `${name} builds private main instead of the pointer`);
  }
});

test('the pointer bot holds its key only in a job that installs nothing, and merges pointer-only PRs', () => {
  const wf = load('private-pointer.yml');
  const holders = Object.entries(wf.jobs).filter(([, j]) => JSON.stringify(j).includes('POINTER_BOT_PRIVATE_KEY'));
  assert.equal(holders.length, 1);
  for (const [name, job] of holders) {
    assert.ok(!/npm (install|ci)|npx /.test(JSON.stringify(job.steps)), `${name} installs dependencies and holds the bot key`);
  }
  const merge = steps(wf).find((s) => /gh pr merge/.test(s.run || ''));
  assert.ok(merge, 'no merge step');
  assert.match(merge.run, /test "\$CHANGED" = "private"/, 'merge is not limited to a pointer-only diff');
  assert.match(merge.run, /gh pr checks "\$PR" --watch/, 'merge does not wait for the checks');
  assert.equal(wf.concurrency['cancel-in-progress'], false, 'a newer run would cancel a bump mid-merge');
});

test('releases are signed, and the update key only reaches a job that installs nothing', () => {
  const wf = load('release.yml');
  const holders = Object.entries(wf.jobs).filter(([, j]) => JSON.stringify(j).includes('UPDATE_SIGNING_KEY'));
  assert.equal(holders.length, 1);
  const [name, job] = holders[0];
  assert.ok(!/npm (install|ci)|npx /.test(JSON.stringify(job.steps)), `${name} installs dependencies and holds the update key`);
  const runs = job.steps.map((s) => s.run || '');
  const sign = runs.findIndex((r) => r.includes('sign-update-manifests.mjs'));
  const publish = runs.findIndex((r) => r.includes('gh release create'));
  assert.ok(sign !== -1 && publish !== -1 && sign < publish, 'manifests must be signed before the release is created');
});

test('a release is a draft until it has been read back and verified', () => {
  const steps = load('release.yml').jobs['draft-release'].steps;
  const at = (re) => steps.findIndex((s) => re.test(s.run || ''));
  const create = at(/gh release create/);
  const verifyDraft = at(/verify-release\.mjs "v\$VERSION" --draft/);
  const publish = at(/gh release edit "v\$VERSION" --draft=false/);
  assert.match(steps[create].run, /--draft \$PRERELEASE/, 'the release must be created as a draft');
  assert.ok(create < verifyDraft && verifyDraft < publish, 'create → verify the draft → publish');
  assert.match(steps[publish].run, /--public/, 'the published nightly is checked from the public URLs');
  assert.match(steps[publish].run, /--draft=true/, 'a nightly failing the public check is pulled');
});

test('builds are checked before they are uploaded', () => {
  const wf = load('nightly-builds.yml');
  const names = (job) => wf.jobs[job].steps.map((s) => s.name);
  const linux = names('build-linux');
  assert.ok(linux.indexOf('Launch smoke test') !== -1, 'no launch smoke test');
  assert.ok(linux.indexOf('Launch smoke test') < linux.indexOf('Upload Linux Artifacts'));
  const mac = names('build-macos');
  assert.ok(mac.indexOf('Verify signature and notarization') !== -1, 'no macOS signature check');
  assert.ok(mac.indexOf('Verify signature and notarization') < mac.indexOf('Upload macOS Artifact'));
  for (const s of steps(wf).filter((s) => /actions\/upload-artifact/.test(s.uses || ''))) {
    assert.equal(s.with['if-no-files-found'], 'error', `${s.job}: an empty artifact must fail`);
  }
});

test('failures reach the team', () => {
  const nightly = load('nightly.yml');
  assert.equal(nightly.jobs['notify-failure'].if, 'failure()');
  const bump = load('private-pointer.yml').jobs.bump.steps;
  assert.ok(bump.some((s) => s.if === 'failure()' && /teams-notification/.test(s.uses || '')));
});

test('nightly publishes through release.yml as a pre-release, one build at a time', () => {
  const wf = load('nightly.yml');
  assert.equal(wf.jobs.release.uses, './.github/workflows/release.yml');
  assert.equal(wf.jobs.release.with.nightly, true);
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  const release = fs.readFileSync(path.join(DIR, 'release.yml'), 'utf8');
  assert.match(release, /a nightly version must be a pre-release/);
});
