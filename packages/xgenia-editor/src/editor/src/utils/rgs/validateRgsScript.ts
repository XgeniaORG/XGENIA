// Pre-flight validation for a hand-edited RGS component script, run before it
// is redeployed over a live edge function — and, via findBlockedConstructs, to
// tell an author why Simulate will not run their component.
//
// The RGS side compiles every stored script through `compileScript`
// (supabase/functions/_shared/script-sandbox.ts) on each request — but only at
// *execution* time. A script that trips a sandbox rule therefore deploys fine
// and then fails on the next round, with nothing surfaced in the editor. These
// checks mirror the server's rules so the user is told at redeploy time.
//
// Keep BLOCKED_PATTERNS and MAX_SCRIPT_SIZE in sync with script-sandbox.ts —
// there are three copies (there, here, and XRGS apps/studio/lib). They had
// drifted: this one was missing `Math.random`, `crypto.getRandomValues` and
// `crypto.randomUUID`, which is how a script that the live endpoint refuses
// outright could still be saved from the editor without a word of warning.
// 39 of the 125 currently deployed components call Math.random.

// Mirrors MAX_SCRIPT_SIZE in script-sandbox.ts.
const MAX_SCRIPT_SIZE = 256 * 1024;

export interface BlockedPattern {
  re: RegExp;
  /**
   * What a HUMAN is told the script uses.
   *
   * The server answers with a deliberately terse "Blocked: …" because that check
   * also runs on the live round path. Naming the construct is this file's whole
   * job.
   */
  label: string;
  /** Why the sandbox refuses it — one clause, shown under the label. */
  reason: string;
}

