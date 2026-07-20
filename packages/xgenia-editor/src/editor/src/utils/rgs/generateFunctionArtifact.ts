// Turns a compiled logic component (`/#__cloud__/__Component_N__`) into a
// deployable RGS edge-function artifact:
//   * `script` — a sandbox-compatible evaluate(ctx) body (reuses the editor's
//     CloudFunctionConverter.generateRgsScript(); executed by the `rgs-fn`
//     dispatcher with ctx.config = the request payload).
//   * `payloadExample` / `responseExample` — derived from the component's
//     xgenia.cloud.request / xgenia.cloud.response ports, for the API docs tab
//     AND the RGS "Testing" section. The RGS side infers each port's TYPE from
//     the JS `typeof` of its example value (see test.tsx `portTypeOf`), so the
//     example value's runtime type IS the port's declared type downstream. A
//     string port therefore MUST get a string example (""), not a number.

export interface FunctionArtifact {
  slug: string; // e.g. "__Component_1__"
  functionName: string;
  script: string;
  payloadExample: Record<string, any>;
  responseExample: Record<string, any>;
}

// One public parameter of a cloud request/response node: its clean field name,
// the type declared on its port (if any), and any port default value.
interface ParamField {
  name: string;
  declaredType: string; // '' when unknown / wildcard ('*')
  default?: any;
}

