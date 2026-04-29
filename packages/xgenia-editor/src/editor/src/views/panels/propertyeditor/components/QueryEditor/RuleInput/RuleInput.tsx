import React, { useState, useEffect, type ReactNode } from 'react';

import { InputLabelSection } from '@xgenia-core-ui/components/inputs/InputLabelSection';
import type { Slot } from '@xgenia-core-ui/types/global';

export interface RuleInputProps {
  label: Slot;
  value: string;

  onChange: (value: string) => void;
}

export function RuleInput({ label, value, onChange }: RuleInputProps) {
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    // Ensure value is always treated as a string
    const stringValue = typeof value === 'string' ? value : 
                       value !== null && value !== undefined ? String(value) : '';
    setInputValue(stringValue);
  }, [value]);

  return (
    <div className="queryeditor-component">
      <div className="queryeditor-property-inner">
        <InputLabelSection label={String(label)}>
          <input
            className="queryeditor-value-input"
            value={inputValue}
            onChange={(e) => {
              onChange(e.target.value);
              setInputValue(e.target.value);
            }}
          />
        </InputLabelSection>
      </div>
    </div>
  );
}
