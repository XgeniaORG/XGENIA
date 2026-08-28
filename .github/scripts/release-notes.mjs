#!/usr/bin/env node
/**
 * Builds the release body for the rolling `nightly` pre-release.
 *
 * The notes describe what changed since the most recent *stable* release tag
 * (V2.1.0 and friends), grouped the way the hand-written V2.x notes are, plus a
 * short delta against the nightly this build replaces.
 *
 * Everything comes from git, so it needs no credential and cannot fail the
 * build. `polish-release-notes.mjs` optionally rewrites the middle of the file
 * -- the part between the notes:begin/notes:end markers -- into prose.
 *
 * Usage: node release-notes.mjs --out release-notes.md [--assets-dir nightly-dist]
 * Reads: VERSION, RUN_NUMBER, REPO, SHA, REF_NAME, PREV_NIGHTLY_SHA
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';

// --- args / env --------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const OUT = arg('out', 'release-notes.md');
const DIGEST = arg('digest', '');
const ASSETS_DIR = arg('assets-dir', '');

const VERSION = process.env.VERSION || '0.0.0';
const RUN_NUMBER = process.env.RUN_NUMBER || '0';
const REPO = process.env.REPO || 'XgeniaORG/XGENIA';
const SHA = process.env.SHA || '';
const REF_NAME = process.env.REF_NAME || '';
const PREV_NIGHTLY_SHA = (process.env.PREV_NIGHTLY_SHA || '').trim();

const RELEASE_URL = `https://github.com/${REPO}/releases/download/nightly`;

// --- git --------------------------------------------------------------------

const git = (...args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
  } catch {
    return '';
  }
};

const parseVersion = (s) => {
  const m = /^[vV]?(\d+)\.(\d+)\.(\d+)/.exec(String(s).trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
};
const cmpVersion = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Stable release tags (V1.2.3), newest first. Pre-release tags are ignored. */
const stableTags = () =>
  git('tag', '--list')
    .split('\n')
    .map((t) => t.trim())
    .map((tag) => {
      const m = /^[vV](\d+)\.(\d+)\.(\d+)$/.exec(tag);
      return m ? { tag, v: [+m[1], +m[2], +m[3]] } : null;
    })
    .filter(Boolean)
    .sort((a, b) => cmpVersion(b.v, a.v));

const exists = (ref) => Boolean(ref) && git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== '';
const countIn = (range) => {
  const n = git('rev-list', '--count', range);
  return /^\d+$/.test(n) ? Number(n) : 0;
};

/**
 * The comparison point: the newest stable tag below the version being built, so
 * a nightly for 2.1.1 reads against V2.1.0 rather than against itself. Falls
 * back to the newest stable tag, then to the nightly being replaced.
 */
function pickBase() {
  const pkg = parseVersion(VERSION);
  const tags = stableTags().filter((t) => exists(t.tag));
  if (tags.length) {
    const below = pkg && tags.find((t) => cmpVersion(t.v, pkg) < 0);
    const chosen = below || tags[0];
    return { ref: chosen.tag, label: chosen.tag, kind: 'tag' };
  }
  if (exists(PREV_NIGHTLY_SHA)) {
    return { ref: PREV_NIGHTLY_SHA, label: 'the previous nightly build', kind: 'nightly' };
  }
  return { ref: '', label: '', kind: 'none' };
}

function readCommits(range) {
  const raw = git('log', '--no-merges', `--pretty=format:%H%x1f%s%x1f%an`, range);
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      const [sha, subject, author] = line.split('\x1f');
      return { sha: (sha || '').slice(0, 7), subject: (subject || '').trim(), author: (author || '').trim() };
    })
    .filter((c) => c.subject);
}

// --- classification ---------------------------------------------------------

const IGNORE = [
  /^merge (branch|pull request|remote|commit)/i,
  /^wip\b/i,
  /^\.+$/,
  /^(minor|small|another) (fix|change|tweak|update)s?\.?$/i,
];

// Submodule bumps and dependency churn. Checked first: many of them read like
// features ("Bump private for the design-canvas default") but they are pointer
// moves, and the hand-written notes file them under maintenance.
const MAINTENANCE = [
  /^(chore:\s*)?bump\b/i,
  /^chore:/i,
  /^(update|refresh|sync)\s+(the\s+)?(private|submodule)/i,
  /\bprivate (folder )?sync\b/i,
  /\bsubproject commit\b/i,
  /^rebuild (the )?bundles?/i,
  /^(bump|update) (dep|deps|dependency|dependencies|package|package-lock|lockfile)/i,
  /^private update/i,
  /^lock ?file\b/i,
];

