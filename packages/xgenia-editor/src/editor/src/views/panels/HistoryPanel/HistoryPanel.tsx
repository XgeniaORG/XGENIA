import { useNodeGraphContext } from '@xgenia-contexts/NodeGraphContext/NodeGraphContext';
import classNames from 'classnames';
import React, { useCallback, useEffect, useReducer, useRef } from 'react';

import { UndoActionGroup, UndoQueue } from '@xgenia-models/undo-queue-model';
import { type Checkpoint, ProjectCheckpoints } from '@xgenia-models/projectCheckpoints';

import { EventDispatcher } from '../../../../../shared/utils/EventDispatcher';

import { BasePanel } from '@xgenia-core-ui/components/sidebar/BasePanel';

import { ToastLayer } from '../../ToastLayer/ToastLayer';
import { useVirtualRows } from '../HierarchyPanel/useVirtualRows';
import { usePanelActive } from '../useIsActivePanel';
import css from './HistoryPanel.module.scss';
import { type HistoryEntryState, historyJump, historyRows, jumpToastText, pointerForEntry } from './historyModel';

export const HistoryPanel_ID = 'history';

const ROW_HEIGHT = 26;

/**
 * History: the undo queue as a list, oldest at the top and the newest change at the bottom.
 * The current position is the highlighted row; rows below it are undone (redo-able) and dimmed.
 * Clicking a row undoes or redoes step by step until that row is the last one applied; the
 * Start row at the top undoes everything.
 */
export function HistoryPanel() {
  const isActive = usePanelActive();
  const { nodeGraph } = useNodeGraphContext();
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const jumpingRef = useRef(false);

  useEffect(() => {
    const group = {};
    UndoQueue.instance.on(
      ['undoHistoryChanged', 'undo', 'redo'],
      () => {
        // A jump re-renders once when it is done, not once per step; a hidden panel catches
        // up when it is shown.
        if (jumpingRef.current || !activeRef.current) return;
        bump();
      },
      group
    );
    return () => {
      UndoQueue.instance.off(group);
    };
  }, []);

  // UndoQueue.clear() notifies nothing, so read the queue fresh whenever the panel is shown.
  useEffect(() => {
    if (isActive) bump();
  }, [isActive]);

  const queue = UndoQueue.instance;
  const history: readonly UndoActionGroup[] = queue.getHistory();
  const pointer = queue.getHistoryLocation();
  const rows = historyRows(
    history.map((entry) => entry?.label),
    pointer
  );

  // List row 0 is Start; entry i is list row i + 1, so the current position is list row `pointer`.
  const list = useVirtualRows(rows.length + 1, ROW_HEIGHT);
  useEffect(() => {
    if (isActive && rows.length > 0) list.reveal(pointer);
  }, [pointer, rows.length, isActive, list.reveal]);

  const jumpTo = useCallback(
    (target: number) => {
      if (nodeGraph?.readOnly) return;
      const q = UndoQueue.instance;
      const jump = historyJump(q.getHistoryLocation(), q.getHistory().length, target);
      if (jump.kind === 'none') return;

      let last: UndoActionGroup | undefined;
      let done = 0;
      jumpingRef.current = true;
      try {
        for (let i = 0; i < jump.steps; i++) {
          const action = jump.kind === 'undo' ? q.undo() : q.redo();
          if (!action) break;
          last = action;
          done++;
        }
      } catch (error) {
        // An action that throws leaves the pointer before it; stop there rather than skip it.
        console.error('[HistoryPanel] Stopped part-way through a history jump:', error);
      } finally {
        jumpingRef.current = false;
      }

      const text = jumpToastText({ kind: jump.kind, steps: done }, last?.label);
      if (text) ToastLayer.showInteraction(text);
      bump();
    },
    [nodeGraph]
  );

  const visible: number[] = [];
  for (let i = list.start; i < list.end; i++) visible.push(i);

  const branches = queue.getBranches();
  const switchBranch = useCallback((index: number) => {
    if (nodeGraph?.readOnly) return;
    jumpingRef.current = true;
    let ok = false;
    try {
      ok = UndoQueue.instance.switchToBranch(index);
    } catch (error) {
      console.error('[HistoryPanel] Switching branch failed part-way:', error);
    } finally {
      jumpingRef.current = false;
    }
    if (ok) ToastLayer.showInteraction('Switched history branch');
    bump();
  }, [nodeGraph]);

  return (
    <BasePanel title="History" isFill>
      <div className={css.Shell}>
      <div ref={list.scrollRef} className={css.List} role="listbox" aria-label="Undo history">
        {rows.length === 0 ? (
          <div className={css.Empty}>No changes yet</div>
        ) : (
          <div className={css.Spacer} style={{ height: list.totalHeight }}>
            {visible.map((listIndex) => {
              if (listIndex === 0) {
                return (
                  <HistoryRow
                    key="start"
                    top={0}
                    label="Start"
                    state={pointer === 0 ? 'current' : 'done'}
                    isStart
                    onClick={() => jumpTo(0)}
                  />
                );
              }
              const row = rows[listIndex - 1];
              return (
                <HistoryRow
                  key={row.index}
                  top={listIndex * ROW_HEIGHT}
                  label={row.label}
                  state={row.state}
                  onClick={() => jumpTo(pointerForEntry(row.index))}
                />
              );
            })}
          </div>
        )}
      </div>
      <div className={css.Footer}>
        {branches.length > 0 && (
          <>
            <div className={css.SectionTitle}>Branches</div>
            {branches.map((b, i) => {
              const after = b.forkAt === 0 ? 'Start' : history[b.forkAt - 1]?.label || `step ${b.forkAt}`;
              const first = b.actions[0]?.label || 'change';
              const last = b.actions[b.actions.length - 1]?.label;
              return (
                <div
                  key={b.createdAt + ':' + i}
                  className={css.FooterRow}
                  onClick={() => switchBranch(i)}
                  title={`Undo back to “${after}” and replay these ${b.actions.length} step(s); the steps after it now become a branch`}
                >
                  <span className={css.Marker} aria-hidden="true" />
                  <span className={css.Label}>
                    {first}
                    {b.actions.length > 1 ? ` … ${last}` : ''}
                  </span>
                  <span className={css.Meta}>after {after} · {b.actions.length}</span>
                </div>
              );
            })}
          </>
        )}
        <CheckpointsSection />
      </div>
      </div>
    </BasePanel>
  );
}

