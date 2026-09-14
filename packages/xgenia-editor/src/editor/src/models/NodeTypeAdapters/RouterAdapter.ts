import Utils from '../../utils/utils';
import { ComponentModel } from '../componentmodel';
import { NodeGraphModel } from '../nodegraphmodel';
import { ProjectModel } from '../projectmodel';
import NodeTypeAdapter from './NodeTypeAdapter';
import { NodeGraphNode } from '../nodegraphmodel/NodeGraphNode';

export class RouterAdapter extends NodeTypeAdapter {
  events: Record<string, any>;

  constructor() {
    super('Router');

    this.events = {
      componentRemoved: this.componentRemoved.bind(this),
      componentRenamed: this.componentRenamed.bind(this),
      componentDuplicated: this.componentDuplicated.bind(this),
      projectLoaded: this.evaluateRoutersHelath.bind(this),
      'nodeAdded.Router': this.evaluateRoutersHelath.bind(this),
      'parametersChanged.Router': this.parametersChanged.bind(this)
    };
  }

  componentRemoved(e: { model?: ComponentModel; undo?: any }) {
    if (!e || !e.model) {
      console.warn('[RouterAdapter] componentRemoved called with undefined event or model', e);
      return;
    }
    const componentName = e.model.name; // Use name, not fullName
    const routers = this.findAllNodes();

    routers.forEach((r: NodeGraphNode) => {
      const pages = r.parameters['pages'];
      if (pages && Array.isArray(pages.routes)) {
        const idx = pages.routes.indexOf(componentName);
        if (idx !== -1) {
          const _pages = JSON.parse(JSON.stringify(pages));
          _pages.routes.splice(idx, 1);
          if (_pages.startPage === componentName) {
            _pages.startPage = _pages.routes.length > 0 ? _pages.routes[0] : undefined;
          }
          r.setParameter('pages', _pages, { undo: e.undo });
        }
      }
    });
  }

  componentRenamed(e: { model?: ComponentModel; oldName?: string; undo?: any }) {
    if (!e || !e.model || !e.oldName) {
      console.warn('[RouterAdapter] componentRenamed called with undefined event or invalid arguments', e);
      return;
    }
    const before = e.oldName;
    const after = e.model.name; // Use name, not fullName

    // Note: No need to handle undo here as it will simply revert back to a new rename
    // Find all routers that have this component in it's routes and rename
    const routers = this.findAllNodes();

    routers.forEach((r) => {
      const pages = r.parameters['pages'];
      if (pages !== undefined && pages.routes !== undefined) {
        const idx = pages.routes.indexOf(before);
        if (idx !== -1) {
          const _pages = JSON.parse(JSON.stringify(pages));
          _pages.routes[idx] = after;
          if (_pages.startPage === before) _pages.startPage = after;

          r.setParameter('pages', _pages);
        }
      }
    });
  }

  componentDuplicated(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.duplicate || !e.source) {
      console.warn('[RouterAdapter] componentDuplicated called with undefined event or missing properties', e);
      return;
    }
    
