// Publishing through XGENIA RGS /web-publish: the editor never holds a Vercel token.
//
// XRGS G1-S2. These run the editor's side of the conversation against a fake
// XGENIA RGS and fail if:
//   * an upload or deploy request changes shape (digest header, operator key, body);
//   * a platform that HAS web-publish makes the editor fetch the shared token, or
//     any request goes to Vercel directly;
//   * an older platform (404 / "Invalid action" / not configured) stops falling
//     back to the token path — shipping the editor first must not break publishing;
//   * a rejected key or no network is mistaken for "older platform".
//   TSX_TSCONFIG_PATH=packages/xgenia-editor/tsconfig.json npx -y tsx@4.19.2 --test --test-force-exit packages/xgenia-editor/tests/deploy/webPublishClient.test.ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  createWebPublishClient,
  detectWebPublish,
  detectWebPublishCached,
  publishFilesViaRgs,
  resetWebPublishDetection,
  unpublishableReason,
  WebPublishError,
  WebPublishInfo
} from '../../src/editor/src/utils/publish/webPublishClient';
import { choosePublishRoute } from '../../src/editor/src/utils/publish/publishRoute';
import { mergePublishedSites } from '../../src/editor/src/utils/publish/deployedDomains';

const BASE = 'https://rgs.test/functions/v1';
const KEY = 'xrgs_operator_key';
const ANON = 'anon-key';
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');
const bytes = (s: string) => new TextEncoder().encode(s);

const INFO: WebPublishInfo = {
  configured: true,
  prefix: 'studio-ab12cd34',
  limits: { max_file_bytes: 1000, max_files: 50, max_deployment_bytes: 5000, max_sites: 50 },
  content_types: { html: 'text/html', js: 'text/javascript', png: 'image/png', map: 'application/json' }
};

type Call = { url: string; action: string; headers: Record<string, string>; body: any };

/** A fake XGENIA RGS: records every request, answers web-publish and maths-deployer. */
function fakeRgs(opts: {
  infoStatus?: number;
  infoBody?: any;
  missingOnce?: string[];
  readyAfter?: number;
  failState?: string;
} = {}) {
  const calls: Call[] = [];
  const uploaded = new Map<string, Uint8Array>();
  let polls = 0;
  let missing = opts.missingOnce ? [...opts.missingOnce] : null;
  const reply = (status: number, data: any) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) });
  const fetch = async (url: string, init: any) => {
    const u = new URL(url);
    if (u.hostname !== 'rgs.test') throw new Error(`the editor called ${u.hostname} directly`);
    const isUpload = u.searchParams.get('action') === 'upload-file';
    const body = isUpload ? init.body : JSON.parse(init.body || '{}');
    const action = isUpload ? 'upload-file' : body.action;
    calls.push({ url, action, headers: init.headers, body });
    if (u.pathname.endsWith('/maths-deployer')) return reply(200, { vercel: 'SHARED_VERCEL_TOKEN' });
    if (!u.pathname.endsWith('/web-publish')) return reply(404, { code: 'NOT_FOUND', message: 'Requested function was not found' });
    switch (action) {
      case 'info':
        return reply(opts.infoStatus ?? 200, opts.infoBody ?? INFO);
      case 'upload-file':
        uploaded.set(init.headers['x-vercel-digest'], body);
        return reply(200, { sha: init.headers['x-vercel-digest'], size: body.length });
      case 'deploy':
        if (missing) {
          const m = missing;
          missing = null;
          return reply(400, { error: 'Some files were not uploaded first', code: 'MISSING_FILES', missing: m });
        }
        return reply(200, {
          site: body.site, project: `${INFO.prefix}-${body.site}`, domain: `${INFO.prefix}-${body.site}.vercel.app`,
          deployment_id: 'dpl_1', url: 'https://x-1.vercel.app', state: 'QUEUED'
        });
      case 'deployment-status':
        polls++;
        if (opts.failState) return reply(200, { ready: false, failed: true, state: opts.failState, error: 'build failed' });
        if (polls < (opts.readyAfter ?? 2)) return reply(200, { ready: false, failed: false, state: 'BUILDING' });
        return reply(200, { ready: true, failed: false, state: 'READY', live_url: `https://${INFO.prefix}-reel.vercel.app`, url: 'https://x-1.vercel.app' });
      case 'check-domain':
        return reply(200, { site: body.site, project: `${INFO.prefix}-${body.site}`, domain: `${INFO.prefix}-${body.site}.vercel.app`, available: true });
      case 'list':
        return reply(200, { sites: [] });
      case 'rename':
        return reply(200, { site: body.new_site, project: `${INFO.prefix}-${body.new_site}`, domain: `${INFO.prefix}-${body.new_site}.vercel.app`, live_url: 'u', warnings: [] });
      case 'delete':
        return reply(body.project === 'not-mine' ? 404 : 200, body.project === 'not-mine' ? { error: 'No site', code: 'NOT_FOUND' } : { deleted: true });
      default:
        return reply(400, { error: 'Invalid action. Use: info, …', code: 'INVALID_ACTION' });
    }
  };
  return { fetch, calls, uploaded, polls: () => polls };
}

