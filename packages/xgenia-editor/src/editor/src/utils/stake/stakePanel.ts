/**
 * The Stake page of the Publish window, as data: where the game is going, the checklist the page shows, and the
 * one thing to do next (2026-11-11).
 *
 * WHY. Getting to Stake took Publish → "Download or other platforms" → the "Stake (frontend)" tab, and the page
 * then showed a green "Ready to export" over a red "has no deployed Math Component", a "This game is for Stake"
 * checkbox at the top, five form fields and two paragraphs of export internals — every detail at once, no single
 * next step. Now the destination is a property of the GAME (project metadata `target`, the same key the AI's
 * `stake readiness` reads): set once, and Publish opens on Stake. The page leads with three checks — connected,
 * maths deployed, rules — whose combined state decides the headline and the one primary button, so the page
 * can never say "ready" while something below it says it is not. The form fields are under "Options".
 *
 * Pure (no editor imports) so tests/deploy/stakePanel.test.ts can run it.
 */

export type PublishDestination = 'xgenia' | 'stake';

/** Where this game is published: Stake when the project says so (metadata `target`), XGENIA otherwise. */
export function publishDestinationOf(project: { getMetaData?: (key: string) => unknown } | null | undefined): PublishDestination {
  try {
    return project?.getMetaData?.('target') === 'stake' ? 'stake' : 'xgenia';
  } catch {
    return 'xgenia';
  }
}

/** Remember the destination on the project: `target` = 'stake', or cleared for XGENIA. */
export function setPublishDestination(project: { setMetaData?: (key: string, value: unknown) => void } | null | undefined, destination: PublishDestination) {
  project?.setMetaData?.('target', destination === 'stake' ? 'stake' : null);
}

export type CheckState = 'ok' | 'todo' | 'warn' | 'busy';

export interface StakeCheck {
  key: 'rgs' | 'maths' | 'rules' | 'rtp';
  state: CheckState;
  title: string;
  detail: string;
}

export interface StakeIssueLike {
  code: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  fix: string;
}

export interface StakePanelInput {
  /** Signed in to XGENIA RGS. */
  connected: boolean;
  /** The RGS game this project publishes as, when one is chosen. */
  gameName: string | null;
  /** Deployed Math Components that can be exported; null while still listing. */
  components: Array<{ name: string }> | null;
  /** Why none can be listed, when none can. */
  componentsError: string;
  /** The readiness check's issues; null when it could not run. */
  issues: StakeIssueLike[] | null;
  /**
   * The last RTP measurement of the component the build plays (stakeMeasureStore), with whether it measured the
   * deployment now on XGENIA RGS; 'running' while one runs. Absent = never measured.
   */
  measure?: 'running' | { current: boolean; ok: boolean; modes: Array<{ name: string; rtp: number; rtpMargin: number }>; problems: Array<{ level: string; code: string; message: string }> } | null;
}

/** What Stake's reviewers check by hand, shown as a list to go through in the Stake preview. */
export const STAKE_REVIEW_ITEMS = [
  'Spacebar places a bet',
  'A confirmation before any mode costing more than 2×',
  'Autoplay asks for confirmation',
  'A sound on/off toggle',
  'Every bet level can be selected',
  'The win counts up to the final payout',
  'Replay mode plays a past round',
];

export interface StakePanel {
  checks: StakeCheck[];
  /** One line at the top: what state the game is in. */
  headline: string;
  tone: 'ok' | 'warn' | 'todo';
  /** Whether the "Build for Stake" button can run. */
  canBuild: boolean;
  /** The one main action: measure the RTP first, then build. */
  primary: 'measure' | 'build' | 'none';
  /** The issues worth showing, worst first, each with a short title. */
  issues: Array<StakeIssueLike & { title: string }>;
}

/** Short names for readiness codes, for the list (the full message is shown under each). */
export const STAKE_ISSUE_TITLES: Record<string, string> = {
  NO_PROJECT: 'No project open',
  NO_MATHS_COMPONENT: 'Outcomes are decided in the browser',
  MATHS_NOT_COMPILABLE: 'Maths uses a node the server cannot run',
  FREE_SPINS_NOT_DECLARED: 'Free spins would be lost on Stake',
  BET_MODE_NOT_AN_INPUT: 'Buy and ante modes are not wired',
  BUY_MODES_EXPORT: 'Buy modes',
  STATE_BETWEEN_BETS: 'Something carries over between bets',
  JACKPOT_POOL: 'Jackpot pools are not allowed',
  GAMBLE_FEATURE: 'Gamble is not allowed',
  MATHS_NOT_WIRED: 'Math Component is not triggered',
  MATHS_UNUSED: 'No screen uses the Math Component',
  HAND_WIRED_STAKE_NODES: 'Hand-wired Stake nodes',
  MANUAL_STAKE_WIRING: 'Hand-wired Stake nodes',
  MANUAL_NO_AUTHENTICATE: 'Hand-wired Stake nodes',
  MANUAL_NO_END_ROUND: 'Hand-wired Stake nodes',
  STAKE_BUILD_NOT_WIRED: 'Stake build is not wired',
  STAKE_NODE_HTTP: 'Stake node uses http',
  XRGS_ONLY_NODE: 'Calls XGENIA servers',
  PAGE_NAVIGATION: 'Changes page during play',
  NO_DISCLAIMER: 'Rules screen and disclaimer',
  SOCIAL_MODE_WORDS: 'Words Stake.US does not allow',
  PICK_IS_A_REVEAL: 'Picks must be reveals',
  REVIEW_CHECKLIST: "Stake's review checklist",
};

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 } as const;

