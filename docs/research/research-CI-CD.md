# CI/CD research: how popular projects release Electron apps, and how XGENIA compares

Research date: 2026-10-16. Method: the workflow and config files of ~40 public repositories, read from their default branches with `gh api`, plus GitHub, electron-builder and OpenSSF docs. Every claim links to the file it comes from; line anchors may drift as those repos change. Items marked **(unverified)** could not be confirmed from a file.

Our setup as of this writing is described in [`docs/update-plan.md`](../update-plan.md). In one paragraph:
- **Builds.** A private submodule (`private/`) holds closed-source code. A workflow bot runs PR checks against each new private commit, then pushes the pointer bump straight to `develop` over a deploy key. That starts a nightly, which also runs once a day.
- **Releases.** Nightlies publish `package.json`'s version (`3.0.2-beta.N`) to GitHub Releases as a pre-release, then commit the next version to `develop`.
- **Checks before publishing.** macOS is signed, notarized and verified. Linux is launch-tested under xvfb. Every `latest*.yml` is signed with our Ed25519 key. Releases go draft → read back and verify → publish.
- **Updates.** Installs choose Stable or Beta in Settings, and verify the manifest signature before downloading.

---

## Summary

**Where we're ahead of the projects surveyed**
- **Signed update manifests checked before download.** No surveyed Electron app does this yet. electron-builder only just added it, in 27.0.0-alpha.9, and it isn't in a stable release.
- **Reading the draft release back and verifying it before publishing.** Others create a draft and then publish, but none checks the draft automatically.
- **macOS checks:** codesign, spctl and stapler. Element only runs `codesign -dv`.

**Where we match common practice**
- Draft-then-publish.
- Merging the per-arch `latest-mac.yml` ourselves, as Beekeeper Studio does.
- Electron-updater channels picked by the user, as Beekeeper and Cherry Studio do.
- A launch check of the packaged Linux app under xvfb. Ours is stronger than Bitwarden's process-alive check, and close to Signal's.
- A deploy key in the ruleset bypass list with `[skip ci]`, as adobe/alloy, malloydata/malloy and Ghost do.

**Where we differ, and it matters**
1. **Windows builds are unsigned.** Every surveyed app signs them, mostly with cloud keys (Azure Trusted Signing about $10/month, Azure Key Vault, SSL.com eSigner, DigiCert KeyLocker, SignPath free for OSS).
2. **electron-builder 27 will make its own signed manifests mandatory** for `--publish` builds. We need a migration decision before upgrading past v24/26.
3. **Nobody commits a version bump to the main branch for every nightly.** Peers stamp the nightly version at build time, from the date, the commit, tags, or the highest published version plus 1.
4. **Nightlies use the `beta` label.** Most peers use a separate label (`nightly`, `next`, `canary`, `alpha`), so a real beta channel stays available.
5. **Actions are pinned by tag, not by commit SHA.** Electron, Signal, Podman, Insomnia, Mattermost and Bitwarden pin by SHA.
6. **Credentials are long-lived:** `PRIVATE_SUBMODULE_PAT` (a personal token) and the push deploy key. Peers lean towards one-hour GitHub App tokens, or keys behind protected environments.
7. **Launch testing runs on Linux only.** Signal, GitHub Desktop and Element launch the packaged app on all three OSes, with Playwright.
8. **No checksums file, SBOM or build provenance on releases.** Insomnia, Podman and others attach them.

The ranked recommendations are at the end.

---

## 1. Release pipelines: triggers, channels, where nightlies live

