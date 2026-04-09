import React from 'react';

import { InputLabelSection } from '@xgenia-core-ui/components/inputs/InputLabelSection';
import { Box } from '@xgenia-core-ui/components/layout/Box';
import { VStack } from '@xgenia-core-ui/components/layout/Stack';
import { Slot } from '@xgenia-core-ui/types/global';

import css from './ModalSection.module.scss';

export interface ModalSectionProps {
   children: ReactNode;

  label?: string;
}

export function ModalSection({ children, label }: ModalSectionProps) {
  return (
    <Box hasTopSpacing={2}>
      {label && <InputLabelSection label={label} />}
      <Box hasYSpacing hasXSpacing UNSAFE_className={css['Root']}>
        <VStack hasSpacing>{children}</VStack>
      </Box>
    </Box>
  );
}
