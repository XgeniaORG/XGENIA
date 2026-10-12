import React, { useEffect, useState } from 'react';

import type { IndexedAsset } from './assetIndex';
import type { Dims } from './AssetItems';
import { formatBytes } from './assetFormat';
import { openInDefaultApp } from './assetOps';
import { AssetMediaPreview, type PreviewBackground } from './AssetMediaPreview';
import { createPortal } from 'react-dom';

import css from './AssetLibrary.module.scss';

/** Space-bar preview, large, over the whole editor. ←/→ step through the visible list. */
export function AssetQuickLook({
  asset,
  version,
  dims,
  onClose,
  onStep
}: {
  asset: IndexedAsset;
  version: number;
  dims?: Dims;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
}) {
  const [bg, setBg] = useState<PreviewBackground>('checker');

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        onStep(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        onStep(1);
      }
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose, onStep]);

  // Portaled: the panel card has a backdrop-filter, which makes it the containing block for
  // position:fixed and would trap this overlay inside the card.
  return createPortal(

    <div className={css.Scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={css.QuickLook} role="dialog" aria-label={`Preview of ${asset.name}`}>
        <div className={css.QuickLookHead}>
          <span className={css.InspectorTitle}>{asset.name}</span>
          <span className={css.Meta}>{[dims ? `${dims.w}×${dims.h}` : '', formatBytes(asset.size)].filter(Boolean).join(' · ')}</span>
          <span className={css.FooterGrow} />
          <button type="button" className={css.Action} onClick={() => openInDefaultApp(asset.path)} title="Open in the default app">
            Open
          </button>
          <button type="button" className={css.Action} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={css.QuickLookBody}>
          <AssetMediaPreview asset={asset} version={version} background={bg} onBackground={setBg} large />
        </div>
      </div>
    </div>,
    document.body
  );
}
