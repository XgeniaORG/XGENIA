import { useNodeGraphContext } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { ComponentModel } from '@xgenia-models/componentmodel';
import { EditorSceneVisibility, type SceneVisibility } from '@xgenia-models/editorSceneVisibility';
import type { NodeGraphModel } from '@xgenia-models/nodegraphmodel';
import { SidebarModel, SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { SearchInput } from '@xgenia-core-ui/components/inputs/SearchInput';
import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';
import type { NodeGraphEditor } from '../../nodegrapheditor';
import { usePanelActive } from '../useIsActivePanel';
import css from './HierarchyPanel.module.scss';
import { CaretIcon, EyeIcon, EyeOffIcon, LockIcon, UnlockIcon } from './HierarchyIcons';
import { type DropPosition, dropPositionForOffset, resolveDrop } from './hierarchyDrop';
import { applyHierarchyDrop, canAcceptChild, snapshotGraph } from './hierarchyOps';
import { sameSelection, selectionForClick } from './hierarchySelection';
import {
  ancestorIds,
  defaultExpanded,
  type FlatRow,
  flattenHierarchy,
  type HierarchyItem,
  indexTree,
  soloToggle
} from './hierarchyTree';
import { useVirtualRows } from './useVirtualRows';

export const HierarchyPanel_ID = 'hierarchy';

const ROW_HEIGHT = 24;
const INDENT = 14;
const DRAG_MIME = 'application/x-xgenia-hierarchy-node';
const SNAPSHOT_DEBOUNCE_MS = 40;
/** Catches selection changes that announce nothing (marquee, duplicate, AI edits). */
const SELECTION_POLL_MS = 300;

const EMPTY_SET: ReadonlySet<string> = new Set();

// Which rows are open, per component, for the session. Module-level so it outlives the panel
// component (hot reload of the host, project switches back and forth).
const expansionByComponent = new Map<string, Set<string>>();
let sessionVisualOnly = false;

/**
 * Hierarchy: the active component's nodes as a tree, Unity-style. Selection mirrors the node
 * graph; the eye and lock drive EditorSceneVisibility (Edit view only, never the game); rows
 * drag to reparent and reorder through the same model calls as the graph's own drag.
 */
export function HierarchyPanel() {
  const { nodeGraph } = useNodeGraphContext();
  const isActive = usePanelActive();

  const component = useActiveComponent(nodeGraph);
  const graph = useComponentGraph(component);
  const items = useGraphSnapshot(graph, isActive);
  const visibility = useSceneVisibility(graph, isActive);
  const [selectedIds, setSelectedIds] = useGraphSelection(nodeGraph, isActive);

  const [query, setQuery] = useState('');
  const [visualOnly, setVisualOnly] = useState(sessionVisualOnly);
  const componentKey = component ? component.id || component.name : null;
  const [expanded, updateExpanded] = useExpansion(componentKey, items);

  const hiddenSet = useMemo(() => new Set(visibility.hidden), [visibility]);
  const lockedSet = useMemo(() => new Set(visibility.locked), [visibility]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const treeIndex = useMemo(() => indexTree(items), [items]);

  const rows = useMemo(
    () => flattenHierarchy(items, { expanded, query, visualOnly, hidden: hiddenSet, locked: lockedSet }),
    [items, expanded, query, visualOnly, hiddenSet, lockedSet]
  );

  const list = useVirtualRows(rows.length, ROW_HEIGHT);

  // ---- selection --------------------------------------------------------------------------
  const anchorRef = useRef<string | null>(null);
  /** The last selection this panel sent, so its own clicks do not scroll the list. */
  const sentSelectionRef = useRef<string[] | null>(null);

  const applySelection = useCallback(
    (ids: string[]) => {
      if (!nodeGraph) return;
      sentSelectionRef.current = ids;
      if (ids.length === 0) {
        nodeGraph.clearSelection();
      } else if (ids.length === 1) {
        // Selects the node in the graph, which opens its Properties and moves the gizmo.
        EventDispatcher.instance.emit('inspectNodes', { nodeIds: ids });
      } else {
        EventDispatcher.instance.emit('viewportSelectNodes', { nodeIds: ids });
      }
      setSelectedIds(ids);
    },
    [nodeGraph, setSelectedIds]
  );

  const onRowClick = useCallback(
    (event: React.MouseEvent, id: string) => {
      const result = selectionForClick(
        rows.map((r) => r.id),
        selectedIds,
        anchorRef.current,
        id,
        { range: event.shiftKey, toggle: event.metaKey || event.ctrlKey }
      );
      anchorRef.current = result.anchor;
      if (sameSelection(result.ids, selectedIds) && result.ids.length === 1) return;
      applySelection(result.ids);
    },
    [rows, selectedIds, applySelection]
  );

  const onRowDoubleClick = useCallback(
    (id: string) => {
      // Centre the node in the graph (switchToComponent with a node selects and pans to it).
      const node = graph?.findNodeWithId(id);
      if (node && component && nodeGraph) nodeGraph.switchToComponent(component, { node });
    },
    [graph, component, nodeGraph]
  );

  // Selection changed elsewhere (graph, preview, AI): open its ancestors and scroll to it.
  const lastSeenSelectionRef = useRef<string[]>([]);
  const revealPendingRef = useRef(false);
  useEffect(() => {
    if (sameSelection(lastSeenSelectionRef.current, selectedIds)) return;
    lastSeenSelectionRef.current = selectedIds;
    const fromPanel = sentSelectionRef.current !== null && sameSelection(sentSelectionRef.current, selectedIds);
    sentSelectionRef.current = null;
    revealPendingRef.current = !fromPanel && selectedIds.length > 0;
  }, [selectedIds]);

  useEffect(() => {
    if (!revealPendingRef.current) return;
    // A node added a moment ago is selected before the debounced snapshot has it: wait for it.
    const known = selectedIds.filter((id) => treeIndex.has(id));
    if (known.length === 0) return;
    const missing = new Set<string>();
    for (const id of known) for (const a of ancestorIds(treeIndex, id)) if (!expanded.has(a)) missing.add(a);
    if (missing.size > 0) {
      updateExpanded((set) => missing.forEach((a) => set.add(a)));
      return; // reveal on the render that has the rows open
    }
    revealPendingRef.current = false;
    const index = rows.findIndex((r) => selectedSet.has(r.id));
    if (index !== -1) list.reveal(index); // -1: filtered out by the search or "Visual only"
  }, [selectedIds, selectedSet, treeIndex, expanded, rows, updateExpanded, list.reveal]);

  // ---- expansion --------------------------------------------------------------------------
  const toggleExpanded = useCallback(
    (event: React.MouseEvent, row: FlatRow) => {
      event.stopPropagation();
      revealPendingRef.current = false; // the user is steering the tree now
      const opening = !row.isExpanded;
      // Alt-click opens or closes the whole subtree.
      const ids = event.altKey ? subtreeIds(treeIndex.get(row.id)?.item) : [row.id];
      updateExpanded((set) => ids.forEach((id) => (opening ? set.add(id) : set.delete(id))));
    },
    [treeIndex, updateExpanded]
  );

  // ---- eye / lock -------------------------------------------------------------------------
  const targetsFor = useCallback(
    (row: FlatRow): string[] => {
      // Toggling a row that is part of a multi-selection toggles every selected visual node.
      if (selectedSet.has(row.id) && selectedIds.length > 1) {
        return selectedIds.filter((id) => treeIndex.get(id)?.item.isVisual);
      }
      return [row.id];
    },
    [selectedSet, selectedIds, treeIndex]
  );

  const onEyeClick = useCallback(
    (event: React.MouseEvent, row: FlatRow) => {
      event.stopPropagation();
      if (event.altKey) {
        const { hide, show } = soloToggle(items, row.id, hiddenSet);
        if (hide.length) EditorSceneVisibility.setHidden(hide, true);
        if (show.length) EditorSceneVisibility.setHidden(show, false);
        return;
      }
      EditorSceneVisibility.setHidden(targetsFor(row), !row.isHidden);
    },
    [items, hiddenSet, targetsFor]
  );

  const onLockClick = useCallback(
    (event: React.MouseEvent, row: FlatRow) => {
      event.stopPropagation();
      EditorSceneVisibility.setLocked(targetsFor(row), !row.isLocked);
    },
    [targetsFor]
  );

  // ---- drag and drop ----------------------------------------------------------------------
  const dragIdRef = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: DropPosition } | null>(null);

  const canAccept = useCallback(
    (parentId: string, childId: string) => canAcceptChild(graph, parentId, childId),
    [graph]
  );

  const resolveAt = useCallback(
    (event: React.DragEvent<HTMLElement>, row: FlatRow) => {
      const dragged = dragIdRef.current;
      if (!dragged) return null;
      const rect = event.currentTarget.getBoundingClientRect();
      const position = dropPositionForOffset(event.clientY - rect.top, rect.height, canAccept(row.id, dragged));
      return { position, result: resolveDrop(items, dragged, row.id, position, canAccept) };
    },
    [items, canAccept]
  );

  const onDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>, row: FlatRow) => {
      if (!graph || nodeGraph?.readOnly) {
        event.preventDefault();
        return;
      }
      dragIdRef.current = row.id;
      event.dataTransfer.setData(DRAG_MIME, row.id);
      event.dataTransfer.effectAllowed = 'move';
    },
    [graph, nodeGraph]
  );

  const onDragOver = useCallback(
    (event: React.DragEvent<HTMLElement>, row: FlatRow) => {
      const resolved = resolveAt(event, row);
      if (!resolved) return; // not one of our rows being dragged
      if (resolved.result.ok) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropTarget((prev) =>
          prev && prev.id === row.id && prev.position === resolved.position ? prev : { id: row.id, position: resolved.position }
        );
      } else {
        event.dataTransfer.dropEffect = 'none';
        setDropTarget((prev) => (prev ? null : prev));
      }
    },
    [resolveAt]
  );

  const endDrag = useCallback(() => {
    dragIdRef.current = null;
    setDropTarget(null);
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLElement>, row: FlatRow) => {
      const dragged = dragIdRef.current;
      const resolved = resolveAt(event, row);
      endDrag();
      if (!dragged || !resolved || !resolved.result.ok || !graph) return;
      event.preventDefault();
      applyHierarchyDrop(graph, nodeGraph, dragged, resolved.result);
    },
    [resolveAt, endDrag, graph, nodeGraph]
  );

  // Scroll while dragging near the top or bottom edge.
  const onListDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      if (!dragIdRef.current) return;
      const el = list.scrollRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (event.clientY < rect.top + ROW_HEIGHT) el.scrollTop -= 8;
      else if (event.clientY > rect.bottom - ROW_HEIGHT) el.scrollTop += 8;
    },
    [list.scrollRef]
  );

  // ---- render -----------------------------------------------------------------------------
  const visibleRows = rows.slice(list.start, list.end);

  let emptyText: string | null = null;
  if (!component) emptyText = 'No component open';
  else if (items.length === 0) emptyText = 'No nodes yet';
  else if (rows.length === 0) emptyText = query ? 'No matches' : 'No visual nodes';

  return (
    <BasePanel
      title="Hierarchy"
      isFill
      headerSlot={
        <button
          type="button"
          className={classNames(css.Chip, visualOnly && css.ChipActive)}
          aria-pressed={visualOnly}
          title="Show only nodes the preview draws"
          onClick={() => {
            sessionVisualOnly = !visualOnly;
            setVisualOnly(!visualOnly);
          }}
        >
          Visual only
        </button>
      }
    >
      <div className={css.Root}>
        <div className={css.Toolbar}>
          <SearchInput placeholder="Filter nodes" value={query} onChange={setQuery} UNSAFE_style={{ height: 30 }} />
        </div>

        <div
          ref={list.scrollRef}
          className={css.List}
          role="tree"
          aria-label="Component hierarchy"
          aria-multiselectable="true"
          onDragOver={onListDragOver}
        >
          {emptyText ? (
            <div className={css.Empty}>{emptyText}</div>
          ) : (
            <div className={css.Spacer} style={{ height: list.totalHeight }}>
              {visibleRows.map((row, i) => (
                <HierarchyRow
                  key={row.id}
                  row={row}
                  top={(list.start + i) * ROW_HEIGHT}
                  isSelected={selectedSet.has(row.id)}
                  isFiltering={query.trim().length > 0}
                  dropPosition={dropTarget?.id === row.id ? dropTarget.position : null}
                  onClick={onRowClick}
                  onDoubleClick={onRowDoubleClick}
                  onToggleExpanded={toggleExpanded}
                  onEyeClick={onEyeClick}
                  onLockClick={onLockClick}
                  onDragStart={onDragStart}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </BasePanel>
  );
}

interface HierarchyRowProps {
  row: FlatRow;
  top: number;
  isSelected: boolean;
  isFiltering: boolean;
  dropPosition: DropPosition | null;
  onClick: (event: React.MouseEvent, id: string) => void;
  onDoubleClick: (id: string) => void;
  onToggleExpanded: (event: React.MouseEvent, row: FlatRow) => void;
  onEyeClick: (event: React.MouseEvent, row: FlatRow) => void;
  onLockClick: (event: React.MouseEvent, row: FlatRow) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>, row: FlatRow) => void;
  onDragOver: (event: React.DragEvent<HTMLElement>, row: FlatRow) => void;
  onDrop: (event: React.DragEvent<HTMLElement>, row: FlatRow) => void;
  onDragEnd: () => void;
}

const HierarchyRow = React.memo(function HierarchyRow({
  row,
  top,
  isSelected,
  isFiltering,
  dropPosition,
  onClick,
  onDoubleClick,
  onToggleExpanded,
  onEyeClick,
  onLockClick,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: HierarchyRowProps) {
  const dimmed = row.isHidden || row.isHiddenByAncestor;
  const showType = row.typeName && row.typeName !== row.label;

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={row.hasChildren ? row.isExpanded : undefined}
      aria-level={row.depth + 1}
      className={classNames(
        css.Row,
        isSelected && css.isSelected,
        dimmed && css.isDimmed,
        isFiltering && !row.isMatch && css.isContext,
        dropPosition === 'before' && css.isDropBefore,
        dropPosition === 'after' && css.isDropAfter,
        dropPosition === 'inside' && css.isDropInside
      )}
      style={
        {
          top,
          height: ROW_HEIGHT,
          paddingLeft: 4 + row.depth * INDENT,
          '--indent': `${4 + row.depth * INDENT}px`
        } as React.CSSProperties
      }
      draggable
      onClick={(e) => onClick(e, row.id)}
      onDoubleClick={() => onDoubleClick(row.id)}
      onDragStart={(e) => onDragStart(e, row)}
      onDragOver={(e) => onDragOver(e, row)}
      onDrop={(e) => onDrop(e, row)}
      onDragEnd={onDragEnd}
      title={showType ? `${row.label} (${row.typeName})` : row.label}
    >
      <span
        className={classNames(css.Caret, row.hasChildren && css.hasChildren, row.isExpanded && css.isExpanded)}
        onClick={row.hasChildren ? (e) => onToggleExpanded(e, row) : undefined}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {row.hasChildren && <CaretIcon />}
      </span>
      <span className={css.Label}>{row.label}</span>
      {showType && <span className={css.Type}>{row.typeName}</span>}
      {row.isVisual && (
        <span className={css.Toggles} onDoubleClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={classNames(css.Toggle, row.isHidden && css.isOn)}
            title={row.isHidden ? 'Show in editor' : 'Hide in editor (Alt: solo)'}
            aria-pressed={row.isHidden}
            onClick={(e) => onEyeClick(e, row)}
          >
            {row.isHidden ? <EyeOffIcon /> : <EyeIcon />}
          </button>
          <button
            type="button"
            className={classNames(css.Toggle, row.isLocked && css.isOn)}
            title={row.isLocked ? 'Unlock' : 'Lock (not clickable)'}
            aria-pressed={row.isLocked}
            onClick={(e) => onLockClick(e, row)}
          >
            {row.isLocked ? <LockIcon /> : <UnlockIcon />}
          </button>
        </span>
      )}
    </div>
  );
});

function subtreeIds(item: HierarchyItem | undefined): string[] {
  if (!item) return [];
  const out: string[] = [];
  const walk = (it: HierarchyItem) => {
    if (it.children.length) out.push(it.id);
    it.children.forEach(walk);
  };
  walk(item);
  return out;
}

// ---- hooks --------------------------------------------------------------------------------

function useActiveComponent(nodeGraph: NodeGraphEditor | null | undefined): ComponentModel | undefined {
  const [component, setComponent] = useState<ComponentModel | undefined>(() => nodeGraph?.getActiveComponent());
  useEffect(() => {
    if (!nodeGraph) return;
    setComponent(nodeGraph.getActiveComponent());
    const group = {};
    nodeGraph.on('activeComponentChanged', (args: { model?: ComponentModel }) => setComponent(args?.model), group);
    return () => {
      nodeGraph.off(group);
    };
  }, [nodeGraph]);
  return component;
}

/** The component's graph, read in render so it never lags the component by a frame. */
function useComponentGraph(component: ComponentModel | undefined): NodeGraphModel | null {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!component) return;
    // A git reset of the component swaps in a new graph model.
    const group = {};
    component.on('graphModelBound', () => bump(), group);
    return () => {
      component.off(group);
    };
  }, [component]);
  return component?.graph ?? null;
}

