// One home for the hugeicons the bar uses. The core-free-icons package has subpath
// exports but no per-file types (dist/types/ ships only index.d.ts + the three loader
// declarations), hence the @ts-ignore lines — same as CanvasWithBrowserTabs.tsx.
//
// NOTE: every name below must exist as `dist/esm/<Name>.js` in @hugeicons/core-free-icons.
// The barrel index.d.ts also declares aliases (e.g. `BugIcon` -> `Bug01Icon`) that have no
// subpath file of their own; importing one of those would resolve to nothing at bundle time.
import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
// @ts-ignore
import ComputerIcon from '@hugeicons/core-free-icons/ComputerIcon';
// @ts-ignore
import GlobeIcon from '@hugeicons/core-free-icons/GlobeIcon';
// @ts-ignore
import MoreHorizontalIcon from '@hugeicons/core-free-icons/MoreHorizontalIcon';
// @ts-ignore
import Copy01Icon from '@hugeicons/core-free-icons/Copy01Icon';
// @ts-ignore
import LinkSquare02Icon from '@hugeicons/core-free-icons/LinkSquare02Icon';
// @ts-ignore
import SparklesIcon from '@hugeicons/core-free-icons/SparklesIcon';
// @ts-ignore
import Tick02Icon from '@hugeicons/core-free-icons/Tick02Icon';
// @ts-ignore
import ArrowUp02Icon from '@hugeicons/core-free-icons/ArrowUp02Icon';
// @ts-ignore
import Alert02Icon from '@hugeicons/core-free-icons/Alert02Icon';
// @ts-ignore
import PencilEdit02Icon from '@hugeicons/core-free-icons/PencilEdit02Icon';
// @ts-ignore
import PlayIcon from '@hugeicons/core-free-icons/PlayIcon';
// @ts-ignore
import Home01Icon from '@hugeicons/core-free-icons/Home01Icon';
// @ts-ignore
import ArrowDown01Icon from '@hugeicons/core-free-icons/ArrowDown01Icon';
// @ts-ignore
import ArrowRight01Icon from '@hugeicons/core-free-icons/ArrowRight01Icon';
// @ts-ignore
import SmartPhone01Icon from '@hugeicons/core-free-icons/SmartPhone01Icon';
// @ts-ignore
import Tablet01Icon from '@hugeicons/core-free-icons/Tablet01Icon';
// @ts-ignore
import Bug01Icon from '@hugeicons/core-free-icons/Bug01Icon';
// @ts-ignore
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon';
// @ts-ignore
import Layers01Icon from '@hugeicons/core-free-icons/Layers01Icon';
// @ts-ignore
import LayoutLeftIcon from '@hugeicons/core-free-icons/LayoutLeftIcon';
// @ts-ignore
import LayoutTopIcon from '@hugeicons/core-free-icons/LayoutTopIcon';

export const I = {
  monitor: ComputerIcon, globe: GlobeIcon, more: MoreHorizontalIcon, copy: Copy01Icon, external: LinkSquare02Icon,
  sparkle: SparklesIcon, check: Tick02Icon, arrowUp: ArrowUp02Icon, warning: Alert02Icon, pencil: PencilEdit02Icon,
  play: PlayIcon, home: Home01Icon, caret: ArrowDown01Icon, chevRight: ArrowRight01Icon, phone: SmartPhone01Icon,
  tablet: Tablet01Icon, bug: Bug01Icon, download: Download04Icon, layers: Layers01Icon,
  splitVertical: LayoutLeftIcon, splitHorizontal: LayoutTopIcon
} as const;

export type IconKey = keyof typeof I;

export function Hi({ icon, size = 14, color = 'currentColor', className }: { icon: IconKey; size?: number; color?: string; className?: string }) {
  return React.createElement(HugeiconsIcon, { icon: I[icon], size, color, className, strokeWidth: 1.6 });
}
