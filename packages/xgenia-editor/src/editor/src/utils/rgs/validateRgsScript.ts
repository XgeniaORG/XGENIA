// Pre-flight validation for a hand-edited RGS component script, run before it
// is redeployed over a live edge function.
//
// The RGS side compiles every stored script through `compileScript`
// (supabase/functions/_shared/script-sandbox.ts) on each request — but only at
// *execution* time. A script that trips a sandbox rule therefore deploys fine
// and then fails on the next spin, with nothing surfaced in the editor. These
// checks mirror the server's rules so the user is told at redeploy time.
//
// Keep BLOCKED_PATTERNS and MAX_SCRIPT_SIZE in sync with script-sandbox.ts.

// Mirrors MAX_SCRIPT_SIZE in script-sandbox.ts.
const MAX_SCRIPT_SIZE = 256 * 1024;

// Mirrors BLOCKED_PATTERNS in script-sandbox.ts. The `label` is what we show
// the user — the server deliberately returns a vague "Blocked: …" message, so
// naming the construct here is the only way they learn what to remove.
const BLOCKED_PATTERNS: Array<{ re: RegExp; label: string }> = [
  // Network / I/O
  { re: /\bfetch\s*\(/, label: 'fetch()' },
  { re: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { re: /\bWebSocket\b/, label: 'WebSocket' },
  { re: /\batob\s*\(/, label: 'atob()' },
  { re: /\bbtoa\s*\(/, label: 'btoa()' },
  // Module loading
  { re: /\bimport\s*\(/, label: 'dynamic import()' },
  { re: /\brequire\s*\(/, label: 'require()' },
  // Runtime access
  { re: /\bDeno\b/, label: 'Deno' },
  { re: /\bglobalThis\b/, label: 'globalThis' },
  { re: /\bwindow\b/, label: 'window' },
  { re: /\b__dirname\b/, label: '__dirname' },
  { re: /\b__filename\b/, label: '__filename' },
  // Code generation / eval
  { re: /\bFunction\s*\(/, label: 'Function()' },
  { re: /\bnew\s+Function\b/, label: 'new Function' },
  { re: /\beval\s*\(/, label: 'eval()' },
  // Global-reach primitives
  { re: /\bReflect\b/, label: 'Reflect' },
  { re: /\bProxy\b/, label: 'Proxy' },
  { re: /\bqueueMicrotask\b/, label: 'queueMicrotask' },
  { re: /\bset(Timeout|Interval|Immediate)\s*\(/, label: 'setTimeout/setInterval' },
  // Prototype / constructor reach
  { re: /\b__proto__\b/, label: '__proto__' },
  { re: /\.constructor\s*\(/, label: '.constructor()' },
  { re: /\[\s*['"]constructor['"]\s*\]/, label: "['constructor']" },
  { re: /\bgetPrototypeOf\s*\(/, label: 'getPrototypeOf()' },
  { re: /\bsetPrototypeOf\s*\(/, label: 'setPrototypeOf()' },
];

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
      error: `Script is ${Math.round(script.length / 1024)} KB — the RGS sandbox rejects anything over ${MAX_SCRIPT_SIZE / 1024} KB.`,
    };
  }

  // The sandbox un-escapes these before its own pattern scan, so scan the same
  // text it will actually see — otherwise `\x66etch`-style escapes slip past.
  const normalised = script.replace(/\\`/g, '`').replace(/\\\$/g, '$');

  for (const { re, label } of BLOCKED_PATTERNS) {
    if (re.test(normalised)) {
      return {
        ok: false,
        error: `Script uses ${label}, which the RGS sandbox blocks. Remove it before redeploying.`,
      };
    }
  }

  try {
    // eslint-disable-next-line no-new-func
    new Function('ctx', script);
  } catch (e: any) {
    return { ok: false, error: `Syntax error: ${e?.message || 'script could not be parsed'}` };
  }

  return { ok: true };
}
