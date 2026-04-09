import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { type Warning, WarningsModel } from '@xgenia-models/warningsmodel';

import { ProjectModel } from '../projectmodel';
import NodeTypeAdapter from './NodeTypeAdapter';

export class RouterNavigateAdapter extends NodeTypeAdapter {
  events: Record<string, any>;

  constructor() {
    super('RouterNavigate');
    console.log('[RouterNavigateAdapter] Constructor called');

    this.events = {
      'nodeAdded.RouterNavigate': this.navigateNodeAdded.bind(this),
      'nodeAdded.Router': this.updateAllRouterPorts.bind(this),
      'nodeRemoved.Router': this.updateAllRouterPorts.bind(this),
      projectLoaded: this.updateAllRouterPorts.bind(this),
      'parametersChanged.RouterNavigate': this.updateRouterPorts.bind(this),
      'parametersChanged.PageInputs': this.updateAllRouterPorts.bind(this),
      'parametersChanged.Router': this.routerParametersChanged.bind(this) //update if a router name has changed
    };
    console.log('[RouterNavigateAdapter] Events registered:', Object.keys(this.events));
  }

  updatePortsForNode(node: NodeGraphNode) {
    console.log('[RouterNavigateAdapter] updatePortsForNode called for node:', node.id, 'type:', node.typename);
    const ports = [];

    const routers = ProjectModel.instance.getNodesWithType('Router').filter((r) => r.parameters['name'] !== undefined);
    console.log('[RouterNavigateAdapter] Filtered routers with names:', routers.length);

    if (routers.length > 1) {
      ports.push({
        plug: 'input',
        type: {
          name: 'enum',
          enums: routers.map((r) => ({ label: r.parameters['name'], value: r.parameters['name'] })),
          allowEditOnly: true
        },
        group: 'General',
        displayName: 'Router',
        name: 'router'
      });
      console.log('[RouterNavigateAdapter] Added Router port');
    }

    let routerName = node.parameters['router'];
    if (routerName === undefined && routers.length > 0) {
      // No router selected, just pick the first one
      routerName = routers[0].parameters['name'];
      node.setParameter('router', routerName);
      console.log('[RouterNavigateAdapter] Set default router:', routerName);
    }

    // Router is selected find all pages and show in pages enum
    const pageComponents = [];
    routers
      .filter((r) => r.parameters['name'] === routerName)
      .forEach((r) => {
        if (r.parameters['pages'] !== undefined && r.parameters['pages'].routes !== undefined) {
          r.parameters['pages'].routes.forEach((pc) => {
            if (pageComponents.indexOf(pc) === -1) pageComponents.push(pc);
          });
        }
      });

    console.log('[RouterNavigateAdapter] Page components found:', pageComponents.length);
    console.log('[RouterNavigateAdapter] Page components:', pageComponents);

    // Only add Target Page port if there are page components available
    if (pageComponents.length > 0) {
      ports.push({
        plug: 'input',
        type: { name: 'component', title: 'Choose page component', components: pageComponents, allowEditOnly: true },
        group: 'General',
        displayName: 'Target Page',
        name: 'target'
      });
      console.log('[RouterNavigateAdapter] Added Target Page port');
    } else {
      console.log('[RouterNavigateAdapter] No page components found, skipping Target Page port');
    }

    if (node.parameters['target'] !== undefined) {
      const component = ProjectModel.instance.getComponentWithName(node.parameters['target']);
      if (component !== undefined) {
        const pageInputs = component.getNodesWithType('PageInputs');
        if (pageInputs !== undefined) {
          const uniqueNames = {};

          // 1. Get parameters from PageInputs nodes
          pageInputs.forEach((pi) => {
            if (pi.parameters['pathParams'] !== undefined)
              pi.parameters['pathParams'].split(',').forEach((p) => {
                const trimmed = p.trim();
                if (trimmed) uniqueNames[trimmed] = true;
              });
            if (pi.parameters['queryParams'] !== undefined)
              pi.parameters['queryParams'].split(',').forEach((p) => {
                const trimmed = p.trim();
                if (trimmed) uniqueNames[trimmed] = true;
              });
          });

          // 2. AUTO-SYNC: Also get parameters from the Page node in the target component
          const pageNodes = component.getNodesWithType('Page');
          pageNodes.forEach((pageNode) => {
            const urlPath = pageNode.parameters['urlPath'];
            if (typeof urlPath === 'string') {
              const matches = urlPath.match(/\{([^}]+)\}/g);
              if (matches) {
                matches.forEach((m) => {
                  const varName = m.replace('{', '').replace('}', '').trim();
                  if (varName) uniqueNames[varName] = true;
                });
              }
            }
          });

          Object.keys(uniqueNames).forEach((inputName) => {
            ports.push({
              name: 'pm-' + inputName,
              displayName: inputName,
              type: 'string',
              plug: 'input',
              group: 'Parameters'
            });
          });
          console.log('[RouterNavigateAdapter] Added parameter ports:', Object.keys(uniqueNames));
        }
      }
    }

