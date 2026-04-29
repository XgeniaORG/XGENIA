import React, { ReactNode } from 'react';

import Layout from '../../../layout';
import Utils from '../../../nodes/controls/utils';
import { XGENIA } from '../../../types';

export interface ButtonProps extends XGENIA.ReactProps {
  enabled: boolean;
  buttonType: 'button' | 'submit';

  attrs: React.Attributes;

  textStyle: XGENIA.TextStyle;

  useLabel: boolean;
  label: string;
  labelSpacing: string;
  labeltextStyle: XGENIA.TextStyle;

  useIcon: boolean;
  iconPlacement: 'left' | 'right';
  iconSpacing: string;
  iconSourceType: 'image' | 'icon';
  iconImageSource: XGENIA.Image;
  iconIconSource: XGENIA.Icon;
  iconSize: string;
  iconColor: XGENIA.Color;

  onClick: () => void;

  children: ReactNode;
}

export function Button(props: ButtonProps) {
  let style: React.CSSProperties = { ...props.style };
  Layout.size(style, props);
  Layout.align(style, props);

  if (props.textStyle !== undefined) {
    // Apply text style
    style = Object.assign({}, props.textStyle, style);
    style.color = props.xgeniaNode.context.styles.resolveColor(style.color);
  }

  function _renderIcon() {
    const iconStyle: React.CSSProperties = {};

    if (props.useLabel) {
      if (props.iconPlacement === 'left' || props.iconPlacement === undefined) {
        iconStyle.marginRight = props.iconSpacing;
      } else {
        iconStyle.marginLeft = props.iconSpacing;
      }
    }

    if (props.iconSourceType === 'image' && props.iconImageSource !== undefined) {
      iconStyle.width = props.iconSize;
      iconStyle.height = props.iconSize;
      return <img alt="" src={props.iconImageSource} style={iconStyle} />;
    } else if (props.iconSourceType === 'icon' && props.iconIconSource !== undefined) {
      iconStyle.fontSize = props.iconSize;
      iconStyle.color = props.iconColor;

      if (props.iconIconSource.codeAsClass === true) {
        return (
          <span className={[props.iconIconSource.class, props.iconIconSource.code].join(' ')} style={iconStyle}></span>
        );
      } else {
        return (
          <span className={props.iconIconSource.class} style={iconStyle}>
            {props.iconIconSource.code}
          </span>
        );
      }
    }

    return null as React.ReactNode;
  }

  let className = 'ndl-controls-button';
  if (props.className) className = className + ' ' + props.className;

  let content: React.ReactNode = null as React.ReactNode;

  if (props.useLabel && props.useIcon) {
    content = (
      <>
        {props.iconPlacement === 'left' ? _renderIcon() : null}
        {String(props.label)}
        {props.iconPlacement === 'right' ? _renderIcon() : null}
      </>
    );
  } else if (props.useLabel) {
    content = String(props.label);
  } else if (props.useIcon) {
    content = _renderIcon();
  }

  return (
    <button
      {...props.attrs}
      className={className}
      disabled={!props.enabled}
      {...Utils.controlEvents(props)}
      type={props.buttonType}
      style={style}
      onClick={props.onClick}
    >
      {content}
      {props.children}
    </button>
  );
}
