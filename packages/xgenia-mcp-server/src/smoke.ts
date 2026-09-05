/**
 * Live smoke test against a running XGENIA.
 *
 * Default run is read-only and safe against a live session. --destructive adds
 * the tier that sends a prompt and restarts the editor.
 */
import { health, probe, projectStatus } from './editor-state.js';
import { chatRead, chatSend, chatWaitIdle } from './chat.js';
import { screenshot } from './screenshot.js';
import { restart } from './lifecycle.js';

const destructive = process.argv.includes('--destructive');
let failures = 0;

/**
 * Run one check, print a pass/fail line, and return the raw result so a
 * caller can inspect fields beyond the boolean `check` (e.g. restart()'s
 * `recoveryError`/`declinedPorts`, which must be surfaced even on a passing
 * `restarted: true`).
 */
async function step(
  name: string,
  fn: () => Promise<unknown>,
  check: (r: any) => boolean
): Promise<any> {
  process.stdout.write(`${name} ... `);
  try {
    const result = await fn();
    if (check(result)) {
      console.log('ok');
    } else {
      failures += 1;
      console.log('FAIL');
      console.log(JSON.stringify(result, null, 2));
    }
    return result;
  } catch (e) {
    failures += 1;
    console.log('THREW');
    console.log(String(e));
    return undefined;
  }
}

await step('health', health, (r) => r.running === true && r.pageResponsive === true);
await step('probe', probe, (r) => r.ok === true);
await step('project_status', projectStatus, (r) => typeof r.open === 'boolean');

// chatRead defaults to the TAIL (last `limit` messages, absolute `index`
// values) when `since` is omitted. A coherent read means: `total` accounts
// for `messageCount`, and every returned message's `index` is inside
// [0, total) — not just "no error came back".
await step(
  'chat_read',
  () => chatRead({ limit: 2 }),
  (r) =>
    !('error' in r) &&
    typeof r.total === 'number' &&
    r.total === r.messageCount &&
    Array.isArray(r.messages) &&
    r.messages.every((m: any) => m.index < r.total)
);

await step(
  'screenshot(chat)',
  () => screenshot({ region: 'chat' }),
  (r) => !('error' in r) && r.bytes > 0 && r.scale !== null
);

if (destructive) {
  // This live editor's chat panel is confirmed stuck showing
  // "Stop generating" (verified visible-and-enabled across a full app
  // restart), so a non-forced chatSend would always return `busy-refused`
  // here. `force` is the documented escape hatch for a mid-generation panel;
  // exercising it is the point of this tier, not a workaround to avoid.
  await step(
    'chat_send',
    () =>
      chatSend('Reply with the single word: pong', {
        force: true,
        waitIdle: true,
        timeoutMs: 120_000
      }),
    (r) => r.sent === true
  );
  await step('chat_wait_idle', () => chatWaitIdle(60_000), (r) => !('error' in r));

  // The same permanently-stuck busy state that forces chat_send also guards
  // restart() (it refuses with `busy-refused` when chat is mid-generation
  // and `force` is not set), so force it here too.
  const restartResult = await step(
    'restart',
    () => restart({ force: true }),
    (r) => r.restarted === true
  );

  // restart()'s return shape can carry `restarted: true` alongside a
  // `recoveryError` (relaunched but failed to reopen the project) or
  // non-empty `declinedPorts` (a port it chose not to free because it
  // couldn't prove the port belonged to the tree it just killed). Both must
  // be visible in the smoke output, not hidden behind a green `restarted`
  // flag.
  if (restartResult?.recoveryError) {
    console.log(`  recoveryError: ${JSON.stringify(restartResult.recoveryError)}`);
  }
  if (Array.isArray(restartResult?.declinedPorts) && restartResult.declinedPorts.length > 0) {
    console.log(`  declinedPorts: ${JSON.stringify(restartResult.declinedPorts)}`);
  }

  await step('health after restart', health, (r) => r.running === true && r.chatMounted === true);
}

console.log(failures === 0 ? '\nAll smoke checks passed.' : `\n${failures} smoke check(s) failed.`);

// `browser.close()` on a connectOverCDP connection does not let node exit on
// its own — a prior run printed every result and then hung indefinitely.
// This explicit exit is what actually terminates the process; do not remove
// it as unnecessary tidying.
process.exit(failures === 0 ? 0 : 1);
