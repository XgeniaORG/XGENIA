import NodeTypeAdapter from './NodeTypeAdapter';

export class PageInputsAdapter extends NodeTypeAdapter {
  events: Record<string, any>;
  _copyParamsScheduled: boolean;

  constructor() {
    super('PageInputs');

    this.events = {
      'nodeAdded.PageInputs': this.nodeAdded.bind(this),
      'nodeAdded.Page': this.updateAllNodes.bind(this),
      projectLoaded: this.updateAllNodes.bind(this),
      'parametersChanged.PageInputs': this.parametersChanged.bind(this),
      'parametersChanged.Page': this.pageParametersChanged.bind(this)
    };
  }

  pageParametersChanged(e) {
    if (e.args && e.args.name === 'urlPath') {
      this.updateAllNodes(e);
    }
  }

  updatePortsForNode(node) {
    const ports = [];

    const uniqueNames = {};

    if (node.parameters['pathParams'] !== undefined) {
      node.parameters['pathParams'].split(',').forEach((p) => {
        const trimmed = p.trim();
        if (trimmed) uniqueNames[trimmed] = true;
      });
    }

    if (node.parameters['queryParams'] !== undefined) {
      node.parameters['queryParams'].split(',').forEach((p) => {
        const trimmed = p.trim();
        if (trimmed) uniqueNames[trimmed] = true;
      });
    }

    // Auto-sync from sibling Page node
    const graph = node.owner;
    if (graph) {
      let pageNode;
      graph.forEachNode((n) => {
        if (n.typename === 'Page' || n.type?.name === 'Page') {
          pageNode = n;
          return true; // Stop iteration
        }
      });

      const urlPath = pageNode?.parameters?.urlPath;
      if (typeof urlPath === 'string') {
        const matches = urlPath.match(/\{([^}]+)\}/g);
        if (matches) {
          matches.forEach((m) => {
            const varName = m.replace('{', '').replace('}', '').trim();
            if (varName) uniqueNames[varName] = true;
          });
        }
      }
    }

    Object.keys(uniqueNames).forEach((outputName) => {
      ports.push({
        name: 'pm-' + outputName,
        displayName: outputName,
        type: '*',
        plug: 'output',
        group: 'Parameters'
      });
    });

    node.setDynamicPorts(ports);
  }

  nodeAdded(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.args || !e.args.model) {
      console.warn('[PageInputsAdapter] nodeAdded called with undefined event or model', e);
      return;
    }
    
    const node = e.args.model;

    const component = node.owner?.owner;
    if (component !== undefined) {
      const pageInputs = component.getNodesWithType('PageInputs');
      for (const pi of pageInputs) {
        if (pi !== node) {
          node.parameters['queryParams'] = pi.parameters['queryParams'];
          node.parameters['pathParams'] = pi.parameters['pathParams'];
          break;
        }
      }
    }

    this.updatePortsForNode(node);
  }

  parametersChanged(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.model) {
      console.warn('[PageInputsAdapter] parametersChanged called with undefined event or model', e);
      return;
    }
    
    const node = e.model;

    if (this._copyParamsScheduled) return;
    this._copyParamsScheduled = true;

    // Copy parameters from this node to all other to keep in sync
    const component = node.owner.owner;
    if (component !== undefined) {
      const pageInputs = component.getNodesWithType('PageInputs');
      pageInputs.forEach((pi) => {
        if (pi !== node) {
          pi.setParameter('queryParams', node.parameters['queryParams'], { undo: e.args.undo });
          pi.setParameter('pathParams', node.parameters['pathParams'], { undo: e.args.undo });
        }

        this.updatePortsForNode(pi);
      });
    }

    this._copyParamsScheduled = false;
  }

  updateAllNodes(e) {
    // We need to update all navigation nodes
    const pageInputs = this.findAllNodes();
    pageInputs.forEach((node) => {
      this.updatePortsForNode(node);
    });
  }
}
