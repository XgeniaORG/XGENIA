// The release steps the Publish popup used to send people away for.
//
// Publish → XGENIA used to stop at "Not connected to XGENIA RGS. Connect in the
// Maths RGS panel first." and "No game selected. Select one in the Maths RGS
// panel first." — while the Maths panel hid both controls behind "Show all
// tools". A studio pressing Publish had nowhere to go. Everything a release needs
// now happens here, in order, and each step disappears once it is done:
//
//   1. Sign in   — "Sign in with XGENIA" in the system browser (rgsClient
//                  connectWithXgeniaRgs). The first sign-in opens the studio's demo
//                  space on XGENIA RGS; there is no key to paste. The email code stays
//                  as a small link for XGENIA staff.
//   2. Game      — pick one of the studio's games, or create one with the numbers
//                  certification and the stake guard will hold it to (rgsRelease.ts).
//   3. Publish   — the popup's own Publish button (deploys changed maths first).
//   4. Certify   — RgsCertifyPanel below: one button, progress that survives
//                  closing the popup, and the pre-certification pack download.
//
// This is the only release surface: the Maths panel's old manual tools (paste a
// key, game picker, Server Versions, Deploy) are gone.

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import {
  rgsFunctionsUrl,
  cancelXgeniaRgsSignIn,
  clearRgsSettings,
  completeEmailSignIn,
  connectWithXgeniaRgs,
  emailSignInCode,
  fetchOperatorInfo,
  gameVersionsUrl,
  getActiveGame,
  getRgsSettings,
  isSandboxConnection,
  listGames,
  rememberGameDeclaration,
  rememberedGameDeclaration,
  rgsHeaders,
  setActiveGame,
  SelectedGame,
  XgeniaRgsSignInStep,
  xgeniaAccessToken
} from '@xgenia-utils/rgs/rgsClient';
import { emailProblem, codeProblem, RgsStudio, XGENIA_PRICING_URL } from '@xgenia-utils/rgs/rgsSignIn';
import {
  CertificationStatus,
  createReleaseGame,
  defaultReleaseGameForm,
  describeCertification,
  downloadPrecertPack,
  fetchCertificationStatus,
  gameFormProblem,
  isCertificationActive,
  ReleaseGameForm,
  startCertification
} from '@xgenia-utils/rgs/rgsRelease';
import { MATHS_DEPLOYED_ELSEWHERE } from '@xgenia-utils/rgs/mathsDeployState';
import { isMeasurementTwin } from '@xgenia-utils/rgs/activeGame';

/** What a play-money sandbox's Verify RTP costs: one credit, EUR 0.25 (XGENIA rtp_verify_price, migration 20261104210000). */
const VERIFY_RTP_SANDBOX_CREDITS = 1;
const creditsText = (n: number) => `${n} credit${n === 1 ? '' : 's'}`;

const STEP_STYLE: React.CSSProperties = {
  padding: '10px 12px',
  marginBottom: '12px',
  borderRadius: '6px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.10)'
};
const STEP_TITLE: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#e8e8ec', marginBottom: '6px' };
const HINT: React.CSSProperties = { fontSize: '11px', lineHeight: 1.5, color: '#a0a0b0', marginBottom: '8px' };
const ERROR: React.CSSProperties = { fontSize: '12px', color: '#f66', marginTop: '6px' };
const LINK: React.CSSProperties = { fontSize: '11px', color: '#67DE92', cursor: 'pointer', userSelect: 'none' };
const ROW: React.CSSProperties = { display: 'flex', gap: '8px' };

function base(apiKey: string) {
  return { functionsUrl: rgsFunctionsUrl(), headers: rgsHeaders(apiKey) };
}

// ─── Step 1: sign in ──────────────────────────────────────────────────────────

/**
 * `start`: 'xgenia' opens on "Sign in with XGENIA" (the customer path, 2026-11-10); 'email' opens straight on the
 * email-code sign-in, which is for XGENIA staff and for an RGS that does not offer Sign in with XGENIA yet.
 * Nothing connects by itself: Sign in with XGENIA opens the person's browser, which only a click should do.
 */
