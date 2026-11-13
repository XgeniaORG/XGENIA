// The XGENIA RGS calls behind the Publish popup's release steps, as plain
// functions: create the game with the numbers certification will hold it to,
// certify it on the server, and download its pre-certification pack.
//
// ── Why the game form asks for RTP, bets and max win ─────────────────────────
// create-game used to receive only a name: the declared RTP (96%), the bet range
// (10–100000) and the max-win cap were whatever the games table defaulted to.
// Certification then judged the maths against a 96% nobody chose, and the stake
// guard refused real bets outside a range nobody chose ("Bet outside allowed
// range"). They are asked once, here, with the defaults shown, so the numbers a
// game is certified and played against are the studio's own.
//
// ── Money ────────────────────────────────────────────────────────────────────
// The form takes bets in MAJOR units (what a person types: 0.20, 100.00) and
// sends integer MINOR units, per currency (XRGS MONEY.md: JPY/KRW have none,
// BHD/KWD have three). No float ever reaches the request.
//
// Every network call takes an injectable fetch so tests/rgs/rgsRelease.test.ts
// runs the whole contract offline.

type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}>;

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'UGX', 'XAF', 'XOF']);
const THREE_DECIMAL = new Set(['BHD', 'KWD', 'OMR', 'JOD', 'TND', 'IQD', 'LYD']);

export function minorUnitsFor(currency: string | null | undefined): number {
  const c = String(currency || 'EUR').toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 0;
  if (THREE_DECIMAL.has(c)) return 3;
  return 2;
}

/**
 * "0.20" → 20 (EUR). Exact decimal parsing, never via a float multiply, so
 * "0.29" is 29 and not 28.999…→28. Returns null for anything that is not a
 * non-negative amount with at most the currency's number of decimals.
 */
export function toMinorUnits(major: string | number, currency: string): number | null {
  const s = String(major ?? '').trim().replace(',', '.');
  const digits = minorUnitsFor(currency);
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > digits) return null;
  const whole = Number(m[1]);
  const fracMinor = digits === 0 ? 0 : Number((frac + '0'.repeat(digits)).slice(0, digits));
  const value = whole * 10 ** digits + fracMinor;
  return Number.isSafeInteger(value) ? value : null;
}

export function formatMinorUnits(minor: number, currency: string): string {
  const digits = minorUnitsFor(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

export const autoSlug = (name: string) =>
  String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export interface ReleaseGameForm {
  name: string;
  /** Declared RTP in percent, as typed. */
  rtp: string;
  /** Major units, as typed. */
  minBet: string;
  maxBet: string;
  /** Max win as a multiple of the stake, as typed. */
  maxWin: string;
}

/** What the form opens with: the project's name and numbers a typical slot launches with. */
export function defaultReleaseGameForm(projectName: string | null | undefined): ReleaseGameForm {
  const name = String(projectName || '').replace(/^__|__$/g, '').trim();
  return { name, rtp: '96', minBet: '0.20', maxBet: '100.00', maxWin: '5000' };
}

export const GAME_FORM_MESSAGES = {
  name: 'Give the game a name.',
  rtp: 'Return to player must be a percentage between 80 and 99.99.',
  minBet: 'Minimum bet must be an amount greater than zero.',
  maxBet: 'Maximum bet must be an amount at least as large as the minimum bet.',
  maxWin: 'Max win must be a whole number of times the stake (at least 1).'
} as const;

/** Why the form cannot be submitted, or '' when it can. */
export function gameFormProblem(form: ReleaseGameForm, currency: string): string {
  if (!String(form.name || '').trim() || !autoSlug(form.name)) return GAME_FORM_MESSAGES.name;
  const rtp = Number(String(form.rtp).replace(',', '.'));
  if (!Number.isFinite(rtp) || rtp < 80 || rtp >= 100) return GAME_FORM_MESSAGES.rtp;
  const min = toMinorUnits(form.minBet, currency);
  if (min === null || min < 1) return GAME_FORM_MESSAGES.minBet;
  const max = toMinorUnits(form.maxBet, currency);
  if (max === null || max < min) return GAME_FORM_MESSAGES.maxBet;
  const mw = Number(form.maxWin);
  if (!Number.isInteger(mw) || mw < 1) return GAME_FORM_MESSAGES.maxWin;
  return '';
}

/** The maths-deployer create-game body for this form. Throws on an invalid form. */
export function createGamePayload(form: ReleaseGameForm, currency: string): Record<string, unknown> {
  const problem = gameFormProblem(form, currency);
  if (problem) throw new Error(problem);
  const name = form.name.trim();
  return {
    action: 'create-game',
    name,
    slug: autoSlug(name),
    description: '',
    // A game starts as play money. Real money is a separate, deliberate step
    // (certify → the platform switches the game to live), never a form field.
    mode: 'demo',
    // Draft keeps the game uploadable: the RGS refuses maths uploads to an Active game.
    status: 'draft',
    declared_rtp: Math.round(Number(String(form.rtp).replace(',', '.')) * 100) / 100,
    min_bet: toMinorUnits(form.minBet, currency),
    max_bet: toMinorUnits(form.maxBet, currency),
    max_win_multiplier: Number(form.maxWin)
  };
}

function parse(text: string): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function call(fetchFn: FetchLike, url: string, headers: Record<string, string>, body: unknown) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error('Could not reach XGENIA RGS. Check your internet connection and try again.');
  }
  const text = await res.text().catch(() => '');
  const data = parse(text);
  if (!res.ok || data?.error) {
    throw new Error(String(data?.error || data?.message || text || `XGENIA RGS answered HTTP ${res.status}.`));
  }
  return data || {};
}

