// What is deployed, what has changed since — the model behind the Maths
// Components panel's Deployed / Changed / Commits subsections.
//
// The panel is Source Control for Math Components, so it needs the same two facts
// git does: what the remote holds, and how the working copy differs from it. Both
// are answerable because a deploy stores the AUTHORED graph next to the compiled
// script (`game_edge_functions.project_json`) — that column exists for exactly
// this, and this module is its first reader.
//
//   remote       = the components of the selected Server Version, each with its
//                  stored project_json
//   working copy = the project's `/#__maths__/` tree right now
//   status       = added / modified / deleted / unchanged, per component
//
// The comparison is the editor's own `diffProject`, the same engine the Version
// Control panel uses for git — so "changed" means here what it means there.

import { diffProject } from '@xgenia-utils/projectmerger.diff';

import { downloadEdgeDeployment } from './deployEdgeFunction';
import {
  listMathsComponents,
  mathsComponentDisplayName,
  mathsComponentSlug
} from './deployMathsComponents';

/** How a component differs from the version deployed in the Server Version. */
export type MathsChangeKind = 'added' | 'modified' | 'deleted' | 'unchanged';

/** One component as the platform currently holds it. */
export interface DeployedComponent {
  slug: string;
  functionName: string;
  /** The public `/rgs-fn/<game>/<slug>` endpoint, apikey included. */
  url: string;
  /**
   * The authored graph as deployed — `project_json`'s copy of the component.
   *
   * Null for a component deployed before that column existed, or one produced by
   * the old whole-project Compile path, which had no authored counterpart to
   * store. Those cannot be compared against anything, which is a different thing
   * from being unchanged — see `comparable`.
   */
  component: any | null;
}

export interface MathsComponentStatus {
  /** Endpoint identity: the path below `/#__maths__/`, slugified. */
  slug: string;
  /** "Adder / Add with 5" — what the panel shows. */
  displayName: string;
  /** Full local component name, or null when it only exists on the platform. */
  componentName: string | null;
  kind: MathsChangeKind;
  /** Live endpoint URL, present whenever the component is deployed. */
  url?: string;
  /** False when the deployed row stored no authored graph, so nothing could be compared. */
  comparable: boolean;
}

export interface MathsStatus {
  all: MathsComponentStatus[];
  /** Keyed by local component name — how the Deployed tree badges its rows. */
  byComponentName: Map<string, MathsComponentStatus>;
  /** added | modified | deleted, in display order. What the Changed tab lists. */
  changed: MathsComponentStatus[];
  /** The authored graph of each deployed component, by slug — the diff's "before" side. */
  deployedBySlug: Map<string, DeployedComponent>;
  /**
   * For each modified component, the annotated graph `diffProject` produced —
   * every node and connection carrying `annotation` ('Created' / 'Changed' /
   * 'Deleted') and `diffData.parent`. That is precisely what
   * ComponentDiffDocument renders, so clicking a Changed row can show the same
   * side-by-side graph the Version Control panel shows for git. Keyed by slug.
   */
  annotatedBySlug: Map<string, any>;
}

/**
 * Drop the fields that change without the graph changing.
 *
 * Child node positions are the only one: `ProjectModel.save` strips them on the
 * way to disk (stripNodeChildPositions), so a component deployed from memory and
 * then reloaded from disk differs by exactly those keys and nothing else. Without
 * this, every component would read as modified the first time the project was
 * reopened.
 */
function stripChildPositions(componentJson: any): void {
  const recurse = (node: any) => {
    if (!node?.children) return;
    for (const child of node.children) {
      delete child.x;
      delete child.y;
      recurse(child);
    }
  };
  (componentJson?.graph?.roots || []).forEach(recurse);
}

/**
 * One side of the comparison, keyed by slug.
 *
 * `diffProject` keys components by `id || name`, and neither is the right
 * identity here: the ENDPOINT is what a deployed component is, and its identity
 * is the slug. Renaming a component changes its slug, which genuinely does mean
 * the old endpoint is abandoned and a new one appears — keying by slug makes the
 * list say that (one deleted, one added) instead of hiding it as a modification.
 * The id goes for the same reason: it is not what the platform is keyed on.
 */
function forComparison(componentJson: any, slug: string): any {
  const copy = JSON.parse(JSON.stringify(componentJson));
  delete copy.id;
  copy.name = slug;
  stripChildPositions(copy);
  return copy;
}

/** An empty project shell `diffProject` can walk, holding just these components. */
function projectOf(components: any[]) {
  return { name: 'maths', components, variants: [], settings: {}, metadata: {} };
}

