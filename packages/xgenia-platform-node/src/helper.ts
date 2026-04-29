import { PlatformOS } from "@xgenia/platform";

export function processPlatformToPlatformOS() {
  switch (process.platform) {
    default:
      return PlatformOS.Unknown;
    case "darwin":
      return PlatformOS.MacOS;
    case "win32":
      return PlatformOS.Windows;
    case "linux":
      return PlatformOS.Linux;
  }
}
