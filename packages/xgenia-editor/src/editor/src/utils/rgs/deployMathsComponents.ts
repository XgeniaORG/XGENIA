// Deploys the project's Math Components (`/#__maths__/…`) into one RGS Server
// Version, one backend component each.
//
// This is the "Math Components → Deploy" button in the Maths RGS panel, and it
// replaces the old route where a component only became a backend at Publish time
// (whole-project Compile → extract logic → deploy). Here the user authors a
// component in the tree, presses Deploy, and it IS a backend component from then
// on — Publish just points the frontend at it.
//
// Per component, in order:
//   1. COMPILE — clone its graph and inline every nested component instance, so
//      what deploys is a single flat layer of primitive / custom nodes. Same
//      transformation the whole-project Compile does (inlineAll), scoped to one
//      component and run on a throwaway clone, so the user's project is never
//      touched.
//   2. DEPLOY — generate the evaluate(ctx) script + API examples from the flat
//      graph and upsert it into the Server Version as its own component
//      (maths-deployer `deploy-edge-function`).
//   3. UPLOAD project.json — a separate call that stores the component AS
//      AUTHORED (nested sub-components included, nothing inlined) alongside the
//      deployed row, so the graph can be reopened and edited later. The compiled
//      script is what runs; this is what a human reads.
//
// The HTTP contract of a deployed Math Component follows from the generated
// script (see supabase-converter.generateRgsScript):
//   request  { <Component Inputs port name>: value, … }   → ctx.config
//   response { <Component Outputs port name>: value, … }   ← rgs-fn returns `data`
// which is exactly what an Aggregator node speaks — see mathsEndpointsForGame /
// swapDeployedMathsInstances, used by Publish.

import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { guid } from '@xgenia-utils/utils';

import { cloneRootsWithIdMap, inlineAll } from '../compile/flattenLogic';
import { toFunctionSlug } from './functionSlug';
import { generateFunctionArtifact, FunctionArtifact } from './generateFunctionArtifact';
import { createEdgeDeployment, deployEdgeFunction } from './deployEdgeFunction';
import { XRGS_URL, rgsHeaders } from './rgsClient';

/** Sheet every Math Component lives under. */
export const MATHS_PREFIX = '/#__maths__/';

export function isMathsComponentName(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith(MATHS_PREFIX);
}

/**
 * Every Math Component in the project, in name order.
 *
 * Nesting is filing, not containment: a child ("/#__maths__/Adder/Add with 5")
 * and a grandchild ("/#__maths__/Adder/Add with 5/…") are each their own
 * ComponentModel with their own graph, so each is its own independent component
 * here — compiled, deployed and counted separately from its parent, exactly like
 * a sibling. Anything under `/#__maths__/` is in, at any depth: components filed
 * in sub-folders, and "folder components" (a component that also has children).
 */
export function listMathsComponents(project: any): any[] {
  const all = project?.getComponents?.() || project?.components || [];
  return all
    .filter((c: any) => isMathsComponentName(c?.name))
    .slice()
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
}

/**
 * A Math Component's path below the `/#__maths__/` sheet, segment by segment.
 *
 * "/#__maths__/Adder/Add with 5" → ['Adder', 'Add with 5']. Folders and parent
 * components are indistinguishable in a component name — both are just path
 * segments — so this is the whole of what identifies the component inside the
 * sheet.
 */