    this.evaluateHealth(node, pageComponents);

    console.log('[RouterNavigateAdapter] Setting dynamic ports:', ports.length, 'ports');
    node.setDynamicPorts(ports);
    console.log('[RouterNavigateAdapter] Dynamic ports set successfully');
  }

  evaluateHealth(node, pageComponents) {
    const target = node.parameters['target'];

    const hasValidTarget = target && pageComponents.includes(target);

    const warning: Warning =
      hasValidTarget === false
        ? {
            message: "The target page doesn't belong to the target router",
            level: 'error',
            showGlobally: true
          }
        : undefined;

    const componentModel = node.owner.owner;
    WarningsModel.instance.setWarning(
      { component: componentModel, node, key: 'routernav-target-not-in-router' },
      warning
    );
  }

  navigateNodeAdded(e) {
    console.log('[RouterNavigateAdapter] navigateNodeAdded called');
    // Safety check: e can be undefined when called during project load
    if (!e || !e.args || !e.args.model) {
      console.warn('[RouterNavigateAdapter] navigateNodeAdded called with undefined event or model', e);
      return;
    }
    this.updatePortsForNode(e.args.model);
  }

  updateRouterPorts(e) {
    console.log('[RouterNavigateAdapter] updateRouterPorts called');
    // Safety check: e can be undefined when called during project load
    if (!e || !e.model) {
      console.warn('[RouterNavigateAdapter] updateRouterPorts called with undefined event or model', e);
      return;
    }
    this.updatePortsForNode(e.model);
  }

  updateAllRouterPorts() {
    console.log('[RouterNavigateAdapter] updateAllRouterPorts called');
    // We need to update all navigation nodes
    const navigateNodes = this.findAllNodes();
    console.log('[RouterNavigateAdapter] Found navigate nodes:', navigateNodes.length);
    navigateNodes.forEach((node) => {
      this.updatePortsForNode(node);
    });
  }

  routerParametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.args) {
      console.warn('[RouterNavigateAdapter] routerParametersChanged called with undefined event or args', e);
      return;
    }
    
    // The name of a router has changed, update all navigate nodes with that name
    // No need for an undo here, the value will just changed back when the router renamed is "undone"
    if (e.args.name === 'name' && e.args.oldValue !== e.args.value) {
      const navigateNodes = this.findAllNodes();
      navigateNodes.forEach((node) => {
        if (node.parameters['router'] === e.args.oldValue) {
          node.parameters['router'] = e.args.value;
        }
      });
    }

    this.updateAllRouterPorts();
  }

  // Test method to manually trigger port generation for debugging
  testUpdatePortsForNode(nodeId: string) {
    console.log('[RouterNavigateAdapter] Testing updatePortsForNode for node:', nodeId);
    const navigateNodes = this.findAllNodes();
    const node = navigateNodes.find((n) => n.id === nodeId);
    if (node) {
      console.log('[RouterNavigateAdapter] Found node, updating ports');
      this.updatePortsForNode(node);
    } else {
      console.log('[RouterNavigateAdapter] Node not found');
    }
  }
}