export function RgsSignInForm({ onSignedIn, start = 'xgenia' }: { onSignedIn?: () => void; start?: 'xgenia' | 'email' }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'xgenia' | 'email'>(start);

  // Sign in with XGENIA: idle → the browser → (a studio to pick) → connected, or an error to act on.
  const [step, setStep] = useState<XgeniaRgsSignInStep | 'idle' | 'choose-studio'>('idle');
  const [xgeniaError, setXgeniaError] = useState<{ code: string; message: string } | null>(null);
  const [studios, setStudios] = useState<RgsStudio[]>([]);
  const pickStudio = useRef<((slug: string | null) => void) | null>(null);
  const live = useRef(true);
  // Only the form that started a sign-in may stop it: Publish can mount two of these (main view, Real money view).
  const signingIn = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      // Closing Publish mid-sign-in closes the loopback too, and answers a pending studio question.
      pickStudio.current?.(null);
      if (signingIn.current) cancelXgeniaRgsSignIn();
    };
  }, []);

  // Several studios: ask which one, on either sign-in path (XRGS I-191). Resolves null when cancelled.
  const askWhichStudio = (list: RgsStudio[]) =>
    new Promise<string | null>((resolve) => {
      if (!live.current) return resolve(null);
      pickStudio.current = (slug) => { pickStudio.current = null; resolve(slug); };
      setStudios(list);
      setStep('choose-studio');
    });
  const studioPicker = (onCancel: () => void) => (
    <>
      <div style={HINT}>You are in more than one studio. Which one is this editor publishing for?</div>
      <div style={{ display: 'grid', gap: '6px', marginBottom: '8px' }}>
        {studios.map((st) => (
          <PrimaryButton
            key={st.slug}
            label={st.name}
            variant={PrimaryButtonVariant.MutedOnLowBg}
            size={PrimaryButtonSize.Small}
            onClick={() => pickStudio.current?.(st.slug)}
            isGrowing
          />
        ))}
      </div>
      <PrimaryButton label="Cancel" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={onCancel} />
    </>
  );

  const signInWithXgenia = () => {
    setXgeniaError(null);
    setStep('opening-browser');
    signingIn.current = true;
    connectWithXgeniaRgs({
      onStep: (s) => { if (live.current) setStep(s); },
      chooseStudio: askWhichStudio
    })
      .then(() => { signingIn.current = false; if (live.current) { setStep('idle'); onSignedIn?.(); } })
      .catch((e: any) => {
        signingIn.current = false;
        if (!live.current) return;
        setStep('idle');
        setStudios([]);
        const code = String(e?.code || '');
        if (code === 'CANCELLED') return; // the person's own choice: nothing to explain
        setXgeniaError({ code, message: e?.message || String(e) });
      });
  };
  const cancelXgenia = () => {
    if (pickStudio.current) pickStudio.current(null);
    else cancelXgeniaRgsSignIn();
  };

  if (mode === 'xgenia') {
    const working = step !== 'idle';
    const notAvailable = xgeniaError?.code === 'NOT_AVAILABLE';
    return (
      <div style={STEP_STYLE} data-guide="rgs-sign-in">
        <div style={STEP_TITLE}>1 · Sign in to XGENIA RGS</div>
        {step === 'choose-studio' ? (
          studioPicker(cancelXgenia)
        ) : working ? (
          <>
            <div style={HINT}>
              {step === 'connecting'
                ? 'Connecting your studio…'
                : step === 'waiting-for-browser'
                  ? 'Finish signing in in your browser, then come back here.'
                  : 'Opening your browser…'}
            </div>
            <PrimaryButton label="Cancel" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={cancelXgenia} isDisabled={step === 'connecting'} />
          </>
        ) : (
          <>
            <div style={HINT}>
              Sign in with your XGENIA account in your browser. XGENIA RGS comes with every paid XGENIA plan; your
              studio’s demo space opens the first time you sign in.
            </div>
            <div style={ROW}>
              <PrimaryButton label="Sign in with XGENIA" size={PrimaryButtonSize.Small} onClick={signInWithXgenia} />
            </div>
          </>
        )}
        {xgeniaError && (
          <div style={ERROR}>
            {xgeniaError.message}
            {xgeniaError.code === 'NO_PLAN' && (
              <>
                {' '}
                <a href={XGENIA_PRICING_URL} target="_blank" rel="noopener noreferrer" style={{ ...LINK, textDecoration: 'none' }}>
                  See XGENIA plans
                </a>
              </>
            )}
          </div>
        )}
        <div
          style={{ ...LINK, marginTop: '8px', fontSize: notAvailable ? '12px' : '11px' }}
          onClick={() => { if (!working) { setMode('email'); setError(''); } }}
        >
          Sign in with email (XGENIA staff)
        </div>
      </div>
    );
  }

  const send = async () => {
    const problem = emailProblem(email);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await emailSignInCode(email);
      setCodeSent(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const problem = codeProblem(code);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      await completeEmailSignIn(email, code, askWhichStudio);
      onSignedIn?.();
    } catch (e: any) {
      if (String(e?.code || '') !== 'CANCELLED') setError(e?.message || String(e));
    } finally {
      setStep('idle');
      setStudios([]);
      setBusy(false);
    }
  };

  return (
    <div style={STEP_STYLE} data-guide="rgs-sign-in">
      <div style={STEP_TITLE}>1 · Sign in to XGENIA RGS with email</div>
      {step === 'choose-studio' ? (
        studioPicker(() => pickStudio.current?.(null))
      ) : !codeSent ? (
        <>
          <div style={HINT}>For XGENIA staff and invited RGS accounts: we email you a 6-digit code.</div>
          <TextInput
            label="Email"
            value={email}
            placeholder="you@studio.com"
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            onEnter={send}
            isAutoFocus
            hasBottomSpacing
          />
          <PrimaryButton label={busy ? 'Sending…' : 'Email me a code'} onClick={send} isDisabled={busy} size={PrimaryButtonSize.Small} />
        </>
      ) : (
        <>
          <div style={HINT}>Enter the code sent to {email.trim()}.</div>
          <TextInput
            label="6-digit code"
            value={code}
            placeholder="123456"
            onChange={(e) => { setCode(e.target.value); setError(''); }}
            onEnter={verify}
            isAutoFocus
            hasBottomSpacing
          />
          <div style={ROW}>
            <PrimaryButton label={busy ? 'Signing in…' : 'Sign in'} onClick={verify} isDisabled={busy} size={PrimaryButtonSize.Small} />
            <PrimaryButton
              label="Use another email"
              variant={PrimaryButtonVariant.Ghost}
              size={PrimaryButtonSize.Small}
              onClick={() => { setCodeSent(false); setCode(''); setError(''); }}
              isDisabled={busy}
            />
          </div>
        </>
      )}
      {error && <div style={ERROR}>{error}</div>}
      <div style={{ ...LINK, marginTop: '8px' }} onClick={() => { if (!busy) { setMode('xgenia'); setError(''); } }}>
        Sign in with XGENIA instead
      </div>
    </div>
  );
}

