/**
 * SidebarIcons.tsx
 *
 * Every icon the editor's left bar draws, under one name each, so a slot can
 * change its artwork without every call site moving with it.
 *
 * All of them are Hugeicons line icons (stroke, currentColor), wrapped to the
 * (size, color, fill, style) interface IconButton expects. The rail used to draw
 * Nucleo glass icons (./GlassIcons); those read as lit objects but not as
 * meanings at 20px, so the rail moved to one plain line style with a label
 * under every icon (2026-11-01). No icon is used for two rail items.
 */
import React from 'react';
import { HugeiconsIcon } from '@hugeicons/react';

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
import Redo02Icon from '@hugeicons/core-free-icons/Redo02Icon';
// @ts-ignore
import Undo02Icon from '@hugeicons/core-free-icons/Undo02Icon';
// @ts-ignore
import PinOffIcon from '@hugeicons/core-free-icons/PinOffIcon';
// @ts-ignore
import Edit02Icon from '@hugeicons/core-free-icons/Edit02Icon';
// @ts-ignore
import FolderOpenIcon from '@hugeicons/core-free-icons/FolderOpenIcon';
// @ts-ignore
import PuzzleIcon from '@hugeicons/core-free-icons/PuzzleIcon';
// @ts-ignore
import CloudIcon from '@hugeicons/core-free-icons/CloudIcon';
// @ts-ignore
import SparklesIcon from '@hugeicons/core-free-icons/SparklesIcon';
// @ts-ignore
import Folder01Icon from '@hugeicons/core-free-icons/Folder01Icon';
// @ts-ignore
import AiImageIcon from '@hugeicons/core-free-icons/AiImageIcon';
// @ts-ignore
import UserIcon from '@hugeicons/core-free-icons/UserIcon';
// @ts-ignore
import PaintBoardIcon from '@hugeicons/core-free-icons/PaintBoardIcon';
// @ts-ignore
import Layers01Icon from '@hugeicons/core-free-icons/Layers01Icon';
// @ts-ignore
import Search01Icon from '@hugeicons/core-free-icons/Search01Icon';
// @ts-ignore
import DiceFaces05Icon from '@hugeicons/core-free-icons/DiceFaces05Icon';
// @ts-ignore
import TimeQuarterPassIcon from '@hugeicons/core-free-icons/TimeQuarterPassIcon';
// @ts-ignore
import CodeIcon from '@hugeicons/core-free-icons/CodeIcon';
// @ts-ignore
import Link04Icon from '@hugeicons/core-free-icons/Link04Icon';
// @ts-ignore
import GitBranchIcon from '@hugeicons/core-free-icons/GitBranchIcon';
// @ts-ignore
import MoreHorizontalIcon from '@hugeicons/core-free-icons/MoreHorizontalIcon';
// @ts-ignore
import Plug01Icon from '@hugeicons/core-free-icons/Plug01Icon';

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
// One icon per rail item, each a different picture. The label under the icon
// (views/Rail/railGroups.ts) carries the meaning; the picture only has to be
// distinct and not contradict it.
/** "AI" — the chat. */
export const SideChatPanel = makeIcon(SparklesIcon, 'SideChatPanel');
/** "Add" — the node picker. */
export const SideAddNode = makeIcon(Add01Icon, 'SideAddNode');
/** "Assets" — everything the project has. */
export const SideAssets = makeIcon(Folder01Icon, 'SideAssets');
/** "Images" — the AI Image Editor. */
export const SideImageEditor = makeIcon(AiImageIcon, 'SideImageEditor');
/** "Characters" — Character Studio (a web plugin panel). */
export const SideCharacters = makeIcon(UserIcon, 'SideCharacters');
/** "Styles" — Project Styles. */
export const SideProjectStyles = makeIcon(PaintBoardIcon, 'SideProjectStyles');
/** "Parts" — the Components panel. */
export const SideComponents = makeIcon(PuzzleIcon, 'SideComponents');
/** "Layers" — the Hierarchy panel. */
export const SideHierarchy = makeIcon(Layers01Icon, 'SideHierarchy');
/** "Search". */
export const SideSearch = makeIcon(Search01Icon, 'SideSearch');
/** "Maths" — Maths RGS: odds, RTP, the round. */
export const SideMaths = makeIcon(DiceFaces05Icon, 'SideMaths');
/** "History" — the undo list. */
export const SideHistory = makeIcon(TimeQuarterPassIcon, 'SideHistory');
/** "Functions" — Cloud Functions. */
export const SideCloudFunctions = makeIcon(CodeIcon, 'SideCloudFunctions');
/** "Uses" — Node References. */
export const SideNodeReferences = makeIcon(Link04Icon, 'SideNodeReferences');
/** "Versions" — Version control. */
export const SideVersionControl = makeIcon(GitBranchIcon, 'SideVersionControl');
/** "Cloud" — Cloud Services. */
export const SideCloud = makeIcon(CloudIcon, 'SideCloud');
/** "Settings" — the merged Project/Editor Settings panel. Also in the project menu. */
export const SideSettings = makeIcon(Settings01Icon, 'SideSettings');
/** "More" — whatever the rail is not showing. */
export const SideMore = makeIcon(MoreHorizontalIcon, 'SideMore');
/** Any other server-provided web plugin panel (WebPluginPanel). */
export const SideWebPlugin = makeIcon(Plug01Icon, 'SideWebPlugin');

// ── Other Hugeicons ─────────────────────────────────────────────────
export const SideLogout = makeIcon(Logout01Icon, 'SideLogout');
export const TopbarImport = makeIcon(Download04Icon, 'TopbarImport');
export const TopbarPanelOpen = makeIcon(PanelLeftOpenIcon, 'TopbarPanelOpen');
export const TopbarPanelClose = makeIcon(PanelLeftCloseIcon, 'TopbarPanelClose');
export const TopbarPinned = makeIcon(PinIcon, 'TopbarPinned');
export const TopbarUndo = makeIcon(Undo02Icon, 'TopbarUndo');
export const TopbarRedo = makeIcon(Redo02Icon, 'TopbarRedo');
export const TopbarUnpinned = makeIcon(PinOffIcon, 'TopbarUnpinned');
/** Rail identity chip's project menu. */
export const SideRenameIcon = makeIcon(Edit02Icon, 'SideRenameIcon');
export const SideRevealIcon = makeIcon(FolderOpenIcon, 'SideRevealIcon');
