#!/usr/bin/env node
/**
 * Optional second pass over the generated nightly notes.
 *
 * `release-notes.mjs` produces accurate but commit-shaped notes. This rewrites
 * the block between the notes:begin/notes:end markers into the curated prose
 * style of the hand-written V2.x releases, using the newest stable release's
 * own notes as the style reference.
 *
 * It runs only when ANTHROPIC_API_KEY is set, and it never fails the build: any
 * error leaves the generated notes exactly as they were.
 *
 * Usage: node polish-release-notes.mjs --notes release-notes.md --digest digest.json
 * Reads: ANTHROPIC_API_KEY, REPO, GITHUB_TOKEN (optional), VERSION, RUN_NUMBER
 */

import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';

const argv = process.argv.slice(2);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const NOTES = arg('notes', 'release-notes.md');
const DIGEST = arg('digest', '');
const REPO = process.env.REPO || 'XgeniaORG/XGENIA';
const VERSION = process.env.VERSION || '';
const RUN_NUMBER = process.env.RUN_NUMBER || '';

const BEGIN = '<!-- notes:begin -->';
const END = '<!-- notes:end -->';

const warn = (msg) => console.log(`::warning title=Release notes::${msg}`);

/** The newest published stable release's body, used as the style exemplar. */
async function styleReference() {
  try {
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'xgenia-release-notes' };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, { headers });
    if (!res.ok) return '';
    const releases = await res.json();
    const stable = releases.find((r) => !r.draft && !r.prerelease && (r.body || '').length > 400);
    return stable ? `${stable.name || stable.tag_name}\n\n${stable.body}`.slice(0, 24000) : '';
  } catch {
    return '';
  }
}

const SYSTEM = `You are the release manager for XGENIA, a desktop visual editor for building
casino/slot games (Electron + PixiJS) with an AI assistant, an image editor, and a maths/RGS
backend pipeline.

You write the release notes for its nightly builds. Your job is to turn a mechanical,
commit-shaped changelog into the same curated notes a careful human maintainer would write:
grouped by what a user would notice, with short thematic sub-headings and bullets that say
what changed and why it matters.

Rules you must follow:
- Ground every statement in the supplied commits. Never invent a feature, a fix, a number, a
  version, or a platform detail that is not in the input. If the material is thin, write less.
- Do not drop substance. Every meaningful commit should be represented, merged with related
  ones where that reads better. Routine maintenance (private submodule pointer bumps,
  dependency and lockfile churn, bundle rebuilds) must be condensed into one short section,
  not enumerated.
- Match the reference notes' register: Markdown, emoji section headings, "###" thematic
  sub-headings, terse declarative bullets. British/neutral English, no marketing language, no
  "we are excited to".
- Write for someone deciding whether to install this build over the previous release. Lead
  with what is new or different.
- Output ONLY the release-notes Markdown body. No preamble, no code fence around the whole
  answer, no closing commentary. Start with a top-level "# Release Notes" heading.
- Do not include download links, version/build/commit metadata, or a changelog footer — those
  are added around your output automatically.`;

async function main() {
  const full = readFileSync(NOTES, 'utf8');
  const start = full.indexOf(BEGIN);
  const end = full.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    warn('Could not find the notes markers; leaving the generated notes unchanged.');
    return;
  }
  const generated = full.slice(start + BEGIN.length, end).trim();

  let digest = null;
  if (DIGEST) {
    try {
      digest = JSON.parse(readFileSync(DIGEST, 'utf8'));
    } catch {
      warn('Could not read the commit digest; polishing from the generated notes alone.');
    }
  }

  const commitLines = (digest?.commits || [])
    .map((c) => `- [${c.kind}/${c.area}] ${c.text}`)
    .join('\n');

  const reference = await styleReference();

  const prompt = [
    `Rewrite the release notes for the XGENIA nightly build of version ${VERSION} (build #${RUN_NUMBER}).`,
    `They describe everything that changed since the ${digest?.base || 'previous'} release.`,
    digest?.diffstat ? `Scope: ${digest.diffstat}.` : '',
    '',
    reference
      ? `# Style reference — the most recent stable release's own notes\n\nMatch this voice, structure and level of detail.\n\n<reference>\n${reference}\n</reference>\n`
      : '',
    `# Mechanical notes to rewrite\n\n<generated>\n${generated}\n</generated>\n`,
    commitLines
      ? `# Every commit in this range, pre-classified (kind/area)\n\nUse this so nothing meaningful is lost — the mechanical notes above truncate long groups.\n\n<commits>\n${commitLines}\n</commits>\n`
      : '',
    'Now write the release notes body.',
  ]
    .filter(Boolean)
    .join('\n');

  const client = new Anthropic();
  const stream = client.messages.stream({
    model: 'claude-opus-5',
    max_tokens: 32000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high' },
    messages: [{ role: 'user', content: prompt }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    warn(`Model declined to write the notes (${message.stop_details?.category ?? 'unknown'}); keeping the generated notes.`);
    return;
  }

  let polished = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Strip a stray fence if the model wrapped the whole answer in one.
  const fenced = /^```(?:markdown|md)?\n([\s\S]*)\n```$/.exec(polished);
  if (fenced) polished = fenced[1].trim();

  if (polished.length < 400 || !/^#\s/m.test(polished)) {
    warn('Polished notes looked wrong (too short or unstructured); keeping the generated notes.');
    return;
  }

  const body = `${full.slice(0, start + BEGIN.length)}\n${polished}\n${full.slice(end)}`;
  if (body.length > 118000) {
    warn('Polished notes exceeded the release-body limit; keeping the generated notes.');
    return;
  }

  writeFileSync(NOTES, body, 'utf8');
  console.log(
    `Polished ${NOTES}: ${generated.length} -> ${polished.length} chars ` +
      `(in ${message.usage.input_tokens}, out ${message.usage.output_tokens} tokens)`
  );
}

main().catch((err) => {
  // Never fail the release over cosmetics.
  warn(`Polish step failed (${err?.message || err}); keeping the generated notes.`);
});
