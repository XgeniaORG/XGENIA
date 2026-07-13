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
const path = require('path');

const CRASH_LOG_FILENAME = 'crash-log.jsonl';

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

  try {
    // Skip clean exits so the log stays signal-only (normal window closes
    // would otherwise flood it). Unexpected 'killed' events ARE recorded.
    if (entry.reason === 'clean-exit') return entry;
    const logPath = path.join(app.getPath('userData'), CRASH_LOG_FILENAME);
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch (e) {
    console.error('[CrashTelemetry] Failed to persist crash record:', e && e.message);
  }
  return entry;
}

module.exports = { start, record, isFatal, CRASH_LOG_FILENAME };
