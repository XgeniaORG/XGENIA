// Launch smoke test (2026-10-06): what makes CI pass or fail a packaged build.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const { watchSmokeTest } = require('../../src/main/src/smoke-test');

function fakeWindow() {
  const webContents = Object.assign(new EventEmitter(), {
    rendered: false,
    executeJavaScript() {
      return Promise.resolve(this.rendered);
    }
  });
  return { webContents, isDestroyed: () => false };
}

async function run(script) {
  mock.timers.enable({ apis: ['setTimeout'] });
  const stderr = mock.method(process.stderr, 'write', () => true);
  const exits = [];
  const win = fakeWindow();
  try {
    watchSmokeTest({ exit: (code) => exits.push(code) }, win, { timeoutMs: 60000, settleMs: 5000 });
    await script(win, async (ms) => {
      mock.timers.tick(ms);
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
    });
  } finally {
    stderr.mock.restore();
    mock.timers.reset();
  }
  return exits;
}

test('passes once the editor has rendered and is still rendered after settling', async () => {
  const exits = await run(async (win, tick) => {
    win.webContents.rendered = true;
    win.webContents.emit('did-finish-load');
    await tick(0);
    await tick(5000);
  });
  assert.deepEqual(exits, [0]);
});

test('fails when nothing renders before the timeout', async () => {
  const exits = await run(async (win, tick) => {
    win.webContents.emit('did-finish-load');
    for (let t = 0; t < 60000; t += 2000) await tick(2000);
  });
  assert.deepEqual(exits, [1]);
});

test('fails when the renderer dies or the page fails to load', async () => {
  assert.deepEqual(
    await run(async (win) => win.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })),
    [1]
  );
  assert.deepEqual(
    await run(async (win) => win.webContents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///index.html', true)),
    [1]
  );
  // A navigation replaced by another (ERR_ABORTED) is not a failure.
  assert.deepEqual(await run(async (win) => win.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'x', true)), []);
});

test('fails when the editor renders and then goes blank', async () => {
  const exits = await run(async (win, tick) => {
    win.webContents.rendered = true;
    win.webContents.emit('did-finish-load');
    await tick(0);
    win.webContents.rendered = false;
    await tick(5000);
  });
  assert.deepEqual(exits, [1]);
});
