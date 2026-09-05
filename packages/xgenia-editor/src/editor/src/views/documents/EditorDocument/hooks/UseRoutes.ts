import { useEffect, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { getIndexedPages } from '@xgenia-utils/compilation/context/pages';
import { NodeGraphTraverser, TraverseNode } from '@xgenia-utils/node-graph-traverser';

import { EventDispatcher } from '../../../../../../shared/utils/EventDispatcher';
import type { RouteInfo } from '../../../EditorTopbar/topbar/topbarCommands';


/**
 * Number of nodes in the component that owns a page, or undefined when the
 * component cannot be resolved. Used by the status pill to show page "weight".
 */
function countNodes(projectModel: ProjectModel, componentName?: string): number | undefined {
  if (!componentName) return undefined;
  const c = projectModel.getComponentWithName(componentName);
  if (!c?.graph?.forEachNode) return undefined;
  let n = 0;
  c.graph.forEachNode(() => {
    n++;
  });
  return n;
}

/**
 * Every route the top bar can navigate to, with the page title, owning component and
 * node count alongside each path.
 *
 * This replaced a `useRoutes` hook that returned bare path strings. Nothing consumes
 * bare paths any more — the status pill needs the titles and counts to render its page
 * list — so that hook was removed rather than left as a second, silently diverging
 * definition of "the project's routes".
 */
export function useRouteInfos(projectModel: ProjectModel, eventDispatcher: EventDispatcher): RouteInfo[] {
  const [infos, setInfos] = useState<RouteInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function update() {
      const pages = await getIndexedPages(projectModel, {
        expandPaths: async (route) => [{ title: route.title, path: route.current.path, meta: {} }]
      });

      if (cancelled) return;

      const { navigationPathType } = projectModel.getSettings();
      const prefix = navigationPathType === undefined || navigationPathType === 'hash' ? '/#' : '';

      const list: RouteInfo[] = pages.map((p) => ({
        path: prefix + p.path,
        title: p.title || p.path,
        componentName: p.componentName,
        nodeCount: countNodes(projectModel, p.componentName)
      }));

      // Page Stack Proxy Path routes. `useRoutes` has always included these
      // (pageRoutes.concat(getComponentStackComponents())) and the old route dropdown
      // listed them; the pill is now the ONLY way to reach a route from the bar, so
      // dropping them here would make those pages unreachable.
      for (const path of getComponentStackComponents()) {
        const full = prefix + path;
        if (!list.some((r) => r.path === full)) {
          list.push({ path: full, title: 'Page stack' });
        }
      }

      list.sort((a, b) => a.path.localeCompare(b.path));

      // The literal root. EditorDocument has always prepended '/' to the route list
      // (`['/'].concat(useRoutes(...))`); a project whose entry page is not itself
      // indexed still has to be reachable. Kept first rather than sorted in.
      if (!list.some((r) => r.path === '/' || r.path === prefix + '/' || r.path === prefix)) {
        list.unshift({ path: '/', title: 'Root' });
      }

      setInfos(list);
    }

    // 'Model.nodeAdded'/'Model.nodeRemoved' fire once per node, and update()
    // re-traverses every component graph — coalesce the bursts.
    function scheduleUpdate() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        update();
      }, 250);
    }

    update();

    const group = {};
    eventDispatcher.on(
      ['Model.componentAdded', 'Model.componentRemoved', 'Model.nodeAdded', 'Model.nodeRemoved'],
      scheduleUpdate,
      group
    );
    eventDispatcher.on(
      'Model.parametersChanged',
      (event) => {
        const t = event.model?.typename;
        if (t === 'Page' || t === 'Router' || t === 'Page Stack') {
          scheduleUpdate();
        }
      },
      group
    );
    projectModel.on('settingsChanged', update, group);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      eventDispatcher.off(group);
      projectModel.off(group);
    };
  }, [eventDispatcher, projectModel]);

  return infos;
}

function getComponentStackComponents() {
  const traverser = new NodeGraphTraverser(ProjectModel.instance, (node) => node.typename === 'Page Stack Proxy Path', {
    traverseComponentStacks: true
  });

  const componentStacks: TraverseNode[] = traverser.filter((node) => node.node.typename === 'Page Stack Proxy Path');

  const fullRoutes = componentStacks
    .map((node) => {
      const parentsAndSelf = node.parents(traverser.selector).reverse();
      parentsAndSelf.push(node);

      return (
        '/' +
        parentsAndSelf
          .map((n) => n.node.parameters.route)
          .filter((r) => !!r)
          .join('/')
      );
    })
    .filter((r) => !!r && r !== '/');

  return Array.from(new Set(fullRoutes));
}
