import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import NodeTypeAdapter from './NodeTypeAdapter';

export class ControlsAdapter extends NodeTypeAdapter {
  events: Record<string, any>;

  constructor(nodeType: string) {
    super(nodeType);

    this.events = {
      [`nodeAdded.${nodeType}`]: this.nodeAdded.bind(this)
    };
  }

  updatePortsForNode(node: NodeGraphNode) {
    // Get existing ports
    const existingPorts = node.getPorts() || [];

    // Add common action ports for controls
    const commonPorts = [];

    // For buttons, add Click event output port
    if (node.typename === 'net.xgenia.controls.button') {
      commonPorts.push({
        name: 'onClick',
        displayName: 'Click',
        group: 'Events',
        plug: 'output',
        type: { name: 'signal' }
      });
    }

    // For textinputs, add text changed event and value output
    if (node.typename === 'net.xgenia.controls.textinput') {
      commonPorts.push({
        name: 'onTextChanged',
        displayName: 'Text Changed',
        group: 'Events',
        plug: 'output',
        type: { name: 'signal' }
      });

      commonPorts.push({
        name: 'text',
        displayName: 'Text',
        group: 'Properties',
        plug: 'output',
        type: { name: 'string' }
      });
    }

    // For dropdown, add changed event and value
    if (node.typename === 'Dropdown') {
      commonPorts.push({
        name: 'onChange',
        displayName: 'Value Changed',
        group: 'Events',
        plug: 'output',
        type: { name: 'signal' }
      });

      commonPorts.push({
        name: 'value',
        displayName: 'Value',
        group: 'Properties',
        plug: 'output',
        type: { name: 'string' }
      });
    }

    // Add the ports if they don't already exist
    const combinedPorts = [...existingPorts];
    for (const port of commonPorts) {
      if (!existingPorts.some((p) => p.name === port.name)) {
        combinedPorts.push(port);
      }
    }

    // Set the dynamic ports
    node.setDynamicPorts(combinedPorts);
  }

  nodeAdded(e) {
    // Safety check: e can be undefined when called during project load
    if (!e || !e.args || !e.args.model) {
      console.warn('[ControlsAdapter] nodeAdded called with undefined event or model', e);
      return;
    }
    this.updatePortsForNode(e.args.model);
  }
}