const FEATURE = [
  /^(add|adds|added|introduce|introduces|implement|implements|implemented|enable|enables|create|creates|support|new)\b/i,
  /\badd(s|ed)? (the )?(capability|ability|support|option)\b/i,
  /\b(new|first-class) (node|panel|feature|tool|command|view|document|workflow)\b/i,
  /\bnow (supports|ships|offers)\b/i,
];

const FIX = [
  /^(fix|fixes|fixed|resolve|resolves|correct|corrects|repair|patch|prevent|prevents|stop|stops|restore|restores|revert|reverts|guard|harden)\b/i,
  /\b(bug|regression|crash|crashes|broken|breaks|leak|hang|freeze|typo|deadlock|race condition)\b/i,
  /\b(could not|cannot|can't|does not|doesn't|never ran|no longer|failed to|stops? \w+ing)\b/i,
  /\b(issue|error)s?\b.*\b(fix|in|on|with)\b/i,
];

// Ordered most-specific first; the first area whose pattern matches wins.
const AREAS = [
  ['AI & Chat', /\b(ai|llm|prompts?|chat|claude|openrouter|openai|mcp|agents?|oracle|condenser|models?)\b/i],
  ['Maths, RGS & Gameplay', /\b(rgs|maths?|operators?|rtp|ggr|bet\w*|wager\w*|payout\w*|paytable|reels?|spins?|rounds?|simulat\w*|wallets?|player\w*|balance\w*|deposit\w*|withdraw\w*|currency|provably|psp|crypto|payment\w*|games?|keno|slots?|sessions?)\b/i],
  ['Image Editor & Design', /\b(images?|canvas|svg|psd|textures?|art|artwork|thumbnails?|key-art|palette|recolou?r|sprites?|videos?|audio|design)\b/i],
  ['Runtime, Engine & Viewer', /\b(runtime|viewer|engine|pixi\w*|render\w*|signals?|graphs?|ports?|layouts?|flex|margins?|insets?|anchors?|animations?|tweens?|nodes?|gizmo|dom|styles?|converter)\b/i],
  ['Editor & UI', /\b(editor|ui|ux|panels?|topbar|toolbar|sidebar|icons?|menus?|dialogs?|modals?|settings|home ?screen|scroll\w*|resiz\w*|banners?|tooltips?|shortcuts?|themes?|templates?|projects?|assets?|browser|inspector)\b/i],
  ['Version Control & Publishing', /\b(git|github|commits?|branch\w*|publish\w*|deploy\w*|vercel|version control|source control|releases?)\b/i],
  ['Accounts & Platform', /\b(accounts?|subscriptions?|tiers?|pro|free|plans?|login|sign-?in|sign-?up|auth\w*|supabase|licen[cs]e\w*|feedback|e-?mails?|invites?|telemetry)\b/i],
  ['Build, Packaging & CI', /\b(workflows?|pipelines?|ci|builds?|webpack|lerna|npm|electron|packag\w*|installers?|dmg|appimage|nsis|submodules?|typescript|tsconfig|eslint|tests?)\b/i],
  ['Documentation', /\b(docs?|documentation|docusaurus|readme|changelog|node-docs)\b/i],
];

const classify = (subject) => {
  if (MAINTENANCE.some((re) => re.test(subject))) return 'maintenance';
  if (FEATURE.some((re) => re.test(subject))) return 'feature';
  if (FIX.some((re) => re.test(subject))) return 'fix';
  return 'improvement';
};

const areaOf = (subject) => {
  // Split camelCase identifiers too, so "MathsPanel.tsx" and "EditorBridge"
  // land in an area instead of falling through to General.
  const probe = `${subject} ${subject.replace(/([a-z0-9])([A-Z])/g, '$1 $2')}`;
  for (const [name, re] of AREAS) if (re.test(probe)) return name;
  return 'Other';
};

/** Turn a raw commit subject into a readable bullet. */
function display(subject) {
  let s = subject;

  // "chore: bump private to a9b6e0a (bug-sweep wave 1: 13 fixes)" -> the reason
  const bump = /^(?:chore:\s*)?bump\s+(?:the\s+)?private\b(.*)$/i.exec(s);
  if (bump) {
    let rest = bump[1].trim();
    // Drop the co-bumped artefacts ("and the node-docs search index") and the
    // "to <sha>" / "for" connectors, keeping only the stated reason.
    rest = rest.replace(/^and\b[^,;]*?\b(?=for\b)/i, '');
    rest = rest.replace(/^(?:to|for)\b[\s:-]*/i, '');
    const paren = /^[0-9a-f]{6,40}\s*\((.+)\)$/i.exec(rest);
    if (paren) rest = paren[1];
    else rest = rest.replace(/^[0-9a-f]{7,40}\b[\s:,-]*/i, '');
    rest = rest.replace(/^(?:to|for)\b[\s:-]*/i, '').trim();
    s = rest ? `Private submodule: ${rest}` : 'Private submodule update';
  } else {
    s = s.replace(/^(chore|feat|fix|refactor|docs|test|build|ci|style|perf)(\([^)]*\))?:\s*/i, '');
  }

  s = s.replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s;
}

