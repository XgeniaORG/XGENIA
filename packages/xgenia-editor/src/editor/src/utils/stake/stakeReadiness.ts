/**
 * Is this project ready for Stake Engine? — read off the project itself, before anything is exported.
 *
 * WHY (2026-11-09). Games built in XGENIA reached Stake with bonus rounds that never played, buys that were
 * ordinary spins, maths running in the player's browser and hand-wired Stake nodes that left rounds open. Every
 * one of those was visible in the project graph before export; none was said. The tools that do find them (the
 * Stake harness, tools/stake-harness) need an exported package and a build. This is the first, cheapest gate:
 * the Stake tab shows it, and the AI reads it (bridge `stake.readiness`) and fixes what it can.
 *
 * Every issue carries what is wrong, why it breaks on Stake, the fix in the user's words, and — `ai` — the fix
 * as an instruction the XGENIA AI can act on. `error` blocks a Stake export; `warn` will likely fail review or
 * play wrongly; `info` is a reminder of what Stake checks that a graph cannot show.
 *
 * Pure: takes project JSON (project.json / ProjectModel.toJSON()), imports nothing from the editor, so it runs
 * in tests (tests/deploy/stakeReadiness.test.ts) and anywhere the project is.
 *
 * Node type names come from the libraries as of 2026-11-09: xgenia-runtime slot-feature-node-converter.ts
 * (stateful feature nodes), slot-game-node-converter.ts, private/xgenia-pro-nodes (Bet Mode, stake.*).
 */
import { STAKE_RULES, labelWords } from './stakeRules';

export type ReadinessLevel = 'error' | 'warn' | 'info';

export interface ReadinessIssue {
  code: string;
  level: ReadinessLevel;
  /** Component and node the issue is about, when it is about one. */
  where?: { component: string; nodeId?: string; label?: string };
  message: string;
  fix: string;
  ai: string;
}

export interface ReadinessReport {
  ready: boolean;
  errors: number;
  warnings: number;
  issues: ReadinessIssue[];
  /** What was found, for the tab and the AI to show. */
  summary: {
    /** The project's target (project metadata `target`): "stake" when the game is declared for Stake Engine. */
    target: string | null;
    mathsComponents: string[];
    freeSpins: 'library' | 'declared' | 'suspected-undeclared' | 'none';
    betModes: boolean;
    pickBonus: boolean;
  };
}

/**
 * Whether Publish → Stake swaps the Math Component for the Book Connector (utils/stake/stakeConnector.ts). False
 * until the Stake maths export it depends on is finished: until then a Stake build runs the maths in the browser,
 * and a game with a bonus is said not to be ready — rather than a green check over an export that cannot carry it.
 * Flip with the wiring in DeployToStakeTab / deployToFolderStake, and drop STAKE_BUILD_NOT_WIRED with it.
 */
export const STAKE_BUILD_PLAYS_BOOKS = true;

const MATHS_PREFIX = '/#__maths__/';
const CLOUD_PREFIX = '/#__cloud__/';

/** Feature nodes that keep state (slot-feature-node-converter.ts `stateful: true`) plus the Counter. */
// Stake's lists come from the one rule set (stakeRules.ts).
const STATEFUL = new Set(STAKE_RULES.statefulNodes);
/** Maths nodes the compiler cannot turn into the server script — no books can come from them. */
const NOT_COMPILABLE = new Set(['SlotMainEngine', 'Generate Reel Strips']);
/** Frontend nodes that talk to XGENIA's own RGS or services: nothing answers them on Stake. */
const XRGS_ONLY = new Set(STAKE_RULES.xrgsOnlyNodes);
const NAVIGATION = new Set(['Router', 'RouterNavigate', 'Page Stack', 'PageStackNavigate', 'PageStackNavigateToPath', 'PageStackNavigateBack']);
/** The platform state keys the compiler lifts out of a persisted variable (supabase-converter.ts RGS_PLATFORM_STATE_KEYS). */
const PLATFORM_KEYS = new Set(['in_feature', 'feature_rounds_remaining', 'awaiting_choice']);
const FREE_SPIN_WORDS = /free.?spin|freespin|fs.?left|spins.?left|spins.?remaining|respin|bonus.?spin|feature.?round/i;
/** Stake.US social mode: words that must not appear (docs approval/social; abbreviated to the ones UI text uses). */
const SOCIAL_WORDS = STAKE_RULES.socialWords;

