# XGENIA — instructions for Claude Code

## Git workflow — hard rule, no exceptions

`develop` and `main` are protected branches. This applies to every agent in
every session, including for changes that look trivial (version bumps,
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
