// Shared XGENIA RGS connection settings + helpers.
// Single source of truth for Publish, the Maths panel and the AI's bridge.
//
// The XRGS endpoint is fixed — the operator key comes from "Sign in with XGENIA" in
// Publish (connectWithXgeniaRgs below; rgsSignIn.ts), or the staff email sign-in.
// "XRGS" is the internal identifier; the user-facing name is "XGENIA RGS".

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';
import { activeGameFor } from './activeGame';
import {
  RgsSignInResult,
  RgsStudio,
  EmailSignInQuestions,
  XGENIA_RGS_MESSAGES,
  XgeniaRgsSignInError,
  XgeniaRgsSignInResult,
  redeemEditorCode,
  sendSignInCode,
  silentEditorConnect,
  SilentConnectEndpoints,
  SilentConnectOutcome,
  SilentStudio,
  startXgeniaRgsSignIn,
  verifySignInCode,
  xgeniaRgsRefusalMessage
} from './rgsSignIn';
import { XgeniaRgsLoopback, xgeniaRgsLoopback } from './rgsLoopback';

export const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';

// Supabase Auth base for the same project — the email-code sign-in (rgsSignIn.ts).
export const XRGS_AUTH_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/auth/v1';

// Supabase anon key — required by verify_jwt on edge functions.
// This is NOT a secret; it's the publishable key used to pass gateway auth.
// (2026-11-10) A local-testing copy of these three, marked DO NOT COMMIT, reached develop in #285 and sent
// every sign-in to 127.0.0.1. tests/rgs/rgsEndpoints.test.ts now fails on anything but the production project.
export const XRGS_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdWJ6d3lkcmplbG1qZmtrcmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4ODA3NDcsImV4cCI6MjA4NzQ1Njc0N30.Hewc7WlLZuufC0trhCKKKc4AhLXk7jy7qG3irBQPykY';

// The play-money test RGS (2026-11-02). Since 2026-11-10 it takes no new connections — there are no free XGENIA
// accounts, and customers sign in to the main RGS with XGENIA (connectWithXgeniaRgs) — and the editor no longer
// connects to it. A connection made there before still remembers it (settings.rgsUrl), so every request of that
// connection keeps going to the test RGS until the person signs out.
export const XRGS_SANDBOX_URL = 'https://mzbfpxsipkklvxjsedeu.supabase.co/functions/v1';
// The test RGS's publishable key: public by design, it only passes the gateway.
export const XRGS_SANDBOX_ANON_KEY = 'sb_publishable_OL5q_b23joomjamFmjoaVg_TiOV4KAP';

const RGS_SETTINGS_KEY = 'xgenia_rgs_settings';

/** The RGS this connection talks to: the test RGS for a sandbox connection, the real-money RGS otherwise. */
export function rgsFunctionsUrl(): string {
  return readStoredSettings().rgsUrl === XRGS_SANDBOX_URL ? XRGS_SANDBOX_URL : XRGS_URL;
}

/** True when the connection is a play-money sandbox (an XGENIA login, not an invited studio). */
export function isSandboxConnection(): boolean {
  return rgsFunctionsUrl() === XRGS_SANDBOX_URL;
}

// XGENIA RGS's back office, where a version is approved and deployed live. It shows the real-money RGS only.
export const XRGS_STUDIO_URL = 'https://rgs.xgenia.app';

/** The game's Versions page in XGENIA RGS; null on a play-money sandbox, which the back office does not show. */
export function gameVersionsUrl(slug: string | undefined): string | null {
  if (!slug || isSandboxConnection()) return null;
  return `${XRGS_STUDIO_URL}/project/default/games/${encodeURIComponent(slug)}/versions`;
}

function anonKeyFor(functionsUrl: string): string {
  return functionsUrl === XRGS_SANDBOX_URL ? XRGS_SANDBOX_ANON_KEY : XRGS_ANON_KEY;
}

/** The gateway key of the RGS this connection talks to. */
export function rgsAnonKey(): string {
  return anonKeyFor(rgsFunctionsUrl());
}

export interface RgsSettings {
  apiKey: string;
  rgsUrl?: string;
  /** The studio this connection publishes to, as the RGS named it when the key was issued (null: it did not say). */
  studio?: RgsStudio | null;
  /**
   * The key was issued without the authenticator (connected by itself, XRGS contract §10): it works only while
   * the studio has no real-money game. False for a key from the browser sign-in.
   */
  playMoneyOnly?: boolean;
}

export interface SelectedGame {
  id: string;
  slug: string;
  name?: string;
}

/** Build headers for maths-deployer / RGS edge-function requests. */
export function rgsHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Operator-Key': apiKey,
    apikey: anonKeyFor(rgsFunctionsUrl()),
    Authorization: `Bearer ${anonKeyFor(rgsFunctionsUrl())}`
  };
}

/**
 * Sign in to XGENIA RGS with an email code (see rgsSignIn.ts for why this replaced
 * the self-serve create_operator RPC) — XGENIA staff only since 2026-11-10; customers
 * use connectWithXgeniaRgs below.
 */
const SIGN_IN_ENDPOINTS = { authUrl: XRGS_AUTH_URL, functionsUrl: XRGS_URL, anonKey: XRGS_ANON_KEY };

export function emailSignInCode(email: string): Promise<void> {
  return sendSignInCode(email, SIGN_IN_ENDPOINTS);
}

/**
 * Checks the code, stores the returned key as the editor's connection, and returns it. `ask` lets it ask
 * the person for their authenticator code (two-factor sign-in) and, in several studios, which one this
 * editor publishes to (each null = cancelled).
 */
