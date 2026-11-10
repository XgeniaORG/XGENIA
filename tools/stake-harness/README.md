# Stake Engine harness

**Question it answers:** will this game work on Stake Engine, bonus rounds included?
It answers with one command, which an agent can run and read without a person in the loop.

```bash
node tools/stake-harness/cli.mjs check <math-dir> --game <stake-build-dir> --tls --expect-feature
```

- `<math-dir>` is the directory you upload to Stake as the maths. The editor writes it as `<folder>/math/publish_files`.
- `<stake-build-dir>` is the frontend folder that **Deploy → Stake** writes.

The command exits `0` on pass and `1` on fail. It prints the reason for each check and writes `report.json` plus screenshots of every scenario to `--out`. The default `--out` is `./stake-harness-report`.

## Why it exists

Games built in XGENIA got stuck in bonus rounds on Stake, and nothing caught it locally:

- **The old mock hid the problems.** `scripts/mock-rgs-server.mjs` plays random rounds, one per call, ends every round cleanly and never resumes.
- **Stake doesn't work per spin.** One `/wallet/play` returns the *whole* paid event as a book: base spin, trigger, every free spin and the final win.
- **The frontend has to finish the round.** It must animate all of the book and then call `/wallet/end-round`. Until it does, the win is unpaid and the next bet is refused.

The full analysis, dated 2026-11-09, is on the Stake-plan thread. This harness is the agreed pass/fail gate for both approaches being tried:

- fixing the compiler/export;
- adding a Book Connector in the runtime.

## The three layers

| Layer | What it plays | Catches |
|---|---|---|
| `validate` | the files | Stake's own upload checks (math-sdk `utils/rgs_verification.py`: payout grid, LUT ↔ books, RTP 96.0–96.7 %, every mode within 0.5 % of base, cheapest mode 1×, max cost 50,000×, max win 1,000,000×, base std ≥ 0.6) **plus** the bonus checks Stake's verifier does not make (below) |
| `bot` | the books, through a faithful Stake RGS, by a *correct* client | base game reaching its bonus, buys entering the feature, resume after a reload, replay, a refused double play, balances reconciling to the minor unit |
| `browser` | the **real game build** in headless Chromium against the same RGS | the stuck bonus (a winning round never ended), ending too early, no progress saves, no resume after reload, a paid play per free spin, wallet calls in replay |

The validator's bonus checks are errors, not warnings, because each one means a stuck or wrong bonus in front of a player:

| Code | Meaning |
|---|---|
| `BASE_NEVER_TRIGGERS_FEATURE` | A buy mode proves the game has a bonus, but no base book has more than one round. The free spins were dropped at export. |
| `BASE_NEVER_TRIGGERS_FEATURE` with `--expect-feature` | Same check for a base-only export. Pass `--expect-feature` whenever the game has free spins or a bonus: with no buy mode, nothing else tells the harness the bonus exists. |
| `BUY_NOT_IN_FEATURE` | A book in a buy mode is a single spin. The player paid the buy price for an ordinary spin. |
| `EVENT_INDEX` | `index` is not 0..n-1 matching array position. Resume slices by position, so a reload lands on the wrong event. |
| `FINALWIN_MISMATCH` / `SHOWN_WIN_MISMATCH` | The events show a different win from the `payoutMultiplier` Stake pays. |
| `EVENTS_XRGS_DIALECT` | Books use XRGS `round`/`featureRound` events, not Stake's (`reveal`, `finalWin` …). Only a frontend that plays that dialect works. This is a warning; `--strict` makes it an error. |

## Commands

```bash
# The gate: validate + bot + browser
node tools/stake-harness/cli.mjs check <math-dir> --game <build-dir> --tls

# The files only
node tools/stake-harness/cli.mjs validate <math-dir> [--expect-feature] [--strict] [--json] [--buy-modes bonus,super]

# Books through a correct client
node tools/stake-harness/cli.mjs bot <math-dir> [--soak 200]

# A real build
node tools/stake-harness/cli.mjs browser <math-dir> --game <build-dir> --tls \
     [--spin-selector "#spin"] [--buy-steps "#buy,#confirm-yes"] [--replay-selector "#play"]

# Run a Stake RGS to play by hand
node tools/stake-harness/cli.mjs emulate <math-dir> --port 5050 [--game <build-dir>] [--tls]

# A real build against Engine's real RGS, with a session from Engine's dashboard ("Start game session")
node tools/stake-harness/cli.mjs engine <build-dir> --session-url "<the session URL>" [--rounds 10]

# Put every mode's RTP on target (see the caveat below)
node tools/stake-harness/cli.mjs rebalance <math-dir> --rtp 0.963 [--into <dir>]

# A known-good sample, or one with one defect
node tools/stake-harness/cli.mjs fixture <dir> [--flavour standard|xrgs|drop-free-spins|buy-single-round|index-1based|finalwin-mismatch|off-grid|raw-weights]
```

Useful flags:

