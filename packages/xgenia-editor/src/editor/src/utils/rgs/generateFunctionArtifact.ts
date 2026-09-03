// Turns a compiled logic component into a deployable RGS edge-function artifact.
//
// Two component shapes reach this, and they declare their public ports
// differently:
//   * `/#__cloud__/__Component_N__` — produced by the whole-project Compile
//     feature. Ports live on `xgenia.cloud.request` / `xgenia.cloud.response`
//     nodes as `params` + `pm-`prefixed dynamic ports.
//   * `/#__maths__/<name>` — a Math Component the user authored by hand and
//     deploys from the Maths RGS panel. Ports live on the ordinary
//     `Component Inputs` / `Component Outputs` gateway nodes, which is also
//     exactly what the generated script reads (`config[<port name>]`) and
//     writes (`_componentOutputs[<port name>]`), so the payload/response keys
//     ARE the gateway port names.
// Both are handled below; everything downstream is identical.
//
// The artifact:
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
  slug: string; // e.g. "__Component_1__" (cloud) or "SlotMaths" (maths)
  functionName: string;
  script: string;
  payloadExample: Record<string, any>;
  responseExample: Record<string, any>;
  // Which request port carries the bet and which response port carries the win.
  // Chosen by the user in the post-compile setup card (ComponentSetupDialog) and
  // stored on the RGS row so the platform's "Testing → Simulate" section defaults
  // to the same mapping instead of guessing the first numeric port. Left
  // undefined by generateFunctionArtifact — the deploy caller fills them in — and
  // an undefined value leaves whatever RGS already has untouched.
  betInputPort?: string;
  winOutputPort?: string;
  /**
   * Nodes in the component that no code generator can compile — see
   * CloudFunctionConverter.getUnsupportedNodes(). Empty for a component built
   * out of convertible nodes. A node with a non-empty `feeds` list is fatal:
   * the maths that was meant to produce that input does not exist server-side,
   * so the deployed script computes a different game from the one in the
   * editor. deployMathsComponents refuses those.
   */
  unsupportedNodes: Array<{
    typename: string;
    label: string;
    id: string;
    feeds: Array<{ node: string; port: string }>;
  }>;
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
    // A port default that is itself an array / object marks the port as complex
    // (the editor-UI cloud params are wildcard `*`, so the declared-type check
    // above misses them). Sample an empty container so the RGS "Testing" section
    // infers array / object rather than the numeric name-heuristic fallback → 0.
    if (Array.isArray(def)) return sampleForType('array');
    const dt = typeof def;
    if (dt === 'object') return sampleForType('object');
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

// Collect the public parameter fields of a `Component Inputs` / `Component
// Outputs` gateway node — the maths-component counterpart of
// collectParamFields.
//
// A gateway's ports are the component's own input/output ports, so there is no
// `pm-` prefix and no `params` stringlist to union: the port list IS the
// contract. Signal ports are dropped — a pulse is not a payload field, it is the
// trigger that sends the request (the Aggregator turns it into `is<X>`), and
// including it would publish a bogus `Do: 0` input in the API docs and RGS
// Testing.
//
// `plug` is 'output' for Component Inputs (its ports feed the graph as outputs)
// and 'input' for Component Outputs, mirroring collectParamFields.
function collectGatewayFields(node: any, plug: 'input' | 'output'): ParamField[] {
  // Real editor gateway nodes keep their ports on `node.ports`; hand-written
  // fixtures put them under `parameters.ports`. Read both, same as the runtime
  // converter's _readCompPorts.
  const raw = [
    ...(node?.ports || []),
    ...(node?.dynamicports || []),
    ...(node?.parameters?.ports || [])
  ];

  const byName = new Map<string, ParamField>();
  const order: string[] = [];

  for (const p of raw) {
    if (!p || typeof p.name !== 'string') continue;
    if (p.plug && p.plug !== plug) continue;
    const declaredType = normalizePortType(p.type);
    if (declaredType.toLowerCase() === 'signal') continue;
    const clean = p.name.trim();
    if (!clean) continue;
    const existing = byName.get(clean);
    if (!existing) {
      order.push(clean);
      byName.set(clean, { name: clean, declaredType, default: p.default });
      continue;
    }
    if (!existing.declaredType && declaredType) existing.declaredType = declaredType;
    if (existing.default === undefined && p.default !== undefined) existing.default = p.default;
  }

  return order.map((n) => byName.get(n)!);
}

