import classNames from 'classnames';
import React, { useRef, useState } from 'react';

import {
  SideNavigationContextProvider,
  useSideNavigationContext
} from '@xgenia-core-ui/components/app/SideNavigation/SideNavigation.context';
import { IconName,IconSize } from '@xgenia-core-ui/components/common/Icon';
import { Logo, LogoSize } from '@xgenia-core-ui/components/common/Logo';
import { IconButton, IconButtonState, IconButtonVariant } from '@xgenia-core-ui/components/inputs/IconButton';
import { DialogRenderDirection } from '@xgenia-core-ui/components/layout/BaseDialog';
import { MenuDialog, MenuDialogProps } from '@xgenia-core-ui/components/popups/MenuDialog';
import { Tooltip } from '@xgenia-core-ui/components/popups/Tooltip';
import { Slot } from '@xgenia-core-ui/types/global';

import css from './SideNavigation.module.scss';

export interface SideNavigationButtonProps {
  isActive?: boolean;
  icon: IconName | React.ElementType;
  label: string;
  fineType?: string;
  notification?: { count: number };
  isDisabled?: boolean;
  testId?: string;
  onClick?: () => void;
  menuItems?: MenuDialogProps['items'];
  // New: optional icon size override for cleaner/smaller icons when needed
  size?: IconSize;
}

export function SideNavigationButton({
  isActive,
  icon,
  label,
  fineType,
  notification,
  isDisabled,
  testId,
  onClick,
  menuItems,
  size
}: SideNavigationButtonProps) {
  const context = useSideNavigationContext();
  const iconRef = useRef<HTMLDivElement>(null);
  const hasMenu = Boolean(menuItems);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  // NOTE: Commented out extending sidebar labels in case we want to bring them back at some point

  return (
    <div
      className={css['SideNavigationButton']}
      onClick={() => {
        !isDisabled && onClick && onClick();
        //context.setIsShowingTooltips(false);
      }}
      // onMouseEnter={() => context.setIsShowingTooltips(true)}
      // onMouseLeave={() => context.setIsShowingTooltips(false)}
      data-test={testId}
    >
      {hasMenu && (
        <MenuDialog
          items={menuItems}
          onClose={() => setIsMenuVisible(false)}
          triggerRef={iconRef}
          isVisible={isMenuVisible}
        />
      )}

      <div className={css['IconButtonContainer']} ref={iconRef} onClick={() => hasMenu && setIsMenuVisible(true)}>
        <Tooltip
          content={label}
          fineType={fineType}
          renderDirection={DialogRenderDirection.Horizontal}
          showAfterMs={300}
        >
          <IconButton
            size={size ?? (icon === 'logo' && IconSize.VLarge)}
            variant={IconButtonVariant.Transparent}
            state={isActive ? IconButtonState.Active : IconButtonState.Default}
            icon={icon}
            isDisabled={isDisabled}
          />
        </Tooltip>
        {notification && (
          <div className={css['NotificationBadge']}>{notification.count > 99 ? '99+' : notification.count}</div>
        )}
      </div>

      {/* <div
        className={classNames(css['Label'], context.isShowingTooltips && css['is-tooltip-visible'])}
        onClick={() => hasMenu && setIsMenuVisible(true)}
      >
        <div className={classNames(css['LabelInner'], isActive && css['is-active'])}>
          <Text textType={isActive ? TextType.Proud : TextType.Shy}>{label}</Text>
          {fineType && (
            <Label size={LabelSize.Small} variant={TextType.Shy} UNSAFE_className={css['Command']}>
              {fineType}
            </Label>
          )}
        </div>
      </div> */}
    </div>
  );
}

export interface SideNavigationProps {
  toolbar: Slot;
  panel: Slot;

  onExitClick?: React.MouseEventHandler<HTMLDivElement>;
  // New: optional custom header slot to replace the default logo
  header?: React.ReactNode;
}

export function SideNavigation({ toolbar, panel, onExitClick, header }: SideNavigationProps) {
  return (
    <SideNavigationContextProvider>
      <div className={css['Root']}>
        <div className={css['Panel']}>{panel}</div>

        <div className={css['Toolbar']}>
          <div className={css['Logo']}>
            {header ? (
              header
            ) : (
              <Tooltip
                content="Exit project"
                renderDirection={DialogRenderDirection.Horizontal}
                showAfterMs={300}
              >
                <div onClick={onExitClick} style={{ cursor: 'pointer' }}>
                  <Logo size={LogoSize.Large} />
                </div>
              </Tooltip>
            )}
          </div>

          {toolbar}
        </div>
      </div>
    </SideNavigationContextProvider>
  );
}
