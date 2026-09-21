import { describe, it, expect } from 'vitest';
import { describeComponent, matchPorts } from './component.js';

const producer = {
  name: '/#__maths__/GameMaths',
  graph: {
    roots: [
      {
        id: 'r',
        type: 'Group',
        children: [
          { id: 'i', type: 'Component Inputs', ports: [{ name: 'Spin' }, { name: 'Init' }] },
          {
            id: 'o',
            type: 'Component Outputs',
            ports: [{ name: 'Capital' }, { name: 'CoreGrid' }],
            // A port the editor created dynamically is just as real as a static one.
            dynamicports: [{ name: 'TotalWinnings' }]
          }
        ]
      }
    ],
    connections: [{ fromId: 'i', toId: 'o' }]
  }
};

const consumer = {
  name: '/Components/AstraforgeUI',
  graph: {
    roots: [
      {
        id: 'r2',
        type: 'Group',
        children: [
          {
            id: 'i2',
            type: 'Component Inputs',
            ports: [{ name: 'Capital' }, { name: 'CoreGrid' }, { name: 'RoundAward' }]
          },
          { id: 'o2', type: 'Component Outputs', ports: [{ name: 'Spin' }] }
        ]
      }
    ],
    connections: []
  }
};

describe('describeComponent', () => {
  it('reads both static and dynamic ports', () => {
    // Reading only `ports` would report TotalWinnings as missing when it exists — and a
    // supervisor would then "helpfully" tell the builder to add a port it already has.
    const d = describeComponent(producer);
    expect(d.outputs).toEqual(['Capital', 'CoreGrid', 'TotalWinnings']);
    expect(d.inputs).toEqual(['Init', 'Spin']);
  });

  it('classifies by location, which is what decides deployment', () => {
    expect(describeComponent(producer).kind).toBe('maths');
    expect(describeComponent(consumer).kind).toBe('visual');
  });

  it('counts nested nodes, not just roots', () => {
    expect(describeComponent(producer).nodeCount).toBe(3);
  });
});

describe('matchPorts', () => {
  it('separates what lines up from what needs a human decision', () => {
    const m = matchPorts(describeComponent(producer), describeComponent(consumer));
    expect(m.matched).toEqual(['Capital', 'CoreGrid']);
    // RoundAward has no same-named source: this is the case where guessing creates a
    // phantom wire, so it must surface rather than be quietly matched to TotalWinnings.
    expect(m.consumerUnfed).toEqual(['RoundAward']);
    expect(m.producerUnused).toEqual(['TotalWinnings']);
  });
});
