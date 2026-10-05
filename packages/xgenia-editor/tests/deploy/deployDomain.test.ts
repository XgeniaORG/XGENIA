import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN_NAME_REQUIRED,
  DOMAIN_NAME_RULE,
  domainUnavailableMessage,
  getFullDomain,
  normalizeDomainName,
  pickLiveUrl,
  subdomainProbeVerdict,
  validateDomain,
  vercelProjectName
} from '../../src/editor/src/utils/publish/deployDomain';

test('the popup rule: a bare lowercase name, or a full .vercel.app hostname', () => {
  assert.equal(validateDomain('my-game'), true);
  assert.equal(validateDomain('  my-game-2  '), true);
  assert.equal(validateDomain('my-game.vercel.app'), true);
  assert.equal(validateDomain(''), false);
  assert.equal(validateDomain('   '), false);
  assert.equal(validateDomain('My-Game'), false);
  assert.equal(validateDomain('my_game'), false);
  assert.equal(validateDomain('my game'), false);
  assert.equal(validateDomain('my-game.example.com'), false);
  // ".vercel.app" alone is not a name.
  assert.equal(validateDomain('.vercel.app'), false);
});

test('full domain and project name convert both ways', () => {
  assert.equal(getFullDomain('my-game'), 'my-game.vercel.app');
  assert.equal(getFullDomain(' my-game.vercel.app '), 'my-game.vercel.app');
  assert.equal(vercelProjectName('my-game.vercel.app'), 'my-game');
  assert.equal(vercelProjectName('my-game'), 'my-game');
});

test('a caller without a text field gets the bare project name or the popup message', () => {
  assert.deepEqual(normalizeDomainName('  keno-demo '), { name: 'keno-demo' });
  assert.deepEqual(normalizeDomainName('keno-demo.vercel.app'), { name: 'keno-demo' });
  assert.equal(normalizeDomainName('').error, DOMAIN_NAME_REQUIRED);
  assert.equal(normalizeDomainName(undefined).error, DOMAIN_NAME_REQUIRED);
  assert.equal(normalizeDomainName(42).error, DOMAIN_NAME_REQUIRED);
  assert.equal(normalizeDomainName('Keno Demo').error, DOMAIN_NAME_RULE);
  // The popup's rule waves anything ending in .vercel.app through; the bare name
  // behind it must still pass the strict rule before it becomes a repo name.
  assert.equal(normalizeDomainName('Keno_Demo.vercel.app').error, DOMAIN_NAME_RULE);
  assert.equal(normalizeDomainName('a.b.vercel.app').error, DOMAIN_NAME_RULE);
  assert.equal(normalizeDomainName('x.vercel.app.vercel.app').error, DOMAIN_NAME_RULE);
});

test('a name taken by a stranger gets a suggestion; one in our team does not', () => {
  const elsewhere = domainUnavailableMessage('keno', 'taken-elsewhere', 'ab12');
  assert.match(elsewhere, /^keno\.vercel\.app is already taken by another Vercel account/);
  assert.match(elsewhere, /e\.g\. "keno-ab12"/);
  assert.equal(
    domainUnavailableMessage('keno', 'existing-project'),
    'Domain name is already in use on Vercel. Please choose a different name.'
  );
});

test('the live URL is the pretty alias only when Vercel really bound it', () => {
  const deploymentUrl = 'keno-abc123-xgenia.vercel.app';
  assert.equal(
    pickLiveUrl('keno', ['keno-xgenia.vercel.app', 'keno.vercel.app', deploymentUrl], deploymentUrl),
    'https://keno.vercel.app'
  );
  // Taken globally: the shortest stable alias, never the guessed hostname.
  assert.equal(
    pickLiveUrl('keno', ['keno-git-main-xgenia.vercel.app', 'keno-xgenia.vercel.app', deploymentUrl], deploymentUrl),
    'https://keno-xgenia.vercel.app'
  );
  // Only the immutable deployment URL is known.
  assert.equal(pickLiveUrl('keno', [deploymentUrl], deploymentUrl), `https://${deploymentUrl}`);
  assert.equal(pickLiveUrl('keno', [], deploymentUrl), `https://${deploymentUrl}`);
});

test('the subdomain probe trusts only answers that came from Vercel', () => {
  assert.equal(subdomainProbeVerdict(404, { 'x-vercel-error': 'DEPLOYMENT_NOT_FOUND' }), true);
  assert.equal(subdomainProbeVerdict(200, { 'x-vercel-id': 'fra1::abc' }), false);
  assert.equal(subdomainProbeVerdict(401, { server: 'Vercel' }), false);
  // A proxy or captive portal proves nothing either way.
  assert.equal(subdomainProbeVerdict(404, {}), null);
  assert.equal(subdomainProbeVerdict(200, { server: 'nginx' }), null);
});