/**
 * A plain snapshot of the graph, rebuilt (debounced) on structural and label changes. While
 * the panel is hidden it only notes that it is stale and rebuilds when shown again.
 */
function useGraphSnapshot(graph: NodeGraphModel | null, isActive: boolean): HierarchyItem[] {
  const [state, setState] = useState<{ graph: NodeGraphModel | null; items: HierarchyItem[] }>(() => ({
    graph,
    items: snapshotGraph(graph)
  }));
  const staleRef = useRef(false);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;

  useEffect(() => {
    if (!graph) {
      setState({ graph: null, items: [] });
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const rebuild = () => {
      timer = undefined;
      staleRef.current = false;
      setState({ graph, items: snapshotGraph(graph) });
    };
    const schedule = () => {
      if (!activeRef.current) {
        staleRef.current = true;
        return;
      }
      if (timer === undefined) timer = setTimeout(rebuild, SNAPSHOT_DEBOUNCE_MS);
    };
    rebuild();

    const group = {};
    graph.on(['nodeAdded', 'nodeRemoved', 'nodeAttached', 'nodeDetached'], schedule, group);
    // Every Model re-broadcasts its events as 'Model.<event>'; a label lives on the node.
    EventDispatcher.instance.on(
      'Model.labelChanged',
      (args: { model?: { owner?: unknown } }) => {
        if (args?.model?.owner === graph) schedule();
      },
      group
    );
    return () => {
      graph.off(group);
      EventDispatcher.instance.off(group);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [graph]);

  useEffect(() => {
    if (isActive && graph && staleRef.current) {
      staleRef.current = false;
      setState({ graph, items: snapshotGraph(graph) });
    }
  }, [isActive, graph]);

  // Between a component switch and the effect above, snapshot the new graph directly rather
  // than draw the previous component's tree for a frame.
  const fresh = useMemo(() => (state.graph === graph ? null : snapshotGraph(graph)), [state.graph, graph]);
  return fresh ?? state.items;
}

function useSceneVisibility(graph: NodeGraphModel | null, isActive: boolean): SceneVisibility {
  const [value, setValue] = useState<SceneVisibility>(() => EditorSceneVisibility.get());
  useEffect(() => {
    const group = {};
    EventDispatcher.instance.on(EditorSceneVisibility.EVENT, () => setValue(EditorSceneVisibility.get()), group);
    return () => EventDispatcher.instance.off(group);
  }, []);
  // Stored in project metadata: re-read when the project or component under us changes.
  useEffect(() => {
    if (isActive) setValue(EditorSceneVisibility.get());
  }, [graph, isActive]);
  return value;
}

function useGraphSelection(
  nodeGraph: NodeGraphEditor | null | undefined,
  isActive: boolean
): [string[], (ids: string[]) => void] {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    if (!nodeGraph || !isActive) return;
    const read = () => {
      const next = nodeGraph.getSelectedNodes().map((n) => n.id);
      setIds((prev) => (sameSelection(prev, next) ? prev : next));
    };
    read();

    // selectNode hands the node to the sidebar a tick later; read after that settles.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(read, 15);
    };
    const group = {};
    nodeGraph.on('deselect', soon, group);
    nodeGraph.on('activeComponentChanged', soon, group);
    SidebarModel.instance.on(SidebarModelEvent.nodeSelected, soon, group);
    EventDispatcher.instance.on(['inspectNodes', 'viewportSelectNodes'], soon, group);
    const poll = setInterval(read, SELECTION_POLL_MS);

    return () => {
      nodeGraph.off(group);
      SidebarModel.instance.off(group);
      EventDispatcher.instance.off(group);
      clearInterval(poll);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [nodeGraph, isActive]);

  return [ids, setIds];
}

function useExpansion(
  key: string | null,
  items: HierarchyItem[]
): [ReadonlySet<string>, (mutate: (set: Set<string>) => void) => void] {
  const [, bump] = useReducer((x: number) => x + 1, 0);

  let set = key ? expansionByComponent.get(key) : undefined;
  if (key && !set && items.length > 0) {
    // First visit to this component: open the roots. Idempotent, so safe during render.
    set = defaultExpanded(items);
    expansionByComponent.set(key, set);
  }

  const update = useCallback(
    (mutate: (set: Set<string>) => void) => {
      if (!key) return;
      const next = new Set(expansionByComponent.get(key) ?? []);
      mutate(next);
      expansionByComponent.set(key, next);
      bump();
    },
    [key]
  );

  return [set ?? EMPTY_SET, update];
}
