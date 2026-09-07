import React, { MouseEventHandler } from 'react';

import Tooltip from '../../../../../reactcomponents/tooltip';

export interface TranslationsTablePropertyProps {
  displayName: string;
  tooltip?: string;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

/** The property panel row: a label and the button that opens the table. */
export function TranslationsTableProperty({ displayName, tooltip, onClick }: TranslationsTablePropertyProps) {
  return (
    <div data-template="translations-table" style={{ height: '35px', position: 'relative' }}>
      <Tooltip enabled={!!tooltip} text={tooltip}>
        <label className="property-label">{displayName}</label>
      </Tooltip>

      <div className="property-value">
        <button
          type="button"
          style={{ width: '100%', height: '100%' }}
          className="property-codeeditor-button"
          onClick={onClick}
          data-identifier={displayName}
        >
          Open Table
        </button>
      </div>
    </div>
  );
}
