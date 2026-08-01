/**
 * Simulation Engine — runs a deployed RGS component's script in the editor.
 *
 * PORT of `apps/studio/lib/rgs/simulation-engine.ts` in the XRGS repo (which is
 * itself a port of the batch-run edge function), so the editor's Simulate view
 * reports the same RTP / hit frequency / volatility figures as a game's Testing
 * subsection on the RGS platform. Kept byte-identical to that file wherever the
 * code is shared, so the two stay comparable; if you change the maths here,
 * change it there too.
 *
 * Trimmed to the SCRIPT path only. The studio's config path (reel strips +
 * paytable evaluation, `mathsMode: 'config'`) has no caller here: the editor
 * simulates deployed edge-function components, and those always carry an
 * executable script.
 *
 * Contains:
 * - ISAAC CSPRNG (ported from supabase/functions/_shared/isaac.ts)
 * - Script Sandbox (ported from supabase/functions/_shared/script-sandbox.ts)
 * - Batch Simulation Runner
 */

// ═══════════════════════════════════════════════════════════════
// ISAAC CSPRNG
// ═══════════════════════════════════════════════════════════════

const ISAAC_SIZE = 256

class Isaac {
    private mem: Uint32Array
    private rsl: Uint32Array
    private acc: number
    private brs: number
    private cnt: number
    private gnt: number

    constructor(seed?: Uint32Array | number[]) {
        this.mem = new Uint32Array(ISAAC_SIZE)
        this.rsl = new Uint32Array(ISAAC_SIZE)
        this.acc = 0
        this.brs = 0
        this.cnt = 0
        this.gnt = 0

        if (seed) {
            const len = Math.min(seed.length, ISAAC_SIZE)
            for (let i = 0; i < len; i++) {
                this.rsl[i] = seed[i]
            }
        }

        this.init(!!seed)
    }

    static fromEntropy(): Isaac {
        const seed = new Uint32Array(ISAAC_SIZE)
        crypto.getRandomValues(seed)
        return new Isaac(seed)
    }

    random(): number {
        return this.next() / 0x100000000
    }

    private next(): number {
        if (this.gnt >= ISAAC_SIZE) {
            this.isaac()
            this.gnt = 0
        }
        return this.rsl[this.gnt++] >>> 0
    }

    private isaac(): void {
        let x: number, y: number
        this.cnt++
        this.brs += this.cnt

        for (let i = 0; i < ISAAC_SIZE; i++) {
            x = this.mem[i]
            switch (i & 3) {
                case 0: this.acc ^= this.acc << 13; break
                case 1: this.acc ^= this.acc >>> 6; break
                case 2: this.acc ^= this.acc << 2; break
                case 3: this.acc ^= this.acc >>> 16; break
            }
            this.acc = (this.mem[(i + 128) & 0xff] + this.acc) >>> 0
            y = (this.mem[(x >>> 2) & 0xff] + this.acc + this.brs) >>> 0
            this.mem[i] = y
            this.brs = (this.mem[(y >>> 10) & 0xff] + x) >>> 0
            this.rsl[i] = this.brs
        }
    }