| Project | Nightly / pre-release trigger | Version scheme | Committed to the main branch? | Where nightlies live | Old nightlies |
|---|---|---|---|---|---|
| [Mattermost Desktop](https://github.com/mattermost/desktop/blob/master/.github/workflows/nightly-builds.yaml#L3-L6) | cron 04:00 UTC Sun–Fri + manual | `X.Y.Z-nightly.YYYYMMDD` ([patch-version.go](https://github.com/mattermost/desktop/blob/master/.github/actions/patch-nightly-version/patch-version.go#L31)) | No, a throwaway tag branch ([L16-27](https://github.com/mattermost/desktop/blob/master/.github/workflows/nightly-builds.yaml#L16-L27)) | S3 (`releases.mattermost.com`) | n/a |
| [Podman Desktop](https://github.com/podman-desktop/podman-desktop/blob/main/.github/workflows/next-build.yaml#L20-L24) | every push to `main` | `X.Y.Z-next.YYYYMMDDHHMM-<sha>` | No, a tag pushed only to a **separate `prereleases` repo** ([L66-78](https://github.com/podman-desktop/podman-desktop/blob/main/.github/workflows/next-build.yaml#L66-L78)) | GitHub Releases of `podman-desktop/prereleases` | Never deleted (1,000+) |
| [Element Desktop](https://github.com/element-hq/element-desktop/blob/develop/.github/workflows/build_and_deploy.yaml#L2-L12) | cron 09:00 UTC | `YYYYMMDDNN`: the live feed's version + 1 ([build_prepare.yaml#L109-124](https://github.com/element-hq/element-desktop/blob/develop/.github/workflows/build_prepare.yaml#L109-L124)) | No | Cloudflare R2. A **separate app**, "Element Nightly" ([build.json](https://github.com/element-hq/element-desktop/blob/develop/element.io/nightly/build.json)) | Only the latest kept |
| [LobeHub](https://github.com/lobehub/lobe-chat/blob/canary/.github/workflows/release-desktop-canary.yml#L29-L33) | push to `canary` | `X.Y.(Z+1)-canary.N`: highest tag + 1 ([L132-166](https://github.com/lobehub/lobe-chat/blob/canary/.github/workflows/release-desktop-canary.yml#L132-L166)) | No | GitHub pre-release + S3 per channel | Keeps 7, tags deleted too ([L566-633](https://github.com/lobehub/lobe-chat/blob/canary/.github/workflows/release-desktop-canary.yml#L566-L633)) |
| [Cherry Studio](https://github.com/CherryHQ/cherry-studio/blob/main/.github/workflows/nightly-build.yml#L3-L6) | cron 17:00 UTC | `nightly-YYYYMMDD` file names | No | Actions artifacts only, 3 days | Purged after 14 days |
| [Logseq](https://github.com/logseq/logseq/blob/master/.github/workflows/build-desktop-release.yml#L5-L27) | manual (cron disabled) | `X.Y.Z-alpha+nightly.YYYYMMDD` | No | **One moving `nightly` tag**, assets replaced each time | Nothing to prune |
| [Insomnia](https://github.com/Kong/insomnia/blob/develop/.github/workflows/release-recurring.yml#L3-L15) | every push to `develop` | `-alpha-pr-<sha>` at build time | No | Actions artifacts. Releases go through its **own update API** | n/a |
| [Tabby](https://github.com/Eugeny/tabby/blob/master/scripts/vars.mjs#L13-L18) | every push | `next-patch-nightly.$REV` from `git describe` | No | Artifacts; tags publish | n/a |
| [Signal](https://github.com/signalapp/Signal-Desktop/blob/main/scripts/utils/generateTaggedVersion.mjs) | CI on branches; publishing is private | `X.Y.Z-alpha.YYYYMMDD.HH-<sha>`. **Separate Beta app** ([prepare_beta_build.mjs](https://github.com/signalapp/Signal-Desktop/blob/main/scripts/prepare_beta_build.mjs)) | No | Own server `updates2.signal.org` | (unverified) |
| [Bitwarden](https://github.com/bitwarden/clients/blob/main/.github/workflows/version-auto-bump-desktop.yml#L6-L23) | tags | Stable bump only, after `desktop-v*` | Yes, but only after stable releases, through an external bot system | Own CDN | — |
| **XGENIA** | after every private commit + cron 02:00 UTC + manual | `3.0.2-beta.N` from `package.json` | **Yes, a bump commit after every nightly** | GitHub Releases of the main repo | Keeps 10, tags deleted |

**Stable releases elsewhere:**
- **Podman:** a draft, published by a final job only after every platform built ([L163-176](https://github.com/podman-desktop/podman-desktop/blob/main/.github/workflows/next-build.yaml#L163-L176)).
- **Electron Fiddle:** every matrix job runs `publish --dry-run`, then one job runs `--from-dry-run` ([release.yml#L157-192](https://github.com/electron/fiddle/blob/main/.github/workflows/release.yml#L157-L192)).
- **Rocket.Chat Electron:** a single job creates the draft, so the seven build jobs don't race to create it ([L25-30](https://github.com/RocketChat/Rocket.Chat.Electron/blob/dev/.github/workflows/build-release.yml#L25-L30)).
- **Cherry Studio:** requires the expected commit SHA as an input, and checks the tag still points there before publishing ([release.yml#L540-640](https://github.com/CherryHQ/cherry-studio/blob/main/.github/workflows/release.yml#L540-L640)).

**Channels in the app:**
- **One app with an electron-updater channel:** Beekeeper sets `allowPrerelease`, and the channel comes from the version ([update_manager.ts#L54-55](https://github.com/beekeeper-studio/beekeeper-studio/blob/master/apps/studio/src/background/update_manager.ts#L54-L55)). Cherry Studio has a "test plan" setting that sets `autoUpdater.channel` ([AppUpdaterService.ts#L211](https://github.com/CherryHQ/cherry-studio/blob/main/src/main/services/AppUpdaterService.ts#L211)).
- **A separate app identity:** Element Nightly, Signal Beta, LobeHub Beta/Nightly.

**Patterns**
- The nightly version is almost always **set at build time, never committed**.
- Nightly labels are almost never `beta`.
- Most projects keep nightlies **out of the main repo's Releases**: a separate repo, S3/R2, artifacts, or one moving tag. LobeHub is the exception, and it prunes the way we do.

## 2. Version bumps and getting past branch protection

| Project | Mechanism | Lands on the protected branch by | Bot identity |
|---|---|---|---|
| [changesets/changesets](https://github.com/changesets/changesets/blob/main/.github/workflows/publish.yml#L59-L72) | changesets "Version Packages" PR | Release PR | GitHub App token (`create-github-app-token`), in `environment: version` |
| [grafana/k6-studio](https://github.com/grafana/k6-studio/blob/main/.github/workflows/release-please.yml#L26-L35) (Electron) | release-please | Release PR (draft) | GitHub App token |
| [nodejs/node-gyp](https://github.com/nodejs/node-gyp/blob/main/.github/workflows/release-please.yml#L18-L21) | release-please, pinned by SHA | Release PR | PAT |
| [electron/forge](https://github.com/electron/forge/blob/main/.github/workflows/release.yml#L37-L85) | Bump PR. The publish job **checks the commit only changed the `version` field** before releasing | PR | App token through `electron/secret-service-action` |
| [podman-desktop](https://github.com/podman-desktop/podman-desktop/blob/main/.github/workflows/release.yaml#L104-L130) | After a stable release, a PR bumps `main` to `X.Y.Z-next` with `gh pr merge --auto` | Auto-merged PR | Bot PAT |
| [semantic-release](https://github.com/semantic-release/semantic-release/blob/master/.github/workflows/release.yml#L3-L35) | Version only in tags and npm | **No bump commit at all** | `GITHUB_TOKEN` |
| [lerna](https://github.com/lerna/lerna/blob/main/.github/workflows/release.yml#L88-L98) | `lerna version` | Direct push | PAT in a gated environment |
| [mattermost/desktop](https://github.com/mattermost/desktop/blob/master/.github/workflows/run-release-script.yml#L60-L81) | Release script | Direct push, but only to `release-X.Y`, checked by regex | PAT |
| [adobe/alloy](https://github.com/adobe/alloy/blob/main/.github/workflows/version-and-publish.yml#L59-L84), [malloydata/malloy](https://github.com/malloydata/malloy/blob/main/.github/workflows/release.yaml#L116-L121), [TryGhost/Ghost](https://github.com/TryGhost/Ghost/blob/main/.github/workflows/release.yml#L47-L59) | Version commits `… [skip ci]` | **Direct push over a deploy key in the bypass list**, the same as ours | Deploy key |

**GitHub's documented rules:**
- **The built-in token doesn't trigger workflows.** "Events triggered by the `GITHUB_TOKEN` will not create a new workflow run", except `workflow_dispatch` and `repository_dispatch` ([docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)). That's why our bot pushes over a deploy key, and why it starts the nightly with `gh workflow run`.
- **Deploy keys as ruleset bypass actors:**
  - The REST API accepts `DeployKey` as a bypass `actor_type`. "For pull requests only" is **not** available for deploy keys ([REST rules](https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28)), so a deploy key in the bypass list can always push directly.
  - The prose docs still list deploy keys only for GHES ([docs source](https://github.com/github/docs/blob/main/data/reusables/repositories/rulesets-bypass-step.md)). It works on github.com regardless: our version bump `43b60a8` landed on `develop` that way.
- **`[skip ci]`** covers `push` and `pull_request` events only. It doesn't stop `workflow_run`, schedules or `pull_request_target`, and required checks on a skipped commit stay "Pending" ([docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)).

**Submodule pointer automation:**
- **Dependabot** `gitsubmodule` (version updates only, no security updates; [docs](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories)) and **Renovate** `git-submodules` (beta, opt-in; [docs](https://docs.renovatebot.com/modules/manager/git-submodules/)) both **open PRs**.
- Custom workflows do the same: [openpilot](https://github.com/commaai/openpilot/blob/master/.github/workflows/repo-maintenance.yaml#L50-L69), [runfinch/finch](https://github.com/runfinch/finch/blob/main/.github/workflows/sync-submodules-and-deps.yaml#L34-L43) and [LiveSplit](https://github.com/LiveSplit/LiveSplit/blob/master/.github/workflows/update-submodules.yml#L28-L34) each run `git submodule update --remote` and open a PR.
- **None of them push the pointer straight to a protected branch.** The gate is always a PR with required checks. Our bot runs the same checks itself before pushing: the same gate, without the PR record.

## 3. Open-core: building with private code

| Model | Who | How CI gets the private code | Forks |
|---|---|---|---|
| **Same repo, separate license folder** | GitLab `ee/` ([docs](https://docs.gitlab.com/development/ee_features/)), PostHog `ee/` ([LICENSE](https://github.com/PostHog/posthog/blob/master/LICENSE)), Bitwarden `bitwarden_license/` ([LICENSE](https://github.com/bitwarden/server/blob/main/LICENSE.txt)), n8n `.ee.` files, Rocket.Chat `ee/` | Nothing to fetch, but the "private" code is public (source-available) | Forks run with dummy licenses (Rocket.Chat [ci.yml#L49-51](https://github.com/RocketChat/Rocket.Chat/blob/develop/.github/workflows/ci.yml#L49-L51)) or skip licensed tests (n8n [L400-422](https://github.com/n8n-io/n8n/blob/master/.github/workflows/ci-pull-requests.yml#L400-L422)) |
| **Private repo fetched at build time** | Grafana ([setup-enterprise](https://github.com/grafana/grafana/blob/main/.github/actions/setup-enterprise/action.yml)), Mattermost (sibling `enterprise` repo plus a Go build tag, [Makefile#L61-74](https://github.com/mattermost/mattermost/blob/master/server/Makefile#L61-L74)), Webstudio (private submodule over a deploy key, [action.yml](https://github.com/webstudio-is/webstudio/blob/main/.github/actions/submodules-checkout/action.yml)) | Grafana: **one-hour GitHub App token minted from Vault over OIDC**, no stored PAT ([L86-102](https://github.com/grafana/grafana/blob/main/.github/workflows/backend-unit-tests.yml#L86-L102)). Webstudio: an SSH deploy key, skipped when absent | Grafana runs a separate OSS-only job for forks ([L39-74](https://github.com/grafana/grafana/blob/main/.github/workflows/backend-unit-tests.yml#L39-L74)) |
| **Private superset repo** | HashiCorp Vault Enterprise ([ci.yml#L57-92](https://github.com/hashicorp/vault/blob/main/.github/workflows/ci.yml#L57-L92)) | Official builds run in the private repo | Community PRs are copied in behind an approval environment and a CLA check ([L26-64](https://github.com/hashicorp/vault/blob/main/.github/workflows/copy-external-contributor-pull-request-ce.yml#L26-L64)) |
| **Pinned private distro, internal CI** | VS Code: `package.json` pins `"distro": "<sha>"` ([L4](https://github.com/microsoft/vscode/blob/main/package.json#L4)). Azure Pipelines check out the private repos with an App service connection, "avoids the need for a long-lived PAT" ([download-distro.yml](https://github.com/microsoft/vscode/blob/main/build/azure-pipelines/distro/download-distro.yml#L1-L19)) | Only internal CI can resolve the private repo | Public GitHub CI builds Code-OSS only |

**Forks and secrets:**
- Forks get no secrets, except a read-only `GITHUB_TOKEN` ([docs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)).
- `pull_request_target` combined with a checkout of the PR's code is the classic "pwn request" ([GitHub Security Lab](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)).
- **Bitwarden's reviewed way to build a fork PR with secrets:** a `ci:signed-build` label → a `pull_request_target` workflow → a check that whoever added the label has write access → the label is removed so every new commit needs a fresh review → `secrets: inherit` ([build-desktop-target.yml](https://github.com/bitwarden/clients/blob/main/.github/workflows/build-desktop-target.yml)).
- **Environments:** "a job cannot access environment secrets until one of the required reviewers approves it", and environments can be limited to specific branches ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)).

**Where we sit.** Our model is "private repo pinned by commit" (VS Code, Grafana). We skip private checks on fork PRs using `head.repo.full_name == github.repository`, the same gate as Mattermost and Grafana. The difference is credentials: we use a **long-lived PAT** for the private checkout, where Grafana and VS Code use short-lived App tokens and Webstudio a read-only deploy key.

## 4. Code signing

**Windows** (every surveyed app signs):

| Approach | Who | Notes |
|---|---|---|
| **Azure Trusted Signing** (now "Artifact Signing") | [GitHub Desktop](https://github.com/desktop/desktop/blob/development/.github/actions/setup-windows-signing/action.yml#L25-L34), [Electron Fiddle](https://github.com/electron/fiddle/blob/main/.github/workflows/release.yml#L114-L143), [Mattermost via electron-builder `azureSignOptions`](https://github.com/mattermost/desktop/blob/master/electron-builder.ts#L204-L208) | About **$9.99/month for 5,000 signatures** ([product page](https://azure.microsoft.com/en-us/products/artifact-signing)). OIDC `azure/login`, so no stored secret. Needs a paid Azure subscription and identity validation; country and entity eligibility **(unverified)**. `azureSignOptions` needs electron-builder **≥ 25.1** ([#8458](https://github.com/electron-userland/electron-builder/pull/8458)). |
| Azure Key Vault + AzureSignTool | [Podman](https://github.com/podman-desktop/podman-desktop/blob/main/.electron-builder.config.cjs#L188-L191), [Bitwarden](https://github.com/bitwarden/clients/blob/main/apps/desktop/sign.js) | Your own certificate stored in Key Vault |
| SSL.com eSigner | [Element](https://github.com/element-hq/element-desktop/blob/develop/.github/workflows/build_windows.yaml#L215-L237), [Joplin](https://github.com/laurent22/joplin/blob/dev/.github/workflows/github-actions-main.yml#L99-L102) | Element signs non-release builds with eSigner **demo** credentials so the signing path is always tested, and runs `signtool verify /pa` on releases |
| DigiCert KeyLocker | [Insomnia](https://github.com/Kong/insomnia/blob/develop/.github/workflows/release-build.yml#L138-L141) | — |
| jsign + Google Cloud KMS | [Beekeeper](https://github.com/beekeeper-studio/beekeeper-studio/blob/master/.github/workflows/studio-publish.yml#L109-L124) | jsign jar pinned by checksum |
| SignPath (free for OSS) | [Heroic](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/.github/workflows/draft-release-win.yml#L9-L48) | Signs after the build, so Heroic **recomputes sha512 and blockmaps** afterwards ([fixWindowsUpdateInfo.js](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/.github/scripts/fixWindowsUpdateInfo.js)) |

electron-builder's docs note that EV certificates no longer get instant SmartScreen reputation; Microsoft now treats EV and OV the same ([code-signing-win.md#L23](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/code-signing/code-signing-win.md#L23)).

**macOS:** everyone uses a `.p12` plus notarytool through `@electron/notarize`. Element checks the mounted DMG with `codesign -dv` ([build_macos.yaml#L146-150](https://github.com/element-hq/element-desktop/blob/develop/.github/workflows/build_macos.yaml#L146-L150)). Our codesign `--deep --strict` + `spctl` + `stapler validate` goes further than anything surveyed.

## 5. Testing the packaged app before release

| Project | Test | OSes | Gates the release |
|---|---|---|---|
| **Signal** | [`test-release.mjs`](https://github.com/signalapp/Signal-Desktop/blob/main/scripts/test-release.mjs): checks files inside the asar, then Playwright `_electron.launch` on the **packaged** app and asserts a visible window | mac, win, linux (xvfb) | Yes ([ci.yml#L180](https://github.com/signalapp/Signal-Desktop/blob/main/.github/workflows/ci.yml#L180)) |
| **GitHub Desktop** | Installs the signed app (`/Applications`; silent Squirrel install on Windows), then a Playwright smoke run, with videos uploaded | mac arm64, win x64 | In CI; gating (unverified) ([ci.yml#L198-350](https://github.com/desktop/desktop/blob/development/.github/workflows/ci.yml#L198)) |
| **Element** | Playwright against the built executable, inside each platform's build workflow; deploy waits for it | win, mac, linux | Yes ([build_and_deploy.yaml#L113-118](https://github.com/element-hq/element-desktop/blob/develop/.github/workflows/build_and_deploy.yaml#L113-L118)) |
| Bitwarden | Install each package, launch under `xvfb-run`, `pgrep` after 30 s | linux, mac, win | (unverified) |
| Podman | Playwright e2e after a pre-release is published | linux | No |
| **XGENIA** | Packaged Linux app under xvfb with `XGENIA_SMOKE_TEST=1`. Passes only if React renders into `#root` and is still rendered 10 s later | linux | Yes |

## 6. Update feeds, integrity, blockmaps, macOS architectures

**Where feeds are hosted:**
- **Large apps run their own CDN:** Signal (`updates.signal.org`), Bitwarden (`artifacts.bitwarden.com`), Element (R2), Mattermost (S3), Insomnia (own API).
- **Mid-size open-source apps use GitHub Releases + electron-updater:** Joplin, Beekeeper, Heroic, Cherry, Tabby, Rocket.Chat. None of the surveyed apps use Hazel, Nuts or update.electronjs.org.

**Signed manifests (electron-builder upstream):**
- **What it does:** [PR #9877](https://github.com/electron-userland/electron-builder/pull/9877) (27.0.0-alpha.9) signs `latest*.yml` with Ed25519 and embeds the signatures in the manifest. The public keys go in `app-update.yml`. Verification happens before download, fails closed, and supports multiple keys for rotation. The signature covers `version`, `stagingPercentage`, `minimumSystemVersion`, and each file's `url`, `sha512` and `size` ([docs](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/signed-update-manifests.md#L143)).
- **It becomes mandatory:** [PR #10255](https://github.com/electron-userland/electron-builder/pull/10255) requires it for any `--publish` build; the opt-out is `updateManifest: false`.
- **Status:** 27.0.0-alpha.10 / electron-updater 7.0.0-alpha.9. Not in stable (26.17 / 6.8.10). The v26 backport was closed.
- **Adoption:** no surveyed Electron app verifies manifests yet. Ours is the same idea as upstream, in a different format.

**Staged rollouts:** Bitwarden uses `stagingPercentage`, with a workflow that reports the live rollout percentage ([retrieve-current-desktop-rollout.yml](https://github.com/bitwarden/clients/blob/main/.github/workflows/retrieve-current-desktop-rollout.yml#L23-L30)). It means editing `latest*.yml` by hand ([docs](https://github.com/electron-userland/electron-builder/blob/master/website/docs/features/auto-update.md#L315-L327)), which for us would also mean re-signing the manifest.

**Blockmaps:**
- **Most apps still ship them:** Joplin, Beekeeper, Heroic, Podman, Cherry, Tabby, Rocket.Chat. Signal even uses `differentialPackage` + `better-blockmap`. Insomnia ships none ([release](https://github.com/Kong/insomnia/releases/tag/core%4013.3.1)).
- **Known problems:** a 50 MB limit on private GitHub feeds ([#4676](https://github.com/electron-userland/electron-builder/issues/4676)), parse failures ([#6184](https://github.com/electron-userland/electron-builder/issues/6184)), slow differential downloads ([#9063](https://github.com/electron-userland/electron-builder/issues/9063)), and blockmaps going stale when signing happens after the build.
- **Dropping them is safe:** electron-updater falls back to a full download.
- **Upstream is still working on them:** a v3 blockmap format is in progress ([#10312](https://github.com/electron-userland/electron-builder/pull/10312)).

**macOS arm64 + x64:**
- **Universal builds** avoid merging manifests, at roughly twice the download size: Element, Bitwarden, Mattermost, Insomnia.
- **Signal** ships per-arch zips for updates plus a universal dmg.
- **Both architectures on one runner** writes a single `latest-mac.yml`: Heroic, Cherry.
- **Merging by hand, as we do:** [Beekeeper](https://github.com/beekeeper-studio/beekeeper-studio/blob/master/.github/workflows/studio-publish.yml#L370-L430).

**Checksums, SBOM, provenance:**
- **Checksums:** Joplin ships `.sha512` files; SiYuan ships `SHA256SUMS.txt`.
- **SBOM:** Podman attaches SPDX ([release-generate-sbom.yaml#L46-57](https://github.com/podman-desktop/podman-desktop/blob/main/.github/workflows/release-generate-sbom.yaml#L46-L57)); Insomnia attaches CycloneDX + SPDX.
- **Provenance:** Insomnia attaches SLSA L3 provenance ([release-publish.yml#L321-343](https://github.com/Kong/insomnia/blob/develop/.github/workflows/release-publish.yml#L321-L343)). No popular Electron app found uses `actions/attest-build-provenance`.

## 7. Workflow hardening

- **OpenSSF Scorecard** ([checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md)):
  - *Token-Permissions:* read-only at the top level, write per job.
  - *Pinned-Dependencies:* actions pinned by commit hash.
  - *Dangerous-Workflow:* no untrusted input in `run:`, and no `pull_request_target` with a PR checkout.
  - *Branch-Protection:* any bypass actor lowers the score.
- **GitHub's secure-use guide** ([docs](https://docs.github.com/en/actions/reference/security/secure-use)) says the same: pin to full commit SHAs, pass expressions through `env:` rather than into `run:`, use least-privilege tokens, and prefer short-lived OIDC credentials.
- **Who pins actions by SHA:**
  - **Yes:** electron/electron (which also runs Scorecard, [scorecards.yml](https://github.com/electron/electron/blob/main/.github/workflows/scorecards.yml#L11-L54)), electron/forge, Podman, Signal, Insomnia (plus StepSecurity harden-runner), Mattermost, changesets, pnpm, Node.
  - **No:** Joplin, Chakra UI, React Router.
- **Our status:**
  - **Already done:** inputs reach scripts only through `env:`, enforced by `scripts/release/workflows.test.mjs`. The deploy key and signing key only reach jobs that install no npm packages.
  - **Not done:** SHA pinning. A top-level `permissions: {}`. `notify-team.yml` still uses `checkout@v3` and declares no permissions.

---

## Scorecard: XGENIA against the survey

| Area | Status | Notes |
|---|---|---|
| Signed update manifests | **Ahead** | No surveyed app has this; upstream has it only in alpha |
| Draft → read back and verify → publish | **Ahead** | Others publish drafts without checking them |
| macOS sign, notarize, verify | **Ahead** | spctl and stapler checks too |
| Packaged-app launch test | **Partial** | Linux only; Signal, GitHub Desktop and Element test all OSes |
| Windows signing | **Gap** | Every surveyed app signs |
| Nightly versions | **Unusual** | We commit a bump per nightly; peers stamp at build time |
| Nightly channel label | **Unusual** | `beta` instead of `nightly` / `next` / `canary` |
| Nightlies in the main repo's Releases | **Unusual** | LobeHub is the only peer that does the same |
| Blockmaps | **Unusual, but safe** | Most ship them; Insomnia doesn't; full-download fallback |
| Private code in CI | **Common model** | Same as VS Code and Grafana; credentials weaker (long-lived PAT) |
| Pointer bot | **Unusual** | Peers open auto-merging PRs; ours runs the same checks, then pushes |
| Action pinning, token permissions | **Gap** | Mature Electron repos pin by SHA |
| Checksums, SBOM, provenance | **Gap** | Cheap to add |

## Recommendations, in priority order

1. **Sign Windows builds.** Azure Trusted Signing is about $10/month, with OIDC login so no secret is stored. Copy GitHub Desktop's or Fiddle's setup, or use `azureSignOptions` after upgrading to electron-builder ≥ 25.1 (Mattermost's setup). Check eligibility first. Add Element's `signtool verify /pa` after signing. If signing ever runs after the build (Heroic's flow), recompute `sha512` in `latest.yml` before our Ed25519 signature is applied.
2. **Decide on electron-builder 27's mandatory signed manifests before upgrading.** Either move to its format, so `update-manifest.js` can go, or set `updateManifest: false` on purpose and keep ours. Moving needs one release that both the old and new apps accept.
3. **Stop committing a bump per nightly.** Compute `beta.N` as the highest released `beta.N` + 1. `next-version.mjs` already skips taken versions, so this is mostly deleting the `bump-version` job for nightlies. Keep the bump after stable releases only, as Bitwarden does, possibly as an auto-merged PR (Podman). That removes most of the deploy-key pushes to `develop`.
4. **Give nightlies their own label** (`3.0.3-nightly.N`), and point Settings → Updates → Beta at it with electron-updater's `channel`. That leaves `beta` free for hand-picked betas later. Optional: keep nightlies out of the main repo's Releases (Podman's separate `prereleases` repo) so the Releases page shows only real releases.
5. **Harden the workflows:**
   - Pin every third-party action to a full SHA, with a version comment, and let Dependabot update the pins.
   - Add a top-level `permissions: {}` and grant permissions per job.
   - Fix `notify-team.yml`.
   - Optionally add Scorecard (electron/electron's workflow) and the `zizmor` workflow linter (pnpm).
6. **Shorter-lived, narrower credentials:**
   - Replace `PRIVATE_SUBMODULE_PAT` with a **read-only deploy key on the private repo**, or a GitHub App installed only there.
   - Put `UPDATE_SIGNING_KEY`, the Apple secrets and `BOT_DEPLOY_KEY` in a protected **environment** limited to `develop` / `main`, with required reviewers for stable releases.
   - Longer term: a GitHub App as the bypass actor instead of the deploy key (short-lived tokens, attributable commits).
7. **Launch the packaged app on macOS and Windows too,** using Playwright `_electron.launch` (Signal's `test-release.mjs` is a small template). Make it required before the draft is published.
8. **Attach `SHA256SUMS`, an SBOM** (`anchore/sbom-action`), **and build provenance** (`actions/attest-build-provenance`) to releases. They're cheap, and users can check them with `gh attestation verify`.
9. **Keep:** the draft read-back check, signed manifests, the macOS checks, input-through-`env` and its tests, the hand-merged mac manifest, and no-blockmaps (fine while every update is a full download).

**Already in place** (some reports listed these as suggestions):
- **Skip if nothing changed:** the nightly does nothing when `develop`'s newest commit already has a release.
- **No cancelled publishes:** release concurrency doesn't cancel a run in progress.
- **Pruning removes tags too:** `--cleanup-tag`.
- **A launch test gates the release.**
