import React from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';
import { SideAddNode } from '../../SidePanel/SidebarIcons';

import css from './AddNodeAction.module.scss';

/** The green + that used to sit at the top of the sidebar strip. Shows the node picker. */
export function AddNodeAction() {
  return (
    <button
      type="button"
      className={css.Root}
      onClick={() => SidebarModel.instance.switch('node-picker')}
      aria-label="Add node"
      data-test="add-node-action"
    >
      <SideAddNode size={12} color="currentColor" />
      <span>Add node</span>
    </button>
  );
}
