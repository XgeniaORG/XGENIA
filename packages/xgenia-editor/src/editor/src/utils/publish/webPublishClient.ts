// Publishing through XGENIA RGS `/web-publish` — the editor never holds a Vercel token.
//
// WHY THIS EXISTS (XRGS GO_TO_MARKET_PLAN G1-S2, 2026-11-03)
//
// Publish used to upload the build straight to Vercel with the PLATFORM's Vercel
// token, fetched from maths-deployer `deploy-tokens` with any operator key. That
// token is for the team that also hosts the XRGS back office, so every studio's
// editor held a credential that could overwrite, rename or delete any other
// studio's published game — or the back office. XRGS now does those steps itself
// (supabase/functions/web-publish), with the token in a server secret: the editor
// sends the files and its operator key, and the server decides which project they
// may go into (one named for the studio), refuses anybody else's, and serves the
// site under the alias it derives.
//
// This module is that conversation, and nothing else: no editor models, no
// window.require, no Vercel. Hashing and fetch are injected, so it runs under
// plain Node (tests/deploy/webPublishClient.test.ts) against a fake XGENIA RGS.
//
// FEATURE DETECTION. An editor can ship before the platform has `/web-publish`.
// detectWebPublish answers "unavailable" for a 404 (no such function), a 400
// "Invalid action" (a platform that predates the action) and `configured: false`
// (the secrets are not set yet); the caller then falls back to the old token path
// with a console warning (publishRoute.ts). Anything else — a rejected key, no
// network — is an error, not a reason to reach for the shared token.

export type FetchLike = (input: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface WebPublishEndpoint {
  /** XRGS functions base, e.g. https://<ref>.supabase.co/functions/v1 */
  functionsUrl: string;
  /** The publishable anon key the gateway wants. Not a secret. */
  anonKey: string;
  /** The studio's operator key. */
  apiKey: string;
  fetch?: FetchLike;
}

export interface WebPublishInfo {
  configured: boolean;
  /** The studio's part of every project name: sites are `<prefix>-<site>.<domain>`. */
  prefix: string;
  /** Where sites live: "xgenia.app" on XGENIA's own game hosting; absent on an RGS that publishes to Vercel. */
  domain?: string;
  limits: { max_file_bytes: number; max_files: number; max_deployment_bytes: number; max_sites: number };
  content_types: Record<string, string>;
}

export interface WebPublishSite {
  site: string;
  project: string;
  domain: string;
  live_url: string;
  deployment_id: string | null;
  deployment_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface WebPublishAvailability {
  site: string;
  project: string;
  domain: string;
  available: boolean;
  owned?: boolean;
  republish?: boolean;
  reason?: string;
  message?: string;
}

export class WebPublishError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly body: any) {
    super(message);
    this.name = 'WebPublishError';
  }
}

/**
 * The server's table (XRGS _shared/web-publish.ts CONTENT_TYPES), used until `info`
 * has answered with its own. The server refuses anything not in it.
 */
export const WEB_PUBLISH_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  html: 'text/html', htm: 'text/html', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
  css: 'text/css', json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json',
  txt: 'text/plain', atlas: 'text/plain', fnt: 'text/plain', csv: 'text/csv', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', apng: 'image/apng', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  ktx2: 'image/ktx2', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus',
  wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', weba: 'audio/webm',
  mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', woff: 'font/woff', woff2: 'font/woff2',
  ttf: 'font/ttf', otf: 'font/otf', wasm: 'application/wasm', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', bin: 'application/octet-stream', skel: 'application/octet-stream',
  basis: 'application/octet-stream'
});

/**
 * Why the server would refuse this path, or '' when it would publish it. Mirrors the
 * server's pathProblem so a build is filtered BEFORE upload, with the reason shown,
 * instead of the whole deploy being refused at the end.
 */
