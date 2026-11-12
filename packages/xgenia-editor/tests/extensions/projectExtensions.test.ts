import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import '@xgenia/platform-node';
import {
  registerPublishHook,
  runPublishHooks,
  onProjectEvent,
  emitProjectEvent,
  isPublishExcluded,
  loadProjectExtensions,
  resetProjectExtensionsForTests
} from '../../src/editor/src/utils/extensions/projectExtensions';
import {
  copyProjectFilesToFolder,
  copyProjectFilesToFlatFolderStake
} from '../../src/editor/src/utils/compilation/build/copy';

beforeEach(() => resetProjectExtensionsForTests());

function project(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-hooks-'));
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write('index.html', '<html></html>');
  write('assets/things/a/built.json', '{}');
  write('assets/things/a/source/part.json', '{}');
  write('assets/things/a/source/deep/part.png', 'png');
  write('assets/art/raw.psd', 'psd');
  return dir;
}

test('publish hooks run with the project folder and their excludes are collected', async () => {
  const seen: string[] = [];
  registerPublishHook({
    id: 'test-a',
    async prepare(dir) {
      seen.push('a:' + dir);
      return { exclude: ['assets/**/source/**'] };
    }
  });
  registerPublishHook({
    id: 'test-b',
    async prepare(dir) {
      seen.push('b:' + dir);
      return { exclude: ['**/*.psd'] };
    }
  });
  const excludes = await runPublishHooks('/p');
  assert.deepEqual(seen, ['a:/p', 'b:/p']);
  assert.deepEqual(excludes, ['assets/**/source/**', '**/*.psd']);

  // Registering the same id again replaces the hook instead of running it twice.
  registerPublishHook({ id: 'test-b', prepare: async () => ({ exclude: ['x/**'] }) });
  assert.deepEqual(await runPublishHooks('/p'), ['assets/**/source/**', 'x/**']);
});

test('a failing publish hook stops the publish and names the hook', async () => {
  registerPublishHook({
    id: 'test-fails',
    prepare: async () => {
      throw new Error('boom');
    }
  });
  await assert.rejects(runPublishHooks('/p'), /test-fails.*boom/);
});

test('with no hooks registered there is nothing to exclude', async () => {
  assert.deepEqual(await runPublishHooks('/p'), []);
});

test('exclude globs match project-relative paths', () => {
  const ex = ['assets/**/source/**', '**/*.psd', 'notes.txt'];
  assert.equal(isPublishExcluded('assets/things/a/source/part.json', ex), true);
  assert.equal(isPublishExcluded('assets/things/a/source/deep/part.png', ex), true);
  assert.equal(isPublishExcluded('assets/things/a/built.json', ex), false);
  assert.equal(isPublishExcluded('assets/art/raw.psd', ex), true);
  assert.equal(isPublishExcluded('raw.psd', ex), true);
  assert.equal(isPublishExcluded('notes.txt', ex), true);
  assert.equal(isPublishExcluded('sub/notes.txt', ex), false);
  assert.equal(isPublishExcluded('assets\\art\\raw.psd', ex), true);
  assert.equal(isPublishExcluded('index.html', []), false);
});

test('the web copy leaves out excluded files', async () => {
  const dir = project();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-out-'));
  await copyProjectFilesToFolder(dir, out, ['assets/**/source/**', '**/*.psd']);
  assert.ok(fs.existsSync(path.join(out, 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'assets/things/a/built.json')));
  assert.ok(!fs.existsSync(path.join(out, 'assets/things/a/source/part.json')));
  assert.ok(!fs.existsSync(path.join(out, 'assets/things/a/source/deep/part.png')));
  assert.ok(!fs.existsSync(path.join(out, 'assets/art/raw.psd')));
});

test('the Stake flat copy leaves out excluded files', async () => {
  const dir = project();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-out-stake-'));
  const flatMap = await copyProjectFilesToFlatFolderStake(dir, out, ['assets/**/source/**', '**/*.psd']);
  assert.ok(flatMap['index.html']);
  assert.ok(flatMap['assets/things/a/built.json']);
  assert.equal(flatMap['assets/things/a/source/part.json'], undefined);
  assert.equal(flatMap['assets/art/raw.psd'], undefined);
  const written = fs.readdirSync(out).sort();
  assert.deepEqual(written, ['built.json', 'index.html']);
});

test('project events fan out to every listener; unsubscribe and a throwing listener do not break others', () => {
  const got: string[] = [];
  const off1 = onProjectEvent((e) => got.push('1:' + e.type + ':' + e.projectDir));
  onProjectEvent(() => {
    throw new Error('listener failure');
  });
  const off3 = onProjectEvent((e) => got.push('3:' + e.type));
  emitProjectEvent({ type: 'pulled', projectDir: '/p' });
  assert.deepEqual(got, ['1:pulled:/p', '3:pulled']);
  off1();
  emitProjectEvent({ type: 'merged', projectDir: '/p' });
  assert.deepEqual(got, ['1:pulled:/p', '3:pulled', '3:merged']);
  off3();
});

test('loadProjectExtensions hands the extension its API; a missing extension is fine', () => {
  let api: any;
  const fakeMerge = () => {};
  assert.equal(
    loadProjectExtensions({
      load: () => ({ register: (a: any) => (api = a) }),
      registerMergeHandler: fakeMerge as any
    }),
    true
  );
  assert.equal(api.registerMergeHandler, fakeMerge);
  assert.equal(typeof api.registerConflictPreview, 'function');
  assert.equal(api.registerPublishHook, registerPublishHook);
  assert.equal(api.onProjectEvent, onProjectEvent);

  assert.equal(
    loadProjectExtensions({
      load: () => {
        throw new Error('Cannot find module');
      }
    }),
    false
  );
  // The stub module: register() does nothing.
  assert.equal(
    loadProjectExtensions({
      load: () => require('../../src/stubs/project-extensions/index.js'),
      registerMergeHandler: fakeMerge as any
    }),
    true
  );
});

test('an async listener that rejects and an async register that rejects are caught', async () => {
  const warnings: unknown[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => warnings.push(a);
  const unhandled: unknown[] = [];
  const onUnhandled = (r: unknown) => unhandled.push(r);
  process.on('unhandledRejection', onUnhandled);
  try {
    const got: string[] = [];
    onProjectEvent(async () => {
      throw new Error('async listener failure');
    });
    onProjectEvent((e) => {
      got.push(e.type);
    });
    emitProjectEvent({ type: 'opened', projectDir: '/p' });
    assert.deepEqual(got, ['opened']);
    assert.equal(
      loadProjectExtensions({
        load: () => ({
          register: async () => {
            throw new Error('async register failure');
          }
        }),
        registerMergeHandler: (() => {}) as any
      }),
      true
    );
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(unhandled.length, 0);
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = origWarn;
    process.off('unhandledRejection', onUnhandled);
  }
});
