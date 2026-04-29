import classNames from 'classnames';
import React, { MouseEventHandler } from 'react';

import { Icon, IconName, IconSize, IconVariant } from '@xgenia-core-ui/components/common/Icon';
import { Label, LabelSize } from '@xgenia-core-ui/components/typography/Label';
import { UnsafeStyleProps } from '@xgenia-core-ui/types/global';

import css from './IconButton.module.scss';

export enum IconButtonVariant {
  Default = 'is-variant-default',
  Transparent = 'is-variant-transparent',
  SemiTransparent = 'is-variant-semi-transparent',
  OpaqueOnHover = 'is-variant-opaque-on-hover'
}

export enum IconButtonState {
  Default = 'is-state-default',
  Active = 'is-state-active',
  Rotated = 'is-state-rotated'
}

export enum IconButtonSize {
  Default = 'is-button-size-default',
  Bigger = 'is-button-size-bigger'
}

export interface IconButtonProps extends UnsafeStyleProps {
  icon: IconName | React.ElementType;
  size?: IconSize;
  buttonSize?: IconButtonSize;
  variant?: IconButtonVariant;
  state?: IconButtonState;
  iconVariant?: IconVariant;
  label?: string;
  // Optional: explicit icon color override for external icon components
  iconColor?: string;

  isDisabled?: boolean;
  testId?: string;
  id?: string;

  onClick?: MouseEventHandler<HTMLButtonElement>;
}

function iconSizeToLabelSize(iconSize: IconSize): LabelSize {
  switch (iconSize) {
    case IconSize.Large:
      return LabelSize.Big;
    case IconSize.Small:
      return LabelSize.Small;
    case IconSize.Tiny:
      return LabelSize.Small;
    default:
      return LabelSize.Default;
  }
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      icon,
      size = IconSize.Default,
      buttonSize = IconButtonSize.Default,
      variant = IconButtonVariant.Default,
      state = IconButtonState.Default,
      iconVariant,
      isDisabled,
      label,
      testId,
      onClick,
      UNSAFE_className,
      UNSAFE_style,
      id,
      iconColor: iconColorOverride
    }: IconButtonProps,
    ref
  ) => {
    const isIconName = typeof icon === 'string';
    const IconComponent = !isIconName ? icon : null;

    // Determine the color based on the button state for external icons, allowing override
    const iconColor = iconColorOverride ?? (state === IconButtonState.Active
      ? '#FFFFFF'
      : 'rgba(255, 255, 255, 0.45)');

    return (
      <button
        ref={ref}
        id={id}
        className={classNames(
          css['Root'],
          css[variant],
          css[state],
          css[buttonSize],
          isIconName && css[`is-icon-variant-${iconVariant}`],
          !isIconName && css['is-external-icon'],
          UNSAFE_className
        )}
        onClick={onClick}
        disabled={isDisabled}
        style={UNSAFE_style}
        data-test={testId}
      >
        {isIconName ? (
          <Icon icon={icon as IconName} size={size} UNSAFE_className={css['Icon']} variant={iconVariant} />
        ) : (
          IconComponent && <IconComponent
            size={IconSizeMap[size]}
            color={iconColor}
            fill="none"
            style={{ fill: 'none' }}
          />
        )}
        {label && (
          <Label size={iconSizeToLabelSize(size)} variant={iconVariant} UNSAFE_className={css.Label}>
            {label}
          </Label>
        )}
      </button>
    );
  }
);

const IconSizeMap = {
  [IconSize.Default]: 24,
  [IconSize.Large]: 32,
  [IconSize.VLarge]: 60,
  [IconSize.Small]: 16,
  [IconSize.Tiny]: 12
};