export async function completeEmailSignIn(email: string, code: string, ask: EmailSignInQuestions = {}): Promise<RgsSignInResult> {
  const result = await verifySignInCode(email, code, SIGN_IN_ENDPOINTS, undefined, ask);
  // An invited studio's key belongs to the real-money RGS: say so, or a sandbox address stored before would stick.
  // It is a full key (this path asks the authenticator), and this path does not say which studio.
  saveRgsSettings({ apiKey: result.apiKey, rgsUrl: XRGS_URL, studio: null, playMoneyOnly: false });
  EventDispatcher.instance.emit('rgs.connected', { operatorSlug: result.operatorSlug });
  return result;
}

/** The XGENIA login's access token ('' when signed out). getSession() can wait behind the auth lock
 * (EditorBridge auth.getJwt): bounded. */
export async function xgeniaAccessToken(): Promise<string> {
  const { supabase } = await import('../../supabaseInit');
  const session = await Promise.race([
    supabase.auth.getSession().then((r) => r.data.session),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))
  ]);
  return session?.access_token || '';
}

// ─── Sign in with XGENIA (the customer path, 2026-11-10) ─────────────────────

/** How the panel follows a sign-in in progress. */
export type XgeniaRgsSignInStep = 'opening-browser' | 'waiting-for-browser' | 'connecting';

export interface ConnectWithXgeniaRgsOptions {
  /**
   * The person belongs to several studios: ask which one (null = they cancelled). Without it, the
   * sign-in refuses rather than guess (the code is not spent, so nothing is lost).
   */
  chooseStudio?: (studios: RgsStudio[]) => Promise<string | null>;
  onStep?: (step: XgeniaRgsSignInStep) => void;
  /** Tests inject these; the editor uses the main process's loopback and the real fetch. */
  loopback?: XgeniaRgsLoopback;
  fetchFn?: (url: string, init?: any) => Promise<any>;
  /**
   * Where a connect-by-itself attempt gets the XGENIA session (connectSilently). false: never try it, go
   * straight to the browser. Left out, the editor's own session is used — once connecting-by-itself has been
   * turned on (enableSilentRgsConnect: the editor does, at startup), and unless a test injected the loopback or
   * the fetch. So a build or a test that never turns it on signs in exactly as before.
   */
  silent?: SilentConnectSource | false;
}

let currentSignIn: { loopback: XgeniaRgsLoopback; id: string } | null = null;

/** Stop a Sign in with XGENIA that is waiting for the browser (the panel's Cancel, or the panel closing). */
export function cancelXgeniaRgsSignIn(): void {
  const s = currentSignIn;
  currentSignIn = null;
  if (s) void s.loopback.cancel(s.id).catch(() => { /* already closed */ });
}

/**
 * "Sign in with XGENIA" (XRGS docs/XGENIA_RGS_CONTRACT.md §9): listen on the loopback, ask the RGS
 * for its sign-in page, open it in the system browser, wait for the one-time code, redeem it, and
 * store the key exactly as the email sign-in does. Throws XgeniaRgsSignInError with words the
 * person can act on; code NOT_AVAILABLE means this RGS does not offer it yet (use email).
 */
export async function connectWithXgeniaRgs(opts: ConnectWithXgeniaRgsOptions = {}): Promise<XgeniaRgsSignInResult> {
  // First, by itself: the person is signed in to XGENIA in this editor, so no browser is needed for a studio
  // with nothing live (XRGS contract §10). Anything but "connected" or "they cancelled" falls through to the
  // browser, which explains every other case (no plan, a studio that needs the authenticator, …) properly.
  const source = opts.silent === undefined
    ? (silentEnabled && !opts.loopback && !opts.fetchFn ? silentDefaults.source ?? editorSilentSource : null)
    : opts.silent || null;
  let preferredStudio: string | undefined;
  if (source) {
    opts.onStep?.('connecting');
    const silent = await connectSilently({ source, chooseStudio: opts.chooseStudio, fetchFn: opts.fetchFn });
    if (silent.kind === 'connected') return silent.result;
    if (silent.kind === 'refused' && silent.code === 'CANCELLED') throw new XgeniaRgsSignInError('CANCELLED', XGENIA_RGS_MESSAGES.CANCELLED);
    // They already said which studio (one with a real-money game): the browser path is not made to ask again.
    if (silent.kind === 'refused') preferredStudio = silent.studioSlug;
  }

  const loopback = opts.loopback ?? xgeniaRgsLoopback();
  if (!loopback) throw new XgeniaRgsSignInError('NOT_DESKTOP', XGENIA_RGS_MESSAGES.NOT_DESKTOP);
  const fetchFn = (opts.fetchFn ?? ((url: string, init?: any) => fetch(url, init))) as any;
  const ep = { functionsUrl: XRGS_URL, anonKey: XRGS_ANON_KEY };

  cancelXgeniaRgsSignIn(); // one at a time
  const { id, redirectUri, installLabel } = await loopback.listen();
  const mine = { loopback, id };
  currentSignIn = mine;
  try {
    opts.onStep?.('opening-browser');
    const { authorizeUrl } = await startXgeniaRgsSignIn({ editorRedirect: redirectUri, installLabel }, ep, fetchFn);
    try {
      await loopback.openBrowser(id, authorizeUrl);
    } catch {
      throw new XgeniaRgsSignInError('BROWSER_FAILED', XGENIA_RGS_MESSAGES.BROWSER_FAILED);
    }
    opts.onStep?.('waiting-for-browser');
    const answer = await loopback.wait(id);
    if (!('code' in answer) || !answer.code) {
      const code = ('error' in answer && answer.error) || 'CANCELLED';
      throw new XgeniaRgsSignInError(code, xgeniaRgsRefusalMessage(code, 'message' in answer ? answer.message : ''));
    }

    opts.onStep?.('connecting');
    let redeemed = await redeemEditorCode(answer.code, ep, fetchFn, preferredStudio);
    if (redeemed.kind === 'choose-studio') {
      const slug = opts.chooseStudio ? await opts.chooseStudio(redeemed.studios) : null;
      if (!slug) throw new XgeniaRgsSignInError('CANCELLED', XGENIA_RGS_MESSAGES.CANCELLED);
      opts.onStep?.('connecting');
      redeemed = await redeemEditorCode(answer.code, ep, fetchFn, slug);
      if (redeemed.kind === 'choose-studio') throw new XgeniaRgsSignInError('NO_STUDIO_CHOSEN', XGENIA_RGS_MESSAGES.NO_STUDIO_CHOSEN);
    }

    const result = redeemed.result;
    // The main RGS: say so, or a sandbox address stored before would stick. A key from the browser sign-in is a
    // full one (the authenticator was asked there): say that too, or a "play money" mark stored before would stick.
    saveRgsSettings({ apiKey: result.apiKey, rgsUrl: XRGS_URL, studio: result.studio, playMoneyOnly: false });
    rememberStudio(result.studio?.slug);
    EventDispatcher.instance.emit('rgs.connected', { operatorSlug: result.operatorSlug, studio: result.studio });
    return result;
  } finally {
    if (currentSignIn === mine) currentSignIn = null;
    // Closed already when the browser answered; this covers every way out before that.
    void loopback.cancel(id).catch(() => { /* already closed */ });
  }
}

