import React from 'react';

import Layout from '../../../layout';
import { XGENIA } from '../../../types';

export interface IconProps extends XGENIA.ReactProps {
  iconSourceType: 'image' | 'icon';
  iconImageSource: XGENIA.Image;
  iconIconSource: XGENIA.Icon;
  iconSize: string;
  iconColor: XGENIA.Color;
}

export function Icon(props: IconProps) {
  const style: React.CSSProperties = { userSelect: 'none', ...props.style };
  Layout.size(style, props);
  Layout.align(style, props);

  function _renderIcon() {
    const style: React.CSSProperties = {};
    if (props.iconSourceType === 'image' && props.iconImageSource !== undefined) {
      style.width = props.iconSize;
      style.height = props.iconSize;
      return <img alt="" src={props.iconImageSource} style={style} />;
    } else if (props.iconSourceType === 'icon' && props.iconIconSource !== undefined) {
      style.fontSize = props.iconSize;
      style.color = props.iconColor;
      style.lineHeight = 1;
      return (
        <div style={{ lineHeight: 0 }}>
          {props.iconIconSource.codeAsClass === true ? (
            <span className={[props.iconIconSource.class, props.iconIconSource.code].join(' ')} style={style}></span>
          ) : (
            <span className={props.iconIconSource.class} style={style}>
              {props.iconIconSource.code}
            </span>
          )}
        </div>
      );
    }

    return null;
  }

  let className = 'ndl-visual-icon';
  if (props.className) className = className + ' ' + props.className;

  // (2026-08-02) Forward `attrs` like Group/Text/Button do — that is the channel the node
  // layer routes data-xgenia-node-id / -label through. Without it an Icon is anonymous in
  // the DOM and cannot be located from the graph.
  return (
    <div {...(props as any).attrs} className={className} style={style}>
      {_renderIcon()}
    </div>
  );
}
