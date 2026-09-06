/**
 * SidebarIcons.tsx
 *
 * Every icon the editor's left bar draws, under one name each, so a slot can
 * change its artwork without every call site moving with it.
 *
 * Two families live here. The rail strip's ten panel icons come from
 * ./GlassIcons — Nucleo's glass set, painted by CSS tokens. Everything else is
 * a Hugeicon wrapped to the (size, color, fill, style) interface IconButton
 * expects, forwarding `size` and `color` to <HugeiconsIcon />.
 */
import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';

import {
    GlassAssets, GlassChat, GlassComponents, GlassImageEditor, GlassMaths, GlassMore,
    GlassNodeReferences, GlassProjectStyles, GlassSearch, GlassVersionControl
} from './GlassIcons';

// @ts-ignore – sub-path import; moduleResolution:'node' can't resolve package exports maps
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
// @ts-ignore
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
// @ts-ignore
import Logout01Icon from '@hugeicons/core-free-icons/Logout01Icon';
// @ts-ignore
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon';
// @ts-ignore
import PanelLeftOpenIcon from '@hugeicons/core-free-icons/PanelLeftOpenIcon';
// @ts-ignore
import PanelLeftCloseIcon from '@hugeicons/core-free-icons/PanelLeftCloseIcon';
// @ts-ignore
import PinIcon from '@hugeicons/core-free-icons/PinIcon';
// @ts-ignore
import PinOffIcon from '@hugeicons/core-free-icons/PinOffIcon';
// @ts-ignore
import Edit02Icon from '@hugeicons/core-free-icons/Edit02Icon';
// @ts-ignore
import FolderOpenIcon from '@hugeicons/core-free-icons/FolderOpenIcon';

interface IconProps {
    size?: number;
    color?: string;
    fill?: string;
    style?: React.CSSProperties;
}

// Helper to create a wrapper component from a Hugeicon data object
function makeIcon(iconData: any, displayName: string) {
    const Component = ({ size = 16, color = 'currentColor' }: IconProps) => (
        <HugeiconsIcon icon={iconData} size={size} color={color} />
    );
    Component.displayName = displayName;
    return Component;
}

// ── Rail panel icons ────────────────────────────────────────────────
// The ten icons that sit in the left rail strip are Nucleo glass icons (see
// GlassIcons.tsx), not Hugeicons: at the rail's 20px they read as small lit
// objects rather than as hairline strokes, and they take their colour from the
// --gi-* tokens the rail sets per state. Everything below this block is still a
// Hugeicon — the project menu draws its icons at 14px in currentColor (including
// a red "Close project"), and the + is an accent-filled affordance; glass would
// lose the tint in one and the legibility in the other.
export const SideComponents = GlassComponents;
export const SideSearch = GlassSearch;
export const SideVersionControl = GlassVersionControl;
export const SideChatPanel = GlassChat;
export const SideProjectStyles = GlassProjectStyles;
export const SideNodeReferences = GlassNodeReferences;
export const SideImageEditor = GlassImageEditor;
export const SideMaths = GlassMaths;
export const SideAssets = GlassAssets;
/** The rail's ⋯ overflow button, folding the tail of the top cluster at short heights. */
export const SideMore = GlassMore;

// ── Hugeicons wrappers ──────────────────────────────────────────────
/** Gear — the merged Project/Editor Settings panel, reached from the project menu. */
export const SideSettings = makeIcon(Settings01Icon, 'SideSettings');
export const SideAddNode = makeIcon(Add01Icon, 'SideAddNode');
export const SideLogout = makeIcon(Logout01Icon, 'SideLogout');
export const TopbarImport = makeIcon(Download04Icon, 'TopbarImport');
export const TopbarPanelOpen = makeIcon(PanelLeftOpenIcon, 'TopbarPanelOpen');
export const TopbarPanelClose = makeIcon(PanelLeftCloseIcon, 'TopbarPanelClose');
export const TopbarPinned = makeIcon(PinIcon, 'TopbarPinned');
export const TopbarUnpinned = makeIcon(PinOffIcon, 'TopbarUnpinned');
/** Rail identity chip's project menu. */
export const SideRenameIcon = makeIcon(Edit02Icon, 'SideRenameIcon');
export const SideRevealIcon = makeIcon(FolderOpenIcon, 'SideRevealIcon');