// ─── Connected by itself, for play money (XRGS contract §10, 2026-11-13) ─────
//
// The person is signed in to XGENIA in this editor. That used to count for nothing at the RGS: Publish asked
// them to sign in again, in a browser, with their authenticator, on every computer. Now the editor trades its
// XGENIA session for a one-minute ticket (at XGENIA) and the ticket for an editor key (at the RGS) — a key that
// works for play money only, which is everything a studio with no real-money game does. The protocol is
// rgsSignIn.ts silentEditorConnect; this is when it runs and what it leaves behind.
//
//   - Sign in with XGENIA (Publish, the AI's xrgs.connect) tries it FIRST and opens the browser only when it
//     does not connect: a studio with a real-money game, an RGS or an XGENIA that cannot do it yet, no network.
//   - autoConnectRgs() tries it with nobody asking: at startup and when someone signs in to XGENIA, if the editor
//     is not connected. It never opens a browser and never asks a question; with several studios it connects
//     only to the one this person last used on this computer, and otherwise leaves it to Publish.
//   - A Sign out of the RGS in Publish stays signed out (disconnectRgsOnPurpose): autoConnectRgs does nothing
//     for that person until they connect again themselves. A sign-out that reconnects by itself is not one.
//   - A play-money key STOPS EXISTING when its studio gets a real-money game. The editor would find out at the
//     next Publish, as "Unauthorized". autoConnectRgs asks at startup instead and drops a dead key, so Publish
//     shows Sign in with XGENIA — which then goes to the browser, with the authenticator, once.

/** Where a connect-by-itself attempt gets the XGENIA session and the two addresses. Tests inject it. */
export interface SilentConnectSource {
  /** The signed-in XGENIA session's access token; '' when nobody is signed in. */
  accessToken(): Promise<string>;
  endpoints(): Promise<SilentConnectEndpoints>;
}

const editorSilentSource: SilentConnectSource = {
  accessToken: xgeniaAccessToken,
  endpoints: async () => {
    const xgenia = await import('../../supabaseInit');
    return { xgeniaFunctionsUrl: xgenia.XGENIA_FUNCTIONS_URL, xgeniaAnonKey: xgenia.XGENIA_ANON_KEY, functionsUrl: XRGS_URL, anonKey: XRGS_ANON_KEY };
  }
};

/** localStorage: the studio each XGENIA account last connected this computer to ({ [userId]: slug }). Not a secret. */
export const RGS_LAST_STUDIO_KEY = 'xgenia_rgs_last_studio_v1';
/** localStorage: the XGENIA account that signed out of the RGS on purpose ('-' when nobody was signed in). */
export const RGS_STAY_SIGNED_OUT_KEY = 'xgenia_rgs_stay_signed_out_v1';

