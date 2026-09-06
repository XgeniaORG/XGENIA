import React, { useEffect } from 'react';

import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { SidebarModel } from '@xgenia-models/sidebar';
import { SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { performNodeDoubleClick } from './doubleClickAction';
import { Inspector } from './inspector/Inspector';
import { MCPPropertyPanel } from './MCPPropertyPanel';

// The legacy port templates still render every value editor, so their stylesheets
// still apply. The inspector's own module reaches into these class names to restyle
// them; loading them here keeps that override order intact.
require('../../../styles/propertyeditor/propertyeditor.css');
require('../../../styles/propertyeditor/futuristic-propertyeditor.css');

export { NodeGraphNodeDelete, NodeGraphNodeRename } from './nodeActions';

export interface PropertyEditorProps {
  model: NodeGraphNode;
}

export function PropertyEditor(props: PropertyEditorProps) {
  useEffect(() => {
    const group = {};

    SidebarModel.instance.on(
      SidebarModelEvent.receivedCommand,
      (panelId: string, command: string, args: TSFixme) => {
        if (panelId !== 'PropertyEditor') return;
        if (command === 'doubleClick') performNodeDoubleClick(args.model);
      },
      group
    );

    return () => {
      SidebarModel.instance.off(group);
    };
  }, []);

  if (!props.model) {
    console.warn('PropertyEditor: No model provided');
    return null;
  }

  const isMCPNode = props.model.typename === 'MCP Tool' || Boolean(props.model.parameters?.serverName);
  if (isMCPNode) {
    // No `onUpdated`: it used to re-render the legacy jQuery panel, which was never
    // mounted for an MCP node in the first place.
    return <MCPPropertyPanel model={props.model} />;
  }

  // Keyed on the node so switching selection gives a clean inspector rather than one
  // that has to unpick the previous node's ports, proxy and collapse state.
  return <Inspector key={props.model.id} node={props.model} />;
}