export function unpublishableReason(path: string, contentTypes: Record<string, string> = WEB_PUBLISH_CONTENT_TYPES): string {
  const segments = path.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.'))) return 'hidden or relative path';
  if (segments.length > 1 && /^api$/i.test(segments[0])) return 'api/ would run as server code';
  if (segments.length === 1 && /^(vercel\.json|now\.json|package\.json|_?middleware\.[a-z]+)$/i.test(segments[0])) {
    return 'hosting configuration, not game content';
  }
  const name = segments[segments.length - 1];
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (!ext || !contentTypes[ext]) return `.${ext || '(no extension)'} is not a web asset type`;
  return '';
}

export function contentTypeFor(path: string, contentTypes: Record<string, string> = WEB_PUBLISH_CONTENT_TYPES): string | null {
  const name = path.split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return contentTypes[ext] || null;
}

export interface WebPublishClient {
  info(): Promise<WebPublishInfo>;
  checkDomain(site: string): Promise<WebPublishAvailability>;
  uploadFile(sha: string, bytes: Uint8Array, contentType: string): Promise<void>;
  deploy(site: string, files: { file: string; sha: string; size: number }[]): Promise<{
    site: string; project: string; domain: string; deployment_id: string; url: string | null; state: string | null;
  }>;
  deploymentStatus(deploymentId: string): Promise<{
    ready: boolean; failed: boolean; state: string; live_url?: string; url?: string | null; error?: string; alias_assigned?: boolean;
  }>;
  list(): Promise<WebPublishSite[]>;
  rename(project: string, newSite: string): Promise<{ site: string; project: string; domain: string; live_url: string; warnings: string[] }>;
  remove(project: string): Promise<{ deleted: boolean; project: string; domain: string; vercel: string }>;
}

export function createWebPublishClient(ep: WebPublishEndpoint): WebPublishClient {
  const doFetch: FetchLike = ep.fetch || ((input, init) => (globalThis as any).fetch(input, init));
  const url = `${ep.functionsUrl.replace(/\/+$/, '')}/web-publish`;
  const auth = {
    'X-Operator-Key': ep.apiKey,
    apikey: ep.anonKey,
    Authorization: `Bearer ${ep.anonKey}`
  };

  async function answer(res: { ok: boolean; status: number; text: () => Promise<string> }): Promise<any> {
    const text = await res.text().catch(() => '');
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text.slice(0, 200) };
    }
    if (!res.ok) {
      throw new WebPublishError(
        String(data?.error || data?.message || data?.msg || `XGENIA RGS answered HTTP ${res.status}`),
        res.status,
        String(data?.code || ''),
        data
      );
    }
    return data;
  }

  const call = async (action: string, body: Record<string, unknown> = {}) =>
    answer(
      await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ action, ...body })
      })
    );

  return {
    info: () => call('info'),
    checkDomain: (site) => call('check-domain', { site }),
    async uploadFile(sha, bytes, contentType) {
      await answer(
        await doFetch(`${url}?action=upload-file`, {
          method: 'POST',
          // Content-Length comes from the body: a browser refuses to let it be set by hand.
          headers: { ...auth, 'Content-Type': contentType, 'x-vercel-digest': sha },
          body: bytes
        })
      );
    },
    deploy: (site, files) => call('deploy', { site, files }),
    deploymentStatus: (deploymentId) => call('deployment-status', { deployment_id: deploymentId }),
    list: async () => ((await call('list')).sites || []) as WebPublishSite[],
    rename: (project, newSite) => call('rename', { project, new_site: newSite }),
    remove: (project) => call('delete', { project })
  };
}

// ─── Feature detection ────────────────────────────────────────────────────────

export type WebPublishDetection =
  | { available: true; info: WebPublishInfo; reason?: undefined }
  | { available: false; reason: string; info?: undefined };

