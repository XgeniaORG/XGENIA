import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';

// @ts-ignore – sub-path import; moduleResolution:'node' can't resolve package exports maps
import ViewIcon from '@hugeicons/core-free-icons/ViewIcon';
// @ts-ignore
import ViewOffSlashIcon from '@hugeicons/core-free-icons/ViewOffSlashIcon';
// @ts-ignore
import SquareLock02Icon from '@hugeicons/core-free-icons/SquareLock02Icon';
// @ts-ignore
import SquareUnlock02Icon from '@hugeicons/core-free-icons/SquareUnlock02Icon';

import type { GlassIconProps } from '../../SidePanel/GlassIcons';

/**
 * Rail icon for the Hierarchy panel, drawn in the rail's glass style (views/SidePanel/
 * GlassIcons.tsx): a body in the --gi-body-* gradient behind a translucent --gi-face-* face
 * with a specular top edge, so it lights up with the rail's hover and active states like the
 * generated icons do. A parent block with two children hanging off it.
 */
export function GlassHierarchy({ size = 20 }: GlassIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-glass-icon=""
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="xg-hier-body" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--gi-body-1, #9A9AA6)" />
          <stop offset="1" stopColor="var(--gi-body-2, #63636E)" />
        </linearGradient>
        <linearGradient id="xg-hier-face" x1="16" y1="9.5" x2="16" y2="21.5" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--gi-face-1, #E3E3E5)" stopOpacity="var(--gi-face-alpha, 0.6)" />
          <stop offset="1" stopColor="var(--gi-face-2, #BBBBC0)" stopOpacity="var(--gi-face-alpha, 0.6)" />
        </linearGradient>
      </defs>
      <path
        d="M6 9V18.75H10.5M6 12.25H10.5"
        fill="none"
        stroke="url(#xg-hier-body)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="2" y="2" width="9" height="7.5" rx="2.5" fill="url(#xg-hier-body)" />
      <rect x="10" y="9.5" width="12" height="5.5" rx="2" fill="url(#xg-hier-face)" />
      <rect x="10" y="16" width="12" height="5.5" rx="2" fill="url(#xg-hier-face)" />
      <rect x="11" y="9.9" width="10" height="0.7" rx="0.35" fill="var(--gi-spec, #FFFFFF)" opacity="0.55" />
      <rect x="11" y="16.4" width="10" height="0.7" rx="0.35" fill="var(--gi-spec, #FFFFFF)" opacity="0.55" />
      <rect x="3" y="2.4" width="7" height="0.7" rx="0.35" fill="var(--gi-spec, #FFFFFF)" opacity="0.35" />
    </svg>
  );
}
GlassHierarchy.displayName = 'GlassHierarchy';

interface RowIconProps {
  size?: number;
}

export function EyeIcon({ size = 13 }: RowIconProps) {
  return <HugeiconsIcon icon={ViewIcon} size={size} color="currentColor" strokeWidth={1.6} />;
}

export function EyeOffIcon({ size = 13 }: RowIconProps) {
  return <HugeiconsIcon icon={ViewOffSlashIcon} size={size} color="currentColor" strokeWidth={1.6} />;
}

export function LockIcon({ size = 13 }: RowIconProps) {
  return <HugeiconsIcon icon={SquareLock02Icon} size={size} color="currentColor" strokeWidth={1.6} />;
}

export function UnlockIcon({ size = 13 }: RowIconProps) {
  return <HugeiconsIcon icon={SquareUnlock02Icon} size={size} color="currentColor" strokeWidth={1.6} />;
}

/** Disclosure triangle, pointing right; the row rotates it when expanded. */
export function CaretIcon() {
  return (
    <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden="true" focusable="false">
      <path d="M3 1.5L7.5 5L3 8.5Z" fill="currentColor" />
    </svg>
  );
}