    private init(flag: boolean): void {
        let a = 0x9e3779b9
        let b = a, c = a, d = a, e = a, f = a, g = a, h = a

        const mix = () => {
            a ^= b << 11; d = (d + a) >>> 0; b = (b + c) >>> 0
            b ^= b >>> 2; e = (e + b) >>> 0; c = (c + d) >>> 0
            c ^= c << 8; f = (f + c) >>> 0; d = (d + e) >>> 0
            d ^= d >>> 16; g = (g + d) >>> 0; e = (e + f) >>> 0
            e ^= e << 10; h = (h + e) >>> 0; f = (f + g) >>> 0
            f ^= f >>> 4; a = (a + f) >>> 0; g = (g + h) >>> 0
            g ^= g << 8; b = (b + g) >>> 0; h = (h + a) >>> 0
            h ^= h >>> 9; c = (c + h) >>> 0; a = (a + b) >>> 0
        }

        for (let i = 0; i < 4; i++) mix()

        for (let i = 0; i < ISAAC_SIZE; i += 8) {
            if (flag) {
                a = (a + this.rsl[i]) >>> 0
                b = (b + this.rsl[i + 1]) >>> 0
                c = (c + this.rsl[i + 2]) >>> 0
                d = (d + this.rsl[i + 3]) >>> 0
                e = (e + this.rsl[i + 4]) >>> 0
                f = (f + this.rsl[i + 5]) >>> 0
                g = (g + this.rsl[i + 6]) >>> 0
                h = (h + this.rsl[i + 7]) >>> 0
            }
            mix()
            this.mem[i] = a; this.mem[i + 1] = b
            this.mem[i + 2] = c; this.mem[i + 3] = d
            this.mem[i + 4] = e; this.mem[i + 5] = f
            this.mem[i + 6] = g; this.mem[i + 7] = h
        }

        if (flag) {
            for (let i = 0; i < ISAAC_SIZE; i += 8) {
                a = (a + this.mem[i]) >>> 0
                b = (b + this.mem[i + 1]) >>> 0
                c = (c + this.mem[i + 2]) >>> 0
                d = (d + this.mem[i + 3]) >>> 0
                e = (e + this.mem[i + 4]) >>> 0
                f = (f + this.mem[i + 5]) >>> 0
                g = (g + this.mem[i + 6]) >>> 0
                h = (h + this.mem[i + 7]) >>> 0
                mix()
                this.mem[i] = a; this.mem[i + 1] = b
                this.mem[i + 2] = c; this.mem[i + 3] = d
                this.mem[i + 4] = e; this.mem[i + 5] = f
                this.mem[i + 6] = g; this.mem[i + 7] = h
            }
        }

        this.isaac()
        this.gnt = 0
    }
}

// ═══════════════════════════════════════════════════════════════
// SANDBOX TYPES & SCRIPT COMPILATION
// ═══════════════════════════════════════════════════════════════

interface SandboxContext {
    bet: number
    rng: number[]
    state: Record<string, unknown>
    config: Record<string, unknown>
    round: number
}

interface SandboxResult {
    win: number
    data: Record<string, unknown>
    state: Record<string, unknown>
}

const SAFE_GLOBALS: Record<string, unknown> = {
    Math,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
    undefined,
}

