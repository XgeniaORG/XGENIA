export type ScreenSize = {
  name: string;
  group: ScreenSizeGroup;
  width: number;
  height: number;
};

/** Consumer hardware you hold or sit at. */
export type DeviceGroup = 'Mobile' | 'Tablet' | 'Desktop' | 'Desktop small' | 'Editor';
/** Gaming hardware you stand at: cabinets, terminals, kiosks, uprights. */
export type MachineGroup = 'Slot' | 'Table' | 'Betting' | 'Bingo' | 'Arcade';
export type ScreenSizeGroup = DeviceGroup | MachineGroup;

/** Which list a preset belongs to. The frame popover shows one surface at a time. */
export type ScreenSurface = 'device' | 'machine';

const MACHINE_GROUPS: readonly ScreenSizeGroup[] = ['Slot', 'Table', 'Betting', 'Bingo', 'Arcade'];

export function isMachineGroup(group: ScreenSizeGroup): group is MachineGroup {
  return MACHINE_GROUPS.includes(group);
}

/** Heads both lists: "no fixed size" is a choice you make about either kind of target. */
const FIT_VIEWPORT: ScreenSize = {
  name: 'Fit viewport',
  group: 'Editor',
  width: null,
  height: null
};

const DEVICE_PRESETS_WITH_DIVIDERS: (ScreenSize | 'divider')[] = [
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

/**
 * The machine list, by family.
 *
 * Named in plain words, never by manufacturer or model. A cabinet lineup refreshes every
 * couple of years, the panel specs behind a model name are not ours to assert, and a
 * trademark is not a label to hand a user. The industry words people actually type —
 * etg, egm, ssbt, vlt — live in `topbarCommands` as search terms instead, so they find
 * the shape without XGENIA printing jargon at anyone.
 *
 * Sizes repeat ACROSS families on purpose: a betting terminal and a slot cabinet really
 * are both 1080x1920. That is why a preset's identity is its NAME, and why the chip reads
 * back the stored `deviceName` rather than reverse-looking-up the measurements.
 */
export const machineFamilies: { label: string; presets: ScreenSize[] }[] = [
  {
    label: 'Slot cabinets',
    presets: [
      { name: 'Slot portrait FHD', group: 'Slot', width: 1080, height: 1920 },
      { name: 'Slot portrait 4K', group: 'Slot', width: 2160, height: 3840 },
      { name: 'Slot portrait HD', group: 'Slot', width: 720, height: 1280 },
      { name: 'Slot ultrawide 21:9', group: 'Slot', width: 2560, height: 1080 },
      { name: 'Slot ultrawide 32:9', group: 'Slot', width: 3840, height: 1080 },
      { name: 'Slot legacy 5:4', group: 'Slot', width: 1280, height: 1024 },
      { name: 'Slot legacy 4:3', group: 'Slot', width: 1024, height: 768 }
    ]
  },
  {
    label: 'Roulette & table',
    presets: [
      { name: 'Roulette terminal', group: 'Table', width: 1920, height: 1080 },
      { name: 'Roulette terminal 4K', group: 'Table', width: 3840, height: 2160 },
      { name: 'Table big screen', group: 'Table', width: 2560, height: 1440 }
    ]
  },
  {
    label: 'Betting terminals',
    presets: [
      { name: 'Betting terminal', group: 'Betting', width: 1080, height: 1920 },
      { name: 'Betting kiosk 4K', group: 'Betting', width: 2160, height: 3840 },
      { name: 'Betting counter', group: 'Betting', width: 1920, height: 1080 }
    ]
  },
  {
    label: 'Bingo & lottery',
    presets: [
      { name: 'Bingo handheld', group: 'Bingo', width: 1280, height: 800 },
      { name: 'Bingo unit', group: 'Bingo', width: 1280, height: 1024 },
      { name: 'Lottery terminal', group: 'Bingo', width: 1024, height: 768 }
    ]
  },
  {
    label: 'Arcade',
    presets: [
      { name: 'Arcade landscape', group: 'Arcade', width: 1920, height: 1080 },
      { name: 'Arcade vertical', group: 'Arcade', width: 1080, height: 1920 }
    ]
  }
];

const MACHINE_PRESETS: ScreenSize[] = machineFamilies.flatMap((family) => family.presets);

/** Flat, divider-separated forms — what the popover renders, one surface at a time. */
export const deviceSizesWithDividers: (ScreenSize | 'divider')[] = [
  FIT_VIEWPORT,
  'divider',
  ...DEVICE_PRESETS_WITH_DIVIDERS
];

export const machineSizesWithDividers: (ScreenSize | 'divider')[] = [
  FIT_VIEWPORT,
  'divider',
  ...machineFamilies.flatMap((family, i) => (i === 0 ? family.presets : ['divider' as const, ...family.presets]))
];

/**
 * Every preset in one list, devices first.
 *
 * Devices lead so that a size both surfaces claim (1920x1080) still resolves to the
 * desktop preset for callers that only have measurements to go on — the labelling those
 * callers produced before machines existed does not change under them.
 */
export const screenSizesWithDividers: (ScreenSize | 'divider')[] = [
  FIT_VIEWPORT,
  'divider',
  ...DEVICE_PRESETS_WITH_DIVIDERS,
  'divider',
  ...MACHINE_PRESETS
];

//@ts-expect-error TODO: make proper type when i know it works
export const screenSizes: ScreenSize[] = screenSizesWithDividers.filter((item) => typeof item !== 'string');

export function surfaceOfGroup(group: ScreenSizeGroup): ScreenSurface {
  return isMachineGroup(group) ? 'machine' : 'device';
}

export function sizesForSurface(surface: ScreenSurface): (ScreenSize | 'divider')[] {
  return surface === 'machine' ? machineSizesWithDividers : deviceSizesWithDividers;
}

/**
 * Resolve measurements back to a preset.
 *
 * `preferredName` wins when it is given and matches, because sizes repeat across
 * families: 1080x1920 is a slot cabinet AND a betting terminal, and only the name the
 * user actually picked says which. Callers holding just a width and height still get the
 * old behaviour — first match, devices first.
 */
export function getScreenSizeObjectFromMeasurements(width: number, height: number, preferredName?: string | null) {
  if (preferredName) {
    const named = screenSizes.find(
      (screen) => screen.name === preferredName && screen.width === width && screen.height === height
    );
    if (named) return named;
  }
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
