/**
 * (2026-10-04, COol: "they change before spin") A node Script is saved as a FULL copy of the
 * node's definition, and a member counted as edited whenever it differed from the CURRENT engine.
 * So an engine fix to four PixiReelColumn methods was undone in every game holding an older copy:
 * the old four were reinstalled though nobody had edited them. A member whose text is a known
 * earlier engine version is a stale copy — the current engine runs it; a real edit still runs.
 */
const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const NodeScript = require('../src/nodescript');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');
const History = require('../src/engine-history.generated.js');

// Engine v2 of a node; v1 differed in `transform` (it doubled) and in `label`.
function definitionV2() {
  return {
    name: 'History Test',
    category: 'test',
    initialize() {
      this._internal.value = 0;
    },
    inputs: {
      value: {
        type: 'number',
        displayName: 'Value',
        set(value) {
          this._internal.value = this.transform(value);
          this.flagOutputDirty('result');
        }
      }
    },
    outputs: {
      result: { type: 'number', displayName: 'Result', getter() { return this._internal.value; } }
    },
    methods: {
      transform(value) {
        return (Number(value) || 0) + 1;
      },
      label() {
        return 'v2';
      }
    }
  };
}

const V1_TRANSFORM = 'transform(value) {\n        return (Number(value) || 0) * 2;\n      }';
const V1_LABEL = "label() {\n        return 'v1';\n      }";
const canon = (src) => NodeScript.canonicalFunctionText('function ' + src);

