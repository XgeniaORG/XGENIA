const JavascriptNodeParser = require('../src/javascriptnodeparser');

// (2026-09-23, export 1790196874427) A Script node that initialised its outputs with values
// (`Script.Outputs.Total = 0`, `Script.Outputs.Done = false`) got ports whose type NAME was the
// value — `0`, `false` — and every wire from them was flagged "source port of type 0 cannot be
// connected to a target port with type number".

function portsFor(code) {
  const parser = JavascriptNodeParser.createFromCode(code);
  expect(parser.error).toBeUndefined();
  return parser.getPorts();
}

function port(ports, name, plug) {
  return ports.find((p) => p.name === name && p.plug === plug);
}

describe('JavascriptNodeParser port types', () => {
  test('literal output initialisers name their type, never the value', () => {
    const ports = portsFor(`
      Script.Outputs.Total = 0;
      Script.Outputs.Done = false;
      Script.Outputs.Label = undefined;
      Script.Outputs.Items = [];
      Script.Outputs.State = {};
      Script.Outputs.Nothing = null;
      Script.Outputs.Fn = function () {};
    `);

    expect(port(ports, 'Total', 'output').type).toEqual({ name: 'number' });
    expect(port(ports, 'Done', 'output').type).toEqual({ name: 'boolean' });
    expect(port(ports, 'Label', 'output').type).toEqual({ name: '*' });
    expect(port(ports, 'Items', 'output').type).toEqual({ name: 'array' });
    expect(port(ports, 'State', 'output').type).toEqual({ name: 'object' });
    expect(port(ports, 'Nothing', 'output').type).toEqual({ name: '*' });
    expect(port(ports, 'Fn', 'output').type).toEqual({ name: '*' });

    for (const p of ports) {
      if (p.type && typeof p.type === 'object') expect(typeof p.type.name).toBe('string');
    }
  });

  test('a string is still a declared type name', () => {
    const ports = portsFor(`
      Script.Inputs = { Count: 'number' };
      Script.Outputs = { Result: 'string', Fired: 'signal' };
    `);
    expect(port(ports, 'Count', 'input').type).toEqual({ name: 'number' });
    expect(port(ports, 'Result', 'output').type).toEqual({ name: 'string' });
    expect(port(ports, 'Fired', 'output').type).toEqual({ name: 'signal' });
  });

  test('literal input initialisers get a type too', () => {
    const ports = portsFor(`
      Script.Inputs.Speed = 5;
      Script.Inputs.Enabled = true;
    `);
    expect(port(ports, 'Speed', 'input').type).toEqual({ name: 'number' });
    expect(port(ports, 'Speed', 'input').group).toBe('Inputs');
    expect(port(ports, 'Enabled', 'input').type).toEqual({ name: 'boolean' });
  });

  test('port descriptor objects keep their properties', () => {
    const ports = portsFor(`
      define({
        inputs: { Size: { type: 'number', displayName: 'Size', default: 3 } },
        outputs: { Area: { type: 'number', displayName: 'Area' }, Legacy: 'boolean' }
      });
    `);
    const size = port(ports, 'Size', 'input');
    expect(size.type).toBe('number');
    expect(size.default).toBe(3);
    const area = port(ports, 'Area', 'output');
    expect(area.type).toBe('number');
    expect(area.displayName).toBe('Area');
    expect(area.group).toBe('Outputs');
    expect(port(ports, 'Legacy', 'output').type).toEqual({ name: 'boolean' });
  });

  test('signals stay signal inputs', () => {
    const ports = portsFor(`
      Script.Signals.Go = function () {};
    `);
    expect(port(ports, 'Go', 'input').type).toEqual({ name: 'signal' });
  });
});
