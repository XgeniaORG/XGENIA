import React, { ReactNode } from 'react';

import css from './InputLabelSection.module.scss';

export interface InputLabelSectionProps {
  label: string;
  children?: ReactNode;
}

export function InputLabelSection({ label, children }: InputLabelSectionProps) {
  return (
    <div className={css['Root']}>
      {label}
      {children}
    </div>
  );
}
