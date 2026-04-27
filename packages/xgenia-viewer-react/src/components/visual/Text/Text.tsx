import React from 'react';

import Layout from '../../../layout';
import PointerListeners from '../../../pointerlisteners';
import { XGENIA } from '../../../types';

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

export interface TextProps extends XGENIA.ReactProps {
  as?: React.ElementType;

  attrs: React.Attributes;

  textStyle: XGENIA.TextStyle;
  text: string;
  allowHTML?: boolean;

  sizeMode?: XGENIA.SizeMode;
  width?: string;
  height?: string;
  fixedWidth?: boolean;
  fixedHeight?: boolean;

  // Extra Attributes
  dom: Record<string, unknown>;
}

export function Text(props: TextProps) {
  const { as: Component = 'div' }: { as?: React.ElementType } = props;

  const style = {
    ...props.textStyle,
    ...props.style
  };

  Layout.size(style, props);
  Layout.align(style, props);

  style.color = props.xgeniaNode.context.styles.resolveColor(style.color);

  // Respect '\n' in the string
  if (props.sizeMode === 'contentSize' || props.sizeMode === 'contentWidth') {
    style.whiteSpace = 'pre';
  } else {
    style.whiteSpace = 'pre-wrap';
    style.overflowWrap = 'anywhere';
  }

  if (style.opacity === 0) {
    style.pointerEvents = 'none';
  }

  // Using createElement instead of JSX to avoid TypeScript errors with children props
  // When allowHTML is true, render via dangerouslySetInnerHTML to support SVG/HTML content
  if (props.allowHTML && props.text) {
    return React.createElement(
      Component,
      {
        className: ['ndl-visual-text', props.className].join(' '),
        ...props.attrs,
        ...props.dom,
        ...PointerListeners(props),
        style: style,
        dangerouslySetInnerHTML: { __html: String(props.text) }
      }
    );
  }

  return React.createElement(
    Component,
    {
      className: ['ndl-visual-text', props.className].join(' '),
      ...props.attrs,
      ...props.dom,
      ...PointerListeners(props),
      style: style
    },
    String(props.text)
  );
}
