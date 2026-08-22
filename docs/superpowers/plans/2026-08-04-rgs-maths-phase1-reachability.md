# RGS Maths Phase 1 — Reachability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "push my maths nodes to the RGS and test them" reachable by a human again, with Test and Promote to Live as two separate, explicit acts.

**Architecture:** The whole `upload → activate → stress-test → approve → deploy` pipeline already exists in `MathsPanel.tsx` as `handleUploadTestDeploy`, and the RGS server actions behind it are all live. It is unreachable because `setShowTestConfigModal(true)` is never called. We extract the pipeline into a dependency-free module so it can be unit-tested, split it at the `testing` boundary per the spec, restore the human entry point, and bring back the `maths_configs` version list so a tested version can be promoted later.

**Tech Stack:** TypeScript, React 19, Vitest (suite runs from `private/xgenia-ai-app`), the XGENIA RGS `maths-deployer` edge function.

## Global Constraints

- Node is not on `PATH` by default in this environment. Prefix commands with
  `export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"`.
- The test suite runs from `private/xgenia-ai-app`, not the repo root. Run with
  `--no-file-parallelism`; the suite starves under fork parallelism.
- There is **no `tsc --noEmit` gate in `ship.mjs`**, and ~173 pre-existing type errors mean you
  cannot use a clean typecheck as a pass signal. Verify your own files are error-free by
  filtering `tsc` output to the paths you touched.
- **Do not** add a `Co-Authored-By` trailer to commits. **Do not** `git push`.
- `docs/superpowers/specs/2026-08-04-rgs-maths-flow-design.md` is the governing spec.
- **Test stops at `testing`.** The human path must never reach `action: 'deploy'`. Promotion to
  live is a separate act. This is the whole point of the phase.
