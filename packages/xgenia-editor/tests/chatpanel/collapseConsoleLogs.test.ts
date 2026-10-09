// (2026-10-09, export 1791536143029) A two-second probe of a mascot sprite's animation ticker
// came back as twenty copies of one per-frame engine log; the script's own console.debug — the
// line it waited two seconds to print — was outside the 20-line window. These pin the collapse
// that keeps the window on DISTINCT lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    collapseConsoleLogs,
    consoleOutputHeader,
} from '../../src/editor/src/views/panels/ChatPanelBridge/collapseConsoleLogs';

const spam = (n: number, message = '[PixiSpriteNode f76] Updating drop shadow filter, enabled: false') =>
    Array.from({ length: n }, () => ({ level: 'log', message }));

test('the measured case: 28 frame logs plus the probe line leave room for the probe line', () => {
    const logs = [...spam(28), { level: 'debug', message: 'DECISIVE PROBE 2 {"tAdvancing":false}' }];
    const out = collapseConsoleLogs(logs);
    assert.equal(out.length, 2);
    assert.equal(out[0].repeats, 28);
    assert.equal(out[1].message, 'DECISIVE PROBE 2 {"tAdvancing":false}');
    // and it survives a 20-line window, which is the whole point
    assert.ok(out.slice(0, 20).some((e) => e.message.startsWith('DECISIVE PROBE 2')));
});

test('a single line is unchanged and carries no count', () => {
    const out = collapseConsoleLogs([{ level: 'log', message: 'one' }]);
    assert.deepEqual(out, [{ level: 'log', message: 'one', repeats: 1 }]);
});

test('non-adjacent repeats stay separate — order is evidence', () => {
    const out = collapseConsoleLogs([
        { level: 'log', message: 'a' },
        { level: 'log', message: 'b' },
        { level: 'log', message: 'a' },
    ]);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map((e) => e.repeats), [1, 1, 1]);
});

test('the same text at a different level is a different line', () => {
    const out = collapseConsoleLogs([
        { level: 'log', message: 'x' },
        { level: 'warn', message: 'x' },
    ]);
    assert.equal(out.length, 2);
});

test('no logs, and junk entries, do not throw', () => {
    assert.deepEqual(collapseConsoleLogs([]), []);
    assert.deepEqual(collapseConsoleLogs(null), []);
    assert.deepEqual(collapseConsoleLogs(undefined), []);
    const out = collapseConsoleLogs([{ level: undefined as any, message: undefined }]);
    assert.deepEqual(out, [{ level: 'log', message: '', repeats: 1 }]);
});

test('the header counts total lines, and only mentions distinct when they differ', () => {
    assert.equal(consoleOutputHeader(29, 2, 20), 'Console output (29, 2 distinct):');
    assert.equal(consoleOutputHeader(5, 5, 20), 'Console output (5):');
    assert.equal(
        consoleOutputHeader(100, 40, 20),
        'Console output (100, 40 distinct, first 20 distinct shown):',
    );
});
