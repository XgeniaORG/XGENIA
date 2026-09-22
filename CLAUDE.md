# XGENIA — instructions for Claude Code

## Git workflow — hard rule, no exceptions

**Scope: this repository only** (`XgeniaORG/XGENIA`). It does *not* govern the
`private/` submodule — see "The `private/` submodule" below.

**Only `main` and `develop` are protected. Every other branch is not** — on a
branch you created you may commit, push, amend and force-push freely, as often
as the work needs. The review gate is at the boundary into `develop`, not on
every commit. The protected-branch rule applies to every agent in every
session, including for changes that look trivial (version bumps, submodule
pointer updates, config tweaks):

1. **Never commit directly on `develop` or `main` locally.** Run
   `git branch --show-current` before committing; if it's `develop` or
   `main`, create a branch first instead.
2. **Never push directly to `develop` or `main`**, under any circumstance —
   even from an account with admin/bypass rights on the branch protection
   rule. Bypass is for emergencies, not for skipping review.
3. Start the work from an up-to-date `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
4. **One branch per session, not one per change.** Accumulate all the work
   for this piece of work on that single branch — follow-ups, fixes, review
   feedback included. Don't spin up a dozen branches in one session; only
   branch again for genuinely separate work.
5. **When you're done on the branch, open a PR** — a branch isn't finished
   until a PR exists for it. Push it and use the GitHub CLI, base always
   `develop`, never `main`:
   ```bash
   git push -u origin feature/<short-description>
   gh pr create --base develop --title "<what it does>" --body "<summary>"
   ```
   More work on the same change after the PR is open goes on the same branch;
   don't open a second PR.
6. Assign a reviewer from people who've recently pushed to `develop`
   (`git log origin/develop -20 --format='%an <%ae>' | sort -u`), excluding
   the PR author: `gh pr edit <number> --add-reviewer <username>`.
7. Never merge without an approval, even for a one-line change. Once
   approved, squash-merge: `gh pr merge <number> --squash`.
8. `main` moves only at a public release, via a squash-merge from `develop`
   — never a direct push or an off-cycle merge.

Full detail and rationale: `docs/agents/git-workflow.md`.

This governs *which branches* a change may land on. It does not replace the
standing instruction to confirm with the user before actually running a
commit, push, or merge — ask first, then follow the branch rules above.

## The `private/` submodule

`private/` is a separate repository (`XgeniaORG/XFORGE_Private`) with its own
conventions: `main` is the working branch and changes are normally committed
straight to it. A `develop` branch exists there but is not part of the usual
flow, so don't assume it's current or route work through it by habit. The
rules above do not apply inside it — no feature branch, no PR, no approval
gate is required.

Because there is no review gate in that repo, the "ask first" rule carries
more weight there, not less: confirm with the user before every commit and
push inside `private/`.

Two things still hold when you touch the submodule:

- Bumping the submodule pointer is a change **in this repo**, so that commit
  goes on its own branch and through a PR against `develop` like any other.
- Ask the user before running any commit, push, or merge — in either repo.
