// The release steps the Publish popup used to send people away for.
//
// Publish → XGENIA used to stop at "Not connected to XGENIA RGS. Connect in the
// Maths RGS panel first." and "No game selected. Select one in the Maths RGS
// panel first." — while the Maths panel hid both controls behind "Show all
// tools". A studio pressing Publish had nowhere to go. Everything a release needs
// now happens here, in order, and each step disappears once it is done:
//
//   1. Sign in   — email → 6-digit code (rgsSignIn.ts). The first sign-in creates
//                  the studio's own space on XGENIA RGS; there is no key to paste.
//   2. Game      — pick one of the studio's games, or create one with the numbers
//                  certification and the stake guard will hold it to (rgsRelease.ts).
//   3. Publish   — the popup's own Publish button (deploys changed maths first).
//   4. Certify   — RgsCertifyPanel below: one button, progress that survives
//                  closing the popup, and the pre-certification pack download.
//
// This is the only release surface: the Maths panel's old manual tools (paste a
// key, game picker, Server Versions, Deploy) are gone.

import React, { useCallback, useEffect, useState } from 'react';

import { PrimaryButton, PrimaryButtonSize, PrimaryButtonVariant } from '@xgenia-core-ui/components/inputs/PrimaryButton';
import { TextInput } from '@xgenia-core-ui/components/inputs/TextInput';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { EventDispatcher } from '@xgenia-shared/utils/EventDispatcher';

import {
  rgsFunctionsUrl,
  clearRgsSettings,
  completeEmailSignIn,
  connectWithXgeniaLogin,
  emailSignInCode,
  fetchOperatorInfo,
  gameVersionsUrl,
  getActiveGame,
  getRgsSettings,
  isSandboxConnection,
  listGames,
  rgsHeaders,
  setActiveGame,
  SelectedGame
} from '@xgenia-utils/rgs/rgsClient';
import { emailProblem, codeProblem } from '@xgenia-utils/rgs/rgsSignIn';
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
 * `start`: 'auto' connects with the XGENIA login by itself (first open of Publish). After an explicit sign-out it is
 * 'choose' — reconnecting by itself would make Sign out a no-op and leave an invited studio a split second to click
 * past its sandbox (found 2026-11-02). 'email' opens straight on the invited-account sign-in.
 */