- New extracted modules must import **nothing** from the editor (no `@xgenia-models/*`, no
  React) so the Vitest suite can import them by relative path.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/xgenia-editor/src/editor/src/utils/rgs/mathsPipeline.ts` | **new.** Dependency-free RGS pipeline: `runMathsTest()` and `promoteMathsToLive()`. Takes an injected `callAction` so it is unit-testable and has no editor imports. |
| `packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx` | **modify.** Restore the Test entry point; delegate the pipeline to the module; add the Maths Versions list and Promote action. Already 2,290 lines — moving the pipeline out is a size win, not just a testability one. |
| `private/xgenia-ai-app/tests/maths-pipeline.test.ts` | **new.** Unit tests for the extracted pipeline, including the "never deploys" guard. |
| `private/xgenia-ai-app/tests/maths-sheet-mount.test.ts` | **modify.** Add the reachability guard (an entry point must exist for the test modal). |
| `packages/xgenia-runtime/src/nodelibraryexport.js` | **modify (Task 4).** Stop injecting the `isMath` port onto native nodes. |
| `packages/xgenia-editor/src/editor/src/models/nodegraphmodel/NodeGraphNode.ts` | **modify (Task 4).** Stop injecting `isMath` onto logic component instances. |
| `packages/xgenia-editor/src/editor/src/utils/compile/index.ts` | **modify (Task 4).** Stop extracting page logic; compile only duplicates for the Vercel build. |
| `private/xgenia-pro-nodes/src/slot-games/PixiReelController.js` | **modify (Task 4).** Drop the now-unnecessary `isMath` opt-out. |
| `private/xgenia-ai-app/tests/ismath-removed.test.ts` | **new (Task 4).** Guards that the tickbox is gone *and* extraction is off — the two must never diverge. |

**Not in scope for this phase:** the coverage report (Phase 2), RNG source (Phase 3), sandbox
gates (Phase 4). Do not build them here.

### The AI half is already done — do not rebuild it

The spec's Phase 1 line says "expose both as AI tools". On inspection that requirement is
already met, so **no new AI tools are needed**. In
`private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/tools/maths-rgs/maths-rgs-deployer.ts`:

| Verb | Existing AI tool |
|---|---|
| Test | `rgs_auto_test` — `create game (optional) → upload → stress test → deploy (optional)`, and **`auto_deploy` already defaults to `false`**, so it stops at the same boundary this phase gives the human path. |
| Promote | `rgs_deploy` — takes a `maths_config_id` that has passed stress testing. |
| Supporting | `connect_rgs`, `rgs_create_game`, `rgs_upload_maths`, `rgs_stress_test`, `rgs_rollback`, `rgs_get_versions`, `rgs_get_results`, `rgs_download`. |

The asymmetry this phase closes is that the **AI could already do all of it and a human could
not** — and worse, that the one human handler ran straight through to `deploy` while the AI's
default stopped short. Task 2 makes the human path match the AI's, rather than the reverse.

Note these AI tools call the RGS **directly** (`callRgs`), not through `mathsPipeline.ts`. That
is fine and should be left alone: the module exists to make the editor's boundary testable, not
to become a second transport. Do not refactor the AI tools onto it in this phase.

---

### Task 1: Reachability guard + restore the human entry point

**Files:**
- Modify: `private/xgenia-ai-app/tests/maths-sheet-mount.test.ts`
- Modify: `packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx`

**Interfaces:**
- Consumes: existing `showTestConfigModal` / `setShowTestConfigModal` state and
  `handleUploadTestDeploy`, both already in `MathsPanel.tsx`.
- Produces: a reachable Test modal. No new exports.

- [ ] **Step 1: Write the failing test**

Append this block inside the existing `describe(...)` in
`private/xgenia-ai-app/tests/maths-sheet-mount.test.ts`:

```ts
  // ── 4. The pipeline must be reachable by a human ─────────────────────────
  // 4565e24 removed the only caller of setShowTestConfigModal(true), leaving
  // handleUploadTestDeploy and its whole upload → stress-test pipeline in the
  // file as dead code: the modal that holds the button could not be opened.
  // A feature nothing can invoke is indistinguishable from a deleted one.
  it('the Test config modal has at least one entry point', () => {
    const src = stripComments(readFileSync(MATHS_PANEL, 'utf8'));

    const openers = src.match(/setShowTestConfigModal\(\s*true\s*\)/g) || [];
    expect(
      openers.length,
      'Nothing calls setShowTestConfigModal(true), so the upload/stress-test ' +
        'pipeline is unreachable dead code. Restore the Test entry point.'
    ).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-sheet-mount.test.ts --no-file-parallelism
```

Expected: FAIL — `Nothing calls setShowTestConfigModal(true)…`, `expected +0 to be greater than +0`.

- [ ] **Step 3: Add the Test entry point**

In `MathsPanel.tsx`, immediately **after** the closing `)}` of the `{connected && selectedGame && (`
Server Versions block and **before** the closing `</VStack>`, insert:

```tsx
                        {/* The two verbs. Test compiles the open maths component and runs
                            upload → activate → stress-test, stopping at `testing`; Promote
                            to Live (Task 3) is a separate, deliberate act. Restores the
                            entry point removed in 4565e24, which left the whole pipeline
                            in the file with nothing able to call it. */}
                        {connected && selectedGame && (
                            <Box hasBottomSpacing>
                                <Tooltip content="Compile the open maths component, upload it and run a stress test. Stops before live.">
                                    <PrimaryButton
                                        icon={IconName.Play}
                                        label={uploading ? (pipelineStep || 'Working…') : 'Test'}
                                        size={PrimaryButtonSize.Small}
                                        variant={PrimaryButtonVariant.MutedOnLowBg}
                                        onClick={() => setShowTestConfigModal(true)}
                                        isDisabled={uploading}
                                        isGrowing
                                    />
                                </Tooltip>
                            </Box>
                        )}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-sheet-mount.test.ts --no-file-parallelism
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm no new type errors in the file you touched**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd packages/xgenia-editor
../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep "MathsPanel.tsx" || echo "clean"
```

Expected: `clean`. If `PrimaryButtonSize` / `PrimaryButtonVariant` / `IconName.Play` are
reported as missing, add them to the existing imports at the top of `MathsPanel.tsx` — the file
already imports `PrimaryButton`, `PrimaryButtonSize`, `PrimaryButtonVariant`, `IconName` and
`Tooltip`, so this should not occur.

- [ ] **Step 6: Commit**

```bash
git add private/xgenia-ai-app/tests/maths-sheet-mount.test.ts \
        packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx
git commit -m "Restore the Test entry point in the Maths RGS panel

The upload/stress-test pipeline has been unreachable since 4565e24 removed the
only caller of setShowTestConfigModal(true). Guard test added so a feature that
nothing can invoke fails CI instead of looking present."
```

---

### Task 2: Extract the pipeline and split it at `testing`

`handleUploadTestDeploy` currently runs all five steps through to `action: 'deploy'`, so
restoring the button as-is would push straight to live — exactly what the spec forbids. The AI
side already has the right semantics (`rgs_auto_test` has `auto_deploy` defaulting to false);
this brings the human path in line.

**Files:**
- Create: `packages/xgenia-editor/src/editor/src/utils/rgs/mathsPipeline.ts`
- Create: `private/xgenia-ai-app/tests/maths-pipeline.test.ts`
- Modify: `packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type RgsAction = (payload: Record<string, any>) => Promise<any>;
  export interface MathsTestParams {
    callAction: RgsAction;
    gameId: string;
    script: string;
    configData: any;
    declaredRtp: string;
    numSpins: number;
    onStep?: (label: string) => void;
  }
  export interface MathsTestResult {
    ok: boolean;
    error?: string;
    mathsConfigId?: string;
    version?: number;
    stress?: any;
  }
  export function runMathsTest(p: MathsTestParams): Promise<MathsTestResult>;
  export function promoteMathsToLive(
    callAction: RgsAction, mathsConfigId: string, onStep?: (l: string) => void
  ): Promise<{ ok: boolean; error?: string }>;
  ```
- Consumes: nothing. The module imports nothing at all — that is what lets the Vitest suite
  import it by relative path.

- [ ] **Step 1: Write the failing test**

Create `private/xgenia-ai-app/tests/maths-pipeline.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  runMathsTest,
  promoteMathsToLive,
} from '../../../packages/xgenia-editor/src/editor/src/utils/rgs/mathsPipeline';

function recorder(responses: Record<string, any>) {
  const calls: string[] = [];
  const callAction = async (payload: Record<string, any>) => {
    calls.push(payload.action);
    return responses[payload.action] ?? {};
  };
  return { calls, callAction };
}

const OK = {
  upload: { maths_config_id: 'cfg_1', version: 7 },
  activate: {},
  'stress-test': { tests: { rtp_compliance: { measured_rtp: 96.02 } } },
  approve: {},
  deploy: {},
};

describe('maths pipeline', () => {
  it('runMathsTest stops at testing and never deploys', async () => {
    const { calls, callAction } = recorder(OK);
    const res = await runMathsTest({
      callAction, gameId: 'g1', script: 'return { win: 0 };',
      configData: {}, declaredRtp: '96.00', numSpins: 10000,
    });

    expect(res.ok).toBe(true);
    expect(res.mathsConfigId).toBe('cfg_1');
    expect(res.version).toBe(7);
    expect(calls).toEqual(['upload', 'activate', 'stress-test']);
    expect(calls).not.toContain('approve');
    expect(calls).not.toContain('deploy');
  });

  it('runMathsTest reports which step failed and stops there', async () => {
    const { calls, callAction } = recorder({
      ...OK,
      activate: { error: 'not in draft' },
    });
    const res = await runMathsTest({
      callAction, gameId: 'g1', script: 'x', configData: {},
      declaredRtp: '96.00', numSpins: 1000,
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('Activate');
    expect(res.error).toContain('not in draft');
    expect(calls).toEqual(['upload', 'activate']);
  });

  it('promoteMathsToLive approves then deploys', async () => {
    const { calls, callAction } = recorder(OK);
    const res = await promoteMathsToLive(callAction, 'cfg_1');

    expect(res.ok).toBe(true);
    expect(calls).toEqual(['approve', 'deploy']);
  });

  it('promoteMathsToLive does not deploy when approve fails', async () => {
    const { calls, callAction } = recorder({ ...OK, approve: { error: 'not tested' } });
    const res = await promoteMathsToLive(callAction, 'cfg_1');

    expect(res.ok).toBe(false);
    expect(res.error).toContain('not tested');
    expect(calls).toEqual(['approve']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-pipeline.test.ts --no-file-parallelism
```

Expected: FAIL — cannot resolve `mathsPipeline`.

- [ ] **Step 3: Write the module**

Create `packages/xgenia-editor/src/editor/src/utils/rgs/mathsPipeline.ts`:

```ts
/**
 * The RGS maths lifecycle, split at the `testing` boundary.
 *
 * Extracted from MathsPanel.handleUploadTestDeploy, which ran all five steps
 * straight through to `deploy` — so the one human button pushed maths live with
 * no stop. The AI path already stopped by default (rgs_auto_test's auto_deploy
 * is false); this brings the two into line and makes the boundary testable.
 *
 * Imports nothing on purpose: no editor models, no React, no fetch. The caller
 * injects `callAction`, so this runs under Vitest without the editor.
 */

export type RgsAction = (payload: Record<string, any>) => Promise<any>;

export interface MathsTestParams {
  callAction: RgsAction;
  gameId: string;
  script: string;
  configData: any;
  declaredRtp: string;
  numSpins: number;
  onStep?: (label: string) => void;
}

export interface MathsTestResult {
  ok: boolean;
  error?: string;
  mathsConfigId?: string;
  version?: number;
  stress?: any;
}

/** An RGS action reports failure as a truthy `error` on a 200 body. */
function failure(step: string, data: any): string | null {
  if (data && data.error) return `${step} failed: ${data.error}`;
  return null;
}

/**
 * upload → activate → stress-test, then STOP.
 *
 * Deliberately does not call `approve` or `deploy`. Promotion is
 * promoteMathsToLive, invoked by a separate user action.
 */
export async function runMathsTest(p: MathsTestParams): Promise<MathsTestResult> {
  const { callAction, onStep } = p;

  onStep?.('Uploading maths…');
  const uploaded = await callAction({
    action: 'upload',
    game_id: p.gameId,
    maths_mode: 'script',
    script: p.script,
    config_data: p.configData,
    declared_rtp: p.declaredRtp,
  });
  const uploadErr = failure('Upload', uploaded);
  if (uploadErr) return { ok: false, error: uploadErr };

  const mathsConfigId = uploaded.maths_config_id;
  const version = uploaded.version;
  if (!mathsConfigId) {
    return { ok: false, error: 'Upload returned no maths_config_id — nothing to test.' };
  }

  onStep?.('Activating for testing…');
  const activated = await callAction({ action: 'activate', maths_config_id: mathsConfigId });
  const activateErr = failure('Activate', activated);
  if (activateErr) return { ok: false, error: activateErr, mathsConfigId, version };

  onStep?.(`Running stress test (${Math.round(p.numSpins / 1000)}k spins)…`);
  const stress = await callAction({
    action: 'stress-test',
    maths_config_id: mathsConfigId,
    num_spins: p.numSpins,
  });
  const stressErr = failure('Stress test', stress);
  if (stressErr) return { ok: false, error: stressErr, mathsConfigId, version };

  return { ok: true, mathsConfigId, version, stress };
}

/** approve → deploy. Only meaningful for a config that has passed a stress test. */
export async function promoteMathsToLive(
  callAction: RgsAction,
  mathsConfigId: string,
  onStep?: (label: string) => void
): Promise<{ ok: boolean; error?: string }> {
  onStep?.('Approving…');
  const approved = await callAction({ action: 'approve', maths_config_id: mathsConfigId });
  const approveErr = failure('Approve', approved);
  if (approveErr) return { ok: false, error: approveErr };

  onStep?.('Deploying to live…');
  const deployed = await callAction({ action: 'deploy', maths_config_id: mathsConfigId });
  const deployErr = failure('Deploy', deployed);
  if (deployErr) return { ok: false, error: deployErr };

  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-pipeline.test.ts --no-file-parallelism
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Point MathsPanel at the module**

In `MathsPanel.tsx`, add to the imports near the other `@xgenia-utils/rgs` import:

```ts
import { runMathsTest, promoteMathsToLive } from '@xgenia-utils/rgs/mathsPipeline';
```

Then in `handleUploadTestDeploy`, replace everything from the comment
`// 2. Sequential pipeline: upload → activate → stress-test → approve → deploy`
down to and including the `setUploadStatus({ type: 'success', … })` call, with:

```tsx
            const callAction = async (payload: any) => {
                const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                    method: 'POST',
                    headers: rgsHeaders(settings.apiKey),
                    body: JSON.stringify(payload),
                });
                return r.json();
            };

            const testRun = await runMathsTest({
                callAction,
                gameId: selectedGame,
                script: result.script,
                configData: result.configData,
                declaredRtp: game?.default_rtp || '96.00',
                numSpins: simCount,
                onStep: setPipelineStep,
            });

            if (!testRun.ok) {
                setUploadStatus({ type: 'error', message: testRun.error || 'Test failed' });
                setUploading(false);
                setPipelineStep(null);
                return;
            }

            // Keep the tested config so "Promote to Live" has something to act on.
            setTestedConfigId(testRun.mathsConfigId || null);

            const rtpComp = testRun.stress?.tests?.rtp_compliance || {};
            const rtpStr = rtpComp.measured_rtp ? `${rtpComp.measured_rtp.toFixed(2)}%` : '';
            const hitStr = rtpComp.hit_rate != null ? `${(rtpComp.hit_rate * 100).toFixed(1)}%` : '';
            const maxStr = (rtpComp.max_win || rtpComp.max_multiplier) != null
                ? `${rtpComp.max_win || rtpComp.max_multiplier}×` : '';
            const deployedName = String(result.componentName || '').replace('/#__maths__/', '') || 'maths';
            setUploadStatus({
                type: 'success',
                message: `${deployedName} → v${testRun.version} tested (not live). RTP ${rtpStr} · Hit ${hitStr} · Max ${maxStr}`,
            });
```

Add the new state near the other version state (around the `versionActionId` declarations):

```tsx
    // The maths config most recently put through a Test run. "Promote to Live"
    // acts on this; Task 3's version list supplies it after a reload.
    const [testedConfigId, setTestedConfigId] = useState<string | null>(null);
```

- [ ] **Step 6: Verify the human path can no longer reach deploy**

Add to `private/xgenia-ai-app/tests/maths-pipeline.test.ts`:

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';

it('MathsPanel does not call the deploy action outside promoteMathsToLive', () => {
  const src = readFileSync(
    resolve(process.cwd(), '../../packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx'),
    'utf8'
  );
  const deployCalls = src.match(/action:\s*['"`]deploy['"`]/g) || [];
  expect(
    deployCalls,
    'MathsPanel calls action:"deploy" directly. Promotion must go through ' +
      'promoteMathsToLive so Test can never push to live.'
  ).toEqual([]);
});
```

- [ ] **Step 7: Run the full guard set**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-pipeline.test.ts tests/maths-sheet-mount.test.ts --no-file-parallelism
```

Expected: PASS, 10 tests total.

- [ ] **Step 8: Confirm no new type errors**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd packages/xgenia-editor
../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep -E "MathsPanel.tsx|mathsPipeline.ts" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/utils/rgs/mathsPipeline.ts \
        packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx \
        private/xgenia-ai-app/tests/maths-pipeline.test.ts
git commit -m "Split the maths pipeline at the testing boundary

Test now runs upload -> activate -> stress-test and stops; promotion to live is
a separate call. Extracted to a dependency-free module so the boundary is unit
tested rather than asserted. Matches the AI path, whose auto_deploy already
defaulted to false."
```

---

### Task 3: Maths Versions list and Promote to Live

`action: 'versions'` returns maths configs with status and stress results and is still live
server-side — `rgs_get_versions` uses it. The panel stopped calling it in `57ba2a6`, which is
why there is nothing to promote after a reload.

**Files:**
- Modify: `packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx`
- Modify: `private/xgenia-ai-app/tests/maths-pipeline.test.ts`

**Interfaces:**
- Consumes: `promoteMathsToLive` from Task 2; `testedConfigId` state from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `private/xgenia-ai-app/tests/maths-pipeline.test.ts`:

```ts
it('MathsPanel lists maths configs so a tested version can be promoted later', () => {
  const src = readFileSync(
    resolve(process.cwd(), '../../packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx'),
    'utf8'
  );
  expect(
    /action:\s*['"`]versions['"`]/.test(src),
    'MathsPanel never calls action:"versions", so maths configs and their ' +
      'stress results are invisible and nothing can be promoted after a reload.'
  ).toBe(true);
  expect(
    /promoteMathsToLive\s*\(/.test(src),
    'Nothing calls promoteMathsToLive — there is no way to take a tested ' +
      'version live from the panel.'
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-pipeline.test.ts --no-file-parallelism
```

Expected: FAIL — `MathsPanel never calls action:"versions"…`.

- [ ] **Step 3: Fetch maths configs**

In `MathsPanel.tsx`, add state beside `versions`:

```tsx
    // Maths configs (action:'versions') — the approval lifecycle: draft →
    // testing → approved → live, each carrying its stress results. Distinct
    // from `versions`, which lists deployed edge functions.
    const [mathsConfigs, setMathsConfigs] = useState<any[] | null>(null);
```

and this loader beside `fetchVersions`:

```tsx
    const fetchMathsConfigs = useCallback(async () => {
        if (!settings?.apiKey || !selectedGame) { setMathsConfigs(null); return; }
        try {
            const res = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify({ action: 'versions', game_id: selectedGame }),
            });
            const data = await res.json();
            setMathsConfigs(data.versions || data.maths_configs || []);
        } catch { setMathsConfigs([]); }
    }, [settings, selectedGame]);

    useEffect(() => { fetchMathsConfigs(); }, [selectedGame, fetchMathsConfigs]);
```

- [ ] **Step 4: Add the promote handler**

Add beside the other handlers:

```tsx
    const handlePromote = useCallback(async (mathsConfigId: string) => {
        if (!settings?.apiKey || !mathsConfigId) return;
        setPromotingId(mathsConfigId);
        const callAction = async (payload: any) => {
            const r = await fetch(`${XRGS_URL}/maths-deployer`, {
                method: 'POST',
                headers: rgsHeaders(settings.apiKey),
                body: JSON.stringify(payload),
            });
            return r.json();
        };
        const res = await promoteMathsToLive(callAction, mathsConfigId, setPipelineStep);
        setUploadStatus(
            res.ok
                ? { type: 'success', message: 'Promoted to live.' }
                : { type: 'error', message: res.error || 'Promote failed' }
        );
        setPromotingId(null);
        setPipelineStep(null);
        fetchMathsConfigs();
        fetchVersions();
    }, [settings, fetchMathsConfigs, fetchVersions]);
```

with its state, beside `testedConfigId`:

```tsx
    const [promotingId, setPromotingId] = useState<string | null>(null);
```

- [ ] **Step 5: Render the list**

Insert immediately after the Test button block from Task 1:

```tsx
                        {/* Maths Versions — the approval lifecycle. A version must pass a
                            Test run before it can be promoted; the server enforces this too
                            (approve rejects an untested config), so this is the UI half. */}
                        {connected && selectedGame && mathsConfigs && mathsConfigs.length > 0 && (
                            <Box hasBottomSpacing>
                                <div style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', color: '#a0a0b0', marginBottom: '8px' }}>
                                    Maths Versions
                                </div>
                                {mathsConfigs.map((c: any) => {
                                    const rtp = c.stress_results?.tests?.rtp_compliance?.measured_rtp;
                                    const canPromote = c.status === 'testing' || c.status === 'approved';
                                    return (
                                        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '4px', marginBottom: '4px', backgroundColor: 'rgba(255,255,255,0.03)' }}>
                                            <span style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace', color: '#e0e0e0', minWidth: '24px' }}>v{c.version}</span>
                                            <span style={{ fontSize: '10px', color: c.status === 'live' ? '#67DE92' : '#a0a0b0' }}>{c.status}</span>
                                            <span style={{ flex: 1 }} />
                                            {/* Measured, never declared: an unknown RTP says so rather
                                                than showing a number the server has not confirmed. */}
                                            <span style={{ fontSize: '10px', color: '#a0a0b0', fontFamily: 'monospace' }}>
                                                {rtp != null ? `${rtp.toFixed(2)}%` : 'RTP unknown'}
                                            </span>
                                            {promotingId === c.id ? (
                                                <span style={{ fontSize: '10px', color: '#666' }}>Working&#8230;</span>
                                            ) : canPromote ? (
                                                <button
                                                    title="Approve this version and deploy it live"
                                                    onClick={() => handlePromote(c.id)}
                                                    style={VERSION_BTN_STYLE}
                                                >Promote to Live</button>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </Box>
                        )}
```

- [ ] **Step 6: Refresh the list after a test run**

In `handleUploadTestDeploy`, immediately after `setTestedConfigId(testRun.mathsConfigId || null);` add:

```tsx
            fetchMathsConfigs();
```

- [ ] **Step 7: Run the full guard set**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/maths-pipeline.test.ts tests/maths-sheet-mount.test.ts --no-file-parallelism
```

Expected: PASS, 11 tests total.

- [ ] **Step 8: Confirm no new type errors**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd packages/xgenia-editor
../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep -E "MathsPanel.tsx|mathsPipeline.ts" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 9: Commit**

```bash
git add packages/xgenia-editor/src/editor/src/views/panels/MathsPanel/MathsPanel.tsx \
        private/xgenia-ai-app/tests/maths-pipeline.test.ts
git commit -m "Restore the maths version lifecycle and Promote to Live

action:'versions' was still live server-side; the panel stopped calling it in
57ba2a6, so tested configs and their RTP were invisible and nothing could be
promoted after a reload. RTP shown is the measured one, or 'unknown'."
```

---

### Task 4: Remove the `isMath` tickbox — the maths sheet is the only backend surface

**Decision (owner, 2026-08-04):** deployment is decided by **location**, not by a per-node flag.
`/#__maths__/` compiles to the RGS; nothing else leaves the frontend. Publish stops
auto-extracting logic from visual pages.

**Why this is safe — read before touching anything.** `isMath` never governed the maths→RGS
path; that has always worked by location. It governed `compileProject()` ripping logic out of
**visual pages** into `/#__cloud__/` edge functions. Exactly one node type opts out —
`PixiReelController` declares `isMath: { default: false }`
(`private/xgenia-pro-nodes/src/slot-games/PixiReelController.js:121`) because it drives the
WebGL scene and *"can NEVER run inside a backend edge function"*. `typeIsMathDefault()` returns
**true** for any type that declares nothing, so **deleting the flag while leaving extraction on
would flip the reel renderer to extract and rip it into an edge function.** Turning extraction
off is what makes removing the flag safe; do these together, in this task, not separately.

Publish already tolerates zero extracted components — `XgeniaDeployTab.tsx:1588` skips the
setup card because *"a UI-only project compiles to no logic components at all"*. So this lands
on a path that already exists.

`flattenLogic.ts` and `aggregatorNode.ts` are left on disk, unused. Deleting them is a separate
decision the owner explicitly deferred; leaving them keeps this reversible.

**Files:**
- Modify: `packages/xgenia-runtime/src/nodelibraryexport.js:452-495`
- Modify: `packages/xgenia-editor/src/editor/src/models/nodegraphmodel/NodeGraphNode.ts:557-584`
- Modify: `packages/xgenia-editor/src/editor/src/utils/compile/index.ts`
- Modify: `private/xgenia-pro-nodes/src/slot-games/PixiReelController.js:113-130`
- Create: `private/xgenia-ai-app/tests/ismath-removed.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-3. This task is independent and may be done first.
- Produces: `compileProject()` keeps its signature; `componentsCreated` is now always `0` and
  `origins` always `[]`.

- [ ] **Step 1: Write the failing test**

Create `private/xgenia-ai-app/tests/ismath-removed.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// The `isMath` per-node tickbox is gone: deployment is decided by LOCATION.
// /#__maths__/ compiles to the RGS; nothing else leaves the frontend.
//
// These must change together. isMath's only real job was keeping
// PixiReelController client-side (it declares default:false because it drives
// the WebGL scene). typeIsMathDefault() returns TRUE for anything that declares
// nothing, so removing the flag while extraction still runs would rip the reel
// renderer into an edge function. Extraction off is what makes removal safe.

const R = (p: string) => readFileSync(resolve(process.cwd(), '../..', p), 'utf8');

const NODE_LIB   = 'packages/xgenia-runtime/src/nodelibraryexport.js';
const NODE_GRAPH = 'packages/xgenia-editor/src/editor/src/models/nodegraphmodel/NodeGraphNode.ts';
const COMPILE    = 'packages/xgenia-editor/src/editor/src/utils/compile/index.ts';
const REEL       = 'private/xgenia-pro-nodes/src/slot-games/PixiReelController.js';

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('isMath tickbox removed; location decides deployment', () => {
  it('no isMath port is injected onto native nodes', () => {
    expect(/name:\s*['"`]isMath['"`]/.test(stripComments(R(NODE_LIB)))).toBe(false);
  });

  it('no isMath port is injected onto logic component instances', () => {
    expect(/name:\s*['"`]isMath['"`]/.test(stripComments(R(NODE_GRAPH)))).toBe(false);
  });

  it('PixiReelController no longer needs an isMath opt-out', () => {
    expect(/isMath\s*:/.test(stripComments(R(REEL)))).toBe(false);
  });

  it('compileProject does not extract logic from visual pages', () => {
    const src = stripComments(R(COMPILE));
    expect(
      /buildCloudComponent\s*\(/.test(src),
      'compileProject still extracts logic into cloud components. With isMath gone ' +
        'every non-visual node defaults to extract, including PixiReelController.'
    ).toBe(false);
    expect(/insertAggregatorNode\s*\(/.test(src)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/ismath-removed.test.ts --no-file-parallelism
```

Expected: FAIL, 4 failing.

- [ ] **Step 3: Stop extracting in `compileProject`**

In `packages/xgenia-editor/src/editor/src/utils/compile/index.ts`, replace the whole
`for (const comp of visualComponents) { … }` loop with:

```ts
  // 2026-08-04: extraction is OFF. Deployment is decided by LOCATION — a
  // `/#__maths__/` component compiles to the RGS via generateRgsScript(), and
  // nothing else leaves the frontend. Compile now only duplicates the project so
  // the Vercel build has a stable source tree.
  //
  // This replaced the per-node `isMath` tickbox, which asked every user to make a
  // deployment decision per node and defaulted to "extract". The two had to go
  // together: typeIsMathDefault() returns true for any type that declares
  // nothing, so removing the flag while this loop still ran would have extracted
  // PixiReelController — a WebGL renderer that cannot run in an edge function.
  //
  // flattenLogic.ts / aggregatorNode.ts are intentionally left on disk, unused;
  // removing them is a separate decision.
  const componentCounter = 0;
  const visited = 0;
  const origins: CompiledComponentOrigin[] = [];
```

Delete the now-unused `visualComponents` binding above it, and the `collectLogicRoots` /
`isVisualComponent` names from the `./util` import if TypeScript reports them unused.

- [ ] **Step 4: Remove the native-node injection**

In `packages/xgenia-runtime/src/nodelibraryexport.js`, delete the entire block from
`// --- isMath: per-instance deployment-routing toggle (Compile feature) ---` through the
closing `}` of the `nodeObj.ports.push({ name: 'isMath', … })` `if` statement (lines ~452-495),
and replace it with:

```js
    // `isMath` (the per-node "deploy me to the backend" tickbox) was removed
    // 2026-08-04. Deployment is decided by LOCATION: a `/#__maths__/` component
    // compiles to the RGS, everything else stays on the frontend.
    if (usesBackendServices(nodeMetadata)) {
      nodeObj.usesBackendServices = true;
    }
```

Keep `usesBackendServices` and `ISMATH_BACKEND_SERVICE_CATEGORIES` — `usesBackendServices` is
still re-emitted and read elsewhere. `ISMATH_NON_LOGIC_CATEGORIES` becomes unused; leave it,
it is referenced by the comment block above it and removing it is noise.

- [ ] **Step 5: Remove the component-instance injection**

In `packages/xgenia-editor/src/editor/src/models/nodegraphmodel/NodeGraphNode.ts`, delete the
whole `if (this.type instanceof ComponentModel && !this.type.allowAsChild && …) { ports = ports.concat([...]) }`
block (lines ~557-584) and replace with:

```ts
      // The `isMath` deployment toggle was removed 2026-08-04. Deployment is
      // decided by LOCATION: a `/#__maths__/` component compiles to the RGS,
      // everything else stays on the frontend. Nothing is injected here now.
```

- [ ] **Step 6: Remove the reel controller's opt-out**

In `private/xgenia-pro-nodes/src/slot-games/PixiReelController.js`, delete the `isMath: { … }`
entry from `inputs` (including its `// --- Deployment ---` comment block, lines ~113-130). It
existed only to opt out of an extraction that no longer happens.

- [ ] **Step 7: Run the test to verify it passes**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run tests/ismath-removed.test.ts --no-file-parallelism
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Run the whole suite — this task touches shared node export code**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd private/xgenia-ai-app
npx vitest run --no-file-parallelism 2>&1 | tail -20
```

Expected: no NEW failures. Record the pre-change baseline first if you have not already —
this suite has known flakes under load, so compare failure *names*, not counts.

- [ ] **Step 9: Confirm no new type errors**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
cd packages/xgenia-editor
../../node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1 | grep -E "NodeGraphNode.ts|compile/index.ts|compile/util.ts" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 10: Commit**

```bash
git add packages/xgenia-runtime/src/nodelibraryexport.js \
        packages/xgenia-editor/src/editor/src/models/nodegraphmodel/NodeGraphNode.ts \
        packages/xgenia-editor/src/editor/src/utils/compile/index.ts \
        private/xgenia-pro-nodes/src/slot-games/PixiReelController.js \
        private/xgenia-ai-app/tests/ismath-removed.test.ts
git commit -m "Remove the isMath tickbox; location decides deployment

/#__maths__/ compiles to the RGS, everything else stays on the frontend. The
tickbox asked for a per-node deployment decision and defaulted to extract, which
is how a WebGL reel renderer needed an opt-out to stay in the browser. Extraction
is now off, so the opt-out is unnecessary rather than load-bearing."
```

**Extra manual check for this task:** open a slot project and confirm the reel renderer still
runs in preview, and that no node's Properties panel shows a "Deployment / Is Math" group.

---

## Manual verification

The guard tests are source-level; they prove the wiring exists, not that it works against a
real server. After Task 3, verify by hand:

1. Rebuild the editor and restart Electron (the restored panel needs a rebuild).
2. Open Maths RGS, connect with an operator key, select a game.
3. Confirm **Maths Components** lists your `/#__maths__/` components.
4. Open one, click **Test**, set a spin count, confirm.
5. Expect a success message reading `<name> → vN tested (not live)` with a measured RTP.
6. Confirm the game is **not** live — the version shows `testing`, not `live`.
7. Click **Promote to Live**, confirm the status becomes `live` and a new entry appears under
   Deployed Functions.

Step 6 is the one that matters. If the game goes live from Test alone, Task 2 did not land.

## Out of scope — do not build here

Coverage report and the drop/stub gate (Phase 2), RNG source and the custom-provider contract
(Phase 3), sandbox gates and the provenance stamp (Phase 4). All are specified in
`docs/superpowers/specs/2026-08-04-rgs-maths-flow-design.md`.