function lastStudios(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(RGS_LAST_STUDIO_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function rememberStudio(slug: string | null | undefined): void {
  const who = accountUserId || '-';
  const all = lastStudios();
  if (slug) all[who] = slug;
  else delete all[who];
  localStorage.setItem(RGS_LAST_STUDIO_KEY, JSON.stringify(all));
}
function rememberedStudio(): string | undefined {
  const slug = lastStudios()[accountUserId || '-'];
  return typeof slug === 'string' && slug ? slug : undefined;
}

/** Did THIS person sign out of the RGS on purpose? (Another person signing in to XGENIA here is not bound by it.) */
function staysSignedOut(): boolean {
  const who = localStorage.getItem(RGS_STAY_SIGNED_OUT_KEY);
  return !!who && who === (accountUserId || '-');
}

/**
 * Sign out of the XGENIA RGS on purpose (Publish → Sign out): the connection is removed AND the editor does not
 * connect by itself again for this person until they connect themselves. clearRgsSettings alone would be undone
 * by the next autoConnectRgs.
 */
export function disconnectRgsOnPurpose(): void {
  const who = accountUserId || '-';
  clearRgsSettings();
  localStorage.setItem(RGS_STAY_SIGNED_OUT_KEY, who);
}

/** A connect-by-itself attempt's result; a refusal may carry the studio the person had already picked. */
export type SilentConnection =
  | Exclude<SilentConnectOutcome, { kind: 'refused' }>
  | { kind: 'refused'; code: string; message: string; studioSlug?: string };

/**
 * One connect-by-itself attempt, storing the key if it gets one. Never throws, never opens a browser. With
 * several studios it asks `chooseStudio` if given (Publish's picker) and otherwise answers 'choose-studio'.
 */
export async function connectSilently(opts: {
  source?: SilentConnectSource;
  studioSlug?: string;
  chooseStudio?: (studios: SilentStudio[]) => Promise<string | null>;
  fetchFn?: (url: string, init?: any) => Promise<any>;
} = {}): Promise<SilentConnection> {
  const source = opts.source ?? editorSilentSource;
  // The account a key obtained now belongs to is the one signed in NOW: if it changes while the RGS answers,
  // the key is not stored (it would be stamped with the wrong owner).
  const asker = accountUserId;
  let token = '';
  let ep: SilentConnectEndpoints;
  try {
    token = await source.accessToken();
    ep = await source.endpoints();
  } catch {
    return { kind: 'refused', code: 'SIGNED_OUT', message: '' };
  }
  let out: SilentConnection = await silentEditorConnect(token, ep, opts.fetchFn as any, { studioSlug: opts.studioSlug });
  if (out.kind === 'choose-studio' && opts.chooseStudio) {
    const studios = out.studios;
    const slug = await opts.chooseStudio(studios);
    if (!slug) return { kind: 'refused', code: 'CANCELLED', message: '' };
    const picked = studios.find((st) => st.slug === slug);
    // A studio with a real-money game: the browser, with the authenticator. No second ticket is spent finding out.
    if (!picked || !picked.playMoneyOnly) return { kind: 'refused', code: 'SECOND_FACTOR_REQUIRED', message: '', studioSlug: slug };
    out = await silentEditorConnect(token, ep, opts.fetchFn as any, { studioSlug: slug });
    if (out.kind === 'choose-studio') return { kind: 'refused', code: 'NO_STUDIO_CHOSEN', message: '' };
    if (out.kind === 'refused') return { ...out, studioSlug: slug };
  }
  if (out.kind !== 'connected') return out;
  if (accountBound && accountUserId !== asker) return { kind: 'refused', code: 'ACCOUNT_CHANGED', message: '' };
  saveRgsSettings({ apiKey: out.result.apiKey, rgsUrl: XRGS_URL, studio: out.result.studio, playMoneyOnly: true });
  rememberStudio(out.result.studio?.slug);
  EventDispatcher.instance.emit('rgs.connected', { operatorSlug: out.result.operatorSlug, studio: out.result.studio, playMoneyOnly: true, silent: true });
  return out;
}

type AutoConnectOptions = { source?: SilentConnectSource; fetchFn?: (url: string, init?: any) => Promise<any> };

let silentEnabled = false;
let silentDefaults: AutoConnectOptions = {};
let autoConnecting: Promise<void> | null = null;

/**
 * Turn connecting-by-itself on (the editor does, at startup; tests and builds without XGENIA sign-in do not).
 * `defaults` is what the attempts nobody calls by hand use — at startup, when someone signs in; tests pass theirs.
 */
export function enableSilentRgsConnect(defaults: AutoConnectOptions = {}): void {
  silentEnabled = true;
  silentDefaults = defaults;
  // The account may already be known (the vault settled first): try now.
  later(() => { void autoConnectRgs(); });
}

/** Does this key still open anything? false: the RGS refuses it. null: could not tell (network, a 5xx). */
async function keyStillWorks(apiKey: string, fetchFn: (url: string, init?: any) => Promise<any>): Promise<boolean | null> {
  try {
    const res = await fetchFn(`${rgsFunctionsUrl()}/maths-deployer`, { method: 'POST', headers: rgsHeaders(apiKey), body: JSON.stringify({ action: 'operator-info' }) });
    if (res.ok) return true;
    return res.status === 401 || res.status === 403 ? false : null;
  } catch {
    return null;
  }
}

/** The key only: memory, keychain copy and owner. The game selection and the studio's name stay for the reconnect. */
function dropKeyKeepSettings(): void {
  memoryKey = null;
  localStorage.removeItem(RGS_KEY_CIPHER_KEY);
  localStorage.removeItem(RGS_KEY_OWNER_KEY);
  const { apiKey: _gone, ...rest } = readStoredSettings();
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify(rest));
}

/**
 * Connect by itself if it can, with nobody asking (see the section header). One at a time; never throws.
 * `opts` is for tests.
 */
export function autoConnectRgs(opts: AutoConnectOptions = {}): Promise<void> {
  if (autoConnecting) return autoConnecting;
  const attempt = (async () => {
    try {
      if (!silentEnabled) return;
      // Somebody must be signed in to XGENIA, and known to be: an owned key is locked until then anyway.
      if (accountBound && !accountUserId) return;
      const source = opts.source ?? silentDefaults.source;
      const given = opts.fetchFn ?? silentDefaults.fetchFn;
      const fetchFn = given ?? ((url: string, init?: any) => fetch(url, init));
      const current = getRgsSettings();
      if (current?.apiKey) {
        // Connected. A play-money key stops existing when its studio gets a real-money game: find out now.
        if (!current.playMoneyOnly || isSandboxConnection()) return;
        if ((await keyStillWorks(current.apiKey, fetchFn)) !== false) return;
        if (getRgsSettings()?.apiKey !== current.apiKey) return; // replaced while we asked
        // Dead: it reached its thirty days, or its studio got a real-money game, or it was removed. Drop it and
        // ask for a new one below — which the RGS gives if the studio is still play money, and refuses if not
        // (then Publish shows Sign in with XGENIA, which goes to the browser).
        dropKeyKeepSettings();
        EventDispatcher.instance.emit('rgs.gameSelected', getActiveGame());
      }
      if (staysSignedOut()) return;
      const studioSlug = current?.studio?.slug || rememberedStudio();
      const out = await connectSilently({ source, fetchFn: given, studioSlug });
      // No longer theirs: forget it, so the next attempt asks the RGS which studios they have now.
      if (out.kind === 'refused' && studioSlug && (out.code === 'NOT_YOUR_STUDIO' || out.code === 'VIEWER_ONLY')) rememberStudio(null);
    } catch (e) {
      console.warn('[rgs] Connecting to XGENIA RGS by itself failed:', (e as any)?.message || e);
    }
  })();
  // Cleared in a LATER task, never inside the attempt: one that ends without waiting on anything (nobody signed
  // in, signed out on purpose) finishes before the line above has even assigned it — a `finally` in there would
  // run first, and the guard would then hold a finished attempt for ever and nothing would connect again.
  autoConnecting = attempt;
  void attempt.then(() => { if (autoConnecting === attempt) autoConnecting = null; });
  return attempt;
}

/** The operator an API key belongs to, as reported by maths-deployer/operator-info. */
export interface OperatorInfo {
  operator_id: string;
  operator_slug: string;
  name: string | null;
  mode: string;
  /** Remaining wallet balance in cents, or null for internal mode (no wallet). */
  wallet_balance: number | null;
  currency: string;
  supported_currencies: string[];
  max_bet: number | null;
  max_win: number | null;
}

/**
 * Who is this key? Its name, mode, currency and wallet funds — Publish reads the
 * currency for the create-game form.
 * Returns null when the key resolves to no operator (e.g. a platform session
 * rather than an operator key), so the caller can fall back rather than handle
 * an error.
 */
export async function fetchOperatorInfo(apiKey: string): Promise<OperatorInfo | null> {
  const res = await fetch(`${rgsFunctionsUrl()}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'operator-info' })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed (${res.status})`);
  }

  const data = await res.json();
  return (data?.operator as OperatorInfo | null) ?? null;
}

