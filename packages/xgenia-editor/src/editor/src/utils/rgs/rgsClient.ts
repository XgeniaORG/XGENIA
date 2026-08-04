// Shared XGENIA RGS connection settings + helpers.
// Single source of truth for the Maths RGS panel and the Deploy flow.
//
// The XRGS endpoint is fixed — users only provide their operator API key
// (generated from the RGS dashboard). "XRGS" is the internal identifier; the
// user-facing name is "XGENIA RGS".

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

export const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';

// PostgREST base for the same project — used to call the create_operator RPC.
export const XRGS_REST_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/rest/v1';

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

/**
 * An operator's MODE — the only thing that decides what its key can reach.
 *
 *   demo     — has a wallet, no real money; sees only the games it created.
 *   live     — the same, with a real-money wallet.
 *   internal — no wallet, superadmin over every game in the platform.
 *
 * Only demo and live can be created from the editor: `internal` is superadmin, so
 * the RGS platform's own Operators page is the only place that grants it (the
 * create_operator RPC rejects it — the editor holds nothing but the public anon
 * key, so this cannot be a UI-only restriction).
 */
export type OperatorMode = 'demo' | 'live';

export const EDITOR_OPERATOR_MODES: { value: OperatorMode; label: string; blurb: string }[] = [
  { value: 'demo', label: 'Demo', blurb: 'Wallet with play money. Sees only the games created with this key.' },
  { value: 'live', label: 'Live', blurb: 'Same as Demo, with a real-money wallet.' }
];

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
 * Maths RGS panel → Components → a component → "Deployed script" editor)?
 *
 * Internal only. A deployed script is the live maths a player's spin executes,
 * and overwriting it has no server-side undo, so hand-editing it is a platform
 * operation: demo and live keys get the same view (API docs + script) read-only.
 * Publishing from the editor is unaffected — that writes a NEW Server Version
 * rather than overwriting an existing component, and every mode may do it.
 *
 * An unknown mode (operator-info not loaded or failed, or the key resolved to a
 * platform session) is treated as NOT allowed — the restrictive read, matching
 * gameModesForOperatorMode. This is the UI half of the rule only: the real gate
 * is in the RGS `maths-deployer` deploy-edge-function handler, which rejects an
 * overwrite from a non-internal key.
 */
export function canEditDeployedScript(operatorMode: string | null | undefined): boolean {
  return operatorMode === 'internal';
}

/**
 * Fields the RGS platform's "New Operator" form collects, so the editor's
 * "Create operator & get key" popup can mirror it exactly.
 *
 * Amounts are in MINOR UNITS (cents), matching the platform and the DB.
 */
export interface CreateOperatorInput {
  name: string;
  slug?: string;
  mode?: OperatorMode;
  currencies?: string[];
  /** Opening wallet balance, in cents. */
  walletBalance?: number;
  maxBet?: number | null;
  maxWin?: number | null;
  allowedIps?: string[];
}

export interface CreateOperatorResult {
  operator_id: string;
  operator_slug: string;
  name: string;
  wallet_mode: string;
  wallet_balance: number;
  supported_currencies: string[];
  api_key: string;
}

/**
 * Self-serve create an operator on XGENIA RGS and get its API key (returned once).
 * Calls the public.create_operator RPC via PostgREST with the anon key: the RPC is
 * SECURITY DEFINER and performs the admin-only operator_connectors insert on the
 * caller's behalf, returning the raw X-Operator-Key. Only the key's SHA-256 hash
 * is stored, so the raw key cannot be retrieved again.
 */
export async function createOperator(input: CreateOperatorInput): Promise<CreateOperatorResult> {
  const res = await fetch(`${XRGS_REST_URL}/rpc/create_operator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: XRGS_ANON_KEY,
      Authorization: `Bearer ${XRGS_ANON_KEY}`
    },
    body: JSON.stringify({
      p_name: input.name,
      p_slug: input.slug || null,
      p_wallet_mode: input.mode || 'demo',
      p_currencies: input.currencies && input.currencies.length ? input.currencies : ['USD'],
      p_wallet_balance: Math.max(0, Math.round(input.walletBalance || 0)),
      p_max_bet: input.maxBet ?? null,
      p_max_win: input.maxWin ?? null,
      p_allowed_ips: input.allowedIps && input.allowedIps.length ? input.allowedIps : null
    })
  });

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }

  if (!res.ok) {
    const msg = (data && (data.message || data.error || data.hint)) || text || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  if (!data || !data.api_key) {
    throw new Error('Operator was created but no key was returned');
  }
  return data as CreateOperatorResult;
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
}

export function isRgsConnected(): boolean {
  return !!getRgsSettings()?.apiKey;
}

/**
 * The game selected in the Maths RGS panel. This is the single source of truth
 * shared by the panel and the Deploy flow: the panel writes it (via __xrgs.
 * setActiveGame → mergeRgsSettings) into `xgenia_rgs_settings.activeGame`, and
 * the Deploy popup reads it here to pre-select the backend target game.
 *
 * NOTE: this replaced the old, separate `xgenia_selected_game` key
 * (getSelectedGame/setSelectedGame below), which the panel never actually wrote —
 * so the Deploy flow read a stale leftover value and deployed to the wrong game.
 */
export function getActiveGame(): SelectedGame | null {
  try {
    const p = JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}');
    if (p?.activeGame?.id) return p.activeGame;
  } catch {
    /* ignore */
  }
  return null;
}

export function setActiveGame(game: SelectedGame | null): void {
  let cur: any = {};
  try {
    cur = JSON.parse(localStorage.getItem(RGS_SETTINGS_KEY) || '{}');
  } catch {
    /* ignore */
  }
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify({ ...cur, activeGame: game || null }));
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
