import React from 'react';

import { UndoActionGroup, UndoQueue } from '../../../models/undo-queue-model';
import { ToastLayer } from '../../ToastLayer';

import type { BrokenRef } from './graphRefs';
import type { IndexedAsset } from './assetIndex';
import { getOrAssignUid } from './assetMeta';
import { goToNode } from './assetNavigate';
import css from './AssetLibrary.module.scss';

const REASON: Record<BrokenRef['reason'], string> = {
  missing: 'file not found',
  'unknown-uid': 'no asset has this id',
  'in-trash': 'points at a deleted copy in .trash'
};

/** The reference a relink writes: keep the ref's own style — a uid ref stays a uid ref. */
function refFor(oldValue: string, path: string): string {
  if (oldValue.startsWith('uid://')) {
    const uid = getOrAssignUid(path);
    if (uid) return `uid://${uid}`;
  }
  return path;
}

/** Relink many references as ONE undo step. */
export function relinkRefs(pairs: Array<{ ref: BrokenRef; path: string }>): number {
  const group = new UndoActionGroup({ label: pairs.length === 1 ? 'relink asset reference' : `relink ${pairs.length} asset references` });
  let done = 0;
  for (const { ref, path } of pairs) {
    try {
      ref.nodeModel.setParameter(ref.key, refFor(ref.value, path), { undo: group, label: group.label });
      done++;
    } catch (e) {
      console.warn('[assets] relink failed', e);
    }
  }
  if (!group.isEmpty()) UndoQueue.instance.push(group);
  return done;
}

/**
 * Graph references that render nothing, with the fix where one is clear. Unreal's "fix up
 * redirectors" for a project whose files moved or were deleted outside the node graph.
 */
export function AssetBrokenRefs({
  broken,
  selected,
  onFixed,
  onClose
}: {
  broken: BrokenRef[];
  selected: IndexedAsset | null;
  onFixed: () => void;
  onClose: () => void;
}) {
  const suggested = broken.filter((b) => b.suggestion);
  const fix = (pairs: Array<{ ref: BrokenRef; path: string }>) => {
    const n = relinkRefs(pairs);
    ToastLayer.showSuccess(`Relinked ${n} ${n === 1 ? 'reference' : 'references'}`);
    onFixed();
  };

  return (
    <div className={css.Broken}>
      <div className={css.Row}>
        <span className={css.SectionLabel}>{broken.length === 0 ? 'No broken references' : `${broken.length} broken ${broken.length === 1 ? 'reference' : 'references'}`}</span>
        <span className={css.FooterGrow} />
        {suggested.length > 1 && (
          <button type="button" className={css.Action} onClick={() => fix(suggested.map((ref) => ({ ref, path: ref.suggestion! })))}>
            Relink {suggested.length} suggested
          </button>
        )}
        <button type="button" className={css.Action} onClick={onClose}>
          Done
        </button>
      </div>
      <div className={css.BrokenList}>
        {broken.map((b, i) => (
          <div key={`${b.component}-${b.node}-${b.key}-${i}`} className={css.BrokenRow}>
            <div className={css.RowMain}>
              <button type="button" className={css.BrokenNode} onClick={() => goToNode(b.componentModel, b.nodeModel)} title="Show this node in the graph">
                {b.node} <span className={css.Meta}>· {b.key} · {b.component}</span>
              </button>
              <span className={css.RowSub} title={b.value}>
                {b.value.split('/').pop()} — {REASON[b.reason]}
              </span>
            </div>
            <div className={css.BrokenActions}>
              {b.suggestion && (
                <button type="button" className={css.Action} onClick={() => fix([{ ref: b, path: b.suggestion! }])} title={b.suggestion}>
                  Relink to {b.suggestion.split('/').pop()}
                </button>
              )}
              {selected && selected.path !== b.suggestion && (
                <button type="button" className={css.LinkBtn} onClick={() => fix([{ ref: b, path: selected.path }])} title={selected.path}>
                  Use selected
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {broken.length > 0 && !selected && <div className={css.Meta}>Select an asset in the list to relink a reference to it.</div>}
    </div>
  );
}
