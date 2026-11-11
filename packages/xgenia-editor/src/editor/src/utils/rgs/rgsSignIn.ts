// Sign in to XGENIA RGS, and come back with an operator key.
//
// Two ways in:
//   - "Sign in with XGENIA" (the customer path, 2026-11-10): startXgeniaRgsSignIn + redeemEditorCode
//     below, the system browser and a loopback redirect. See the section at the bottom of this file.
//   - The emailed 6-digit code (sendSignInCode / verifySignInCode): kept for XGENIA staff, and as the
//     way in when an RGS does not offer Sign in with XGENIA yet.
//
// The play-money sandbox connection (rgs-connect `xgenia-connect` on the test RGS) is gone: there
// are no free XGENIA accounts, every customer is on a paid plan, and the test RGS takes no new
// connections (XRGS docs/XGENIA_RGS_CONTRACT.md §9).
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The Maths RGS panel's self-serve route was "Create operator & get key", which
// POSTed /rest/v1/rpc/create_operator with the public anon key. XRGS revoked that
// RPC from anon in migration 20260917140000 (anyone holding the anon key — it
// ships in every published game — could mint operators), so every new studio got
// "permission denied for function create_operator" and the only way in left was
// to email a platform admin for a key.
//
// XRGS already has the replacement: the `rgs-connect` function issues a studio's
// own operator key to a signed-in user — creating the studio's organisation and a
// demo operator the first time, finding them again after that. Its browser page
// does three plain HTTPS calls; this module does the same three from the editor,
// so sign-in happens in the panel (email → 6-digit code → connected) instead of a
// popup whose postMessage target has to be on an origin allowlist:
//
//   1. POST {auth}/otp     { email, create_user: true }  → a code is emailed
//   2. POST {auth}/verify  { type: 'email', email, token } → a session
//   3. POST {fn}/rgs-connect { action: 'get-key', access_token } → { api_key }
//
// Accounts are invitation-only on XRGS (a trigger on auth.users refuses an
// address that is not on the allowlist), so step 1 failing for a new address is
// the ordinary case for someone who has not been invited. GoTrue reports that as
// a bare 500 "Database error saving new user"; it is translated here into what
// the person can actually do about it.
//
// The fetch function is injectable so the whole exchange is tested without a
// network (tests/rgs/rgsSignIn.test.ts).

export interface RgsSignInEndpoints {
  /** Supabase Auth base, e.g. https://<ref>.supabase.co/auth/v1 */
  authUrl: string;
  /** Edge-function base, e.g. https://<ref>.supabase.co/functions/v1 */
  functionsUrl: string;
  /** The project's publishable anon key (not a secret). */
  anonKey: string;
}

