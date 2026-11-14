import React, { useEffect, useRef, useState } from 'react';

import type { IndexedAsset } from './assetIndex';
import type { Dims } from './AssetItems';
import { mergeAssetMeta } from './assetMeta';
import { editAssetMeta } from './assetHistory';
import { normalizePivot, normalizeSlice, type AssetSpriteSettings } from './assetPlacement';
import { assetUrl } from './assetUrl';
import { Foldout } from './Foldout';
import css from './AssetLibrary.module.scss';

type Slice = { left: number; top: number; right: number; bottom: number };
const ZERO: Slice = { left: 0, top: 0, right: 0, bottom: 0 };
const PRESETS: Array<[number, number, string]> = [
  [0, 0, 'Top left'], [0.5, 0, 'Top'], [1, 0, 'Top right'],
  [0, 0.5, 'Left'], [0.5, 0.5, 'Center'], [1, 0.5, 'Right'],
  [0, 1, 'Bottom left'], [0.5, 1, 'Bottom'], [1, 1, 'Bottom right']
];

/**
 * Unity's Sprite Editor, the parts XGENIA's nodes use: a pivot (the sprite's anchor) and nine-slice
 * borders. Both are applied when the asset is dropped on the canvas — a sliced asset spawns a
 * NineSlicePlane with these borders instead of a plain Sprite.
 */
