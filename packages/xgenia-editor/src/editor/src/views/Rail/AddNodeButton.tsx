import React from 'react';

import { SidebarModel } from '@xgenia-models/sidebar';

import { SideAddNode } from '../SidePanel/SidebarIcons';
import { RailButton } from './RailButton';
import { ADD_LABEL } from './railGroups';

interface Props {
  isActive: boolean;
  showAfterMs: number;
  onTooltipClosed?: () => void;
}

/**
 * "Add": opens the node picker, exactly as views/panels/componentspanel/AddNodeAction.tsx
 * does. Second item of the rail's "make" group, under AI. Not a sidebar item itself (the node
 * picker is a transient panel), so it carries its own data-guide (`rail.add`) and test id.
 * The accent tint on the plus is what is left of the green button it used to be.
 */
export function AddNodeButton({ isActive, showAfterMs, onTooltipClosed }: Props) {
  return (
    <RailButton
      id="node-picker"
      name="Add node"
      label={ADD_LABEL}
      icon={SideAddNode}
      guideId="rail.add"
      testId="add-node-action"
      isAccent
      isActive={isActive}
      showAfterMs={showAfterMs}
      onTooltipClosed={onTooltipClosed}
      onClick={() => SidebarModel.instance.switch('node-picker')}
    />
  );
}
