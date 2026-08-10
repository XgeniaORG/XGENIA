/**
 * crash-telemetry.js — persist renderer-crash forensics.
 *
 * WHY THIS EXISTS (debug-export 1783408275898, 2026-07-07): the editor
 * renderer crashed ("Oh No! XGENIA has crashed" dialog) mid-AI-build and the
 * incident left ZERO forensic artifacts anywhere:
 *   - the render-process-gone handler discarded details.reason/exitCode,
 *   - console.log is globally no-op'd in the main process, so even the
 *     handler's one log line printed nothing,
 *   - crashReporter was never started, so Crashpad collected no minidumps
 *     (verified: %APPDATA%/XGENIA has no Crashpad/reports),
 *   - the post-restart debug export therefore contained no crash evidence,
 *     and the crash cause was unrecoverable.
 *
 * This module gives the NEXT crash investigation something to read:
 *   1. start() boots Electron's crashReporter in LOCAL-ONLY mode (no upload)
 *      so Crashpad writes minidumps to app.getPath('crashDumps');
 *   2. record() appends one JSON line per process-gone event to
 *      <userData>/crash-log.jsonl (timestamp, which window, reason, exitCode,
 *      versions) — cheap, append-only, greppable from a support bundle;
 *   3. isFatal() centralizes which reasons mean "the renderer died
 *      unexpectedly" vs intentional teardown, so recovery handlers stop
 *      matching only the literal 'crashed' and silently ignoring 'oom',
 *      'abnormal-exit', 'launch-failed' and 'integrity-failure'.
 */
const { app, crashReporter } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CRASH_LOG_FILENAME = 'crash-log.jsonl';

// Same project the rest of the app already talks to (see supabaseInit.ts) —
// hardcoded rather than read from process.env because the main-process
// bundle gets no build-time env injection (that's a renderer-only webpack
// DefinePlugin step) and no .env file ships with the packaged app.
const SUPABASE_URL = 'https://pcrghrjikkcmelflwiys.supabase.co';
const CRASH_REPORT_ENDPOINT = `${SUPABASE_URL}/functions/v1/crash-report`;
// Not a secret — it ships inside the app. Only stops drive-by scanners that
// find the public function URL from filling the table with junk. Must match
// the TELEMETRY_INGEST_KEY secret set on the crash-report edge function.
const TELEMETRY_INGEST_KEY = '30c04e9fca790f46855dadf9932f10a5c63d3bc907f99450';

// Reasons that are NOT crashes: 'clean-exit' fires on normal renderer
// teardown (navigation, window close); 'killed' means something external
// (app quit, task manager) terminated the process on purpose.
const NON_FATAL_REASONS = ['clean-exit', 'killed'];

function isFatal(reason) {
  return NON_FATAL_REASONS.indexOf(reason) === -1;
}

/**
 * Start local-only minidump collection. Must run before other processes
 * spawn (call it at main.js module load, before any window is created).
 * No submitURL / no upload — dumps stay on the user's machine.
 */
function start() {
  try {
    crashReporter.start({
      submitURL: '',
      uploadToServer: false,
      compress: true
    });
  } catch (e) {
    console.error('[CrashTelemetry] crashReporter.start failed:', e && e.message);
  }
}

/**
 * Fire the crash record at the crash-report edge function. Best-effort and
 * fully async — the caller does not (and must not) await this, since it runs
 * on the same path as the crash dialog and a slow/offline network must not
 * delay or block that. Never throws.
 */
function upload(entry) {
  try {
    const payload = {
      ...entry,
      platform: process.platform,
      osRelease: os.release()
    };
    fetch(CRASH_REPORT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-telemetry-key': TELEMETRY_INGEST_KEY
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    }).catch((e) => {
      console.error('[CrashTelemetry] Failed to upload crash record:', e && e.message);
    });
  } catch (e) {
    console.error('[CrashTelemetry] Failed to start crash record upload:', e && e.message);
  }
}

/**
 * Persist one process-gone event. `source` names the webContents that died
 * (e.g. 'editor-window', 'floating-window'); `details` is Electron's
 * render-process-gone details ({ reason, exitCode }).
 * Never throws — this runs on the crash path where nothing else may fail.
 */
function record(source, details) {
  const entry = {
    timestamp: new Date().toISOString(),
    source: source,
    reason: details && details.reason,
    exitCode: details && details.exitCode,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome
  };

  // console.error survives the global console.log no-op in main.js.
  console.error('[CrashTelemetry] Renderer process gone:', JSON.stringify(entry));

  // Skip clean exits so the local log and the remote table both stay
  // signal-only (normal window closes would otherwise flood them).
  // Unexpected 'killed' events ARE recorded, to both.
  if (entry.reason === 'clean-exit') return entry;

  try {
    const logPath = path.join(app.getPath('userData'), CRASH_LOG_FILENAME);
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[CrashTelemetry] Failed to persist crash record:', e && e.message);
  }

  upload(entry);

  return entry;
}

module.exports = { start, record, isFatal, CRASH_LOG_FILENAME };