// ─── Step 2: choose or create the game ────────────────────────────────────────

function GameStep({ projectName, onChosen }: { projectName: string; onChosen: () => void }) {
  const apiKey = getRgsSettings()?.apiKey || '';
  const [games, setGames] = useState<any[] | null>(null);
  const [currency, setCurrency] = useState('EUR');
  const [creating, setCreating] = useState(false);
  // The declaration this project already made (e.g. on its sandbox) opens the form, so moving to a
  // real-money account is: check the numbers, Create game, Publish (rgsClient: rememberGameDeclaration).
  const [carried] = useState(() => {
    const d = rememberedGameDeclaration();
    return d && d.fromSandbox && !isSandboxConnection() ? d : null;
  });
  const [form, setForm] = useState<ReleaseGameForm>(() => {
    const d = rememberedGameDeclaration();
    return d ? { name: d.name, rtp: d.rtp, minBet: d.minBet, maxBet: d.maxBet, maxWin: d.maxWin } : defaultReleaseGameForm(projectName);
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!apiKey) return;
    listGames(apiKey)
      .then((list) => { if (alive) { setGames(list); if (list.length === 0) setCreating(true); } })
      .catch((e) => { if (alive) { setGames([]); setCreating(true); setError(e?.message || String(e)); } });
    fetchOperatorInfo(apiKey)
      .then((info) => { if (alive && info?.currency) setCurrency(info.currency); })
      .catch(() => { /* EUR is the platform currency; the form still works */ });
    return () => { alive = false; };
  }, [apiKey]);

  const choose = (g: any) => {
    setActiveGame({ id: g.id, slug: g.slug, name: g.name });
    onChosen();
  };

  const create = async () => {
    const problem = gameFormProblem(form, currency);
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const g = await createReleaseGame(base(apiKey), form, currency);
      rememberGameDeclaration(form);
      setActiveGame({ id: g.id, slug: g.slug, name: g.name });
      onChosen();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof ReleaseGameForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setError('');
  };

  return (
    <div style={STEP_STYLE} data-guide="rgs-game">
      <div style={STEP_TITLE}>2 · Which game is this?</div>
      {games === null ? (
        <div style={HINT}>Loading your games…</div>
      ) : !creating ? (
        <>
          <div style={HINT}>Pick the game this project publishes, or create a new one.</div>
          <div style={{ display: 'grid', gap: '6px', marginBottom: '8px' }}>
            {games.filter((g) => !isMeasurementTwin(g)).map((g) => (
              <PrimaryButton key={g.id} label={g.name} variant={PrimaryButtonVariant.MutedOnLowBg} size={PrimaryButtonSize.Small} onClick={() => choose(g)} isGrowing />
            ))}
          </div>
          <span style={LINK} onClick={() => setCreating(true)}>+ Create a new game</span>
        </>
      ) : (
        <>
          {carried && (
            <div style={HINT}>
              Brought over from your play-money sandbox. Check the numbers and press Create game: Publish then
              deploys the same maths and page here, and Verify RTP measures it for real money.
            </div>
          )}
          <div style={HINT}>
            These are the numbers your game is verified and played against. Bets are in {currency}; max win is a multiple of the stake.
          </div>
          <TextInput label="Game name" value={form.name} onChange={set('name')} hasBottomSpacing isAutoFocus />
          <div style={ROW}>
            <TextInput label="Return to player" value={form.rtp} onChange={set('rtp')} suffix="%" hasBottomSpacing />
            <TextInput label="Max win" value={form.maxWin} onChange={set('maxWin')} suffix="× stake" hasBottomSpacing />
          </div>
          <div style={ROW}>
            <TextInput label="Min bet" value={form.minBet} onChange={set('minBet')} suffix={currency} hasBottomSpacing />
            <TextInput label="Max bet" value={form.maxBet} onChange={set('maxBet')} suffix={currency} hasBottomSpacing />
          </div>
          <div style={ROW}>
            <PrimaryButton label={busy ? 'Creating…' : 'Create game'} onClick={create} isDisabled={busy} size={PrimaryButtonSize.Small} />
            {games.length > 0 && (
              <PrimaryButton label="Pick an existing game" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={() => setCreating(false)} isDisabled={busy} />
            )}
          </div>
        </>
      )}
      {error && <div style={ERROR}>{error}</div>}
    </div>
  );
}

