/**
 * SidebarIcons.tsx
 *
 * Adapter layer that wraps Hugeicons into React components matching the
 * (size, color, fill, style) interface expected by IconButton.
 *
 * Each wrapper simply forwards `size` and `color` to <HugeiconsIcon />.
 */
import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';

// @ts-ignore – sub-path import; moduleResolution:'node' can't resolve package exports maps
import DashboardSquare01Icon from '@hugeicons/core-free-icons/DashboardSquare01Icon';
// @ts-ignore
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
// @ts-ignore
import TestTube01Icon from '@hugeicons/core-free-icons/TestTube01Icon';
// @ts-ignore
import GitBranchIcon from '@hugeicons/core-free-icons/GitBranchIcon';
// @ts-ignore
import CloudIcon from '@hugeicons/core-free-icons/CloudIcon';
// @ts-ignore
import FlashIcon from '@hugeicons/core-free-icons/FlashIcon';
// @ts-ignore
import Brain01Icon from '@hugeicons/core-free-icons/Brain01Icon';
// @ts-ignore
import Telescope01Icon from '@hugeicons/core-free-icons/Telescope01Icon';
// @ts-ignore
import Link01Icon from '@hugeicons/core-free-icons/Link01Icon';
// @ts-ignore
import Comment01Icon from '@hugeicons/core-free-icons/Comment01Icon';
// @ts-ignore
import Image01Icon from '@hugeicons/core-free-icons/Image01Icon';
// @ts-ignore
import Add01Icon from '@hugeicons/core-free-icons/Add01Icon';
// @ts-ignore
import Logout01Icon from '@hugeicons/core-free-icons/Logout01Icon';
// @ts-ignore
import Download04Icon from '@hugeicons/core-free-icons/Download04Icon';
// @ts-ignore
import PaintBrush01Icon from '@hugeicons/core-free-icons/PaintBrush01Icon';
// @ts-ignore
import PanelLeftOpenIcon from '@hugeicons/core-free-icons/PanelLeftOpenIcon';
// @ts-ignore
import PanelLeftCloseIcon from '@hugeicons/core-free-icons/PanelLeftCloseIcon';
// @ts-ignore
import PinIcon from '@hugeicons/core-free-icons/PinIcon';
// @ts-ignore
import PinOffIcon from '@hugeicons/core-free-icons/PinOffIcon';
// @ts-ignore
import CalculatorIcon from '@hugeicons/core-free-icons/CalculatorIcon';
// @ts-ignore
import FolderLibraryIcon from '@hugeicons/core-free-icons/FolderLibraryIcon';

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

// ── Sidebar icon wrappers ───────────────────────────────────────────
export const SideComponents = makeIcon(DashboardSquare01Icon, 'SideComponents');
export const SideSearch = makeIcon(Search01Icon, 'SideSearch');
export const SideVersionControl = makeIcon(GitBranchIcon, 'SideVersionControl');
export const SideCloud = makeIcon(CloudIcon, 'SideCloud');
export const SideCloudFunctions = makeIcon(FlashIcon, 'SideCloudFunctions');
/** Conical flask — the merged Project/Editor Settings panel. */
export const SideSettings = makeIcon(TestTube01Icon, 'SideSettings');
export const SideChatPanel = makeIcon(Brain01Icon, 'SideChatPanel');
export const SideAiPanel = makeIcon(Telescope01Icon, 'SideAiPanel');
export const SideProjectStyles = makeIcon(PaintBrush01Icon, 'SideProjectStyles');

export const SideNodeReferences = makeIcon(Link01Icon, 'SideNodeReferences');
export const SideFeedback = makeIcon(Comment01Icon, 'SideFeedback');
export const SideImageEditor = makeIcon(Image01Icon, 'SideImageEditor');
export const SideMemoryPanel = makeIcon(Brain01Icon, 'SideMemoryPanel');
export const SideMaths = makeIcon(CalculatorIcon, 'SideMaths');
export const SideAssets = makeIcon(FolderLibraryIcon, 'SideAssets');
export const SideAddNode = makeIcon(Add01Icon, 'SideAddNode');
export const SideLogout = makeIcon(Logout01Icon, 'SideLogout');
export const TopbarImport = makeIcon(Download04Icon, 'TopbarImport');
export const TopbarPanelOpen = makeIcon(PanelLeftOpenIcon, 'TopbarPanelOpen');
export const TopbarPanelClose = makeIcon(PanelLeftCloseIcon, 'TopbarPanelClose');
export const TopbarPinned = makeIcon(PinIcon, 'TopbarPinned');
export const TopbarUnpinned = makeIcon(PinOffIcon, 'TopbarUnpinned');
