import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import type { IndexedAsset, IndexedVersion } from './assetIndex';
import { assetUrl } from './assetUrl';
import { lineageRectInRoot } from './assetPlacement';
import { formatWhen } from './assetFormat';
import { describeAiSource } from './assetAiInfo';
import css from './AssetLibrary.module.scss';

/**
 * An earlier version beside the live art, inside the editor. Opening the file in a browser tab
 * showed nothing (it was served as text/html) and offered no way back; here the version can be
 * restored, and a placement its record still carries can be put back on the live file.
 */
export function AssetVersionCompare({
  asset,
  version,
  cacheBust,
  onClose,
  onRestore,
  onUsePlacement,
  onReveal
}: {
  asset: IndexedAsset;
  version: IndexedVersion;
  cacheBust: number;
  onClose: () => void;
  onRestore: () => void;
  onUsePlacement: () => void;
  onReveal: () => void;
}) {
  const [dims, setDims] = useState<Record<string, string>>({});
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  const versionRect = lineageRectInRoot(version.layout);
  const liveRect = asset.placement?.rect;
  const samePlacement =
    !!versionRect && !!liveRect && ['x', 'y', 'width', 'height'].every((k) => Math.abs((versionRect as any)[k] - (liveRect as any)[k]) < 0.001);

  const pane = (label: string, sub: string, src: string, key: string) => (
    <div className={css.ComparePane}>
      <div className={css.CompareLabel}>
        <span>{label}</span>
        <span className={css.Meta}>{[dims[key], sub].filter(Boolean).join(' · ')}</span>
      </div>
      <div className={`${css.CompareStage} ${css.Bg_checker}`}>
        <img
          src={src}
          alt={label}
          draggable={false}
          onLoad={(e) => {
            const el = e.currentTarget;
            setDims((d) => ({ ...d, [key]: `${el.naturalWidth}×${el.naturalHeight}` }));
          }}
        />
      </div>
    </div>
  );

  return createPortal(
    <div className={css.Scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.Compare} role="dialog" aria-label={`Compare v${version.n} of ${asset.name}`}>
        <div className={css.QuickLookHead}>
          <span className={css.InspectorTitle}>{asset.name}</span>
          <span className={css.FooterGrow} />
          <button type="button" className={css.Action} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={css.CompareRow}>
          {pane(`v${version.n}`, [formatWhen(version.timestamp), describeAiSource(version.ai)].filter(Boolean).join(' · '), assetUrl(version.path, cacheBust), 'v')}
          {pane('Current', describeAiSource(asset.ai), assetUrl(asset.path, cacheBust), 'live')}
        </div>
        {version.ai?.prompt && <div className={css.Prompt}>v{version.n} prompt: {version.ai.prompt}</div>}
        <div className={css.Meta}>
          {versionRect
            ? `v${version.n} was cut from ${version.layout!.rootPath.split('/').pop()}${version.layout!.layerName ? ` as “${version.layout!.layerName}”` : ''}${samePlacement ? ' at the same place as the current file.' : liveRect ? ' at a different place than the current file.' : ', and the current file has lost that placement.'}`
            : `v${version.n} carries no split placement.`}
        </div>
        <div className={css.Row}>
          <button type="button" className={css.Action} onClick={onRestore} title="Make this version the live art; the current art is kept as a new version">
            Restore v{version.n}
          </button>
          {versionRect && !samePlacement && (
            <button type="button" className={css.Action} onClick={onUsePlacement} title="Keep the current art, but put it where this version was placed">
              Use v{version.n}’s placement
            </button>
          )}
          <span className={css.FooterGrow} />
          <button type="button" className={css.LinkBtn} onClick={onReveal}>
            Reveal file
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
