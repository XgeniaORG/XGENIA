import classNames from 'classnames';
import React from 'react';
import { ReactNode } from 'react';
import { Slot, UnsafeStyleProps } from '@xgenia-core-ui/types/global';

import css from './ScrollArea.module.scss';

export interface ScrollAreaProps extends UnsafeStyleProps {
   children: ReactNode;
}

export function ScrollArea({ children, UNSAFE_className, UNSAFE_style }: ScrollAreaProps) {
  return (
    <div className={classNames(css['Root'], UNSAFE_className)} style={UNSAFE_style}>
      <div className={css['Container']}>{children}</div>
    </div>
  );
}
