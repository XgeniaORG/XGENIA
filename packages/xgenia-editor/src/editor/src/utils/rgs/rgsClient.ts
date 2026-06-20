// Shared XGENIA RGS connection settings + helpers.
// Single source of truth for the Maths RGS panel and the Deploy flow.
//
// The XRGS endpoint is fixed — users only provide their operator API key
// (generated from the RGS dashboard). "XRGS" is the internal identifier; the
// user-facing name is "XGENIA RGS".

import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

export const XRGS_URL = 'https://usubzwydrjelmjfkkrhi.supabase.co/functions/v1';

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
  const s =
    typeof settings === 'string'
      ? { apiKey: settings, rgsUrl: XRGS_URL }
      : { ...settings, rgsUrl: XRGS_URL };
  localStorage.setItem(RGS_SETTINGS_KEY, JSON.stringify(s));
}

export function clearRgsSettings(): void {
  localStorage.removeItem(RGS_SETTINGS_KEY);
}

export function isRgsConnected(): boolean {
  return !!getRgsSettings()?.apiKey;
}

/** Persist the game chosen in the Maths RGS panel so the Deploy flow can read it. */
export function setSelectedGame(game: SelectedGame | null): void {
  if (!game) {
    localStorage.removeItem(SELECTED_GAME_KEY);
  } else {
    localStorage.setItem(SELECTED_GAME_KEY, JSON.stringify(game));
  }
  EventDispatcher.instance.emit('rgs.gameSelected', game);
}

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