// Mirrors BLOCKED_PATTERNS in script-sandbox.ts, in the same order.
export const BLOCKED_PATTERNS: BlockedPattern[] = [
  // Unrecorded randomness — a round drawn from anything but ctx.rng cannot be
  // re-derived from its seed, so it cannot be certified or disputed.
  {
    re: /\bMath\s*\.\s*random\b/,
    label: 'Math.random()',
    reason: 'randomness must come from ctx.rng so the round can be re-derived from its seed'
  },
  {
    re: /\bcrypto\s*\.\s*getRandomValues\b/,
    label: 'crypto.getRandomValues()',
    reason: 'randomness must come from ctx.rng so the round can be re-derived from its seed'
  },
  {
    re: /\bcrypto\s*\.\s*randomUUID\b/,
    label: 'crypto.randomUUID()',
    reason: 'randomness must come from ctx.rng so the round can be re-derived from its seed'
  },
  // Network / I/O
  { re: /\bfetch\s*\(/, label: 'fetch()', reason: 'the sandbox has no network access' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest', reason: 'the sandbox has no network access' },
  { re: /\bWebSocket\b/, label: 'WebSocket', reason: 'the sandbox has no network access' },
  { re: /\batob\s*\(/, label: 'atob()', reason: 'string-built global reach is how sandbox escapes are assembled' },
  { re: /\bbtoa\s*\(/, label: 'btoa()', reason: 'string-built global reach is how sandbox escapes are assembled' },
  // Module loading
  { re: /\bimport\s*\(/, label: 'dynamic import()', reason: 'the sandbox cannot load modules' },
  { re: /\brequire\s*\(/, label: 'require()', reason: 'the sandbox cannot load modules' },
  // Runtime access
  { re: /\bDeno\b/, label: 'Deno', reason: 'the host runtime is not reachable from a maths script' },
  { re: /\bglobalThis\b/, label: 'globalThis', reason: 'the host runtime is not reachable from a maths script' },
  { re: /\bwindow\b/, label: 'window', reason: 'the host runtime is not reachable from a maths script' },
  { re: /\b__dirname\b/, label: '__dirname', reason: 'the host runtime is not reachable from a maths script' },
  { re: /\b__filename\b/, label: '__filename', reason: 'the host runtime is not reachable from a maths script' },
  // Code generation / eval
  { re: /\bFunction\s*\(/, label: 'Function()', reason: 'generated code compiles in global scope, outside the sandbox' },
  { re: /\bnew\s+Function\b/, label: 'new Function', reason: 'generated code compiles in global scope, outside the sandbox' },
  { re: /\beval\s*\(/, label: 'eval()', reason: 'generated code compiles in global scope, outside the sandbox' },
  // Global-reach primitives
  { re: /\bReflect\b/, label: 'Reflect', reason: 'used to rebuild Function / host access from inside the sandbox' },
  { re: /\bProxy\b/, label: 'Proxy', reason: 'used to rebuild Function / host access from inside the sandbox' },
  { re: /\bqueueMicrotask\b/, label: 'queueMicrotask', reason: 'a round must complete synchronously' },
  { re: /\bset(Timeout|Interval|Immediate)\s*\(/, label: 'setTimeout/setInterval', reason: 'a round must complete synchronously' },
  // Prototype / constructor reach
  { re: /\b__proto__\b/, label: '__proto__', reason: 'prototype reach escapes the sandbox scope' },
  { re: /\.constructor\s*\(/, label: '.constructor()', reason: 'prototype reach escapes the sandbox scope' },
  { re: /\[\s*['"]constructor['"]\s*\]/, label: "['constructor']", reason: 'prototype reach escapes the sandbox scope' },
  { re: /\bgetPrototypeOf\s*\(/, label: 'getPrototypeOf()', reason: 'prototype reach escapes the sandbox scope' },
  { re: /\bsetPrototypeOf\s*\(/, label: 'setPrototypeOf()', reason: 'prototype reach escapes the sandbox scope' }
];

/**
 * The script text the sandbox will actually scan.
 *
 * It un-escapes double-escaped template literals from AI code generators before
 * its own pattern pass, so anything reporting on that pass has to normalise the
 * same way — otherwise `\x66etch`-style escapes slip past.
 */
export function normaliseScript(script: string): string {
  return script.replace(/\\`/g, '`').replace(/\\\$/g, '$');
}

export interface BlockedConstruct {
  label: string;
  reason: string;
  /** 1-indexed line of the first occurrence, or 0 if it could not be pinned. */
  line: number;
  /** The offending line, trimmed — enough to recognise without opening the script. */
  excerpt: string;
}

/**
 * Every sandbox-blocked construct in a script, with the line it sits on.
 *
 * Simulate used to relay the platform's reply verbatim — "Maths script
 * validation failed: Blocked: scripts cannot use restricted APIs or language
 * features" — with no construct and no line, on generated bodies up to 86 KB.
 * 43 of the 125 deployed components trip a rule, so that was the common case.
 */
export function findBlockedConstructs(script: string): BlockedConstruct[] {
  const normalised = normaliseScript(script);
  const lines = normalised.split('\n');
  const found: BlockedConstruct[] = [];

  for (const { re, label, reason } of BLOCKED_PATTERNS) {
    if (!re.test(normalised)) continue;
    let lineNo = 0;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        lineNo = i + 1;
        break;
      }
    }
    const raw = lineNo > 0 ? lines[lineNo - 1].trim() : '';
    found.push({
      label,
      reason,
      line: lineNo,
      excerpt: raw.length > 120 ? `${raw.slice(0, 120)}…` : raw
    });
  }

  return found;
}

export interface ScriptValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Checks an edited script for the three failures that would otherwise only show
 * up as a broken live endpoint: a syntax error, an oversized body, or a
 * sandbox-blocked API.
 *
 * Scripts are function *bodies* with a top-level `return`, so syntax is checked
 * by constructing `new Function('ctx', script)` — the same check the Maths panel
 * runs before its own upload. Constructing it does not execute it.
 */
export function validateRgsScript(script: string): ScriptValidationResult {
  if (!script || !script.trim()) {
    return { ok: false, error: 'Script is empty.' };
  }

  if (script.length > MAX_SCRIPT_SIZE) {
    return {
      ok: false,
      error: `Script is ${Math.round(script.length / 1024)} KB — the RGS sandbox rejects anything over ${MAX_SCRIPT_SIZE / 1024} KB.`
    };
  }

  const blocked = findBlockedConstructs(script);
  if (blocked.length > 0) {
    const first = blocked[0];
    const where = first.line > 0 ? ` (line ${first.line})` : '';
    return {
      ok: false,
      error: `Script uses ${first.label}${where}, which the RGS sandbox blocks — ${first.reason}. Remove it before redeploying.`
    };
  }

  try {
    // eslint-disable-next-line no-new-func
    new Function('ctx', normaliseScript(script));
  } catch (e: any) {
    return { ok: false, error: `Syntax error: ${e?.message || 'script could not be parsed'}` };
  }

  return { ok: true };
}
