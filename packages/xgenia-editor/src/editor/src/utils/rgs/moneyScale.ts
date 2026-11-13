// Money on the wire between a published game and XGENIA RGS is in CENTS.
//
// The RGS ledger counts whole minor units: a bet of 100 is 1.00, a win must be a whole number of
// cents, and a fraction is paid rounded DOWN (rgs-fn win-cap "normalised"). Its own RTP tests stake
// 100 = 1.00 (maths-deployer stress-test). A game graph, though, works in money as the player sees
// it — a 1.00 bet is `1` — so a published plinko sent a bet of 1 (booked as 1 cent) and its 1.08×
// win came back as 1, its 0.98× as 0 (2026-11-03, lobby-rgs-plinko.vercel.app).
//
// Both ends now convert, and the maths in between still sees the money it sees in the editor:
//   * the published page's Aggregator multiplies the bet by MONEY_SCALE and sends
//     `__moneyScale: MONEY_SCALE` with it; it divides the win port (and the RGS balance/win) back;
//   * the deployed script, when the request carries `__moneyScale`, divides the bet before the maths
//     runs and multiplies the win port after it (whole cents, rounded down as the RGS pays), and says
//     so by returning `__moneyScale` in its response.
// Every other output (a second win readout, a feature total) stays in the editor's money on both sides.
// A request WITHOUT the field — an older published page, the RGS's own RTP tests — runs the maths
// exactly as before.
//
// Deliberately dependency-free (unit-tested under plain Node).

/** Cents per unit of money: what both ends multiply and divide by. */
export const MONEY_SCALE = 100;

/** The request field the page sends, and the response field the script answers with. */
export const MONEY_SCALE_FIELD = '__moneyScale';

/** True when a deployed function's response example says its script converts (see withMoneyScale). */
export function functionConvertsMoney(responseExample: unknown): boolean {
  return !!(
    responseExample &&
    typeof responseExample === 'object' &&
    Number((responseExample as Record<string, unknown>)[MONEY_SCALE_FIELD]) > 1
  );
}

/**
 * The deployed script, wrapped so a request in cents runs the maths in units.
 *
 * `script` is an evaluate(ctx) body that runs after the sandbox's preamble has declared `config`
 * (ctx.config) and `bet` (ctx.bet — rgs-fn fills it from the bet port), and returns
 * `{ data: { <output port>: value, … }, … }`. The body moves into an inner function, so its own
 * `return` still ends it; the wrapper adjusts `bet` and `config` before calling it and the win port
 * of what it returns after.
 */
export function withMoneyScale(script: string, betPort: string, winPort: string): string {
  const isAsync = /\bawait\b/.test(script);
  const bet = JSON.stringify(betPort);
  const win = JSON.stringify(winPort);
  const field = JSON.stringify(MONEY_SCALE_FIELD);
  return [
    '// XGENIA money scale: the page sends cents with ' + MONEY_SCALE_FIELD + '; the maths below runs in units.',
    `var __xgScale = Number(config && config[${field}]) || 1;`,
    'if (__xgScale > 1) {',
    '  var __xgConfig = {};',
    '  for (var __xgKey in config) __xgConfig[__xgKey] = config[__xgKey];',
    `  if (typeof __xgConfig[${bet}] === "number") __xgConfig[${bet}] = __xgConfig[${bet}] / __xgScale;`,
    '  config = __xgConfig;',
    '  if (typeof bet === "number") bet = bet / __xgScale;',
    '}',
    `var __xgMaths = ${isAsync ? 'async ' : ''}function () {`,
    script,
    '};',
    'var __xgCents = function (result) {',
    '  if (__xgScale > 1 && result && typeof result === "object") {',
    '    var data = result.data && typeof result.data === "object" ? result.data : null;',
    // Whole cents, down — what the RGS pays. The tiny epsilon keeps 1.08 × 100 = 108.00000000000001 at 108
    // and 0.29 × 100 = 28.999999999999996 at 29.
    `    if (data && typeof data[${win}] === "number") data[${win}] = Math.floor(data[${win}] * __xgScale + 1e-6);`,
    '    if (typeof result.win === "number") result.win = Math.floor(result.win * __xgScale + 1e-6);',
    `    if (data) data[${field}] = __xgScale;`,
    '  }',
    '  return result;',
    '};',
    'var __xgResult = __xgMaths();',
    'return __xgResult && typeof __xgResult.then === "function" ? __xgResult.then(__xgCents) : __xgCents(__xgResult);'
  ].join('\n');
}
