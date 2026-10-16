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

test('the bots are workflows: no GitHub App, no personal token', () => {
  for (const name of fs.readdirSync(DIR).filter((n) => /\.ya?ml$/.test(n))) {
    const text = fs.readFileSync(path.join(DIR, name), 'utf8');
    assert.ok(!/create-github-app-token|POINTER_BOT_APP_ID|POINTER_BOT_PRIVATE_KEY/.test(text), `${name} uses a GitHub App`);
  }
});

test('the deploy key only reaches jobs that install nothing', () => {
  for (const name of ['private-pointer.yml', 'release.yml']) {
    const holders = Object.entries(load(name).jobs).filter(([, j]) => JSON.stringify(j).includes('BOT_DEPLOY_KEY'));
    assert.ok(holders.length >= 1, `${name}: no job uses the deploy key`);
    for (const [job, j] of holders) {
      assert.ok(!/npm (install|ci)|npx /.test(JSON.stringify(j.steps)), `${name} ${job} installs dependencies and holds the deploy key`);
    }
  }
});

test('the pointer bot pushes a pointer-only commit to develop, only after the PR checks pass', () => {
  const wf = load('private-pointer.yml');
  assert.equal(wf.env.BASE, 'develop');
  assert.ok(!wf.on.push, 'a push trigger is a leftover from testing on another branch');
  const push = wf.jobs.push;
  assert.deepEqual(push.needs, ['decide', 'checks'], 'the push must wait for the checks');
  assert.equal(wf.jobs.checks.uses, './.github/workflows/pr-checks.yml');
  assert.equal(wf.jobs.checks.with['private-sha'], '${{ needs.decide.outputs.latest }}', 'the checks must test the commit being pinned');
  const run = push.steps.map((s) => s.run || '').join('\n');
  assert.match(run, /update-index --cacheinfo "160000,\$\{LATEST\},private"/);
  assert.match(run, /test "\$CHANGED" = "private"/, 'the push is not limited to a pointer-only change');
  assert.ok(!/git add/.test(run), 'the bump must not stage anything but the gitlink');
  assert.equal(wf.concurrency['cancel-in-progress'], false, 'a newer run would cancel a bump mid-push');
  assert.match(fs.readFileSync(path.join(DIR, 'private-pointer.yml'), 'utf8'), /MIN_HOURS: \$\{\{ vars\.PRIVATE_POINTER_MIN_HOURS \|\| '0' \}\}/, 'every private commit is bumped by default');
});

test('nightlies come from private commits and a daily schedule, not from every push to develop', () => {
  const nightly = load('nightly.yml');
  assert.deepEqual(Object.keys(nightly.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(nightly.on.schedule.length, 1, 'once a day');
  // A scheduled run starts on main: it must build develop, and release that exact commit.
  assert.equal(nightly.jobs.plan.steps[0].with.ref, 'develop');
  assert.equal(nightly.jobs.release.with.ref, '${{ needs.plan.outputs.sha }}');
  const release = load('release.yml');
  assert.equal(release.jobs.build.with.ref, "${{ inputs.ref || '' }}");
  assert.match(release.jobs['draft-release'].steps.map((s) => s.run || '').join('\n'), /--target "\$\(git rev-parse HEAD\)"/);
  const builds = load('nightly-builds.yml');
  for (const s of steps(builds).filter((s) => /actions\/checkout/.test(s.uses || ''))) {
    assert.equal(s.with && s.with.ref, "${{ inputs.ref || '' }}", `nightly-builds ${s.job} checks out the wrong commit`);
  }
  // Every pointer bump starts one.
  const push = load('private-pointer.yml').jobs.push;
  const start = push.steps.find((s) => /gh workflow run nightly\.yml/.test(s.run || ''));
  assert.ok(start, 'the bot does not start a nightly after a bump');
  assert.equal(start.if, "steps.bump.outputs.pushed == 'true'", 'only after a bump was actually pushed');
  assert.equal(push.permissions.actions, 'write');
});

test('releases carry no blockmap files', async () => {
  const text = fs.readFileSync(path.resolve(DIR, '../../scripts/release/collect-release-assets.mjs'), 'utf8');
  const shipped = /const SHIPPED = \[(.*)\];/.exec(text)[1];
  assert.ok(!/blockmap/.test(shipped), 'collect-release-assets ships .blockmap files');
});

test('every release moves develop\'s version on, without starting another nightly', () => {
  const wf = load('release.yml');
  const bump = wf.jobs['bump-version'];
  assert.deepEqual(bump.needs, ['plan', 'draft-release'], 'the bump must wait until the release exists');
  const run = bump.steps.map((s) => s.run || '').join('\n');
  assert.match(run, /next-version\.mjs bump "\$RELEASED"/);
  assert.match(run, /next-version\.mjs set packages\/xgenia-editor\/package\.json/);
  assert.match(run, /\[skip ci\]/, 'the bump commit would start a nightly of its own');
  assert.match(run, /test "\$CHANGED" = "packages\/xgenia-editor\/package\.json"/);
  assert.equal(wf.jobs.build.with.version, '${{ needs.plan.outputs.version }}', 'every platform must build the planned version');
  assert.match(load('nightly.yml').jobs.plan.steps.map((s) => s.run || '').join('\n'), /next-version\.mjs nightly/);
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
  const bot = load('private-pointer.yml').jobs['notify-failure'];
  assert.equal(bot.if, 'failure()');
  assert.ok(bot.steps.some((s) => /teams-notification/.test(s.uses || '')));
});

test('nightly publishes through release.yml as a pre-release, one build at a time', () => {
  const wf = load('nightly.yml');
  assert.equal(wf.jobs.release.uses, './.github/workflows/release.yml');
  assert.equal(wf.jobs.release.with.nightly, true);
  assert.equal(wf.concurrency['cancel-in-progress'], false);
  const release = fs.readFileSync(path.join(DIR, 'release.yml'), 'utf8');
  assert.match(release, /a nightly version must be a pre-release/);
});