export function stakePanel(input: StakePanelInput): StakePanel {
  const rgs: StakeCheck = !input.connected
    ? { key: 'rgs', state: 'todo', title: 'Connect to XGENIA RGS', detail: 'Stake books are played from your maths on XGENIA RGS.' }
    : !input.gameName
      ? { key: 'rgs', state: 'todo', title: 'Choose the game', detail: 'Pick or create the game this project publishes as.' }
      : { key: 'rgs', state: 'ok', title: 'Connected', detail: input.gameName };

  const maths: StakeCheck = rgs.state !== 'ok'
    ? { key: 'maths', state: 'todo', title: 'Maths', detail: 'Checked once you are connected.' }
    : input.components === null
      ? { key: 'maths', state: 'busy', title: 'Maths', detail: 'Looking for the deployed maths…' }
      : input.components.length === 0
        ? { key: 'maths', state: 'todo', title: 'Deploy the maths', detail: input.componentsError || 'No Math Component is deployed for this game yet.' }
        : { key: 'maths', state: 'ok', title: 'Maths deployed', detail: input.components.map((c) => c.name).join(', ') };

  const issues = (input.issues || [])
    // The review checklist is shown as its own list (STAKE_REVIEW_ITEMS), not as a problem.
    .filter((i) => i.code !== 'REVIEW_CHECKLIST' && (i.level !== 'info' || i.message))
    .slice()
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
    .map((i) => ({ ...i, title: STAKE_ISSUE_TITLES[i.code] || i.code.toLowerCase().replace(/_/g, ' ') }));
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warn').length;
  const rules: StakeCheck = input.issues === null
    ? { key: 'rules', state: 'warn', title: 'Stake rules', detail: 'The check could not read the project.' }
    : errors
      ? { key: 'rules', state: 'todo', title: 'Stake rules', detail: `${errors} problem${errors === 1 ? '' : 's'} will break the game on Stake.` }
      : warnings
        ? { key: 'rules', state: 'warn', title: 'Stake rules', detail: `${warnings} thing${warnings === 1 ? '' : 's'} Stake's review will flag.` }
        : { key: 'rules', state: 'ok', title: 'Stake rules', detail: 'Nothing found.' };

  // Payout (RTP): Stake refuses a mode outside 96.0–96.7%, so "ready" waits for a measurement of the maths
  // that is deployed now (2026-11-11: the page said ready with three ticks and no RTP ever measured).
  const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
  const m = input.measure;
  const rtp: StakeCheck = maths.state !== 'ok'
    ? { key: 'rtp', state: 'todo', title: 'Payout (RTP)', detail: 'Measured once the maths is deployed.' }
    : m === 'running'
      ? { key: 'rtp', state: 'busy', title: 'Payout (RTP)', detail: 'Measuring every mode on Stake books…' }
      : !m
        ? { key: 'rtp', state: 'todo', title: 'Measure the payout (RTP)', detail: 'Stake needs every mode between 96.0% and 96.7%. Not measured yet.' }
        : !m.current
          ? { key: 'rtp', state: 'todo', title: 'Measure the payout again', detail: 'The maths was deployed again since the last measurement.' }
          : {
              key: 'rtp',
              state: m.ok ? 'ok' : 'todo',
              title: m.ok ? 'Payout in Stake’s band' : m.problems.some((p) => p.code === 'RTP_UNCERTAIN') ? 'Payout not measured closely enough' : 'Payout outside Stake’s limits',
              detail: m.modes.map((x) => `${x.name} ${pct(x.rtp)}${x.rtpMargin ? ` ± ${pct(x.rtpMargin)}` : ''}`).join(' · ') +
                (m.ok ? '' : `\n${m.problems.filter((p) => p.level === 'error').map((p) => p.message).join('\n')}`)
            };

  const checks = [rgs, maths, rules, rtp];
  const setupReady = rgs.state === 'ok' && maths.state === 'ok' && errors === 0;
  const canBuild = setupReady && rtp.state === 'ok';
  const primary: StakePanel['primary'] = canBuild ? 'build' : setupReady && rtp.state === 'todo' && !(m && m !== 'running' && m.current) ? 'measure' : 'none';
  const blocking = checks.find((c) => c.state === 'todo' || c.state === 'busy');
  const headline = blocking
    ? blocking.key === 'rgs'
      ? `${rgs.title} to build for Stake.`
      : blocking.key === 'maths'
        ? maths.state === 'busy' ? 'Checking…' : 'Deploy the maths to build for Stake.'
        : blocking.key === 'rules'
          ? 'Fix the problems below to build for Stake.'
          : rtp.state === 'busy'
            ? 'Measuring the payout…'
            : primary === 'measure'
              ? 'Measure the payout, then build.'
              : 'The payout needs fixing before Stake will take it.'
    : warnings
      ? 'Ready to build. Stake’s review will flag a few things.'
      : 'Ready to build for Stake.';
  return { checks, headline, tone: blocking ? 'todo' : warnings || rules.state === 'warn' ? 'warn' : 'ok', canBuild, primary, issues };
}