/**
 * The games this key can see (maths-deployer `list-games`), each with its
 * lifecycle `status` and money `mode` — the list Publish's game step
 * (ReleaseSetup) offers.
 */
export async function listGames(apiKey: string): Promise<any[]> {
  const res = await fetch(`${rgsFunctionsUrl()}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'list-games' })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Could not list games (HTTP ${res.status})`);
  }
  return data.games || [];
}

// ─── The operator key at rest (G1-S14, 2026-11-03) ───────────────────────────
//
// The key used to sit in plaintext localStorage (`xgenia_rgs_settings.apiKey`),
// readable by anything that can read this profile's files. It is a credential
// for the studio's whole XGENIA RGS account — games, maths, wallet, publishing.
//
// Now it is encrypted with Electron safeStorage (the OS keychain: Keychain,
// DPAPI, libsecret) through the editor's existing main-process bridge,
// store/_internal/StorageApi — the same one GitStore and the cloud-service master
// key store use. ConnectionStore's own encryption was NOT reused: its AES key is
// generated in the renderer and kept in IndexedDB next to the ciphertext, so it
// protects nothing from someone who can read the profile.
//
// getRgsSettings() stays synchronous for its ~40 callers: the key is decrypted
// ONCE at startup (initRgsKeyVault, editor/index.ts) into memory, and every save
// updates memory synchronously and the ciphertext asynchronously. The first run
// with a vault migrates an existing plaintext key and deletes it from
// localStorage. Without a vault — tests, the web build, or an OS with no keychain
// (isEncryptionAvailable false) — it behaves exactly as before, and says so once
// on the console; a key is never dropped for want of somewhere safe to put it.

/** The OS-keychain bridge (StorageApi in the editor). decrypt answers undefined on failure. */
export interface RgsKeyVault {
  isAvailable(): Promise<boolean>;
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string | null | undefined>;
}

/** localStorage key of the safeStorage ciphertext. Never the key itself. */
export const RGS_KEY_CIPHER_KEY = 'xgenia_rgs_key_enc_v1';
/** A bridge call that does not answer in this long is treated as no keychain. */
const VAULT_TIMEOUT_MS = 5000;

let keyVault: RgsKeyVault | null = null;
let memoryKey: string | null = null;
let keyReady: Promise<void> = Promise.resolve();
let pendingKeyWrite: Promise<void> = Promise.resolve();

