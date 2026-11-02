// Shared XGENIA RGS connection settings + helpers.
// Single source of truth for the Maths RGS panel and the Deploy flow.
//
// The XRGS endpoint is fixed — users only provide their operator API key
// (generated from the RGS dashboard). "XRGS" is the internal identifier; the
// user-facing name is "XGENIA RGS".

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';
import { activeGameFor } from './activeGame';
import { RgsSignInResult, sendSignInCode, verifySignInCode } from './rgsSignIn';

export const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';

// Supabase Auth base for the same project — the email-code sign-in (rgsSignIn.ts).
export const XRGS_AUTH_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/auth/v1';

// Supabase anon key — required by verify_jwt on edge functions.
// This is NOT a secret; it's the publishable key used to pass gateway auth.
export const XRGS_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzdWJ6d3lkcmplbG1qZmtrcmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4ODA3NDcsImV4cCI6MjA4NzQ1Njc0N30.Hewc7WlLZuufC0trhCKKKc4AhLXk7jy7qG3irBQPykY';

const RGS_SETTINGS_KEY = 'xgenia_rgs_settings';
const SELECTED_GAME_KEY = 'xgenia_selected_game';

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
    apikey: XRGS_ANON_KEY,
    Authorization: `Bearer ${XRGS_ANON_KEY}`
  };
}

/** An operator's MODE: demo (play money), live (real money) or internal (platform staff). */
export type OperatorMode = 'demo' | 'live';

/**
 * A GAME's mode — whether real money moves through it. Mirrors the RGS platform's
 * "Mode" field on the Game Library form; distinct from `status`, which is the
 * game's lifecycle rather than its money.
 */
export type GameMode = 'demo' | 'live';

export const GAME_MODES: { value: GameMode; label: string; blurb: string }[] = [
  { value: 'demo', label: 'Demo', blurb: 'Play money. Nothing real is at stake.' },
  { value: 'live', label: 'Live', blurb: 'Real money.' }
];

/**
 * Which modes a game created with this key may have. The connected operator's own
 * mode is the ceiling: a demo key's wallet holds play money, so its games can only
 * be demo, while live and internal keys can create either.
 *
 * An unknown mode (operator-info not loaded, or the key resolved to a platform
 * session) is treated as demo-only — the restrictive read, since the backend and
 * the DB trigger both reject a live game the key isn't entitled to anyway.
 */
export function gameModesForOperatorMode(operatorMode: string | null | undefined): GameMode[] {
  return operatorMode === 'live' || operatorMode === 'internal' ? ['demo', 'live'] : ['demo'];
}

/**
 * May this key EDIT and REDEPLOY an already-deployed component's script (the
 * Maths RGS panel → Deployed Functions → a component → "Deployed script" editor)?
 *
 * Every mode may, as of 2026-08-05. This used to be internal-only, on the reading
 * that overwriting a deployed component is a platform operation rather than an
 * operator one. Two things changed:
 *
 *   * Overwriting is now the ORDINARY path. "Maths Components → Deploy" re-deploys
 *     an edited component into the same Server Version under the same slug, so a
 *     mode gate here meant a demo or live key could deploy a component once and
 *     then never edit it again.
 *   * The server-side gate it mirrored is gone too (maths-deployer's withdrawn
 *     deployed-script write guard). Leaving this one would only make the editor
 *     refuse what the backend now accepts.
 *
 * Scope is enforced by OWNERSHIP instead: maths-deployer's assertGameAccess
 * refuses any game the caller does not own, so a key can only ever reach
 * components of its own games — which is the property that actually matters.
 *
 * Kept as a function rather than inlined so restoring the gate is a one-line
 * change, and so callers keep threading the operator mode they already resolve.
 */
export function canEditDeployedScript(_operatorMode: string | null | undefined): boolean {
  return true;
}

/**
 * Sign in to XGENIA RGS with an email code (see rgsSignIn.ts for why this replaced
 * the self-serve create_operator RPC). The first sign-in creates the studio's own
 * organisation and demo operator; later ones find them again.
 */
