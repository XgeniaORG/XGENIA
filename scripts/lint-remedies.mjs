#!/usr/bin/env node
/**
 * lint-remedies.mjs
 *
 * THE DISEASE (spec 2026-09-14-followable-remedies-design.md §1, debug export
 * 1789392302849): ten separate tools shipped advice naming a cure the system does not
 * implement — a syntax the parser refuses, a parameter the schema lacks, a tool nobody
 * wrote. 522 remedy-bearing fields in the tool layer (`suggestion`, `nextSteps`,
 * `_action_required`, `suggestedRecovery`, `_next`, `_fireInstead`, `howToOverride`) and
 * nothing tested any of them.
 *
 * This script is the gate. It builds a tool inventory (name -> schema keys) from the
 * StreamlinedToolRegistry source, then scans every .ts file's string/template literals for
 * two shapes of advice:
 *
 *   1. An explicit call example: `some_tool({ key: value, ... })`. If `some_tool` is not a
 *      registered tool, that is a PHANTOM TOOL. If it is registered but `key` is not one of
 *      its schema's top-level keys, that is a PHANTOM PARAM.
 *   2. A self-referential bare mention inside a tool's OWN advice text: "pass componentPath"
 *      or "retry with nodeId", with no call wrapper. Because this prose is emitted from
 *      inside that tool's own handler, it is implicitly advice to retry THAT SAME tool, so
 *      the named identifier is checked against that tool's own schema. This is what catches
 *      `get_node_script`'s `componentPath` (get-node-script.ts:449) — the schema has no such
 *      field, and the sentence never wraps itself in `get_node_script({...})`.
 *
 * FAIL CLOSED: anything this script cannot parse (unbalanced braces in a call site, a
 * handler-map entry whose tool definition or schema cannot be located) is reported under
 * `unparsed` and is never silently dropped. A silently-skipped file is exactly how this
 * class of defect survived undetected (spec §1).
 *
 * NOT CAUGHT BY DESIGN (documented, not a bug): plain-English advice that names no coded
 * identifier or call at all ("use a different tool", "Use connection ID for fastest
 * identification") cannot be mechanically checked by a tool/param-name linter — there is no
 * name to look up. Catching those needs the syntax round-trip / semantic-probe layers the
 * design doc assigns to §5.2/§5.3, not this gate. See task-2-report.md for which of the
 * design doc's ten example rows this script can and cannot see, and why.
 *
 * IDENTITY (fixed 2026-09-14, see lint-identity-fix-report.md): a violation's identity is
 * `file + kind + tool + param(if any) + normalisedCall + occurrence-index`, NEVER `line`.
 * `normalisedCall` is the matched call expression itself (`tool({...})`, or the bare "pass X"
 * / "retry with X" text for a self-referential mention) with runs of whitespace collapsed —
 * NOT the padded context window kept in `snippet` for humans. An unrelated edit earlier in a
 * file shifts every later violation's line number by the same delta; keying identity on line
 * made the WHOLE FILE'S worth of baselined violations look "fixed" and "new" at once on that
 * edit (verified: a single -1 net line change in verify-logic-correctness.ts flipped 17
 * baselined violations to `new` while `currentCount == baselineCount`). Two of those 17 also
 * proved line position is not just noisy but actively MISLEADING: two DIFFERENT calls
 * (`width: "800px"` and `width: "100%"`, at different source lines) coincidentally landed on
 * the same line number as two OTHER, unrelated baseline entries after the shift, so the old
 * `file:line:tool:param` key called them "unchanged" purely by line-number coincidence, and
 * the two truly-shifted "800px" calls (identical call text, different neighbouring prose —
 * one preceded by "...as an explicit CSS string:", the other by "...are the same token:")
 * showed up as spuriously "new" instead. `occurrence-index` (assigned in source order among
 * violations sharing the same file/kind/tool/param/normalisedCall) exists because one file can
 * legitimately contain the identical call text more than once, as this exact bug proved.
 * `line` and `snippet` stay on each violation record for a human to read, but take no part in
 * the key.
 *
 * Usage:
 *   node scripts/lint-remedies.mjs                 human-readable table; exits 1 if any
 *                                                   NEW violation (not in the baseline) exists
 *   node scripts/lint-remedies.mjs --json          JSON report to stdout; ALWAYS exits 0
 *                                                   (so tests can read the report even when
 *                                                   new violations exist)
 *   node scripts/lint-remedies.mjs --write-baseline  overwrite scripts/remedy-baseline.json
 *                                                     with today's violations; exits 0
 *
 * Env overrides (seam for tests — e.g. proving identity survives a line shift against an
 * isolated fixture tree without touching the real registry or the real baseline):
 *   LINT_REMEDIES_REGISTRY_DIR   scan this directory instead of the real StreamlinedToolRegistry
 *   LINT_REMEDIES_BASELINE_FILE  read/write this baseline file instead of the real one
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REGISTRY_DIR = process.env.LINT_REMEDIES_REGISTRY_DIR
  ? path.resolve(process.env.LINT_REMEDIES_REGISTRY_DIR)
  : path.join(ROOT, 'private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry');
const INDEX_FILE = path.join(REGISTRY_DIR, 'index.ts');
const BASELINE_FILE = process.env.LINT_REMEDIES_BASELINE_FILE
  ? path.resolve(process.env.LINT_REMEDIES_BASELINE_FILE)
  : path.join(ROOT, 'scripts/remedy-baseline.json');

// Bare identifiers that can precede `({` and are not tool calls.
const CALL_ALLOWLIST = new Set([
  'object', 'stringify', 'parse', 'assign', 'freeze', 'create', 'define', 'defineProperty',
  'entries', 'values', 'keys', 'from', 'of', 'resolve', 'reject', 'all', 'race', 'any',
  'allSettled', 'fromEntries', 'seal', 'isFrozen', 'isSealed', 'getPrototypeOf',
  // Array/Function prototype methods that can appear as `.push({` etc. in an advice string
  // that happens to log or build a plain object — not a tool call.
  'push', 'filter', 'map', 'forEach', 'reduce', 'find', 'some', 'every', 'sort', 'splice',
  'concat', 'slice', 'shift', 'unshift', 'call', 'apply', 'bind', 'includes',
  // `.handler({...})` invokes a ToolInfo's own handler function programmatically (real code,
  // sometimes embedded as a big string/template for later injection or execution) — never an
  // AI-facing tool name.
  'handler',
]);

// ---------------------------------------------------------------------------------------
// Small utilities: quote/comment-aware scanning. Regex parsing is acceptable and expected
// here (per task brief); anything that doesn't balance is reported under `unparsed`.
// ---------------------------------------------------------------------------------------

/** Walk `dir` recursively, returning absolute paths of every `.ts` file. */
function listTsFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile() && e.name.endsWith('.ts')) out.push(p);
    }
  }
  return out;
}