// ─── The key belongs to the XGENIA account it was obtained under (2026-11-13) ──
//
// The stored key was the INSTALL's. It outlived the XGENIA sign-out, so the next
// person to sign in to this editor published into the previous person's studio
// without ever signing in to the RGS. Since every paid XGENIA person has a studio
// of their own (XRGS SYSTEM_MAP I-224), "the previous person's studio" is the
// normal case on a shared machine, not a corner.
//
// Now a key carries the id of the XGENIA account that was signed in when it was
// saved (RGS_KEY_OWNER_KEY, next to the ciphertext; an id, not a secret) and is
// usable only while THAT account is signed in:
//
//   the session lapsed, or nobody is signed in   not connected. The key stays in the
//                                                keychain for its owner's return: a
//                                                lapsed session is not a reason to
//                                                make someone connect again;
//   the same account signs in again              connected, as before;
//   a DIFFERENT account signs in                 the key is destroyed, with the game
//                                                selection that went with it;
//   Sign out, on purpose                         destroyed (forgetRgsKeyOnSignOut,
//                                                called by both sign-out paths).
//
// A key with NO owner — saved by an older editor, or while nobody was signed in —
// works as it always did and is adopted by the next account to sign in. The first
// sign-in after this update cannot be told from the person who connected; that is
// the one inheritance left, once per install.
//
// The check is made where the key is READ (keyUsableNow in getRgsSettings), from
// two facts kept in step synchronously — who is signed in, whose key it is — so no
// ordering of the keychain's answer and the session's can show a key to the wrong
// account. Without an account source (tests, a build with no XGENIA sign-in)
// nothing here applies and the key behaves as it did.

/** Who is signed in to XGENIA in this editor. The editor passes its session; tests pass a fake. */
export interface RgsKeyAccount {
  /** The restored session's user id; null when nobody is signed in. */
  current(): Promise<string | null>;
  /**
   * Every later change: who is signed in now (null: nobody). The listener only records the fact and
   * touches localStorage; anything that re-renders is handed to a later task (see `later`), because
   * supabase-js calls this holding its auth lock.
   */
  onChange(listener: (userId: string | null) => void): void;
}

/** localStorage key of the XGENIA user id the stored key belongs to. An id, never the key. */
export const RGS_KEY_OWNER_KEY = 'xgenia_rgs_key_owner_v1';

let accountBound = false;
/** undefined: not known yet (startup). null: nobody is signed in. */
let accountUserId: string | null | undefined;
/** An auth event has arrived: the startup snapshot, if it answers later, is older and is ignored. */
let accountEventSeen = false;

const later = (fn: () => void) => { setTimeout(fn, 0); };

function storedKeyOwner(): string | null {
  try {
    return localStorage.getItem(RGS_KEY_OWNER_KEY) || null;
  } catch {
    return null;
  }
}

function hasStoredKey(): boolean {
  const plaintext = readStoredSettings().apiKey;
  return !!memoryKey || !!localStorage.getItem(RGS_KEY_CIPHER_KEY) || (typeof plaintext === 'string' && !!plaintext);
}

/** May the stored key be used right now? Always — unless it belongs to an account that is not the one signed in. */
function keyUsableNow(): boolean {
  if (!accountBound) return true;
  const owner = storedKeyOwner();
  return !owner || owner === accountUserId;
}

/** The owner of a key being saved now: whoever is signed in; nobody, if nobody is. */
function stampKeyOwner(): void {
  if (!accountBound) return;
  if (accountUserId) localStorage.setItem(RGS_KEY_OWNER_KEY, accountUserId);
  else localStorage.removeItem(RGS_KEY_OWNER_KEY);
}

/** Memory, keychain copy, owner and the settings that hung off the key. No event: callers say what changed. */
function destroyStoredKey(): void {
  memoryKey = null;
  localStorage.removeItem(RGS_KEY_CIPHER_KEY);
  localStorage.removeItem(RGS_KEY_OWNER_KEY);
  localStorage.removeItem(RGS_SETTINGS_KEY);
}

/** The signed-in XGENIA account is now `userId` (null: nobody). Synchronous but for telling the panels. */
function onRgsKeyAccount(userId: string | null): void {
  const wasConnected = isRgsConnected();
  accountUserId = userId;
  let destroyed = false;
  if (userId) {
    const owner = storedKeyOwner();
    if (owner && owner !== userId) {
      // Another account's key. It never reaches this one, and it does not wait here for its owner
      // either: on a machine two people use, that would be a studio's key kept for whoever asks next.
      destroyStoredKey();
      destroyed = true;
      console.warn('[rgs] A different XGENIA account signed in: the previous account\'s XGENIA RGS connection was removed from this computer.');
    } else if (!owner && hasStoredKey()) {
      localStorage.setItem(RGS_KEY_OWNER_KEY, userId);
    }
  }
  const connected = isRgsConnected();
  // Somebody is signed in to XGENIA now: connect by itself if the editor is not connected (or check a play-money key).
  if (userId && silentEnabled) later(() => { void autoConnectRgs(); });
  if (destroyed) later(() => EventDispatcher.instance.emit('rgs.gameSelected', null));
  else if (connected && !wasConnected) later(() => EventDispatcher.instance.emit('rgs.connected', { restored: true }));
  else if (!connected && wasConnected) later(() => EventDispatcher.instance.emit('rgs.gameSelected', null));
}

/** Attach the account source. From this call on, an owned key is unusable until its owner is known to be signed in. */
function bindRgsKeyAccount(account: RgsKeyAccount): Promise<void> {
  accountBound = true;
  accountUserId = undefined;
  accountEventSeen = false;
  account.onChange((userId) => {
    accountEventSeen = true;
    onRgsKeyAccount(userId || null);
  });
  return withVaultTimeout(account.current()).then(
    (userId) => { if (!accountEventSeen) onRgsKeyAccount(userId || null); },
    // Not known in time: an owned key stays locked until an auth event says who is signed in.
    (e) => { console.warn('[rgs] Could not tell who is signed in to XGENIA yet:', (e as any)?.message || e); }
  );
}