| Flag | Effect |
|---|---|
| `--tls` | Serves https. Exported Stake builds force `https://` on the RGS nodes, so use it for real builds. The harness's own calls stay on a plain-http twin, so nothing has to trust the throwaway certificate. |
| `--min-round-ms 2000` | Sets jurisdiction `minimumRoundDuration`; ending a round earlier is refused. |
| `--auto-end-round-disabled bonus` | Keeps zero-win rounds of that mode open. |
| `--bet-levels 0.1,0.5,1,5` | Sets the bet levels, in currency units. |
| `--social` | Turns on social-casino mode. |
| `--round-timeout-ms` | How long a round may run before it counts as **STUCK**. The default is 60 s. |
| `--game reference` | Uses the built-in reference game (see below). |

## The emulator's rules (what makes bonuses get stuck)

`lib/emulator.mjs` implements the following from Stake's docs, `RGS.md` and the web-sdk sources:

- **Play.** `/wallet/play` draws a book by lookup-table weight, debits `amount × cost`, and returns `round.state` = the book's events.
- **Mode names.** These are matched ignoring case: the web-sdk sends `BASE` while the maths says `base`.
- **Winning rounds.** A winning round stays **active and unpaid** until `/wallet/end-round`.
- **Losing rounds.** A losing round closes by itself, unless the mode is in `--auto-end-round-disabled`.
- **Second play.** Playing again while a round is active returns `ERR_BE`.
- **Progress saves.** `/bet/event` stores a string with the active round, and `/wallet/authenticate` returns the active round with that string. That is the resume path.
- **Replay.** `GET /bet/replay/{game}/{version}/{mode}/{event}` serves a book with no session at all.
- **Breaches.** Every contract breach is recorded: `PLAY_WHILE_ACTIVE`, `END_ROUND_NO_ACTIVE`, `END_ROUND_TOO_EARLY`, `EVENT_NO_ACTIVE`, `EVENT_NOT_INDEX`, `EVENT_BACKWARDS`, `CALL_BEFORE_AUTH`, `BAD_BET`, `UNKNOWN_MODE`.
- **Control.** `/__harness/state` returns the transcript, the breaches and the open rounds. `POST /__harness/force {"mode":"base","kind":"featureWin"}` makes the next play draw a chosen kind of book. The kinds are `loss`, `win`, `single`, `feature`, `featureWin`, `maxwin`, or a `bookId`.

## The reference game

`reference-game/index.html` is the smallest frontend that plays books correctly. It is the executable spec of what an XGENIA Stake build must do:

- authenticate;
- resume an active round from `round.event`;
- Space to bet;
- play every event, saving progress at each round start;
- wait out the minimum round duration;
- call end-round;
- in replay, make no wallet calls.

`?bug=no-end-round|end-early|no-resume|replay-wallet|spin-per-round` makes it fail the way real games fail. The tests use that to prove the harness notices each failure.

## Self-tests

```bash
npm run test:stake-harness      # node --test tools/stake-harness/test/*.test.mjs (~2 min, needs Playwright's Chromium)
```

Every defect is injected once and must turn a check red. A check that stays green on its own defect is a bug in the harness.

## Limits — what it does not judge

- **Visuals.** It cannot see whether the win counter counts up to the payout, or whether the rules page, disclaimer and social-mode wording are right. Look at the screenshots in `--out`.
- **Buying in the browser.** A buy needs game-specific clicks. Without `--buy-steps`, buy modes are only tested by the bot.
- **Moving rules.** Stake's limits are copied from math-sdk at HEAD on 2026-11-02 (`LIMITS` in `lib/validate.mjs`). The docs site still says 90–98 %, and the payout grid (0.1× vs 0.01×) is an open question on math-sdk #121. When Stake changes these, change `LIMITS`.
- **Rebalancing.** `rebalance` moves RTP by reweighting books below and above the target mean. That also changes the hit rate and the feature frequency, and `validate` reports both. It is not the math-sdk optimiser.

## The Book Connector (runtime side)

`packages/xgenia-runtime/src/nodes/std-library/data/stake-book-session.js` is what makes an XGENIA game play
Stake books. An Aggregator with `transport` = `stake` (the swap in `utils/stake/stakeConnector.ts` makes one per
Math Component) hands it every trigger the Math Component used to get:

- **a trigger with no book open** → one `/wallet/play` (bet from `betField`, mode from `modeField`/`modes`), answered with the book's first round;
- **every trigger after that** → the book's next round, locally, with `/bet/event` saved at each round of a bonus;
- **the last round** → its answer, then `/wallet/end-round` in the background after `minimumRoundDuration`. The next play waits for it;
- **reload with an active round** → that book again from its first round, at no charge, then ended;
- **replay** → `GET /bet/replay/...`, with no wallet call.

Money in a book's data is scaled from `exportBet` to the player's bet, and the win comes from `winMultiplier`.
Extra outputs: `stakeInFeature`, `stakeRoundsLeft`, `stakeRoundComplete`, `stakeBetLevels`, `stakeDefaultBet`,
`stakeCurrency`, `stakeSocial`, `stakeReplay`, `stakeResumePending`.

`test/book-session.test.mjs` plays it against the emulator and requires zero contract breaches.

**Not wired yet:** the Deploy → Stake tab does not call the swap. It needs each component's `StakeConnectorConfig` from the maths export, and that export is being reworked. Until then a Stake build still ships the Math Component itself.
