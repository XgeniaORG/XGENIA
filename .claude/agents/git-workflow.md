# Git workflow — read before any git command

This is the canonical policy every AI agent working in this repo must
follow. It is duplicated at the repo root as `CLAUDE.md` (auto-loaded by
Claude Code every session) and documented in full at
`docs/agents/git-workflow.md`. This copy exists so it's visible directly in
`.claude/agents/`.

## The rule — no exceptions, ever

`develop` and `main` are protected. This applies even to changes that look
trivial (version bumps, submodule pointer updates, config tweaks) and even
to accounts with admin/bypass rights on branch protection.

1. **Never commit directly on `develop` or `main` locally.**
2. **Never push directly to `develop` or `main`**, under any circumstance.
3. Start from an up-to-date `develop`, branch off:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
4. Do all work on that feature branch.
5. Open a PR against `develop` (never `main`) when ready.
6. Assign a reviewer from people who've recently pushed to `develop`,
   excluding yourself:
   ```bash
   git log origin/develop -20 --format='%an <%ae>' | sort -u
   ```
7. Never merge without an approval — even for a one-line change.
8. Once approved, squash-merge into `develop`.
9. `main` moves only at a public release, via a squash-merge from `develop`.

Self-check before any git command: if `HEAD` is `develop`/`main` and you're
about to `commit`, or you're about to `push origin develop`/`push origin
main` — stop. Branch first.

This governs which branches a change may land on. It does not override the
standing instruction to confirm with the user before actually running a
commit, push, or merge.