/** Is `/web-publish` here and configured? Throws for anything that is not an answer about that. */
export async function detectWebPublish(client: WebPublishClient): Promise<WebPublishDetection> {
  let info: WebPublishInfo;
  try {
    info = await client.info();
  } catch (e) {
    if (e instanceof WebPublishError) {
      if (e.status === 404) return { available: false, reason: 'this XGENIA RGS has no web-publish function yet' };
      if (e.status === 400 && /invalid action/i.test(e.message)) {
        return { available: false, reason: 'this XGENIA RGS predates web-publish' };
      }
    }
    throw e;
  }
  if (!info?.configured) {
    return { available: false, reason: 'web-publish is not configured on this XGENIA RGS yet (VERCEL_TOKEN / VERCEL_TEAM_ID)' };
  }
  return { available: true, info };
}

const AVAILABLE_FOREVER = Number.POSITIVE_INFINITY;
/** An "unavailable" answer is re-asked after this, so a platform upgraded mid-session is picked up. */
const UNAVAILABLE_TTL_MS = 5 * 60_000;
const detections = new Map<string, { at: number; ttl: number; result: Promise<WebPublishDetection> }>();

/**
 * detectWebPublish, once per key per session (an "unavailable" answer for five
 * minutes). A thrown error is never cached: the next call asks again.
 */
export function detectWebPublishCached(ep: WebPublishEndpoint, now: () => number = Date.now): Promise<WebPublishDetection> {
  const cacheKey = `${ep.functionsUrl}|${ep.apiKey}`;
  const hit = detections.get(cacheKey);
  if (hit && now() - hit.at < hit.ttl) return hit.result;
  const entry = { at: now(), ttl: AVAILABLE_FOREVER, result: detectWebPublish(createWebPublishClient(ep)) };
  detections.set(cacheKey, entry);
  entry.result.then(
    (d) => {
      if (!d.available) entry.ttl = UNAVAILABLE_TTL_MS;
    },
    () => {
      if (detections.get(cacheKey) === entry) detections.delete(cacheKey);
    }
  );
  return entry.result;
}

export function resetWebPublishDetection(): void {
  detections.clear();
}

// ─── The whole publish ────────────────────────────────────────────────────────

export interface BuiltFile {
  path: string;
  bytes: Uint8Array;
}