export function RgsSignInForm({ onSignedIn, start = 'auto' }: { onSignedIn?: () => void; start?: 'auto' | 'choose' | 'email' }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Every XGENIA login is a play-money RGS sandbox (2026-11-02): connect with it first, by itself. The email code
  // below is only for an invited studio, or when the XGENIA sign-in cannot be used.
  const [xgenia, setXgenia] = useState<'trying' | 'failed' | 'email' | 'choose'>(
    start === 'email' ? 'email' : start === 'choose' ? 'choose' : 'trying'
  );
  const [xgeniaError, setXgeniaError] = useState('');
  const connectXgenia = () => {
    setXgenia('trying');
    setXgeniaError('');
    connectWithXgeniaLogin()
      .then(() => onSignedIn?.())
      .catch((e: any) => { setXgeniaError(e?.message || String(e)); setXgenia('failed'); });
  };
  useEffect(() => {
    if (start !== 'auto') return;
    let live = true;
    connectWithXgeniaLogin()
      .then(() => { if (live) onSignedIn?.(); })
      .catch((e: any) => {
        if (!live) return;
        setXgeniaError(e?.message || String(e));
        setXgenia('failed');
      });
    return () => { live = false; };
  }, []);

  if (xgenia !== 'email') {
    return (
      <div style={STEP_STYLE} data-guide="rgs-sign-in">
        <div style={STEP_TITLE}>1 · Your play-money RGS</div>
        {xgenia === 'choose' ? (
          <>
            <div style={HINT}>Publish and play with play money, using your XGENIA sign-in. Nothing to type.</div>
            <div style={ROW}>
              <PrimaryButton label="Connect with my XGENIA login" size={PrimaryButtonSize.Small} onClick={connectXgenia} />
            </div>
          </>
        ) : xgenia === 'trying' ? (
          <div style={HINT}>Connecting with your XGENIA sign-in…</div>
        ) : (
          <>
            <div style={ERROR}>{xgeniaError}</div>
            <div style={ROW}>
              <PrimaryButton
                label="Try again"
                size={PrimaryButtonSize.Small}
                onClick={connectXgenia}
              />
            </div>
          </>
        )}
        <div style={{ ...LINK, marginTop: '8px' }} onClick={() => setXgenia('email')}>
          Use an invited RGS account instead
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
      await completeEmailSignIn(email, code);
      onSignedIn?.();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={STEP_STYLE} data-guide="rgs-sign-in">
      <div style={STEP_TITLE}>1 · Sign in to XGENIA RGS</div>
      {!codeSent ? (
        <>
          <div style={HINT}>We email you a 6-digit code. Your studio’s space is created the first time you sign in.</div>
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
      <div style={{ ...LINK, marginTop: '8px' }} onClick={() => { if (!busy) connectXgenia(); }}>
        Use my XGENIA login (play money) instead
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
  const [form, setForm] = useState<ReleaseGameForm>(() => defaultReleaseGameForm(projectName));
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
            {games.map((g) => (
              <PrimaryButton key={g.id} label={g.name} variant={PrimaryButtonVariant.MutedOnLowBg} size={PrimaryButtonSize.Small} onClick={() => choose(g)} isGrowing />
            ))}
          </div>
          <span style={LINK} onClick={() => setCreating(true)}>+ Create a new game</span>
        </>
      ) : (
        <>
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
export function RgsReleaseSetup({ projectName, onChanged }: { projectName: string; onChanged?: () => void }) {
  const [, rerender] = useState(0);
  const refresh = useCallback(() => { rerender((n) => n + 1); onChanged?.(); }, [onChanged]);
  // How the sign-in opens after the user left a connection on purpose (see RgsSignInForm `start`).
  const [nextStart, setNextStart] = useState<'auto' | 'choose' | 'email'>('auto');
  const leave = (then: 'choose' | 'email') => { clearRgsSettings(); setNextStart(then); refresh(); };

  useEffect(() => {
    const tick = () => rerender((n) => n + 1);
    EventDispatcher.instance.on('rgs.gameSelected', tick, tick);
    EventDispatcher.instance.on('rgs.connected', tick, tick);
    return () => { EventDispatcher.instance.off(tick); };
  }, []);

  const settings = getRgsSettings();
  const game: SelectedGame | null = settings ? getActiveGame() : null;

  if (!settings?.apiKey) return <RgsSignInForm key={nextStart} start={nextStart} onSignedIn={refresh} />;
  if (!game?.id) return <GameStep projectName={projectName} onChosen={refresh} />;

  return (
    <Text style={{ marginBottom: '12px', fontSize: '12px', color: '#999' }}>
      Publishing <span style={{ color: '#ddd' }}>{game.name || game.slug}</span>{' '}
      {isSandboxConnection() ? 'on your play-money sandbox (test RGS).' : 'on XGENIA RGS.'}{' '}
      <span style={LINK} onClick={() => { setActiveGame(null); refresh(); }}>Change game</span>
      {isSandboxConnection() && (
        <>
          {' · '}
          <span style={LINK} onClick={() => leave('email')}>Use an invited RGS account</span>
        </>
      )}
      {' · '}
      <span style={LINK} onClick={() => leave('choose')}>Sign out</span>
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
      setStatus(await startCertification(base(apiKey), game.id, false));
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
      </div>
      {line && <div style={{ fontSize: '12px', color: colour, marginBottom: '8px' }}>{line.text}</div>}
      {running && (
        <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginBottom: '8px' }}>
          <div style={{ width: `${Math.round((status?.progress || 0) * 100)}%`, height: '100%', background: '#67DE92', borderRadius: '2px' }} />
        </div>
      )}
      <div style={ROW}>
        <PrimaryButton
          label={busy === 'certify' ? 'Starting…' : running ? 'Verifying…' : status?.status === 'passed' ? 'Verify again' : 'Verify RTP'}
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