export interface RgsSignInResult {
  apiKey: string;
  operatorSlug: string;
  /** True when this sign-in created the studio's organisation and operator (the email-code path reports it). */
  created?: boolean;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Plain-English messages, exported so the panel and the tests agree on them. */
export const SIGN_IN_MESSAGES = {
  emailRequired: 'Enter your email address.',
  emailInvalid: 'That does not look like an email address.',
  codeRequired: 'Enter the 6-digit code from the email.',
  notInvited:
    'This email has not been invited to XGENIA RGS yet. Ask your XGENIA contact to invite it, then try again.',
  tooMany: 'Too many codes requested. Wait a minute, then try again.',
  badCode: 'That code is wrong or has expired. Request a new code and try again.',
  noKey: 'Signed in, but XGENIA RGS did not return a key. Try again in a moment.',
  sendFailed: 'XGENIA RGS could not send the code just now. Wait a minute, then press Email me a code again.',
  unreachable: 'Could not reach XGENIA RGS. Check your internet connection and try again.'
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

/** Why this email cannot be used, or '' when it can. */
export function emailProblem(email: string): string {
  const e = normaliseEmail(email);
  if (!e) return SIGN_IN_MESSAGES.emailRequired;
  if (!EMAIL_RE.test(e)) return SIGN_IN_MESSAGES.emailInvalid;
  return '';
}

/** Why this code cannot be used, or '' when it can. Codes are digits; spaces are forgiven. */
export function codeProblem(code: string): string {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return SIGN_IN_MESSAGES.codeRequired;
  return '';
}

function parse(text: string): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function serverMessage(body: any, text: string): string {
  return String((body && (body.msg || body.message || body.error_description || body.error)) || text || '').trim();
}

async function post(fetchFn: FetchLike, url: string, body: unknown, headers: Record<string, string>) {
  let res;
  try {
    res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  } catch {
    throw new Error(SIGN_IN_MESSAGES.unreachable);
  }
  const text = await res.text().catch(() => '');
  return { res, body: parse(text), text };
}

/** Step 1: email a 6-digit sign-in code. Throws with a message the person can act on. */
export async function sendSignInCode(email: string, ep: RgsSignInEndpoints, fetchFn: FetchLike = fetch as any): Promise<void> {
  const problem = emailProblem(email);
  if (problem) throw new Error(problem);
  const { res, body, text } = await post(
    fetchFn,
    `${ep.authUrl}/otp`,
    { email: normaliseEmail(email), create_user: true },
    { apikey: ep.anonKey }
  );
  if (res.ok) return;
  const msg = serverMessage(body, text);
  if (res.status === 429) throw new Error(SIGN_IN_MESSAGES.tooMany);
  // The invitation trigger refuses the auth.users insert; GoTrue answers 500
  // "Database error saving new user" (sometimes 422 "Signups not allowed").
  // Only THAT is "not invited". Every other 5xx used to be reported the same way, so an invited,
  // existing account whose code email failed to send was told it had not been invited (2026-11-10).
  if (/saving new user|signups? not allowed/i.test(msg)) {
    throw new Error(SIGN_IN_MESSAGES.notInvited);
  }
  if (res.status >= 500) throw new Error(SIGN_IN_MESSAGES.sendFailed);
  throw new Error(msg || `Could not send a code (HTTP ${res.status}).`);
}

/** What the email sign-in may ask the person while it runs (each resolves null when they cancel). */
export interface EmailSignInQuestions {
  /** Several studios: which one this editor publishes to (XRGS I-191). */
  chooseStudio?: (studios: RgsStudio[]) => Promise<string | null>;
  /**
   * Two-factor sign-in (XRGS I-177..I-182): the 6-digit code from their authenticator app. `problem` is
   * null the first time and says why when asked again (a wrong code).
   */
  askSecondFactor?: (problem: string | null) => Promise<string | null>;
}

export const SECOND_FACTOR_MESSAGES = {
  enrol:
    'XGENIA RGS needs two-factor sign-in on every account, and this one has no authenticator app yet. ' +
    'Add one at https://rgs.xgenia.app/setup-two-factor (sign in there with this email), then sign in here again.',
  wrongCode: 'That authenticator code is wrong or has expired. Enter the current 6-digit code.',
  tooManyTries: 'Three wrong authenticator codes. Request a new email code and start again.'
} as const;

/**
 * Steps 2 + 3: check the code, then exchange the session for the studio's operator key.
 *
 * A person in several studios gets 409 CHOOSE_STUDIO with the list. `chooseStudio` asks them which one
 * (null = they cancelled) and the key is asked for again with `studio_slug`, on the same signed-in
 * session — XRGS I-191. Without it they were told to start over with Sign in with XGENIA: signed in,
 * and still refused.
 */
export async function verifySignInCode(
  email: string,
  code: string,
  ep: RgsSignInEndpoints,
  fetchFn: FetchLike = fetch as any,
  ask: EmailSignInQuestions = {}
): Promise<RgsSignInResult> {
  const { chooseStudio, askSecondFactor } = ask;
  const eProblem = emailProblem(email);
  if (eProblem) throw new Error(eProblem);
  const cProblem = codeProblem(code);
  if (cProblem) throw new Error(cProblem);

  const verified = await post(
    fetchFn,
    `${ep.authUrl}/verify`,
    { type: 'email', email: normaliseEmail(email), token: String(code).replace(/\s+/g, '') },
    { apikey: ep.anonKey }
  );
  const accessToken = verified.body?.access_token || verified.body?.session?.access_token;
  if (!verified.res.ok || !accessToken) {
    if (verified.res.status === 429) throw new Error(SIGN_IN_MESSAGES.tooMany);
    throw new Error(SIGN_IN_MESSAGES.badCode);
  }

  let token: string = accessToken;
  const getKey = (studioSlug?: string) =>
    post(
      fetchFn,
      `${ep.functionsUrl}/rgs-connect`,
      { action: 'get-key', access_token: token, ...(studioSlug ? { studio_slug: studioSlug } : {}) },
      { apikey: ep.anonKey, Authorization: `Bearer ${ep.anonKey}` }
    );
  let keyed = await getKey();
  // Two-factor sign-in: the emailed code is the first factor; the authenticator app is the second.
  if (keyed.res.status === 403 && keyed.body?.code === 'MFA_ENROLL_REQUIRED') throw new Error(SECOND_FACTOR_MESSAGES.enrol);
  if (keyed.res.status === 403 && keyed.body?.code === 'MFA_REQUIRED' && askSecondFactor) {
    token = await completeSecondFactor(token, ep, fetchFn, askSecondFactor);
    keyed = await getKey();
    if (keyed.res.status === 403 && keyed.body?.code === 'MFA_ENROLL_REQUIRED') throw new Error(SECOND_FACTOR_MESSAGES.enrol);
  }
  if (keyed.res.status === 409 && keyed.body?.code === 'CHOOSE_STUDIO' && chooseStudio) {
    const studios: RgsStudio[] = (Array.isArray(keyed.body?.studios) ? keyed.body.studios : [])
      .filter((s: any) => s && typeof s.slug === 'string' && s.slug)
      .map((s: any) => ({ slug: String(s.slug), name: String(s.name || s.slug) }));
    if (studios.length > 0) {
      const slug = await chooseStudio(studios);
      if (!slug) throw new XgeniaRgsSignInError('CANCELLED', 'Sign-in cancelled.');
      keyed = await getKey(slug);
    }
  }
  if (!keyed.res.ok) {
    throw new Error(serverMessage(keyed.body, keyed.text) || `XGENIA RGS refused the sign-in (HTTP ${keyed.res.status}).`);
  }
  const apiKey = keyed.body?.api_key;
  if (!apiKey) throw new Error(SIGN_IN_MESSAGES.noKey);
  return {
    apiKey,
    operatorSlug: String(keyed.body?.operator_slug || ''),
    created: /new rgs connection/i.test(String(keyed.body?.message || ''))
  };
}

/**
 * The second factor, through the RGS's own sign-in service (GoTrue): the account's verified authenticator
 * factor, a challenge, and the person's 6-digit code. Returns the two-factor session's access token.
 * Up to three codes; a cancel or a missing factor ends it.
 */
async function completeSecondFactor(
  firstFactorToken: string,
  ep: RgsSignInEndpoints,
  fetchFn: FetchLike,
  askSecondFactor: (problem: string | null) => Promise<string | null>
): Promise<string> {
  const auth = { apikey: ep.anonKey, Authorization: `Bearer ${firstFactorToken}` };
  let userRes;
  try {
    userRes = await fetchFn(`${ep.authUrl}/user`, { method: 'GET', headers: auth });
  } catch {
    throw new Error(SIGN_IN_MESSAGES.unreachable);
  }
  const user = parse(await userRes.text().catch(() => ''));
  const factor = (Array.isArray(user?.factors) ? user.factors : []).find(
    (f: any) => f && f.status === 'verified' && (f.factor_type === 'totp' || !f.factor_type)
  );
  if (!userRes.ok || !factor?.id) throw new Error(SECOND_FACTOR_MESSAGES.enrol);

  let problem: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await askSecondFactor(problem);
    if (!code) throw new XgeniaRgsSignInError('CANCELLED', 'Sign-in cancelled.');
    const clean = String(code).replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) { problem = SECOND_FACTOR_MESSAGES.wrongCode; attempt--; continue; }
    const challenge = await post(fetchFn, `${ep.authUrl}/factors/${factor.id}/challenge`, {}, auth);
    if (!challenge.res.ok || !challenge.body?.id) {
      throw new Error(serverMessage(challenge.body, challenge.text) || 'XGENIA RGS could not start the two-factor check. Try again.');
    }
    const verified = await post(fetchFn, `${ep.authUrl}/factors/${factor.id}/verify`, { challenge_id: challenge.body.id, code: clean }, auth);
    const secondToken = verified.body?.access_token || verified.body?.session?.access_token;
    if (verified.res.ok && secondToken) return String(secondToken);
    if (verified.res.status === 429) throw new Error(SIGN_IN_MESSAGES.tooMany);
    problem = SECOND_FACTOR_MESSAGES.wrongCode;
  }
  throw new Error(SECOND_FACTOR_MESSAGES.tooManyTries);
}