/** Snapshots that survive a restart (ProjectCheckpoints). */
function CheckpointsSection() {
  const [items, setItems] = React.useState<Checkpoint[]>([]);
  const refresh = useCallback(() => {
    ProjectCheckpoints.list().then(setItems, () => setItems([]));
  }, []);
  useEffect(() => {
    refresh();
    const group = {};
    EventDispatcher.instance.on(ProjectCheckpoints.EVENT, refresh, group);
    return () => EventDispatcher.instance.off(group);
  }, [refresh]);

  const save = () => {
    void ProjectCheckpoints.save('Checkpoint ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    ToastLayer.showInteraction('Checkpoint saved');
  };
  // Restoring replaces the whole project, so it asks first — inline, in the row, saying what
  // happens; a checkpoint of the current state is taken before, so it can be undone.
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const restore = (c: Checkpoint) => {
    setConfirming(null);
    ProjectCheckpoints.restore(c.id).then((ok) => {
      if (!ok) ToastLayer.showError('Could not restore that checkpoint');
    });
  };

  return (
    <>
      <div className={css.SectionTitle}>
        Checkpoints
        <span className={css.Button} onClick={save} title="Save the whole project as it is now">
          Save
        </span>
      </div>
      {items.length === 0 ? (
        <div className={css.Empty}>Saved automatically as you work; they survive a restart.</div>
      ) : (
        items.map((c) =>
          confirming === c.id ? (
            <div key={c.id} className={css.FooterRow} title="The current state is saved as a checkpoint first">
              <span className={css.Label}>Restore “{c.label}”?</span>
              <span className={css.Button} onClick={() => restore(c)}>
                Restore
              </span>
              <span className={css.Button} onClick={() => setConfirming(null)}>
                Cancel
              </span>
            </div>
          ) : (
            <div key={c.id} className={css.FooterRow} onClick={() => setConfirming(c.id)} title="Restore the project to this checkpoint">
              <span className={css.Marker} aria-hidden="true" />
              <span className={css.Label}>{c.label}</span>
              <span className={css.Meta}>{formatAgo(c.createdAt)}</span>
            </div>
          )
        )
      )}
    </>
  );
}

function formatAgo(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleDateString();
}

interface HistoryRowProps {
  top: number;
  label: string;
  state: HistoryEntryState;
  isStart?: boolean;
  onClick: () => void;
}

function HistoryRow({ top, label, state, isStart, onClick }: HistoryRowProps) {
  return (
    <div
      role="option"
      aria-selected={state === 'current'}
      className={classNames(
        css.Row,
        state === 'current' && css.isCurrent,
        state === 'undone' && css.isUndone,
        isStart && css.isStart
      )}
      style={{ top, height: ROW_HEIGHT }}
      onClick={onClick}
      title={state === 'undone' ? `Redo to “${label}”` : state === 'current' ? label : `Undo to “${label}”`}
    >
      <span className={css.Marker} aria-hidden="true" />
      <span className={css.Label}>{label}</span>
    </div>
  );
}
