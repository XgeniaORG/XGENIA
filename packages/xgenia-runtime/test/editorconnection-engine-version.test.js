// Live engine (2026-10-03): the preview tells the editor which engine build it runs, so the main
// process can end a new engine's trial and support can see what a user runs.
const EditorConnection = require('../src/editorconnection');

function connection() {
  const ec = new EditorConnection({ runtimeType: 'browser', platform: { getCurrentTime: () => 0 } });
  const sent = [];
  ec.send = (msg) => sent.push(msg);
  return { ec, sent };
}

describe('node library carries the engine version', () => {
  afterEach(() => {
    delete globalThis.__XGENIA_ENGINE_VERSION__;
  });

  test('unstamped builds say unknown', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{}');
    expect(sent[0].cmd).toBe('nodelibrary');
    expect(sent[0].engineVersion).toBe('unknown');
  });

  test('a stamped build sends its version', () => {
    globalThis.__XGENIA_ENGINE_VERSION__ = '20261003.1200-aaaaaaaa-bbbbbbbb';
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{}');
    expect(sent[0].engineVersion).toBe('20261003.1200-aaaaaaaa-bbbbbbbb');
  });
});