// ─── Sign in with XGENIA (the system browser + a loopback redirect) ───────────
//
// Owner decision 2026-11-10: one RGS for customers (the production XGENIA RGS), one login (the
// XGENIA account). The editor connects the way desktop apps do OAuth (RFC 8252, loopback redirect;
// XRGS docs/XGENIA_RGS_CONTRACT.md §9):
//
//   1. the main process listens on http://127.0.0.1:<free port>/xgenia-rgs for one request
//      (src/main/src/xgenia-rgs-loopback.js). Its redirect carries `?state=<128 random bits>`, which
//      the RGS keeps when it adds the code; an answer without that state is refused there, so a web
//      page that finds the port cannot hand the editor a code for an account of its own choosing;
//   2. POST {fn}/xgenia-auth { action: 'start', purpose: 'editor', editor_redirect, install_label }
//      → { authorize_url }                                           — startXgeniaRgsSignIn
//   3. the person signs in at XGENIA in their own browser, which comes back to the loopback with
//      ?code=<one-time code> or ?error=<CODE>&message=<text>;
//   4. POST {fn}/xgenia-auth { action: 'editor-redeem', code, studio_slug? }
//      → { api_key, operator_slug, studio }                           — redeemEditorCode
//
// Only the code travels through the browser; the key comes back over HTTPS to the editor.
// A person in several studios gets 409 CHOOSE_STUDIO with the list, and the code is NOT spent: the
// editor asks them and redeems again with their choice. It never guesses.

