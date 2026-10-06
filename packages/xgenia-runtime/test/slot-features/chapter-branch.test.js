// Chapter Branch (slot feature 20, stateful): registry port mirror, Do / advance / reset parity
// with the shared core across string, object and array `next` shapes (state threaded as the
// server does), startKey, and the fail-closed error contract (exercised by making the core throw).
'use strict';

const { defineFeature, mount } = require('./harness');
const cores = require('@xgenia/runtime/src/api/slot-feature-cores');

const ChapterBranch = defineFeature('chapter-branch.js');

const REGISTRY_INPUTS = ['chapters', 'choice', 'startKey', 'advance', 'reset'];
const REGISTRY_OUTPUTS = ['chapter', 'currentKey', 'nextKeys', 'isEnd', 'changed', 'chapterIndex'];

const CHAPTERS = {
  intro: { next: 'forest', bg: 'village', paytableScale: 1 },
  forest: { next: { left: 'cave', right: 'river' }, bg: 'trees' },
  cave: { next: ['river'], bg: 'dark', paytableScale: 2 },
  river: { bg: 'water', paytableScale: 3 }
};

function coreArgs(params, flags) {
  return Object.assign({}, params, { advance: false, reset: false }, flags || {});
}

function expectParity(h, r) {
  for (const name of REGISTRY_OUTPUTS) expect(h.out(name)).toEqual(r[name]);
}

describe('Chapter Branch', () => {
  let errorSpy;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
    jest.restoreAllMocks();
  });

  test('module shape and metadata mirror the registry', () => {
    const mod = require('../../../../private/xgenia-pro-nodes/src/slot-games/features/chapter-branch.js');
    expect(Object.keys(mod)).toEqual(['node']);
    expect(mod.node.name).toBe('Chapter Branch');
    expect(mod.node.category).toBe('Math');
    expect(mod.node.color).toBe('math');
    expect(mod.node.docs).toBe('https://docsapp.xgenia.com/nodes/slot-features/chapter-branch');
    expect(typeof mod.node.description).toBe('string');
    expect(mod.node.description).toMatch(/identified players/);
    const inputs = Object.keys(ChapterBranch.metadata.inputs).filter((n) => n !== 'functionScript');
    expect(inputs.sort()).toEqual(REGISTRY_INPUTS.concat(['Do']).sort());
    expect(Object.keys(ChapterBranch.metadata.outputs).sort()).toEqual(REGISTRY_OUTPUTS.concat(['Done']).sort());
    for (const sig of ['Do', 'advance', 'reset']) expect(ChapterBranch.metadata.inputs[sig].type.name).toBe('signal');
    expect(ChapterBranch.metadata.inputs.chapters.type).toBe('object');
    expect(ChapterBranch.metadata.inputs.choice.type).toBe('string');
    expect(ChapterBranch.metadata.outputs.Done.type).toBe('signal');
    expect(ChapterBranch.metadata.outputs.chapter.type).toBe('object');
    expect(ChapterBranch.metadata.outputs.isEnd.type).toBe('boolean');
  });

  test('Do, advance through string / object / array paths, a dead choice, and reset equal the core', async () => {
    const params = { chapters: CHAPTERS, choice: '', startKey: '' };
    const h = await mount(ChapterBranch, params);
    let state = {};

    h.fire('Do');
    let r = cores.chapterBranch(state, coreArgs(params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('intro');
    expect(h.out('nextKeys')).toEqual(['forest']);
    expect(h.out('chapter')).toEqual(CHAPTERS.intro);
    expect(h.out('chapterIndex')).toBe(0);
    expect(h.out('isEnd')).toBe(false);

    h.fire('advance'); // string next: no choice needed
    r = cores.chapterBranch(state, coreArgs(params, { advance: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('forest');
    expect(h.out('nextKeys')).toEqual(['cave', 'river']);
    expect(h.out('changed')).toBe(true);

    h.set('choice', 'left'); // object next: by key
    h.fire('advance');
    r = cores.chapterBranch(state, coreArgs(Object.assign({}, params, { choice: 'left' }), { advance: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('cave');
    expect(h.out('chapter').paytableScale).toBe(2);

    h.set('choice', 'nowhere'); // array of one: any choice resolves to the single entry
    h.fire('advance');
    r = cores.chapterBranch(state, coreArgs(Object.assign({}, params, { choice: 'nowhere' }), { advance: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('river');
    expect(h.out('isEnd')).toBe(true);
    expect(h.out('nextKeys')).toEqual([]);

    h.fire('advance'); // at an end: stays put
    r = cores.chapterBranch(state, coreArgs(Object.assign({}, params, { choice: 'nowhere' }), { advance: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('changed')).toBe(false);
    expect(h.out('currentKey')).toBe('river');

    h.fire('reset');
    r = cores.chapterBranch(state, coreArgs(Object.assign({}, params, { choice: 'nowhere' }), { reset: true }));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('intro');
    expect(h.count('Done')).toBe(6);
    expect(h.node._internal.state).toEqual(state);
  });

  test('startKey selects the opening chapter; a choice set in the same update as advance is followed', async () => {
    const params = { chapters: CHAPTERS, choice: '', startKey: 'forest' };
    const h = await mount(ChapterBranch, params);
    let state = {};
    h.fire('Do');
    let r = cores.chapterBranch(state, coreArgs(params));
    state = r.updatedState;
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('forest');
    expect(h.out('chapterIndex')).toBe(1);

    h.node.queueInput('choice', 'right');
    h.node.queueInput('advance', true);
    h.node.queueInput('advance', false);
    h.ctx.update();
    r = cores.chapterBranch(state, coreArgs(Object.assign({}, params, { choice: 'right' }), { advance: true }));
    expectParity(h, r);
    expect(h.out('currentKey')).toBe('river');
  });

  test('fails closed when the core throws: error logged + in inspect data, outputs empty, state untouched, Done fires', async () => {
    const h = await mount(ChapterBranch, { chapters: CHAPTERS });
    h.fire('Do');
    const stateBefore = h.node._internal.state;
    jest.spyOn(cores, 'chapterBranch').mockImplementation(() => {
      throw new Error('boom');
    });
    h.fire('advance');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toBe('[Chapter Branch] boom');
    expect(h.node.getInspectInfo().value.error).toBe('boom');
    expect(h.out('chapter')).toEqual({});
    expect(h.out('currentKey')).toBe('');
    expect(h.out('nextKeys')).toEqual([]);
    expect(h.out('isEnd')).toBe(false);
    expect(h.out('changed')).toBe(false);
    expect(h.out('chapterIndex')).toBe(0);
    expect(h.node._internal.state).toBe(stateBefore);
    expect(h.count('Done')).toBe(2);
  });
});