const BLOCKED_PATTERNS = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bDeno\b/,
    /\bglobalThis\b/,
    /\bwindow\b/,
    /\b__dirname\b/,
    /\b__filename\b/,
    /\bnew\s+Function\b/,
    /\beval\s*\(/,
    /\b__proto__\b/,
    /\.constructor\s*\(/,
    /\[\s*['"]constructor['"]\s*\]/,
    /\bgetPrototypeOf\s*\(/,
]

const MAX_SCRIPT_SIZE = 256 * 1024

function compileScript(scriptBodyRaw: string): (ctx: SandboxContext) => SandboxResult {
    const scriptBody = scriptBodyRaw.replace(/\\`/g, '`').replace(/\\\$/g, '$')

    if (scriptBody.length > MAX_SCRIPT_SIZE) {
        throw new Error(`Script exceeds maximum size of ${MAX_SCRIPT_SIZE} bytes.`)
    }

    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(scriptBody)) {
            throw new Error(`Blocked: scripts cannot use restricted APIs or language features.`)
        }
    }

    const safeGlobalNames = Object.keys(SAFE_GLOBALS)
    const safeGlobalValues = Object.values(SAFE_GLOBALS)

    const isLegacyScript = /function\s+rgsRandom\s*\(/.test(scriptBody) ||
                           /function\s+evaluate\s*\(\s*ctx\s*\)/.test(scriptBody)

    let runtimePreamble = ''
    if (!isLegacyScript) {
        runtimePreamble =
            '  var _rngIndex = 0;\n' +
            '  function rgsRandom() {\n' +
            '    if (_rngIndex >= ctx.rng.length) _rngIndex = 0;\n' +
            '    return ctx.rng[_rngIndex++];\n' +
            '  }\n' +
            '  function rgsRandomInt(min, max) {\n' +
            '    return Math.floor(rgsRandom() * (max - min + 1)) + min;\n' +
            '  }\n' +
            '  var config = ctx.config || {};\n' +
            '  var bet = ctx.bet || config.bet || 0;\n' +
            '  var _manifest = config._portManifest || {};\n' +
            '  var _inputs = _manifest.inputs || [];\n' +
            '  for (var _i = 0; _i < _inputs.length; _i++) {\n' +
            '    var _p = _inputs[_i];\n' +
            '    if (!(_p.name in config)) {\n' +
            '      if (_p.type === "signal" || _p.type === "boolean") {\n' +
            '        config[_p.name] = true;\n' +
            '      } else if (_p.type === "string") {\n' +
            '        config[_p.name] = "default";\n' +
            '      } else {\n' +
            '        config[_p.name] = rgsRandom() * 100;\n' +
            '      }\n' +
            '    }\n' +
            '  }\n'
    }

    const wrappedCode =
        '"use strict";\n' +
        'const fetch = undefined;\n' +
        'const XMLHttpRequest = undefined;\n' +
        'const WebSocket = undefined;\n' +
        'const Deno = undefined;\n' +
        'const globalThis = undefined;\n' +
        'const self = undefined;\n' +
        'const window = undefined;\n' +
        'const process = undefined;\n' +
        'const require = undefined;\n' +
        'const __dirname = undefined;\n' +
        'const __filename = undefined;\n' +
        '\n' +
        'return (function evaluate(ctx) {\n' +
        runtimePreamble +
        scriptBody + '\n' +
        '});\n'

    try {
        const factory = new Function(...safeGlobalNames, 'ctx', wrappedCode)
        const evaluateFn = factory(...safeGlobalValues)

        if (typeof evaluateFn !== 'function') {
            throw new Error('Script did not produce a valid evaluate function')
        }

        return (ctx: SandboxContext): SandboxResult => {
            return executeWithGuards(evaluateFn, ctx)
        }
    } catch (err) {
        const errMsg = (err as Error).message || ''
        throw new Error('Script compilation failed: ' + errMsg)
    }
}

function executeWithGuards(
    evaluateFn: (ctx: SandboxContext) => unknown,
    ctx: SandboxContext
): SandboxResult {
    const frozenCtx: SandboxContext = {
        bet: ctx.bet,
        rng: [...ctx.rng],
        state: JSON.parse(JSON.stringify(ctx.state)),
        config: JSON.parse(JSON.stringify(ctx.config)),
        round: ctx.round,
    }

    let result: unknown
    try {
        result = evaluateFn(frozenCtx)
    } catch (err) {
        throw new Error(`Script execution error: ${(err as Error).message}`)
    }

    if (!result || typeof result !== 'object') {
        throw new Error('evaluate() must return an object with { data, state }')
    }

    const r = result as Record<string, unknown>
    const data = (r.data as Record<string, unknown>) || {}

    let win = 0
    if (typeof r.win === 'number' && isFinite(r.win as number) && (r.win as number) >= 0) {
        win = Math.floor(r.win as number)
    } else {
        // 'spinWinnings' is emitted by maths scripts generated before the round rename.
        const candidates = ['win', 'totalWin', 'totalPayout', 'totalWinnings', 'roundWinnings', 'spinWinnings', 'payout', 'total']
        for (const key of candidates) {
            const v = data[key]
            if (typeof v === 'number' && isFinite(v) && v >= 0) {
                win = Math.floor(v)
                break
            }
        }
    }

    return { win, data, state: (r.state as Record<string, unknown>) || {} }
}

// ═══════════════════════════════════════════════════════════════
// BATCH SIMULATION RUNNER
// ═══════════════════════════════════════════════════════════════

const RNG_FLOATS_PER_ROUND = 100

// Name pool used to synthesize random values for string-type input ports
// (see `strRngPorts`), mirroring the numeric/boolean per-round randomizers.
const RANDOM_NAME_POOL = [
    'Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie', 'Avery',
    'Quinn', 'Skyler', 'Cameron', 'Drew', 'Reese', 'Sage', 'Rowan', 'Phoenix',
    'Nova', 'Ari', 'Devon', 'Emery', 'Finley', 'Harper', 'Kai', 'Lennox',
]

export interface BatchSimulationParams {
    /** The component's deployed evaluate(ctx) body. */
    script: string
    numRounds: number
    betAmount: number
    inputOverrides: Record<string, any>
    rngPorts?: Record<string, { min: number; max: number }>
    /** Port names to randomize as a 50/50 boolean each round. */
    boolRngPorts?: string[]
    /** Port names to fill with a random name/string each round. */
    strRngPorts?: string[]
    betInputPort?: string
    winOutputPort?: string
    /**
     * How many points to sample onto `series` (the RTP / hit-frequency /
     * volatility convergence curves). The run is bucketed into this many even
     * slices regardless of round count, so a 100-round and a 10M-round run both
     * plot at the same width.
     */
    seriesPoints?: number
}

/**
 * One sampled point on the convergence curves plotted under Simulation Results.
 *
 * Every value is CUMULATIVE (running to that round), not per-bucket — that's what
 * makes the curves readable: they show each statistic settling towards its final
 * value instead of the raw per-round noise, which no amount of interpolation
 * smoothing would tame.
 */
export interface SimulationSeriesPoint {
    /** Rounds evaluated at the moment this point was sampled. */
    round: number
    /** Running RTP up to this round, as a percentage. */
    rtp: number
    /** Running hit frequency up to this round, as a percentage. */
    hitRate: number
    /** Running standard deviation of the per-round win/bet ratio. */
    volatility: number
}

const DEFAULT_SERIES_POINTS = 60
// A bonus-heavy component re-runs rounds inside a feature (see the `s--` path),
// so the sample count can drift past `seriesPoints`. Cap it so the chart payload
// stays small no matter how the maths behaves.
const MAX_SERIES_POINTS = 400

export interface BatchSimulationResult {
    rounds: number
    betAmount: number
    rtp: number
    rtpPercent: string
    baseRtp: number
    bonusRtp: number
    hitRate: number
    /** Standard deviation of the per-round win/bet ratio. */
    volatility: number
    /** Volatility band derived from `volatility` (low … very-high). */
    volatilityClass: string
    maxMultiplier: number
    maxWin: number
    totalBet: number
    totalWin: number
    totalBaseWin: number
    totalBonusWin: number
    houseEdge: string
    bonusTriggers: number
    bonusFrequency: string
    avgBonusWin: number
    bonusRoundsPlayed: number
    elapsedMs: number
    roundsPerSecond: number
    portTotals: Record<string, number>
    /** Sampled convergence curves for RTP, hit frequency and volatility. */
    series: SimulationSeriesPoint[]
}

export function runBatchSimulation(params: BatchSimulationParams): BatchSimulationResult {
    const {
        script,
        numRounds,
        betAmount,
        inputOverrides,
        rngPorts,
        boolRngPorts,
        strRngPorts,
        betInputPort,
        winOutputPort,
        seriesPoints,
    } = params

    // Build the evaluate function
    const evaluateFn: (ctx: SandboxContext) => SandboxResult = compileScript(script)

    // Run the simulation
    const rng = Isaac.fromEntropy()
    const t0 = performance.now()

    let totalBet = 0
    let totalWin = 0
    let totalBaseWin = 0
    let totalBonusWin = 0
    let hits = 0
    let maxMultiplier = 0
    let maxWin = 0
    let bonusTriggers = 0
    let bonusRoundsPlayed = 0
    let state: Record<string, unknown> = {}
    let roundCount = 0
    const portTotals: Record<string, number> = {}
    // Volatility: running sum + sum-of-squares of the per-round win/bet ratio.
    let sumRatio = 0
    let sumRatioSq = 0
    let ratioCount = 0

    // Convergence curves: sample the running statistics every `sampleEvery`
    // rounds so the charts get a fixed-width series whatever the round count.
    const targetPoints = Math.max(2, Math.min(MAX_SERIES_POINTS, Math.floor(seriesPoints ?? DEFAULT_SERIES_POINTS)))
    const sampleEvery = Math.max(1, Math.ceil(numRounds / targetPoints))
    const series: SimulationSeriesPoint[] = []
    const sampleSeries = () => {
        const rtpNow = totalBet > 0 ? (totalWin / totalBet) * 100 : 0
        // Denominator is rounds EVALUATED (feature rounds included), which is what
        // `hits` counts. With no feature this equals numRounds, so the last point
        // lands on the headline hit-frequency figure.
        const hitNow = roundCount > 0 ? (hits / roundCount) * 100 : 0
        const meanNow = ratioCount > 0 ? sumRatio / ratioCount : 0
        const varNow = ratioCount > 0 ? Math.max(0, sumRatioSq / ratioCount - meanNow * meanNow) : 0
        series.push({
            round: roundCount,
            rtp: Math.round(rtpNow * 10_000) / 10_000,
            hitRate: Math.round(hitNow * 10_000) / 10_000,
            volatility: Math.round(Math.sqrt(varNow) * 10_000) / 10_000,
        })
    }

    for (let s = 0; s < numRounds; s++) {
        const rngFloats: number[] = []
        for (let i = 0; i < RNG_FLOATS_PER_ROUND; i++) {
            rngFloats.push(rng.random())
        }

        const inFeature = !!state.in_feature

        // Generate per-round random values for RNG-mode ports with custom ranges
        const perRoundOverrides: Record<string, any> = { ...inputOverrides }
        if (rngPorts) {
            for (const [portName, range] of Object.entries(rngPorts)) {
                const min = Math.max(1, Math.floor(range.min))
                const max = Math.max(min, Math.floor(range.max))
                perRoundOverrides[portName] = Math.floor(rng.random() * (max - min + 1)) + min
            }
        }
        if (boolRngPorts) {
            for (const portName of boolRngPorts) {
                perRoundOverrides[portName] = rng.random() < 0.5
            }
        }
        if (strRngPorts) {
            for (const portName of strRngPorts) {
                const first = RANDOM_NAME_POOL[Math.floor(rng.random() * RANDOM_NAME_POOL.length)]
                perRoundOverrides[portName] = `${first}${Math.floor(rng.random() * 1000)}`
            }
        }

        // The stake this round: whatever the caller's input configuration put on
        // the bet port (a fixed value, or that round's RNG draw), falling back to
        // the flat `betAmount`.
        //
        // It has to reach ctx.bet, not just the config payload: a graph whose
        // Component Inputs port is named `betAmount` compiles to the sandbox's
        // `bet` variable rather than `config.betAmount` (see the Component Inputs
        // mapping in supabase-converter.ts). Passing the stake through config
        // alone left such maths scaling every win off bet = 1 while the RTP
        // denominator below counted the configured stake — an RTP wrong by
        // exactly the bet multiple.
        let iterBet = betAmount
        if (betInputPort && typeof perRoundOverrides[betInputPort] === 'number') {
            iterBet = perRoundOverrides[betInputPort] as number
        }

        const ctx: SandboxContext = {
            bet: iterBet,
            rng: rngFloats,
            state,
            config: { ...perRoundOverrides },
            round: roundCount,
        }

        const result = evaluateFn(ctx)
        roundCount++

        // Accumulate named output port totals
        if (result.data && typeof result.data === 'object') {
            for (const [k, v] of Object.entries(result.data)) {
                if (typeof v === 'number' && isFinite(v)) {
                    portTotals[k] = (portTotals[k] ?? 0) + v
                }
            }
        }

        // Accumulate input override values for port-based RTP
        for (const [k, v] of Object.entries(perRoundOverrides)) {
            if (typeof v === 'number' && isFinite(v)) {
                portTotals[k] = (portTotals[k] ?? 0) + v
            }
        }

        let iterWin = result.win
        if (winOutputPort && result.data && typeof result.data[winOutputPort] === 'number') {
            iterWin = result.data[winOutputPort] as number
        }

        if (!inFeature) totalBet += iterBet
        totalWin += iterWin

        if (inFeature) {
            totalBonusWin += iterWin
            bonusRoundsPlayed++
        } else {
            totalBaseWin += iterWin
        }

        if (iterWin > 0) hits++
        
        const currentWinRatio = iterBet > 0 ? iterWin / iterBet : 0
        if (currentWinRatio > maxWin) maxWin = currentWinRatio
        if (currentWinRatio > maxMultiplier) maxMultiplier = currentWinRatio

        if (!inFeature) {
            sumRatio += currentWinRatio
            sumRatioSq += currentWinRatio * currentWinRatio
            ratioCount++
        }

        if (roundCount % sampleEvery === 0 && series.length < MAX_SERIES_POINTS) sampleSeries()

        state = result.state || {}

        if (!inFeature && state.in_feature) bonusTriggers++

        if (state.in_feature && (state.feature_rounds_remaining as number) > 0) {
            if (bonusRoundsPlayed > 500) {
                console.warn('batch-run: bonus round cap reached, breaking out of feature')
                state = {}
            } else {
                s--
            }
        } else if (!state.in_feature && bonusRoundsPlayed > 0) {
            bonusRoundsPlayed = 0
        }


    }

    // Always close the curves on the final round, so the last plotted point is the
    // same figure as the headline statistic beside it.
    if (series.length === 0 || series[series.length - 1].round !== roundCount) sampleSeries()

    const elapsed = performance.now() - t0

    let calcTotalBet = totalBet
    let calcTotalWin = totalWin

    const rtpVal = calcTotalBet > 0 ? calcTotalWin / calcTotalBet : 0
    const baseRtp = calcTotalBet > 0 ? totalBaseWin / calcTotalBet : 0
    const bonusRtp = calcTotalBet > 0 ? totalBonusWin / calcTotalBet : 0
    const hitRate = numRounds > 0 ? (hits / numRounds) * 100 : 0
    // Volatility = std dev of the per-round win/bet ratio (matches the
    // variance-validation convention in stress-test-runner.ts).
    const meanRatio = ratioCount > 0 ? sumRatio / ratioCount : 0
    const varianceRatio = ratioCount > 0 ? Math.max(0, sumRatioSq / ratioCount - meanRatio * meanRatio) : 0
    const volatility = Math.sqrt(varianceRatio)
    const volatilityClass =
        volatility < 2 ? 'low' :
        volatility < 4 ? 'medium' :
        volatility < 7 ? 'medium-high' :
        volatility < 12 ? 'high' : 'very-high'
    const bonusFrequency = numRounds > 0 ? bonusTriggers / numRounds : 0
    const avgBonusWin = bonusTriggers > 0 ? totalBonusWin / bonusTriggers : 0
    const roundsPerSecond = elapsed > 0 ? Math.round(numRounds / (elapsed / 1000)) : 0



    return {
        rounds: numRounds,
        betAmount,
        rtp: Math.round(rtpVal * 1_000_000) / 1_000_000,
        rtpPercent: `${(rtpVal * 100).toFixed(4)}%`,
        baseRtp: Math.round(baseRtp * 1_000_000) / 1_000_000,
        bonusRtp: Math.round(bonusRtp * 1_000_000) / 1_000_000,
        hitRate: Math.round(hitRate * 1_000_000) / 1_000_000,
        volatility: Math.round(volatility * 10_000) / 10_000,
        volatilityClass,
        maxMultiplier: Math.round(maxMultiplier * 100) / 100,
        maxWin,
        totalBet: calcTotalBet,
        totalWin: Math.round(calcTotalWin),
        totalBaseWin: Math.round(totalBaseWin),
        totalBonusWin: Math.round(totalBonusWin),
        houseEdge: `${((1 - rtpVal) * 100).toFixed(4)}%`,
        bonusTriggers,
        bonusFrequency: `1 in ${bonusTriggers > 0 ? Math.round(numRounds / bonusTriggers) : '∞'}`,
        avgBonusWin: Math.round(avgBonusWin),
        bonusRoundsPlayed,
        elapsedMs: Math.round(elapsed * 100) / 100,
        roundsPerSecond,
        portTotals,
        series,
    }
}