/**
 * The component a deployed row's `project_json` was built from.
 *
 * `buildComponentProjectJson` writes the component FIRST and its nested
 * dependencies after it, and stamps the name it used in
 * `metadata.xgeniaMathsComponent.componentName`. Prefer that stamp — a document
 * hand-edited or re-ordered elsewhere would otherwise hand back a dependency.
 */
function componentFromProjectJson(projectJson: any): any | null {
  const components = projectJson?.components;
  if (!Array.isArray(components) || components.length === 0) return null;

  const stamped = projectJson?.metadata?.xgeniaMathsComponent?.componentName;
  if (stamped) {
    const hit = components.find((c: any) => c?.name === stamped);
    if (hit) return hit;
  }
  return components[0];
}

/** The selected Server Version's components, as the platform holds them. */
export async function readDeployedComponents(
  apiKey: string,
  deploymentId: string
): Promise<DeployedComponent[]> {
  const bundle = await downloadEdgeDeployment(apiKey, deploymentId);
  return (bundle.functions || []).map((fn) => ({
    slug: fn.function_slug,
    functionName: fn.function_name || fn.function_slug,
    url: fn.function_url,
    component: componentFromProjectJson(fn.project_json)
  }));
}

/**
 * Compare the project's Math Components against what is deployed.
 *
 * A component with no deployed counterpart is `added`; one deployed but no longer
 * in the tree is `deleted`; the rest are `modified` or `unchanged` by graph.
 *
 * A deployed component with no stored `project_json` — deployed before that
 * column existed — is reported `modified`, with `comparable: false` so the UI can
 * say WHY rather than implying an edit nobody made. Erring the other way would be
 * worse than a false positive: it would report the component as matching
 * something we never read, and, now that Deploy only pushes what changed, leave
 * the user unable to deploy it at all. This one clears itself — the deploy it
 * prompts stores the graph, and every comparison after that is real.
 */
export function computeMathsStatus(project: any, deployed: DeployedComponent[]): MathsStatus {
  const locals = listMathsComponents(project);

  const localBySlug = new Map<string, any>();
  locals.forEach((c: any) => localBySlug.set(mathsComponentSlug(c), c));

  const deployedBySlug = new Map<string, DeployedComponent>();
  deployed.forEach((d) => deployedBySlug.set(d.slug, d));

  const base: any[] = [];
  const current: any[] = [];
  deployed.forEach((d) => {
    if (d.component) base.push(forComparison(d.component, d.slug));
  });
  localBySlug.forEach((component, slug) => {
    current.push(forComparison(component.toJSON(), slug));
  });

  const diff = diffProject(projectOf(base), projectOf(current));
  // `name` is the slug on both sides (see forComparison).
  const annotatedBySlug = new Map<string, any>();
  diff.components.changed.forEach((c: any) => annotatedBySlug.set(c.name, c));
  const modifiedSlugs = new Set<string>(annotatedBySlug.keys());

  const all: MathsComponentStatus[] = [];

  localBySlug.forEach((component, slug) => {
    const live = deployedBySlug.get(slug);
    const comparable = !!live?.component;
    const kind: MathsChangeKind = !live
      ? 'added'
      : !comparable || modifiedSlugs.has(slug)
        ? 'modified'
        : 'unchanged';

    all.push({
      slug,
      displayName: mathsComponentDisplayName(component),
      componentName: component.name,
      kind,
      url: live?.url,
      comparable
    });
  });

  deployedBySlug.forEach((live, slug) => {
    if (localBySlug.has(slug)) return;
    all.push({
      slug,
      displayName: live.functionName || slug,
      componentName: null,
      kind: 'deleted',
      url: live.url,
      comparable: !!live.component
    });
  });

  all.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const byComponentName = new Map<string, MathsComponentStatus>();
  all.forEach((s) => {
    if (s.componentName) byComponentName.set(s.componentName, s);
  });

  return {
    all,
    byComponentName,
    changed: all.filter((s) => s.kind !== 'unchanged'),
    deployedBySlug,
    annotatedBySlug
  };
}

/** Read the platform and compare in one step — what the panel calls on refresh. */
export async function loadMathsStatus(
  apiKey: string,
  deploymentId: string,
  project: any
): Promise<MathsStatus> {
  return computeMathsStatus(project, await readDeployedComponents(apiKey, deploymentId));
}

/** An empty status — what the panel shows before a Server Version is selected. */
export function emptyMathsStatus(): MathsStatus {
  return {
    all: [],
    byComponentName: new Map(),
    changed: [],
    deployedBySlug: new Map(),
    annotatedBySlug: new Map()
  };
}
