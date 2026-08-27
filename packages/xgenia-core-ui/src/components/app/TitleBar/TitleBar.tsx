import classNames from 'classnames';
import React from 'react';

import { FeedbackType } from '@xgenia-constants/FeedbackType';
import { Logo, LogoSize } from '@xgenia-core-ui/components/common/Logo';

import { TextButton, TextButtonSize } from '@xgenia-core-ui/components/inputs/TextButton';

import css from './TitleBar.module.scss';

export enum TitleBarVariant {
  Default = 'default',
  Shallow = 'shallow'
}

export enum TitleBarState {
  Default = 'default',
  UpdateAvailable = 'version-available',
  Updated = 'version-updated'
}

export interface TitleBarProps {
  title: string;
  version?: string;

  state?: TitleBarState;
  variant?: TitleBarVariant;

  onNewVersionAvailableClicked?: () => void;
  onNewUpdateAvailableClicked?: () => void;

  /**
   * Draw our own minimize/maximize/close buttons (and the logo they sit opposite).
   *
   * The window is frameless, so the only platform that still gets controls from the OS
   * is macOS, where `titleBarStyle: 'hidden'` keeps the traffic lights. Windows and
   * Linux get nothing from the WM and have to be served from here.
   */
  hasWindowControls?: boolean;
  /**
   * Current window state. Swaps the maximize button's single-window glyph for the
   * two-window restore glyph, so the button shows what it will do next.
   */
  isMaximized?: boolean;
  onMinimizeClicked?: () => void;
  onMaximizeClicked?: () => void;
  onCloseClicked?: () => void;
}

export function TitleBar({
  title,
  version,
  state = TitleBarState.Default,
  variant = TitleBarVariant.Default,
  onNewVersionAvailableClicked,
  onNewUpdateAvailableClicked,
  hasWindowControls,
  isMaximized,
  onMinimizeClicked,
  onMaximizeClicked,
  onCloseClicked
}: TitleBarProps) {
  return (
    <div className={classNames([css['Root'], css[`is-variant-${variant}`], hasWindowControls && css['has-window-controls']])}>

      {hasWindowControls && (
        <Logo size={LogoSize.Medium} />
      )}


      {/* Project title removed - was overlapping macOS window controls */}

      {Boolean(variant === TitleBarVariant.Default) && (
        <>
          {state === TitleBarState.UpdateAvailable && (
            <TextButton
              label={`New version available`}
              onClick={onNewVersionAvailableClicked}
              size={TextButtonSize.Small}
              variant={FeedbackType.Notice}
              //@ts-ignore
              UNSAFE_style={{ WebkitAppRegion: 'no-drag' }} //make it clickable
              hasLeftSpacing
              hasRightSpacing
            />
          )}

          {state === TitleBarState.Updated && (
            <TextButton
              label="New update downloaded"
              onClick={onNewUpdateAvailableClicked}
              size={TextButtonSize.Small}
              variant={FeedbackType.Notice}
              //@ts-ignore
              UNSAFE_style={{ WebkitAppRegion: 'no-drag' }} //make it clickable
              hasLeftSpacing
              hasRightSpacing
            />
          )}

          {Boolean(version) && <div className={classNames(css['Version'])}>{version}</div>}
        </>
      )}

      {Boolean(hasWindowControls) && (
        <div className={classNames(css['OSWindows'])}>
          {Boolean(variant === TitleBarVariant.Default) && (
            <>
              <div
                className={classNames([css['OSWindowsIcon'], css['OSWindowsIcon__Minimize']])}
                onClick={onMinimizeClicked}
              ></div>
              <div
                className={classNames([
                  css['OSWindowsIcon'],
                  isMaximized ? css['OSWindowsIcon__Restore'] : css['OSWindowsIcon__Maximize']
                ])}
                onClick={onMaximizeClicked}
              ></div>
            </>
          )}
          <div
            className={classNames([css['OSWindowsIcon'], css['OSWindowsIcon__Close']])}
            onClick={onCloseClicked}
          ></div>
        </div>
      )}
    </div>
  );
}