/**
 * Sign out of XGENIA, on purpose: the RGS connection goes with it. Both sign-out paths call this
 * (AuthContext.signOut, the lobby's). A session that merely lapses does not come through here.
 */
export function forgetRgsKeyOnSignOut(): void {
  if (!hasStoredKey() && !storedKeyOwner()) return;
  clearRgsSettings();
}

function withVaultTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('the OS keychain did not answer')), VAULT_TIMEOUT_MS);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Only the two RGS addresses this editor knows; anything else stored is the real-money one. */
function knownRgsUrl(url: unknown): string {
  return url === XRGS_SANDBOX_URL ? XRGS_SANDBOX_URL : XRGS_URL;
}

function readStoredSettings(): any {
  try {
    const parsed = JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Remove the plaintext key from the stored settings, keeping everything else. */
function dropPlaintextKey(): void {
  const cur = readStoredSettings();
  if (!('apiKey' in cur)) return;
  const { apiKey: _gone, ...rest } = cur;
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify(rest));
}

/** Encrypt and store; true when the ciphertext is on disk. */
async function writeCipher(vault: RgsKeyVault, key: string): Promise<boolean> {
  try {
    const cipher = await withVaultTimeout(vault.encrypt(key));
    if (typeof cipher !== 'string' || !cipher) return false;
    // A save or clear that happened while this was encrypting wins.
    if (memoryKey !== key) return true;
    localStorage.setItem(RGS_KEY_CIPHER_KEY, cipher);
    return true;
  } catch (e) {
    console.error('[rgs] Could not encrypt the XGENIA RGS key:', (e as any)?.message || e);
    return false;
  }
}

/**
 * Install the OS-keychain bridge, migrate a plaintext key and decrypt the stored
 * one into memory. Call once at startup; rgsKeyReady() resolves when it is done.
 * With `account`, the key is bound to the signed-in XGENIA account (see above) and
 * "done" includes knowing who that is.
 */
export function initRgsKeyVault(vault: RgsKeyVault, account?: RgsKeyAccount): Promise<void> {
  // Bound BEFORE the keychain is asked: an owned key is locked from the first instant.
  const accountSettled = account ? bindRgsKeyAccount(account) : Promise.resolve();
  keyReady = (async () => {
    await loadStoredKey(vault);
    await accountSettled;
    // Panels that read the key before it was decrypted, or before its owner was known, re-read it now.
    if (isRgsConnected()) EventDispatcher.instance.emit('rgs.connected', { restored: true });
  })();
  return keyReady;
}

async function loadStoredKey(vault: RgsKeyVault): Promise<void> {
  let available = false;
  try {
    available = !!(await withVaultTimeout(vault.isAvailable()));
  } catch {
    available = false;
  }
  if (!available) {
    console.warn('[rgs] OS secure storage is unavailable here; the XGENIA RGS key stays in local storage as before.');
    return;
  }
  keyVault = vault;

  const plaintext = readStoredSettings().apiKey;
  if (typeof plaintext === 'string' && plaintext) {
    // First run with a vault (or a key an older editor saved since): move it.
    memoryKey = plaintext;
    if (await writeCipher(vault, plaintext)) dropPlaintextKey();
    else keyVault = null; // keep the plaintext rather than lose the key
  } else {
    const cipher = localStorage.getItem(RGS_KEY_CIPHER_KEY);
    if (cipher) {
      try {
        const key = await withVaultTimeout(vault.decrypt(cipher));
        // Destroyed while the keychain was answering (a different account signed in): it stays destroyed.
        if (localStorage.getItem(RGS_KEY_CIPHER_KEY) !== cipher) return;
        if (typeof key === 'string' && key) memoryKey = key;
        else console.error('[rgs] The stored XGENIA RGS key could not be decrypted; sign in again under Publish.');
      } catch (e) {
        console.error('[rgs] The stored XGENIA RGS key could not be decrypted; sign in again under Publish.', (e as any)?.message || e);
      }
    }
  }
}

/** Resolves once the stored key has been read (immediately when there is no vault). */
export function rgsKeyReady(): Promise<void> {
  return keyReady;
}

/** Resolves once the last saved key's ciphertext is written. For tests and shutdown. */
export function flushRgsKeyWrites(): Promise<void> {
  return pendingKeyWrite;
}

/** Back to "no vault, nothing in memory". Tests only. */
export function resetRgsKeyVaultForTests(): void {
  keyVault = null;
  memoryKey = null;
  keyReady = Promise.resolve();
  pendingKeyWrite = Promise.resolve();
  accountBound = false;
  accountUserId = undefined;
  accountEventSeen = false;
  silentEnabled = false;
  silentDefaults = {};
  autoConnecting = null;
}

export function getRgsSettings(): RgsSettings | null {
  try {
    const parsed = readStoredSettings();
    // Another account's key (or one whose owner is signed out) reads as "not connected".
    const apiKey = keyUsableNow() ? memoryKey || (typeof parsed.apiKey === 'string' ? parsed.apiKey : '') : '';
    if (apiKey) return { ...parsed, apiKey };
  } catch {
    /* ignore */
  }
  return null;
}

export function saveRgsSettings(settings: RgsSettings | string): void {
  // Merge into whatever is already stored so unrelated fields (activeGame /
  // testSettings, written by the Maths RGS panel via mergeRgsSettings) survive a
  // key re-save. Previously this overwrote the whole object and wiped them.
  const cur = readStoredSettings();
  const patch: any = typeof settings === 'string' ? { apiKey: settings } : { ...settings };
  const vault = keyVault;
  // A new key is the signed-in account's from this moment (and replaces whoever's was there). Connecting again,
  // by any path, also ends a "stay signed out" (disconnectRgsOnPurpose).
  if (typeof patch.apiKey === 'string' && patch.apiKey) {
    stampKeyOwner();
    localStorage.removeItem(RGS_STAY_SIGNED_OUT_KEY);
  }
  if (vault && typeof patch.apiKey === 'string' && patch.apiKey) {
    // The key goes to memory now and to the keychain next; localStorage never sees it.
    const key: string = patch.apiKey;
    memoryKey = key;
    const { apiKey: _new, ...rest } = patch;
    const { apiKey: _old, ...curRest } = cur;
    localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...curRest, ...rest, rgsUrl: knownRgsUrl(rest.rgsUrl ?? curRest.rgsUrl) }));
    pendingKeyWrite = writeCipher(vault, key).then((ok) => {
      if (ok || memoryKey !== key) return;
      // The keychain refused after saying it was there: keep the key usable after
      // a restart, as before G1-S14, rather than lose it — and say so.
      console.error('[rgs] Storing the XGENIA RGS key in local storage instead of the OS keychain.');
      localStorage.removeItem(RGS_KEY_CIPHER_KEY);
      localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...readStoredSettings(), apiKey: key }));
    });
    return;
  }
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...cur, ...patch, rgsUrl: knownRgsUrl(patch.rgsUrl ?? cur.rgsUrl) }));
}

