import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ToastLayer } from '../../ToastLayer';

import type { AssetIndex, IndexedAsset } from './assetIndex';
import { mergeAssetMeta } from './assetMeta';
import { editAssetMeta, UndoActionGroup, UndoQueue } from './assetHistory';
import { applyPlacementToNodes } from './assetNodeApply';
import { fromScreenPx, isUsableScreen, lineageRectInRoot, toScreenPx, type Rect } from './assetPlacement';
import { moveRects, nudgeRects, resizeRect, snapMove, type Guide } from './assetBoard';
import type { ProjectScreen } from './projectScreen';
import { assetUrl } from './assetUrl';
import css from './AssetLibrary.module.scss';

const HAND_PLACED = '';
const SNAP_PX = 6;
const same = (a: Rect, b: Rect) => ['x', 'y', 'width', 'height'].every((k) => Math.abs((a as any)[k] - (b as any)[k]) < 0.00005);
const r4 = (n: number) => Math.round(n * 10000) / 10000;

type Drag =
  | { kind: 'move'; startX: number; startY: number; start: Map<string, Rect> }
  | { kind: 'resize'; path: string; startX: number; startY: number; start: Rect }
  | { kind: 'marquee'; startX: number; startY: number; x: number; y: number; additive: boolean };

/**
 * Every piece of one key art, laid out on the target screen at once, edited together: select,
 * marquee, drag as a group with snapping to other pieces and the screen, nudge with the arrows,
 * resize. Edits are a draft until Save, which writes them as ONE undoable step — and can move the
 * nodes already using those pieces in the same breath.
 */
