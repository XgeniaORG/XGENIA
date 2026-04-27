import React, { useState, ReactNode } from 'react';

import type { Slot } from '@xgenia-core-ui/types/global';

export interface RuleDropdownProps {
  label: Slot;
  value: string;

  dropdownItems: string[];

  onItemSelected: (value: string) => void;
}

export function RuleDropdown({ label, value, dropdownItems, onItemSelected }: RuleDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  return (
    <div className="queryeditor-component hoverable" onClick={() => setShowDropdown(!showDropdown)}>
      <div className="queryeditor-property-inner">
        <div className="queryeditor-property-label">{label as ReactNode}</div>
        {value}
      </div>

      <i className="queryeditor-caret-icon fa fa-caret-down" />

      {showDropdown ? (
        <div className="queryeditor-dropdown">
          {dropdownItems.map((p) => (
            <div
              key={p}
              className="queryeditor-dropdown-item"
              onClick={(e) => {
                onItemSelected(p);
                setShowDropdown(false);
                e.stopPropagation();
              }}
            >
              {p}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