interface Node {
  id: string;
  type: string;
  label?: string;
  parameters?: Record<string, any>;
  children?: Node[];
}
interface Conn {
  fromId: string;
  fromProperty: string;
  toId: string;
  toProperty: string;
}
interface Comp {
  name: string;
  graph?: { roots?: Node[]; connections?: Conn[] };
}

function nodesOf(comp: Comp): Node[] {
  const out: Node[] = [];
  const walk = (ns: Node[] | undefined) => {
    for (const n of ns || []) {
      if (!n) continue;
      out.push(n);
      walk(n.children);
    }
  };
  walk(comp.graph?.roots);
  return out;
}

const typeOf = (n: Node) => String((n as any).type ?? (n as any).typename ?? '');
const where = (comp: Comp, n?: Node) => ({ component: comp.name, ...(n ? { nodeId: n.id, label: n.label || typeOf(n) } : {}) });

/** Text a player sees: a Text node's text, a button's or label's caption. Not node labels or variable names. */
function textOf(n: Node): string {
  const p = n.parameters || {};
  const t = typeOf(n);
  const shown = [p.text];
  if (/button|label|checkbox|dropdown|textinput/i.test(t)) shown.push(p.label, p.placeholder);
  return shown.filter((v) => typeof v === 'string').join(' ');
}

