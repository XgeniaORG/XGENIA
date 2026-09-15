# XGENIA — instructions for Claude Code

## Git workflow — hard rule, no exceptions

**Scope: this repository only** (`XgeniaORG/XGENIA`). It does *not* govern the
`private/` submodule — see "The `private/` submodule" below.

`develop` and `main` are protected branches here. This applies to every agent
in every session, including for changes that look trivial (version bumps,
submodule pointer updates, config tweaks):

1. **Never commit directly on `develop` or `main` locally.** Run
   `git branch --show-current` before committing; if it's `develop` or
   `main`, create a feature branch first instead.
2. **Never push directly to `develop` or `main`**, under any circumstance —
   even from an account with admin/bypass rights on the branch protection
   rule. Bypass is for emergencies, not for skipping review.
3. Always start from an up-to-date `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
4. Do the work on that feature branch, open a PR against `develop` (never
   `main`) when it's ready.
5. Assign a reviewer from people who've recently pushed to `develop`
   (`git log origin/develop -20 --format='%an <%ae>' | sort -u`), excluding
   the PR author.
6. Never merge without an approval, even for a one-line change.
7. Once approved, squash-merge into `develop`.
8. `main` moves only at a public release, via a squash-merge from `develop`
   — never a direct push or an off-cycle merge.

Full detail and rationale: `docs/agents/git-workflow.md`.

This governs *which branches* a change may land on. It does not replace the
standing instruction to confirm with the user before actually running a
commit, push, or merge — ask first, then follow the branch rules above.

## The `private/` submodule

`private/` is a separate repository (`XgeniaORG/XFORGE_Private`) with its own
conventions: it has no `develop` branch, and work lands on `main`. The rules
above do not apply inside it — don't branch off a `develop` that doesn't
exist there, and don't open PRs against `develop` there. Follow that repo's
own workflow, and ask the user what it is if you're unsure.

Two things still hold when you touch the submodule:

- Bumping the submodule pointer is a change **in this repo**, so that commit
  goes on a feature branch and through a PR against `develop` like any other.
- Ask the user before running any commit, push, or merge — in either repo.