const client = (f: ReturnType<typeof fakeRgs>) =>
  createWebPublishClient({ functionsUrl: BASE, anonKey: ANON, apiKey: KEY, fetch: f.fetch });
const noSleep = async () => {};

beforeEach(() => resetWebPublishDetection());

test('every request carries the operator key and the gateway anon key, and goes to XGENIA RGS only', async () => {
  const rgs = fakeRgs();
  const c = client(rgs);
  await c.info();
  await c.checkDomain('reel');
  await c.list();
  await c.rename('studio-ab12cd34-reel', 'reel-2');
  await c.remove('studio-ab12cd34-reel-2');
  for (const call of rgs.calls) {
    assert.equal(call.url.startsWith(`${BASE}/web-publish`), true);
    assert.equal(call.headers['X-Operator-Key'], KEY);
    assert.equal(call.headers.apikey, ANON);
    assert.equal(call.headers.Authorization, `Bearer ${ANON}`);
  }
  assert.deepEqual(rgs.calls.map((c) => c.action), ['info', 'check-domain', 'list', 'rename', 'delete']);
  assert.deepEqual(rgs.calls[3].body, { action: 'rename', project: 'studio-ab12cd34-reel', new_site: 'reel-2' });
  assert.deepEqual(rgs.calls[4].body, { action: 'delete', project: 'studio-ab12cd34-reel-2' });
  await assert.rejects(c.remove('not-mine'), (e: any) => e instanceof WebPublishError && e.status === 404);
});

test('a publish uploads each file under its sha1 with its type, deploys the refs, and waits for READY', async () => {
  const rgs = fakeRgs({ readyAfter: 3 });
  const files = [
    { path: 'index.html', bytes: bytes('<!doctype html>') },
    { path: 'xgenia.deploy.js', bytes: bytes('console.log(1)') },
    { path: 'xgenia.deploy.js.map', bytes: bytes('{}') },
    { path: 'assets/a.png', bytes: bytes('PNG...') },
    { path: 'assets/copy-of-a.png', bytes: bytes('PNG...') }
  ];
  const steps: string[] = [];
  const done = await publishFilesViaRgs(client(rgs), INFO, 'reel', files, {
    sha1, sleep: noSleep, onProgress: (s) => steps.push(s)
  });
  const uploads = rgs.calls.filter((c) => c.action === 'upload-file');
  assert.equal(uploads.length, 4, 'identical bytes under two paths are uploaded once');
  const html = uploads.find((u) => u.headers['Content-Type'] === 'text/html')!;
  assert.equal(html.url, `${BASE}/web-publish?action=upload-file`);
  assert.equal(html.headers['x-vercel-digest'], sha1(files[0].bytes));
  assert.deepEqual(html.body, files[0].bytes);
  assert.equal(html.headers['X-Operator-Key'], KEY);
  assert.equal(uploads.find((u) => u.headers['x-vercel-digest'] === sha1(files[2].bytes))!.headers['Content-Type'], 'application/json');

  const deploy = rgs.calls.find((c) => c.action === 'deploy')!;
  assert.equal(deploy.body.site, 'reel');
  assert.deepEqual(deploy.body.files, files.map((f) => ({ file: f.path, sha: sha1(f.bytes), size: f.bytes.length })));
  assert.equal(rgs.polls(), 3);
  assert.equal(done.liveUrl, 'https://studio-ab12cd34-reel.vercel.app');
  assert.equal(done.project, 'studio-ab12cd34-reel');
  assert.equal(done.deploymentId, 'dpl_1');
  assert.ok(steps.some((s) => /Uploading files/.test(s)));
  assert.equal(rgs.calls.some((c) => c.url.includes('maths-deployer')), false, 'the shared token was fetched');
});

