// Variant Selector (slot feature 9): registry port parity, client == core for a hit, a fallback, the
// first-variant default and a miss.
'use strict';

const fs = require('fs');
const path = require('path');
const { defineFeature, mount } = require('./harness');
const cores = require('../../src/api/slot-feature-cores');

const FILE = 'variant-selector.js';
const NAME = 'Variant Selector';
const Def = defineFeature(FILE);
const OUTPUTS = ['variant', 'selectedKey', 'found', 'keys', 'reelStrips', 'symbolWeights', 'paytable', 'paytableScale', 'rtp'];

const DEFAULTS = { variants: {}, key: '', fallbackKey: '' };

function registryPorts(nodeName) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/api/slot-feature-node-converter.ts'), 'utf8');
  const start = src.indexOf("'" + nodeName + "',");
  if (start < 0) throw new Error('registry has no entry for ' + nodeName);
  const list = (key) => {
    const m = src.slice(start).match(new RegExp('\\b' + key + ':\\s*(\\[[^\\]]*\\])'));
    if (!m) throw new Error('registry entry for ' + nodeName + ' has no ' + key);
    return JSON.parse(m[1].replace(/'/g, '"'));
  };
  return { inputs: list('inputs'), outputs: list('outputs') };
}

const VARIANTS = {
  eu94: { reelStrips: [[1, 2, 3], [3, 2, 1]], symbolWeights: [5, 3, 1], paytable: { 1: { 3: 10 } }, paytableScale: 0.94, rtp: 94 },
  uk96: { reelStrips: [[1, 1, 2], [2, 3, 3]], symbolWeights: [4, 4, 2], paytable: { 1: { 3: 12 } }, paytableScale: 1, rtp: 96.2 },
  bare: { rtp: 90 }
};

async function evaluate(params) {
  const h = await mount(Def, params);
  h.fire('Do');
  const expected = cores.selectVariant(Object.assign({}, DEFAULTS, params));
  OUTPUTS.forEach((name) => expect(h.out(name)).toEqual(expected[name]));
  expect(h.count('Done')).toBe(1);
  return h;
}

describe('Variant Selector', () => {
  test('module shape, metadata and registry port parity', () => {
    const mod = require(path.resolve(__dirname, '../../../../private/xgenia-pro-nodes/src/slot-games/features', FILE));
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe(NAME);
    expect(mod.node.category).toBe('Math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/variant-selector');
    expect(typeof mod.node.description).toBe('string');

    const spec = registryPorts(NAME);
    const inputs = Object.keys(Def.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(spec.inputs.concat(['Do']).sort());
    expect(Object.keys(Def.metadata.outputs).sort()).toEqual(spec.outputs.concat(['Done']).sort());
    expect(Def.metadata.inputs.Do.type.name).toBe('signal');
    expect(Def.metadata.outputs.Done.type).toBe('signal');
    expect(Def.metadata.outputs.found.type).toBe('boolean');
    expect(Def.metadata.outputs.variant.type).toBe('object');
    Object.keys(DEFAULTS).forEach((name) => expect(Def.metadata.inputs[name].default).toEqual(DEFAULTS[name]));
  });

  test('a matching key unpacks the variant', async () => {
    const h = await evaluate({ variants: VARIANTS, key: 'uk96' });
    expect(h.out('found')).toBe(true);
    expect(h.out('selectedKey')).toBe('uk96');
    expect(h.out('variant')).toEqual(VARIANTS.uk96);
    expect(h.out('keys')).toEqual(['eu94', 'uk96', 'bare']);
    expect(h.out('reelStrips')).toEqual(VARIANTS.uk96.reelStrips);
    expect(h.out('symbolWeights')).toEqual(VARIANTS.uk96.symbolWeights);
    expect(h.out('paytable')).toEqual(VARIANTS.uk96.paytable);
    expect(h.out('paytableScale')).toBe(1);
    expect(h.out('rtp')).toBe(96.2);
  });

  test('a missing key falls back to fallbackKey; an empty key takes the first variant', async () => {
    const h = await evaluate({ variants: VARIANTS, key: 'de95', fallbackKey: 'eu94' });
    expect(h.out('selectedKey')).toBe('eu94');
    expect(h.out('found')).toBe(true);
    expect(h.out('rtp')).toBe(94);

    const h2 = await evaluate({ variants: VARIANTS });
    expect(h2.out('selectedKey')).toBe('eu94');
    expect(h2.out('found')).toBe(true);
  });

  test('a bare variant yields the documented empties; a total miss is not found', async () => {
    const h = await evaluate({ variants: VARIANTS, key: 'bare' });
    expect(h.out('found')).toBe(true);
    expect(h.out('reelStrips')).toEqual([]);
    expect(h.out('symbolWeights')).toEqual([]);
    expect(h.out('paytable')).toEqual({});
    expect(h.out('paytableScale')).toBe(1);
    expect(h.out('rtp')).toBe(90);

    const h2 = await evaluate({ variants: VARIANTS, key: 'nope', fallbackKey: 'nope2' });
    expect(h2.out('found')).toBe(false);
    expect(h2.out('selectedKey')).toBe('');
    expect(h2.out('variant')).toEqual({});
    expect(h2.out('keys')).toEqual(['eu94', 'uk96', 'bare']);

    // changing the key re-evaluates on the same node
    h2.set('key', 'uk96');
    h2.fire('Do');
    expect(h2.out('found')).toBe(true);
    expect(h2.out('rtp')).toBe(96.2);
    expect(h2.count('Done')).toBe(2);
  });
});
