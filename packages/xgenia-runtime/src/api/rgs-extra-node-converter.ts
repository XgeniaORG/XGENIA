/**
 * RGS Extra Node Converter
 * ------------------------
 * The XGENIA "Compile" feature extracts EVERY non-visual node from a page into a
 * cloud component, which is then deployed to the RGS platform as a sandboxed
 * `evaluate(ctx)` script (see CloudFunctionConverter.generateRgsScript).
 *
 * The existing converters (math / std-library / slot / collection / signal /
 * JavaScriptFunction) only recognise a subset of node types. Any node they do
 * NOT recognise produces no function definition, never lands in the converter's
 * `outputVariableMap`, and so its outputs cannot be wired to the cloud
 * `xgenia.cloud.response` node — they are silently dropped from the response
 * payload. That is why a compiled component with many outputs would only return
 * the single math-backed field.
 *
 * This converter closes that gap. It generates sandbox-safe standalone functions
 * for the remaining non-visual node types so their outputs resolve and flow back
 * to the aggregator:
 *
 *   * Provably-fair / data nodes get REAL logic (deterministic, no I/O):
 *       Server Seed Generator, Random UUID Generator, Calculate Roll,
 *       Verify Commitment, Verify Fairness, Validate Outcome,
 *       Convert Inputs into Record, Convert Record into Outputs,
 *       And, Or, Less Than, Substring, Unique Id, String Format.
 *
 *   * Nodes that depend on real I/O (database / game-session / cloud-file) or on
 *     accumulated state across calls (RTP / volatility / hit-frequency monitors,
 *     array state) cannot run inside the stateless RGS sandbox (fetch / crypto /
 *     persistence are all blocked). They get a type-aware STUB that returns their
 *     declared outputs with safe defaults, so the response still carries every
 *     field instead of dropping it. The values are placeholders by necessity.
 *
 * Conventions every generated function obeys (matching math-node-converter):
 *   * It takes a single `inputs` object keyed by the node's input-port names.
 *   * It returns an object keyed by the node's RAW output-port names (e.g.
 *     "server seed", "combinedString hash") so the converter's name-based
 *     property access (safePropertyAccess) resolves correctly.
 *
 * Helpers (sha256, hashToRange, uuid) are emitted ONCE per script via
 * helperPrelude(); they use only sandbox-safe constructs (no crypto/eval/import)
 * and the sandbox-injected rgsRandom() for entropy.
 */

interface OutPort {
  name: string;
  type: string;
}

interface ExtraNodeSpec {
  outputs: OutPort[];
  // 'logic' nodes have a bespoke generator below; 'stub' nodes return defaults.
  kind: 'logic' | 'stub';
}

// Node names are matched after trimming (a few runtime nodes carry a trailing
// space in their registered name, e.g. "And ", "Or ").
function norm(typename: string): string {
  return String(typename || '').trim();
}