test('files the platform would refuse are left out and named, not uploaded', async () => {
  const rgs = fakeRgs();
  const warnings: string[] = [];
  const done = await publishFilesViaRgs(client(rgs), INFO, 'reel', [
    { path: 'index.html', bytes: bytes('x') },
    { path: 'art/source.psd', bytes: bytes('psd') },
    { path: 'package.json', bytes: bytes('{}') },
    { path: 'api/hook.js', bytes: bytes('x') }
  ], { sha1, sleep: noSleep, onWarning: (w) => warnings.push(w) });
  assert.equal(done.skipped.length, 3);
  assert.match(warnings[0], /source\.psd/);
  assert.deepEqual(rgs.calls.find((c) => c.action === 'deploy')!.body.files.map((f: any) => f.file), ['index.html']);
  assert.equal(unpublishableReason('vercel.json'), 'hosting configuration, not game content');
  assert.equal(unpublishableReason('.trash/x.png') !== '', true);
});

test('size limits are enforced before anything is uploaded', async () => {
  const rgs = fakeRgs();
  await assert.rejects(
    publishFilesViaRgs(client(rgs), INFO, 'reel', [{ path: 'big.png', bytes: new Uint8Array(1001) }], { sha1, sleep: noSleep }),
    /Too large to publish/
  );
  const many = Array.from({ length: 6 }, (_, i) => ({ path: `f${i}.png`, bytes: new Uint8Array(900).fill(i) }));
  await assert.rejects(publishFilesViaRgs(client(rgs), INFO, 'reel', many, { sha1, sleep: noSleep }), /at most 0 MB|publishes at most/);
  assert.equal(rgs.calls.length, 0);
});

test('files Vercel reports missing are uploaded again and the deploy retried once', async () => {
  const file = { path: 'index.html', bytes: bytes('<html>') };
  const rgs = fakeRgs({ missingOnce: [sha1(file.bytes)] });
  const done = await publishFilesViaRgs(client(rgs), INFO, 'reel', [file], { sha1, sleep: noSleep });
  assert.equal(done.deploymentId, 'dpl_1');
  assert.equal(rgs.calls.filter((c) => c.action === 'upload-file').length, 2);
  assert.equal(rgs.calls.filter((c) => c.action === 'deploy').length, 2);
});

test('a failed build is reported as a failed publish', async () => {
  const rgs = fakeRgs({ failState: 'ERROR' });
  await assert.rejects(
    publishFilesViaRgs(client(rgs), INFO, 'reel', [{ path: 'index.html', bytes: bytes('x') }], { sha1, sleep: noSleep }),
    /Deployment failed: build failed/
  );
});

test('detection: 404, "Invalid action" and not-configured mean an older platform; a rejected key does not', async () => {
  const check = (o: Parameters<typeof fakeRgs>[0]) => detectWebPublish(client(fakeRgs(o)));
  assert.equal((await check({})).available, true);
  assert.equal((await check({ infoStatus: 404, infoBody: { code: 'NOT_FOUND', message: 'Requested function was not found' } })).available, false);
  assert.equal((await check({ infoStatus: 400, infoBody: { error: 'Invalid action. Use: deploy-tokens' } })).available, false);
  assert.equal((await check({ infoBody: { ...INFO, configured: false } })).available, false);
  await assert.rejects(check({ infoStatus: 401, infoBody: { error: 'Invalid API key' } }), (e: any) => e.status === 401);
});

test('route: with web-publish the shared token is never loaded', async () => {
  const rgs = fakeRgs();
  let tokenLoads = 0;
  const warnings: string[] = [];
  const { route, error } = await choosePublishRoute({
    functionsUrl: BASE, anonKey: ANON, apiKey: KEY, fetch: rgs.fetch,
    loadToken: async () => { tokenLoads++; return { token: 'SHARED_VERCEL_TOKEN', error: '' }; },
    warn: (m) => warnings.push(m)
  });
  assert.equal(error, '');
  assert.equal(route?.kind, 'rgs');
  assert.equal(route?.info?.prefix, INFO.prefix);
  assert.equal(tokenLoads, 0);
  assert.deepEqual(warnings, []);
  assert.equal(JSON.stringify(route?.info).includes('SHARED_VERCEL_TOKEN'), false);
});

