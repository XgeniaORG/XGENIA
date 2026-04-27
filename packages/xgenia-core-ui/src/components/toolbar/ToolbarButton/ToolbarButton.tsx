import classNames from 'classnames';
import React, { MouseEventHandler } from 'react';

import { Text } from '@xgenia-core-ui/components/typography/Text';

import css from './ToolbarButton.module.scss';

export interface ToolbarButtonProps {
  label: string;
  prefix?: React.ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
}

export function ToolbarButton({ label, prefix, onClick }: ToolbarButtonProps) {
  return (
    <button
      className={classNames([css['Root'], onClick && css['actionable']])}
      onClick={(e) => {
        if (onClick) onClick(e);
      }}
    >
      {prefix}
      <Text className={classNames([css['Text'], onClick && css['actionable']])}>{label}</Text>
    </button>
  );
}