/** Precompute newline offsets for fast offset->1-based-line lookup. */
function makeLineFinder(source) {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  return (offset) => {
    // binary search for the last offset <= given offset
    let lo = 0, hi = offsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offsets[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Classify every character of raw TypeScript source as code (0), string/template content
 * (1) or comment (2). Used only for parsing RAW SOURCE (tool-block and schema extraction),
 * where real `//`/`/* *\/` comments exist and routinely contain apostrophes ("doesn't",
 * "AI's own") — a quote-only scanner desyncs on the first one and never recovers, which is
 * why brace-matching must be comment-aware here. (Already-extracted string/template literal
 * *content*, used by the call-site scan below, never contains a real comment — a literal
 * `//` there is just text, e.g. a URL — so that scan intentionally stays quote-only.)
 */
/**
 * A `/` not part of `//` or `/* *\/` is either division or the start of a regex literal —
 * ambiguous without a real parser. Heuristic (standard for lightweight tokenizers): if the
 * last significant character already seen is one that can END an expression (an identifier
 * char, digit, `)`, `]`, or a closing quote), this is division; otherwise it opens a regex
 * literal. This matters here because this codebase's port-name regexes routinely contain
 * quote characters inside `[...]` classes (e.g. `/Outputs\[(["'])out-.../g`) — treating that
 * `/` as division would let the naive quote-scanner treat the class's `"` as a real string
 * opener and desync for the rest of the file.
 */
function computeCharKinds(source) {
  const n = source.length;
  const kind = new Uint8Array(n);
  let i = 0;
  let lastSignificant = ''; // last CODE (kind 0) non-whitespace char seen
  function looksLikeRegexStart() {
    return !/[A-Za-z0-9_$)\]]/.test(lastSignificant);
  }
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') { kind[i] = 2; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      kind[i] = 2; kind[i + 1] = 2; i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { kind[i] = 2; i++; }
      if (i < n) { kind[i] = 2; if (i + 1 < n) kind[i + 1] = 2; i += 2; }
      continue;
    }
    if (c === '/' && looksLikeRegexStart()) {
      kind[i] = 1; i++;
      let inClass = false;
      let ok = true;
      while (i < n) {
        const cc = source[i];
        if (cc === '\\') { kind[i] = 1; if (i + 1 < n) kind[i + 1] = 1; i += 2; continue; }
        if (cc === '\n') { ok = false; break; }
        kind[i] = 1;
        if (cc === '[') { inClass = true; i++; continue; }
        if (cc === ']') { inClass = false; i++; continue; }
        if (cc === '/' && !inClass) { i++; break; }
        i++;
      }
      if (ok) { while (i < n && /[a-zA-Z]/.test(source[i])) { kind[i] = 1; i++; } }
      lastSignificant = ')'; // a regex literal ends an expression, like a parenthesized one
      continue;
    }
    if (c === '\'' || c === '"') {
      const q = c; kind[i] = 1; i++;
      while (i < n) {
        if (source[i] === '\\') { kind[i] = 1; if (i + 1 < n) kind[i + 1] = 1; i += 2; continue; }
        kind[i] = 1;
        if (source[i] === q) { i++; break; }
        if (source[i] === '\n') break;
        i++;
      }
      lastSignificant = ')'; // ends an expression, like a parenthesized one
      continue;
    }
    if (c === '`') {
      kind[i] = 1; i++;
      while (i < n) {
        if (source[i] === '\\') { kind[i] = 1; if (i + 1 < n) kind[i + 1] = 1; i += 2; continue; }
        kind[i] = 1;
        if (source[i] === '`') { i++; break; }
        i++;
      }
      lastSignificant = ')';
      continue;
    }
    kind[i] = 0;
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return kind;
}