// --- rendering --------------------------------------------------------------

const SECTIONS = [
  ['feature', '## ✨ New Features'],
  ['improvement', '## 🚀 Improvements'],
  ['fix', '## 🐛 Fixes & Stability'],
];

function groupByArea(commits) {
  const groups = new Map();
  for (const c of commits) {
    const area = areaOf(c.subject);
    if (!groups.has(area)) groups.set(area, []);
    groups.get(area).push(c);
  }
  // Biggest areas first, "General" always last.
  return [...groups.entries()].sort((a, b) => {
    // Unclassified changes always land at the bottom of their section.
    if (a[0] === 'Other') return 1;
    if (b[0] === 'Other') return -1;
    return b[1].length - a[1].length;
  });
}

function renderSection(heading, commits, perArea) {
  if (!commits.length) return '';
  const out = [heading, ''];
  for (const [area, items] of groupByArea(commits)) {
    out.push(`### ${area}`, '');
    for (const c of items.slice(0, perArea)) out.push(`- ${c.text}`);
    if (items.length > perArea) {
      out.push(`- _…and ${items.length - perArea} further ${area.toLowerCase()} change${items.length - perArea === 1 ? '' : 's'}._`);
    }
    out.push('');
  }
  return out.join('\n');
}

function renderMaintenance(commits, cap) {
  if (!commits.length) return '';
  const out = ['## 📦 Maintenance', ''];
  out.push(
    `${commits.length} maintenance commit${commits.length === 1 ? '' : 's'} — private submodule pointers, dependency and bundle refreshes. Expanded below.`,
    ''
  );
  out.push('<details>', `<summary>Maintenance commits (${commits.length})</summary>`, '');
  for (const c of commits.slice(0, cap)) out.push(`- ${c.text}`);
  if (commits.length > cap) out.push(`- _…and ${commits.length - cap} more._`);
  out.push('', '</details>', '');
  return out.join('\n');
}

const ASSET_ROWS = [
  ['macOS (Apple Silicon)', 'XGENIA-nightly-macos-arm64.dmg'],
  ['macOS (Intel)', 'XGENIA-nightly-macos-x64.dmg'],
  ['Windows (x64)', 'XGENIA-nightly-windows.exe'],
  ['Linux (x64, .deb)', 'XGENIA-nightly-linux.deb'],
  ['Linux (x64, AppImage)', 'XGENIA-nightly-linux.AppImage'],
];

function renderDownloads() {
  const present = ASSETS_DIR && existsSync(ASSETS_DIR) ? new Set(readdirSync(ASSETS_DIR)) : null;
  // With no staged directory to inspect, advertise the full set.
  const rows = ASSET_ROWS.filter(([, file]) => !present || present.has(file));
  if (!rows.length) return '';
  const out = ['## Downloads', '', '| Platform | Download |', '| --- | --- |'];
  for (const [label, file] of rows) out.push(`| ${label} | [${file}](${RELEASE_URL}/${file}) |`);
  const missing = ASSET_ROWS.filter(([, file]) => present && !present.has(file));
  out.push('');
  if (missing.length) {
    out.push(`> Not produced by this build: ${missing.map(([l]) => l).join(', ')}.`, '');
  }
  out.push('These links are permanent — every run replaces the files in place.', '');
  return out.join('\n');
}

