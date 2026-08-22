#!/usr/bin/env node
/**
 * ASSET REFERENCE CHECKER
 *
 * Every image the editor references at runtime must actually exist under src/.
 * Two reference styles are checked, because neither one is validated by webpack:
 *
 *  1. Tooltip images. `createTooltip({ images: [{ src }] })` builds a raw HTML
 *     string (`src/assets/images/tooltips/<src>`), injected into the DOM at
 *     runtime. Webpack never sees the path, so a missing file only shows up as a
 *     broken-image icon inside the property-panel tooltip.
 *
 *  2. CSS `url(...)`. css-loader runs with `url: false`, so these are emitted
 *     verbatim and resolved by the browser, not by webpack. A missing file is a
 *     silent 404. Note the resolution base is NOT the source file: styles under
 *     src/editor/src/ are injected by style-loader into src/editor/index.html,
 *     so their urls resolve against src/editor/. Static stylesheets that are
 *     copied and <link>ed as-is resolve against their own directory.
 *
 * Run: node scripts/check-asset-references.js
 * Exits non-zero and lists every reference whose target is absent.
 */

const fs = require('fs');
const path = require('path');

const editorRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(editorRoot, 'src');
const repoRoot = path.resolve(editorRoot, '..', '..');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'bundles', 'lib', '.git', 'parse-dashboard-public']);

function walk(dir, test, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), test, out);
    } else if (test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const problems = [];

function report(file, reference, resolved) {
  if (!fs.existsSync(resolved)) {
    problems.push({
      file: path.relative(repoRoot, file),
      reference,
      resolved: path.relative(repoRoot, resolved)
    });
  }
}

// --- 1. Tooltip images -------------------------------------------------------
// The prefix is hardcoded in tooltips.js; keep the two in sync if it ever moves.
const TOOLTIP_DIR = path.join(srcRoot, 'assets', 'images', 'tooltips');

// The port definitions live outside the editor package (they are shipped with the
// runtime), so look for every copy that feeds this editor.
const portDefinitionFiles = [
  path.join(repoRoot, 'packages', 'xgenia-viewer-react', 'src', 'node-shared-port-definitions.js'),
  path.join(repoRoot, 'private', 'xgenia-pro-nodes', 'src', 'utils', 'node-shared-port-definitions.js')
].filter((file) => fs.existsSync(file));

for (const file of portDefinitionFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/src:\s*'([^']+\.svg)'/g)) {
    report(file, match[1], path.join(TOOLTIP_DIR, match[1]));
  }
}

// --- 2. CSS url(...) references ---------------------------------------------
// style-loader inlines the editor's stylesheets into src/editor/index.html, so a
// relative url() there is resolved by the browser against that document, not
// against the .css file it was authored in.
const BUNDLED_STYLE_ROOT = path.join(srcRoot, 'editor', 'src') + path.sep;
const BUNDLED_STYLE_BASE = path.join(srcRoot, 'editor');

function urlBaseFor(file) {
  return file.startsWith(BUNDLED_STYLE_ROOT) ? BUNDLED_STYLE_BASE : path.dirname(file);
}

const styleFiles = walk(srcRoot, (name) => name.endsWith('.css') || name.endsWith('.scss'));

for (const file of styleFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
    const reference = match[1].trim();
    // Only relative file references resolve against the source tree.
    if (/^(data:|https?:|\/\/|#)/.test(reference)) continue;
    const cleaned = reference.split(/[?#]/)[0];
    if (!cleaned) continue;
    report(file, reference, path.resolve(urlBaseFor(file), cleaned));
  }
}

// --- Result ------------------------------------------------------------------
if (problems.length === 0) {
  console.log('Asset references OK — every referenced image exists.');
  process.exit(0);
}

console.error(`Missing asset targets: ${problems.length}\n`);
for (const problem of problems) {
  console.error(`  ${problem.file}`);
  console.error(`    references: ${problem.reference}`);
  console.error(`    expected:   ${problem.resolved}\n`);
}
process.exit(1);
