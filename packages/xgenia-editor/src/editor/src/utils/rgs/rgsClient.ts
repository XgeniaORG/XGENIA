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
  XGENIA_RGS_MESSAGES,
  XgeniaRgsSignInError,
  XgeniaRgsSignInResult,
  redeemEditorCode,
  sendSignInCode,
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

/** Checks the code, stores the returned key as the editor's connection, and returns it. */
export async function completeEmailSignIn(email: string, code: string): Promise<RgsSignInResult> {
  const result = await verifySignInCode(email, code, SIGN_IN_ENDPOINTS);
  // An invited studio's key belongs to the real-money RGS: say so, or a sandbox address stored before would stick.
  saveRgsSettings({ apiKey: result.apiKey, rgsUrl: XRGS_URL });
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
    let redeemed = await redeemEditorCode(answer.code, ep, fetchFn);
    if (redeemed.kind === 'choose-studio') {
      const slug = opts.chooseStudio ? await opts.chooseStudio(redeemed.studios) : null;
      if (!slug) throw new XgeniaRgsSignInError('CANCELLED', XGENIA_RGS_MESSAGES.CANCELLED);
      opts.onStep?.('connecting');
      redeemed = await redeemEditorCode(answer.code, ep, fetchFn, slug);
      if (redeemed.kind === 'choose-studio') throw new XgeniaRgsSignInError('NO_STUDIO_CHOSEN', XGENIA_RGS_MESSAGES.NO_STUDIO_CHOSEN);
    }

    const result = redeemed.result;
    // The main RGS: say so, or a sandbox address stored before would stick.
    saveRgsSettings({ apiKey: result.apiKey, rgsUrl: XRGS_URL });
    EventDispatcher.instance.emit('rgs.connected', { operatorSlug: result.operatorSlug, studio: result.studio });
    return result;
  } finally {
    if (currentSignIn === mine) currentSignIn = null;
    // Closed already when the browser answered; this covers every way out before that.
    void loopback.cancel(id).catch(() => { /* already closed */ });
  }
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
 */
export function initRgsKeyVault(vault: RgsKeyVault): Promise<void> {
  keyReady = (async () => {
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
          if (typeof key === 'string' && key) memoryKey = key;
          else console.error('[rgs] The stored XGENIA RGS key could not be decrypted; sign in again under Publish.');
        } catch (e) {
          console.error('[rgs] The stored XGENIA RGS key could not be decrypted; sign in again under Publish.', (e as any)?.message || e);
        }
      }
    }
    // Panels that read the key before it was decrypted re-read it now.
    if (memoryKey) EventDispatcher.instance.emit('rgs.connected', { restored: true });
  })();
  return keyReady;
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
}

export function getRgsSettings(): RgsSettings | null {
  try {
    const parsed = readStoredSettings();
    const apiKey = memoryKey || (typeof parsed.apiKey === 'string' ? parsed.apiKey : '');
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
  memoryKey = null;
  localStorage.removeItem(RGS_KEY_CIPHER_KEY);
  localStorage.removeItem(RGS_SETTINGS_KEY);
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