export interface CreatedGame {
  id: string;
  slug: string;
  name: string;
  /**
   * True when a game with this name already existed (and this key owns it): XRGS
   * answers with that game, unchanged, rather than creating a second one. The
   * popup then says "using your existing game" instead of implying its numbers
   * were just set.
   */
  existing: boolean;
}

/** Create the game, and make sure the bet range took even on a server that ignores the new fields. */
export async function createReleaseGame(
  base: { functionsUrl: string; headers: Record<string, string> },
  form: ReleaseGameForm,
  currency: string,
  fetchFn: FetchLike = fetch as any
): Promise<CreatedGame> {
  const payload = createGamePayload(form, currency);
  const data = await call(fetchFn, `${base.functionsUrl}/maths-deployer`, base.headers, payload);
  const id = data.game_id || data.game?.id;
  if (!id) throw new Error('XGENIA RGS created the game but did not say which one. Refresh and pick it from the list.');
  const stored = data.game || {};
  const existing = data.created === false;
  // Older servers ignore min_bet/max_bet on create-game; set-bet-range is the action that
  // has always existed for it. Only called when the echo shows the range did not take —
  // and never on an EXISTING game, whose range is not this form's to rewrite.
  if (!existing && (stored.min_bet !== payload.min_bet || stored.max_bet !== payload.max_bet)) {
    await call(fetchFn, `${base.functionsUrl}/maths-deployer`, base.headers, {
      action: 'set-bet-range',
      game_id: id,
      min_bet: payload.min_bet,
      max_bet: payload.max_bet
    });
  }
  return {
    id,
    slug: data.slug || stored.slug || (payload.slug as string),
    name: stored.name || (payload.name as string),
    existing
  };
}

// ─── Certification ───────────────────────────────────────────────────────────

export type CertificationState = 'none' | 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';

export interface CertificationStatus {
  jobId: string | null;
  status: CertificationState;
  progress: number;
  roundsDone: number;
  roundsTotal: number;
  measuredRtp: number | null;
  declaredRtp: number | null;
  withinTolerance: boolean | null;
  certificateId: string | null;
  quick: boolean;
  message: string;
}

const STATES: CertificationState[] = ['none', 'queued', 'running', 'passed', 'failed', 'cancelled'];

export function toCertificationStatus(raw: any): CertificationStatus {
  const status = STATES.includes(raw?.status) ? (raw.status as CertificationState) : 'none';
  const num = (v: any) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const progress = Math.max(0, Math.min(1, num(raw?.progress) ?? (status === 'passed' || status === 'failed' ? 1 : 0)));
  return {
    jobId: raw?.job_id || null,
    status,
    progress,
    roundsDone: num(raw?.rounds_done) ?? 0,
    roundsTotal: num(raw?.rounds_total) ?? 0,
    measuredRtp: num(raw?.measured_rtp),
    declaredRtp: num(raw?.declared_rtp),
    withinTolerance: typeof raw?.within_tolerance === 'boolean' ? raw.within_tolerance : null,
    certificateId: raw?.certificate_id || null,
    quick: !!raw?.quick,
    message: String(raw?.message || '')
  };
}

/** True while a run is still going and worth polling. */
export function isCertificationActive(s: CertificationStatus): boolean {
  return s.status === 'queued' || s.status === 'running';
}

/**
 * One line for the popup: the server's sentence when it gave one, else our own.
 *
 * Wording rule: this is XGENIA RGS's OWN measurement of a game's return to
 * player — never a laboratory or regulator certificate, and nothing on screen
 * may read as one. A studio with no certifications yet must not be told its
 * game is "certified"; it is "RTP verified on XGENIA RGS", and the lab
 * certificate is a separate step the pre-certification pack prepares for.
 */
