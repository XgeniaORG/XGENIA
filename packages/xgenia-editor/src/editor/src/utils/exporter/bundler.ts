import { ComponentModel } from '@xgenia-models/componentmodel';
import { getRouterComponents } from './router';
import { getNodesWithType } from './util';

function getComponentStackComponents(allComponents: TSFixme) {
  const navigationStacks = getNodesWithType('Page Stack', allComponents);

  const pageComponents = navigationStacks.flatMap((stack) => {
    if (!stack.parameters.pages) return [];

    return stack.parameters.pages
      .map((page) => stack.parameters['pageComp-' + page.id])
      .map((componentName) => allComponents.find((c) => c.name === componentName));
  });

  return pageComponents.filter((c) => c !== undefined);
}

export function getComponentIndex(rootComponent: ComponentModel, allComponents: ComponentModel[]) {
  console.log('[bundler] getComponentIndex called with:', {
    rootComponent: rootComponent?.name,
    allComponentsCount: allComponents.length,
    allComponentNames: allComponents.map(c => c.name)
  });
  
  const componentStackRoots = getComponentStackComponents(allComponents);
  const pages = getRouterComponents(allComponents);

  const roots = [rootComponent].concat(pages).concat(componentStackRoots);
  console.log('[bundler] Bundle roots:', roots.map(r => r?.name));

  const bundles = _calculateBundles(roots, allComponents);
  console.log('[bundler] Calculated bundles:', bundles.map(b => ({
    componentCount: b.components.length,
    components: b.components,
    dependencyCount: b.dependencies.length
  })));
  
  const index: TSFixme = {};

  // Some components will not be reached by the dependency search:
  //   - dynamic for each nodes where the component name is generated in code
  //   - unused components
  // Add an extra bundle that contains all of them
  const discoveredComponents = bundles.map((b) => b.components).flat();
  console.log('[bundler] Discovered components:', discoveredComponents);

  if (discoveredComponents.length !== allComponents.length) {
    const remainingComponents = allComponents.map((c) => c.name).filter((c) => !discoveredComponents.includes(c));
    console.log('[bundler] Remaining components not in bundles:', remainingComponents);

    bundles.push({
      components: remainingComponents,
      dependencies: []
    });
  }

  //convert from bundles and dependencies from indices to names so it's easier to modify
  //without having to re-calculate all indices
  for (let i = 0; i < bundles.length; i++) {
    index['b' + i] = {
      components: bundles[i].components,
      dependencies: bundles[i].dependencies.map((d) => 'b' + d)
    };
  }

  console.log('[bundler] Final component index:', index);
  return index;
}

export function removeBundlesFromIndex(componentIndex: TSFixme, bundlesToRemove: TSFixme) {
  for (const name of bundlesToRemove) {
    delete componentIndex[name];
  }

  //and remove them as dependencies from other bundles
  for (const name of bundlesToRemove) {
    for (const bundle in componentIndex) {
      componentIndex[bundle].dependencies = componentIndex[bundle].dependencies.filter((d) => d !== name);
    }
  }
}

export function _collectDependencyGraph(root: ComponentModel, allComponents: ComponentModel[]) {
  console.log('[bundler] _collectDependencyGraph starting for root:', root.name);
  const graph = {};

  function collect(node) {
    console.log('[bundler] Collecting dependencies for component:', node.comp.name);
    let nodeCount = 0;
    let forEachCount = 0;
    
    node.comp.graph.forEachNode((n) => {
      nodeCount++;
      //follow component instances and for each nodes
      let dep;
      if (n.type instanceof ComponentModel) {
        dep = n.type;
        console.log('[bundler] Found component instance dependency:', dep.name);
      } else if (n.type.name === 'For Each' && n.parameters.template && n.parameters.templateType !== 'dynamic') {
        forEachCount++;
        dep = allComponents.find((c) => c.name === n.parameters.template);
        console.log('[bundler] Found ForEach template dependency:', {
          template: n.parameters.template,
          templateType: n.parameters.templateType,
          foundComponent: !!dep
        });
      } else if (n.type.name === 'For Each') {
        forEachCount++;
        console.log('[bundler] Skipped ForEach node:', {
          template: n.parameters.template,
          templateType: n.parameters.templateType,
          reason: n.parameters.templateType === 'dynamic' ? 'dynamic template' : 'no template'
        });
      } else if (n.type.name === 'NavigationShowPopup' && n.parameters.target) {
        dep = allComponents.find((c) => c.name === n.parameters.target);
        console.log('[bundler] Found NavigationShowPopup dependency:', dep?.name);
      }

      if (dep && !node.deps.find((d) => d.comp === dep)) {
        console.log('[bundler] Adding dependency:', dep.name);
        if (graph[dep.name]) {
          node.deps.push(graph[dep.name]);
        } else {
          graph[dep.name] = { comp: dep, deps: [] };
          node.deps.push(graph[dep.name]);

          collect(graph[dep.name]);
        }
      }
    });
    
    console.log('[bundler] Component', node.comp.name, 'has', nodeCount, 'nodes,', forEachCount, 'ForEach nodes, and', node.deps.length, 'dependencies');
  }

  const node = {
    comp: root,
    deps: []
  };

  collect(node);

  return node;
}

