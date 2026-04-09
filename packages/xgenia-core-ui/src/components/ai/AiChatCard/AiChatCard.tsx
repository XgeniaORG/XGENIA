import classNames from 'classnames';
import React, { useEffect, useState, ReactNode } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { Text } from '@xgenia-core-ui/components/typography/Text';
import { Slot } from '@xgenia-core-ui/types/global';

import css from './AiChatCard.module.scss';

export interface AiChatCardProps {
  title: string;
  subtitle?: string;
  children?: Slot;
}

export function AiChatCard({ title, subtitle, children }: AiChatCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <Box hasXSpacing hasYSpacing={1}>
      <div className={classNames([css['Root'], mounted ? css['Mounted'] : css['Mounting']])}>
        <div className={css['Container']}>
          <Label size={LabelSize.Big} hasBottomSpacing>
            {title}
          </Label>
          {subtitle && <Text>{subtitle}</Text>}
        </div>
        {children}
      </div>
    </Box>
  );
}
