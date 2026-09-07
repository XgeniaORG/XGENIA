import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  salvageJsonObject,
  createSerializedWriter,
  atomicWriteText
} from '../../src/editor/src/views/panels/AssetPanel/assetMetaStore';

// The exact shape a torn write leaves: an older, shorter snapshot's bytes over a newer, longer
// one, so the newer snapshot's tail survives past the closing brace (NeonReelsSlot, 2026-09-07).
function tornFile() {
  const older = JSON.stringify({ 'assets/a.png': { uid: 'aaaaaaaaaa' }, 'assets/b.png': { role: 'ui' } }, null, 2);
  const newer = JSON.stringify(
    {
      'assets/a.png': { uid: 'aaaaaaaaaa' },
      'assets/b.png': { role: 'ui', uid: 'bbbbbbbbbb' },
      'assets/c.png': { role: 'ui', uid: 'cccccccccc' }
    },
    null,
    2
  );
  assert.ok(newer.length > older.length);
  return { older, torn: older + newer.slice(older.length) };
}

test('salvage: a valid object is ok', () => {
  const r = salvageJsonObject('{"assets/a.png":{"uid":"x"}}');
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.value, { 'assets/a.png': { uid: 'x' } });
});

test('salvage: empty or whitespace is empty, not an error', () => {
  assert.equal(salvageJsonObject('').status, 'empty');
  assert.equal(salvageJsonObject('  \n').status, 'empty');
});

test('salvage: a torn file yields the older snapshot and the seam position', () => {
  const { older, torn } = tornFile();
  assert.throws(() => JSON.parse(torn));
  const r = salvageJsonObject(torn);
  assert.equal(r.status, 'salvaged');
  assert.deepEqual(r.value, JSON.parse(older));
  assert.equal(r.validPrefixChars, older.length);
  assert.match(r.error || '', /JSON/);
});

test('salvage: a file cut mid-string has no valid prefix', () => {
  const r = salvageJsonObject('{"assets/a.png": {"ai": {"prompt": "trunc');
  assert.equal(r.status, 'unrecoverable');
  assert.deepEqual(r.value, {});
});

test('salvage: valid JSON that is not an object is unrecoverable', () => {
  for (const body of ['[1,2]', '"s"', '42', 'null']) {
    assert.equal(salvageJsonObject(body).status, 'unrecoverable', body);
  }
});

test('writer: bursts coalesce, writes never overlap, the last snapshot wins', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const written: string[] = [];
  const gates: Array<() => void> = [];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const writer = createSerializedWriter<string>(async (text) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise<void>((r) => { gates.push(r); });
    written.push(text);
    inFlight -= 1;
  });
  const promises: Promise<void>[] = [];
  for (let i = 1; i <= 17; i++) promises.push(writer.schedule(`snapshot-${i}`));
  await tick();
  assert.equal(gates.length, 1, 'only the first write is in flight during the burst');
  gates[0]();
  await tick();
  assert.equal(gates.length, 2, 'the burst coalesced into exactly one follow-up write');
  gates[1]();
  await Promise.all(promises);
  await writer.idle();
  assert.equal(maxInFlight, 1);
  assert.deepEqual(written, ['snapshot-1', 'snapshot-17']);
});

test('writer: a failing write does not wedge the queue', async () => {
  const written: string[] = [];
  const errors: unknown[] = [];
  let fail = true;
  const writer = createSerializedWriter<string>(async (text) => {
    if (fail) throw new Error('disk full');
    written.push(text);
  }, (e) => errors.push(e));
  await writer.schedule('one');
  fail = false;
  await writer.schedule('two');
  assert.equal(errors.length, 1);
  assert.deepEqual(written, ['two']);
});

test('writer: a write that throws synchronously still releases the queue', async () => {
  const written: string[] = [];
  let first = true;
  const writer = createSerializedWriter<string>((text) => {
    if (first) { first = false; throw new Error('sync throw'); }
    written.push(text);
    return Promise.resolve();
  }, () => {});
  await writer.schedule('a');
  await writer.schedule('b');
  assert.deepEqual(written, ['b']);
});

test('atomicWriteText: writes a temp file then renames it over the target', async () => {
  const ops: string[] = [];
  const fs = {
    writeFile: async (p: string, t: string) => { ops.push(`write ${p} ${t}`); },
    renameFile: async (a: string, b: string) => { ops.push(`rename ${a} -> ${b}`); },
    removeFile: async (p: string) => { ops.push(`remove ${p}`); }
  };
  await atomicWriteText(fs, '/proj/.xgenia-assets.json', '{}');
  assert.equal(ops.length, 2);
  assert.match(ops[0], /^write \/proj\/\.xgenia-assets\.json\.tmp-\S+ \{\}$/);
  assert.match(ops[1], /^rename \/proj\/\.xgenia-assets\.json\.tmp-\S+ -> \/proj\/\.xgenia-assets\.json$/);
});

test('atomicWriteText: a failed temp write is cleaned up and rethrown; the target is never touched', async () => {
  const ops: string[] = [];
  const fs = {
    writeFile: async () => { throw new Error('ENOSPC'); },
    renameFile: async (a: string, b: string) => { ops.push(`rename ${a} -> ${b}`); },
    removeFile: async (p: string) => { ops.push(`remove ${p}`); }
  };
  await assert.rejects(() => atomicWriteText(fs, '/proj/.xgenia-assets.json', '{}'), /ENOSPC/);
  assert.equal(ops.length, 1);
  assert.match(ops[0], /^remove \/proj\/\.xgenia-assets\.json\.tmp-/);
});