export class RgsExtraNodeConverter {
  // Registry of every non-visual node type that the other converters do not
  // handle. Output port names/types come from the runtime node definitions.
  private static readonly REGISTRY: Map<string, ExtraNodeSpec> = new Map<string, ExtraNodeSpec>([
    // ── Provably-fair / maths (real logic) ──────────────────────────────────
    ['Server Seed Generator', { kind: 'logic', outputs: [{ name: 'server seed', type: 'string' }, { name: 'nonce', type: 'number' }, { name: 'committedHash', type: 'string' }] }],
    ['Random UUID Generator', { kind: 'logic', outputs: [{ name: 'uuid', type: 'string' }] }],
    ['Calculate Roll', { kind: 'logic', outputs: [{ name: 'result', type: 'number' }, { name: 'combinedString hash', type: 'string' }] }],
    ['Verify Commitment', { kind: 'logic', outputs: [{ name: 'Result', type: 'boolean' }] }],
    ['Verify Fairness', { kind: 'logic', outputs: [{ name: 'isFair', type: 'boolean' }] }],
    ['Validate Outcome', { kind: 'logic', outputs: [{ name: 'rollResult', type: 'number' }] }],
    // ── Data reshaping (real logic) ─────────────────────────────────────────
    ['Convert Inputs into Record', { kind: 'logic', outputs: [{ name: 'data', type: 'object' }] }],
    ['Convert Record into Outputs', { kind: 'logic', outputs: [] }],
    // ── Logic / string (real logic) ─────────────────────────────────────────
    ['And', { kind: 'logic', outputs: [{ name: 'result', type: 'boolean' }] }],
    ['Or', { kind: 'logic', outputs: [{ name: 'result', type: 'boolean' }] }],
    ['Less Than', { kind: 'logic', outputs: [{ name: 'result', type: 'boolean' }] }],
    ['Substring', { kind: 'logic', outputs: [{ name: 'result', type: 'string' }] }],
    ['Unique Id', { kind: 'logic', outputs: [{ name: 'guid', type: 'string' }] }],
    ['String Format', { kind: 'logic', outputs: [{ name: 'formatted', type: 'string' }] }],
    ['Convert to String', { kind: 'logic', outputs: [{ name: 'Result', type: 'string' }] }],

    // ── Stateful monitors (stub — need cross-call accumulation) ─────────────
    ['Hit Frequency Monitor', { kind: 'stub', outputs: [{ name: 'Hit Frequency', type: 'number' }] }],
    ['RTP Monitor', { kind: 'stub', outputs: [{ name: 'RTP', type: 'number' }] }],
    ['Volatility Monitor', { kind: 'stub', outputs: [{ name: 'volatilityResult', type: 'number' }, { name: 'standardDeviation', type: 'number' }, { name: 'mean', type: 'number' }, { name: 'variance', type: 'number' }, { name: 'amplitude', type: 'number' }] }],
    // ── State / orchestration / frontend (stub) ─────────────────────────────
    ['arrayStateManager', { kind: 'stub', outputs: [] }],
    ['Convert Dict Keys to Ports', { kind: 'stub', outputs: [] }],
    ['RunTasks', { kind: 'stub', outputs: [] }],
    ['Animation', { kind: 'stub', outputs: [{ name: 'currentProgress', type: 'number' }, { name: 'isPlaying', type: 'boolean' }, { name: 'isPaused', type: 'boolean' }] }],
    ['String Mapper', { kind: 'stub', outputs: [{ name: 'mappedString', type: 'string' }] }],
    ['Import from JSON file', { kind: 'stub', outputs: [{ name: 'data', type: '*' }] }],
    ['Export to JSON file', { kind: 'stub', outputs: [{ name: 'error', type: 'string' }, { name: 'filePath', type: 'string' }, { name: 'debugInfo', type: 'string' }] }],
    // ── I/O: database / game-session / cloud (stub — blocked in sandbox) ────
    ['Cloud File', { kind: 'stub', outputs: [{ name: 'url', type: 'string' }, { name: 'name', type: 'string' }] }],
    ['DbModel2', { kind: 'stub', outputs: [{ name: 'id', type: 'string' }, { name: 'error', type: 'string' }] }],
    ['Model2', { kind: 'stub', outputs: [{ name: 'id', type: 'string' }] }],
    ['NewModel', { kind: 'stub', outputs: [{ name: 'id', type: 'string' }] }],
    ['SetModelProperties', { kind: 'stub', outputs: [{ name: 'id', type: 'string' }] }],
    ['SetDbModelProperties', { kind: 'stub', outputs: [{ name: 'error', type: 'string' }, { name: 'id', type: 'string' }] }],
    ['AddDbModelRelation', { kind: 'stub', outputs: [{ name: 'error', type: 'string' }, { name: 'id', type: 'string' }] }],
    ['RemoveDbModelRelation', { kind: 'stub', outputs: [{ name: 'error', type: 'string' }, { name: 'id', type: 'string' }] }],
    ['FilterDBModels', { kind: 'stub', outputs: [{ name: 'items', type: 'array' }, { name: 'firstItemId', type: 'string' }, { name: 'count', type: 'number' }] }],
    ['GetPlayerIdByName', { kind: 'stub', outputs: [{ name: 'playerId', type: 'string' }, { name: 'isExistBefore', type: 'boolean' }] }],
    ['ListGameSessions', { kind: 'stub', outputs: [{ name: 'sessions', type: 'array' }, { name: 'isEmpty', type: 'boolean' }] }],
    ['LoadGameSession', { kind: 'stub', outputs: [{ name: 'sessionData', type: '*' }, { name: 'isSuccessful', type: 'boolean' }] }],
    ['SaveGameSession', { kind: 'stub', outputs: [{ name: 'isSuccessful', type: 'boolean' }] }],
    ['DepositBalance', { kind: 'stub', outputs: [{ name: 'isSuccessful', type: 'boolean' }] }],
    ['WithdrawBalance', { kind: 'stub', outputs: [{ name: 'isSuccessful', type: 'boolean' }] }],
    ['GetBalanceByPlayerId', { kind: 'stub', outputs: [{ name: 'balance', type: 'number' }, { name: 'isSuccessful', type: 'boolean' }] }],
  ]);

