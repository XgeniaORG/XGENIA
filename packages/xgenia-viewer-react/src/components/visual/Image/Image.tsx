import React from 'react';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

export interface ImageProps extends XGENIA.ReactProps {
  dom: {
    alt?: string;
    src: string;
    onLoad?: () => void;
    onError?: () => void;
  };
  attrs: React.Attributes;
}

export function Image(props: ImageProps) {
  const style = { ...props.style };

  Layout.size(style, props);
  Layout.align(style, props);

  if (style.opacity === 0) {
    style.pointerEvents = 'none';
  }

  if (props.dom?.src?.startsWith('/')) {
    try {
      // Add safety check for XGENIA.Env
      // @ts-expect-error missing XGENIA typings
      const baseUrl = XGENIA && XGENIA.Env && XGENIA.Env['BaseUrl'];
      if (baseUrl) {
        props.dom.src = baseUrl + props.dom.src.substring(1);
      }
    } catch (e: any) {
      console.warn("Error processing image src:", e);
      // Keep the original src if there's an error
    }
  }

  const resolvedSrc = props.dom?.src;

  // Graceful broken-asset fallback. When a src fails to load (a common case
  // for AI-generated UIs that reference a sprite path before the asset is
  // saved, or get the path slightly wrong), a bare <img> shows the browser's
  // broken-image glyph — identical and ugly across every build. Instead we
  // render a neutral placeholder that keeps the element's footprint/styling
  // and shows the alt text, so the layout reads as intentional rather than
  // broken. The node's existing onError signal still fires for wiring.
  const [errored, setErrored] = React.useState(false);
  React.useEffect(() => { setErrored(false); }, [resolvedSrc]);

  const handleError = () => {
    setErrored(true);
    try { props.dom?.onError?.(); } catch (e) { /* signal wiring optional */ }
  };

  if (errored && resolvedSrc) {
    const placeholderStyle: React.CSSProperties = {
      ...style,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      // Reuse any background the element already has; otherwise a faint,
      // theme-neutral tint that adapts to the surrounding text color.
      background: (style as any).background || (style as any).backgroundColor || 'rgba(127,127,127,0.12)',
      color: (style as any).color || 'currentColor',
      boxSizing: 'border-box'
    };
    const label = props.dom?.alt || '';
    return (
      <div
        {...props.attrs}
        className={props.className}
        {...PointerListeners(props)}
        style={placeholderStyle}
        role="img"
        aria-label={label || 'image unavailable'}
      >
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35em', opacity: 0.55, padding: '0.5em', textAlign: 'center', fontSize: 'min(1em, 14px)', lineHeight: 1.2 }}>
          <svg width="1.6em" height="1.6em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          {label ? <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span> : null}
        </span>
      </div>
    );
  }

  return <img {...props.attrs} className={props.className} {...props.dom} {...PointerListeners(props)} style={style} onError={handleError} />;
}