export function describeCertification(s: CertificationStatus): { tone: 'idle' | 'busy' | 'good' | 'bad'; text: string } {
  const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}%`);
  if (s.status === 'none') {
    return {
      tone: 'idle',
      text:
        s.message ||
        'RTP not verified yet. Real money needs a passing RTP verification of this exact maths on XGENIA RGS — and, in most markets, a lab certificate as well.'
    };
  }
  if (isCertificationActive(s)) {
    const done = s.roundsTotal ? ` — ${s.roundsDone.toLocaleString()} of ${s.roundsTotal.toLocaleString()} rounds` : '';
    return { tone: 'busy', text: `Verifying the RTP on XGENIA RGS: ${Math.round(s.progress * 100)}%${done}. You can close this window; it keeps running.` };
  }
  if (s.status === 'passed' && s.withinTolerance !== false) {
    const label = s.quick ? 'Preview passed (not a verification)' : 'RTP verified on XGENIA RGS (not a lab certificate)';
    return { tone: 'good', text: s.message || `${label}: pays ${pct(s.measuredRtp)} against a declared ${pct(s.declaredRtp)}.` };
  }
  if (s.status === 'cancelled') return { tone: 'bad', text: s.message || 'The RTP verification was cancelled. Start it again.' };
  return {
    tone: 'bad',
    text:
      s.message ||
      `Pays ${pct(s.measuredRtp)} but declares ${pct(s.declaredRtp)}. Change the maths or the declared RTP, publish, and verify again.`
  };
}

export async function startCertification(
  base: { functionsUrl: string; headers: Record<string, string> },
  gameId: string,
  quick: boolean,
  fetchFn: FetchLike = fetch as any,
  // A play-money sandbox pays Verify RTP with the user's XGENIA credits: the RGS charges them with this token.
  xgeniaToken?: string
): Promise<CertificationStatus> {
  const body: Record<string, unknown> = { action: 'certify-game', game_id: gameId, quick };
  if (xgeniaToken) body.xgenia_token = xgeniaToken;
  const data = await call(fetchFn, `${base.functionsUrl}/rtp-certify`, base.headers, body);
  return toCertificationStatus({ status: 'queued', ...data });
}

export async function fetchCertificationStatus(
  base: { functionsUrl: string; headers: Record<string, string> },
  ref: { jobId?: string | null; gameId?: string | null },
  fetchFn: FetchLike = fetch as any
): Promise<CertificationStatus> {
  const body: Record<string, unknown> = { action: 'certify-status' };
  if (ref.jobId) body.job_id = ref.jobId;
  else if (ref.gameId) body.game_id = ref.gameId;
  else throw new Error('Nothing to check: no certification run and no game.');
  return toCertificationStatus(await call(fetchFn, `${base.functionsUrl}/rtp-certify`, base.headers, body));
}

// ─── Pre-certification pack ──────────────────────────────────────────────────

/** "attachment; filename=\"crash-precert-pack.zip\"" → "crash-precert-pack.zip" */
export function filenameFromDisposition(disposition: string | null | undefined, fallback: string): string {
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(String(disposition || ''));
  const name = m ? decodeURIComponent(m[1]).replace(/[\\/:*?"<>|]+/g, '-').trim() : '';
  return name || fallback;
}

export async function downloadPrecertPack(
  base: { functionsUrl: string; headers: Record<string, string> },
  game: { id: string; slug: string },
  fetchFn: FetchLike = fetch as any
): Promise<{ filename: string; bytes: ArrayBuffer }> {
  let res;
  try {
    res = await fetchFn(`${base.functionsUrl}/compliance-docs`, {
      method: 'POST',
      headers: base.headers,
      body: JSON.stringify({ action: 'pack', game_id: game.id })
    });
  } catch {
    throw new Error('Could not reach XGENIA RGS. Check your internet connection and try again.');
  }
  const type = res.headers?.get('content-type') || '';
  if (!res.ok || /json/i.test(type)) {
    const text = await res.text().catch(() => '');
    const data = parse(text);
    throw new Error(String(data?.error || text || `Could not build the pack (HTTP ${res.status}).`));
  }
  if (!res.arrayBuffer) throw new Error('This editor cannot read a binary download.');
  const bytes = await res.arrayBuffer();
  if (!bytes || bytes.byteLength === 0) throw new Error('XGENIA RGS returned an empty pack.');
  return {
    filename: filenameFromDisposition(res.headers?.get('content-disposition'), `${game.slug || 'game'}-precert-pack.zip`),
    bytes
  };
}