export function stakeReadiness(project: any): ReadinessReport {
  const issues: ReadinessIssue[] = [];
  const add = (i: ReadinessIssue) => issues.push(i);
  const comps: Comp[] = Array.isArray(project?.components) ? project.components : [];
  const maths = comps.filter((c) => typeof c?.name === 'string' && c.name.startsWith(MATHS_PREFIX));
  const frontend = comps.filter((c) => typeof c?.name === 'string' && !c.name.startsWith(MATHS_PREFIX) && !c.name.startsWith(CLOUD_PREFIX));
  const target = typeof project?.metadata?.target === 'string' ? project.metadata.target : null;
  const summary: ReadinessReport['summary'] = { target, mathsComponents: maths.map((c) => c.name), freeSpins: 'none', betModes: false, pickBonus: false };

  if (!comps.length) {
    add({ code: 'NO_PROJECT', level: 'error', message: 'No project is open (or it has no components).', fix: 'Open the game project.', ai: 'Ask the user to open the game project, then run stake readiness again.' });
    return finish(issues, summary);
  }

  // ── Maths ────────────────────────────────────────────────────────────────────────────────────
  // A project can also drive Stake by hand with the stake.* nodes and play books exported from a Math Component
  // elsewhere (an RGS test bench, or a frontend-only project) — a real pattern (2026-11-09, RGS-TEST), not an error.
  const allNodes = comps.flatMap((c) => nodesOf(c).map((n) => ({ comp: c, node: n })));
  const manual = allNodes.filter(({ node }) => typeOf(node).startsWith('stake.'));
  const hasManualPlay = manual.some(({ node }) => typeOf(node) === 'stake.RGSPlay');
  if (!maths.length && !hasManualPlay) {
    add({
      code: 'NO_MATHS_COMPONENT',
      level: 'error',
      message: 'The game has no Math Component, so its outcomes are decided in the browser. Stake plays pre-computed books made from the Math Component; without one there is nothing to export.',
      fix: 'Move the game\'s outcome maths into a Math Component (Maths panel), with a bet input and a win output.',
      ai: 'Run rgs({action:"move_maths"}) to move the outcome maths into /#__maths__/<Game>Maths, then run stake readiness again.'
    });
  }

  let libraryFreeSpins = false;
  let declaredFeature = false;
  let suspected: { comp: Comp; node: Node } | null = null;
  for (const comp of maths) {
    const nodes = nodesOf(comp);
    const conns = comp.graph?.connections || [];
    const inputs = nodes.find((n) => typeOf(n) === 'Component Inputs');
    for (const n of nodes) {
      const t = typeOf(n);
      if (NOT_COMPILABLE.has(t)) {
        add({
          code: 'MATHS_NOT_COMPILABLE',
          level: 'error',
          where: where(comp, n),
          message: `"${t}" cannot be compiled into the maths script, so no Stake books can be made from ${comp.name}.`,
          fix: t === 'SlotMainEngine' ? 'Build the spin from Weighted Reels → Check Wins → Calculate Winnings instead of SlotMainEngine.' : 'Use Reel Strips Generator (seeded) instead of Generate Reel Strips.',
          ai: `Replace the ${t} node in ${comp.name} with compilable library nodes (rgs extract_maths reports unsupported nodes), then run stake readiness again.`
        });
      }
      if (STAKE_RULES.blockedNodes.some((b) => b.type === t && b.feature === 'progressive_jackpot')) {
        add({ code: 'JACKPOT_POOL', level: 'error', where: where(comp, n), message: 'Live jackpot pools are not allowed on Stake: every bet must be independent of every other.', fix: 'Remove the jackpot pool. Fixed jackpot tiers paid from the maths (Jackpot Tiers) are fine.', ai: `Remove the RGS Jackpot Pools node from ${comp.name}; keep fixed Jackpot Tiers if the game needs jackpots.` });
      }
      if (STAKE_RULES.blockedLabel.test(labelWords(t + ' ' + (n.label || '')))) {
        add({ code: 'GAMBLE_FEATURE', level: 'error', where: where(comp, n), message: 'Gamble, double-up and cash-out are not allowed on Stake: a round\'s result is fixed when it is bought, and the player cannot change it.', fix: 'Remove the gamble / cash-out step.', ai: `Remove the gamble or cash-out logic (${n.label || t}) from ${comp.name}.` });
      }
      if (t === 'Calculate Free Spins States') libraryFreeSpins = true;
      if (t === 'Variable2') {
        const name = String(n.parameters?.name ?? n.label ?? '');
        if (PLATFORM_KEYS.has(name)) declaredFeature = true;
        else if (FREE_SPIN_WORDS.test(name) && !suspected) suspected = { comp, node: n };
      }
      if (t === 'JavaScriptFunction' && !suspected) {
        const code = String(n.parameters?.functionScript ?? n.parameters?.script ?? '');
        if (FREE_SPIN_WORDS.test(code)) suspected = { comp, node: n };
      }
      if (STATEFUL.has(t) && t !== 'Pick Bonus') {
        add({
          code: 'STATE_BETWEEN_BETS',
          level: 'warn',
          where: where(comp, n),
          message: `"${t}" keeps state between rounds. Inside one paid round (a bonus and its free spins) that works on Stake; anything that should carry from one BET to the next (a meter that fills over many bets, collected symbols) starts from zero on every Stake round.`,
          fix: 'Make sure the state resets when the bonus ends. Stake does not allow features that build up across bets.',
          ai: `Check that ${n.label || t} in ${comp.name} is reset when its feature ends; if it accumulates across paid bets, redesign it to live inside one bonus.`
        });
      }
      if (t === 'Pick Bonus') summary.pickBonus = true;
      if (t === 'Bet Mode') {
        summary.betModes = true;
        const fed = conns.some((c) => c.toId === n.id && c.toProperty === 'mode' && (!inputs || c.fromId === inputs.id));
        if (!fed) {
          add({
            code: 'BET_MODE_NOT_AN_INPUT',
            level: 'error',
            where: where(comp, n),
            message: 'The Bet Mode node\'s "mode" is not wired from the Math Component\'s inputs, so the game cannot ask for a buy or an ante: on Stake a bought bonus would be an ordinary spin at the buy price.',
            fix: 'Add a "mode" input to the Math Component and wire it to Bet Mode → mode; send "base", "ante" or "bonus_buy" from the game.',
            ai: `In ${comp.name}, add a Component Inputs port "mode" and connect it to the Bet Mode node's mode input; in the game, feed the selected bet mode into that port.`
          });
        }
      }
    }
  }
  summary.freeSpins = libraryFreeSpins ? 'library' : declaredFeature ? 'declared' : suspected ? 'suspected-undeclared' : 'none';
  if (!libraryFreeSpins && !declaredFeature && suspected) {
    const s = suspected as { comp: Comp; node: Node };
    add({
      code: 'FREE_SPINS_NOT_DECLARED',
      level: 'error',
      where: where(s.comp, s.node),
      message: 'The maths looks like it counts free spins itself, but nothing tells the exporter a feature is running. On Stake every book would END after the trigger spin and the free spins would be lost — paid for by the player, never played.',
      fix: 'Use the library\'s "Calculate Free Spins States" node, or name the variable that holds the spins left "feature_rounds_remaining" and set a variable "in_feature" while the bonus runs.',
      ai: `In ${s.comp.name}, replace the custom free-spin counter (${s.node.label || typeOf(s.node)}) with a Calculate Free Spins States node, or rename its persisted Variable to feature_rounds_remaining and add an in_feature Variable that is true while spins remain. Then re-export and check that the base mode has feature books.`
    });
  }
  if (!STAKE_BUILD_PLAYS_BOOKS && maths.length) {
    add({
      code: 'STAKE_BUILD_NOT_WIRED',
      level: 'warn',
      message: 'This version of XGENIA does not yet connect the Math Component to Stake\'s books in the Stake export: the exported game would decide outcomes in the browser, unrelated to what Stake pays. Fine for checking the look; not ready to submit.',
      fix: 'Wait for the XGENIA update that turns on the Stake maths export; the game itself needs no change for it.',
      ai: 'Tell the user the Stake export is not ready to submit yet in this XGENIA version; do not hand-wire stake.* nodes to work around it.'
    });
  }
  if (summary.betModes) {
    add({ code: 'BUY_MODES_EXPORT', level: 'info', message: 'The game has bet modes. Each one becomes a Stake mode with its own books; every mode\'s RTP must be 96.0–96.7% and within 0.5% of base, and a buy\'s books must all open the bonus.', fix: 'Tune each mode\'s RTP before exporting; the harness checks every mode.', ai: 'After export, run the Stake harness and check RTP_OUT_OF_BAND / RTP_MODE_SPREAD / BUY_NOT_IN_FEATURE per mode.' });
  }
  if (summary.pickBonus) {
    add({ code: 'PICK_IS_A_REVEAL', level: 'info', message: 'On Stake a pick bonus is a reveal: the prizes are fixed when the round is bought, the player\'s click only chooses which tile shows them. Autoplay, turbo and replay need the game to pick by itself.', fix: 'Word the rules so the pick does not sound like skill, and make the pick screen choose a tile on its own after a few seconds.', ai: 'Make sure the pick screen auto-picks after a timeout and in autoplay, and the rules say the prizes are predetermined.' });
  }

  // ── Frontend ─────────────────────────────────────────────────────────────────────────────────
  const mathsNames = new Set(maths.map((c) => c.name));
  let instances = 0;
  let stakeNodes = 0;
  const texts: { comp: Comp; node: Node; text: string }[] = [];
  for (const comp of frontend) {
    const nodes = nodesOf(comp);
    const conns = comp.graph?.connections || [];
    for (const n of nodes) {
      const t = typeOf(n);
      if (mathsNames.has(t)) {
        instances++;
        const incoming = conns.filter((c) => c.toId === n.id);
        if (!incoming.length) {
          add({ code: 'MATHS_NOT_WIRED', level: 'error', where: where(comp, n), message: `${t} is placed in ${comp.name} but nothing is wired into it: the game can never ask it for a round.`, fix: 'Wire the spin button to its Spin input and the bet to its bet input.', ai: `Connect the spin trigger and the bet value to the ${t} instance in ${comp.name}.` });
        }
      }
      if (t.startsWith('stake.')) stakeNodes++;
      if (XRGS_ONLY.has(t) || t.startsWith(CLOUD_PREFIX)) {
        add({ code: 'XRGS_ONLY_NODE', level: 'warn', where: where(comp, n), message: `"${t}" talks to XGENIA's own servers. A Stake build is static and only talks to Stake's RGS, so this does nothing there (or fails).`, fix: 'Remove it from the Stake build, or keep it behind a check that the game is not running on Stake.', ai: `Remove or guard the ${t} node in ${comp.name} for the Stake build.` });
      }
      if (NAVIGATION.has(t)) {
        add({ code: 'PAGE_NAVIGATION', level: 'info', where: where(comp, n), message: 'The game changes page. Stake hosts the game under a versioned path and launches it with sessionID / rgs_url in the URL; the Book Connector keeps its session across page changes, but anything else reading the URL must not lose them.', fix: 'Prefer one page with popups for bonus screens.', ai: 'Prefer popups over page navigation for bonus screens in the Stake build.' });
      }
      const text = textOf(n);
      if (text) texts.push({ comp, node: n, text });
    }
  }
  if (maths.length && !instances) {
    add({ code: 'MATHS_UNUSED', level: 'error', message: 'No screen uses the Math Component, so the game cannot play a round from it.', fix: 'Place the Math Component in the game screen and wire Spin and the bet into it.', ai: 'Place the /#__maths__/ component in the game\'s main component and wire its Spin trigger and bet input.' });
  }
  for (const { comp, node } of manual) {
    if (String(node.parameters?.protocol || '').toLowerCase() === 'http') {
      add({ code: 'STAKE_NODE_HTTP', level: 'error', where: where(comp, node), message: `${typeOf(node)} is set to plain http. Stake's RGS answers https only, so on Stake this call fails (http is for a local mock).`, fix: 'Set its Protocol to https (or leave it empty).', ai: `Set the protocol parameter of ${node.label || typeOf(node)} in ${comp.name} to "https".` });
    }
  }
  if (!maths.length && hasManualPlay) {
    const types = new Set(manual.map(({ node }) => typeOf(node)));
    const wiredTrigger = (t: string, port: string) =>
      manual.some(({ comp, node }) => typeOf(node) === t && (comp.graph?.connections || []).some((c) => c.toId === node.id && c.toProperty === port));
    if (!types.has('stake.RGSAuthenticate') || !wiredTrigger('stake.RGSAuthenticate', 'authenticate')) {
      add({ code: 'MANUAL_NO_AUTHENTICATE', level: 'error', message: 'stake.RGSPlay is used but nothing triggers stake.RGSAuthenticate: every other Stake call is refused before it.', fix: 'Trigger Authenticate when the game loads (not from a button).', ai: 'Wire the page/app load signal to stake.RGSAuthenticate.authenticate.' });
    }
    if (!types.has('stake.RGSEndRound') || !wiredTrigger('stake.RGSEndRound', 'endRound')) {
      add({ code: 'MANUAL_NO_END_ROUND', level: 'error', message: 'Nothing triggers stake.RGSEndRound: a winning round is never paid and every next bet is refused (the stuck bonus).', fix: 'Trigger End Round when the LAST event of the round has been shown — automatically, not from a button.', ai: 'Wire the "round finished animating" signal (after the last book event) to stake.RGSEndRound.endRound.' });
    }
    add({
      code: 'MANUAL_STAKE_WIRING',
      level: 'warn',
      message: 'This project drives Stake by hand with the stake.* nodes. Then the game itself must: authenticate on load; play ONCE per bet; show EVERY event of round.state (a bonus is many rounds in one play — never call Play again for a free spin); end the round after the last one; on load, finish a round Authenticate returns as active; in replay mode (?replay=true) make no wallet calls; offer only the modes the uploaded maths has (an unknown mode is refused, as "invalid amount").',
      fix: 'For a game, prefer a Math Component played by the Stake build (no hand wiring); keep the stake.* nodes for test benches.',
      ai: 'Check each of these behaviours in the graph; the safest route is a Math Component and the Stake build, not hand-wired stake.* nodes.'
    });
  }
  if (stakeNodes && maths.length) {
    add({ code: 'HAND_WIRED_STAKE_NODES', level: 'warn', message: `The game has ${stakeNodes} hand-wired Stake RGS node(s) (stake.RGSPlay, stake.RGSEndRound …). A Stake build plays the Math Component from the book by itself (authenticate, play, free rounds, end-round, resume, replay); hand-wired nodes on top of it play and end rounds twice.`, fix: 'Remove the stake.* RGS nodes and let the Stake build connect the Math Component.', ai: 'Delete the stake.RGSAuthenticate / RGSPlay / RGSEndRound / RGSEvent / RGSBalance nodes; the Stake build wires the Math Component to Stake itself. Use the Aggregator outputs stakeBetLevels, rgsBalance and stakeRoundComplete instead.' });
  }

  // ── What Stake's reviewers check ────────────────────────────────────────────────────────────
  const all = texts.map((t) => t.text).join('\n');
  if (!/uncompleted rounds|reload the game|malfunction voids/i.test(all)) {
    add({ code: 'NO_DISCLAIMER', level: 'warn', message: 'No game rules text with Stake\'s mandatory disclaimer was found ("Malfunction voids all wins and plays… reload the game to finish any uncompleted rounds…").', fix: 'Add a rules / info screen with symbol pays, RTP and max win per mode, mode costs, trigger rules and the disclaimer.', ai: 'Add a rules screen with the paytable, RTP and max win for every mode, the cost of each mode, the free-spin trigger and retrigger rules, and Stake\'s mandatory disclaimer.' });
  }
  const social = texts.filter((t) => SOCIAL_WORDS.test(t.text));
  if (social.length) {
    const sample = social.slice(0, 5).map((t) => `"${t.text.slice(0, 40)}" (${t.comp.name})`).join(', ');
    add({ code: 'SOCIAL_MODE_WORDS', level: 'warn', message: `${social.length} text(s) use words Stake.US social mode forbids (bet, buy, pay, cash, …): ${sample}.`, fix: 'When the game is launched with social=true, show the social wording instead (bet→play, buy→play, pay→win, cash→coins).', ai: 'For each listed text, switch to the social-mode wording when the Aggregator output stakeSocial is true (bet→play, buy→play, pays→wins, cash→coins).' });
  }
  add({ code: 'REVIEW_CHECKLIST', level: 'info', message: 'Stake also checks: the spacebar places a bet, a confirmation before any mode costing more than 2×, autoplay asks for confirmation, a sound toggle, every bet level selectable, the win counts up to the final payout, and replay mode works.', fix: 'Check these in the Stake preview before submitting.', ai: 'Verify spacebar betting, the >2× mode confirmation, autoplay confirmation, sound toggle, bet levels from stakeBetLevels and replay in the Stake preview.' });

  return finish(issues, summary);
}

function finish(issues: ReadinessIssue[], summary: ReadinessReport['summary']): ReadinessReport {
  const rank = { error: 0, warn: 1, info: 2 } as const;
  issues.sort((a, b) => rank[a.level] - rank[b.level]);
  const errors = issues.filter((i) => i.level === 'error').length;
  return { ready: errors === 0, errors, warnings: issues.filter((i) => i.level === 'warn').length, issues, summary };
}

/** One request for the AI: the problems it can act on, worded as instructions, errors first. */
export function stakeFixRequest(report: ReadinessReport): string {
  const actionable = report.issues.filter((i) => i.level !== 'info');
  if (!actionable.length) return '';
  const lines = actionable.map((i, n) => `${n + 1}. [${i.code}]${i.where ? ` (${i.where.component}${i.where.label ? ` → ${i.where.label}` : ''})` : ''} ${i.ai}`);
  return [
    'Get this game ready for Stake Engine. The Stake readiness check found:',
    ...lines,
    'Fix them in order, then run stake({action:"readiness"}) again and tell me what is left.'
  ].join('\n');
}
