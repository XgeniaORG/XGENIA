/**
 * (2026-09-17, export 1789661242337) The editor's NodeLibraryImporter drops a client's node types
 * when that client's socket closes. The runtime re-sent its library on 'connected' only when the
 * JSON differed from the last one it sent — so a preview whose socket closed (1006) and
 * reconnected sent NOTHING, and the editor kept only the cloud runtime's types: no Group, Text,
 * Timer or pixi.* until the editor was restarted. Every reconnection must send the library.
 */
const xgeniaRuntime = require('../xgenia-runtime');

function runtimeWithFakeConnection() {
  const runtime = new xgeniaRuntime({
    type: 'browser',
    dontCreateRootComponent: true,
    platform: { requestUpdate: () => {}, getCurrentTime: () => Date.now() },
  });
  const sent = [];
  runtime.editorConnection.sendNodeLibrary = (lib) => sent.push(lib);
  // The library content is irrelevant here — only whether a (re)connect sends it.
  runtime.getNodeLibrary = () => '{"nodetypes":[{"name":"Group"}]}';
  return { runtime, sent };
}

describe('node library on (re)connect', () => {
  test('first connection sends the library', () => {
    const { runtime, sent } = runtimeWithFakeConnection();
    runtime.editorConnection.emit('connected');
    expect(sent).toHaveLength(1);
  });

  test('a reconnection sends it again even though it is unchanged', () => {
    const { runtime, sent } = runtimeWithFakeConnection();
    runtime.editorConnection.emit('connected');
    runtime.editorConnection.emit('connected');
    expect(sent).toHaveLength(2);
  });

  test('within one connection an unchanged library is still not re-sent', () => {
    const { runtime, sent } = runtimeWithFakeConnection();
    runtime.editorConnection.emit('connected');
    runtime.sendNodeLibrary();
    runtime.sendNodeLibrary();
    expect(sent).toHaveLength(1);
  });
});
