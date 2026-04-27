import React, { ReactElement, ReactNode, ReactPortal } from 'react';

import type { NodeConstructor } from '../typings/global';

// Export XGENIA as both a namespace and a direct export for compatibility
export const XGENIA = {
  SEO: {
    // Use underscore prefix to indicate intentionally unused parameters
    setMeta: (_key: string, _value: string | undefined) => void 0,
    setTitle: (_title: string) => void 0
  }
};

export namespace XGENIA {
  export type SizeMode = 'explicit' | 'contentWidth' | 'contentHeight' | 'contentSize';

  export type Color = string;

  export type Image = string;

  export type Icon = {
    class: string;
    code: string;
    codeAsClass?: boolean;
  };

  export type TextStyle = {
    color: string;
    fontFamily: string;
    fontSize: string;
    letterSpacing: string;
    lineHeight: string;
    textTransform: React.CSSProperties['textTransform'];
  };

  export interface ReactProps {
    xgeniaNode: NodeConstructor;
    style: React.CSSProperties;
    styles: Record<string, React.CSSProperties>;
    className: string;
    parentLayout: 'none' | 'row' | 'column';
  }
}

export type SingleSlot = ReactElement<unknown> | ReactNode | ReactPortal | boolean | null | undefined;

export type Slot = SingleSlot | SingleSlot[];