export function mathsComponentPath(component: any): string[] {
  const name = String(component?.name || '');
  const body = name.startsWith(MATHS_PREFIX) ? name.slice(MATHS_PREFIX.length) : name;
  return body
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * The routing slug a Math Component deploys under: its FULL path below the
 * sheet, slugified — "Adder/Add with 5" → "Adder_Add_with_5".
 *
 * The path, not just the leaf, because every component in the tree deploys as
 * its own endpoint regardless of depth, and the slug is what identifies it: it
 * becomes a path segment of `/rgs-fn/<game>/<slug>` and the RGS upsert keys on
 * (deployment_id, function_slug). On the leaf alone, "Adder/Add with 5" and
 * "Substract/Add with 5" are one endpoint — the second would overwrite the
 * first, so the deploy had to refuse the pair outright and demand a rename.
 * Qualifying by path makes them two independent components, which is what the
 * tree already says they are.
 *
 * A top-level component's slug is unchanged by this (its path IS its leaf), so
 * everything deployed from a flat sheet keeps its endpoint. A component filed
 * under a parent or folder deploys under a longer slug than it did when only the
 * leaf counted; its old endpoint row is left alone (still active, still served)
 * and Publish repoints the frontend at the new URL.
 *
 * Two different paths can still slugify the same ("Adder/Add" vs "Adder_Add"),
 * so deployMathsComponents keeps its collision check.
 */
export function mathsComponentSlug(component: any): string {
  return toFunctionSlug(mathsComponentPath(component).join('/'), 'Component');
}

/**
 * Display name shown in the RGS lists — the path below the sheet, unslugified:
 * "Adder / Add with 5". Nested components share leaf names freely, and a list of
 * bare leaves gives no way to tell which "Add with 5" is which.
 */
export function mathsComponentDisplayName(component: any): string {
  return mathsComponentPath(component).join(' / ') || 'Component';
}

/**
 * Step 1 — the "small compilation": a single-layer copy of one component's graph.
 *
 * Clones the roots (fresh ids, so nothing aliases the live graph) into a
 * detached NodeGraphModel and runs `inlineAll`, which splices each nested
 * component-instance's definition in and short-circuits its Component
 * Inputs/Outputs gateways until no instance roots remain. The component's OWN
 * gateways are roots of this graph, not instances, so they survive — they are
 * the deployed function's request/response contract.
 *
 * Returns a detached component-shaped object. It is deliberately NOT added to
 * the project: `generateFunctionArtifact` only reads name/id/graph/metadata off
 * it, and adding it would put a machine-generated flattened twin in the user's
 * tree.
 */
export function compileMathsComponent(component: any): any {
  const graph = new NodeGraphModel();

  const { nodes, connections } = cloneRootsWithIdMap(component.graph, component.graph.roots);
  nodes.forEach((n: any) => graph.addRoot(n));
  connections.forEach((c: any) => graph.addConnection(c));

  inlineAll(graph);

  const flat = new ComponentModel({
    name: component.name,
    graph,
    id: guid()
  });
  // Same guarantee buildCloudComponent gives its output: globally-unique ids
  // after the inlining spliced in clones of other components' nodes.
  flat.rekeyAllIds();
  return flat;
}

/**
 * Every project component this component depends on, transitively — the nested
 * "integration layers" that step 1 inlines away.
 *
 * A component instance's `typename` IS the referenced component's full name (see
 * supabase-converter, which filters roots by `typename.startsWith('/#__maths__/')`),
 * so resolution is a name lookup. Children are walked too, not just roots: a
 * component instance can sit inside a group.
 */
export function collectComponentDependencies(project: any, component: any): any[] {
  const byName = new Map<string, any>();
  const seen = new Set<string>();

  const visit = (comp: any) => {
    if (!comp || seen.has(comp.name)) return;
    seen.add(comp.name);

    (comp.graph?.roots || []).forEach((root: any) => {
      root.forEach?.((node: any) => {
        const dep = node?.typename ? project?.getComponentWithName?.(node.typename) : null;
        if (!dep || dep === component || byName.has(dep.name)) return;
        byName.set(dep.name, dep);
        visit(dep);
      });
    });
  };

  visit(component);
  return Array.from(byName.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Step 3's payload — a `project.json` for ONE component, as authored.
 *
 * Same shape ProjectModel.toJSON writes (so it loads as a project), holding the
 * component plus every nested sub-component it uses, each with its graph
 * untouched: nothing inlined, node ids preserved. That is the point — the
 * deployed script is flat and machine-shaped, and unreadable as a graph; this is
 * the document you reopen to see and edit how the nodes are wired.
 *
 * `settings` / `variants` are empty and there is no `rootNodeId`: a maths
 * component has no visual root and no page/style surface, so carrying the host
 * project's would describe something this document doesn't contain.
 */
export function buildComponentProjectJson(
  project: any,
  component: any,
  extra?: { slug?: string; gameId?: string; deploymentId?: string; version?: number }
): Record<string, any> {
  const dependencies = collectComponentDependencies(project, component);

  return {
    name: mathsComponentDisplayName(component),
    components: [component, ...dependencies].map((c: any) => c.toJSON()),
    settings: {},
    rootNodeId: undefined,
    version: project?.version,
    variants: [],
    metadata: {
      // Provenance, so a document pulled back out of RGS says where it came
      // from and which endpoint it belongs to.
      xgeniaMathsComponent: {
        componentName: component.name,
        slug: extra?.slug ?? mathsComponentSlug(component),
        sourceProject: project?.name,
        gameId: extra?.gameId,
        deploymentId: extra?.deploymentId,
        serverVersion: extra?.version,
        dependencies: dependencies.map((c: any) => c.name)
      }
    }
  };
}

/**
 * Stores one component's authored `project.json` on its already-deployed row.
 *
 * A separate call from the deploy on purpose: the script is what RGS executes
 * and must land first, and a project.json that fails to upload must not take the
 * working deployment with it.
 */
export async function uploadComponentProject(
  apiKey: string,
  gameId: string,
  deploymentId: string,
  functionSlug: string,
  projectJson: Record<string, any>
): Promise<void> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({
      action: 'upload-component-project',
      game_id: gameId,
      deployment_id: deploymentId,
      function_slug: functionSlug,
      project_json: projectJson
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const serverError = (data && data.error) || '';
    if (
      res.status === 400 &&
      /invalid action/i.test(serverError) &&
      !serverError.includes('upload-component-project')
    ) {
      throw new Error(
        'XGENIA RGS backend is out of date — it does not store component project.json yet. ' +
          'Apply the game_edge_functions.project_json migration and redeploy the `maths-deployer` ' +
          'function to the RGS project, then Deploy again.'
      );
    }
    throw new Error(serverError || `project.json upload failed (HTTP ${res.status})`);
  }
}

// ─── bet / win port mapping ───────────────────────────────────────────────────
//
// The generated script and the `rgs-fn` dispatcher are coupled through two stored
// column values, `bet_input_port` and `win_output_port`, and getting them wrong is
// not cosmetic:
//
//   * `bet` — the converter compiles an input port named `betAmount` to the bare
//     sandbox variable `bet`, NOT to `config.betAmount` (see supabase-converter
//     `sourceValue = 'bet'`). The sandbox resolves that as
//     `ctx.bet || config.bet || 0`, and rgs-fn fills `ctx.bet` from
//     `payload[bet_input_port]`. So a component with a `betAmount` port that is
//     deployed WITHOUT `bet_input_port` computes every call on a stake of zero.
//
//   * `win` — rgs-fn records a round when `bet_input_port || win_output_port` is
//     set and the bet is above zero, reading the win from
//     `data[win_output_port]`. With no win port it books the round at zero win.
//
// Both are therefore derived from the component's own declared ports, using the
// compiler's own rules rather than a guess — and sent ONLY together. Bet alone
// would fix the stake but under-report every win; win alone leaves the stake at
// zero. When only one (or neither) can be identified, neither is sent and the
// caller reports it, so the mapping is set deliberately on the platform instead of
// half-applied here.

/** The input port the generated script reads as `ctx.bet`, if the component has one. */
function betPortFor(payloadExample: Record<string, any>): string | null {
  return Object.keys(payloadExample || {}).find((k) => k.toLowerCase() === 'betamount') || null;
}

/**
 * The output port the generated script's own `_win` derivation reports as the
 * round's win, in that derivation's precedence order. Its nested `finalResult.*`
 * fallbacks are deliberately not considered: a nested field is not a response
 * port, so there would be nothing for rgs-fn to read `data[win_output_port]` from.
 */
const WIN_PORT_PRECEDENCE = ['win', 'winAmount', 'spinWinnings', 'totalPayout', 'totalWinnings'];

function winPortFor(responseExample: Record<string, any>): string | null {
  const keys = Object.keys(responseExample || {});
  for (const candidate of WIN_PORT_PRECEDENCE) {
    const hit = keys.find((k) => k === candidate) || keys.find((k) => k.toLowerCase() === candidate.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/**
 * The bet/win mapping a deploy of this artifact WOULD store — the same two rules
 * as the deploy, exposed so a simulation of an undeployed component stakes and
 * scores its rounds the way the real endpoint will. Either half can be null when
 * the component's ports don't name one.
 */
export function deriveBetWinPorts(artifact: {
  payloadExample?: Record<string, any>;
  responseExample?: Record<string, any>;
}): { betInputPort: string | null; winOutputPort: string | null } {
  return {
    betInputPort: betPortFor(artifact.payloadExample || {}),
    winOutputPort: winPortFor(artifact.responseExample || {})
  };
}

export interface MathsDeployResult {
  componentName: string;
  slug: string;
  functionName: string;
  url: string;
  /** False when the script deployed but its project.json upload failed. */
  projectUploaded: boolean;
  projectError?: string;
  /**
   * The bet/win mapping this deploy stored, or null when it could not identify
   * both and stored neither (leaving whatever RGS already had). Null on a
   * component that takes no bet is normal — a paytable lookup has no stake.
   */
  betInputPort: string | null;
  winOutputPort: string | null;
  /** Set when a `betAmount` port exists but no win port could be identified. */
  betWinWarning?: string;
  /**
   * Exactly what was sent to the platform — the compiled script and the authored
   * graph. Returned so the caller can snapshot this deploy into a commit without
   * compiling everything a second time, and without re-reading it back over the
   * network (which would record whatever is live at THAT moment, not what this
   * deploy pushed).
   */
  script: string;
  projectJson: Record<string, any>;
}

export interface MathsDeployOptions {
  apiKey: string;
  gameId: string;
  /** The Server Version to deploy into. */
  deploymentId: string;
  version?: number;
  /**
   * Deploy only these slugs, instead of every Math Component in the project.
   *
   * This is how Deploy became a commit: only components that differ from what is
   * deployed are pushed. Re-uploading an identical component would put a
   * duplicate snapshot in the history and make every commit look like it touched
   * the whole project. Omitted (or empty) deploys everything, which is what the
   * button did before and what a first deploy still needs.
   */
  onlySlugs?: Set<string>;
  /** Progress line for the panel, e.g. "Compiling SlotMaths (1/3)…". */
  onProgress?: (message: string) => void;
}

/**
 * Deploys every Math Component in the project into one Server Version.
 *
 * "Every" is depth-blind: a parent, its children and its grandchildren are each
 * an independent component with its own graph, so each gets its own compile and
 * its own endpoint. A child that the parent also INSTANTIATES is inlined into the
 * parent's script as well (step 1) — that is the parent being self-contained, not
 * the child being skipped.
 *
 * Per component: compile → deploy → upload project.json. Runs sequentially so a
 * failure names the component that failed and nothing after it has run, and so
 * the progress line means something.
 *
 * A project.json upload failure does NOT fail the component: the backend
 * component is live at that point, and reporting the whole deploy as failed
 * would be a lie. It comes back on the result as `projectUploaded: false` for the
 * caller to surface.
 */
export async function deployMathsComponents(
  project: any,
  options: MathsDeployOptions
): Promise<MathsDeployResult[]> {
  const { apiKey, gameId, deploymentId, version, onlySlugs, onProgress } = options;

  const allComponents = listMathsComponents(project);
  if (allComponents.length === 0) {
    throw new Error('This project has no Math Components. Create one first.');
  }

  // Two components whose leaf names slugify the same would deploy to one
  // endpoint, the second overwriting the first (the RGS upsert keys on
  // (deployment_id, function_slug)). Checked across the WHOLE tree, not just the
  // subset being deployed: a collision between a component being pushed and one
  // sitting still is just as destructive, and only shows up here.
  const bySlug = new Map<string, string[]>();
  allComponents.forEach((c: any) => {
    const slug = mathsComponentSlug(c);
    bySlug.set(slug, [...(bySlug.get(slug) || []), c.name]);
  });
  const collisions = Array.from(bySlug.entries()).filter(([, names]) => names.length > 1);
  if (collisions.length > 0) {
    const [slug, names] = collisions[0];
    throw new Error(
      `${names.join(' and ')} both deploy as "${slug}" — one would overwrite the other. ` +
        'Rename one of them.'
    );
  }

  const components =
    onlySlugs && onlySlugs.size > 0
      ? allComponents.filter((c: any) => onlySlugs.has(mathsComponentSlug(c)))
      : allComponents;
  if (components.length === 0) {
    throw new Error('None of the components asked for are in this project any more.');
  }

  const results: MathsDeployResult[] = [];

  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    const label = mathsComponentDisplayName(component);
    const slug = mathsComponentSlug(component);
    const position = `(${i + 1}/${components.length})`;

    // 1. Compile: flatten every nested integration layer into one.
    onProgress?.(`Compiling ${label} ${position}…`);
    const flat = compileMathsComponent(component);
    const artifact: FunctionArtifact = generateFunctionArtifact(flat, project);

    if (!artifact.script || artifact.script.length < 50) {
      throw new Error(
        `${label} compiled to an empty script. Check that its nodes are connected — or, if it only ` +
          'exists to hold the components under it, make it a Folder instead of a component.'
      );
    }
    // Same guard the Maths panel's upload pipeline applies: catch a script that
    // cannot even parse here, rather than after it is live.
    try {
      // eslint-disable-next-line no-new-func
      new Function('ctx', artifact.script);
    } catch (err: any) {
      throw new Error(`${label} failed to compile: ${err?.message || err}`);
    }

    // 2. Deploy the compiled component into its parent Server Version.
    //
    // The bet/win mapping is derived from the component's own ports and sent only
    // as a matched pair (see the block above betPortFor). When it can't be, the
    // keys are omitted ENTIRELY rather than sent empty, so RGS keeps whatever the
    // component already had instead of clearing a mapping someone set by hand.
    const betInputPort = betPortFor(artifact.payloadExample);
    const winOutputPort = winPortFor(artifact.responseExample);
    const mapBoth = !!betInputPort && !!winOutputPort;
    const betWinWarning = betInputPort && !winOutputPort
      ? `${label} has a betAmount input but no recognisable win output ` +
        `(${WIN_PORT_PRECEDENCE.join(', ')}), so its bet/win mapping was left unset. ` +
        `Until it is set on the platform, the script sees a stake of 0 and no rounds are recorded.`
      : undefined;

    onProgress?.(`Deploying ${label} ${position}…`);
    const { url } = await deployEdgeFunction(apiKey, gameId, deploymentId, {
      ...artifact,
      slug,
      functionName: label,
      ...(mapBoth ? { betInputPort: betInputPort!, winOutputPort: winOutputPort! } : {})
    });

    // 3. Upload the authored project.json for this component, separately.
    const projectJson = buildComponentProjectJson(project, component, {
      slug,
      gameId,
      deploymentId,
      version
    });
    let projectUploaded = true;
    let projectError: string | undefined;
    try {
      onProgress?.(`Uploading ${label} project.json ${position}…`);
      await uploadComponentProject(apiKey, gameId, deploymentId, slug, projectJson);
    } catch (err: any) {
      projectUploaded = false;
      projectError = err?.message || String(err);
      console.error(`[MathsComponents] project.json upload failed for ${label}:`, err);
    }

    results.push({
      componentName: component.name,
      slug,
      functionName: label,
      url,
      projectUploaded,
      projectError,
      betInputPort: mapBoth ? betInputPort : null,
      winOutputPort: mapBoth ? winOutputPort : null,
      betWinWarning,
      script: artifact.script,
      projectJson
    });
  }

  return results;
}

/**
 * Creates an EMPTY Server Version on RGS.
 *
 * Same call Publish makes, exposed on its own so "＋ New version" in the panel
 * lands a real (component-less) version on the platform immediately, ready to
 * receive the components a later Deploy puts in it.
 */
export async function createEmptyServerVersion(
  apiKey: string,
  gameId: string,
  name: string
): Promise<{ deploymentId: string; version: number }> {
  return createEdgeDeployment(apiKey, gameId, name);
}

// ─── Publish support: point the frontend at already-deployed components ───────

export interface MathsEndpoint {
  slug: string;
  url: string;
}

/**
 * Which Math Components of this project are already deployed for `gameId`, and
 * at what URL — keyed by COMPONENT NAME (e.g. "/#__maths__/SlotMaths").
 *
 * Resolution mirrors the public dispatcher rather than "highest version wins":
 * `rgs-fn` serves the newest ACTIVE row by created_at for a (game, slug) across
 * every version, so a component dropped from a later version stays live on its
 * older row. Picking the newest version's row instead would hand Publish a URL
 * that resolves to different code than the one it read.
 */
export async function mathsEndpointsForGame(
  apiKey: string,
  gameId: string,
  project: any
): Promise<Record<string, MathsEndpoint>> {
  const res = await fetch(`${XRGS_URL}/maths-deployer`, {
    method: 'POST',
    headers: rgsHeaders(apiKey),
    body: JSON.stringify({ action: 'list-edge-deployments', game_id: gameId })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && data.error) || `Could not read deployed components (HTTP ${res.status})`);
  }

  // Newest active row per slug, by created_at.
  const liveBySlug = new Map<string, { url: string; createdAt: string }>();
  for (const deployment of data.deployments || []) {
    for (const fn of deployment.functions || []) {
      if (fn.status !== 'active' || !fn.function_url) continue;
      const current = liveBySlug.get(fn.function_slug);
      if (!current || String(fn.created_at) > current.createdAt) {
        liveBySlug.set(fn.function_slug, { url: fn.function_url, createdAt: String(fn.created_at) });
      }
    }
  }

  const endpoints: Record<string, MathsEndpoint> = {};
  for (const component of listMathsComponents(project)) {
    const slug = mathsComponentSlug(component);
    const live = liveBySlug.get(slug);
    if (live) endpoints[component.name] = { slug, url: live.url };
  }
  return endpoints;
}

/**
 * Math Components that are USED by the frontend but have no deployed backend —
 * returned as component names.
 *
 * Publishing no longer compiles anything, so an instance with no endpoint to
 * point at is not extracted or replaced: it ships inside the UI bundle and its
 * maths runs in the player's browser. That is a real finding worth telling the
 * user about, and it is exactly this set — a component sitting undeployed in the
 * tree but never instantiated is simply unused, not a problem.
 */
export function undeployedMathsInstances(
  project: any,
  endpoints: Record<string, MathsEndpoint>
): string[] {
  const mathsNames = new Set(listMathsComponents(project).map((c: any) => c.name));
  const used = new Set<string>();

  for (const comp of project?.components || []) {
    // Instances inside a maths component are that component's own nesting, which
    // its deployed script already has inlined — not frontend usage.
    if (isMathsComponentName(comp?.name)) continue;
    (comp?.graph?.roots || []).forEach((root: any) =>
      root.forEach?.((node: any) => {
        if (node?.typename && mathsNames.has(node.typename)) used.add(node.typename);
      })
    );
  }

  return Array.from(used)
    .filter((name) => !endpoints[name])
    .sort();
}

/** A port carries a pulse rather than a value. */
function isSignalPort(port: any): boolean {
  const t = port?.type;
  return t === 'signal' || (!!t && t.name === 'signal');
}

/**
 * The instance-facing ports of a Math Component, with each port's type RESOLVED.
 *
 * `ComponentModel.getPorts()` is the editor's own answer to this question and the
 * only one that gets the types right. A gateway port has no type of its own: the
 * Component Inputs node stores `Do` as `type: '*'` no matter what it is wired to
 * (that is exactly what both component templates write), so getPorts() derives
 * each port's type from the port it CONNECTS TO inside the component —
 * `Multiplication.Do`, declared `signal` — and only falls back to the declared
 * type when there is no connection to learn from. Port NAMES are unaffected by
 * this: getPorts() keys them by the gateway port name verbatim, which is what the
 * generated script reads out of `ctx.config` and writes into its response.
 *
 * Reading the raw gateway `ports` array instead — what this used to do — made
 * every trigger look like a data field. `Do` came back as `'*'`, so the
 * Aggregator that replaces the instance at Publish got a `data-Do` input instead
 * of a `do-Do` one, and `doSend` is only ever reached from a `do-` input: the
 * published game had nothing that could make it POST, and its backend components
 * were never called. See the swap below.
 *
 * The raw scan survives as a fallback for anything that is not a live
 * ComponentModel (a fixture, a plain object parsed from JSON), where the declared
 * types are all there is to go on.
 */
function mathsComponentPorts(definition: any): any[] {
  const resolved = typeof definition?.getPorts === 'function' ? definition.getPorts() : null;
  if (resolved && resolved.length > 0) return resolved;

  // A gateway's own plug is the mirror of the instance's — Component Inputs
  // holds the component's INPUTS as `output` ports — so flip them onto the
  // instance-facing convention getPorts() returns.
  const roots = definition?.graph?.roots || [];
  const read = (typename: string, gatewayPlug: 'input' | 'output', instancePlug: 'input' | 'output') => {
    const node = roots.find((r: any) => r.typename === typename);
    const raw = [...(node?.ports || []), ...(node?.dynamicports || [])];
    return raw
      .filter((p: any) => p && typeof p.name === 'string' && (!p.plug || p.plug === gatewayPlug))
      .map((p: any) => ({ ...p, plug: instancePlug }));
  };

  return [
    ...read('Component Inputs', 'output', 'input'),
    ...read('Component Outputs', 'input', 'output')
  ];
}

/**
 * A Math Component's frontend contract, read off the component itself: which of
 * its ports carry data, which are triggers, which come back in the response, and
 * which are signals the response cannot carry.
 *
 * Exported because two places need the identical answer: Publish, swapping an
 * instance for an Aggregator, and the Maths Components panel's Deployed tree,
 * dragging a backend component straight into a graph. Both are the same node
 * calling the same endpoint, so both must derive its ports the same way.
 */
export function mathsComponentContract(definition: any): {
  dataInputs: string[];
  triggers: string[];
  outputs: string[];
  outputSignals: string[];
} {
  const ports = mathsComponentPorts(definition);
  const inputs = ports.filter((p: any) => p.plug === 'input');
  const outputs = ports.filter((p: any) => p.plug === 'output');

  return {
    dataInputs: inputs.filter((p: any) => !isSignalPort(p)).map((p: any) => p.name),
    triggers: inputs.filter(isSignalPort).map((p: any) => p.name),
    // A Component Outputs signal port ("Done") has no value in the response —
    // rgs-fn returns the data object only — so it is not an out-<field>. It is
    // answered by the Aggregator's own success/failure signals instead.
    outputs: outputs.filter((p: any) => !isSignalPort(p)).map((p: any) => p.name),
    outputSignals: outputs.filter(isSignalPort).map((p: any) => p.name)
  };
}

/**
 * Which of the Aggregator's two built-in signal outputs stands in for a
 * component signal output the response cannot carry.
 *
 * The component's own "Done"/"Success" pulse fires when its logic finishes; once
 * that logic is an HTTPS call, the moment the caller can actually observe is the
 * response arriving, which is the Aggregator's `success`. A port the author named
 * for failure is the one case where `failure` is the closer match — that is the
 * Aggregator's "the call did not come back" pulse, so anything wired to it still
 * runs on the error path rather than never running at all.
 */
const FAILURE_SIGNAL_NAME = /^(failure|failed|fail|error|on\s*error|reject)/i;

function aggregatorSignalFor(portName: string): 'success' | 'failure' {
  return FAILURE_SIGNAL_NAME.test(String(portName).trim()) ? 'failure' : 'success';
}

/**
 * The parameters that make an Aggregator node call one deployed Math Component.
 *
 * The three port lists are comma-joined strings because that is what the node's
 * `stringlist` inputs take, and the field names are the component's gateway port
 * names VERBATIM — the deployed script reads `config["<port name>"]`, so
 * humanising or camelCasing them would send keys it never looks at.
 *
 * `targetComponent` records which component the node stands in for. Publish's
 * repoint pass keys off it, and it is what tells a reader of the graph that this
 * Aggregator is a Math Component rather than a hand-wired HTTP call.
 */
export function mathsAggregatorParameters(args: {
  url: string;
  dataInputs: string[];
  triggers: string[];
  outputs: string[];
  targetComponent: string;
}): Record<string, string> {
  return {
    url: args.url,
    dataInputs: args.dataInputs.join(', '),
    triggers: args.triggers.join(', '),
    outputs: args.outputs.join(', '),
    targetComponent: args.targetComponent
  };
}

/**
 * Replaces every instance of an already-deployed Math Component, anywhere in
 * `copy`, with an Aggregator node pointed at that component's live endpoint.
 *
 * This is what makes Publish skip compilation for Math Components: the component
 * is ALREADY a backend, so the frontend needs a caller, not a rebuild. The
 * Aggregator is the existing caller — it POSTs `{ <data field>: value, is<X>:
 * true }` and fans the JSON response out over `out-<field>` ports, which is
 * precisely the deployed script's contract.
 *
 * Field names are the gateway port names verbatim, NOT camelCased: the script
 * reads `config["<port name>"]`.
 *
 * Runs on the compiled COPY before logic extraction, so `collectLogicRoots` never
 * sees these instances and cannot extract them a second time. Aggregator itself
 * is in the 'Cloud Functions' category, which that collector already treats as
 * already-backed-by-a-service and leaves alone.
 *
 * Returns how many instances were rewired, and which components produced an
 * Aggregator with no trigger wired to it — those are live endpoints that nothing
 * in the published UI can call, so the caller reports them rather than shipping a
 * game that silently never talks to its backend.
 */
export function swapDeployedMathsInstances(
  copy: any,
  endpoints: Record<string, MathsEndpoint>
): { swapped: number; untriggered: string[] } {
  if (!copy || Object.keys(endpoints).length === 0) return { swapped: 0, untriggered: [] };

  let swapped = 0;
  const untriggered = new Set<string>();

  for (const comp of copy.components || []) {
    // A maths component's own definition must keep its instances: it is not
    // being published as a frontend, and its deployed script already has them
    // inlined.
    if (isMathsComponentName(comp?.name)) continue;

    const graph = comp?.graph;
    if (!graph) continue;

    // Snapshot: the loop replaces roots as it goes.
    const instances = (graph.roots || []).filter((n: any) => endpoints[n?.typename]);

    // Labels are unique per graph, and two instances of the same component in one
    // visual component would otherwise both want the component's name.
    const takenLabels = new Set<string>();
    (graph.roots || []).forEach((n: any) => n.label && takenLabels.add(String(n.label)));
    const uniqueLabel = (base: string) => {
      let name = base;
      let i = 2;
      while (takenLabels.has(name)) name = `${base} ${i++}`;
      takenLabels.add(name);
      return name;
    };

    for (const instance of instances) {
      const endpoint = endpoints[instance.typename];
      const definition = copy.getComponentWithName?.(instance.typename);
      if (!definition) continue;

      const { dataInputs, triggers, outputs, outputSignals } = mathsComponentContract(definition);

      // Only the ports this instance is actually wired to matter; declaring the
      // rest would put dead ports on the node.
      const incoming = (graph.connections || []).filter((c: any) => c.toId === instance.id);
      const outgoing = (graph.connections || []).filter((c: any) => c.fromId === instance.id);
      const usedData = dataInputs.filter((p) => incoming.some((c: any) => c.toProperty === p));
      const usedTriggers = triggers.filter((p) => incoming.some((c: any) => c.toProperty === p));
      const usedOutputs = outputs.filter((p) => outgoing.some((c: any) => c.fromProperty === p));
      const usedSignals = outputSignals.filter((p) => outgoing.some((c: any) => c.fromProperty === p));

      // An Aggregator sends when a `do-` input pulses and at no other time, so an
      // instance with no trigger wired becomes a node that can never call its
      // endpoint. Record it — the deployed backend is fine, it is the UI that has
      // no way to reach it.
      if (usedTriggers.length === 0) untriggered.add(instance.typename);

      const aggId = guid();
      const aggNode = NodeGraphNode.fromJSON({
        id: aggId,
        type: 'Aggregator',
        x: instance.x,
        y: instance.y,
        label: uniqueLabel(mathsComponentDisplayName(definition)),
        // Only the ports this instance actually used, so the swap does not put
        // dead ports on the node — unlike a fresh drag, which has no connections
        // yet and declares the component's whole contract.
        parameters: mathsAggregatorParameters({
          url: endpoint.url,
          dataInputs: usedData,
          triggers: usedTriggers,
          outputs: usedOutputs,
          targetComponent: instance.typename
        }),
        ports: [],
        dynamicports: [
          ...usedData.map((f) => ({
            name: 'data-' + f,
            displayName: f,
            plug: 'input',
            type: { name: '*', allowConnectionsOnly: true },
            group: 'Data Inputs'
          })),
          ...usedTriggers.map((t) => ({
            name: 'do-' + t,
            displayName: 'Do ' + t,
            plug: 'input',
            type: 'signal',
            group: 'Triggers'
          })),
          ...usedOutputs.map((f) => ({
            name: 'out-' + f,
            displayName: f,
            plug: 'output',
            type: { name: '*', allowConnectionsOnly: true },
            group: 'Outputs'
          }))
        ],
        children: []
      } as any);

      graph.addRoot(aggNode);

      // Rewire: whatever fed a port of the instance now feeds the matching
      // aggregator port, and whatever read an output now reads out-<field>.
      incoming.forEach((c: any) => {
        const port = usedData.includes(c.toProperty)
          ? 'data-' + c.toProperty
          : usedTriggers.includes(c.toProperty)
            ? 'do-' + c.toProperty
            : null;
        if (!port) return;
        graph.addConnection({
          fromId: c.fromId,
          fromProperty: c.fromProperty,
          toId: aggId,
          toProperty: port
        });
      });
      // Several component signal outputs collapse onto the same two Aggregator
      // signals, so two of them wired to one target would otherwise become two
      // connections firing the same input twice per call.
      const signalEdges = new Set<string>();

      outgoing.forEach((c: any) => {
        if (usedOutputs.includes(c.fromProperty)) {
          graph.addConnection({
            fromId: aggId,
            fromProperty: 'out-' + c.fromProperty,
            toId: c.toId,
            toProperty: c.toProperty
          });
          return;
        }
        // A signal output has no response field to arrive on; the Aggregator's
        // own success/failure pulse is what the caller can observe instead.
        if (usedSignals.includes(c.fromProperty)) {
          const fromProperty = aggregatorSignalFor(c.fromProperty);
          const edge = `${fromProperty}>${c.toId}.${c.toProperty}`;
          if (signalEdges.has(edge)) return;
          signalEdges.add(edge);
          graph.addConnection({ fromId: aggId, fromProperty, toId: c.toId, toProperty: c.toProperty });
        }
      });

      // Removes the instance and, with it, its own connections.
      graph.removeNode(instance);
      swapped++;
    }
  }

  return { swapped, untriggered: Array.from(untriggered).sort() };
}

/**
 * Re-aims every Aggregator that stands in for a Math Component at that
 * component's CURRENT endpoint.
 *
 * Needed because an Aggregator can now be created long before it is published:
 * dragging a component out of the Deployed subsection drops one with the endpoint
 * baked in. A slug is derived from the component's path, so renaming or refiling
 * it afterwards moves the endpoint — and the node would go on calling the old
 * one, which stays live and serves the OLD code. That failure is silent and looks
 * exactly like the maths not having been updated.
 *
 * Keyed on `targetComponent`, the component name the Aggregator records, so it
 * only ever touches nodes that stand in for a Math Component; a hand-wired
 * Aggregator pointed at some other service has no such parameter and is left
 * alone. Only overwrites when there IS a current endpoint — an Aggregator whose
 * component is no longer deployed keeps its URL, which is still being served.
 *
 * Runs on the compiled COPY, after the instance swap (whose own Aggregators are
 * already correct, so they are a no-op here).
 */
export function repointMathsAggregators(
  copy: any,
  endpoints: Record<string, MathsEndpoint>
): number {
  if (!copy || Object.keys(endpoints).length === 0) return 0;

  let repointed = 0;

  for (const comp of copy.components || []) {
    (comp?.graph?.roots || []).forEach((root: any) =>
      root.forEach?.((node: any) => {
        if (node?.typename !== 'Aggregator') return;

        const target = node.parameters?.targetComponent;
        const endpoint = target ? endpoints[target] : undefined;
        if (!endpoint || node.parameters.url === endpoint.url) return;

        if (typeof node.setParameter === 'function') node.setParameter('url', endpoint.url);
        else node.parameters.url = endpoint.url;
        repointed++;
      })
    );
  }

  return repointed;
}