/** Raw-source, comment+string-aware version of findMatchingBrace (see computeCharKinds). */
function findMatchingBraceRaw(source, kind, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    if (kind[i] !== 0) continue;
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Raw-source, comment+string-aware version of splitTopLevelSegments: comment text is
 * dropped entirely (it cannot contribute a schema key), string/template content is kept
 * verbatim but never affects depth or comma-splitting.
 */
function splitTopLevelSegmentsRaw(source, kind, start, end) {
  const segments = [];
  let depth = 0;
  let buf = '';
  for (let i = start; i < end; i++) {
    const k = kind[i];
    if (k === 2) continue; // comment: drop from the reconstructed text entirely
    const c = source[i];
    if (k === 0) {
      if (c === '(' || c === '{' || c === '[') depth++;
      else if (c === ')' || c === '}' || c === ']') depth--;
      else if (c === ',' && depth === 0) { segments.push(buf); buf = ''; continue; }
    }
    buf += c;
  }
  segments.push(buf);
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Find the index of the `}` matching the `{` at `openIdx` within already-extracted
 * string/template literal TEXT (see extractLiterals) — quote-aware only, deliberately not
 * comment-aware (a `//` inside advice text is just text, e.g. a URL). Also reused, on raw
 * source, by callers that don't need comment-awareness. Returns -1 if never balanced.
 */
function findMatchingBrace(text, openIdx) {
  let depth = 0;
  let inStr = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `text` at top-level commas (depth 0 across (){}[], quote-aware). */
function splitTopLevelSegments(text) {
  const segments = [];
  let depth = 0;
  let inStr = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      segments.push(text.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(text.slice(start));
  return segments.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Extract the property key from one top-level object-literal segment, or null. */
function keyOfSegment(segment) {
  if (segment.startsWith('...')) return { spread: true };
  let m = segment.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*:/);
  if (m) return { key: m[1] };
  m = segment.match(/^([A-Za-z_$][\w$]*)$/);
  if (m) return { key: m[1] }; // shorthand property
  return null; // unparseable segment
}

/**
 * Extract every string/template literal's raw content (including `${...}` interpolation
 * text verbatim, since a rendered advice example's static call shape lives partly inside
 * interpolated templates), skipping `//` and `/* *\/` comments. Returns [{ text, start }]
 * where `start` is the source offset of the first character of `text`.
 */
function extractLiterals(source) {
  const literals = [];
  const n = source.length;
  let i = 0;

  function scanSimpleString(quote) {
    const start = i;
    let buf = '';
    while (i < n) {
      const c = source[i];
      if (c === '\\') { buf += source.slice(i, i + 2); i += 2; continue; }
      if (c === quote) { i++; break; }
      if (c === '\n') break; // unterminated on this line; bail out of the string
      buf += c; i++;
    }
    literals.push({ text: buf, start });
  }

  function scanNestedQuoted(buf, quote) {
    // Used only inside a template's ${...} to keep nested strings from confusing depth
    // counting; appends the raw (including quotes) text and returns the updated buffer.
    buf += quote; i++;
    while (i < n) {
      const c = source[i];
      if (c === '\\') { buf += source.slice(i, i + 2); i += 2; continue; }
      buf += c;
      if (c === quote) { i++; break; }
      i++;
    }
    return buf;
  }

  function scanTemplate() {
    i++; // consume opening `
    const start = i;
    let buf = '';
    while (i < n) {
      const c = source[i];
      if (c === '\\') { buf += source.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && source[i + 1] === '{') {
        buf += '${'; i += 2;
        let depth = 1;
        while (i < n && depth > 0) {
          const cc = source[i];
          if (cc === '{') { depth++; buf += cc; i++; }
          else if (cc === '}') { depth--; buf += cc; i++; }
          else if (cc === '`') {
            buf += cc; i++;
            while (i < n && source[i] !== '`') { buf += source[i]; i++; }
            if (i < n) { buf += source[i]; i++; }
          } else if (cc === '"' || cc === '\'') {
            buf = scanNestedQuoted(buf, cc);
          } else {
            buf += cc; i++;
          }
        }
        continue;
      }
      buf += c; i++;
    }
    literals.push({ text: buf, start });
  }

  let lastSignificant = ''; // see computeCharKinds' looksLikeRegexStart for why this exists
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') { while (i < n && source[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // A regex literal (as opposed to division) must be skipped WITHOUT being read as a
    // string — its own quote characters (e.g. inside a `[...]` class) would otherwise desync
    // every string/comment boundary for the rest of the file, exactly as in computeCharKinds.
    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(lastSignificant)) {
      i++;
      let inClass = false;
      while (i < n) {
        const cc = source[i];
        if (cc === '\\') { i += 2; continue; }
        if (cc === '\n') break;
        if (cc === '[') { inClass = true; i++; continue; }
        if (cc === ']') { inClass = false; i++; continue; }
        if (cc === '/' && !inClass) { i++; break; }
        i++;
      }
      while (i < n && /[a-zA-Z]/.test(source[i])) i++;
      lastSignificant = ')';
      continue;
    }
    if (c === '\'' || c === '"') { i++; scanSimpleString(c); lastSignificant = ')'; continue; }
    if (c === '`') { scanTemplate(); lastSignificant = ')'; continue; }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return mergeAdjacentLiterals(literals, source);
}

/**
 * Advice is routinely built as several template literals joined by `+` across lines (e.g.
 * `` `image({ action:"edit", ... ` + `assetKind:"${x}" })` ``) — a single call example split
 * across two fragments that extractLiterals would otherwise see as unrelated strings, each
 * with unbalanced braces. Fragments separated only by whitespace/`+` are merged into one
 * logical segment so a call spanning the join can still be scanned; `chunks` preserves each
 * piece's own source offset so line numbers stay correct on either side of the join.
 */
function mergeAdjacentLiterals(fragments, source) {
  const segments = [];
  let i = 0;
  while (i < fragments.length) {
    const chunks = [fragments[i]];
    let lastEnd = fragments[i].start + fragments[i].text.length + 1; // past the closing delimiter
    let j = i + 1;
    while (j < fragments.length) {
      const glue = source.slice(lastEnd, fragments[j].start - 1);
      if (!/^[\s+]*$/.test(glue)) break;
      chunks.push(fragments[j]);
      lastEnd = fragments[j].start + fragments[j].text.length + 1;
      j++;
    }
    segments.push({ text: neutralizeEscapes(chunks.map((c) => c.text).join('')), chunks });
    i = j;
  }
  return segments;
}

/**
 * Replace two-character backslash escapes (`\n`, `\t`, `\r`, `\\`, `\'`, `\"`, `` \` ``) with
 * two spaces — same length, so offsets stay valid, but it stops a literal `\n` right before a
 * real word from gluing onto it. Without this, `...")}\nimage({` (a template literal's escaped
 * newline followed by the start of the next line) reads as the identifier "nimage" to a
 * `\b`-anchored regex, since `\` is a non-word character and the following `n` is not — a
 * false "phantom tool" on every multi-line advice string that happens to end a line right
 * before a real call.
 */
function neutralizeEscapes(text) {
  return text.replace(/\\[nrtbfv0\\'"`]/g, '  ');
}

/** Map an index into a (possibly merged) segment's combined text back to a source offset. */
function mapSegmentOffset(chunks, idx) {
  let acc = 0;
  for (const ch of chunks) {
    if (idx < acc + ch.text.length) return ch.start + (idx - acc);
    acc += ch.text.length;
  }
  const last = chunks[chunks.length - 1];
  return last.start + last.text.length - 1;
}

/** A snippet safe to print / put in the baseline (single line, capped). Context window for
 * HUMANS only — deliberately never used for identity (see IDENTITY note at the top of this
 * file): two unrelated calls with identical text but different neighbouring prose produce
 * different snippets, which would make textually-identical violations look different. */
function snippetOf(text, idx, len) {
  const s = text.slice(Math.max(0, idx - 10), idx + len + 40).replace(/\s+/g, ' ').trim();
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}

/** The exact matched text (a call expression, or a bare "pass X" mention) with whitespace
 * collapsed — NOT padded with any surrounding context. This, not `snippet`, is what identity
 * is keyed on. */
function normaliseCallText(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Assign each violation an occurrence index, scoped to file+kind+tool+param+normalisedCall,
 * counted in the order violations are appended (which follows source order — see
 * scanFileForViolations/extractLiterals). One file can legitimately contain the identical
 * call text more than once (proven by the "800px" / "100%" dimension examples in
 * verify-logic-correctness.ts, each written twice as a paired before/after example) — without
 * this index those two occurrences would collide on one identity.
 */
function makeOccurrenceCounter() {
  const counts = new Map();
  return (v) => {
    const groupKey = [v.file, v.kind, v.tool, v.param || '', v.call].join('‖');
    const next = (counts.get(groupKey) || 0) + 1;
    counts.set(groupKey, next);
    return next;
  };
}

// ---------------------------------------------------------------------------------------
// 1. Tool inventory: handler map (index.ts) -> const identifier -> tool block -> schema keys
// ---------------------------------------------------------------------------------------

/**
 * Split one already-top-level object-literal segment (no more top-level commas — see
 * splitTopLevelSegmentsRaw) into its key and value text at the first top-level `:`.
 */
function splitKeyValueAtTopLevel(text) {
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '(' || c === '{' || c === '[') depth++;
    else if (c === ')' || c === '}' || c === ']') depth--;
    else if (c === ':' && depth === 0) {
      return { key: text.slice(0, i).trim(), value: text.slice(i + 1).trim() };
    }
  }
  return null;
}

/**
 * Parse index.ts's `import { a, b as c } from './somewhere'` statements into
 * Map<localIdentifier, { file: relative-path-of-source-file, importedName }>. Needed because
 * two DIFFERENT files in this registry each export their own const named `delete_node_tool`
 * (and `delete_connection_tool`) — index.ts imports one of each pair under an alias
 * (`delete_node_tool as semantic_delete_node_tool`) specifically to avoid the collision, so
 * resolving "what schema does this handler-map entry point at" requires knowing which FILE a
 * local identifier came from, not just its bare name.
 */
function buildImportMap(indexSource) {
  const importMap = new Map();
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = importRe.exec(indexSource))) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue; // only local registry files carry tool blocks
    let resolved = path.resolve(REGISTRY_DIR, spec);
    if (!resolved.endsWith('.ts')) resolved += '.ts';
    const fileRel = rel(resolved);
    for (const rawPart of m[1].split(',')) {
      const piece = rawPart.trim();
      if (!piece) continue;
      const asMatch = piece.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/);
      if (asMatch) {
        importMap.set(asMatch[2], { file: fileRel, importedName: asMatch[1] });
      } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(piece)) {
        importMap.set(piece, { file: fileRel, importedName: piece });
      }
    }
  }
  return importMap;
}

