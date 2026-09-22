# Git Workflow

**Scope: the `XgeniaORG/XGENIA` repository only.** This document describes how
changes land in *this* repo. It does not govern the `private/` submodule,
which is a separate repository with a different branching model — see
[The `private/` submodule](#the-private-submodule) at the end.

## What is protected, and what is not

Exactly two branches are protected: **`main`** and **`develop`**. Nothing else
is.

- **`main` and `develop`:** never commit on them locally, never push to them.
  Changes reach them only through a reviewed, approved PR (and `main` only at
  a release). This holds for every agent in every session, including for
  changes that look trivial — version bumps, submodule pointer updates, config
  tweaks. Those are exactly the kind of change that has slipped through as a
  direct, unreviewed push in the past. That stops here.
- **Every other branch is unprotected and yours to work on.** On a branch you
  created (`feature/…`, `fix/…`, `update/…`, whatever), you may commit and push
  freely — as many commits as the work takes, pushed as often as you like — and
  amend, rebase or force-push it while it is still your own. No PR, approval or
  ceremony is needed to move an unprotected branch. The review gate exists at
  the boundary into `develop`, not on every commit.

So the check before a commit is narrow: is `HEAD` on `main` or `develop`? If
yes, stop and branch. If no, commit.

## One branch per session, not one per change

Do **not** open a new branch for every edit. Within a session, accumulate the
work on a single branch:

1. At the start of the work, create one branch off an up-to-date `develop`:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/<short-description>
   ```
2. Keep committing and pushing to **that** branch for everything that belongs
   to this piece of work — follow-up fixes, review feedback, the tidy-up
   commit, the thing you forgot. A dozen tiny branches with a PR each is worse
   than one branch with a dozen commits: it multiplies review overhead for no
   gain and fragments a single change across PRs.
3. Only start a second branch when the work is genuinely a separate change —
   unrelated subject matter, or the first branch's PR is already open and you
   do not want the new work reviewed alongside it.

Naming: `feature/` for new work, `fix/` for a repair, `update/` for a
pointer/version bump. Keep it short and descriptive.

## Every branch ends in a PR

A branch is not finished when the last commit lands on it — it is finished
when a PR exists for it. Open the PR with the GitHub CLI as the closing step of
the work on that branch:

```bash
git push -u origin feature/<short-description>

gh pr create \
  --base develop \
  --head feature/<short-description> \
  --title "<what the change does>" \
  --body "<summary, and anything the reviewer needs to know>"
```

Rules for the PR:

- **Base is always `develop`**, never `main`.
- Assign a reviewer from the people who have recently pushed into `develop`,
  excluding the PR author. `--add-reviewer` takes a GitHub **login**, not a
  name or an email, so ask GitHub for the logins rather than reading them out
  of `git log`:
  ```bash
  # Logins of the linked GitHub accounts behind the last 30 develop commits,
  # deduplicated, with your own login dropped.
  ME=$(gh api user --jq .login)
  gh api 'repos/{owner}/{repo}/commits?sha=develop&per_page=30' \
    --jq '[.[] | .author | select(. != null) | .login] | unique | .[]' \
    | grep -vx "$ME"

  gh pr edit <number> --add-reviewer <login>
  ```
  `.author` is the GitHub account the commit is linked to; it is `null` when a
  commit's email isn't linked to any account, which is why the `select` is
  there. If the list comes back empty, ask the user who should review.
- Do not merge without an approval — even for a one-line or "obviously safe"
  change.
- Once approved, squash-merge:
  ```bash
  gh pr merge <number> --squash
  ```
- If more work on the same change arrives after the PR is open, push it to the
  same branch. The PR updates itself; do not open a second one.

`main` only moves at a public release, when `develop` is squash-merged into it.
Never push to `main` directly, and never merge into it outside of a release.

## Quick self-check before any git command

- About to `git commit` while `HEAD` is `develop` or `main`? Stop — create a
  branch first.
- About to `git push origin develop` or `git push origin main`? Stop — that is
  always wrong here, including from an account with admin/bypass rights on the
  branch protection rule. Bypass exists for genuine emergencies, not as a
  shortcut around review.
- About to `git checkout -b` for the third time this session? Check whether
  this really is separate work, or whether it belongs on the branch you are
  already on.
- Finished the work on a branch? Push it and open the PR — do not leave the
  branch sitting there.

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
   covered by the rules above: its own branch, PR against `develop`,
   approval, squash-merge. "It's only a pointer bump" is not an exemption —
   it is precisely the case this document exists for.
2. **The "ask before touching production" rule is not repo-scoped.** Confirm
   with the user before any commit, push, or merge, in either repository.

## Relationship to "ask before touching production"

This document governs *which branches* a change is allowed to land on in the
XGENIA repo. It does not loosen any standing instruction to confirm with the
user before actually running a commit, push, or merge — confirm first, then
follow the branch rules above.