export function clearRgsSettings(): void {
  destroyStoredKey();
  // The active game is stored under the same key, so disconnecting clears the
  // selection too — say so, or a listener keeps showing the old game.
  EventDispatcher.instance.emit('rgs.gameSelected', null);
}

export function isRgsConnected(): boolean {
  return !!getRgsSettings()?.apiKey;
}

/**
 * The game this project releases as. This is the single source of truth shared
 * by Publish, the Maths panel and the AI: Publish (ReleaseSetup) and the AI (via
 * the EditorBridge's xrgs.setActiveGame, or __xrgs.setActiveGame) write it through
 * setActiveGame below into `xgenia_rgs_settings.activeGameByProject`, and the
 * Publish popup and the Maths panel read it here.
 *
 * Every write MUST go through setActiveGame: it is what emits `rgs.gameSelected`.
 * The Publish popup is always mounted, so a write that skips the event leaves it
 * showing the previous game until it happens to re-render.
 */
/**
 * (2026-11-01) The selection is kept PER PROJECT. It used to be one value for the whole editor, so a
 * plinko project opened after a crash project showed "Selected game: crash-space-97" in Maths — and
 * Publish would have deployed the plinko game to the crash game's backend. A project with no
 * selection of its own has none (the panel asks), never the last project's.
 */
function currentProjectId(): string | null {
  try {
    const id = (globalThis as any).ProjectModel?.instance?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

export { activeGameFor };

// ─── The game a project declared, remembered across RGS accounts ─────────────
//
// Moving from the play-money sandbox to an invited real-money account is a different RGS: the game
// is created again there. The studio had to retype what it already declared (name, RTP, bets, max
// win), and the form opened on defaults that were easy to accept by mistake (XRGS SYSTEM_MAP.md
// I-13). The declaration is kept per project under its OWN key, so leaving a connection
// (clearRgsSettings) does not forget it, and the next account's game form opens with it.
const GAME_DECLARATIONS_KEY = 'xgenia_rgs_game_declarations';

export interface RememberedGameDeclaration {
  name: string;
  rtp: string;
  minBet: string;
  maxBet: string;
  maxWin: string;
  /** Where it was declared: lets the form say "from your sandbox". */
  fromSandbox: boolean;
}

export function rememberGameDeclaration(form: Omit<RememberedGameDeclaration, 'fromSandbox'>): void {
  const project = currentProjectId();
  if (!project) return;
  try {
    const all = JSON.parse(localStorage.getItem(GAME_DECLARATIONS_KEY) || '{}');
    all[project] = { ...form, fromSandbox: isSandboxConnection() };
    localStorage.setItem(GAME_DECLARATIONS_KEY, JSON.stringify(all));
  } catch {
    /* storage unavailable: the form simply opens on defaults */
  }
}

export function rememberedGameDeclaration(): RememberedGameDeclaration | null {
  const project = currentProjectId();
  if (!project) return null;
  try {
    const d = JSON.parse(localStorage.getItem(GAME_DECLARATIONS_KEY) || '{}')[project];
    return d && typeof d.name === 'string' && d.name ? (d as RememberedGameDeclaration) : null;
  } catch {
    return null;
  }
}

export function getActiveGame(): SelectedGame | null {
  try {
    return activeGameFor<SelectedGame>(JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}'), currentProjectId());
  } catch {
    return null;
  }
}

export function setActiveGame(game: SelectedGame | null): void {
  let cur: any = {};
  try {
    cur = JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}');
  } catch {
    /* ignore */
  }
  const projectId = currentProjectId();
  const byProject = { ...(cur.activeGameByProject || {}) };
  if (projectId) {
    if (game) byProject[projectId] = game;
    else delete byProject[projectId];
  }
  // The old editor-wide `activeGame` is dropped: it is what leaked one project's game into the next.
  const { activeGame: _dropped, ...rest } = cur;
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...rest, activeGameByProject: byProject }));
  EventDispatcher.instance.emit('rgs.gameSelected', game);
}