/** XGENIA RGS's edge functions, and the publishable key that passes its gateway. */
export interface XgeniaRgsEndpoints {
  functionsUrl: string;
  anonKey: string;
}

export interface RgsStudio {
  name: string;
  slug: string;
}

export interface XgeniaRgsSignInResult extends RgsSignInResult {
  studio: RgsStudio | null;
}

export type EditorRedeemOutcome =
  | { kind: 'connected'; result: XgeniaRgsSignInResult }
  | { kind: 'choose-studio'; studios: RgsStudio[] };

/** Where XGENIA's plans are, for a person with none. */
export const XGENIA_PRICING_URL = 'https://primora.xgenia.com/pricing';

/**
 * What each refusal means for the person, by the code XGENIA RGS (or the loopback) answers with.
 * Exported so the panel and the tests agree on them.
 */
export const XGENIA_RGS_MESSAGES = {
  // This RGS has no Sign in with XGENIA yet (xgenia-auth not deployed: 404, or 503 NOT_CONFIGURED).
  NOT_AVAILABLE: 'Sign in with XGENIA is not available on this RGS yet. XGENIA staff can sign in with email below.',
  // Always ours, never the server's text: the RGS is part of every paid plan, there is no free use.
  NO_PLAN: `XGENIA RGS comes with every paid XGENIA plan, and this XGENIA account has none right now. Upgrade at ${XGENIA_PRICING_URL}, then press Sign in with XGENIA again.`,
  ASK_STUDIO_ADMIN: "Your company's XGENIA RGS studio is already open. Ask its admin to invite you from the studio's Team page, then sign in again.",
  OWNER_FIRST: "Your company's XGENIA RGS studio has not been opened yet. Your XGENIA account owner opens it by signing in with XGENIA, then invites you.",
  LINK_FROM_ACCOUNT: 'This email already has an XGENIA RGS account. Sign in with email, then choose "Link XGENIA" in the RGS, so only you can connect it.',
  EMAIL_UNVERIFIED: 'Confirm your email address in XGENIA first, then sign in again.',
  SIGN_IN_REFUSED: 'XGENIA RGS refused this sign-in. Contact XGENIA support.',
  XGENIA_UNAVAILABLE: 'XGENIA could not confirm your sign-in just now. Wait a minute, then try again.',
  CODE_INVALID: 'This sign-in expired or was already used. Press Sign in with XGENIA again.',
  VIEWER_ONLY: "Your role in this studio can view it but not publish. Ask your studio's admin for a role that can.",
  NO_STUDIO: "Your account is not in an XGENIA RGS studio yet. Ask your studio's admin to invite you.",
  STUDIO_FROZEN: 'This studio is frozen, or its plan has ended. Contact XGENIA support.',
  NO_CONNECTION: 'Your studio has no XGENIA RGS connection for the editor yet. Contact XGENIA support.',
  NOT_YOUR_STUDIO: 'You are not a member of that studio. Pick one of your own studios.',
  TIMEOUT: 'The sign-in was not finished within 5 minutes. Press Sign in with XGENIA to try again.',
  CANCELLED: 'Sign-in cancelled.',
  LOOPBACK_FAILED: 'The editor could not receive the answer from your browser. Press Sign in with XGENIA to try again.',
  NOT_DESKTOP: 'Sign in with XGENIA needs the XGENIA desktop app.',
  BROWSER_FAILED: 'Could not open your browser. Check that a default browser is set, then try again.',
  NO_SIGN_IN_URL: 'XGENIA RGS did not return a sign-in page. Try again in a moment.',
  NO_STUDIO_CHOSEN: 'XGENIA RGS asked again which studio to use. Press Sign in with XGENIA and pick one.'
} as const;

