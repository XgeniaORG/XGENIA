const NodeContext = require('../src/nodecontext');
const NodeDefinition = require('../src/nodedefinition');
const ComponentInstance = require('../src/nodes/componentinstance');
const ComponentModel = require('../src/models/componentmodel');
const LanguagesDictionary = require('../src/nodes/std-library/languagesdictionary');

const { parseDictionaryValue, dictionaryToGrid, serializeDictionary } = LanguagesDictionary;

const TABLE = ['key, en, id', 'hello, Hello, Halo', 'home.title, Home, Beranda', 'onlyEnglish, English only'].join(
  '\n'
);

const ROWS = [
  { key: 'hello', en: 'Hello', id: 'Halo' },
  { key: 'home.title', en: 'Home', id: 'Beranda' }
];

const LANGUAGE_FIRST = {
  en: { greeting: 'Hello {name}', home: { title: 'Home' }, onlyEnglish: 'English only' },
  id: { greeting: 'Halo {name}', home: { title: 'Beranda' } },
  'pt-BR': { greeting: 'Ola {name}', home: { title: 'Inicio' } }
};

const KEY_FIRST = {
  greeting: { en: 'Hello {name}', id: 'Halo {name}' },
  'home.title': { en: 'Home', id: 'Beranda' },
  onlyEnglish: { en: 'English only' }
};

async function makeNode(parameters) {
  const context = new NodeContext();
  context.nodeRegister.register(NodeDefinition.defineNode(LanguagesDictionary.node));

  const componentModel = await ComponentModel.createFromExportData({
    name: 'c',
    id: 'c1',
    nodes: [{ id: 'dict', type: 'Languages Dictionary', parameters: parameters || {} }],
    connections: []
  });

  const ci = new ComponentInstance(context);
  await ci.setComponentModel(componentModel);
  context.update();

  return ci.nodeScope.getNodeWithId('dict');
}

/** The edited path: the dictionary lives in the node's own parameter. */
async function makeWithDictionary(dictionary, parameters) {
  const node = await makeNode(Object.assign({ dictionary: dictionary }, parameters || {}));
  node.translate();
  return node;
}

/** The runtime path: a dictionary arriving on the Dictionary Data port. */
async function makeWithData(data, parameters) {
  const node = await makeNode(Object.assign({ dictionary: '' }, parameters || {}));
  node.setInputValue('dictionaryData', data);
  node.translate();
  return node;
}

function out(node, name) {
  return node.getOutput(name).value;
}

