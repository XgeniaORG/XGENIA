import React from 'react';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

export interface ImageProps extends XGENIA.ReactProps {
  dom: {
    alt?: string;
    src: string;
    onLoad?: () => void;
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

  return <img {...props.attrs} className={props.className} {...props.dom} {...PointerListeners(props)} style={style} />;
}
