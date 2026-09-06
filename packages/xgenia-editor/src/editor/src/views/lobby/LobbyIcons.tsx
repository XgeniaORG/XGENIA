/**
 * LobbyIcons — the lobby's glyph set.
 *
 * The editor's icon font (`hgi-stroke`) is a webfont pulled from `use.hugeicons.com` by the old
 * projects template's inline `<style>`. That is a network request on the first screen the app
 * shows, and when it fails — offline, blocked, slow — the glyphs render as the literal words
 * "search", "folder", "delete". The same failure already bit this codebase once: the template
 * preview placeholder is a hand-written inline SVG for exactly this reason.
 *
 * So the lobby carries its own paths. Fifteen of them, one stroke width, currentColor throughout,
 * no font, no request.
 */

import React from 'react';

export type IconName =
  | 'plus'
  | 'folder'
  | 'search'
  | 'star'
  | 'chat'
  | 'trash'
  | 'pen'
  | 'more'
  | 'help'
  | 'grid'
  | 'list'
  | 'chevron'
  | 'spark'
  | 'layout'
  | 'play'
  | 'copy'
  | 'close'
  | 'check'
  | 'warn'
  | 'arrow'
  | 'user'
  | 'external';

/** Stroke geometry, drawn on a 24×24 grid. `star` and `play` also have a filled form. */
const PATHS: Record<IconName, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9L3.5 9.7l5.9-.8z" />,
  chat: <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  pen: <path d="M4 20h4l10-10-4-4L4 16zM13 7l4 4" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.2" />
      <circle cx="12" cy="12" r="1.2" />
      <circle cx="18" cy="12" r="1.2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  list: <path d="M5 7h14M5 12h14M5 17h14" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  spark: (
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
  ),
  layout: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 10h16M10 10v10" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12 4 4L19 6" />,
  warn: <path d="M12 4 3 20h18zM12 10v4m0 3h.01" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  external: <path d="M14 5h5v5M19 5l-8 8M10 6H6a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4" />
};

export interface IconProps {
  name: IconName;
  /** Solid rather than outlined. Only `star` and `play` have a meaningful filled state. */
  filled?: boolean;
  size?: number;
  className?: string;
}

export function Icon({ name, filled = false, size = 14, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
