import React from 'react';

import type { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import inspectorCss from '../panels/propertyeditor/inspector/Inspector.module.scss';
import css from './MultiSelectionPanel.module.scss';

export const MULTI_SELECTION_PANEL_ID = 'MultiSelection';

export interface MultiSelectionPanelProps {
  nodes: NodeGraphNode[];
  onPick: (node: NodeGraphNode) => void;
}

/**
 * What the right-hand panel shows while several nodes are selected. It used to close, which
 * widened the preview and re-flowed the game under the pointer the moment a second element was
 * Shift-clicked. There is no multi-node property editing, so this says what is selected and
 * lets you pick one to edit; moving, aligning and distributing them happen in the preview.
 */
export function MultiSelectionPanel({ nodes, onPick }: MultiSelectionPanelProps) {
  return (
    <div className={css.Root}>
      <div className={inspectorCss.Header}>
        <div className={inspectorCss.HeaderIdentity}>
          <span className={inspectorCss.HeaderName}>{nodes.length} selected</span>
          <span className={inspectorCss.HeaderType}>Move, align and distribute them in the preview</span>
        </div>
      </div>
      <div className={css.List} role="list">
        {nodes.map((node) => (
          <button key={node.id} type="button" role="listitem" className={css.Row} onClick={() => onPick(node)} title="Edit this node's properties">
            <span className={css.Label}>{node.label || node.typename}</span>
            <span className={css.Type}>{(node.type as { displayName?: string } | undefined)?.displayName || node.typename}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
