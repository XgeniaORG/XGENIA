import classNames from 'classnames';
import React, { MouseEventHandler, RefObject } from 'react';

import { IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { IconButton, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { BaseDialog, DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { HStack } from '@xgenia-core-ui/components/layout/Stack';
import { ContextMenu } from '@xgenia-core-ui/components/popups/ContextMenu';
import { MenuDialogProps } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';

import css from './PopupToolbar.module.scss';

export interface PopupToolbarItem {
  icon: IconName;
  tooltip: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  isDisabled?: boolean;
}

export interface PopupToolbarProps {
  menuItems: PopupToolbarItem[];
  contextMenuItems: MenuDialogProps['items'];
}

export function PopupToolbar({ menuItems, contextMenuItems }: PopupToolbarProps) {
  return (
    <div tabIndex={1} className={classNames(css['Root'])}>
      <HStack UNSAFE_className={classNames(css['IconList'])}>
        {menuItems.map((item) => (
          <Tooltip content={item.tooltip} showAfterMs={300}>
            <IconButton
              variant={IconButtonVariant.SemiTransparent}
              icon={item.icon}
              onClick={item.onClick}
              size={IconSize.Default}
            />
          </Tooltip>
        ))}
        {Boolean(contextMenuItems?.length) && (
          <ContextMenu
            menuItems={contextMenuItems}
            size={IconSize.Default}
            variant={IconButtonVariant.SemiTransparent}
            renderDirection={DialogRenderDirection.Horizontal}
          />
        )}
      </HStack>
    </div>
  );
}