function parseParams(value: any): string[] {
  if (!value || typeof value !== 'string') return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// A port `type` is `string | { name }` (see supabase-converter XgeniaPort).
function normalizePortType(t: any): string {
  if (!t) return '';
  if (typeof t === 'string') return t;
  if (typeof t === 'object' && typeof t.name === 'string') return t.name;
  return '';
}

// Map a declared port type to the JS example type it should sample as. Returns
// null for wildcard / structural / unknown types, so the caller falls back to
// the name heuristic.
function sampleTypeForDeclared(declared: string): 'string' | 'number' | 'boolean' | 'array' | 'object' | null {
  switch (declared.toLowerCase()) {
    case 'string':
    case 'text':
      return 'string';
    case 'number':
    case 'float':
    case 'double':
    case 'int':
    case 'integer':
      return 'number';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'array':
      return 'array';
    case 'object':
      return 'object';
    default:
      // '*', '', 'signal', 'stringlist', 'enum', 'component', … → not concrete.
      return null;
  }
}

function sampleForType(t: 'string' | 'number' | 'boolean' | 'array' | 'object'): any {
  switch (t) {
    case 'string':
      return '';
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    case 'number':
    default:
      return 0;
  }
}

// Split a field name into lowercased word tokens across camelCase / snake_case /
// kebab-case / dotted boundaries (e.g. "playerSessionId" → [player, session, id]).
function nameTokens(name: string): string[] {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Tokens that almost always denote a numeric quantity. Guarded first so a field
// like "betAmount" or "keyCount" is never mistaken for a string.
const NUMERIC_TOKENS = new Set([
  'amount', 'amt', 'value', 'val', 'bet', 'win', 'wins', 'balance', 'multiplier', 'mult',
  'rtp', 'min', 'max', 'stake', 'payout', 'total', 'sum', 'count', 'size', 'length', 'len',
  'number', 'num', 'qty', 'quantity', 'price', 'cost', 'fee', 'rate', 'ratio', 'percent', 'pct',
  'index', 'idx', 'rows', 'row', 'cols', 'col', 'columns', 'column', 'width', 'height', 'weight',
  'nonce', 'timeout', 'duration', 'offset', 'limit', 'page', 'spins', 'spin', 'reels', 'reel',
]);

// Tokens that almost always denote free text / identifiers rather than a number.
const STRING_TOKENS = new Set([
  'id', 'uuid', 'guid', 'token', 'key', 'hash', 'secret', 'session', 'currency', 'locale',
  'language', 'lang', 'country', 'region', 'name', 'email', 'url', 'uri', 'phone', 'address',
  'mode', 'status', 'message', 'msg', 'label', 'text', 'description', 'desc', 'slug', 'tag',
  'code', 'provider', 'method', 'operator', 'player', 'client', 'server', 'seed',
]);

// Best-effort type when a port carries no declared type (the editor's cloud
// request/response UI creates params as wildcard `*` ports). Boolean flags are
// conventionally named is/has/should/… ; a curated set of tokens flags obvious
// strings; everything else defaults to a numeric field (the historical default).
function sampleValueForName(field: string): any {
  if (/^(is|has|should|can|enable|allow|require)[A-Z]/.test(field)) return false;
  const tokens = nameTokens(field);
  if (tokens.some((t) => NUMERIC_TOKENS.has(t))) return 0;
  if (tokens.some((t) => STRING_TOKENS.has(t))) return '';
  return 0;
}

// Resolve the example value for a single field: a concrete declared port type
// wins (deterministic), then a primitive port default's runtime type, then the
// name-based heuristic.
function exampleValueForField(field: ParamField): any {
  const concrete = sampleTypeForDeclared(field.declaredType);
  if (concrete) return sampleForType(concrete);

  const def = field.default;
  if (def !== undefined && def !== null) {
    const dt = typeof def;
    if (dt === 'string' || dt === 'number' || dt === 'boolean') return sampleForType(dt);
  }

  return sampleValueForName(field.name);
}

// Collect the public parameter fields of a cloud request/response node.
//
// Public params live in two places that must be unioned (neither is complete on
// its own): the `params` stringlist (names, no type — the editor UI path) and
// the `pm-`prefixed dynamic ports (carry a declared `type`/`default` — the typed
// / AI-authored path, which the runtime converter itself treats as primary). We
// key by clean name, preserve `params` order for stable example output, then
// append any typed ports not present in `params`.
//
// `plug` is 'output' for the request node (its params feed the graph as outputs)
// and 'input' for the response node (its params are collected as inputs).
function collectParamFields(node: any, plug: 'input' | 'output'): ParamField[] {
  const byName = new Map<string, ParamField>();
  const order: string[] = [];

  const add = (name: string, declaredType = '', def?: any) => {
    const clean = String(name).trim();
    if (!clean) return;
    const existing = byName.get(clean);
    if (!existing) {
      order.push(clean);
      byName.set(clean, { name: clean, declaredType, default: def });
      return;
    }
    // Enrich an existing (typeless) entry with a concrete type/default if found.
    if (!existing.declaredType && declaredType) existing.declaredType = declaredType;
    if (existing.default === undefined && def !== undefined) existing.default = def;
  };

  // 1. `params` stringlist — canonical names, preserves order.
  parseParams(node?.parameters?.params).forEach((name) => add(name));

  // 2. `pm-` ports (dynamic + static) — clean name + declared type/default.
  const ports = [...(node?.dynamicports || []), ...(node?.ports || [])];
  for (const p of ports) {
    if (!p || p.plug !== plug) continue;
    if (typeof p.name !== 'string' || !p.name.startsWith('pm-')) continue;
    const clean =
      typeof p.displayName === 'string' && p.displayName.trim()
        ? p.displayName.trim()
        : p.name.slice(3);
    add(clean, normalizePortType(p.type), p.default);
  }

  return order.map((n) => byName.get(n)!);
}

function buildProjectContext(project: any) {
  const components = (project.getComponents?.() || project.components || []).map((c: any) => ({
    name: c.name,
    id: c.id,
    graph: {
      roots: c.graph?.roots || [],
      connections: c.graph?.connections || []
    },
    metadata: c.metadata || {}
  }));
  return { name: project.name, components };
}

export function generateFunctionArtifact(component: any, project: any): FunctionArtifact {
  // Lazily require to avoid bundling the converter where it isn't needed.
  const { CloudFunctionConverter } = require('@xgenia/runtime/src/api/supabase-converter');

  const slug = String(component.name).replace('/#__cloud__/', '');
  const roots = component.graph?.roots || [];
  const requestNode = roots.find((r: any) => r.typename === 'xgenia.cloud.request');
  const responseNode = roots.find((r: any) => r.typename === 'xgenia.cloud.response');

  const requestFields = collectParamFields(requestNode, 'output');
  const responseFields = collectParamFields(responseNode, 'input');

  const payloadExample: Record<string, any> = {};
  requestFields.forEach((f) => (payloadExample[f.name] = exampleValueForField(f)));
  const responseExample: Record<string, any> = {};
  responseFields.forEach((f) => (responseExample[f.name] = exampleValueForField(f)));

  const converter = new CloudFunctionConverter(
    {
      name: component.name,
      id: component.id,
      graph: {
        roots: component.graph?.roots || [],
        connections: component.graph?.connections || []
      },
      metadata: component.metadata || {}
    },
    buildProjectContext(project)
  );

  const { script } = converter.generateRgsScript();

  return { slug, functionName: slug, script, payloadExample, responseExample };
}
