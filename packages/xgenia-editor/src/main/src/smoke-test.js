// Launch smoke test (2026-10-06). With XGENIA_SMOKE_TEST=1, CI starts the packaged app
// (.github/workflows/nightly-builds.yml) and this decides whether the build is fit to publish:
//   pass (exit 0): the editor window loaded, React rendered into #root, and the renderer was still
//                  alive and rendered SETTLE_MS later;
//   fail (exit 1): the renderer died, the page failed to load, or nothing rendered by TIMEOUT_MS.
// A main process that crashes or hangs never reaches either, and CI's own timeout fails it.
//
// Writes to stderr: the production main bundle drops console.* (webpack.main.production.js).
'use strict';

const POLL_MS = 2000;

function watchSmokeTest(app, win, { timeoutMs = 120000, settleMs = 10000 } = {}) {
  const say = (msg) => process.stderr.write(`[smoke-test] ${msg}\n`);
  const rendererErrors = [];
  let done = false;

  function finish(code, reason) {
    if (done) return;
    done = true;
    say(`${code === 0 ? 'PASS' : 'FAIL'}: ${reason}`);
    if (rendererErrors.length) say(`renderer errors seen:\n  ${rendererErrors.slice(0, 20).join('\n  ')}`);
    app.exit(code);
  }

  const deadline = setTimeout(() => finish(1, `the editor did not render within ${timeoutMs / 1000}s`), timeoutMs);

  win.webContents.on('render-process-gone', (_event, details) => finish(1, `renderer gone: ${details.reason} (exit ${details.exitCode})`));
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    // -3 is ERR_ABORTED: a navigation replaced by another, not a failure.
    if (isMainFrame && code !== -3) finish(1, `failed to load ${url}: ${code} ${description}`);
  });
  win.webContents.on('console-message', (_event, level, message, line, source) => {
    if (level >= 3) rendererErrors.push(`${message} (${source}:${line})`);
  });

  const rendered = () =>
    win.isDestroyed()
      ? Promise.resolve(false)
      : win.webContents
          .executeJavaScript("(() => { const r = document.getElementById('root'); return !!r && r.childElementCount > 0; })()")
          .catch(() => false);

  async function poll() {
    if (done) return;
    if (await rendered()) {
      say(`editor rendered; checking it is still alive in ${settleMs / 1000}s`);
      setTimeout(async () => {
        if (await rendered()) {
          clearTimeout(deadline);
          finish(0, 'editor window loaded and rendered');
        } else {
          finish(1, 'the editor rendered, then went blank');
        }
      }, settleMs);
      return;
    }
    setTimeout(poll, POLL_MS);
  }
  win.webContents.once('did-finish-load', poll);
  say('watching the editor window');
}

module.exports = { watchSmokeTest };
