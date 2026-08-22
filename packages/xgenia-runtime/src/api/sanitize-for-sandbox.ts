/**
 * sanitize-for-sandbox.ts — make a generated RGS script sandbox-compatible.
 *
 * Extracted from SupabaseConverter.sanitizeForSandbox (2026-07-10, trace
 * 1783634013326) so it is testable as a pure function: the RGS sandbox
 * (script-sandbox.ts server-side) has a blocklist that rejects scripts
 * containing Deno, eval(, Function(, crypto, import, require, etc. The cloud
 * deploy code generators produce TypeScript and use these patterns, so we
 * strip/replace them here for RGS use.
 *
 * THE TRAP THIS CREATED: the emitted slot-maths formula evaluator used
 * `eval(processedFormula)` — rule 3 below replaced it with `0`, so every
 * weight/paytable/free-spins formula evaluated to 0 in the uploaded bundle
 * ("total weight is zero" crashes, 0% RTP) while the pre-sanitize parity test
 * kept passing. The evaluator is now a no-eval parser (formula-eval-emit.ts)
 * and formula-eval-parity.test.ts asserts THIS function leaves it working.
 * The eval-strip rules stay as defense-in-depth for any other generator that
 * regresses into emitting eval.
 */
/** `/` starts a regex literal (not a division) after these tokens. */
const REGEX_PRECEDING_KEYWORDS = new Set([
    'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
    'case', 'do', 'else', 'yield', 'await', 'throw'
]);

/**
 * Strip `//` line comments and block comments WITHOUT touching text that only
 * looks like a comment because it sits inside a string, template or regex.
 *
 * WHY THIS IS NOT A REGEX (2026-07-29, Keno Dynasty deploy): this used to be
 * `s.replace(/\/\/.*$/gm, '')`, which ate the tail of every URL in a user
 * script — `const url = "https://x.supabase.co/functions/v1/keno-controller"`
 * came out of the generator as `const url = "https:` , an unterminated string
 * literal. The deployed edge function then failed to compile, and because the
 * RGS sandbox runs its denylist BEFORE compiling, the operator saw whatever
 * generic error came first instead of "your URL got truncated". Any `//` inside
 * a literal hit this: URLs, protocol-relative paths, regexes like /a\/\/b/.
 *
 * Comments are still stripped in code position, which is the point of doing this
 * at all — a comment mentioning `fetch(` or `Deno` would trip the sandbox's
 * source-level denylist even though the code never calls either.
 */
