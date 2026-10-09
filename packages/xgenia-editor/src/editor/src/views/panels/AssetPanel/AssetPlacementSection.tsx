import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { IndexedAsset } from './assetIndex';
import { mergeAssetMeta } from './assetMeta';
import { editAssetMeta } from './assetHistory';
import { applyPlacementToNodes } from './assetNodeApply';
import { ToastLayer } from '../../ToastLayer';
import {
  fromScreenPx,
  isUnitRect,
  isUsableScreen,
  lineageRectInRoot,
  toScreenPx,
  type Rect
} from './assetPlacement';
import type { ProjectScreen } from './projectScreen';
import { assetUrl } from './assetUrl';
import { copyText } from './assetFormat';
import { Foldout } from './Foldout';
import css from './AssetLibrary.module.scss';

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Where this asset goes on the target screen.
 *
 * Split pieces arrive placed: the rectangle the split recorded in the key art. Dragging or typing
 * AUTHORS a placement, which wins from then on and can be reset to the split's. A file that lost
 * its placement on a re-save is offered its previous one back — written into `ai.layout`, so the
 * AI's art_placement and compare_to_keyart see it too, not only this panel.
 */
export function AssetPlacementSection({
  asset,
  screen,
  version,
  onRefresh,
  onSelect,
  onOpenBoard
}: {
  asset: IndexedAsset;
  screen: ProjectScreen | null;
  version: number;
  onRefresh: (reason: string) => void;
  onSelect: (path: string) => void;
  onOpenBoard: () => void;
}) {
  const placement = asset.placement;
  const [draft, setDraft] = useState<Rect | null>(placement?.rect ?? null);
  useEffect(() => setDraft(placement?.rect ?? null), [asset.path, placement?.rect.x, placement?.rect.y, placement?.rect.width, placement?.rect.height]);

  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'move' | 'resize'; px: number; py: number; start: Rect } | null>(null);

  const aspect = isUsableScreen(screen) ? screen.width / screen.height : 16 / 9;
  const rootPath = asset.lineage?.rootPath;
  const splitRect = lineageRectInRoot(asset.lineage);

  const author = async (rect: Rect | undefined, reason: string) => {
    await editAssetMeta(`${reason} for ${asset.name}`, [asset.path], () => mergeAssetMeta(asset.path, { placement: rect }));
    onRefresh(reason);
  };

  const commitDraft = (rect: Rect) => {
    const next = { x: r4(rect.x), y: r4(rect.y), width: r4(rect.width), height: r4(rect.height) };
    if (!isUnitRect(next)) return;
    const same = placement && ['x', 'y', 'width', 'height'].every((k) => Math.abs((placement.rect as any)[k] - (next as any)[k]) < 0.00005);
    if (!same) void author(next, 'placement set');
  };

  const onPointerDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!draft) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, start: draft };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!d || !frame) return;
    const dx = (e.clientX - d.px) / frame.width;
    const dy = (e.clientY - d.py) / frame.height;
    if (d.mode === 'move') {
      setDraft({ ...d.start, x: clamp(d.start.x + dx, 0, 1 - d.start.width), y: clamp(d.start.y + dy, 0, 1 - d.start.height) });
    } else {
      // Shift keeps the aspect ratio, as in every design tool.
      let w = clamp(d.start.width + dx, 0.005, 1 - d.start.x);
      let h = clamp(d.start.height + dy, 0.005, 1 - d.start.y);
      if (e.shiftKey) h = clamp(w * (d.start.height / d.start.width), 0.005, 1 - d.start.y);
      setDraft({ ...d.start, width: w, height: h });
    }
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (draft) commitDraft(draft);
  };

  const setField = (key: keyof Rect, raw: string) => {
    if (!draft) return;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const px = isUsableScreen(screen) ? toScreenPx(draft, screen) : null;
    // Unchanged: leave it. Round-tripping a split box through whole pixels would otherwise author a
    // placement that silently overrides every later re-split, just from clicking into a field.
    if (n === (px ? px[key] : r4(draft[key] * 100))) return;
    const next = px ? fromScreenPx({ ...px, [key]: n }, screen!) : { ...draft, [key]: n / 100 };
    if (isUnitRect(next)) commitDraft(next);
  };

  // What "apply to nodes" would do, computed without touching anything, so the button can say it.
  const applyPlan = useMemo(
    () => (placement ? applyPlacementToNodes(asset, screen, true) : null),
    [asset, screen, placement, version]
  );

  const shown = draft && isUsableScreen(screen) ? toScreenPx(draft, screen) : null;
  const pct = (n: number) => `${clamp(n * 100, 0, 100)}%`;

  const sourceLine = !placement
    ? null
    : placement.source === 'authored'
      ? 'Set by hand'
      : `From the split of ${rootPath?.split('/').pop()}${asset.lineage?.layerName ? ` — “${asset.lineage.layerName}”` : ''}${typeof asset.lineage?.zIndex === 'number' ? `, layer ${asset.lineage.zIndex}` : ''}`;

  return (
    <Foldout
      id="placement"
      title="Placement on screen"
      aside={
        placement && draft ? (
          <button
            type="button"
            className={css.LinkBtn}
            onClick={() => copyText(JSON.stringify(shown ?? { x: draft.x, y: draft.y, width: draft.width, height: draft.height }))}
            title="Copy the rectangle as JSON"
          >
            Copy
          </button>
        ) : undefined
      }
    >
      {asset.previousPlacement && !placement && (
        <div className={css.Warn}>
          <div>
            This file lost its placement when it was saved over. v{asset.versions.find((v) => v.path === asset.previousPlacement!.versionPath)?.n ?? '?'} still
            records it{asset.previousPlacement.layout.layerName ? ` as “${asset.previousPlacement.layout.layerName}”` : ''}.
          </div>
          <div className={css.Row}>
            <button
              type="button"
              className={css.Action}
              onClick={async () => {
                // Into ai.layout, where every AI placement tool reads it — not a panel-only field.
                await editAssetMeta(`restore placement of ${asset.name}`, [asset.path], () =>
                  mergeAssetMeta(asset.path, { ai: { ...(asset.ai || {}), layout: asset.previousPlacement!.layout } as any })
                );
                onRefresh('placement restored');
              }}
            >
              Restore placement
            </button>
          </div>
        </div>
      )}

      {draft ? (
        <>
          <div ref={frameRef} className={css.ScreenFrame} style={{ aspectRatio: `${aspect}` }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            {rootPath && rootPath !== asset.path && <img className={css.ScreenArt} src={assetUrl(rootPath, version)} alt="" draggable={false} />}
            {placement?.source === 'authored' && splitRect && (
              <span className={css.GhostBox} style={{ left: pct(splitRect.x), top: pct(splitRect.y), width: pct(splitRect.width), height: pct(splitRect.height) }} title="Where the split put it" />
            )}
            <div
              className={css.PlaceBox}
              style={{ left: pct(draft.x), top: pct(draft.y), width: pct(draft.width), height: pct(draft.height) }}
              onPointerDown={(e) => onPointerDown(e, 'move')}
              title="Drag to move"
            >
              <img src={assetUrl(asset.path, version)} alt="" draggable={false} />
              <span className={css.PlaceHandle} onPointerDown={(e) => onPointerDown(e, 'resize')} title="Drag to resize — Shift keeps the ratio" />
            </div>
          </div>
          <div className={css.RectFields}>
            {(['x', 'y', 'width', 'height'] as const).map((k) => (
              <label key={k} className={css.RectField}>
                <span>{k === 'width' ? 'W' : k === 'height' ? 'H' : k.toUpperCase()}</span>
                <input
                  key={`${asset.path}-${k}-${shown ? shown[k] : draft[k]}`}
                  type="number"
                  step={shown ? 1 : 0.1}
                  defaultValue={shown ? shown[k] : r4(draft[k] * 100)}
                  onBlur={(e) => setField(k, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </label>
            ))}
            <span className={css.Meta}>{shown ? 'px' : '%'}</span>
          </div>
          {applyPlan && applyPlan.refused.length > 0 && (
            <div className={css.Meta}>
              {applyPlan.refused.map((r) => (
                <div key={r.node}>
                  Not applied to {r.node}: {r.reason}.
                </div>
              ))}
            </div>
          )}
          <div className={css.Meta}>
            {sourceLine}
            {!isUsableScreen(screen) && ' · no target screen declared, so values are % of the screen (set one with the chat’s screen tool or pin a device in the top bar)'}
          </div>
          <div className={css.Row}>
            {placement?.source === 'authored' && splitRect && (
              <button type="button" className={css.Action} onClick={() => void author(undefined, 'placement reset')}>
                Reset to split
              </button>
            )}
            {placement?.source === 'authored' && !splitRect && (
              <button type="button" className={css.Action} onClick={() => void author(undefined, 'placement cleared')}>
                Clear
              </button>
            )}
            {applyPlan && applyPlan.applied.length > 0 && (
              <button
                type="button"
                className={css.Action}
                title={`Set x/y/width/height on: ${applyPlan.applied.join(', ')}`}
                onClick={() => {
                  // The rectangle on screen now, not the index's copy, which lags a just-finished drag.
                  const r = applyPlacementToNodes(
                    draft && placement ? { ...asset, placement: { ...placement, rect: draft } } : asset,
                    screen
                  );
                  ToastLayer.showSuccess(
                    `Moved ${r.applied.length} ${r.applied.length === 1 ? 'node' : 'nodes'} to this placement${r.refused.length ? `; left ${r.refused.length} alone` : ''}`
                  );
                }}
              >
                Apply to {applyPlan.applied.length} {applyPlan.applied.length === 1 ? 'node' : 'nodes'}
              </button>
            )}
            <button type="button" className={css.LinkBtn} onClick={onOpenBoard} title="Edit this with every other piece on the full screen">
              Open board
            </button>
            {rootPath && rootPath !== asset.path && (
              <button type="button" className={css.LinkBtn} onClick={() => onSelect(rootPath)}>
                Show {rootPath.split('/').pop()}
              </button>
            )}
          </div>
        </>
      ) : (
        <div className={css.Row}>
          <span className={css.Meta}>No placement recorded. It lands at the node’s default position when dropped.</span>
          <button type="button" className={css.Action} onClick={() => void author({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, 'placement set')}>
            Set placement
          </button>
        </div>
      )}
    </Foldout>
  );
}