export interface RgsPublishOptions {
  /** sha1 of the bytes, lower-case hex (node's crypto in the editor). */
  sha1: (bytes: Uint8Array) => string;
  onProgress?: (step: string) => void;
  /** Files left out of the build, with why. Also returned as `skipped`. */
  onWarning?: (message: string) => void;
  concurrency?: number;
  pollIntervalMs?: number;
  pollAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface RgsPublishResult {
  site: string;
  project: string;
  domain: string;
  deploymentId: string;
  deploymentUrl: string;
  liveUrl: string;
  skipped: string[];
}

/** How long a publish waits for Vercel's build, as the token path did: 24 polls, 5 s apart. */
export const RGS_POLL_INTERVAL_MS = 5000;
export const RGS_POLL_ATTEMPTS = 24;

/**
 * Upload a built folder through XGENIA RGS, deploy it as `site`, and wait until it
 * is serving. Throws with a plain message on anything that stops the site going
 * live; files the platform would refuse are left out and named (onWarning).
 */
export async function publishFilesViaRgs(
  client: WebPublishClient,
  info: WebPublishInfo,
  site: string,
  files: BuiltFile[],
  opts: RgsPublishOptions
): Promise<RgsPublishResult> {
  const progress = (s: string) => opts.onProgress?.(s);
  const types = info.content_types && Object.keys(info.content_types).length ? info.content_types : WEB_PUBLISH_CONTENT_TYPES;
  const limits = info.limits;

  const skipped: string[] = [];
  const publishable: { path: string; bytes: Uint8Array; type: string }[] = [];
  for (const f of files) {
    const reason = unpublishableReason(f.path, types);
    if (reason) skipped.push(`${f.path} (${reason})`);
    else publishable.push({ path: f.path, bytes: f.bytes, type: contentTypeFor(f.path, types)! });
  }
  if (skipped.length > 0) {
    opts.onWarning?.(
      `Not published — XGENIA RGS hosts web assets only: ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ` and ${skipped.length - 8} more` : ''}.`
    );
  }
  if (publishable.length === 0) throw new Error('Nothing in the build can be published (no web asset files).');
  if (limits?.max_files && publishable.length > limits.max_files) {
    throw new Error(`The build has ${publishable.length} files; XGENIA RGS publishes at most ${limits.max_files}.`);
  }
  const tooBig = publishable.filter((f) => limits?.max_file_bytes && f.bytes.length > limits.max_file_bytes);
  if (tooBig.length > 0) {
    const mb = Math.floor((limits.max_file_bytes || 0) / (1024 * 1024));
    throw new Error(`Too large to publish (over ${mb} MB each): ${tooBig.map((f) => f.path).join(', ')}.`);
  }
  const total = publishable.reduce((t, f) => t + f.bytes.length, 0);
  if (limits?.max_deployment_bytes && total > limits.max_deployment_bytes) {
    throw new Error(`The build is ${Math.ceil(total / (1024 * 1024))} MB; XGENIA RGS publishes at most ${Math.floor(limits.max_deployment_bytes / (1024 * 1024))} MB.`);
  }

  const refs = publishable.map((f) => ({ file: f.path, sha: opts.sha1(f.bytes), size: f.bytes.length, type: f.type, bytes: f.bytes }));
  // Content-addressed: the same bytes under two paths are uploaded once.
  const bySha = new Map<string, (typeof refs)[number]>();
  for (const r of refs) if (!bySha.has(r.sha)) bySha.set(r.sha, r);

  const upload = async (shas: string[]) => {
    const queue = [...shas];
    let done = 0;
    const worker = async () => {
      while (queue.length > 0) {
        const r = bySha.get(queue.shift()!)!;
        let last: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await client.uploadFile(r.sha, r.bytes, r.type);
            last = null;
            break;
          } catch (e) {
            last = e;
            // A refusal about the file itself will not change on a retry.
            if (e instanceof WebPublishError && e.status >= 400 && e.status < 500) break;
          }
        }
        if (last) throw new Error(`Uploading ${r.file} failed: ${last?.message || last}`);
        done++;
        if (done % 10 === 0 || done === shas.length) progress(`Uploading files (${done}/${shas.length})...`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency || 6, shas.length) }, worker));
  };

  await upload([...bySha.keys()]);

  progress('Deploying...');
  const fileRefs = refs.map(({ file, sha, size }) => ({ file, sha, size }));
  let created;
  try {
    created = await client.deploy(site, fileRefs);
  } catch (e) {
    // Vercel did not have some files after all: send those and ask once more.
    if (e instanceof WebPublishError && e.code === 'MISSING_FILES' && Array.isArray(e.body?.missing)) {
      await upload((e.body.missing as string[]).filter((sha) => bySha.has(sha)));
      created = await client.deploy(site, fileRefs);
    } else {
      throw e;
    }
  }

  const sleep = opts.sleep || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = opts.pollAttempts ?? RGS_POLL_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    await sleep(opts.pollIntervalMs ?? RGS_POLL_INTERVAL_MS);
    const status = await client.deploymentStatus(created.deployment_id);
    if (status.failed) throw new Error(`Deployment failed: ${status.error || status.state}`);
    if (status.ready) {
      return {
        site: created.site,
        project: created.project,
        domain: created.domain,
        deploymentId: created.deployment_id,
        deploymentUrl: status.url || created.url || `https://${created.domain}`,
        liveUrl: status.live_url || `https://${created.domain}`,
        skipped
      };
    }
    progress(`Waiting for the site to go live (${status.state || 'building'})...`);
  }
  throw new Error('Deployment timeout - taking longer than expected');
}

/** The domain a site's name goes in front of, as this RGS hosts it. */
export function siteDomain(info: Pick<WebPublishInfo, 'domain'> | null | undefined): string {
  return info?.domain || 'vercel.app';
}
