import { IconName } from '@xgenia-core-ui/components/common/Icon';

export type ScreenSize = {
  name: string;
  group: 'Mobile' | 'Tablet' | 'Desktop' | 'Desktop small' | 'Editor';
  width: number;
  height: number;
};

export const screenSizesWithDividers: (ScreenSize | 'divider')[] = [
  {
    name: 'Fit viewport',
    group: 'Editor',
    width: null,
    height: null
  },
  'divider',
  // Desktop - Large Monitors
  {
    name: '4K UHD',
    group: 'Desktop',
    width: 3840,
    height: 2160
  },
  {
    name: 'QHD 2K',
    group: 'Desktop',
    width: 2560,
    height: 1440
  },
  {
    name: 'Full HD 1080p',
    group: 'Desktop',
    width: 1920,
    height: 1080
  },
  'divider',
  // Desktop - Laptops
  {
    name: 'MacBook Pro 16"',
    group: 'Desktop small',
    width: 1728,
    height: 1117
  },
  {
    name: 'MacBook Pro 14"',
    group: 'Desktop small',
    width: 1512,
    height: 982
  },
  {
    name: 'MacBook Air 13"',
    group: 'Desktop small',
    width: 1470,
    height: 956
  },
  {
    name: 'Laptop HD',
    group: 'Desktop small',
    width: 1366,
    height: 768
  },
  {
    name: 'HD 720p',
    group: 'Desktop small',
    width: 1280,
    height: 720
  },
  'divider',
  // Tablets - Portrait
  {
    name: 'iPad Pro 12.9"',
    group: 'Tablet',
    width: 1024,
    height: 1366
  },
  {
    name: 'iPad Pro 11"',
    group: 'Tablet',
    width: 834,
    height: 1194
  },
  {
    name: 'iPad Air / iPad 10th',
    group: 'Tablet',
    width: 820,
    height: 1180
  },
  {
    name: 'iPad 9.7" / Mini',
    group: 'Tablet',
    width: 768,
    height: 1024
  },
  {
    name: 'Android Tablet',
    group: 'Tablet',
    width: 800,
    height: 1280
  },
  {
    name: 'Galaxy Tab S9',
    group: 'Tablet',
    width: 753,
    height: 1205
  },
  'divider',
  // Mobile - iOS
  {
    name: 'iPhone 15 Pro Max',
    group: 'Mobile',
    width: 430,
    height: 932
  },
  {
    name: 'iPhone 15 Pro',
    group: 'Mobile',
    width: 393,
    height: 852
  },
  {
    name: 'iPhone 14 / 13',
    group: 'Mobile',
    width: 390,
    height: 844
  },
  {
    name: 'iPhone SE',
    group: 'Mobile',
    width: 375,
    height: 667
  },
  'divider',
  // Mobile - Android
  {
    name: 'Samsung Galaxy S24 Ultra',
    group: 'Mobile',
    width: 412,
    height: 915
  },
  {
    name: 'Samsung Galaxy S24',
    group: 'Mobile',
    width: 360,
    height: 780
  },
  {
    name: 'Pixel 8 Pro',
    group: 'Mobile',
    width: 448,
    height: 998
  },
  {
    name: 'Pixel 8',
    group: 'Mobile',
    width: 412,
    height: 915
  },
  {
    name: 'Common Android',
    group: 'Mobile',
    width: 360,
    height: 800
  }
];

//@ts-expect-error TODO: make proper type when i know it works
export const screenSizes: ScreenSize[] = screenSizesWithDividers.filter((item) => typeof item !== 'string');

export function getIconFromScreenSizeGroupName(group: ScreenSize['group']) {
  switch (group) {
    case 'Desktop':
      return IconName.DeviceDesktop;
    case 'Desktop small':
      return IconName.DeviceLaptop;
    case 'Tablet':
      return IconName.DeviceTablet;
    case 'Mobile':
      return IconName.DevicePhone;
    case 'Editor':
      return IconName.ViewportDiagonalArrow;
    default:
      return IconName.User;
  }
}

export function getScreenSizeObjectFromMeasurements(width: number, height: number) {
  const size = screenSizes.find((screen) => screen.width === width && screen.height === height);
  if (size) return size;
  if (width && height) {
    return {
      name: 'Custom',
      group: 'Editor' as const,
      width,
      height
    };
  }
  return screenSizes[0];
}
