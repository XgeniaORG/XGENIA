import React, { useMemo } from 'react';

import { NodeGraphContextTmp } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import { DescribedRow } from './model/portRowMeta';
import { AI_SWEEP_WINDOW_MS, ParamAuthors, isFreshWrite } from './paramAuthors';
import { LegacyPortHost } from './LegacyPortHost';

import css from './Inspector.module.scss';

export interface PortRowProps {
  row: DescribedRow;
  /** The real node, not the proxy — connections live on the graph, not on a state. */
  node: NodeGraphNode;
}

interface ConnectionSource {
  nodeId: string;
  label: string;
  property: string;
}

/**
 * Who feeds this port. A connected port's value field is inert — whatever it shows is
 * overwritten at runtime — so the row says where the value actually comes from
 * instead of leaving the user to hunt for the wire.
 */
function findConnectionSource(node: NodeGraphNode, portName: string): ConnectionSource | null {
  const graph: TSFixme = node && (node as TSFixme).owner;
  if (!graph || !Array.isArray(graph.connections)) return null;

  for (const connection of graph.connections) {
    if (connection.toId !== node.id || connection.toProperty !== portName) continue;
    const fromNode = graph.findNodeWithId ? graph.findNodeWithId(connection.fromId) : undefined;
    return {
      nodeId: connection.fromId,
      // A node with no label falls back to its type name, which is what the graph
      // itself draws on the node body.
      label: (fromNode && (fromNode.label || fromNode.typename)) || connection.fromId,
      property: connection.fromProperty
    };
  }
  return null;
}

/** Selects the source node in the graph, which also swings the inspector onto it. */
function jumpToSource(nodeId: string) {
  const graph: TSFixme = NodeGraphContextTmp.nodeGraph;
  if (!graph || typeof graph.findNodeWithId !== 'function') return;
  const editorNode = graph.findNodeWithId(nodeId);
  if (editorNode) graph.selectNode(editorNode);
}

/**
 * One row: the legacy editor, plus the things the redesign added around it.
 *
 * The reset affordance is deliberately NOT re-implemented here. Every port template
 * already carries a `.property-changed-dot` that resets through the undo queue and
 * calls the view's own `resetToDefault`; the stylesheet turns it into the hover
 * button the design asks for. A second reset path in React would be a second set of
 * undo semantics to keep in step with the first.
 */
export function PortRow({ row, node }: PortRowProps) {
  const source = useMemo(
    () => (row.isConnected && !row.isGroupLike ? findConnectionSource(node, row.name) : null),
    // `row` is rebuilt whenever connections change, so this is as live as the row is.
    [row, node]
  );

  const write = row.isGroupLike ? undefined : ParamAuthors.getWrite(node.id, row.name);
  const isAiAuthored = write !== undefined && write.author === 'ai';
  const isFresh = isAiAuthored && isFreshWrite(write);

  return (
    <div
      className={css.Row}
      data-port={row.name || undefined}
      data-changed={!row.isDefault || undefined}
      data-connected={row.isConnected || undefined}
      data-ai={isAiAuthored || undefined}
      data-group-like={row.isGroupLike || undefined}
      style={isFresh ? ({ ['--sweep-duration' as TSFixme]: `${AI_SWEEP_WINDOW_MS}ms` } as React.CSSProperties) : undefined}
    >
      {isAiAuthored && (
        <span
          // Keyed on the write's timestamp so a second AI write inside the sweep
          // window restarts the animation. The key stays on this span rather than on
          // the row: remounting the row would tear down and rebuild the legacy editor
          // inside it, losing focus and selection mid-edit.
          key={write.at}
          className={css.AuthorGlyph}
          data-fresh={isFresh || undefined}
          title="Last changed by the AI assistant"
        />
      )}

      <LegacyPortHost view={row.view} />

      {source !== null && (
        <button
          type="button"
          className={css.ConnectedChip}
          title={`Driven by ${source.label}.${source.property} — click to jump there`}
          onClick={() => jumpToSource(source.nodeId)}
        >
          <span className={css.ConnectedChipLabel}>{source.label}</span>
        </button>
      )}
    </div>
  );
}
