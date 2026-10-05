// (2026-10-05, Spin Cycle) One scaffold call built six screens and six reel grids: every hot update of
// EditorBridge.ts made a new class with fresh statics, so the one-bridge guard and the duplicate-id guard
// never saw the bridges before it — six module evaluations, six live listeners, each command run six times.
// This bundles the real EditorBridge.ts (editor imports stubbed), evaluates it six times in one window, as
// HMR does, and sends ONE command.
//   node --test packages/xgenia-editor/tests/bridge/one-bridge-per-window.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const req = createRequire(path.join(root, 'package.json'));
const { build } = req('esbuild');
const { JSDOM } = req('jsdom');
const BRIDGE = path.resolve(here, '../../src/editor/src/views/panels/ChatPanelBridge/EditorBridge.ts');

const stubImports = {
  name: 'stub-imports',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => (a.kind === 'entry-point' ? null : { path: a.path, namespace: 'stub', pluginData: { importer: a.importer } }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => {
      const src = readFileSync(a.pluginData.importer, 'utf8');
      const names = new Set();
      const esc = a.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`import\\s+(?:type\\s+)?(?:[\\w$]+\\s*,\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${esc}['"]`, 'g');
      for (const m of src.matchAll(re)) {
        for (const part of m[1].split(',')) {
          const n = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (n && /^[\w$]+$/.test(n)) names.add(n);
        }
      }
      const P = 'new Proxy(function(){}, { get: (t, k) => (k === "then" ? undefined : k === Symbol.toPrimitive ? () => "" : __P), apply: () => __P, construct: () => __P })';
      return { contents: `const __P = ${P}; export default __P; ${[...names].map((n) => `export const ${n} = __P;`).join(' ')}`, loader: 'js' };
    });
  },
};

test('six evaluations of EditorBridge (six hot updates) still run one command once', async () => {
  const out = await build({ entryPoints: [BRIDGE], bundle: true, write: false, format: 'iife', globalName: 'EB', platform: 'browser', plugins: [stubImports], logLevel: 'silent' });
  const code = out.outputFiles[0].text;
  const w = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' }).window;
  w.console.warn = w.console.log = w.console.error = w.console.debug = () => {};
  for (let i = 0; i < 6; i++) w.eval(code);
  const frame = w.document.createElement('iframe');
  w.document.body.appendChild(frame);
  const replies = [];
  frame.contentWindow.postMessage = (m) => replies.push(m);
  w.dispatchEvent(new w.MessageEvent('message', { data: { type: 'command', id: 'cmd_1_x', command: 'project.getId', args: [] }, source: frame.contentWindow }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(replies.filter((m) => m && m.id === 'cmd_1_x').length, 1);
});
