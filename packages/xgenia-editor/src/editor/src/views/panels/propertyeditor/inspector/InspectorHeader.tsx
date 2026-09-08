import React, { useEffect, useRef, useState } from 'react';
import { platform } from '@xgenia/platform';

import { useKeyboardCommands } from '@xgenia-hooks/useKeyboardCommands';
import { Keybindings } from '@xgenia-constants/Keybindings';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';
import getDocsEndpoint from '@xgenia-utils/getDocsEndpoint';
import { tracker } from '@xgenia-utils/tracker';

import { GlassPopover } from '../../../EditorTopbar/topbar/GlassPopover';
import { ToastLayer } from '../../../ToastLayer/ToastLayer';
import { ModelProxy } from '../models/modelProxy';
import { NodeGraphNodeDelete, NodeGraphNodeRename } from '../nodeActions';

import css from './Inspector.module.scss';

export interface InspectorHeaderProps {
  node: NodeGraphNode;
  model: ModelProxy;
  /** Port names the node carries an explicit value for. Drives "Reset all". */
  changedNames: string[];
  /** Structural refresh after a bulk reset. */
  onChanged: () => void;
}

/**
 * The node's identity, and everything you can do to the node itself.
 *
 * The old header spent three always-visible 35px buttons on docs, rename and delete —
 * a third of the panel's width on actions taken once in a session, above a list where
 * horizontal room is the scarce thing. They live behind the overflow now; rename is
 * still a double-click on the name, which is how it was already usually reached.
 */
export function InspectorHeader({ node, model, changedNames, onChanged }: InspectorHeaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLButtonElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [isOverflowOpen, setIsOverflowOpen] = useState(false);

  useEffect(() => {
    const group = {};
    node.on('labelChanged', () => setLabel(node.label), group);
    return () => {
      node.off(group);
    };
  }, [node]);

  // A different node arrives in the same mounted header when the selection changes.
  useEffect(() => {
    setLabel(node.label);
    setIsEditing(false);
    setIsOverflowOpen(false);
  }, [node]);

  function beginRename() {
    setIsEditing(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  function commitRename() {
    if (!isEditing) return;
    setIsEditing(false);
    const trimmed = label.trim();
    // An empty name would leave an unidentifiable node in the graph.
    if (trimmed === '' || trimmed === node.label) {
      setLabel(node.label);
      return;
    }
    NodeGraphNodeRename(node, trimmed);
    setLabel(node.label);
  }

  function openDocs() {
    if (!node.type?.docs) return;
    const url = node.type.docs.replace('https://docsapp.xgenia.com', getDocsEndpoint());
    tracker.track('Open Node Docs Clicked', { url });
    platform.openExternal(url);
  }

  /**
   * Clears every explicitly set parameter as ONE undo entry. Doing it as N entries
   * would make getting back a mistaken reset an N-press job.
   */
  function resetAll() {
    setIsOverflowOpen(false);
    if (changedNames.length === 0) return;

    const undo = new UndoActionGroup({ label: 'reset properties' });
    changedNames.forEach((name) => {
      model.setParameter(name, undefined, { undo, label: 'reset parameter' });
    });
    UndoQueue.instance.push(undo);
    onChanged();
    ToastLayer.showSuccess(
      `Reset ${changedNames.length} ${changedNames.length === 1 ? 'property' : 'properties'}`
    );
  }

  useKeyboardCommands(() => [
    { handler: () => openDocs(), keybinding: Keybindings.PROPERTY_PANEL_OPEN_DOCS.hash },
    {
      handler: () => {
        if (!isEditing) beginRename();
      },
      keybinding: Keybindings.PROPERTY_PANEL_EDIT_LABEL.hash
    }
  ]);

  return (
    <div className={css.Header}>
      <div className={css.HeaderIdentity}>
        {isEditing ? (
          <input
            ref={inputRef}
            className={css.HeaderNameInput}
            value={label}
            spellCheck={false}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setLabel(node.label);
                setIsEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={css.HeaderName}
            title={`${label} — double-click to rename`}
            onDoubleClick={beginRename}
          >
            {label}
          </button>
        )}
        {/* An unnamed node's label IS its type name; printing it twice says nothing. */}
        {label !== node.typename && (
          <span className={css.HeaderType} title={node.typename}>
            {node.typename}
          </span>
        )}
      </div>

      <button
        ref={overflowRef}
        type="button"
        className={css.HeaderOverflow}
        title="More node actions"
        aria-haspopup="menu"
        aria-expanded={isOverflowOpen}
        onClick={() => setIsOverflowOpen((open) => !open)}
      >
        <span aria-hidden="true">⋯</span>
      </button>

      <GlassPopover
        triggerRef={overflowRef}
        isVisible={isOverflowOpen}
        onClose={() => setIsOverflowOpen(false)}
        width={216}
      >
        <div className={css.Menu} role="menu">
          <button
            type="button"
            className={css.MenuItem}
            role="menuitem"
            onClick={() => {
              setIsOverflowOpen(false);
              beginRename();
            }}
          >
            Rename<span className={css.MenuHint}>{Keybindings.PROPERTY_PANEL_EDIT_LABEL.label}</span>
          </button>

          {Boolean(node.type?.docs) && (
            <button
              type="button"
              className={css.MenuItem}
              role="menuitem"
              onClick={() => {
                setIsOverflowOpen(false);
                openDocs();
              }}
            >
              Open docs<span className={css.MenuHint}>{Keybindings.PROPERTY_PANEL_OPEN_DOCS.label}</span>
            </button>
          )}

          <button
            type="button"
            className={css.MenuItem}
            role="menuitem"
            disabled={changedNames.length === 0}
            onClick={resetAll}
          >
            {/*
              No count here on purpose. This clears PARAMETERS, while the All/Changed
              segment counts ROWS, and one row can own eight parameters — the margin
              and padding widget does. Two numbers for two different units, side by
              side, would read as a contradiction. The toast below says what happened.
            */}
            Reset all
          </button>

          <div className={css.MenuSeparator} />

          <button
            type="button"
            className={css.MenuItem}
            data-destructive="true"
            role="menuitem"
            onClick={() => {
              setIsOverflowOpen(false);
              NodeGraphNodeDelete(node);
            }}
          >
            Delete node<span className={css.MenuHint}>{Keybindings.PROPERTY_PANEL_DELETE.label}</span>
          </button>
        </div>
      </GlassPopover>
    </div>
  );
}