// ─── Steps 1 + 2 together, as the Publish popup shows them ────────────────────

/**
 * Renders whatever is still missing before Publish can run, or a one-line
 * summary once nothing is. `onChanged` lets the popup re-read the connection
 * (deploy credentials depend on it) after a sign-in.
 */
// Which sign-in a Sign out leads to: Sign in with XGENIA, or (for staff) the email one. Module-level so every
// mounted RgsReleaseSetup (main view, Real money view) agrees; cleared by the next connection. Nothing ever
// reconnects by itself (RgsSignInForm `start`), so a Sign out always stays signed out.
let startAfterSignOut: 'xgenia' | 'email' | null = null;
const SIGN_OUT_GROUP = { name: 'rgs-sign-out' };
EventDispatcher.instance.on('rgs.connected', () => { startAfterSignOut = null; }, SIGN_OUT_GROUP);

/** Leave the XGENIA RGS connection on purpose. 'xgenia' opens on Sign in with XGENIA; 'email' on the staff one. */
export function signOutOfRgs(then: 'xgenia' | 'email' = 'xgenia'): void {
  startAfterSignOut = then;
  clearRgsSettings(); // emits rgs.gameSelected, which re-renders every RgsReleaseSetup
}

/**
 * Which XGENIA RGS account this editor is signed in to, with Sign out — always visible in Publish while
 * connected (2026-11-10: it used to be reachable only under More → Real money once a game was chosen, so a
 * studio could not see which account it was on, or sign out to test signing in).
 */
