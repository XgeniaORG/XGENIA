import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { ProjectModel } from '@xgenia-models/projectmodel';
import { SidebarModel, SidebarModelEvent } from '@xgenia-models/sidebar/sidebarmodel';

import { EventDispatcher } from '../../../../shared/utils/EventDispatcher';
import { TimelineState } from '../../models/timelineState';
import { TIMELINE_NODE_TYPE } from '../../utils/timelineModel';
import { TimelineDock, useTimelineState } from './TimelineDock';
import css from './TimelineDock.module.scss';

const HEIGHT_KEY = 'xgenia.timelineDock.height';
const DEFAULT_HEIGHT = 170;
/** The dock never takes more than this share of the pane: the node graph stays usable. */
const MAX_SHARE = 0.45;
const MIN_HEIGHT = 110;
const MAX_HEIGHT = 640;

function readHeight(): number {
  try {
    const n = Number(window.localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(n) && n >= MIN_HEIGHT && n <= MAX_HEIGHT) return n;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_HEIGHT;
}

function saveHeight(h: number) {
  try {
    window.localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
  } catch {
    /* storage unavailable */
  }
}

export interface TimelineDockHostProps {
  /** 'top': the dock sits above the wrapped pane (preview above it, node graph below). */
  position: 'top' | 'bottom';
  children: React.ReactNode;
}

/**
 * Editor wiring for the Timeline, mounted once per open project (EditorDocument): installs the
 * node lookup the timeline code uses, opens the dock when a Timeline node is selected, and
 * remembers the last other node selected as the "Add track" target.
 */
export function useTimelineDockBindings() {
  useEffect(() => {
    TimelineState.setNodeLookup((id) => ProjectModel.instance?.findNodeWithId(id) as any);

    const group = {};
    SidebarModel.instance.on(
      SidebarModelEvent.nodeSelected,
      (nodeId: string) => {
        const node = ProjectModel.instance?.findNodeWithId(nodeId);
        if (!node) return;
        if (node.typename === TIMELINE_NODE_TYPE) TimelineState.openOn(node.id);
        else TimelineState.set({ selectedTargetId: node.id });
      },
      group
    );

    // The Timeline node deleted: nothing left to edit (the runtime restores its targets itself).
    EventDispatcher.instance.on(
      'Model.nodeRemoved',
      (e: { args?: { model?: { id?: string } } }) => {
        const removedId = e?.args?.model?.id;
        if (removedId && removedId === TimelineState.get().timelineNodeId) {
          TimelineState.set({ timelineNodeId: null, recording: false, previewing: false, time: 0 });
        }
      },
      group
    );

    return () => {
      SidebarModel.instance.off(group);
      EventDispatcher.instance.off(group);
      // Project closing (or hot reload): leave the preview at base values and forget the node.
      TimelineState.close();
      TimelineState.set({ timelineNodeId: null, selectedTargetId: null, time: 0 });
      TimelineState.setNodeLookup(null);
    };
  }, []);
}

/**
 * Wraps the node graph pane and docks the Timeline strip on the edge facing the preview.
 * Presentation only: the selection wiring lives in useTimelineDockBindings, so a layout switch
 * that remounts this does not close the dock.
 */
export function TimelineDockHost({ position, children }: TimelineDockHostProps) {
  const state = useTimelineState();
  const [height, setHeight] = useState(readHeight);
  const [dragging, setDragging] = useState(false);
  const heightRef = useRef(height);
  heightRef.current = height;
  const hostRef = useRef<HTMLDivElement>(null);
  const [hostHeight, setHostHeight] = useState(0);
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setHostHeight(el.clientHeight));
    ro.observe(el);
    setHostHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  const shown = hostHeight > 0 ? Math.max(MIN_HEIGHT, Math.min(height, Math.floor(hostHeight * MAX_SHARE))) : height;
  // A drag starts from what is on screen: from the stored height, a clamped dock ignored the
  // first pixels of the drag.
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = shownRef.current;
      setDragging(true);
      const move = (ev: PointerEvent) => {
        const dy = ev.clientY - startY;
        const next = position === 'top' ? startHeight + dy : startHeight - dy;
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, next)));
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragging(false);
        saveHeight(heightRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [position]
  );

  const handle = <div className={classNames(css.Resize, dragging && css.isDragging)} onPointerDown={onResizePointerDown} />;

  return (
    <div ref={hostRef} className={css.Host}>
      {state.open && position === 'top' && (
        <>
          <TimelineDock height={shown} />
          {handle}
        </>
      )}
      <div className={css.HostMain}>{children}</div>
      {state.open && position === 'bottom' && (
        <>
          {handle}
          <TimelineDock height={shown} />
        </>
      )}
    </div>
  );
}
