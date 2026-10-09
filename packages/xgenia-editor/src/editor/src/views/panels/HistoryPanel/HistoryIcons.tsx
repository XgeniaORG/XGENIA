import React from 'react';

import type { GlassIconProps } from '../../SidePanel/GlassIcons';

/**
 * Rail icon for the History panel, in the rail's glass style (views/SidePanel/GlassIcons.tsx):
 * a clock disc in the --gi-body-* gradient with translucent --gi-face-* hands and a specular
 * rim, so it follows the rail's hover and active tokens like the generated icons.
 */
export function GlassHistory({ size = 20 }: GlassIconProps) {
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
        <linearGradient id="xg-hist-body" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--gi-body-1, #9A9AA6)" />
          <stop offset="1" stopColor="var(--gi-body-2, #63636E)" />
        </linearGradient>
        <linearGradient id="xg-hist-spec" x1="12" y1="2" x2="12" y2="9" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--gi-spec, #FFFFFF)" stopOpacity="0.6" />
          <stop offset="1" stopColor="var(--gi-spec, #FFFFFF)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#xg-hist-body)" />
      <path
        d="M3.4 9.5A9 9 0 0 1 20.6 9.5"
        fill="none"
        stroke="url(#xg-hist-spec)"
        strokeWidth="0.9"
        strokeLinecap="round"
      />
      <path
        d="M12 6.5V12L15.75 14.25"
        fill="none"
        stroke="var(--gi-face-1, #E3E3E5)"
        strokeOpacity="var(--gi-face-alpha, 0.6)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1.4" fill="var(--gi-spec, #FFFFFF)" opacity="0.7" />
    </svg>
  );
}
GlassHistory.displayName = 'GlassHistory';