  public isExtraNode(typename: string): boolean {
    return RgsExtraNodeConverter.REGISTRY.has(norm(typename));
  }

  /** True if ANY of the given node typenames is handled here (drives prelude emit). */
  public hasAnyExtraNode(typenames: string[]): boolean {
    return typenames.some((t) => this.isExtraNode(t));
  }

  /**
   * Shared, sandbox-safe helpers used by the generated logic functions.
   * Emitted once at the top of the script body. Uses only injected globals
   * (rgsRandom) and SAFE_GLOBALS (Math, String, parseInt, ...).
   */
  public static helperPrelude(): string {
    return `
const _rgsSha256Hex = (function () {
  function safe_add(x, y) { var lsw = (x & 0xffff) + (y & 0xffff); var msw = (x >> 16) + (y >> 16) + (lsw >> 16); return (msw << 16) | (lsw & 0xffff); }
  function S(X, n) { return (X >>> n) | (X << (32 - n)); }
  function R(X, n) { return X >>> n; }
  function Ch(x, y, z) { return (x & y) ^ (~x & z); }
  function Maj(x, y, z) { return (x & y) ^ (x & z) ^ (y & z); }
  function Sig0(x) { return S(x, 2) ^ S(x, 13) ^ S(x, 22); }
  function Sig1(x) { return S(x, 6) ^ S(x, 11) ^ S(x, 25); }
  function Gam0(x) { return S(x, 7) ^ S(x, 18) ^ R(x, 3); }
  function Gam1(x) { return S(x, 17) ^ S(x, 19) ^ R(x, 10); }
  function core(m, l) {
    var K = [0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5, 0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174, 0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA, 0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967, 0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85, 0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070, 0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3, 0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2];
    var HASH = [0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19];
    var W = []; var a, b, c, d, e, f, g, h, T1, T2;
    m[l >> 5] = m[l >> 5] | (0x80 << (24 - l % 32));
    m[((l + 64 >> 9) << 4) + 15] = l;
    for (var i = 0; i < m.length; i += 16) {
      a = HASH[0]; b = HASH[1]; c = HASH[2]; d = HASH[3]; e = HASH[4]; f = HASH[5]; g = HASH[6]; h = HASH[7];
      for (var j = 0; j < 64; j++) {
        if (j < 16) { W[j] = m[j + i] | 0; }
        else { W[j] = safe_add(safe_add(safe_add(Gam1(W[j - 2]), W[j - 7]), Gam0(W[j - 15])), W[j - 16]); }
        T1 = safe_add(safe_add(safe_add(safe_add(h, Sig1(e)), Ch(e, f, g)), K[j]), W[j]);
        T2 = safe_add(Sig0(a), Maj(a, b, c));
        h = g; g = f; f = e; e = safe_add(d, T1); d = c; c = b; b = a; a = safe_add(T1, T2);
      }
      HASH[0] = safe_add(a, HASH[0]); HASH[1] = safe_add(b, HASH[1]); HASH[2] = safe_add(c, HASH[2]); HASH[3] = safe_add(d, HASH[3]);
      HASH[4] = safe_add(e, HASH[4]); HASH[5] = safe_add(f, HASH[5]); HASH[6] = safe_add(g, HASH[6]); HASH[7] = safe_add(h, HASH[7]);
    }
    return HASH;
  }
  function str2binb(str) { var bin = []; var mask = 255; for (var i = 0; i < str.length * 8; i += 8) { bin[i >> 5] = bin[i >> 5] | ((str.charCodeAt(i / 8) & mask) << (24 - i % 32)); } return bin; }
  function binb2hex(binarray) { var hex_tab = '0123456789abcdef'; var str = ''; for (var i = 0; i < binarray.length * 4; i++) { str += hex_tab.charAt((binarray[i >> 2] >> ((3 - i % 4) * 8 + 4)) & 0xF) + hex_tab.charAt((binarray[i >> 2] >> ((3 - i % 4) * 8)) & 0xF); } return str; }
  return function (input) { var s = (input == null) ? '' : String(input); return binb2hex(core(str2binb(s), s.length * 8)); };
})();
function _rgsHashToRange(hash, min, max, swapWhenInverted) {
  if (swapWhenInverted && min > max) { var t = min; min = max; max = t; }
  var hexSubset = String(hash == null ? '' : hash).substring(0, 8);
  var decimalValue = parseInt(hexSubset, 16);
  if (isNaN(decimalValue)) { decimalValue = 0; }
  var rangeSize = max - min + 1;
  return (decimalValue % rangeSize) + min;
}
function _rgsHexBytes(n) { var s = ''; for (var i = 0; i < n * 2; i++) { s += '0123456789abcdef'.charAt(Math.floor(rgsRandom() * 16) % 16); } return s; }
function _rgsUuid() {
  var b = []; for (var i = 0; i < 16; i++) { b[i] = Math.floor(rgsRandom() * 256) & 0xff; }
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  var h = []; for (var k = 0; k < 16; k++) { h.push((b[k] & 0xff).toString(16).padStart(2, '0')); }
  return h[0]+h[1]+h[2]+h[3]+'-'+h[4]+h[5]+'-'+h[6]+h[7]+'-'+h[8]+h[9]+'-'+h[10]+h[11]+h[12]+h[13]+h[14]+h[15];
}
`;
  }

