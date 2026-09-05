import classNames from 'classnames';
import React from 'react';

import { Keybindings } from '@xgenia-constants/Keybindings';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import { Hi } from './icons';
import css from './ModeSegment.module.scss';

export interface ModeSegmentProps {
  previewMode: boolean;
  onChange: (preview: boolean) => void;
}

/**
 * The Edit | Preview segmented control. Replaces the single-icon mode toggle: the
 * two modes are now both visible and labelled, so the bar states which one is live
 * instead of showing the icon of the mode you would switch to.
 */
export function ModeSegment({ previewMode, onChange }: ModeSegmentProps) {
  return (
    <Tooltip
      content={previewMode ? 'Preview mode. Click Edit to inspect nodes.' : 'Edit mode. Click Preview to play.'}
      fineType={Keybindings.TOGGLE_PREVIEW_MODE.label}
      UNSAFE_triggerClassName={css.SegTrigger}
    >
      <div className={css.Seg} role="group" aria-label="Editor mode">
        <button
          type="button"
          className={classNames(css.SegBtn, !previewMode && css.isActive)}
          onClick={() => onChange(false)}
                    aria-pressed={!previewMode}
        >
          <Hi icon="pencil" size={12} />
          Edit
        </button>
        <button
          type="button"
          className={classNames(css.SegBtn, previewMode && css.isPreview)}
          onClick={() => onChange(true)}
                    aria-pressed={previewMode}
        >
          <Hi icon="play" size={12} />
          Preview
        </button>
      </div>
    </Tooltip>
  );
}
