// What a failed Stake maths export means, in the author's terms — and a request they can hand to the
// XGENIA AI to fix the maths for them.
//
// WHY: the export's failures arrive as one line from XGENIA RGS ("KenoMaths: book 0 (base): the
// component answered {...} with no outputs at all…"). Each is precise, and each assumes the reader
// knows how the RGS plays a component: which request a book sends, what unit the win port is read in,
// why Date.now() breaks a certificate. Authors did not, so every failure became a support thread
// (2026-10-29 … 2026-11-03: an empty compiled engine, a win port in bet units, a Mines Bet that only
// opens a board, a client seed made of the clock). This turns each known failure into what happened,
// what to change, and — when the change is in the maths — a self-contained prompt for the XGENIA AI.
//
// Deliberately dependency-free, like stakeMathsFormat.ts: unit-tested under plain Node
// (tests/deploy/stakeExportDiagnosis.test.ts). The patterns match the messages of XRGS
// `_shared/stake-books.ts` and of stakeMathsExport.ts; a message nothing matches still gets a prompt
// carrying the error verbatim, so an unknown failure is never a dead end.

import type { StakePlaySetup } from './stakeMathsFormat';

export interface StakeExportContext {
  gameName?: string | null;
  componentName?: string | null;
  winOutputPort?: string | null;
  betInputPort?: string | null;
  bet?: number | null;
  playSetups?: StakePlaySetup[];
}

export interface StakeExportDiagnosis {
  /** Stable id of the failure, for tests and telemetry. */
  code:
    | 'no_outputs'
    | 'never_pays'
    | 'stale_compile'
    | 'error_output'
    | 'same_every_book'
    | 'ambiguous_round'
    | 'not_reproducible'
    | 'blocked_code'
    | 'maths_threw'
    | 'no_win_port'
    | 'bad_play_setup'
    | 'stake_format'
    | 'rgs_out_of_date'
    | 'not_connected'
    | 'editor_runtime'
    | 'unknown';
  title: string;
  /** What went wrong, in plain words. */
  whatHappened: string;
  /** What to do, in order. */
  fix: string[];
  /** True when the fix is a change to the maths component, which the XGENIA AI can make. */
  fixableByAi: boolean;
  /** The request to paste into the XGENIA AI; empty when the fix is not in the maths. */
  aiPrompt: string;
  /** The message as the export produced it. */
  rawError: string;
}

const RGS_RULES = [
  'The win output port is read as the round\'s TOTAL WIN in whole minor units of the stake (cents for EUR) — e.g. a 1.5x win on a 100-cent stake is 150, not 1.5.',
  'All randomness must come from the round\'s RNG (rgsRandom() / ctx.rng, or a True Random Number Generator node). No Math.random(), crypto, Date.now(), timestamps or counters in any seed or outcome — every round must replay identically from its seed.',
  'Every signal the game sends must reach the node that handles it: a Component Inputs signal port wired to the engine, which handles it (in a Javascript2 node, Script.Signals.<SameName>).',
  'No network calls, timers, or host globals (fetch, setTimeout, window, globalThis).',
];

function quote(s: string | null | undefined, fallback: string): string {
  return s ? `"${s}"` : fallback;
}

function prompt(ctx: StakeExportContext, raw: string, problem: string, asks: string[]): string {
  return [
    `I'm exporting the Math Component ${quote(ctx.componentName, 'of my game')}${ctx.gameName ? ` (game "${ctx.gameName}")` : ''} to Stake Engine, and the export fails.`,
    '',
    'The error from the export:',
    raw,
    '',
    `What is wrong: ${problem}`,
    '',
    'Please change the maths component so that:',
    ...asks.map((a) => `- ${a}`),
    '',
    'Rules XGENIA RGS enforces — keep them while you edit:',
    ...RGS_RULES.map((r) => `- ${r}`),
    ...(ctx.winOutputPort ? [`- This component's win output port is "${ctx.winOutputPort}"${ctx.betInputPort ? ` and its stake arrives on "${ctx.betInputPort}"` : ''}.`] : []),
    '',
    'Tell me exactly what you changed. I will redeploy the component and export to Stake again.',
  ].join('\n');
}

/** The component name the RGS prefixes its messages with ("KenoMaths: …"), removed. */
function stripComponent(raw: string, ctx: StakeExportContext): string {
  const name = ctx.componentName;
  if (name && raw.startsWith(`${name}: `)) return raw.slice(name.length + 2);
  return raw.replace(/^[A-Za-z0-9_ -]{1,60}: (?=book \d|Every one|[Tt]his component|uses |round_request|Stake mode|the component answered|[Pp]layed as)/, '');
}