function RgsAccountBar({ onLeft }: { onLeft: (then: 'xgenia' | 'email') => void }) {
  const sandbox = isSandboxConnection();
  return (
    <div data-testid="rgs-account-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '12px', color: '#999' }}>
      <span style={{ flex: 1 }}>
        Signed in to {sandbox ? 'your play-money sandbox (test RGS)' : 'XGENIA RGS'}
      </span>
      {sandbox && (
        <span style={LINK} onClick={() => onLeft('xgenia')}>Move to XGENIA RGS</span>
      )}
      <PrimaryButton label="Sign out" variant={PrimaryButtonVariant.Ghost} size={PrimaryButtonSize.Small} onClick={() => onLeft('xgenia')} />
    </div>
  );
}

export function RgsReleaseSetup({ projectName, onChanged, isQuietWhenReady = false }: { projectName: string; onChanged?: () => void; isQuietWhenReady?: boolean }) {
  const [, rerender] = useState(0);
  const refresh = useCallback(() => { rerender((n) => n + 1); onChanged?.(); }, [onChanged]);
  const leave = (then: 'xgenia' | 'email') => { signOutOfRgs(then); refresh(); };

  useEffect(() => {
    const tick = () => rerender((n) => n + 1);
    EventDispatcher.instance.on('rgs.gameSelected', tick, tick);
    EventDispatcher.instance.on('rgs.connected', tick, tick);
    return () => { EventDispatcher.instance.off(tick); };
  }, []);

  const settings = getRgsSettings();
  const game: SelectedGame | null = settings ? getActiveGame() : null;

  if (!settings?.apiKey) {
    // Which sign-in opens: Sign in with XGENIA, unless a Sign out asked for the email one.
    const start = startAfterSignOut ?? 'xgenia';
    return <RgsSignInForm key={start} start={start} onSignedIn={refresh} />;
  }
  if (!game?.id) return (<><RgsAccountBar onLeft={leave} /><GameStep projectName={projectName} onChosen={refresh} /></>);
  // The Publish window shows the game under More once both are known (isQuietWhenReady); the account and
  // Sign out stay in view.
  if (isQuietWhenReady) return <RgsAccountBar onLeft={leave} />;

  return (
    <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#999' }}>
      Publishing <span style={{ color: '#ddd' }}>{game.name || game.slug}</span>{' '}
      {isSandboxConnection() ? 'on your play-money sandbox (test RGS).' : 'on XGENIA RGS.'}{' '}
      <span style={LINK} onClick={() => { setActiveGame(null); refresh(); }}>Change game</span>
      {isSandboxConnection() && (
        <>
          {' · '}
          <span style={LINK} onClick={() => leave('xgenia')}>Move to XGENIA RGS</span>
        </>
      )}
      {' · '}
      <span style={LINK} onClick={() => leave('xgenia')}>Sign out</span>
      {isSandboxConnection() && (
        <span style={{ display: 'block', marginTop: '4px' }}>
          Play money only, and the sandbox takes no new games. Sign in with XGENIA to move to XGENIA RGS: there the
          game is created, published and its RTP verified again, then XGENIA puts it live.
        </span>
      )}
    </Text>
  );
}

// ─── Step 4: certify for real money, and the pre-certification pack ──────────