export type XgeniaRgsErrorCode = keyof typeof XGENIA_RGS_MESSAGES | string;

/** A refusal with the code it came with, so the panel can act on it (e.g. offer email, link to plans). */
export class XgeniaRgsSignInError extends Error {
  readonly code: XgeniaRgsErrorCode;
  constructor(code: XgeniaRgsErrorCode, message: string) {
    super(message);
    this.name = 'XgeniaRgsSignInError';
    this.code = code;
  }
}

/**
 * The words for a refusal. The server's own message is shown verbatim when it gave one (it can name
 * the studio, its admin, or why a studio is frozen), except NO_PLAN, which is always ours: it must
 * say the RGS comes with every paid plan and where to upgrade.
 */
export function xgeniaRgsRefusalMessage(code: string, serverText?: string): string {
  const own = (XGENIA_RGS_MESSAGES as Record<string, string>)[code];
  if (code === 'NO_PLAN') return XGENIA_RGS_MESSAGES.NO_PLAN;
  const said = String(serverText || '').trim();
  if (said) return said;
  return own || `XGENIA RGS refused the sign-in (${code || 'unknown reason'}).`;
}

function refusal(code: string, serverText?: string): XgeniaRgsSignInError {
  return new XgeniaRgsSignInError(code, xgeniaRgsRefusalMessage(code, serverText));
}

const LOOPBACK_REDIRECT_RE = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/\S*$/;

function gatewayHeaders(ep: XgeniaRgsEndpoints): Record<string, string> {
  return ep.anonKey ? { apikey: ep.anonKey, Authorization: `Bearer ${ep.anonKey}` } : {};
}