/**
 * Where the RGS's automatic play-setup search (XRGS _shared/stake-autoplay.ts) appends what else it
 * tried. Everything before it is what the game's own request did — the request the game really sends,
 * so the one to explain — and after it, the closest alternative. Advice to "add a Play setup" is moot
 * once the export has searched for one itself.
 */
const SEARCHED = / The export also played (\d+) other requests across ([^;]+);/;

export function diagnoseStakeExportError(error: unknown, ctx: StakeExportContext = {}): StakeExportDiagnosis {
  const rawError = String((error as any)?.message ?? error ?? 'Unknown error');
  // The export prefixes a failure in one of several modes with the mode's name.
  const modeOf = /^Mode ([a-z0-9_]{1,40}): (?!book \d)/.exec(rawError);
  const unmoded = modeOf ? rawError.slice(modeOf[0].length) : rawError;
  const searched = SEARCHED.exec(unmoded);
  if (searched) {
    const head = diagnoseOne(rawError, stripComponent(unmoded.slice(0, searched.index), ctx), ctx);
    const tail = unmoded.slice(searched.index + 1);
    const where = modeOf ? ` in mode "${modeOf[1]}"` : '';
    const note =
      `Before giving up, the export played ${Number(searched[1]).toLocaleString()} other requests${where} — every trigger (${searched[2]}), ` +
      'with the inputs the maths reads and with seeding steps — and none was a whole paid round it could put in a book. So the maths itself has to change.';
    return {
      ...head,
      whatHappened: `${head.whatHappened}\n\n${note}`,
      fix: head.fix.filter((f) => !/Play setup/.test(f)),
      aiPrompt: head.aiPrompt ? `${head.aiPrompt}\n\nWhat the export tried besides: ${tail}` : '',
    };
  }
  const d = diagnoseOne(rawError, stripComponent(unmoded, ctx), ctx);
  return modeOf ? { ...d, whatHappened: `Mode "${modeOf[1]}": ${d.whatHappened}` } : d;
}

