// Which way a publish reaches Vercel: through XGENIA RGS `/web-publish` (the editor
// holds no token), or — only for a platform that predates it — the old shared
// Vercel token from maths-deployer `deploy-tokens`.
//
// Kept apart from publishGame.ts (which pulls in the compiler and the project
// model) so the choice itself is tested under plain Node
// (tests/deploy/webPublishClient.test.ts): the token loader is injected, and the
// one property that matters is checked there — when `/web-publish` answers, the
// token is never fetched.
//
// The fallback exists so the editor can ship before the platform does. It is
// loud on purpose (console.warn naming why), and it goes away with deploy-tokens:
// once XRGS removes that action the token path fails with its own message.

import {
  createWebPublishClient,
  detectWebPublishCached,
  FetchLike,
  WebPublishClient,
  WebPublishDetection,
  WebPublishEndpoint,
  WebPublishInfo
} from './webPublishClient';

export type PublishRoute =
  | { kind: 'rgs'; client: WebPublishClient; info: WebPublishInfo; vercelToken?: undefined }
  | { kind: 'token'; vercelToken: string; client?: undefined; info?: undefined };

export interface ChoosePublishRouteDeps {
  functionsUrl: string;
  anonKey: string;
  apiKey: string | null | undefined;
  fetch?: FetchLike;
  /** The old path: fetch the shared token. Called only when /web-publish is unavailable. */
  loadToken: () => Promise<{ token: string | null; error: string }>;
  detect?: (ep: WebPublishEndpoint) => Promise<WebPublishDetection>;
  warn?: (message: string) => void;
}

export const NOT_CONNECTED_MESSAGE = 'Not connected to XGENIA RGS. Sign in under Publish first.';

/** The route, or why there is none. Never throws. */
export async function choosePublishRoute(deps: ChoosePublishRouteDeps): Promise<{ route: PublishRoute | null; error: string }> {
  if (!deps.apiKey) return { route: null, error: NOT_CONNECTED_MESSAGE };
  const ep: WebPublishEndpoint = { functionsUrl: deps.functionsUrl, anonKey: deps.anonKey, apiKey: deps.apiKey, fetch: deps.fetch };
  let detection: WebPublishDetection;
  try {
    detection = await (deps.detect || detectWebPublishCached)(ep);
  } catch (e: any) {
    // A rejected key or no network is not "an older platform": the token path
    // needs the same key and the same network, so it would only fail later.
    return { route: null, error: `Could not reach XGENIA RGS to publish: ${e?.message || e}` };
  }
  if (detection.available) {
    return { route: { kind: 'rgs', client: createWebPublishClient(ep), info: detection.info }, error: '' };
  }
  (deps.warn || console.warn)(
    `[publish] XGENIA RGS web-publish unavailable (${detection.reason}); falling back to the shared Vercel token. ` +
      'This path goes away once the platform serves web-publish.'
  );
  const { token, error } = await deps.loadToken();
  if (!token) return { route: null, error: error || 'No Vercel deploy token is available, so this cannot run.' };
  return { route: { kind: 'token', vercelToken: token }, error: '' };
}
