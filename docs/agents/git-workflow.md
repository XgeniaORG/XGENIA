# Git Workflow

**Scope: the `XgeniaORG/XGENIA` repository only.** This document describes how
changes land in *this* repo. It does not govern the `private/` submodule,
which is a separate repository with a different branching model — see
[The `private/` submodule](#the-private-submodule) at the end.

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

## The `private/` submodule

`private/` is a git submodule pointing at a different repository,
`XgeniaORG/XFORGE_Private`. Nothing above applies to commits made *inside*
that working tree:

- Its default and working branch is `main`, and changes are normally
  committed **directly to `main`**. A `develop` branch does exist there, but
  it sees little use and should not be treated as the integration branch the
  way XGENIA's is — don't assume it is up to date, and don't route work
  through it out of habit carried over from this repo.
- No feature branch, PR, reviewer assignment or approval is required for a
  change inside `private/`. That is a deliberate difference, not an
  oversight, and you should not "helpfully" route a submodule change through
  a PR that nobody there is expecting.
- Because nothing gates a commit in that repo, confirm with the user before
  every commit and push inside `private/`. The absence of review makes that
  confirmation the only checkpoint there is.

Two boundaries are easy to get wrong, so state them plainly:

1. **Updating the submodule pointer is a change in *this* repo.** The commit
   that moves `private` to a new SHA is an XGENIA commit, and it is fully
   covered by the rules above: feature branch, PR against `develop`,
   approval, squash-merge. "It's only a pointer bump" is not an exemption —
   it is precisely the case this document exists for.
2. **The "ask before touching production" rule is not repo-scoped.** Confirm
   with the user before any commit, push, or merge, in either repository.

## Relationship to "ask before touching production"

This document governs *which branches* a change is allowed to land on in the
XGENIA repo. It does not loosen any standing instruction to confirm with the
user before actually running a commit, push, or merge — confirm first, then
follow the branch rules above.
