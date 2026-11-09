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
    expect(sent[0].cmd).toBe('nodelibraryOffer');
    expect(sent[0].engineVersion).toBe('unknown');
  });

  test('a stamped build sends its version', () => {
    globalThis.__XGENIA_ENGINE_VERSION__ = '20261003.1200-aaaaaaaa-bbbbbbbb';
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{}');
    expect(sent[0].engineVersion).toBe('20261003.1200-aaaaaaaa-bbbbbbbb');
  });
});

describe('node library offer', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const fullSends = (sent) => sent.filter((m) => m.cmd === 'nodelibrary');

  test('a known library is never sent in full', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{"a":1}');
    ec._settleNodeLibraryOffer(sent[0].hash, false);
    jest.advanceTimersByTime(10000);
    expect(fullSends(sent)).toHaveLength(0);
  });

  test('a needed library is sent at once, with its hash', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{"a":1}');
    ec._settleNodeLibraryOffer(sent[0].hash, true);
    expect(fullSends(sent)).toHaveLength(1);
    expect(fullSends(sent)[0].content).toBe('{"a":1}');
    expect(fullSends(sent)[0].hash).toBe(sent[0].hash);
  });

  test('an editor that never answers still gets the library', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{"a":1}');
    jest.advanceTimersByTime(EditorConnection.NODE_LIBRARY_OFFER_TIMEOUT_MS);
    expect(fullSends(sent)).toHaveLength(1);
  });

  test('an answer about an older offer is ignored', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{"a":1}');
    ec.sendNodeLibrary('{"a":2}');
    ec._settleNodeLibraryOffer(sent[0].hash, false);
    jest.advanceTimersByTime(EditorConnection.NODE_LIBRARY_OFFER_TIMEOUT_MS);
    expect(fullSends(sent).map((m) => m.content)).toEqual(['{"a":2}']);
  });

  test('different libraries hash differently', () => {
    const { ec, sent } = connection();
    ec.sendNodeLibrary('{"a":1}');
    ec.sendNodeLibrary('{"a":2}');
    expect(sent[0].hash).not.toBe(sent[1].hash);
  });
});
