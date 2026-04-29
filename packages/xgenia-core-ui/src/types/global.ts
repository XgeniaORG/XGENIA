import React, { JSXElementConstructor, ReactElement, ReactNode, ReactPortal } from 'react';

export interface UnsafeStyleProps {
  UNSAFE_className?: string;
  UNSAFE_style?: React.CSSProperties;
}

// FIXME: add generics to be able to specify what exact components are allowed?
export type SingleSlot = ReactElement<any, any> | ReactNode | ReactPortal | boolean | null | undefined;

export type Slot = SingleSlot | SingleSlot[];