/** Save bytes as a file the way the editor saves compliance PDFs. */
function saveBytes(bytes: ArrayBuffer, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const POLL_MS = 5000;

export function RgsCertifyPanel() {
  // Follow sign-in and game choice on its own: the panel must not depend on a
  // parent that happens to re-render when the game changes.
  const [, rerender] = useState(0);
  useEffect(() => {
    const tick = () => rerender((n) => n + 1);
    EventDispatcher.instance.on('rgs.gameSelected', tick, tick);
    EventDispatcher.instance.on('rgs.connected', tick, tick);
    return () => { EventDispatcher.instance.off(tick); };
  }, []);
  const apiKey = getRgsSettings()?.apiKey || '';
  const game = apiKey ? getActiveGame() : null;
  const [status, setStatus] = useState<CertificationStatus | null>(null);
  const [busy, setBusy] = useState<'certify' | 'pack' | null>(null);
  const [error, setError] = useState('');

  // Read where certification stands for this game — including a run started
  // before the popup (or the editor) was closed — and again whenever maths is
  // deployed: new maths has a new fingerprint, so its certificate starts over,
  // and saying "Certified" for maths that just changed would be wrong.
  const [deployTick, setDeployTick] = useState(0);
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on(MATHS_DEPLOYED_ELSEWHERE, () => setDeployTick((n) => n + 1), group);
    return () => { EventDispatcher.instance.off(group); };
  }, []);
  useEffect(() => {
    let alive = true;
    setStatus(null);
    if (!apiKey || !game?.id) return;
    fetchCertificationStatus(base(apiKey), { gameId: game.id })
      .then((s) => { if (alive) setStatus(s); })
      .catch(() => { /* an older server without certify-status: the button still works */ });
    return () => { alive = false; };
  }, [apiKey, game?.id, deployTick]);

  // Poll while a run is in flight.
  useEffect(() => {
    if (!apiKey || !game?.id || !status || !isCertificationActive(status)) return;
    const t = setTimeout(() => {
      fetchCertificationStatus(base(apiKey), { gameId: game.id })
        .then(setStatus)
        .catch((e) => setError(e?.message || String(e)));
    }, POLL_MS);
    return () => clearTimeout(t);
  }, [apiKey, game?.id, status]);

  if (!apiKey || !game?.id) return null;

  const certify = async () => {
    setBusy('certify');
    setError('');
    try {
      // A sandbox's Verify RTP is paid with the user's XGENIA credits, charged by the RGS with this sign-in.
      const token = isSandboxConnection() ? await xgeniaAccessToken() : undefined;
      setStatus(await startCertification(base(apiKey), game.id, false, undefined, token));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const pack = async () => {
    setBusy('pack');
    setError('');
    try {
      const { filename, bytes } = await downloadPrecertPack(base(apiKey), game);
      saveBytes(bytes, filename, 'application/zip');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  const line = status ? describeCertification(status) : null;
  const colour = line?.tone === 'good' ? '#67DE92' : line?.tone === 'bad' ? '#f66' : '#a0a0b0';
  const running = !!status && isCertificationActive(status);
  const versionsUrl = gameVersionsUrl(game.slug);

  return (
    <div style={{ ...STEP_STYLE, marginTop: '12px' }} data-guide="rgs-certify">
      <div style={STEP_TITLE}>Going live with real money</div>
      <div style={HINT}>
        1. <b>Verify RTP</b>: XGENIA RGS plays your maths until it knows the real return to player.
        <br />
        2. Send the <b>pre-certification pack</b> to a test lab, if your market needs one (most do).
        <br />
        3. In XGENIA RGS, open the game&#39;s <b>Versions</b>, then <b>Approve</b> and <b>Deploy live</b>.
        {versionsUrl && (
          <>
            {' '}
            <a href={versionsUrl} target="_blank" rel="noopener noreferrer" style={{ ...LINK, textDecoration: 'none' }}>
              Open Versions
            </a>
          </>
        )}
        <br />
        Changing the maths means verifying again.
        {isSandboxConnection() && (
          <>
            <br />
            In your play-money sandbox, each Verify RTP costs {VERIFY_RTP_SANDBOX_CREDITS === 1 ? "one" : VERIFY_RTP_SANDBOX_CREDITS} of your bought XGENIA credits (€0.25 each).
          </>
        )}
      </div>
      {line && <div style={{ fontSize: '12px', color: colour, marginBottom: '8px' }}>{line.text}</div>}
      {running && (
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '8px' }}>
          <div style={{ width: `${Math.round((status?.progress || 0) * 100)}%`, height: '100%', background: '#67DE92', borderRadius: '2px' }} />
        </div>
      )}
      <div style={ROW}>
        <PrimaryButton
          label={
            busy === 'certify'
              ? 'Starting…'
              : running
                ? 'Verifying…'
                : `${status?.status === 'passed' ? 'Verify again' : 'Verify RTP'}${isSandboxConnection() ? ` · ${creditsText(VERIFY_RTP_SANDBOX_CREDITS)}` : ''}`
          }
          onClick={certify}
          isDisabled={!!busy || running}
          size={PrimaryButtonSize.Small}
        />
        <PrimaryButton
          label={busy === 'pack' ? 'Preparing…' : 'Download pre-certification pack'}
          variant={PrimaryButtonVariant.MutedOnLowBg}
          onClick={pack}
          isDisabled={!!busy}
          size={PrimaryButtonSize.Small}
        />
      </div>
      {error && <div style={ERROR}>{error}</div>}
    </div>
  );
}