export function AssetSpriteSection({
  asset,
  version,
  dims,
  onRefresh
}: {
  asset: IndexedAsset;
  version: number;
  dims?: Dims;
  onRefresh: (reason: string) => void;
}) {
  const [natural, setNatural] = useState<Dims | null>(dims ?? null);
  const [pivot, setPivot] = useState(asset.sprite?.pivot ?? { x: 0.5, y: 0.5 });
  const [slice, setSlice] = useState<Slice>(asset.sprite?.slice ?? ZERO);
  useEffect(() => {
    setPivot(asset.sprite?.pivot ?? { x: 0.5, y: 0.5 });
    setSlice(asset.sprite?.slice ?? ZERO);
  }, [asset.path, JSON.stringify(asset.sprite || {})]);
  useEffect(() => setNatural(dims ?? null), [asset.path, dims?.w, dims?.h]);

  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<null | 'pivot' | keyof Slice>(null);

  const save = async (nextPivot: { x: number; y: number }, nextSlice: Slice) => {
    const p = normalizePivot(nextPivot);
    const s = normalizeSlice(nextSlice);
    const sprite: AssetSpriteSettings = {};
    // The default pivot is not stored: an asset carries settings only when someone chose them.
    if (p && !(p.x === 0.5 && p.y === 0.5)) sprite.pivot = p;
    if (s) sprite.slice = s;
    const next = sprite.pivot || sprite.slice ? sprite : undefined;
    if (JSON.stringify(next ?? null) === JSON.stringify(asset.sprite ?? null)) return;
    await editAssetMeta(`sprite settings of ${asset.name}`, [asset.path], () => mergeAssetMeta(asset.path, { sprite: next }));
    onRefresh('sprite settings');
  };

  const w = natural?.w || 0;
  const h = natural?.h || 0;

  const onPointerMove = (e: React.PointerEvent) => {
    const which = drag.current;
    const r = stageRef.current?.getBoundingClientRect();
    if (!which || !r || !w || !h) return;
    const fx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const fy = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    if (which === 'pivot') {
      // Snap to the nearest tenth with Shift.
      const snap = (n: number) => (e.shiftKey ? Math.round(n * 10) / 10 : Math.round(n * 1000) / 1000);
      setPivot({ x: snap(fx), y: snap(fy) });
    } else {
      setSlice((s) => {
        const next = { ...s };
        if (which === 'left') next.left = Math.round(Math.min(fx * w, w - s.right));
        if (which === 'right') next.right = Math.round(Math.min((1 - fx) * w, w - s.left));
        if (which === 'top') next.top = Math.round(Math.min(fy * h, h - s.bottom));
        if (which === 'bottom') next.bottom = Math.round(Math.min((1 - fy) * h, h - s.top));
        return next;
      });
    }
  };
  const start = (e: React.PointerEvent, which: 'pivot' | keyof Slice) => {
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    drag.current = which;
  };
  const end = () => {
    if (!drag.current) return;
    drag.current = null;
    void save(pivot, slice);
  };

  const pct = (n: number) => `${Math.max(0, Math.min(100, n * 100))}%`;
  const sliced = !!normalizeSlice(slice);

  return (
    <Foldout id="sprite" title="Sprite settings" defaultOpen={!!asset.sprite}>
      <div
        ref={stageRef}
        className={`${css.SpriteStage} ${css.Bg_checker}`}
        // Width from the height cap, so a tall or square sprite is never stretched to the panel width.
        style={w && h ? { aspectRatio: `${w / h}`, width: `min(100%, ${Math.round(240 * (w / h))}px)` } : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={end}
      >
        <img
          src={assetUrl(asset.path, version)}
          alt=""
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
        {w > 0 && (
          <>
            <span className={`${css.Guide} ${css.GuideV}`} style={{ left: pct(slice.left / w) }} onPointerDown={(e) => start(e, 'left')} title="Left border" />
            <span className={`${css.Guide} ${css.GuideV}`} style={{ left: pct(1 - slice.right / w) }} onPointerDown={(e) => start(e, 'right')} title="Right border" />
            <span className={`${css.Guide} ${css.GuideH}`} style={{ top: pct(slice.top / h) }} onPointerDown={(e) => start(e, 'top')} title="Top border" />
            <span className={`${css.Guide} ${css.GuideH}`} style={{ top: pct(1 - slice.bottom / h) }} onPointerDown={(e) => start(e, 'bottom')} title="Bottom border" />
            <span className={css.PivotDot} style={{ left: pct(pivot.x), top: pct(pivot.y) }} onPointerDown={(e) => start(e, 'pivot')} title="Pivot — drag; Shift snaps" />
          </>
        )}
      </div>

      <div className={css.FieldRow}>
        <span className={css.FieldLabel}>Pivot</span>
        <div className={css.PivotGrid} role="radiogroup" aria-label="Pivot presets">
          {PRESETS.map(([x, y, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={pivot.x === x && pivot.y === y}
              className={pivot.x === x && pivot.y === y ? `${css.PivotCell} ${css.PivotCellOn}` : css.PivotCell}
              title={label}
              onClick={() => {
                setPivot({ x, y });
                void save({ x, y }, slice);
              }}
            />
          ))}
        </div>
        <label className={css.RectField}>
          <span>X</span>
          <input key={`px-${pivot.x}`} type="number" step={0.05} min={0} max={1} defaultValue={pivot.x} onBlur={(e) => { const p = { ...pivot, x: Number(e.target.value) }; setPivot(p); void save(p, slice); }} />
        </label>
        <label className={css.RectField}>
          <span>Y</span>
          <input key={`py-${pivot.y}`} type="number" step={0.05} min={0} max={1} defaultValue={pivot.y} onBlur={(e) => { const p = { ...pivot, y: Number(e.target.value) }; setPivot(p); void save(p, slice); }} />
        </label>
      </div>

      <div className={css.FieldRow}>
        <span className={css.FieldLabel}>9-slice</span>
        {(['left', 'top', 'right', 'bottom'] as const).map((k) => (
          <label key={k} className={css.RectField}>
            <span>{k[0].toUpperCase()}</span>
            <input
              key={`${k}-${slice[k]}`}
              type="number"
              min={0}
              step={1}
              defaultValue={slice[k]}
              onBlur={(e) => {
                const s = { ...slice, [k]: Number(e.target.value) || 0 };
                setSlice(s);
                void save(pivot, s);
              }}
            />
          </label>
        ))}
      </div>
      <div className={css.Meta}>
        {w ? `${w}×${h} px · ` : ''}
        {sliced ? 'Drops as a Nine-Slice Plane with these borders.' : 'Drag the edge guides to set nine-slice borders.'}
        {(asset.sprite?.pivot || sliced) && (
          <button type="button" className={css.LinkBtn} onClick={() => { setPivot({ x: 0.5, y: 0.5 }); setSlice(ZERO); void save({ x: 0.5, y: 0.5 }, ZERO); }}>
            Reset
          </button>
        )}
      </div>
    </Foldout>
  );
}