/** Step 2: ask XGENIA RGS for the page the person signs in on. */
export async function startXgeniaRgsSignIn(
  req: { editorRedirect: string; installLabel: string },
  ep: XgeniaRgsEndpoints,
  fetchFn: FetchLike = fetch as any
): Promise<{ authorizeUrl: string }> {
  if (!LOOPBACK_REDIRECT_RE.test(String(req.editorRedirect || ''))) {
    // Only a loopback address can receive the code; the RGS refuses anything else anyway.
    throw new XgeniaRgsSignInError('LOOPBACK_FAILED', XGENIA_RGS_MESSAGES.LOOPBACK_FAILED);
  }
  const { res, body, text } = await post(
    fetchFn,
    `${ep.functionsUrl}/xgenia-auth`,
    {
      action: 'start',
      purpose: 'editor',
      editor_redirect: req.editorRedirect,
      install_label: String(req.installLabel || '').slice(0, 200)
    },
    gatewayHeaders(ep)
  );
  // Not deployed on this RGS (404), or deployed but not set up (503 NOT_CONFIGURED): not the person's fault,
  // and the email sign-in is the way in until it is.
  if (res.status === 404 || body?.code === 'NOT_CONFIGURED') {
    throw new XgeniaRgsSignInError('NOT_AVAILABLE', XGENIA_RGS_MESSAGES.NOT_AVAILABLE);
  }
  if (!res.ok) {
    const code = String(body?.code || '');
    if (code) throw refusal(code, body?.error || body?.message);
    throw new XgeniaRgsSignInError('START_FAILED', serverMessage(body, text) || `XGENIA RGS could not start the sign-in (HTTP ${res.status}).`);
  }
  const authorizeUrl = String(body?.authorize_url || '');
  if (!/^https?:\/\//i.test(authorizeUrl)) throw new XgeniaRgsSignInError('NO_SIGN_IN_URL', XGENIA_RGS_MESSAGES.NO_SIGN_IN_URL);
  return { authorizeUrl };
}

/**
 * Step 4: exchange the one-time code for this install's key. With several studios and no
 * `studioSlug`, answers 'choose-studio' with the list (the code is not spent): ask, then call again.
 */
export async function redeemEditorCode(
  code: string,
  ep: XgeniaRgsEndpoints,
  fetchFn: FetchLike = fetch as any,
  studioSlug?: string
): Promise<EditorRedeemOutcome> {
  const oneTime = String(code || '').trim();
  if (!oneTime) throw refusal('CODE_INVALID');
  const payload: Record<string, string> = { action: 'editor-redeem', code: oneTime };
  if (studioSlug) payload.studio_slug = studioSlug;
  const { res, body, text } = await post(fetchFn, `${ep.functionsUrl}/xgenia-auth`, payload, gatewayHeaders(ep));

  if (res.status === 409 && body?.code === 'CHOOSE_STUDIO') {
    const studios: RgsStudio[] = (Array.isArray(body?.studios) ? body.studios : [])
      .filter((s: any) => s && typeof s.slug === 'string' && s.slug)
      .map((s: any) => ({ name: String(s.name || s.slug), slug: String(s.slug) }));
    // Asked to choose with nothing to choose from: refuse rather than guess.
    if (studios.length === 0) throw refusal('NO_STUDIO', body?.error);
    return { kind: 'choose-studio', studios };
  }
  if (res.status === 404) throw new XgeniaRgsSignInError('NOT_AVAILABLE', XGENIA_RGS_MESSAGES.NOT_AVAILABLE);
  if (!res.ok) {
    const refusedCode = String(body?.code || '');
    if (refusedCode) throw refusal(refusedCode, body?.error || body?.message);
    throw new XgeniaRgsSignInError('REDEEM_FAILED', serverMessage(body, text) || `XGENIA RGS refused the sign-in (HTTP ${res.status}).`);
  }
  const apiKey = body?.api_key;
  if (!apiKey) throw new Error(SIGN_IN_MESSAGES.noKey);
  const studio = body?.studio && typeof body.studio.slug === 'string'
    ? { name: String(body.studio.name || body.studio.slug), slug: String(body.studio.slug) }
    : null;
  return {
    kind: 'connected',
    result: { apiKey: String(apiKey), operatorSlug: String(body?.operator_slug || ''), studio }
  };
}