  /**
   * Generate the standalone function definition for a single node.
   * `inputs` are keyed by the node's input-port names; the return object is
   * keyed by the node's raw output-port names.
   */
  public generateNodeFunctionDefinition(node: any, functionName: string): string {
    const key = norm(node.typename);
    const spec = RgsExtraNodeConverter.REGISTRY.get(key);
    if (!spec) return `// Unknown extra node type: ${node.typename}`;

    const body = spec.kind === 'logic' ? this.logicBody(key, spec) : this.stubBody(spec);
    return `
    // Node: ${node.typename}${node.label ? ' (' + node.label + ')' : ''}
    const ${functionName} = (inputs) => {
      ${body}
    };`;
  }

  // ── Default-value expression for a stub output, by declared type ───────────
  private defaultForType(type: string): string {
    switch (type) {
      case 'number': return '0';
      case 'boolean': return 'false';
      case 'string': return '""';
      case 'array': return '[]';
      case 'object': return '{}';
      default: return 'null';
    }
  }

  private stubBody(spec: ExtraNodeSpec): string {
    // I/O / stateful nodes can't run in the sandbox — return declared outputs
    // with safe defaults so the response keeps the field instead of dropping it.
    const fields = spec.outputs.map((o) => `${quoteKey(o.name)}: ${this.defaultForType(o.type)}`);
    return `return { ${fields.join(', ')} };`;
  }

