// (2026-09-23, export 1790196874427) Script Inputs/Outputs list entries are `{ id, label }`; an
// entry written as `{ name }` produced a port literally named "undefined" and an
// `outtype-undefined` type picker.
global.XGENIA = global.XGENIA || { deployed: false };

const Javascript2 = require('../src/nodes/std-library/javascript.js');

function dynamicPortsFor(parameters) {
  const sent = [];
  const context = {
    editorConnection: {
      isRunningLocally: () => true,
      clearWarning: () => {},
      sendWarning: () => {},
      sendDynamicPorts: (id, ports) => sent.push(ports)
    }
  };
  const node = {
    id: 'js-1',
    component: { name: '/App' },
    parameters,
    on: () => {}
  };
  const handlers = {};
  const graphModel = {
    on: (event, cb) => {
      handlers[event] = cb;
    },
    getNodesWithType: () => [node]
  };
  Javascript2.setup(context, graphModel);
  handlers.editorImportComplete();
  return sent[sent.length - 1];
}

test('list entries are named by label, then name, then id; nameless entries are skipped', () => {
  const ports = dynamicPortsFor({
    scriptOutputs: [{ id: 'o1', label: 'Total' }, { name: 'Done' }, {}, { label: '' }],
    scriptInputs: [{ id: 'i1', name: 'Speed' }, { id: 'Bet' }]
  });
  const names = ports.map((p) => p.name);

  expect(names).toEqual(expect.arrayContaining(['Total', 'outtype-Total', 'Done', 'outtype-Done']));
  expect(names).toEqual(expect.arrayContaining(['Speed', 'intype-Speed', 'Bet', 'intype-Bet']));
  expect(names.some((n) => /undefined/.test(n))).toBe(false);
  expect(names.filter((n) => n === '' || n === 'outtype-')).toEqual([]);
});
