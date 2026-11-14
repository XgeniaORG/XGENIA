import React, { useEffect, useState } from 'react';

import type { IndexedAsset } from './assetIndex';
import { assetUrl } from './assetUrl';
import css from './AssetLibrary.module.scss';

export type PreviewBackground = 'checker' | 'dark' | 'light';

/**
 * A preview for any kind of asset: images on a switchable background (transparency is invisible on
 * a dark panel), with fit / actual-size zoom; audio and video with native controls; fonts as a
 * specimen.
 */
export function AssetMediaPreview({
  asset,
  version,
  background,
  onBackground,
  large
}: {
  asset: IndexedAsset;
  version: number;
  background: PreviewBackground;
  onBackground: (b: PreviewBackground) => void;
  large?: boolean;
}) {
  const url = assetUrl(asset.path, version);
  const [actual, setActual] = useState(false);
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fontError, setFontError] = useState(false);

  useEffect(() => {
    if (asset.kind !== 'font') return;
    let cancelled = false;
    const family = `xgenia-preview-${asset.path.replace(/[^a-z0-9]/gi, '-')}`;
    setFontError(false);
    const face = new FontFace(family, `url("${url}")`);
    face
      .load()
      .then((f) => {
        if (cancelled) return;
        (document as any).fonts.add(f);
        setFontFamily(family);
      })
      .catch(() => !cancelled && setFontError(true));
    return () => {
      cancelled = true;
    };
  }, [asset.kind, asset.path, url]);

  if (asset.kind === 'audio') {
    return <audio className={css.AudioPreview} src={url} controls preload="metadata" />;
  }
  if (asset.kind === 'video') {
    return <video className={large ? css.VideoPreviewLarge : css.VideoPreview} src={url} controls muted preload="metadata" />;
  }
  if (asset.kind === 'font') {
    if (fontError) return <div className={css.Meta}>This font could not be loaded for a preview.</div>;
    return (
      <div className={css.FontPreview} style={{ fontFamily: fontFamily ? `"${fontFamily}"` : undefined }}>
        <div style={{ fontSize: large ? 56 : 30 }}>Aa Bb Cc 123</div>
        <div style={{ fontSize: large ? 22 : 14 }}>The quick brown fox jumps over the lazy dog</div>
      </div>
    );
  }
  if (asset.kind !== 'image') {
    return <div className={css.Meta}>No preview for .{asset.extension || asset.kind} files.</div>;
  }

  return (
    <div className={css.PreviewWrap}>
      <div className={[css.PreviewStage, css[`Bg_${background}`], large ? css.PreviewStageLarge : '', actual ? css.PreviewActual : ''].join(' ')}>
        <img src={url} alt={asset.name} draggable={false} />
      </div>
      <div className={css.PreviewTools}>
        {(['checker', 'dark', 'light'] as PreviewBackground[]).map((b) => (
          <button
            key={b}
            type="button"
            className={`${css.Swatch} ${css[`Bg_${b}`]} ${background === b ? css.SwatchOn : ''}`}
            onClick={() => onBackground(b)}
            title={`${b[0].toUpperCase()}${b.slice(1)} background`}
            aria-pressed={background === b}
          />
        ))}
        <span className={css.FooterGrow} />
        <button type="button" className={actual ? `${css.IconBtn} ${css.IconBtnOn}` : css.IconBtn} onClick={() => setActual((v) => !v)} title={actual ? 'Fit' : 'Actual size'}>
          {actual ? 'Fit' : '1:1'}
        </button>
      </div>
    </div>
  );
}