/**
 * Build Map<aiName, localIdentifier> from the streamlinedToolHandlers object literal plus any
 * post-hoc `streamlinedToolHandlers.foo = foo_tool;` assignments. Most entries are a plain
 * `name: name_tool,`, but several (`delete_node`, `delete_connection`,
 * `git_revert_to_checkpoint`, `create_js_function_node`, `edit_js_function_node`,
 * `inspect_app_state`) are `name: { ...some_tool, name: 'name', handler: ... }` — a spread
 * wrapper that overrides only `name`/`handler`. The wrapped identifier (after `...`) is what
 * actually carries the schema, so that is what gets recorded here; resolving it to a file
 * happens later via buildImportMap, since a same-named const can exist in more than one file.
 */
function buildHandlerMap(indexSource, unparsed) {
  const handlerMap = new Map();
  const inlineBlocks = new Map(); // aiName -> { declaredName, schemaKeys } for schemas declared right inside the wrapper (no separate const to resolve)
  const kind = computeCharKinds(indexSource);

  const declIdx = indexSource.indexOf('export const streamlinedToolHandlers');
  if (declIdx === -1) {
    unparsed.push({ file: rel(INDEX_FILE), reason: 'could not find `export const streamlinedToolHandlers` declaration' });
  } else {
    const openBrace = indexSource.indexOf('{', declIdx);
    const closeBrace = openBrace === -1 ? -1 : findMatchingBraceRaw(indexSource, kind, openBrace);
    if (openBrace === -1 || closeBrace === -1) {
      unparsed.push({ file: rel(INDEX_FILE), reason: 'streamlinedToolHandlers object literal braces did not balance' });
    } else {
      const segments = splitTopLevelSegmentsRaw(indexSource, kind, openBrace + 1, closeBrace);
      for (const seg of segments) {
        const kv = splitKeyValueAtTopLevel(seg);
        if (!kv) continue;
        const key = kv.key.replace(/^['"]|['"]$/g, '');
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
        const value = kv.value;
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
          handlerMap.set(key, value);
        } else if (value.startsWith('{')) {
          // An inline wrapper object. Its underlying tool const is named either by a
          // top-level `...some_tool` spread (delete_node/delete_connection's shape) or a
          // top-level `schema: some_tool.schema` property (git_revert_to_checkpoint /
          // create_js_function_node / edit_js_function_node's shape) — resolved from ONLY
          // this object's own top-level properties, not from inside its `handler: async
          // (params) => {...}` function body, which routinely spreads `...params` (the
          // CALLER's arguments, not the wrapped tool) and would otherwise be misread as one.
          const objClose = findMatchingBrace(value, 0);
          let resolvedConst = null;
          let resolvedInline = false;
          if (objClose !== -1) {
            const topSegments = splitTopLevelSegments(value.slice(1, objClose));
            let declaredNameHere = key;
            const nameSeg = topSegments.find((s) => /^['"]?name['"]?\s*:/.test(s));
            if (nameSeg) {
              const nm = nameSeg.match(/:\s*['"]([^'"]+)['"]/);
              if (nm) declaredNameHere = nm[1];
            }
            for (const seg of topSegments) {
              const spreadMatch = seg.match(/^\.\.\.\s*([A-Za-z_][A-Za-z0-9_]*)$/);
              if (spreadMatch) { resolvedConst = spreadMatch[1]; break; }
              const kv2 = splitKeyValueAtTopLevel(seg);
              if (kv2 && kv2.key.replace(/^['"]|['"]$/g, '') === 'schema') {
                const schemaRefMatch = kv2.value.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\.schema)?$/);
                if (schemaRefMatch) { resolvedConst = schemaRefMatch[1]; break; }
                // Inline `schema: z.object({...})` right inside the wrapper — no separate
                // const to resolve; e.g. `inspect_app_state`'s handler-map entry.
                if (/^z\.object\s*\(\s*\{/.test(kv2.value)) {
                  const innerOpen = kv2.value.indexOf('{');
                  const innerClose = findMatchingBrace(kv2.value, innerOpen);
                  if (innerClose !== -1) {
                    const schemaKeys = new Set();
                    for (const s of splitTopLevelSegments(kv2.value.slice(innerOpen + 1, innerClose))) {
                      const parsed = keyOfSegment(s);
                      if (parsed && parsed.key) schemaKeys.add(parsed.key);
                    }
                    inlineBlocks.set(key, { declaredName: declaredNameHere, schemaKeys });
                    resolvedInline = true;
                  }
                  break;
                }
              }
            }
          }
          if (resolvedInline) {
            // handled via inlineBlocks
          } else if (resolvedConst) {
            handlerMap.set(key, resolvedConst);
          } else {
            unparsed.push({ file: rel(INDEX_FILE), reason: `handler map entry "${key}" is an inline object with no top-level "...spread" or "schema: X.schema"/"schema: z.object({...})" — could not determine its underlying tool const, so its params were NOT checked` });
          }
        } else {
          unparsed.push({ file: rel(INDEX_FILE), reason: `handler map entry "${key}" has an unrecognized value shape (not a bare identifier or {...spread, ...}): ${value.slice(0, 60)}` });
        }
      }
    }
  }

  // Post-hoc assignments: `streamlinedToolHandlers.foo = foo_tool;` — but NOT a commented-out
  // one (e.g. `// streamlinedToolHandlers.project_intelligence = project_intelligence_tool;`,
  // deliberately disabled); `kind` (already computed above) says which matches are real code.
  const assignRe = /streamlinedToolHandlers\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g;
  let am;
  while ((am = assignRe.exec(indexSource))) {
    if (kind[am.index] !== 0) continue; // inside a comment or string — not live code
    handlerMap.set(am[1], am[2]);
  }

  return { handlerMap, inlineBlocks };
}

/**
 * Scan every registry file for `export const X_tool [: ToolInfo] = { ... }` tool
 * definitions. Returns Map<constIdentifier, { file, start, end, declaredName, schemaKeys }>.
 * `schemaKeys` is a Set on success, or null if the schema could not be located/parsed
 * (callers must then skip param-checks against that tool rather than assume zero params).
 */
function buildToolBlocks(files, unparsed) {
  const blocks = new Map();
  // Matches both the `..._tool` convention (exported, the common case) and the bare
  // `xxxTool` convention used for a handful of base tools that are then wrapped — see the
  // createRobustTool alias pass below, which is why `export` is optional here.
  const declRe = /(?:export\s+)?const ([A-Za-z_][A-Za-z0-9_]*(?:_tool|Tool))\s*(?::\s*ToolInfo)?\s*=\s*\{/g;
  // `export const some_tool: ToolInfo = createRobustTool(baseConst, { ...wrapper config... })`
  // — createRobustTool (utils/tool-wrapper.ts) re-exposes baseConst's own schema/handler under
  // a new name; the wrapper's second argument only tunes context-validation behaviour, so the
  // real schema to check calls against is the WRAPPED tool's.
  const wrapperRe = /export const ([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*ToolInfo)?\s*=\s*createRobustTool\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/g;

  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      unparsed.push({ file: rel(file), reason: 'could not read file' });
      continue;
    }
    const kind = computeCharKinds(source);

    declRe.lastIndex = 0;
    let m;
    while ((m = declRe.exec(source))) {
      const constName = m[1];
      const openBrace = m.index + m[0].length - 1;
      const closeBrace = findMatchingBraceRaw(source, kind, openBrace);
      if (closeBrace === -1) {
        unparsed.push({ file: rel(file), reason: `tool block "${constName}" braces did not balance` });
        continue;
      }
      const blockText = source.slice(openBrace, closeBrace + 1);

      const nameMatch = blockText.match(/name\s*:\s*['"]([^'"]+)['"]/);
      if (!nameMatch) {
        unparsed.push({ file: rel(file), reason: `tool block "${constName}" has no name: field` });
        continue;
      }
      const declaredName = nameMatch[1];

      let schemaKeys = null;
      let schemaOpenAbs = -1;
      const inlineMatch = blockText.match(/schema\s*:\s*z\.object\s*\(\s*\{/);
      if (inlineMatch) {
        schemaOpenAbs = openBrace + inlineMatch.index + inlineMatch[0].length - 1;
      } else {
        // Some tools declare `schema: someNamedSchema` and define
        // `const someNamedSchema = z.object({...})` earlier in the same file.
        const namedMatch = blockText.match(/schema\s*:\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/);
        if (namedMatch) {
          const schemaIdent = namedMatch[1];
          const declRe2 = new RegExp(`const\\s+${schemaIdent}\\s*(?::[^=]+)?=\\s*z\\.object\\s*\\(\\s*\\{`);
          const identDecl = source.match(declRe2);
          if (identDecl) {
            schemaOpenAbs = identDecl.index + identDecl[0].length - 1;
          } else {
            unparsed.push({ file: rel(file), reason: `schema: ${schemaIdent} for "${declaredName}" (${constName}) — could not find "const ${schemaIdent} = z.object({...})" in this file` });
          }
        } else {
          unparsed.push({ file: rel(file), reason: `no inline "schema: z.object({...})" found for "${declaredName}" (${constName}) — its parameters were NOT checked` });
        }
      }

      if (schemaOpenAbs !== -1) {
        const schemaCloseAbs = findMatchingBraceRaw(source, kind, schemaOpenAbs);
        if (schemaCloseAbs === -1) {
          unparsed.push({ file: rel(file), reason: `schema z.object({...}) for "${declaredName}" (${constName}) braces did not balance` });
        } else {
          const segments = splitTopLevelSegmentsRaw(source, kind, schemaOpenAbs + 1, schemaCloseAbs);
          schemaKeys = new Set();
          for (const seg of segments) {
            const parsed = keyOfSegment(seg);
            if (!parsed) {
              unparsed.push({ file: rel(file), reason: `could not parse a schema key for "${declaredName}" (${constName}) in segment: ${seg.slice(0, 60)}` });
              continue;
            }
            if (parsed.key) schemaKeys.add(parsed.key);
          }
        }
      }

      // Keyed by file+const, not const alone: this registry has more than one file that
      // exports a same-named const (e.g. `delete_node_tool` exists in both
      // tools/semantic-tools.ts and tools/ui-tools/delete-node.ts, doing DIFFERENT things —
      // index.ts imports the one it actually wires up under an alias). A bare-name key would
      // let the second file's block silently overwrite the first.
      blocks.set(`${rel(file)}::${constName}`, {
        file: rel(file),
        start: openBrace,
        end: closeBrace,
        declaredName,
        schemaKeys,
      });
    }

    wrapperRe.lastIndex = 0;
    let wm;
    while ((wm = wrapperRe.exec(source))) {
      const wrapperConst = wm[1];
      const baseConst = wm[2];
      const baseKey = `${rel(file)}::${baseConst}`; // createRobustTool's base arg is always a same-file local const
      const baseBlock = blocks.get(baseKey);
      if (!baseBlock) {
        unparsed.push({ file: rel(file), reason: `createRobustTool(${baseConst}, ...) for "${wrapperConst}" — base tool const not found; its params were NOT checked` });
        continue;
      }
      // The wrapper re-exposes the base tool's own name/schema under a new export; if this
      // wrapper const declares its own `name:` in its config object that takes precedence,
      // but createRobustTool's config object here never does — it only tunes validation
      // behaviour — so the base's declaredName is what actually reaches the handler map.
      blocks.set(`${rel(file)}::${wrapperConst}`, {
        file: baseBlock.file,
        start: baseBlock.start,
        end: baseBlock.end,
        declaredName: baseBlock.declaredName,
        schemaKeys: baseBlock.schemaKeys,
      });
    }
  }
  return blocks;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// ---------------------------------------------------------------------------------------
// 2. Scan for advice: explicit calls, and self-referential bare param mentions.
// ---------------------------------------------------------------------------------------

function scanFileForViolations(file, source, lineFinder, inventoryNames, inventoryBlocks, blockRangesForFile, violations, unparsed, nextOccurrence) {
  const literals = extractLiterals(source);

  const callRe = /\b([a-z][a-z0-9_]{3,})\(\{/g;
  const selfRefRe = /\b(?:pass|retry with)\s+([a-zA-Z_][a-zA-Z0-9_]{3,})\b/gi;

  for (const { text, chunks } of literals) {
    // --- explicit call sites: tool_name({ ... }) ---
    callRe.lastIndex = 0;
    let m;
    while ((m = callRe.exec(text))) {
      const name = m[1];
      if (CALL_ALLOWLIST.has(name)) continue;

      const openBraceInText = m.index + m[0].length - 1;
      const closeBraceInText = findMatchingBrace(text, openBraceInText);
      const absOffset = mapSegmentOffset(chunks, m.index);
      const line = lineFinder(absOffset);

      if (closeBraceInText === -1) {
        unparsed.push({ file: rel(file), line, reason: `call-site braces did not balance for "${name}({"` });
        continue;
      }

      const inner = text.slice(openBraceInText + 1, closeBraceInText);
      const segments = splitTopLevelSegments(inner);
      const keys = [];
      let sawUnparsedSegment = false;
      for (const seg of segments) {
        const parsed = keyOfSegment(seg);
        if (!parsed) { sawUnparsedSegment = true; continue; }
        if (parsed.key) keys.push(parsed.key);
      }

      // `closeBraceInText` is the `}` closing the argument OBJECT, not the `)` closing the
      // CALL — `name({...}` is not a complete expression. Extend to the call's own closing
      // paren (skipping any whitespace in between, e.g. `name({ ... } )`) so `call` is the
      // full, syntactically complete `name({...})` text used for identity.
      let callEnd = closeBraceInText + 1;
      while (callEnd < text.length && /\s/.test(text[callEnd])) callEnd++;
      if (text[callEnd] === ')') callEnd++;
      else callEnd = closeBraceInText + 1; // no closing paren found in the literal; don't guess

      const snippet = snippetOf(text, m.index, callEnd - m.index);
      const call = normaliseCallText(text.slice(m.index, callEnd));

      if (!inventoryNames.has(name)) {
        const v = { file: rel(file), line, tool: name, kind: 'phantom_tool', call, snippet };
        v.occurrence = nextOccurrence(v);
        violations.push(v);
        continue;
      }

      // Real tool: find its schema via the handler-map -> const -> block chain.
      const block = inventoryBlocks.get(name);
      if (!block) {
        // Already reported once in run() when building inventoryBlocks; nothing new per call site.
        continue;
      }
      if (block.schemaKeys === null) {
        // Already reported once in buildToolBlocks(); nothing new to add per call site.
        continue;
      }
      for (const key of keys) {
        if (!block.schemaKeys.has(key)) {
          const v = { file: rel(file), line, tool: name, param: key, kind: 'phantom_param', call, snippet };
          v.occurrence = nextOccurrence(v);
          violations.push(v);
        }
      }
      if (sawUnparsedSegment) {
        unparsed.push({ file: rel(file), line, reason: `could not parse every argument of "${name}({...})"` });
      }
    }

    // --- self-referential bare param mentions: "pass X" / "retry with X" ---
    selfRefRe.lastIndex = 0;
    while ((m = selfRefRe.exec(text))) {
      const ident = m[1];
      if (inventoryNames.has(ident) || CALL_ALLOWLIST.has(ident)) continue;
      const paramShaped = /_/.test(ident) || /[a-z][A-Z]/.test(ident);
      if (!paramShaped) continue;

      const absOffset = mapSegmentOffset(chunks, m.index);
      const block = findEnclosingBlock(blockRangesForFile, file, absOffset);
      if (!block) continue; // not attributable to a specific tool's own schema; not a core-required check

      if (block.schemaKeys === null) continue; // already reported as unparsed once
      if (!block.schemaKeys.has(ident)) {
        const line = lineFinder(absOffset);
        const snippet = snippetOf(text, m.index, m[0].length);
        const call = normaliseCallText(m[0]);
        const v = { file: rel(file), line, tool: block.declaredName, param: ident, kind: 'phantom_self_param', call, snippet };
        v.occurrence = nextOccurrence(v);
        violations.push(v);
      }
    }
  }
}

function findEnclosingBlock(blockRangesForFile, file, absOffset) {
  const ranges = blockRangesForFile.get(file);
  if (!ranges) return undefined;
  for (const r of ranges) {
    if (absOffset >= r.start && absOffset <= r.end) return r;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function run() {
  const unparsed = [];
  const violations = [];

  const indexSource = fs.readFileSync(INDEX_FILE, 'utf8');
  const { handlerMap, inlineBlocks } = buildHandlerMap(indexSource, unparsed); // aiName -> localIdentifier (as referenced in index.ts); inlineBlocks for schemas declared right inside the wrapper
  const importMap = buildImportMap(indexSource); // localIdentifier -> { file, importedName }

  const files = listTsFiles(REGISTRY_DIR);
  const toolBlocksByConst = buildToolBlocks(files, unparsed); // "file::constIdentifier" -> block

  // inventoryNames: every AI-facing tool name registered in the handler map — used for
  // tool-existence checks regardless of whether its schema could also be resolved.
  const inventoryNames = new Set([...handlerMap.keys(), ...inlineBlocks.keys()]);

  // inventoryBlocks: aiName -> its resolved tool block (file+const, disambiguated via
  // importMap since more than one file can export a same-named const — see buildHandlerMap).
  const inventoryBlocks = new Map();
  for (const [aiName, inlineBlock] of inlineBlocks) {
    inventoryBlocks.set(aiName, { file: rel(INDEX_FILE), start: -1, end: -1, ...inlineBlock });
  }
  for (const [aiName, localIdent] of handlerMap) {
    const imp = importMap.get(localIdent);
    const fileKey = imp ? imp.file : rel(INDEX_FILE);
    const constKey = imp ? imp.importedName : localIdent;
    const block = toolBlocksByConst.get(`${fileKey}::${constKey}`);
    if (block) {
      inventoryBlocks.set(aiName, block);
    } else {
      unparsed.push({ file: rel(INDEX_FILE), reason: `handler map tool "${aiName}" (const ${localIdent}${imp ? ` from ${imp.file}` : ''}) has no locatable tool block — its params were NOT checked at any call site` });
    }
  }

  // blockRangesForFile: file -> [{start,end,declaredName,schemaKeys}], for self-ref attribution.
  const blockRangesForFile = new Map();
  for (const block of toolBlocksByConst.values()) {
    const abs = path.join(ROOT, block.file);
    if (!blockRangesForFile.has(abs)) blockRangesForFile.set(abs, []);
    blockRangesForFile.get(abs).push(block);
  }

  const nextOccurrence = makeOccurrenceCounter();
  for (const file of files) {
    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch {
      unparsed.push({ file: rel(file), reason: 'could not read file' });
      continue;
    }
    const lineFinder = makeLineFinder(source);
    scanFileForViolations(file, source, lineFinder, inventoryNames, inventoryBlocks, blockRangesForFile, violations, unparsed, nextOccurrence);
  }

  return { violations, unparsed };
}

/**
 * IDENTITY, not line position: file + kind + tool + param(if any) + the normalised call text
 * + an occurrence index disambiguating repeats of that same tuple within one file. `line` is
 * deliberately excluded — see the IDENTITY note at the top of this file for why keying on it
 * both false-"new"s a merely-shifted violation and, worse, can false-MATCH two genuinely
 * different violations that happen to land on the same line number after a shift.
 */
function violationKey(v) {
  // "‖" (U+2016, double vertical line) as the field separator: printable, never appears in a
  // tool/param identifier or in normalised call text, and — unlike a NUL byte — survives
  // JSON.stringify and any future grep over the baseline file untouched (see
  // reference_raw_nul_makes_grep_blind: a literal 0x00 makes grep report a whole file as
  // binary and skip it silently).
  return [v.file, v.kind, v.tool, v.param || '', v.call, v.occurrence].join('‖');
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const wantWriteBaseline = args.includes('--write-baseline');

  const { violations, unparsed } = run();
  const currentByKey = new Map(violations.map((v) => [violationKey(v), v]));

  if (wantWriteBaseline) {
    const baseline = violations.map((v) => ({ key: violationKey(v), ...v }));
    baseline.sort((a, b) => a.key.localeCompare(b.key));
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
    console.log(`Wrote ${baseline.length} violations to ${rel(BASELINE_FILE)}`);
    if (unparsed.length) {
      console.log(`\n${unparsed.length} unparsed item(s) (not counted as violations, never silently dropped):`);
      for (const u of unparsed) console.log(`  ${u.file}${u.line ? ':' + u.line : ''} — ${u.reason}`);
    }
    return;
  }

  const baseline = loadBaseline();
  const baselineByKey = new Map(baseline.map((v) => [v.key, v]));

  const newViolations = [...currentByKey.entries()]
    .filter(([key]) => !baselineByKey.has(key))
    .map(([, v]) => v);
  const fixedViolations = [...baselineByKey.entries()]
    .filter(([key]) => !currentByKey.has(key))
    .map(([, v]) => v);

  const report = {
    currentCount: violations.length,
    baselineCount: baseline.length,
    newViolations,
    fixedViolations,
    unparsed,
  };

  if (wantJson) {
    // Always exit 0 for --json: the invariant test reads this report even when it contains
    // new violations, and asserts on the contents itself.
    console.log(JSON.stringify(report));
    return;
  }

  console.log(`Remedy lint: ${violations.length} current violation(s), ${baseline.length} in baseline.\n`);
  if (violations.length) {
    console.log('Violations:');
    for (const v of violations) {
      const label = v.kind === 'phantom_tool'
        ? `phantom tool "${v.tool}"`
        : v.kind === 'phantom_param'
          ? `"${v.tool}" called with unknown param "${v.param}"`
          : `"${v.tool}" advised to retry with unknown param "${v.param}"`;
      console.log(`  ${v.file}:${v.line} — ${label}`);
      console.log(`    ${v.snippet}`);
    }
    console.log('');
  }
  if (unparsed.length) {
    console.log(`${unparsed.length} unparsed item(s) (fail-closed — reported, never silently dropped):`);
    for (const u of unparsed) console.log(`  ${u.file}${u.line ? ':' + u.line : ''} — ${u.reason}`);
    console.log('');
  }
  if (newViolations.length) {
    console.log(`${newViolations.length} NEW violation(s) not present in the baseline:`);
    for (const v of newViolations) console.log(`  ${v.file}:${v.line} — ${v.tool}${v.param ? ':' + v.param : ''} (${v.kind})`);
  } else {
    console.log('No new violations beyond the baseline.');
  }
  if (fixedViolations.length) {
    console.log(`${fixedViolations.length} baseline violation(s) no longer present (baseline should shrink).`);
  }

  process.exit(newViolations.length > 0 ? 1 : 0);
}

main();
