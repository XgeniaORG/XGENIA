import React from 'react';

import { IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { SidebarModel } from '@xgenia-models/sidebar';

import { SideAddNode } from '../SidePanel/SidebarIcons';
import css from './Rail.module.scss';

interface Props {
  showAfterMs: number;
  onTooltipClosed?: () => void;
}

/**
 * The green + that used to sit at the very top of the sidebar strip, before this redesign
 * briefly moved it into the panel card's header as `headerAction` (Components' only
 * consumer of that slot). Deleting the header took the only way to reach the node picker
 * with it — this restores it to its original home, directly under the identity chip and
 * above the top cluster. Opens the node picker exactly as
 * views/panels/componentspanel/AddNodeAction.tsx does.
 */
export function AddNodeButton({ showAfterMs, onTooltipClosed }: Props) {
  return (
    <div className={css.Item} onMouseLeave={onTooltipClosed}>
      <Tooltip content="Add node" renderDirection={DialogRenderDirection.Horizontal} showAfterMs={showAfterMs}>
        <IconButton
          icon={SideAddNode}
          size={IconSize.Small}
          variant={IconButtonVariant.Transparent}
          onClick={() => SidebarModel.instance.switch('node-picker')}
          testId="add-node-action"
          aria-label="Add node"
          UNSAFE_className={css.AddNodeButton}
        />
      </Tooltip>
    </div>
  );
}