/** The v2 default script (a full copy, as the editor saves it) with `transform` and `label` swapped. */
function scriptWith(transformSrc, labelSrc) {
  const src = NodeScript.reconstructNodeSource(definitionV2());
  const t = src.indexOf('    transform: ');
  const l = src.indexOf('    label: ');
  const end = src.indexOf('\n  },', l);
  if (t < 0 || l < 0 || end < 0) throw new Error('default script changed shape:\n' + src);
  const asMember = (s) => s.replace(/^(\w+)\(/, '$1: function (');
  const out = src.slice(0, t) + '    ' + asMember(transformSrc) + ',\n    ' + asMember(labelSrc) + ',' + src.slice(end);
  if (out === src) throw new Error('script unchanged');
  return out;
}

async function build() {
  const context = new NodeContext();
  context.nodeRegister.register(NodeDefinition.defineNode(definitionV2()));
  const componentModel = await ComponentModel.createFromExportData({
    name: 'c', id: 'c1', nodes: [{ id: 'n', type: 'History Test', parameters: {} }], connections: []
  });
  const componentInstance = new ComponentInstance(context);
  await componentInstance.setComponentModel(componentModel);
  context.update();
  const node = componentInstance.nodeScope.getNodeWithId('n');
  return {
    node,
    setScript(script) {
      componentModel.getNodeWithId('n').setParameter('functionScript', script);
      context.update();
    },
    setValue(v) {
      componentModel.getNodeWithId('n').setParameter('value', v);
      context.update();
    },
    result: () => node.getOutput('result').value
  };
}

afterEach(() => NodeScript.setEngineHistory(null));

describe('a Script that is a stale copy of an earlier engine', () => {
  test('a member equal to an earlier engine version runs the CURRENT engine', async () => {
    NodeScript.setEngineHistory({
      types: { 'History Test': { 'methods.transform': [NodeScript.memberHash(canon(V1_TRANSFORM))], 'methods.label': [NodeScript.memberHash(canon(V1_LABEL))] } }
    });
    const t = await build();
    t.setScript(scriptWith(V1_TRANSFORM, V1_LABEL));
    t.setValue(5);
    expect(t.result()).toBe(6);                       // v2's +1, not v1's ×2
    expect(t.node.label()).toBe('v2');
    expect(t.node._internal.__nodeScriptStaleCopies).toEqual(['methods.transform', 'methods.label']);
  });

  test('COUNTER: a real edit (not any engine version) still runs', async () => {
    NodeScript.setEngineHistory({ types: { 'History Test': { 'methods.transform': [NodeScript.memberHash(canon(V1_TRANSFORM))] } } });
    const t = await build();
    const edited = 'transform(value) {\n        return (Number(value) || 0) * 10;\n      }';
    t.setScript(scriptWith(edited, V1_LABEL));
    t.setValue(5);
    expect(t.result()).toBe(50);
    expect(t.node.label()).toBe('v1');               // not in this history: treated as an edit, as before
  });

  test('COUNTER: with no history the old rule stands (a difference is an edit)', async () => {
    NodeScript.setEngineHistory({ types: {} });
    const t = await build();
    t.setScript(scriptWith(V1_TRANSFORM, V1_LABEL));
    t.setValue(5);
    expect(t.result()).toBe(10);
  });

  test('shared members recorded under "*" count for every node type', async () => {
    NodeScript.setEngineHistory({ types: { '*': { 'methods.transform': [NodeScript.memberHash(canon(V1_TRANSFORM))] } } });
    const t = await build();
    t.setScript(scriptWith(V1_TRANSFORM, "label() {\n        return 'v2';\n      }"));
    t.setValue(5);
    expect(t.result()).toBe(6);
  });
});

describe('the generated history', () => {
  test('knows several versions of the reel column methods the 2026-10-04 fix changed', () => {
    const reel = History.types['pixi.ReelColumn'] || {};
    for (const k of ['methods._assignInitialSymbols', 'methods._startStop', 'methods._completeSpin', 'methods._startDropAnimation']) {
      expect((reel[k] || []).length).toBeGreaterThanOrEqual(2);
    }
    expect(Object.keys(History.types['*'] || {}).length).toBeGreaterThan(0);
  });

  test('hashes are 8 hex digits and memberHash is stable', () => {
    expect(NodeScript.memberHash('abc')).toBe('1a47e90b');
    const all = Object.values(History.types).flatMap((t) => Object.values(t).flat());
    expect(all.every((h) => /^[0-9a-f]{8}$/.test(h))).toBe(true);
  });
});

describe('the generator reads members the way a bundle holds them', () => {
  const Gen = require('../scripts/generate-engine-history.cjs');

  test('every definition of a type is kept, and ports assigned after the definition count', () => {
    const code = `
      const A = { inputs: { x: { set(v) { this.a = v; } } } };
      const B = { inputs: { x: { set(v) { this.b = v; } } } };
      ReactComponentNode.outputs.childrenCount = { get() { return this.childrenCount; } };`;
    const m = Gen.membersOf(code)['*'];
    expect(m['inputs.x.set']).toHaveLength(2);
    expect(m['outputs.childrenCount.get']).toEqual(['() { return this.childrenCount; }']);
  });

  test('webpack renames are learned from identifiers only, never from property names or other code', () => {
    expect(Gen.renamesBetween('PIXI.Assets.load(url); isObject(p)', 'lib.Assets.load(url); react_component_node_isObject(p)'))
      .toEqual({ PIXI: 'lib', isObject: 'react_component_node_isObject' });
    expect(Gen.renamesBetween('a.foo(1)', 'a.bar(1)')).toBeNull();       // a property differs: real change
    expect(Gen.renamesBetween('f(1)', 'f(2)')).toBeNull();               // a literal differs: real change
    expect(Gen.applyRenames('PIXI.Assets.x; o.PIXI; isObject(o)', { PIXI: 'lib', isObject: 'z_isObject' }))
      .toBe('lib.Assets.x; o.PIXI; z_isObject(o)');
  });

  test('console calls are kept in development (as the viewer bundle has them) and stripped in production', () => {
    const src = "export default { name: 'T', methods: { m() { console.warn('w'); return 1; } } };";
    const dev = Gen.membersOf(Gen.compile(src, 'development')).T['methods.m'][0];
    const prod = Gen.membersOf(Gen.compile(src, 'production')).T['methods.m'][0];
    expect(dev).toMatch(/console\.warn/);
    expect(prod).not.toMatch(/console/);
  });
});