  private logicBody(key: string, _spec: ExtraNodeSpec): string {
    switch (key) {
      case 'Server Seed Generator':
        // Mirrors the runtime node: a fresh 32-byte hex seed, its sha256
        // commitment, and nonce = 1 for this (first) generation.
        return [
          'var _seed = _rgsHexBytes(32);',
          'return { "server seed": _seed, nonce: 1, committedHash: _rgsSha256Hex(_seed) };'
        ].join('\n      ');

      case 'Random UUID Generator':
        return 'return { uuid: _rgsUuid() };';

      case 'Unique Id':
        return 'return { guid: _rgsUuid() };';

      case 'Calculate Roll':
        return [
          'var _clientSeed = inputs["client seed"] != null ? String(inputs["client seed"]) : "";',
          'var _serverSeed = inputs["server seed"] != null ? String(inputs["server seed"]) : "";',
          'var _nonce = inputs.nonce != null ? inputs.nonce : 0;',
          'var _max = inputs["max range"] != null ? Number(inputs["max range"]) : 100;',
          'var _min = inputs["min range"] != null ? Number(inputs["min range"]) : 0;',
          'var _hash = _rgsSha256Hex(_serverSeed + ":" + _clientSeed + ":" + _nonce);',
          'return { result: _rgsHashToRange(_hash, _min, _max, true), "combinedString hash": _hash };'
        ].join('\n      ');

      case 'Verify Commitment':
        return [
          'var _serverSeed = inputs.serverSeed != null ? String(inputs.serverSeed) : "";',
          'var _committed = inputs.committedHash != null ? String(inputs.committedHash) : "";',
          'return { Result: _rgsSha256Hex(_serverSeed) === _committed };'
        ].join('\n      ');

      case 'Verify Fairness':
        return [
          'var _serverSeed = inputs.serverSeed != null ? String(inputs.serverSeed) : "";',
          'var _clientSeed = inputs.clientSeed != null ? String(inputs.clientSeed) : "";',
          'var _nonce = inputs.nonce != null ? inputs.nonce : 0;',
          'var _expected = inputs.expectedHash != null ? String(inputs.expectedHash) : "";',
          'return { isFair: _rgsSha256Hex(_serverSeed + ":" + _clientSeed + ":" + _nonce) === _expected };'
        ].join('\n      ');

      case 'Validate Outcome':
        return [
          'var _fairHash = inputs.fairHash != null ? String(inputs.fairHash) : "";',
          'var _max = inputs.maxRange != null ? Number(inputs.maxRange) : 100;',
          'var _min = inputs.minRange != null ? Number(inputs.minRange) : 0;',
          'return { rollResult: _rgsHashToRange(_fairHash, _min, _max, false) };'
        ].join('\n      ');

      case 'Convert Inputs into Record':
        // Collect input{i} ports into a record keyed by key{i} (or "input{i}").
        return [
          'var _n = inputs.numInputs != null ? Math.floor(Number(inputs.numInputs)) : 32;',
          'if (!(_n > 0)) { _n = 32; }',
          'var _rec = {};',
          'for (var _i = 0; _i < _n; _i++) {',
          '  var _v = inputs["input" + _i];',
          '  if (_v === undefined) { continue; }',
          '  var _k = inputs["key" + _i];',
          '  if (_k == null || String(_k).trim() === "") { _k = "input" + _i; } else { _k = String(_k).trim(); }',
          '  _rec[_k] = _v;',
          '}',
          'return { data: _rec };'
        ].join('\n      ');

      case 'Convert Record into Outputs':
        // Dynamic out-<key> ports map straight onto the record's keys, so
        // returning the record itself lets name-based access resolve each key.
        return [
          'var _data = inputs.data;',
          'return (_data && typeof _data === "object") ? _data : {};'
        ].join('\n      ');

      case 'And':
        return 'return { result: (inputs.a === true && inputs.b === true) };';

      case 'Or':
        return 'return { result: (inputs.a === true || inputs.b === true) };';

      case 'Less Than':
        return 'return { result: Number(inputs.firstNumber) < Number(inputs.secondNumber) };';

      case 'Substring':
        return [
          'var _s = inputs.string != null ? String(inputs.string) : "";',
          'var _start = inputs.start != null ? Number(inputs.start) : 0;',
          'var _end = inputs.end != null ? Number(inputs.end) : -1;',
          'var _res = (_end === -1) ? _s.substr(_start) : _s.substr(_start, _end - _start);',
          'return { result: _res };'
        ].join('\n      ');

      case 'Convert to String':
        // Mirror the runtime node's valueToString(): pass strings through,
        // String() primitives, JSON.stringify objects (fallback to String()).
        return [
          'var _d = inputs.Data;',
          'var _r;',
          'if (_d === undefined) { _r = ""; }',
          'else if (_d === null) { _r = "null"; }',
          'else if (typeof _d === "string") { _r = _d; }',
          'else if (typeof _d === "object") { try { _r = JSON.stringify(_d); } catch (_e) { _r = String(_d); } }',
          'else { _r = String(_d); }',
          'return { Result: _r };'
        ].join('\n      ');

      case 'String Format':
        // Replace each {token} in the format string with inputs[token].
        return [
          'var _fmt = inputs.format != null ? String(inputs.format) : "";',
          'var _matches = _fmt.match(/\\{[A-Za-z0-9_]*\\}/g) || [];',
          'for (var _i = 0; _i < _matches.length; _i++) {',
          '  var _name = _matches[_i].replace("{", "").replace("}", "");',
          '  var _val = inputs[_name];',
          '  _fmt = _fmt.replace(_matches[_i], _val !== undefined ? _val : "");',
          '}',
          'return { formatted: _fmt };'
        ].join('\n      ');

      default:
        return this.stubBody(_spec);
    }
  }
}

// Object-literal key: bare identifier when safe, otherwise quoted.
function quoteKey(name: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `"${name}"`;
}