export function _flattenDependencyGraph(root: TSFixme) {
  const components = new Set();

  function depthFirst(node) {
    if (!components.has(node.comp)) {
      components.add(node.comp);
      node.deps.forEach(depthFirst);
    }
  }

  depthFirst(root);

  return Array.from(components);
}

export function getFirstLevelDependencyMap(rootGraphs) {
  const firstLevelDeps = new Map();

  function storeDeps(node) {
    if (firstLevelDeps.has(node.comp)) return;
    firstLevelDeps.set(node.comp, node.deps);
    node.deps.forEach(storeDeps);
  }

  for (const graph of rootGraphs) {
    storeDeps(graph);
  }

  return firstLevelDeps;
}

export function _calculateBundles(roots: ComponentModel[], allComponents: ComponentModel[]) {
  //calculate a dependency graph for every root
  const rootGraphs = roots.map((root) => _collectDependencyGraph(root, allComponents));

  //flatten all the root graphs so we get one array per root
  //that has ALL dependencies at all levels in just a flat array
  const componentArrays = rootGraphs.map((graph) => _flattenDependencyGraph(graph));

  //Create a map, where every components is marked with what root it's used by
  // Example with 3 roots and 4 components
  // compA: [0,1] (compA is used by root 0 and 1)
  // compB: [0,1] (compB is used by root 0 and 1)
  // compC: [2] (compC is used by root 2)
  // compD: [0,1,2] (compD is used by all roots)
  const map = new Map<TSFixme, TSFixme>();
  for (let i = 0; i < componentArrays.length; i++) {
    const components = componentArrays[i];

    for (const c of components) {
      if (!map.has(c)) {
        map.set(c, [i]);
      } else if (map.get(c).includes(i) === false) {
        map.get(c).push(i);
      }
    }
  }

  // Extract bundles from the set of root indices that each component use
  // "0,1": [compA, compB]
  // "2": [compC]
  // "0,1,2": [compD]
  const b = new Map<TSFixme, TSFixme>();
  for (const [key, value] of map.entries()) {
    const flag = value.join(',');
    if (!b.has(flag)) b.set(flag, new Set());

    b.get(flag).add(key);
  }

  // Now loose the key in the map from the previous step so we're just left with a
  // list of bundles
  // [ [compA, compB], [compC], [compD] ]
  const bundles = Array.from(b.values()).map((componentSet) => Array.from(componentSet));

  //now we have bundles with unique components in each. One bundle can depend on components
  //from another bundle, so let's calculate what those are so the viewer can prefetch
  //all bundles at once in parallel
  //this will create bundles like the following:
  // [
  //   {components: [compA, compB], dependencies: [2]}] //bundle 0
  //   {components: [compC], dependencies: [2]}] //bundle 1
  //   {components: [compD], dependencies: []}] //bundle 2
  //]

  //create a map that maps a components to a list of its direct dependencies (first level of dependencies)
  const firstLevelDependencies = getFirstLevelDependencyMap(rootGraphs);

  const bundlesWithDependencies = bundles.map((comps, i) => {
    //get one level of dependencies for all components in this bundle
    let oneLevelDeps = comps.flatMap((c) => firstLevelDependencies.get(c)).filter((x) => !!x);

    //feed components through a set set so we get rid of duplicates
    oneLevelDeps = Array.from(new Set(oneLevelDeps).values());

    //get indices for all bundles that the components belong to
    const bundleIndices = new Set(oneLevelDeps.map((node) => bundles.findIndex((b) => b.includes(node.comp))));

    //and we'll likely get components that belong to the current bundle, so remove it since it's not a dependency
    bundleIndices.delete(i);

    return {
      // @ts-expect-error
      components: comps.map((c) => c.name), //return the name, not the entire component
      dependencies: Array.from(bundleIndices.values())
    };
  });

  return bundlesWithDependencies;
}
