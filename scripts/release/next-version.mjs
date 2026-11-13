#!/usr/bin/env node
// Editor version numbering for releases (2026-10-15). packages/xgenia-editor/package.json holds the
// version the NEXT release will carry; every release moves it on by one (bumpVersion):
//   3.0.2        -> 3.0.3          (stable: next patch)
//   3.0.2-beta.1 -> 3.0.2-beta.2   (pre-release: last number + 1)
//
// nightly.yml publishes nightlyVersion() and release.yml (manual) publishes stableVersion(); both then
// commit bumpVersion(<what they published>) to develop with setVersion(), which never lowers it.
// Dependency-free: it runs in jobs that install nothing.
//
// Usage:
//   next-version.mjs nightly <package version> [released tags file]  → version a nightly publishes
//   next-version.mjs stable  <package version> [released tags file]  → version a manual release publishes
//   next-version.mjs bump    <version>                               → the version after it
//   next-version.mjs set     <package.json> <version>                → writes it if higher; prints the result
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parse(version) {
  const m = SEMVER.exec(String(version).trim().replace(/^[vV]/, ''));
  if (!m) throw new Error(`not a version: ${version}`);
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

const isNum = (s) => /^\d+$/.test(s);

/** semver ordering: <0, 0, >0. */
export function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // a release outranks its pre-releases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    if (i >= x.pre.length) return -1;
    if (i >= y.pre.length) return 1;
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    if (isNum(p) && isNum(q)) return +p - +q;
    if (isNum(p)) return -1;
    if (isNum(q)) return 1;
    return p < q ? -1 : 1;
  }
  return 0;
}

const format = ({ major, minor, patch, pre }) => `${major}.${minor}.${patch}${pre.length ? '-' + pre.join('.') : ''}`;
export const isPrerelease = (version) => parse(version).pre.length > 0;

/** The version after `version`: next patch for a release, last number + 1 for a pre-release. */
export function bumpVersion(version) {
  const v = parse(version);
  if (!v.pre.length) return format({ ...v, patch: v.patch + 1 });
  const pre = [...v.pre];
  const last = pre.length - 1;
  if (isNum(pre[last])) pre[last] = String(+pre[last] + 1);
  else pre.push('1'); // 3.0.2-beta -> 3.0.2-beta.1
  return format({ ...v, pre });
}

const releasedSet = (tags) => new Set(tags.map((t) => t.trim()).filter(Boolean).map((t) => format(parse(t))));
const skipReleased = (version, released) => {
  let v = version;
  for (let i = 0; released.has(v); i++) {
    if (i > 1000) throw new Error(`no free version after ${version}`);
    v = bumpVersion(v);
  }
  return v;
};

/**
 * What a nightly publishes: the package version if it is a pre-release; for a release version, its
 * first beta (3.0.3 -> 3.0.3-beta.1), or the next patch's if that release is already out. Never a
 * version that already has a release (drafts included).
 */
export function nightlyVersion(packageVersion, releasedTags = []) {
  const released = releasedSet(releasedTags);
  let v = format(parse(packageVersion));
  if (!isPrerelease(v)) {
    if (released.has(v)) v = bumpVersion(v);
    v = `${v}-beta.1`;
  }
  return skipReleased(v, released);
}

/** What a manual release publishes: the package version without its pre-release part. */
export function stableVersion(packageVersion, releasedTags = []) {
  const { major, minor, patch } = parse(packageVersion);
  return skipReleased(format({ major, minor, patch, pre: [] }), releasedSet(releasedTags));
}

/** Writes `version` into package.json only if it is higher than what is there; returns what is there after. */
export function setVersion(packageJsonPath, version) {
  const text = fs.readFileSync(packageJsonPath, 'utf8');
  const pkg = JSON.parse(text);
  if (compare(version, pkg.version) <= 0) return pkg.version;
  // Replace only the version line, so the rest of the file (order, formatting) is untouched.
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${format(parse(version))}$2`);
  if (next === text) throw new Error(`no "version" field in ${packageJsonPath}`);
  fs.writeFileSync(packageJsonPath, next);
  return format(parse(version));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, a, b] = process.argv.slice(2);
  const tags = (file) => (file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : []);
  try {
    if (cmd === 'nightly' && a) console.log(nightlyVersion(a, tags(b)));
    else if (cmd === 'stable' && a) console.log(stableVersion(a, tags(b)));
    else if (cmd === 'bump' && a) console.log(bumpVersion(a));
    else if (cmd === 'set' && a && b) console.log(setVersion(a, b));
    else {
      console.error('usage: next-version.mjs nightly|stable <version> [tags file] | bump <version> | set <package.json> <version>');
      process.exit(2);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
