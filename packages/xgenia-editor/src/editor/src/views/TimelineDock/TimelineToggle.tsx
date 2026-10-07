import classNames from 'classnames';
import React from 'react';

import { TimelineState } from '../../models/timelineState';
import { useTimelineState } from './TimelineDock';
import css from './TimelineDock.module.scss';
import { Hi } from '../EditorTopbar/topbar/icons';

/** Top-bar button that shows or hides the Timeline dock. */
export function TimelineToggle() {
  const state = useTimelineState();
  return (
    <button
      type="button"
      className={classNames(css.Toggle, state.open && css.isActive, state.recording && css.isRecording)}
      aria-pressed={state.open}
      title={state.open ? 'Hide the Timeline' : 'Show the Timeline (keyframe animation)'}
      aria-label="Timeline"
      onClick={() => TimelineState.toggle()}
    >
      <Hi icon="keyframes" size={14} />
    </button>
  );
}