function stripCommentsPreservingLiterals(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;

    // A `${ ... }` inside a template literal is code, which may itself contain a
    // template. `templateBraceDepth` remembers the brace depth each open
    // interpolation started at, so the matching `}` returns us to template text.
    const templateBraceDepth: number[] = [];
    let braceDepth = 0;
    let inTemplate = false;

    /** Whether a `/` here opens a regex literal rather than being division. */
    const regexCanStart = (): boolean => {
        const tail = out.replace(/\s+$/, '');
        if (!tail) return true;
        const word = /[A-Za-z_$][\w$]*$/.exec(tail);
        if (word) return REGEX_PRECEDING_KEYWORDS.has(word[0]);
        return '(,=:[!&|?{};+-*%~^<>'.includes(tail[tail.length - 1]);
    };

    while (i < n) {
        const c = src[i];
        const next = i + 1 < n ? src[i + 1] : '';

        if (inTemplate) {
            if (c === '\\') {
                out += c + (next || '');
                i += 2;
            } else if (c === '`') {
                inTemplate = false;
                out += c;
                i++;
            } else if (c === '$' && next === '{') {
                templateBraceDepth.push(braceDepth);
                inTemplate = false;
                out += '${';
                i += 2;
            } else {
                out += c;
                i++;
            }
            continue;
        }

        // ── code position ──
        if (c === '/' && next === '/') {
            while (i < n && src[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        if (c === '"' || c === "'") {
            const quote = c;
            out += c;
            i++;
            while (i < n) {
                if (src[i] === '\\') {
                    out += src.slice(i, i + 2);
                    i += 2;
                    continue;
                }
                out += src[i];
                // An unterminated string (newline before the closing quote) is a
                // pre-existing syntax error; stop consuming so the rest of the
                // file is still scanned as code rather than swallowed as string.
                if (src[i] === quote || src[i] === '\n') {
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (c === '`') {
            inTemplate = true;
            out += c;
            i++;
            continue;
        }
        if (c === '}' && templateBraceDepth.length && braceDepth === templateBraceDepth[templateBraceDepth.length - 1]) {
            templateBraceDepth.pop();
            inTemplate = true;
            out += c;
            i++;
            continue;
        }
        if (c === '{') {
            braceDepth++;
            out += c;
            i++;
            continue;
        }
        if (c === '}') {
            if (braceDepth > 0) braceDepth--;
            out += c;
            i++;
            continue;
        }
        if (c === '/' && regexCanStart()) {
            // Consume /pattern/flags. `/` inside a [...] class is literal.
            let j = i + 1;
            let inClass = false;
            let closed = false;
            while (j < n) {
                const rc = src[j];
                if (rc === '\\') { j += 2; continue; }
                if (rc === '\n') break;              // not a regex after all
                if (inClass) { if (rc === ']') inClass = false; }
                else if (rc === '[') inClass = true;
                else if (rc === '/') { closed = true; j++; break; }
                j++;
            }
            if (closed) {
                while (j < n && /[a-z]/.test(src[j])) j++; // flags
                out += src.slice(i, j);
                i = j;
                continue;
            }
            // Fall through: treat as a plain division operator.
        }

        out += c;
        i++;
    }

    return out;
}

export function sanitizeForSandbox(script: string): string {
    let s = script;

    // 1. Strip TypeScript type annotations
    //    IMPORTANT: Regexes must not match ternary falsy branches like `: number` in `x ? y : number`
    //    Only strip type annotations that follow `)`, `]`, or an identifier (variable/param declarations).
    //    Lookbehind ensures we only strip actual TS type annotations, not ternary branches.
    s = s.replace(/([\)\]\w])\s*:\s*Record<[^>]+>/g, '$1');
    s = s.replace(/([\)\]\w])\s*:\s*(?:number|string|boolean|any|void|object|unknown|never)(?:\[\])?(?=\s*[,\)={;\n])/g, '$1');
    // `as Type` casts are always safe to strip (they only exist in TS)
    s = s.replace(/\bas\s+Record<[^>]+>/g, '');
    s = s.replace(/\bas\s+(?:number|string|boolean|any|void|object|unknown|never)/g, '');
    s = s.replace(/<[A-Z][a-zA-Z]*(?:,\s*[A-Z][a-zA-Z]*)*>/g, '');

    // 2. Replace crypto.getRandomValues blocks with RNG adapter
    //    Matches: if (typeof crypto !== 'undefined' && crypto.getRandomValues) { ... } else { ... }
    s = s.replace(
        /if\s*\(\s*typeof\s+crypto\s*!==?\s*['"]undefined['"]\s*&&\s*crypto\.getRandomValues\s*\)\s*\{[^}]*\}\s*else\s*\{[^}]*\}/g,
        '{ value = rgsRandom() * 1000000000000; }'
    );
    // Also catch standalone crypto.getRandomValues
    s = s.replace(/crypto\.getRandomValues\([^)]*\)/g, '/* replaced by rgsRandom */');

    // 2b. Strip inlined IsaacRNG class — RNG comes directly from the server's Isaac
    //     Use brace-counting since the class body contains nested { } blocks
    {
        let idx = 0;
        while (true) {
            const classStart = s.indexOf('class IsaacRNG', idx);
            if (classStart === -1) break;
            // Find the opening brace
            const braceStart = s.indexOf('{', classStart);
            if (braceStart === -1) break;
            // Count braces to find matching closing brace
            let depth = 1;
            let pos = braceStart + 1;
            while (pos < s.length && depth > 0) {
                if (s[pos] === '{') depth++;
                else if (s[pos] === '}') depth--;
                pos++;
            }
            // Replace the entire class with a comment
            s = s.slice(0, classStart) + '/* IsaacRNG class removed — using server RNG */' + s.slice(pos);
            idx = classStart + 1;
        }
    }
    s = s.replace(/\/\*\s*duplicate class IsaacRNG removed\s*\*\//g, '');

    // 2c. Replace Isaac instantiation and usage with direct rgsRandom() calls
    //     Pattern: `const isaac = new IsaacRNG(seed, nonce);`
    s = s.replace(/const\s+isaac\s*=\s*new\s+IsaacRNG\s*\([^)]*\)\s*;/g, '/* isaac replaced by rgsRandom */');
    //     Pattern: `isaac.randomFloat(0, 1000000000000)` → `rgsRandom() * 1000000000000`
    s = s.replace(/isaac\.randomFloat\s*\(\s*0\s*,\s*(\d+)\s*\)/g, 'rgsRandom() * $1');
    //     Pattern: `isaac.random()` → `rgsRandom()`
    s = s.replace(/isaac\.random\s*\(\s*\)/g, 'rgsRandom()');
    //     Pattern: `isaac.randomInt(min, max)` → `rgsRandomInt(min, max)`
    s = s.replace(/isaac\.randomInt\s*\(/g, 'rgsRandomInt(');

    // 2d. Any remaining bare Math.random → rgsRandom.
    //
    // §2 above only rewrites the `if (typeof crypto …) { … } else { … }` block the
    // TRNG nodes emit. Other emitters produce Math.random in shapes it never
    // matched — notably the Weighted Reels dynamic path,
    //   `const rand = colRng ? colRng.nextFloat() : Math.random();`
    // (slot-game-node-converter), a TERNARY fallback for when per-column seeds are
    // absent.
    //
    // Two reasons this must go. Correctness: unseeded randomness in server maths is
    // unrecorded, so the round cannot be re-derived — the same provably-fair hole
    // the seeded path already fixed, left open on the fallback branch. Mechanics:
    // the RGS blocklist is a TEXT scan, so the token is refused even sitting in a
    // branch that never executes. Upload fails with "Blocked: scripts cannot use
    // restricted APIs or language features" and no indication of which token.
    //
    // rgsRandom() is in scope for the whole body (the sandbox preamble defines it
    // before the user script) and draws from the counted, recorded ctx.rng, so this
    // is a strict improvement rather than an appeasement. Covers the call form and
    // the `random=Math.random` alias std-library-node-converter puts in its
    // formula preamble.
    s = s.replace(/\bMath\s*\.\s*random\b/g, 'rgsRandom');

    // 3. Replace eval() calls with safe fallback values
    //    Scripts should not contain eval() — replace with 0
    //    (Defense-in-depth only: nothing we emit uses eval anymore. If a rule here
    //    fires, the formula-eval-parity sanitize test fails loudly rather than the
    //    RGS silently computing 0 — see file docblock.)
    s = s.replace(
        /\beval\s*\(\s*processedFormula\s*\)/g,
        '0 /* eval removed */'
    );
    s = s.replace(
        /\beval\s*\(\s*([a-zA-Z_]+)\.replace\([^)]*\)\s*\)/g,
        '0 /* eval removed */'
    );
    // Catch any remaining eval() calls
    s = s.replace(
        /\beval\s*\(\s*([^)]+)\s*\)/g,
        '0 /* eval removed */'
    );
    // Also catch any `new Function(` residual
    s = s.replace(
        /\(?\s*new\s+Function\s*\([^)]*\)\s*\)\s*\([^)]*\)/g,
        '0 /* new Function removed */'
    );

    // 4. Remove/replace Deno references
    s = s.replace(/\bDeno\b\.[a-zA-Z]+/g, 'undefined');
    // Also catch standalone Deno word that might remain
    s = s.replace(/\btypeof\s+Deno\b/g, 'typeof undefined');

    // 5 + 6. Strip line and block comments (they can contain words the sandbox
    // denylist rejects), but never touch a `//` that lives inside a string,
    // template or regex — see stripCommentsPreservingLiterals for the URL-eating
    // regression this replaced.
    s = stripCommentsPreservingLiterals(s);

    // 7. Clean up multiple blank lines
    s = s.replace(/\n{3,}/g, '\n\n');

    // 8. Deduplicate inline helper declarations
    //    When multiple nodes of the same type exist (e.g. 2 ISAAC RNGs),
    //    their shared helper code (class IsaacRNG, function evaluateFormula,
    //    function SeededRandom) gets emitted multiple times.
    //    Keep only the first occurrence of each declaration block.
    const seenDeclarations = new Set<string>();

    // NOTE: We intentionally do NOT deduplicate function declarations.
    // Functions like evaluateFormula and SeededRandom are scoped inside
    // different node arrow functions (e.g., const slot_get_paytable = (inputs) => { ... })
    // and are NOT actual duplicates — each one belongs to its own scope.

    s = s.replace(/^(\s*)class\s+(\w+)\s*\{[\s\S]*?\n\1\}/gm, (match, _indent, name) => {
        // IsaacRNG is fully stripped in step 2b — remove any residuals
        if (name === 'IsaacRNG') return `/* IsaacRNG class removed */`;
        if (seenDeclarations.has(`class:${name}`)) return `/* duplicate class ${name} removed */`;
        seenDeclarations.add(`class:${name}`);
        return match;
    });

    // 10. Final cleanup of blank lines left by deduplication
    s = s.replace(/\n{3,}/g, '\n\n');

    return s;
}
