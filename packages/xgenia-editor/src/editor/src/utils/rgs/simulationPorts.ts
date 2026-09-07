// Port typing, input defaults and bet/win inference for the Simulate document.
//
// Mirrors XRGS `apps/studio/lib/rgs/simulation-ports.ts` — the RGS studio's
// Testing tab and this view configure the same run against the same platform
// runner, so they must agree on what a port means and what it defaults to.
//
// A deployed component's port TYPES are not stored anywhere: they are inferred
// from `typeof` each value in the `payload_example` / `response_example` JSON
// that generateFunctionArtifact emitted at deploy time. Everything Simulate
// decides about inputs and outputs starts here.
//
// ─── WHY THE DEFAULTS CHANGED ─────────────────────────────────
//
// Every input port used to default to noise: numbers to a uniform 1–100 draw,
// booleans to a 50/50 coin, strings to a random name — discarding the example
// value the component was actually deployed with.
//
// On a toy component that is merely arbitrary. On the real library it is fatal:
// the widest deployed component declares ~150 input ports, nearly all booleans
// named `isToggle17`, `isDoHalfBet`, `isDoubleBet`, `isDoClear`,
// `isToStartAutoBet` — a game's UI events. Firing every one of them randomly and
// simultaneously, every round, does not exercise the maths; it drives the
// component's state machine into states no player can reach.
//
// So the default is now the port's own declared example, and randomisation is
// something the author turns on for the ports they mean to sweep.

export type PortType = 'number' | 'boolean' | 'string' | 'object' | 'array';

export interface PortInfo {
  name: string;
  type: PortType;
  /** The raw example value from payload_example / response_example. */
  example?: any;
}

/**
 * number → rng | fixed
 * boolean → random | true | false
 * string → random (name gen) | fixed (valueStr)
 * object / array → fixed (JSON valueStr)
 */
export type InputMode = 'rng' | 'fixed' | 'random' | 'true' | 'false';

export interface InputConfig {
  mode: InputMode;
  value: number;
  valueStr: string;
  rngMin: number;
  rngMax: number;
}

/** Stake used when the bet port's own example is zero, or no bet port is chosen. */
export const DEFAULT_STAKE = 1;

/**
 * Field names the platform sandbox accepts as "the win", in priority order.
 *
 * Mirrors the candidate list in `_shared/script-sandbox.ts` — the value the
 * platform pays out when a script returns no explicit `win`. Used here to pick a
 * sensible default Win Output port instead of guessing.
 */
export const WIN_FIELD_CANDIDATES = [
  'win', 'totalWin', 'winAmount', 'totalPayout', 'totalWinnings',
  'roundWinnings', 'spinWinnings', 'payout', 'total'
];

/** Names that mean "this port carries the stake", matched case-insensitively. */
const BET_NAME_CANDIDATES = [
  'bet', 'betamount', 'betinput', 'betvalue', 'stake', 'wager', 'totalbet', 'betperline'
];

export function portTypeOf(v: unknown): PortType {
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'object' && v !== null) return 'object';
  return 'string';
}

/**
 * Arrays and records can't be RNG-sampled or used as the bet/win port — they're
 * passed through the simulation as a fixed (JSON) value.
 */
export function isComplexType(t: PortType): boolean {
  return t === 'object' || t === 'array';
}

export function safeJsonStringify(v: any): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