function buildBody({ perArea, maintenanceCap }) {
  const base = pickBase();
  const range = base.ref ? `${base.ref}..HEAD` : 'HEAD';
  const raw = readCommits(range);

  const seen = new Set();
  const commits = [];
  for (const c of raw) {
    if (IGNORE.some((re) => re.test(c.subject))) continue;
    const text = display(c.subject);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    commits.push({ ...c, text, kind: classify(c.subject) });
  }

  const byKind = (k) => commits.filter((c) => c.kind === k);
  const authors = [...new Set(raw.map((c) => c.author).filter(Boolean))];
  const files = git('diff', '--shortstat', `${base.ref || 'HEAD'}..HEAD`);

  const head = [];
  head.push(`# XGENIA Nightly — V${VERSION} (build #${RUN_NUMBER})`);
  head.push('');
  head.push(
    '> **Pre-release.** This is the automated nightly build of XGENIA. It is rebuilt and',
    '> replaced in place on every pipeline run, so the download links always point at the',
    '> newest build. It is not a shipping release and the in-app updater deliberately',
    '> ignores it.'
  );
  head.push('');
  head.push(
    `**Version** \`${VERSION}\` · **Build** \`#${RUN_NUMBER}\`` +
      (REF_NAME ? ` · **Branch** \`${REF_NAME}\`` : '') +
      (SHA ? ` · **Commit** [\`${SHA.slice(0, 7)}\`](https://github.com/${REPO}/commit/${SHA})` : '') +
      ` · **Built** ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`
  );
  head.push('');
  head.push(renderDownloads());
  head.push('---');
  head.push('');

  const notes = [];
  notes.push('# Release Notes');
  notes.push('');
  if (!base.ref) {
    notes.push('_No earlier release was found to compare against, so this build lists no changes._');
    notes.push('');
  } else {
    const scope = [
      `${commits.length} change${commits.length === 1 ? '' : 's'}`,
      files ? files.replace(/^\s+/, '') : '',
      authors.length > 1 ? `${authors.length} contributors` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    notes.push(
      base.kind === 'tag'
        ? `Everything below landed **after the ${base.label} release** — this is what you get in the nightly that you do not get in ${base.label}.`
        : `Everything below landed after ${base.label}.`
    );
    notes.push('');
    notes.push(`_${scope}._`);
    notes.push('');

    for (const [kind, heading] of SECTIONS) {
      const section = renderSection(heading, byKind(kind), perArea);
      if (section) notes.push(section);
    }
    const maint = renderMaintenance(byKind('maintenance'), maintenanceCap);
    if (maint) notes.push(maint);

    if (commits.length === 0) {
      notes.push('_No commits between this build and ' + base.label + '._', '');
    }
  }

  // Delta against the nightly this build replaces.
  const tail = [];
  if (exists(PREV_NIGHTLY_SHA) && PREV_NIGHTLY_SHA !== SHA) {
    const since = readCommits(`${PREV_NIGHTLY_SHA}..HEAD`).filter(
      (c) => !IGNORE.some((re) => re.test(c.subject))
    );
    tail.push('---', '');
    tail.push('## Since the previous nightly', '');
    if (!since.length) {
      tail.push(
        `No new commits since the nightly at \`${PREV_NIGHTLY_SHA.slice(0, 7)}\` — this build is a rebuild of the same code.`,
        ''
      );
    } else {
      tail.push(
        `${since.length} new commit${since.length === 1 ? '' : 's'} since the nightly at \`${PREV_NIGHTLY_SHA.slice(0, 7)}\`:`,
        ''
      );
      const cap = 25;
      for (const c of since.slice(0, cap)) tail.push(`- ${display(c.subject)}`);
      if (since.length > cap) tail.push(`- _…and ${since.length - cap} more._`);
      tail.push('');
    }
  } else if (PREV_NIGHTLY_SHA && PREV_NIGHTLY_SHA === SHA) {
    tail.push('---', '', '## Since the previous nightly', '', 'Same commit as the previous nightly — this is a rebuild.', '');
  }

  if (base.ref && SHA) {
    if (!tail.length) tail.push('---', '');
    tail.push(
      `**Full changelog:** [\`${base.kind === 'tag' ? base.label : base.ref.slice(0, 7)}\` → \`${SHA.slice(0, 7)}\`](https://github.com/${REPO}/compare/${base.ref}...${SHA})`
    );
    tail.push('');
  }

  return {
    body:
      head.join('\n') +
      '<!-- notes:begin -->\n' +
      notes.join('\n').replace(/\n{3,}/g, '\n\n') +
      '<!-- notes:end -->\n' +
      tail.join('\n'),
    stats: { commits: commits.length, base: base.label },
    digest: {
      version: VERSION,
      run: RUN_NUMBER,
      base: base.label,
      baseKind: base.kind,
      diffstat: files,
      contributors: authors.length,
      commits: commits.map((c) => ({ sha: c.sha, kind: c.kind, area: areaOf(c.subject), text: c.text })),
    },
  };
}

// GitHub rejects release bodies over 125,000 characters; step the caps down
// rather than emit something that fails to publish.
const LIMIT = 118000;
let result = buildBody({ perArea: 14, maintenanceCap: 200 });
for (const preset of [
  { perArea: 10, maintenanceCap: 80 },
  { perArea: 6, maintenanceCap: 30 },
  { perArea: 4, maintenanceCap: 0 },
]) {
  if (result.body.length <= LIMIT) break;
  result = buildBody(preset);
}
let body = result.body;
if (body.length > LIMIT) {
  body = body.slice(0, LIMIT) + '\n\n_…notes truncated to fit GitHub’s release-body limit._\n';
}

writeFileSync(OUT, body, 'utf8');
if (DIGEST) writeFileSync(DIGEST, JSON.stringify(result.digest, null, 2), 'utf8');
console.log(`Wrote ${OUT} (${body.length} chars, ${result.stats.commits} changes since ${result.stats.base || 'n/a'})`);