    // Is the duplicate a page
    const pages = e.duplicate.getNodesWithType('Page');
    if (pages !== undefined && pages.length > 0) {
      // Find all routers that have the original page and
      // add the duplicate to them
      const source = e.source.fullName;
      const duplicate = e.duplicate.fullName;

      const routers = this.findAllNodes();

      routers.forEach((r) => {
        const pages = r.parameters['pages'];
        if (pages !== undefined && pages.routes !== undefined) {
          const idx = pages.routes.indexOf(source);
          if (idx !== -1) {
            const _pages = JSON.parse(JSON.stringify(pages));
            _pages.routes.push(duplicate);

            r.setParameter('pages', _pages, { undo: e.undo });
          }
        }
      });
    }
  }

  evaluateRoutersHelath() {
    const routers = this.findAllNodes();

    // Check routers for name, and assign them one if they don't have one
    routers.forEach((r) => {
      if (r.parameters['name'] === undefined || r.parameters['name'] === '') {
        const routerNames = routers.map((r) => r.parameters.name);

        let name;

        //Check if the name "Main" is free
        if (routerNames.includes('Main') === false) {
          name = 'Main';
        } else {
          //Assign a name like "Router X"
          let i = 0;

          do {
            name = 'Router ' + i;
            i++;
          } while (routerNames.includes(name));
        }

        r.setParameter('name', name);
      }
    });
  }

  parametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.model || !e.args) {
      console.warn('[RouterAdapter] parametersChanged called with undefined event or missing properties', e);
      return;
    }
    
    const node = e.model;

    if (e.args.name === 'pages') {
      const pages = node.parameters['pages'];
      if (pages !== undefined) {
        if (pages.startPage === undefined) {
          e.args.undo !== undefined &&
            e.args.undo.pushAndDo({
              do: () => {
                pages.startPage = pages.routes[0];
              },
              undo: () => {
                pages.startPage = undefined;
              }
            });
        }
      }
    }

    this.evaluateRoutersHelath();
  }

  /** Nodes of `typename` in `component`, matching either spelling of the type. See getPageComponents(). */
  static findNodesOfType(component, typename: string) {
    const nodes = [];
    if (!component || !component.graph) return nodes;

    component.graph.forEachNode((node) => {
      if (node.typename === typename || (node.type && node.type.name === typename)) {
        nodes.push(node);
      }
    });

    return nodes;
  }

  static getPageInfoForComponents(components) {
    const pageInfo = [];
    components.forEach((c) => {
      const _c = ProjectModel.instance.getComponentWithName(c);
      if (_c === undefined) return;

      const pages = RouterAdapter.findNodesOfType(_c, 'Page');
      if (pages === undefined || pages.length === 0) return;

      const page = pages[0];
      let title = page.parameters['title'];
      if (title === undefined) {
        const titleParts = c.split('/');
        title = titleParts[titleParts.length - 1];
      }
      let urlPath = page.parameters['urlPath'] || title.replace(/\s+/g, '-').toLowerCase();

      const pageInputs = RouterAdapter.findNodesOfType(_c, 'PageInputs');
      const pathParams = [];
      pageInputs.forEach((pi) => {
        if (pi.parameters['pathParams'])
          pi.parameters['pathParams'].split(',').forEach((p) => pathParams.indexOf(p) === -1 && pathParams.push(p));
      });

      pathParams.forEach((p) => {
        if (urlPath.indexOf('{' + p + '}') === -1) urlPath = urlPath + '/{' + p + '}';
      });

      pageInfo.push({
        path: urlPath,
        title: title,
        component: c
      });
    });

    return pageInfo;
  }

  static addPageToRouters(routerName, pageName, args) {
    const routers = ProjectModel.instance.getNodesWithType('Router');
    routers.forEach((r) => {
      if ((r.parameters['name'] || 'Main') === (routerName || 'Main')) {
        // Add this page to the router
        const pages = JSON.parse(JSON.stringify(r.getParameter('pages') || {}));
        if (pages.routes === undefined) pages.routes = [];
        pages.routes.push(pageName);

        r.setParameter('pages', pages, { undo: args.undo });
      }
    });
  }

  /**
   * Page components that no router in the project references.
   *
   * A page in no router cannot be reached at all — it does not route, it does not show up
   * in the top bar's page list, and nothing renders it. This is the normal state after the
   * router that owned a page is deleted (deleting a Router takes its whole route list with
   * it) or after a page component is created outside the "new page" flow, and it used to be
   * invisible: the only place that listed these pages was a popup behind "Add new page".
   */
  static getPagesNotInAnyRouter(): string[] {
    const claimed = new Set<string>();

    ProjectModel.instance.getNodesWithType('Router').forEach((r) => {
      const pages = r.parameters['pages'];
      if (pages && Array.isArray(pages.routes)) {
        pages.routes.forEach((c: string) => claimed.add(c));
      }
    });

    return RouterAdapter.getPageComponents().filter((c) => !claimed.has(c));
  }

  static getRouterNames() {
    const routers = ProjectModel.instance.getNodesWithType('Router');

    const _routers = [];
    routers.forEach((r) => {
      if (_routers.indexOf(r.parameters['name'] || 'Main') === -1) _routers.push(r.parameters['name'] || 'Main');
    });

    return _routers;
  }

  static getPageComponents() {
    // Walk the components rather than mapping Page nodes back up through graph -> owner.
    //
    // The two "find nodes of this type" helpers in the codebase do not agree:
    // ProjectModel.getNodesWithType() matches on `node.typename` (the raw string off the
    // project file) while ComponentModel.getNodesWithType() matches on `node.type.name`
    // (the type resolved against the node library). A component that has not been opened
    // this session can answer one and not the other, and this list is the only way an
    // existing page can be attached to a router — if it comes back short, that page is
    // simply unreachable from the Pages editor. Accept either spelling.
    const componentNames: string[] = [];

    ProjectModel.instance.forEachComponent((c) => {
      if (!c || !c.graph) return;

      let hasPage = false;
      c.graph.forEachNode((node) => {
        if (node.typename === 'Page' || (node.type && node.type.name === 'Page')) {
          hasPage = true;
        }
      });

      if (hasPage) componentNames.push(c.name);
    });

    return componentNames;
  }

  static createPageComponent(componentName) {
    const component = new ComponentModel({
      name: componentName,
      graph: NodeGraphModel.fromJSON(JSON.parse(JSON.stringify(_pageTemplate))),
      id: Utils.guid()
    });

    component.rekeyAllIds();

    return component;
  }
}

const _pageTemplate = {
  connections: [],
  roots: [
    {
      id: 'xxx',
      type: 'Page',
      x: 0,
      y: 0,
      parameters: {},
      ports: [],
      dynamicports: [],
      children: []
    },
    {
      id: 'yyy',
      type: 'PageInputs',
      x: -100,
      y: -50,
      parameters: {},
      ports: [],
      dynamicports: [],
      children: []
    }
  ]
};