export function parseJsonOr(raw: string, fallback: any): any {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function portsFromExample(example: any): PortInfo[] {
  if (!example || typeof example !== 'object') return [];
  return Object.entries(example).map(([name, v]) => ({ name, type: portTypeOf(v), example: v }));
}

/**
 * The starting configuration for a port: whatever the component declared.
 *
 * Everything is `fixed` at the example value. A port only varies when the author
 * asks it to.
 */
export function defaultConfigFor(type: PortType, example?: any): InputConfig {
  const base: InputConfig = { mode: 'fixed', value: 0, valueStr: '', rngMin: 1, rngMax: 100 };

  switch (type) {
    case 'number': {
      const n = typeof example === 'number' && Number.isFinite(example) ? example : 0;
      return { ...base, value: n, valueStr: String(n) };
    }
    case 'boolean':
      return { ...base, mode: example === true ? 'true' : 'false' };
    case 'string':
      return { ...base, valueStr: typeof example === 'string' ? example : '' };
    default:
      return { ...base, valueStr: example !== undefined ? safeJsonStringify(example) : '' };
  }
}

/**
 * Turn the per-port configuration into the four shapes `simulate-component`
 * wants.
 *
 * The single place that decides what a mode MEANS, so the "Running with" summary
 * and the run itself cannot disagree — they both go through here.
 */
export function buildSimulationInputs(
  ports: PortInfo[],
  configs: Record<string, InputConfig>
): {
  inputOverrides: Record<string, any>;
  rngPorts: Record<string, { min: number; max: number }>;
  boolRngPorts: string[];
  strRngPorts: string[];
} {
  const inputOverrides: Record<string, any> = {};
  const rngPorts: Record<string, { min: number; max: number }> = {};
  const boolRngPorts: string[] = [];
  const strRngPorts: string[] = [];

  for (const port of ports) {
    const cfg = configs[port.name] || defaultConfigFor(port.type, port.example);
    if (port.type === 'number') {
      if (cfg.mode === 'rng') {
        const min = Math.floor(cfg.rngMin ?? 1);
        rngPorts[port.name] = { min, max: Math.max(min, Math.floor(cfg.rngMax ?? 100)) };
      } else {
        inputOverrides[port.name] = Number.isFinite(cfg.value) ? cfg.value : 0;
      }
    } else if (port.type === 'boolean') {
      if (cfg.mode === 'true') inputOverrides[port.name] = true;
      else if (cfg.mode === 'false') inputOverrides[port.name] = false;
      else boolRngPorts.push(port.name);
    } else if (isComplexType(port.type)) {
      inputOverrides[port.name] = parseJsonOr(cfg.valueStr, port.type === 'array' ? [] : {});
    } else {
      if (cfg.mode === 'random') strRngPorts.push(port.name);
      else inputOverrides[port.name] = cfg.valueStr ?? '';
    }
  }

  return { inputOverrides, rngPorts, boolRngPorts, strRngPorts };
}

/**
 * One-line recap of what a port feeds the simulation.
 *
 * Reads the same config `buildSimulationInputs` does, so the summary cannot
 * promise something the run does not deliver.
 */
export function describeInputConfig(port: PortInfo, config: InputConfig): string {
  if (port.type === 'number') {
    if (config.mode === 'rng') {
      const min = Math.floor(config.rngMin);
      return `RNG ${min} – ${Math.max(min, Math.floor(config.rngMax))}`;
    }
    return `fixed ${config.valueStr !== '' ? config.valueStr : config.value}`;
  }
  if (port.type === 'boolean') {
    if (config.mode === 'true') return 'always true';
    if (config.mode === 'false') return 'always false';
    return 'random 50/50';
  }
  if (isComplexType(port.type)) {
    const raw = config.valueStr?.trim();
    if (!raw) return port.type === 'array' ? 'fixed []' : 'fixed {}';
    return `fixed ${raw.length > 24 ? `${raw.slice(0, 24)}…` : raw}`;
  }
  return config.mode === 'random' ? 'random name' : `fixed "${config.valueStr}"`;
}

function byName(ports: PortInfo[], candidates: string[]): string {
  const lookup = new Map(ports.map((p) => [p.name.toLowerCase(), p.name]));
  for (const candidate of candidates) {
    const hit = lookup.get(candidate.toLowerCase());
    if (hit) return hit;
  }
  return '';
}

/**
 * Which input port carries the stake.
 *
 * The mapping the component was DEPLOYED with wins: the author said so in the
 * post-compile setup card, and that beats guessing. Only 11 of the 125 deployed
 * components have one stored, though, so the fallbacks matter: a port actually
 * NAMED like a stake, and only then the first numeric port.
 */
export function inferBetInputPort(numericInputs: PortInfo[], stored?: string | null): string {
  if (stored && numericInputs.some((p) => p.name === stored)) return stored;
  return byName(numericInputs, BET_NAME_CANDIDATES) || numericInputs[0]?.name || '';
}

/**
 * Which output port carries the win — or '' meaning "use the value evaluate()
 * returns", which is what `rgs-fn` pays the player.
 *
 * Blind-picking the first numeric-looking output is what this used to do, and on
 * the real library that is close to worst-possible. generateFunctionArtifact
 * emits `0` for any output port it cannot type, so a component's
 * response_example is ~130 keys all reading `0` — `image`, `tileGrid`,
 * `betslipBar`, `gameShell`. First-wins picked `image`, and 109 of 125
 * components have no stored mapping to override it.
 *
 * So: the stored choice, else a port actually named like a win, else nothing —
 * and "nothing" is a correct, working answer, not a missing one.
 */
export function inferWinOutputPort(numericOutputs: PortInfo[], stored?: string | null): string {
  if (stored && numericOutputs.some((p) => p.name === stored)) return stored;
  return byName(numericOutputs, WIN_FIELD_CANDIDATES);
}

/**
 * Make sure the port chosen as the stake actually stakes something.
 *
 * `betInput`'s declared example is `0` on essentially every deployed component
 * (the artifact generator emits `0` for an untyped numeric port), and a run
 * staking zero has no RTP denominator — it reports 0.00% and looks like broken
 * maths rather than a missing stake. Seeding it to the minimum stake is visible
 * in Define Inputs and in the "Running with" summary, so it is a default the
 * author can see and change, not a hidden fudge.
 */
export function seedStakeIfZero(
  configs: Record<string, InputConfig>,
  betPort: string,
  ports: PortInfo[]
): Record<string, InputConfig> {
  if (!betPort) return configs;
  const port = ports.find((p) => p.name === betPort);
  if (!port || port.type !== 'number') return configs;
  const cfg = configs[betPort] || defaultConfigFor(port.type, port.example);
  if (cfg.mode !== 'fixed' || cfg.value > 0) return configs;
  return {
    ...configs,
    [betPort]: { ...cfg, value: DEFAULT_STAKE, valueStr: String(DEFAULT_STAKE) }
  };
}
