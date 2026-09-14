# Git Workflow

`develop` and `main` are protected branches. This rule applies to every agent
working in this repo — no exceptions, including for changes that look trivial
(version bumps, submodule/subproject pointer updates, config tweaks). Those
are exactly the kind of change that has slipped through as a direct,
unreviewed push in the past. That stops here.

## The rule

1. **Never commit directly on `develop` or `main` locally.** Check
   `git branch --show-current` before committing. If it says `develop` or
   `main`, stop and create a feature branch first — do not commit.
2. **Never push directly to `develop` or `main`, under any circumstance.**
   This applies even to accounts with admin/bypass rights on the branch
   protection rule. Bypass exists for genuine emergencies, not as a shortcut
   around review.
3. Start every piece of work from an up-to-date `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
4. Do all the work — every commit — on that feature branch.
5. When the branch is ready, push it and open a PR **against `develop`**
   (never against `main`).
6. Assign a reviewer chosen from people who have recently pushed into
   `develop`, excluding yourself:
   ```bash
   git log origin/develop -20 --format='%an <%ae>' | sort -u
   ```
   Pick one of those people (not the PR author) as the reviewer.
7. Do not merge without an approval — even for a one-line or "obviously
   safe" change.
8. Once approved, squash-merge the PR into `develop`.
9. `main` only moves at a public release: `develop` is squash-merged into
   `main` at that point. Never push to `main` directly, and never merge into
   it outside of a release.

## Quick self-check before any git command

If you are about to run `git commit` while `HEAD` is `develop` or `main`, or
`git push origin develop` / `git push origin main` — stop. That is always
wrong here. Create a feature branch instead, or route the change through a
PR as above.

## Relationship to "ask before touching production"

This document governs *which branches* a change is allowed to land on. It
does not loosen any standing instruction to confirm with the user before
actually running a commit, push, or merge — confirm first, then follow the
branch rules above.
