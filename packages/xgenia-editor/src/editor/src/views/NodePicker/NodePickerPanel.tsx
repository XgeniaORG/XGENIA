import React from 'react';
import { useNodePickerContext } from './NodePicker.context';
import { NodePicker } from './NodePicker';
import { NodeGraphContextTmp } from '../../contexts/NodeGraphContext/NodeGraphContext';

/**
 * Simple wrapper panel to host NodePicker in the left side panel area.
 * It queries the active NodeGraph and passes the required props through.
 */
export function NodePickerPanel() {
  const nodeGraph = NodeGraphContextTmp.nodeGraph;
  const model = nodeGraph?.model;
  const runtimeType = nodeGraph?.runtimeType;

  // Position is not used by side panel; pass a neutral value
  const pos = { x: 0, y: 0 } as const;

  if (!nodeGraph || !model) {
    return null;
  }

  return (
    <NodePicker
      model={model}
      parentModel={undefined}
      pos={pos}
      attachToRoot={true}
      runtimeType={runtimeType}
    />
  );
} 