function diagnoseOne(rawError: string, msg: string, ctx: StakeExportContext): StakeExportDiagnosis {
  const win = quote(ctx.winOutputPort, 'the win output');
  const base = { rawError };
  let m: RegExpExecArray | null;

  // (2026-11-03) The RGS reads this straight off the deployed script (component-triggers.ts
  // signalsWiredAsData): the compiler, not the maths, is at fault — so no AI request, which would only
  // send the author rewiring a graph that is already right.
  if ((m = /compiled by an editor from before (\S+): its signals? (.+?) reach(?:es)? its engine as plain values/.exec(msg))) {
    const [, date, signals] = m;
    return {
      ...base, code: 'stale_compile', title: 'Redeploy this component',
      whatHappened:
        `This Math Component on XGENIA RGS was compiled by an editor from before ${date}. That compiler passed its signal inputs (${signals}) ` +
        'to the engine as plain values, so the engine never sees one fire and no round can play — not on Stake, and not for a player either. ' +
        'Your maths and wiring are fine; the deployed copy is just out of date. The export rebuilds such a copy by itself, ' +
        'but this one could not be rebuilt from the open project.',
      fix: [
        'Open the project this Math Component was built in, and export to Stake from there — the export rebuilds and redeploys it by itself.',
        `If it still says this, the editor itself predates ${date}: update or rebuild it, then export again.`,
      ],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if ((m = /answered (\{.*?\}) with no outputs at all/.exec(msg) ?? /[Pp]layed as (.+?), the component answered with no outputs at all/.exec(msg))) {
    const request = m[1];
    const trigger = /"is([A-Za-z0-9_]+)":true/.exec(request)?.[1] ?? /^(?:after .+?, )?([A-Za-z0-9_]+)/.exec(request.replace(/, the game's own request$/, ''))?.[1] ?? null;
    const problem =
      `XGENIA RGS played the round by sending ${request}, and the component returned no outputs at all — the node that should play the round never ran. ` +
      `Either the signal ${quote(trigger, 'that starts the round')} is not wired from Component Inputs to the engine that handles it (or the handler has a different name), ` +
      'or the component was deployed by an older editor whose compiler dropped Javascript2 code.';
    return {
      ...base, code: 'no_outputs', title: 'The maths did not run',
      whatHappened: problem,
      fix: [
        'Rebuild the editor (or update it), then redeploy this Math Component, and export again.',
        `If it still fails: check that the Component Inputs signal ${quote(trigger, 'that starts the round')} is wired to the engine node, and that the engine handles a signal of that exact name.`,
        'Or ask the XGENIA AI to check the wiring — copy the request below.',
      ],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        `the Component Inputs signal ${quote(trigger, 'that starts a round')} is wired to the engine node and actually starts a round there (in a Javascript2 node: Script.Signals.${trigger ?? '<Name>'} = function () { … });`,
        `that round always writes ${win} (0 on a loss), plus its other outputs;`,
        'nothing the round needs is missing from that request — if it needs a value the request does not carry, use a sensible default in the maths.',
      ]),
    };
  }

  if ((m = /the component answered (.+?) with the error output (.+)$/.exec(msg))) {
    const [, request, output] = m;
    const problem =
      `Played as ${request}, every round came back with the error output ${output.replace(/\.$/, '')} instead of a result — the maths refuses the request the game sends. ` +
      'Usually the round needs an input that request does not carry, or it is refused in the state a fresh session opens in.';
    return {
      ...base, code: 'error_output', title: 'The maths refuses the round',
      whatHappened: problem,
      fix: ['Ask the XGENIA AI to make that request play a round (copy below), redeploy, and export again.'],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        'the request above plays a whole round from a fresh session instead of answering with that error;',
        'any input the round needs but the request does not carry gets a sensible default in the maths.',
      ]),
    };
  }

  if ((m = /all (\d+) books are the same round/.exec(msg))) {
    const problem =
      `Every one of ${m[1]} rounds, each played from its own RNG, came out exactly the same — the outcome does not come from the round's RNG. ` +
      'Typically a provably-fair engine places its outcome from a seed it keeps in state, and nothing in a fresh session mints that seed from the RNG.';
    return {
      ...base, code: 'same_every_book', title: 'Every round is the same',
      whatHappened: problem,
      fix: ['Ask the XGENIA AI to draw the outcome (or its seed) from the RNG (copy below), redeploy, and export again.'],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        "each round's outcome comes from the round's RNG (rgsRandom() / the TRNG node) — directly, or through a seed the round mints from it when none exists yet;",
        'two rounds with different RNG values can come out differently.',
      ]),
    };
  }

  if ((m = /Every one of the (\d+) books (?:in mode "([^"]+)"|played as (.+?)) pays 0/.exec(msg))) {
    const problem =
      `All ${Number(m[1]).toLocaleString()} rounds ${m[2] ? `of mode "${m[2]}"` : `played as ${m[3]}`} paid nothing, so there is no game for Stake to publish (it would reject the upload with ERR_MATH_OUTSIDE_RANGE). ` +
      `Usually ${win} carries a multiplier or a value in bet units (1.5) instead of the win in minor units (150); ` +
      'or the request each round is played from only STARTS a round that later requests finish (bet → reveal → cash out); or the maths refuses that request.';
    return {
      ...base, code: 'never_pays', title: 'No round ever pays',
      whatHappened: problem,
      fix: [
        `Check what ${win} outputs on a winning round: it must be the total win in minor units of the stake. If it is a multiplier, ask the XGENIA AI to fix it (copy below).`,
        'If one round takes several requests (Mines: bet, reveal, cash out), add a Play setup naming the single request that plays a whole round, e.g. an auto-play trigger with its inputs.',
        'If the component reports an error output, read it in the first book of the export — the request may be missing an input the maths requires.',
      ],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        `${win} is the round's total win as a whole number of minor units of the stake (stake × multiplier), and 0 only on a losing round;`,
        'a round played from the request the export sends can actually win — if it needs an input that is not sent, the maths uses a sensible default;',
        'if a round needs several requests to finish, there is one trigger that plays a whole round in a single request (an auto-play), and tell me its name and inputs.',
      ]),
    };
  }

  if ((m = /fires on (.+?); the export needs to know which one is the paid round/.exec(msg))) {
    const triggers = m[1];
    return {
      ...base, code: 'ambiguous_round', title: 'Which input plays the round?',
      whatHappened: `The component has several signal inputs (${triggers}) and none is clearly the paid round, so the export cannot tell which request plays one round.`,
      fix: [
        'Add a Play setup that names the trigger which plays one whole round, e.g.:',
        `[{ "name": "base", "trigger": "<one of: ${triggers}>" }]`,
      ],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if (/paid differently when played again from the same seed/.test(msg)) {
    const problem =
      'The same round, replayed from the same seed, paid differently — so no round in this package could be re-derived for a dispute or a test lab, and Stake/certification would reject it. ' +
      "The maths draws on something other than the round's RNG: typically Date.now(), a timestamp or a counter feeding a seed (for example a provably-fair client seed) or an outcome.";
    return {
      ...base, code: 'not_reproducible', title: 'Rounds are not reproducible',
      whatHappened: problem,
      fix: ['Ask the XGENIA AI to remove the non-RNG input from the maths (copy below), redeploy, and export again.'],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        'no seed, nonce or outcome depends on Date.now(), the time, a counter that survives between sessions, or anything else that is not the round\'s RNG;',
        'every seed (server seed, client seed) is derived only from the RNG value the round is given;',
        'replaying a round from the same RNG gives exactly the same result.',
      ]),
    };
  }

  if ((m = /uses (.+?)(?: on line (\d+))?, which the RGS sandbox blocks — ([^.]+)/.exec(msg))) {
    const [, construct, line, reason] = m;
    const problem = `The maths uses ${construct}${line ? ` (line ${line} of the compiled script)` : ''}, which XGENIA RGS does not allow: ${reason}.`;
    return {
      ...base, code: 'blocked_code', title: `The maths uses ${construct}`,
      whatHappened: problem,
      fix: [`Ask the XGENIA AI to replace ${construct} (copy below), redeploy, and export again. The live server refuses this code too.`],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [`${construct} is gone, replaced by something the RGS allows (randomness from rgsRandom(), no host access), with the game behaving the same.`]),
    };
  }

  if ((m = /book (\d+) \(([^,]+), (?:call \d+|setup step \d+[^)]*)\) threw: ([\s\S]*)/.exec(msg)) || (m = /[Pp]layed as (.+?), the maths threw: ([\s\S]*)/.exec(msg))) {
    const problem = m.length === 4
      ? `The maths crashed while playing round ${m[1]} of mode "${m[2]}": ${m[3].trim()}`
      : `The maths crashed when played as ${m[1]}: ${m[2].trim()}`;
    return {
      ...base, code: 'maths_threw', title: 'The maths crashed',
      whatHappened: problem,
      fix: ['Ask the XGENIA AI to fix the crash (copy below), redeploy, and export again.'],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, [
        'the round no longer throws that error;',
        'an input the round cannot use is reported through an error output instead of throwing.',
      ]),
    };
  }

  if (/declares no win_output_port/.test(msg)) {
    const problem = 'The component has no win output port, so nothing says how much a round pays — Stake needs that number for every round.';
    return {
      ...base, code: 'no_win_port', title: 'No win output',
      whatHappened: problem,
      fix: ['Give the component an output carrying the round\'s total win, select it as the win port when deploying, redeploy, and export again.'],
      fixableByAi: true,
      aiPrompt: prompt(ctx, rawError, problem, ['it has a Component Outputs port carrying the round\'s total win in minor units of the stake (0 on a loss), written by every round, and tell me its name so I can pick it as the win port.']),
    };
  }

  if (/round_request|Stake mode name|setup step \d+ .* paid|Play setups? |Two play setups/.test(msg)) {
    return {
      ...base, code: 'bad_play_setup', title: 'The Play setup needs fixing',
      whatHappened: msg.replace(/round_request\.?/g, 'play setup '),
      fix: ['Edit the Play setups field in this tab: each entry is { "name", "trigger", "inputs"?, "before"? }, the trigger must be one of the component\'s signal inputs, and the inputs may not include the stake or a trigger.'],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if (/would be refused by Stake/.test(msg)) {
    return {
      ...base, code: 'stake_format', title: 'Stake would refuse the files',
      whatHappened: msg,
      fix: ['This is a fault in the export, not your maths. Send this message to XGENIA support.'],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if (/out of date|Invalid action/i.test(msg)) {
    return {
      ...base, code: 'rgs_out_of_date', title: 'XGENIA RGS is out of date',
      whatHappened: 'The RGS you are connected to does not know this export yet.',
      fix: ['Redeploy the maths-deployer function to that RGS (or ask XGENIA support), then export again.'],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if (/Unauthorized|Invalid API key|Invalid or expired session|Failed to fetch|ECONNREFUSED|NetworkError/i.test(msg)) {
    return {
      ...base, code: 'not_connected', title: 'Cannot reach XGENIA RGS',
      whatHappened: 'The export could not talk to XGENIA RGS with your key — the key was replaced or revoked, or the server is not reachable.',
      fix: ['Reconnect in the Maths RGS panel with a current API key, check the server is running, then export again.'],
      fixableByAi: false, aiPrompt: '',
    };
  }

  if (/zstd/.test(msg)) {
    return {
      ...base, code: 'editor_runtime', title: 'Update the editor',
      whatHappened: msg,
      fix: ['Update the XGENIA editor, then export again.'],
      fixableByAi: false, aiPrompt: '',
    };
  }

  const problem = 'The export stopped with an error the editor does not recognise.';
  return {
    ...base, code: 'unknown', title: 'The export failed',
    whatHappened: `${problem} ${msg}`,
    fix: ['If the error is about the maths, ask the XGENIA AI (copy below). Otherwise send the error to XGENIA support.'],
    fixableByAi: true,
    aiPrompt: prompt(ctx, rawError, problem, ['the error above no longer happens when the RGS plays a round, explaining what caused it.']),
  };
}