const SIGN_IN_ENDPOINTS = { authUrl: XRGS_AUTH_URL, functionsUrl: XRGS_URL, anonKey: XRGS_ANON_KEY };

export function emailSignInCode(email: string): Promise<void> {
  return sendSignInCode(email, SIGN_IN_ENDPOINTS);
}

/** Checks the code, stores the returned key as the editor's connection, and returns it. */
export async function completeEmailSignIn(email: string, code: string): Promise<RgsSignInResult> {
  const result = await verifySignInCode(email, code, SIGN_IN_ENDPOINTS);
  saveRgsSettings(result.apiKey);
  EventDispatcher.instance.emit('rgs.connected', { operatorSlug: result.operatorSlug });
  return result;
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
 * Who is this key? Used by the Maths RGS panel to show the connected operator's
 * name, mode and remaining wallet funds. Returns null when the key resolves to no
 * operator (e.g. a platform session rather than an operator key), so the caller
 * can simply not render the detail line rather than handle an error.
 */
export async function fetchOperatorInfo(apiKey: string): Promise<OperatorInfo | null> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
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
 * lifecycle `status` and money `mode` — the list the Maths RGS panel's game
 * picker shows.
 */
export async function listGames(apiKey: string): Promise<any[]> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
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

/** Format a cents amount for display, e.g. 100000000 → "$1,000,000.00". */
export function formatOperatorFunds(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
  const amount = (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbols[currency] || currency + ' '}${amount}`;
}

export function getRgsSettings(): RgsSettings | null {
  try {
    const settings = localStorage.getItem(RGS_SETTINGS_KEY);
    if (settings) {
      const parsed = JSON.parse(settings);
      if (parsed.apiKey) return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveRgsSettings(settings: RgsSettings | string): void {
  // Merge into whatever is already stored so unrelated fields (activeGame /
  // testSettings, written by the Maths RGS panel via mergeRgsSettings) survive a
  // key re-save. Previously this overwrote the whole object and wiped them.
  let cur: any = {};
  try {
    cur = JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}');
  } catch {
    /* ignore */
  }
  const patch = typeof settings === 'string' ? { apiKey: settings } : { ...settings };
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...cur, ...patch, rgsUrl: XRGS_URL }));
}

export function clearRgsSettings(): void {
  localStorage.removeItem(RGS_SETTINGS_KEY);
  // The active game is stored under the same key, so disconnecting clears the
  // selection too — say so, or a listener keeps showing the old game.
  EventDispatcher.instance.emit('rgs.gameSelected', null);
}

export function isRgsConnected(): boolean {
  return !!getRgsSettings()?.apiKey;
}

/**
 * The game selected in the Maths RGS panel. This is the single source of truth
 * shared by the panel and the Deploy flow: the panel (via __xrgs.setActiveGame)
 * and the AI (via the EditorBridge's xrgs.setActiveGame) both write it through
 * setActiveGame below into `xgenia_rgs_settings.activeGame`, and the Deploy
 * popup reads it here to show the backend target game.
 *
 * Every write MUST go through setActiveGame: it is what emits `rgs.gameSelected`.
 * The Publish popup is always mounted, so a write that skips the event leaves it
 * showing the previous game until it happens to re-render.
 *
 * NOTE: this replaced the old, separate `xgenia_selected_game` key
 * (getSelectedGame/setSelectedGame below), which the panel never actually wrote —
 * so the Deploy flow read a stale leftover value and deployed to the wrong game.
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

/**
 * @deprecated Superseded by getActiveGame/setActiveGame. Kept only so any older
 * code paths still compile; the `xgenia_selected_game` key is no longer written
 * or read by the panel or the Deploy flow.
 */
export function setSelectedGame(game: SelectedGame | null): void {
  if (!game) {
    localStorage.removeItem(SELECTED_GAME_KEY);
  } else {
    localStorage.setItem(SELECTED_GAME_KEY, JSON.stringify(game));
  }
  EventDispatcher.instance.emit('rgs.gameSelected', game);
}

/** @deprecated Use getActiveGame. */
export function getSelectedGame(): SelectedGame | null {
  try {
    const raw = localStorage.getItem(SELECTED_GAME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.id) return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}
