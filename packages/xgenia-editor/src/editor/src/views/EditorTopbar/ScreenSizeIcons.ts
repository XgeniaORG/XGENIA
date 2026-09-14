// Kept out of ScreenSizes.ts so that file stays pure data with no imports — it is
// unit-tested with Node's runner, which cannot resolve the @xgenia-core-ui alias.
import { IconName } from '@xgenia-core-ui/components/common/Icon';

import { ScreenSizeGroup } from './ScreenSizes';

/**
 * A Record rather than a switch: adding a group to `ScreenSizeGroup` without giving it a
 * glyph is then a compile error, not a row that silently falls through to a person icon.
 *
 * The icon set has no cabinet, terminal or upright glyph. Rather than five weak metaphors,
 * the machine families are told apart by the section label above each one — reels read as
 * columns and table games as cards, and the rest take the plain fixed-screen icon.
 */
const GROUP_ICONS: Record<ScreenSizeGroup, IconName> = {
  Desktop: IconName.DeviceDesktop,
  'Desktop small': IconName.DeviceLaptop,
  Tablet: IconName.DeviceTablet,
  Mobile: IconName.DevicePhone,
  Editor: IconName.ViewportDiagonalArrow,
  Slot: IconName.Columns,
  Table: IconName.Cards,
  Betting: IconName.DeviceDesktop,
  Bingo: IconName.DeviceDesktop,
  Arcade: IconName.DeviceDesktop
};

export function getIconFromScreenSizeGroupName(group: ScreenSizeGroup) {
  return GROUP_ICONS[group] ?? IconName.User;
}