describe('Languages Dictionary', () => {
  describe('the phrase table', () => {
    test('every phrase becomes an output port in the active language', async () => {
      const node = await makeWithDictionary(TABLE, { language: 'id' });

      expect(node.hasOutput('hello')).toBe(true);
      expect(node.hasOutput('home.title')).toBe(true);
      expect(out(node, 'hello')).toBe('Halo');
      expect(out(node, 'home.title')).toBe('Beranda');
      expect(out(node, 'resolvedLanguage')).toBe('id');
      expect(out(node, 'languages')).toEqual(['en', 'id']);
    });

    test('switching Language switches every port', async () => {
      const node = await makeWithDictionary(TABLE, { language: 'id' });
      expect(out(node, 'hello')).toBe('Halo');

      node.setInputValue('language', 'en');
      node.translate();
      expect(out(node, 'hello')).toBe('Hello');
    });

    test('an empty cell falls back to the fallback language', async () => {
      const node = await makeWithDictionary(TABLE, { language: 'id', fallbackLanguage: 'en' });
      expect(out(node, 'onlyEnglish')).toBe('English only');
    });

    test('tabs and pipes work as separators, and comments are ignored', async () => {
      const piped = await makeWithDictionary(['# my phrases', 'key | en | id', 'hello | Hello | Halo'].join('\n'), {
        language: 'id'
      });
      expect(piped.getOutput('hello').value).toBe('Halo');

      const tabbed = await makeWithDictionary(['key\ten\tid', 'hello\tHello\tHalo'].join('\n'), { language: 'id' });
      expect(tabbed.getOutput('hello').value).toBe('Halo');
    });

    test('a translation containing a comma survives the table format', async () => {
      const node = await makeWithDictionary(['key, en, id', 'hi, "Hello, friend", "Halo, teman"'].join('\n'), {
        language: 'id'
      });
      expect(node.getOutput('hi').value).toBe('Halo, teman');
    });

    test('the node ships with a working dictionary out of the box', async () => {
      const node = await makeNode({});
      node.translate();

      expect(node.getOutput('languages').value).toEqual(['en', 'id']);
      expect(node.getOutput('hello').value).toBe('Hello');
    });

    test('a half-written table warns instead of translating nothing silently', async () => {
      const node = await makeNode({ dictionary: '' });

      const warnings = [];
      node.context.editorConnection = {
        isConnected: () => false,
        sendWarning: (component, nodeId, key, warning) => warnings.push(warning.message),
        clearWarning: () => {}
      };

      // A table with no header row names no languages, so it cannot be read.
      node.setInputValue('dictionary', 'hello, Halo');
      node.translate();

      expect(warnings.length).toBe(1);
      expect(warnings[0]).toMatch(/header row/);
      expect(node.getOutput('languages').value).toEqual([]);
    });
  });

  describe('array dictionaries', () => {
    test('a JSON array of rows in the parameter', async () => {
      const node = await makeWithDictionary(JSON.stringify(ROWS), { language: 'id' });

      expect(out(node, 'hello')).toBe('Halo');
      expect(out(node, 'home.title')).toBe('Beranda');
      expect(out(node, 'languages')).toEqual(['en', 'id']);
    });

    test('an array arriving on the Dictionary Data port', async () => {
      const node = await makeWithData(ROWS, { language: 'id' });
      expect(out(node, 'hello')).toBe('Halo');
    });

    test('rows added to the array show up as new ports', async () => {
      const node = await makeWithData(ROWS, { language: 'id' });
      expect(node.hasOutput('bye')).toBe(false);

      node.setInputValue('dictionaryData', ROWS.concat([{ key: 'bye', en: 'Bye', id: 'Dah' }]));
      node.translate();

      expect(node.getOutput('bye').value).toBe('Dah');
    });

    test('a row array with a header row', async () => {
      const node = await makeWithData(
        [
          ['key', 'en', 'id'],
          ['hello', 'Hello', 'Halo']
        ],
        { language: 'id' }
      );

      expect(out(node, 'hello')).toBe('Halo');
    });

    test('rows may name the key column anything, as long as it comes first', async () => {
      const node = await makeWithData([{ phrase: 'hello', en: 'Hello', id: 'Halo' }], { language: 'id' });
      expect(out(node, 'hello')).toBe('Halo');
    });

    test('an unusable array warns rather than translating nothing silently', async () => {
      const node = await makeNode({ dictionary: '' });

      const warnings = [];
      node.context.editorConnection = {
        isConnected: () => false,
        sendWarning: (component, nodeId, key, warning) => warnings.push(warning.message),
        clearWarning: () => {}
      };

      node.setInputValue('dictionaryData', ['hello', 'goodbye']);
      node.translate();

      expect(warnings.length).toBe(1);
      expect(node.getOutput('languages').value).toEqual([]);
    });
  });

  describe('JSON dictionaries', () => {
    test('language-first JSON in the parameter', async () => {
      const node = await makeWithDictionary(JSON.stringify(LANGUAGE_FIRST), { language: 'id' });
      expect(out(node, 'home.title')).toBe('Beranda');
    });

    test('language-first object on the Dictionary Data port', async () => {
      const node = await makeWithData(LANGUAGE_FIRST, { language: 'id' });

      expect(out(node, 'greeting')).toBe('Halo {name}');
      expect(out(node, 'languages')).toEqual(['en', 'id', 'pt-BR']);
    });

    test('key-first dictionaries are auto-detected', async () => {
      const node = await makeWithData(KEY_FIRST, { language: 'id' });

      expect(out(node, 'home.title')).toBe('Beranda');
      expect(out(node, 'languages').sort()).toEqual(['en', 'id']);
    });

    test('dictionaryFormat overrides auto-detection', async () => {
      // Two-letter top level keys that are NOT languages: with the format forced
      // to key-first, "de" and "id" are phrase keys, not language codes.
      const ambiguous = { de: { en: 'Delete', id: 'Hapus' }, id: { en: 'Id', id: 'Id' } };
      const node = await makeWithData(ambiguous, { dictionaryFormat: 'keyFirst', language: 'id' });

      expect(out(node, 'de')).toBe('Hapus');
    });

    test('the Dictionary Data port wins over the phrase table', async () => {
      const node = await makeNode({ dictionary: TABLE, language: 'id' });
      node.setInputValue('dictionaryData', { id: { 'home.title': 'Dari port' } });
      node.translate();

      expect(out(node, 'home.title')).toBe('Dari port');
    });

    test('invalid JSON leaves the node without a dictionary instead of throwing', async () => {
      const node = await makeWithDictionary('{ not json', { language: 'id', extraKeys: 'home.title' });

      expect(out(node, 'languages')).toEqual([]);
      expect(out(node, 'home.title')).toBe('home.title');
    });

    test('an Object/Record node value is unwrapped to its data', async () => {
      // Shape of an XGENIA Object: id + data, and a get() accessor.
      const model = {
        id: 'model-1',
        data: LANGUAGE_FIRST,
        get(key) {
          return this.data[key];
        }
      };

      const node = await makeWithData(model, { language: 'id' });
      expect(out(node, 'home.title')).toBe('Beranda');
    });
  });

  describe('language resolution', () => {
    test('an unknown language falls back to the fallback language', async () => {
      const node = await makeWithDictionary(TABLE, { language: 'fr', fallbackLanguage: 'en' });

      expect(out(node, 'resolvedLanguage')).toBe('en');
      expect(out(node, 'home.title')).toBe('Home');
    });

    test('with neither language nor fallback in the dictionary, the first one is used', async () => {
      // A typo in the Language field still shows readable text, not bare keys.
      const node = await makeWithDictionary(TABLE, { language: 'jp', fallbackLanguage: 'de' });

      expect(out(node, 'resolvedLanguage')).toBe('en');
      expect(out(node, 'hello')).toBe('Hello');
    });

    test('matching is loose: region and casing', async () => {
      const regional = await makeWithDictionary(TABLE, { language: 'id-ID' });
      expect(regional.getOutput('resolvedLanguage').value).toBe('id');
      expect(regional.getOutput('home.title').value).toBe('Beranda');

      const cased = await makeWithDictionary(TABLE, { language: 'EN' });
      expect(cased.getOutput('resolvedLanguage').value).toBe('en');

      // The other direction: asking for the base language finds a regional variant.
      const variantOnly = await makeWithData({ 'pt-BR': { hi: 'Ola' } }, { language: 'pt' });
      expect(variantOnly.getOutput('resolvedLanguage').value).toBe('pt-BR');
      expect(variantOnly.getOutput('hi').value).toBe('Ola');
    });
  });

  describe('phrases and missing translations', () => {
    test('missing phrases follow the When Missing setting', async () => {
      const asKey = await makeWithDictionary(TABLE, { language: 'id', extraKeys: 'nope.missing' });
      expect(asKey.getOutput('nope.missing').value).toBe('nope.missing');

      const asEmpty = await makeWithDictionary(TABLE, {
        language: 'id',
        extraKeys: 'nope.missing',
        missingBehavior: 'empty'
      });
      expect(asEmpty.getOutput('nope.missing').value).toBe('');

      const asCustom = await makeWithDictionary(TABLE, {
        language: 'id',
        extraKeys: 'nope.missing',
        missingBehavior: 'custom',
        missingText: '(belum diterjemahkan)'
      });
      expect(asCustom.getOutput('nope.missing').value).toBe('(belum diterjemahkan)');
    });

    test('Extra Keys adds ports for a dictionary that only exists at runtime', async () => {
      const node = await makeNode({ dictionary: '', language: 'id', extraKeys: 'greeting, home.title' });
      node.setInputValue('dictionaryData', LANGUAGE_FIRST);
      node.translate();

      expect(out(node, 'greeting')).toBe('Halo {name}');
      expect(out(node, 'home.title')).toBe('Beranda');
    });

    test('{placeholders} are filled from the variables input', async () => {
      const node = await makeNode({ dictionary: '', language: 'id' });
      node.setInputValue('dictionaryData', LANGUAGE_FIRST);
      node.setInputValue('variables', { name: 'Budi' });
      node.translate();
      expect(out(node, 'greeting')).toBe('Halo Budi');

      // A placeholder with no variable is left in place rather than blanked.
      node.setInputValue('variables', {});
      node.translate();
      expect(out(node, 'greeting')).toBe('Halo {name}');
    });

    test('translations output is the flat table of the active language', async () => {
      const node = await makeWithData(LANGUAGE_FIRST, { language: 'id' });
      expect(out(node, 'translations')).toEqual({ greeting: 'Halo {name}', 'home.title': 'Beranda' });
    });
  });

  describe('signals and scheduling', () => {
    test('Changed fires on every translate, Missing only when something is missing', async () => {
      const node = await makeNode({ dictionary: TABLE, language: 'id' });
      const signals = [];
      node.sendSignalOnOutput = (name) => signals.push(name);

      node.translate();
      expect(signals).toEqual(['Changed']);

      node.setInputValue('extraKeys', 'nope');
      node.translate();
      expect(signals).toEqual(['Changed', 'Changed', 'Missing']);
    });

    test('inputs are coalesced into a single translate per update', async () => {
      const node = await makeNode({ dictionary: '', language: 'en' });

      // Changed fires once per translate, so counting it counts the translates.
      let changed = 0;
      node.sendSignalOnOutput = (name) => {
        if (name === 'Changed') changed++;
      };

      node.setInputValue('dictionaryData', LANGUAGE_FIRST);
      node.setInputValue('language', 'id');
      node.setInputValue('fallbackLanguage', 'en');
      node.context.update();

      expect(changed).toBe(1);
      expect(out(node, 'greeting')).toBe('Halo {name}');
    });
  });

  describe('editor ports', () => {
    // The editor builds the ports from the parameters alone, so they appear as
    // the table is filled in rather than only once the app runs.
    function portsFor(parameters) {
      let sent = null;
      const context = {
        editorConnection: {
          isRunningLocally: () => true,
          sendDynamicPorts: (nodeId, ports) => {
            sent = ports;
          }
        }
      };

      let onNodeAdded = null;
      const graphModel = {
        on: (event, callback) => {
          if (event === 'nodeAdded.Languages Dictionary') onNodeAdded = callback;
        }
      };

      LanguagesDictionary.setup(context, graphModel);
      onNodeAdded({ id: 'n1', parameters: parameters, on: () => {} });
      return sent;
    }

    test('one port per phrase in the table', () => {
      const ports = portsFor({ dictionary: TABLE });

      expect(ports.map((p) => p.name)).toEqual(['hello', 'home.title', 'onlyEnglish']);
      expect(ports.every((p) => p.plug === 'output' && p.type === 'string')).toBe(true);
      expect(ports[1].displayName).toBe('Title');
    });

    test('one port per phrase in a JSON array of rows', () => {
      expect(portsFor({ dictionary: JSON.stringify(ROWS) }).map((p) => p.name)).toEqual(['hello', 'home.title']);
    });

    test('the default dictionary already has ports', () => {
      expect(portsFor({}).map((p) => p.name)).toEqual(['hello', 'goodbye']);
    });

    test('Extra Keys are added to the ports', () => {
      const ports = portsFor({ dictionary: TABLE, extraKeys: 'runtimeOnly' });
      expect(ports.map((p) => p.name)).toContain('runtimeOnly');
    });

    test('a huge dictionary only exposes the keys that were asked for', () => {
      const rows = ['key, en'];
      for (let i = 0; i < 80; i++) rows.push('key' + i + ', Text ' + i);

      const ports = portsFor({ dictionary: rows.join('\n'), extraKeys: 'key3' });
      expect(ports.map((p) => p.name)).toEqual(['key3']);
    });
  });

  // The node's first iteration had a JSON-only field, an object port and a
  // single lookup key. A project saved against those must still load.
  describe('parameters from the first iteration', () => {
    test('dictionaryJson still feeds the dictionary', async () => {
      const node = await makeNode({ dictionaryJson: JSON.stringify(LANGUAGE_FIRST), language: 'id' });
      node.translate();

      expect(out(node, 'home.title')).toBe('Beranda');
    });

    test('dictionaryObject still feeds the Dictionary Data port', async () => {
      const node = await makeNode({ dictionary: '', language: 'id' });
      node.setInputValue('dictionaryObject', LANGUAGE_FIRST);
      node.translate();

      expect(out(node, 'greeting')).toBe('Halo {name}');
    });

    test('keys and key still produce ports', async () => {
      const node = await makeNode({ dictionary: '', language: 'id', keys: 'greeting', key: 'home.title' });
      node.setInputValue('dictionaryData', LANGUAGE_FIRST);
      node.translate();

      expect(out(node, 'greeting')).toBe('Halo {name}');
      expect(out(node, 'home.title')).toBe('Beranda');
    });
  });

  // The property panel's table editor reads and writes dictionaries through
  // these, so a dictionary keeps the shape it was authored in.
  describe('format helpers', () => {
    test('parseDictionaryValue reports the shape it read', () => {
      expect(parseDictionaryValue(TABLE).source).toBe('table');
      expect(parseDictionaryValue(JSON.stringify(ROWS)).source).toBe('rows');
      expect(parseDictionaryValue(JSON.stringify(LANGUAGE_FIRST)).source).toBe('json');
      expect(parseDictionaryValue(ROWS).source).toBe('rows');
      expect(parseDictionaryValue(LANGUAGE_FIRST).source).toBe('json');
      expect(parseDictionaryValue('').dictionary).toBe(null);
    });

    test('dictionaryToGrid turns any dictionary into rows and languages', () => {
      const grid = dictionaryToGrid(parseDictionaryValue(TABLE).dictionary, 'auto');

      expect(grid.languages).toEqual(['en', 'id']);
      expect(grid.rows[0]).toEqual({ key: 'hello', values: { en: 'Hello', id: 'Halo' } });
      // A phrase with no Indonesian cell keeps an empty cell in the grid.
      expect(grid.rows[2]).toEqual({ key: 'onlyEnglish', values: { en: 'English only', id: '' } });

      const fromKeyFirst = dictionaryToGrid(KEY_FIRST, 'auto');
      expect(fromKeyFirst.rows.map((r) => r.key)).toEqual(['greeting', 'home.title', 'onlyEnglish']);
    });

    test('an edited grid is written back in the shape it came from', () => {
      const grid = dictionaryToGrid(parseDictionaryValue(TABLE).dictionary, 'auto');
      grid.rows.push({ key: 'bye', values: { en: 'Bye', id: 'Dah' } });

      const asTable = serializeDictionary(grid, 'table');
      expect(asTable.split('\n')[0]).toBe('key, en, id');
      expect(asTable).toContain('bye, Bye, Dah');
      expect(parseDictionaryValue(asTable).dictionary.id.bye).toBe('Dah');

      const asRows = JSON.parse(serializeDictionary(grid, 'rows'));
      expect(asRows[asRows.length - 1]).toEqual({ key: 'bye', en: 'Bye', id: 'Dah' });

      // A dictionary read as nested JSON stays a JSON object, with its phrase
      // keys flattened to the dot paths it was read with.
      const fromJson = dictionaryToGrid(LANGUAGE_FIRST, 'auto');
      const asJson = JSON.parse(serializeDictionary(fromJson, 'json'));
      expect(asJson.id).toEqual({ greeting: 'Halo {name}', 'home.title': 'Beranda' });
      expect(parseDictionaryValue(JSON.stringify(asJson)).source).toBe('json');
    });

    test('cells needing quotes survive a table round trip', () => {
      const grid = {
        languages: ['en', 'id'],
        rows: [{ key: 'hi', values: { en: 'Hello, "friend"', id: ' Halo ' } }]
      };

      const table = serializeDictionary(grid, 'table');
      const parsed = parseDictionaryValue(table).dictionary;

      expect(parsed.en.hi).toBe('Hello, "friend"');
      expect(parsed.id.hi).toBe(' Halo ');
    });

    test('empty languages and keys are dropped when writing', () => {
      const table = serializeDictionary(
        {
          languages: ['en', ''],
          rows: [
            { key: 'hi', values: { en: 'Hi' } },
            { key: '  ', values: { en: 'orphan' } }
          ]
        },
        'table'
      );

      expect(table).toBe('key, en\nhi, Hi');
    });
  });
});