export function AssetPlacementBoard({
  index,
  screen,
  version,
  initialRoot,
  initialSelection,
  onClose,
  onSaved
}: {
  index: AssetIndex;
  screen: ProjectScreen | null;
  version: number;
  initialRoot: string | null;
  initialSelection: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const placed = useMemo(() => index.assets.filter((a) => a.placement && a.kind === 'image'), [index]);
  const roots = useMemo(() => {
    const set = new Set<string>();
    for (const a of placed) set.add(a.lineage?.rootPath || HAND_PLACED);
    return [...set].sort((a, b) => (a === HAND_PLACED ? 1 : b === HAND_PLACED ? -1 : a.localeCompare(b)));
  }, [placed]);

  const [root, setRoot] = useState<string>(() => (initialRoot && roots.includes(initialRoot) ? initialRoot : roots[0] ?? HAND_PLACED));
  const pieces = useMemo(
    () =>
      placed
        .filter((a) => (a.lineage?.rootPath || HAND_PLACED) === root)
        .sort((a, b) => (a.lineage?.zIndex ?? 0) - (b.lineage?.zIndex ?? 0)),
    [placed, root]
  );

  // What each piece looked like when the board opened. "Changed" and Save compare against THIS, not
  // against the live index: a rescan while the board is open (the AI saving a piece) must neither
  // crash the board nor make Save write the old rectangle back over the AI's new one.
  const [opened] = useState<Map<string, Rect>>(() => new Map(placed.map((a) => [a.path, a.placement!.rect])));
  const [draft, setDraft] = useState<Map<string, Rect>>(opened);
  const rectOf = (a: IndexedAsset) => draft.get(a.path) ?? a.placement!.rect;
  const [past, setPast] = useState<Map<string, Rect>[]>([]);
  const [selectedRaw, setSelected] = useState<Set<string>>(() => new Set(initialSelection));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [underlay, setUnderlay] = useState(0.45);
  const [labels, setLabels] = useState(true);
  const [moveNodes, setMoveNodes] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const aspect = isUsableScreen(screen) ? screen.width / screen.height : 16 / 9;
  const sizeForSnap = isUsableScreen(screen) ? screen : { width: 1920, height: 1080 };
  const visible = pieces.filter((p) => !hidden.has(p.path));
  // Only what is on the board right now can be selected: another key art's pieces, or hidden ones,
  // must never move with an arrow key or skew the snapping bounds.
  const selected = useMemo(() => new Set([...selectedRaw].filter((p) => visible.some((v) => v.path === p))), [selectedRaw, visible]);
  // A piece that appeared after opening compares against its live placement.
  const changed = placed.filter((a) => draft.has(a.path) && !same(draft.get(a.path)!, opened.get(a.path) ?? a.placement!.rect));

  const commitDraft = useCallback((next: Map<string, Rect>) => {
    setPast((p) => [...p.slice(-99), draft]);
    setDraft(next);
  }, [draft]);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // ─── pointer ────────────────────────────────────────────────────────────────

  const onPiecePointerDown = (e: React.PointerEvent, path: string) => {
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    let sel = selected;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      sel = new Set(selected);
      sel.has(path) ? sel.delete(path) : sel.add(path);
      setSelected(sel);
      if (!sel.has(path)) return;
    } else if (!selected.has(path)) {
      sel = new Set([path]);
      setSelected(sel);
    }
    const p = frac(e);
    const onBoard = [...sel].filter((s) => visible.some((v) => v.path === s));
    setDrag({ kind: 'move', startX: p.x, startY: p.y, start: new Map(onBoard.map((s) => [s, rectOf(placed.find((a) => a.path === s)!)])) });
  };

  const onHandlePointerDown = (e: React.PointerEvent, path: string) => {
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    const p = frac(e);
    setDrag({ kind: 'resize', path, startX: p.x, startY: p.y, start: rectOf(placed.find((a) => a.path === path)!) });
  };

  const onStagePointerDown = (e: React.PointerEvent) => {
    stageRef.current?.setPointerCapture(e.pointerId);
    const p = frac(e);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!additive) setSelected(new Set());
    setDrag({ kind: 'marquee', startX: p.x, startY: p.y, x: p.x, y: p.y, additive });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = frac(e);
    if (drag.kind === 'move') {
      const moving = [...drag.start.values()];
      const others = visible.filter((v) => !drag.start.has(v.path)).map(rectOf);
      // Alt disables snapping, as in every design tool.
      const snapped = snapMove(moving, others, p.x - drag.startX, p.y - drag.startY, sizeForSnap, e.altKey ? 0 : SNAP_PX);
      setGuides(snapped.guides);
      const next = new Map(draft);
      const moved = moveRects(moving, snapped.dx, snapped.dy);
      [...drag.start.keys()].forEach((k, i) => next.set(k, moved[i]));
      setDraft(next);
    } else if (drag.kind === 'resize') {
      const next = new Map(draft);
      next.set(drag.path, resizeRect(drag.start, p.x - drag.startX, p.y - drag.startY, e.shiftKey));
      setDraft(next);
    } else {
      setDrag({ ...drag, x: p.x, y: p.y });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    if (drag.kind === 'move' || drag.kind === 'resize') {
      const before = new Map(draft);
      if (drag.kind === 'move') drag.start.forEach((r, k) => before.set(k, r));
      else before.set(drag.path, drag.start);
      if ([...draft].some(([k, r]) => before.has(k) && !same(r, before.get(k)!))) setPast((h) => [...h.slice(-99), before]);
    } else {
      const box = {
        x: Math.min(drag.startX, drag.x),
        y: Math.min(drag.startY, drag.y),
        right: Math.max(drag.startX, drag.x),
        bottom: Math.max(drag.startY, drag.y)
      };
      if (box.right - box.x > 0.002 || box.bottom - box.y > 0.002) {
        const hit = visible.filter((v) => {
          const r = rectOf(v);
          return r.x < box.right && r.x + r.width > box.x && r.y < box.bottom && r.y + r.height > box.y;
        });
        setSelected((s) => new Set([...(drag.additive ? s : []), ...hit.map((h) => h.path)]));
      }
    }
    setGuides([]);
    setDrag(null);
  };

  // ─── keyboard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return;
      const mod = e.metaKey || e.ctrlKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.key === 'Escape') {
        stop();
        if (changed.length === 0 || window.confirm('Discard the placement changes on this board?')) onClose();
      } else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        stop();
        if (past.length) {
          setDraft(past[past.length - 1]);
          setPast((h) => h.slice(0, -1));
        }
      } else if (mod && e.key.toLowerCase() === 'a') {
        stop();
        setSelected(new Set(visible.map((v) => v.path)));
      } else if (e.key.startsWith('Arrow') && selected.size > 0) {
        stop();
        const step = e.shiftKey ? 10 : 1;
        const px = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const py = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const next = new Map(draft);
        const keys = [...selected];
        nudgeRects(keys.map((k) => rectOf(placed.find((a) => a.path === k)!)), px, py, sizeForSnap).forEach((r, i) => next.set(keys[i], r));
        commitDraft(next);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [changed.length, past, visible, selected, draft, commitDraft, onClose, sizeForSnap, placed]);

  // ─── actions ────────────────────────────────────────────────────────────────

  const resetSelectedToSplit = () => {
    const next = new Map(draft);
    for (const p of selected) {
      const a = placed.find((x) => x.path === p);
      const split = lineageRectInRoot(a?.lineage);
      if (split) next.set(p, split);
    }
    commitDraft(next);
  };

  const save = async () => {
    if (changed.length === 0) return onClose();
    const writes = changed.map((a) => {
      const rect = draft.get(a.path)!;
      const split = lineageRectInRoot(a.lineage);
      // Back on the split's own rectangle: drop the authored override instead of pinning a copy of it.
      const placement = split && same(rect, split) ? undefined : { x: r4(rect.x), y: r4(rect.y), width: r4(rect.width), height: r4(rect.height) };
      return { asset: a, rect, placement };
    });
    // ONE undo step for the whole save: the placements and every node moved with them.
    const group = new UndoActionGroup({ label: `placement board: ${writes.length} ${writes.length === 1 ? 'piece' : 'pieces'}` });
    await editAssetMeta(
      group.label,
      writes.map((w) => w.asset.path),
      async () => {
        for (const w of writes) await mergeAssetMeta(w.asset.path, { placement: w.placement });
      },
      group
    );
    let moved = 0;
    let left = 0;
    if (moveNodes) {
      for (const w of writes) {
        const r = applyPlacementToNodes({ ...w.asset, placement: { ...w.asset.placement!, rect: w.rect } }, screen, false, group);
        moved += r.applied.length;
        left += r.refused.length;
      }
    }
    if (!group.isEmpty()) UndoQueue.instance.push(group);
    ToastLayer.showSuccess(
      `Saved ${writes.length} ${writes.length === 1 ? 'placement' : 'placements'}${moveNodes ? `; moved ${moved} ${moved === 1 ? 'node' : 'nodes'}${left ? `, left ${left} alone` : ''}` : ''}`
    );
    onSaved();
    onClose();
  };

  const single = selected.size === 1 ? [...selected][0] : null;
  const singleAsset = single ? placed.find((a) => a.path === single) : undefined;
  const singleRect = singleAsset ? rectOf(singleAsset) : null;
  const px = singleRect && isUsableScreen(screen) ? toScreenPx(singleRect, screen) : null;
  const setField = (k: keyof Rect, raw: string) => {
    if (!single || !singleRect) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const current = px ? px[k] : r4(singleRect[k] * 100);
    if (n === current) return;
    const rect = px ? fromScreenPx({ ...px, [k]: n }, screen!) : { ...singleRect, [k]: n / 100 };
    commitDraft(new Map(draft).set(single, rect));
  };
  const pct = (n: number) => `${n * 100}%`;
  const nameOf = (a: IndexedAsset) => a.lineage?.layerName || a.name;

  return createPortal(
    <div className={css.Scrim}>
      <div className={css.Board} role="dialog" aria-label="Placement board">
        <div className={css.QuickLookHead}>
          <span className={css.InspectorTitle}>Placement board</span>
          <select className={css.SortSelect} value={root} onChange={(e) => setRoot(e.target.value)} aria-label="Key art">
            {roots.map((r) => (
              <option key={r || 'hand'} value={r}>
                {r ? r.split('/').pop() : 'Placed by hand'}
              </option>
            ))}
          </select>
          <span className={css.Meta}>{screen ? `${screen.width}×${screen.height}` : 'no target screen — values in %'}</span>
          <span className={css.FooterGrow} />
          <label className={css.BoardToggle}>
            Key art
            <input type="range" min={0} max={1} step={0.05} value={underlay} onChange={(e) => setUnderlay(Number(e.target.value))} />
          </label>
          <label className={css.BoardToggle}>
            <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
          </label>
        </div>

        <div className={css.BoardBody}>
          <div className={css.BoardStageWrap}>
            <div
              ref={stageRef}
              className={css.BoardStage}
              style={{ aspectRatio: `${aspect}` }}
              onPointerDown={onStagePointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {root && <img className={css.ScreenArt} style={{ opacity: underlay }} src={assetUrl(root, version)} alt="" draggable={false} />}
              {visible.map((a) => {
                const r = rectOf(a);
                const on = selected.has(a.path);
                return (
                  <div
                    key={a.path}
                    className={[css.BoardPiece, on ? css.BoardPieceOn : ''].join(' ')}
                    style={{ left: pct(r.x), top: pct(r.y), width: pct(r.width), height: pct(r.height) }}
                    onPointerDown={(e) => onPiecePointerDown(e, a.path)}
                    title={a.path}
                  >
                    <img src={assetUrl(a.path, version)} alt="" draggable={false} />
                    {labels && (
                      // A piece at the top edge gets its label inside, or the stage clips it away.
                      <span className={css.BoardLabel} style={r.y < 0.03 ? { top: 2 } : undefined}>
                        {nameOf(a)}
                      </span>
                    )}
                    {on && selected.size === 1 && <span className={css.PlaceHandle} onPointerDown={(e) => onHandlePointerDown(e, a.path)} />}
                  </div>
                );
              })}
              {guides.map((g, i) => (
                <span key={i} className={g.axis === 'x' ? css.BoardGuideV : css.BoardGuideH} style={g.axis === 'x' ? { left: pct(g.at) } : { top: pct(g.at) }} />
              ))}
              {drag?.kind === 'marquee' && (
                <span
                  className={css.BoardMarquee}
                  style={{
                    left: pct(Math.min(drag.startX, drag.x)),
                    top: pct(Math.min(drag.startY, drag.y)),
                    width: pct(Math.abs(drag.x - drag.startX)),
                    height: pct(Math.abs(drag.y - drag.startY))
                  }}
                />
              )}
            </div>
            <div className={css.Meta}>
              Drag to move · Shift-click or drag a box to select several · Arrows nudge 1px (Shift 10px) · Alt disables snapping · Shift-resize keeps the ratio · ⌘Z undoes on the board
            </div>
          </div>

          <div className={css.BoardSide}>
            <div className={css.SectionLabel}>{pieces.length} pieces</div>
            <div className={css.BoardList}>
              {pieces.map((a) => {
                const dirty = changed.includes(a);
                return (
                  <div key={a.path} className={[css.BoardListRow, selected.has(a.path) ? css.FolderRowActive : ''].join(' ')}>
                    <input
                      type="checkbox"
                      checked={!hidden.has(a.path)}
                      onChange={() => setHidden((h) => { const n = new Set(h); n.has(a.path) ? n.delete(a.path) : n.add(a.path); return n; })}
                      title="Show on the board"
                    />
                    <button type="button" className={css.BoardListName} onClick={(e) => setSelected((s) => (e.shiftKey || e.metaKey ? new Set([...s, a.path]) : new Set([a.path])))}>
                      {nameOf(a)}
                    </button>
                    <span className={css.Meta}>{dirty ? 'edited' : a.placement!.source === 'authored' ? 'by hand' : ''}</span>
                  </div>
                );
              })}
            </div>
            {single && singleRect && (
              <div className={`${css.RectFields} ${css.BoardFields}`}>
                {(['x', 'y', 'width', 'height'] as const).map((k) => (
                  <label key={k} className={css.RectField}>
                    <span>{k === 'width' ? 'W' : k === 'height' ? 'H' : k.toUpperCase()}</span>
                    <input
                      key={`${single}-${k}-${px ? px[k] : singleRect[k]}`}
                      type="number"
                      defaultValue={px ? px[k] : r4(singleRect[k] * 100)}
                      onBlur={(e) => setField(k, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                  </label>
                ))}
                <span className={css.Meta}>{px ? 'px' : '%'}</span>
              </div>
            )}
            {selected.size > 0 && [...selected].some((p) => lineageRectInRoot(placed.find((a) => a.path === p)?.lineage)) && (
              <button type="button" className={css.Action} onClick={resetSelectedToSplit}>
                Reset {selected.size === 1 ? 'piece' : `${selected.size} pieces`} to the split
              </button>
            )}
          </div>
        </div>

        <div className={css.Row}>
          <label className={css.BoardToggle} title="Also set x/y/width/height on the Sprite nodes already showing these pieces">
            <input type="checkbox" checked={moveNodes} onChange={(e) => setMoveNodes(e.target.checked)} /> Also move the nodes using them
          </label>
          <span className={css.FooterGrow} />
          <span className={css.Meta}>{changed.length ? `${changed.length} changed` : 'no changes'}</span>
          <button type="button" className={css.Action} onClick={() => (changed.length === 0 || window.confirm('Discard the placement changes on this board?')) && onClose()}>
            Cancel
          </button>
          <button type="button" className={`${css.Action} ${css.ActionPrimary}`} onClick={() => void save()} disabled={changed.length === 0}>
            Save
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