// The maths-component counterpart of collectGatewayFields, asking the component
// MODEL for its ports instead of scraping the gateway nodes' raw JSON.
//
// Same reason the Publish-time Aggregator swap does (see mathsComponentPorts in
// deployMathsComponents): a gateway port carries no type of its own — both
// component templates write `Do` as `type: '*'` — so only ComponentModel.getPorts(),
// which derives each port's type from the port it is wired to inside the
// component, can tell a trigger from a data field. Scraping the raw array
// published `Do: 0` as a request field and `Success: 0` / `Failure: 0` as
// response fields, which the RGS Testing page then showed as real numeric ports.
//
// The resolved types are also more accurate for the fields that DO belong here: a
// port wired to a string input samples as `""` rather than falling through to the
// name heuristic's `0`, and RGS infers a port's type from its example value.
//
// `plug` is instance-facing: 'input' for the component's inputs (Component
// Inputs' ports), 'output' for its outputs. Returns null when the component
// cannot answer — a fixture, or a plain object parsed from JSON — so the caller
// falls back to the raw scan.
function collectResolvedGatewayFields(component: any, plug: 'input' | 'output'): ParamField[] | null {
  const ports = typeof component?.getPorts === 'function' ? component.getPorts() : null;
  if (!ports || ports.length === 0) return null;

  const fields: ParamField[] = [];
  for (const p of ports) {
    if (!p || typeof p.name !== 'string' || p.plug !== plug) continue;
    const declaredType = normalizePortType(p.type);
    // A pulse is not a payload field — it is the trigger that sends the request
    // (the Aggregator turns it into `is<X>`) or, on the way back, the Aggregator's
    // own success/failure signal.
    if (declaredType.toLowerCase() === 'signal') continue;
    const clean = p.name.trim();
    if (!clean) continue;
    fields.push({ name: clean, declaredType, default: p.default });
  }
  return fields;
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

  // "/#__cloud__/__Component_1__" → "__Component_1__";
  // "/#__maths__/Slot/SlotMaths" → "SlotMaths" (a maths component may be filed in
  // folders, and only its leaf name is the endpoint's identity).
  const rawName = String(component.name);
  const slug = rawName.startsWith('/#__maths__/')
    ? rawName.split('/').filter(Boolean).pop() || rawName
    : rawName.replace('/#__cloud__/', '');

  const roots = component.graph?.roots || [];
  const requestNode = roots.find((r: any) => r.typename === 'xgenia.cloud.request');
  const responseNode = roots.find((r: any) => r.typename === 'xgenia.cloud.response');

  // A maths component declares its contract on the Component Inputs / Outputs
  // gateways instead. Prefer the cloud nodes when present so a compiled cloud
  // component that happens to also carry gateways is unaffected.
  const inputsNode = roots.find((r: any) => r.typename === 'Component Inputs');
  const outputsNode = roots.find((r: any) => r.typename === 'Component Outputs');

  // Ask the model for resolved port types only when the contract really is on the
  // gateways. A cloud component declares its on `pm-`prefixed ports of the cloud
  // request/response nodes, which getPorts() would report under those raw names.
  const hasGateways = !!inputsNode || !!outputsNode;

  const requestFields = requestNode
    ? collectParamFields(requestNode, 'output')
    : (hasGateways ? collectResolvedGatewayFields(component, 'input') : null) ??
      collectGatewayFields(inputsNode, 'output');
  const responseFields = responseNode
    ? collectParamFields(responseNode, 'input')
    : (hasGateways ? collectResolvedGatewayFields(component, 'output') : null) ??
      collectGatewayFields(outputsNode, 'input');

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

  const { script, unsupportedNodes } = converter.generateRgsScript();

  return { slug, functionName: slug, script, payloadExample, responseExample, unsupportedNodes };
}
