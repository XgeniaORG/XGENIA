import { platform, PlatformOS } from '@xgenia/platform';
import { KeyCodeUtils } from '@xgenia-utils/keyboard/KeyCodeMapper';

import { formatAccelerator, keybindingAccelerator } from './shortcutRows';

export const IS_MAC = platform.os === PlatformOS.MacOS;

/** An Electron accelerator ('CmdOrCtrl+O') as this platform writes it: ⌘O, or Ctrl+O. */
export function acceleratorLabel(accelerator: string): string {
  return formatAccelerator(accelerator, IS_MAC);
}

/** A KeyboardHandler keybinding (e.g. Keybindings.PUBLISH.hash) as this platform writes it. */
export function keybindingLabel(keybinding: number): string {
  return formatAccelerator(keybindingAccelerator(keybinding, KeyCodeUtils.toString(keybinding & 0xff)), IS_MAC);
}