test('route: an older platform falls back to the token path, with a warning', async () => {
  for (const o of [
    { infoStatus: 404, infoBody: { code: 'NOT_FOUND', message: 'Requested function was not found' } },
    { infoStatus: 400, infoBody: { error: 'Invalid action. Use: generate-key, …' } },
    { infoBody: { ...INFO, configured: false } }
  ]) {
    resetWebPublishDetection();
    const rgs = fakeRgs(o);
    const warnings: string[] = [];
    const { route } = await choosePublishRoute({
      functionsUrl: BASE, anonKey: ANON, apiKey: KEY, fetch: rgs.fetch,
      loadToken: async () => ({ token: 'SHARED_VERCEL_TOKEN', error: '' }),
      warn: (m) => warnings.push(m)
    });
    assert.equal(route?.kind, 'token');
    assert.equal(route?.vercelToken, 'SHARED_VERCEL_TOKEN');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /falling back to the shared Vercel token/);
  }
});

test('route: no key, a rejected key or no network is an error, not a token fallback', async () => {
  let tokenLoads = 0;
  const loadToken = async () => { tokenLoads++; return { token: 't', error: '' }; };
  assert.equal((await choosePublishRoute({ functionsUrl: BASE, anonKey: ANON, apiKey: null, loadToken })).route, null);
  const rejected = await choosePublishRoute({
    functionsUrl: BASE, anonKey: ANON, apiKey: KEY, loadToken,
    fetch: fakeRgs({ infoStatus: 401, infoBody: { error: 'Invalid API key' } }).fetch
  });
  assert.equal(rejected.route, null);
  assert.match(rejected.error, /Invalid API key/);
  resetWebPublishDetection();
  const offline = await choosePublishRoute({
    functionsUrl: BASE, anonKey: ANON, apiKey: KEY, loadToken,
    fetch: async () => { throw new Error('network down'); }
  });
  assert.equal(offline.route, null);
  assert.equal(tokenLoads, 0);
});

test('detection is cached per key; an unavailable answer expires, an error is not cached', async () => {
  const rgs = fakeRgs();
  const ep = { functionsUrl: BASE, anonKey: ANON, apiKey: KEY, fetch: rgs.fetch };
  await detectWebPublishCached(ep);
  await detectWebPublishCached(ep);
  assert.equal(rgs.calls.length, 1);

  resetWebPublishDetection();
  let t = 0;
  const old = fakeRgs({ infoStatus: 404, infoBody: {} });
  const ep2 = { ...ep, fetch: old.fetch };
  await detectWebPublishCached(ep2, () => t);
  t += 4 * 60_000;
  await detectWebPublishCached(ep2, () => t);
  assert.equal(old.calls.length, 1);
  t += 2 * 60_000;
  await detectWebPublishCached(ep2, () => t);
  assert.equal(old.calls.length, 2, 'an older platform is asked again after five minutes');

  resetWebPublishDetection();
  let attempts = 0;
  const flaky = { ...ep, fetch: async () => { attempts++; throw new Error('offline'); } };
  await assert.rejects(detectWebPublishCached(flaky));
  await assert.rejects(detectWebPublishCached(flaky));
  assert.equal(attempts, 2);
});

test('the Deployed Domains list: the studio\'s sites from XGENIA RGS, then older token-published records', () => {
  const merged = mergePublishedSites(
    [{ site: 'reel', project: 'acme-reel', domain: 'acme-reel.vercel.app', live_url: 'https://acme-reel.vercel.app', deployment_id: 'dpl_9', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-02T00:00:00Z' }],
    [
      { name: 'acme-reel', id: 'dpl_1', url: 'u', deployedAt: '2026-10-01T00:00:00Z', project: 'acme-reel', site: 'reel', rgsBackends: [{ deploymentId: 'b1', gameId: 'g1' }] },
      { name: 'acme-gone', id: 'dpl_2', url: 'u', deployedAt: '2026-10-01T00:00:00Z', project: 'acme-gone', site: 'gone' },
      { name: 'old-game', id: 'dpl_3', url: 'https://old-game.vercel.app', deployedAt: '2026-09-01T00:00:00Z' }
    ]
  );
  assert.deepEqual(merged.map((d) => d.name), ['acme-reel', 'old-game']);
  assert.equal(merged[0].url, 'https://acme-reel.vercel.app');
  assert.equal(merged[0].site, 'reel');
  assert.equal(merged[0].rgsBackends?.length, 1);
  assert.equal(merged[1].project, undefined);
});
