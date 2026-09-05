import { Keybinding } from '@xgenia-utils/keyboard/Keybinding';
import { KeyCode, KeyMod } from '@xgenia-utils/keyboard/KeyCode';

export namespace Keybindings {
  export const SEARCH = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_F);

  export const CLOUD_SERVICE_OPEN_DASHBOARD = new Keybinding(KeyMod.CtrlCmd, KeyMod.Shift, KeyCode.KEY_P);
  export const CLOUD_SERVICE_OPEN_DASHBOARD_BROWSER = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_P);

  export const REFRESH_PREVIEW = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_R);
  export const OPEN_DEVTOOLS = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_D);
  export const OPEN_CLOUD_DEVTOOLS = new Keybinding(KeyMod.CtrlCmd, KeyMod.Shift, KeyCode.KEY_R);
  export const TOGGLE_PREVIEW_MODE = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_T);

  /** Focus the top bar's status pill input (pages + typed commands). */
  export const FOCUS_TOPBAR = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_L);

  export const PREVIEW_PRESET_PHONE = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_1);
  export const PREVIEW_PRESET_TABLET = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_2);
  export const PREVIEW_PRESET_DESKTOP = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_3);
  export const PREVIEW_FIT = new Keybinding(KeyMod.CtrlCmd, KeyCode.KEY_0);
  export const DETACH_PREVIEW = new Keybinding(KeyMod.CtrlCmd, KeyMod.Shift, KeyCode.KEY_D);
  export const PUBLISH = new Keybinding(KeyMod.CtrlCmd, KeyCode.Enter);

  export const PROPERTY_PANEL_OPEN_DOCS = new Keybinding(KeyCode.F1);
  export const PROPERTY_PANEL_EDIT_LABEL = new Keybinding(KeyCode.Enter);
  export const PROPERTY_PANEL_EDIT_LABEL2 = new Keybinding(KeyCode.F2);
  export const PROPERTY_PANEL_DELETE = new Keybinding(KeyCode.Delete); // Actually node graph delete
}
