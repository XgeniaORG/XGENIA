import classNames from 'classnames';
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';

import { NodeGraphModel, NodeGraphNode } from '@xgenia-models/nodegraphmodel';
import { RuntimeType } from '@xgenia-models/nodelibrary/NodeLibraryData';
import { createNodeIndex, INodeIndexCategory, INodeIndexSubCategory } from '@xgenia-utils/createnodeindex';

import { SearchInput } from '@xgenia-core-ui/components/inputs/SearchInput';
import { Icon, IconName, IconSize } from '@xgenia-core-ui/components/common/Icon';
import { HugeiconsIcon } from '@hugeicons/react';

// ── Hugeicon imports ────────────────────────────────────────────────────
// @ts-ignore
import DashboardSquare01Icon from '@hugeicons/core-free-icons/DashboardSquare01Icon';
// @ts-ignore
import Joystick03Icon from '@hugeicons/core-free-icons/Joystick03Icon';
// @ts-ignore
import DiceFaces05Icon from '@hugeicons/core-free-icons/DiceFaces05Icon';
// @ts-ignore
import FlowSquareIcon from '@hugeicons/core-free-icons/FlowSquareIcon';
// @ts-ignore
import Database01Icon from '@hugeicons/core-free-icons/Database01Icon';
// @ts-ignore
import SourceCodeIcon from '@hugeicons/core-free-icons/SourceCodeIcon';
// @ts-ignore
import Route01Icon from '@hugeicons/core-free-icons/Route01Icon';
// @ts-ignore
import AiBrain01Icon from '@hugeicons/core-free-icons/AiBrain01Icon';
// @ts-ignore
import FolderOpenIcon from '@hugeicons/core-free-icons/FolderOpenIcon';
// @ts-ignore
import PuzzleIcon from '@hugeicons/core-free-icons/PuzzleIcon';
// @ts-ignore
import CircleIcon from '@hugeicons/core-free-icons/CircleIcon';
// @ts-ignore
import Comment01Icon from '@hugeicons/core-free-icons/Comment01Icon';

// Subcategory icons
// @ts-ignore
import LayoutTopIcon from '@hugeicons/core-free-icons/LayoutTopIcon';
// @ts-ignore
import Settings01Icon from '@hugeicons/core-free-icons/Settings01Icon';
// @ts-ignore
import PlayCircleIcon from '@hugeicons/core-free-icons/PlayCircleIcon';
// @ts-ignore
import ChartLineData01Icon from '@hugeicons/core-free-icons/ChartLineData01Icon';
// @ts-ignore
import TextFontIcon from '@hugeicons/core-free-icons/TextFontIcon';
// @ts-ignore
import ComputerIcon from '@hugeicons/core-free-icons/ComputerIcon';
// @ts-ignore
import Shield01Icon from '@hugeicons/core-free-icons/Shield01Icon';
// @ts-ignore
import Atom01Icon from '@hugeicons/core-free-icons/Atom01Icon';
// @ts-ignore
import Archive01Icon from '@hugeicons/core-free-icons/Archive01Icon';
// @ts-ignore
import Wrench01Icon from '@hugeicons/core-free-icons/Wrench01Icon';
// @ts-ignore
import GitForkIcon from '@hugeicons/core-free-icons/GitForkIcon';
// @ts-ignore
import FlashIcon from '@hugeicons/core-free-icons/FlashIcon';
// @ts-ignore
import TextIcon from '@hugeicons/core-free-icons/TextIcon';
// @ts-ignore
import VariableIcon from '@hugeicons/core-free-icons/VariableIcon';
// @ts-ignore
import Bug01Icon from '@hugeicons/core-free-icons/Bug01Icon';
// @ts-ignore
import AlignBoxMiddleLeftIcon from '@hugeicons/core-free-icons/AlignBoxMiddleLeftIcon';
// @ts-ignore
import CloudIcon from '@hugeicons/core-free-icons/CloudIcon';
// @ts-ignore
import UserIcon from '@hugeicons/core-free-icons/UserIcon';
// @ts-ignore
import GlobeIcon from '@hugeicons/core-free-icons/GlobeIcon';
// @ts-ignore
import Link04Icon from '@hugeicons/core-free-icons/Link04Icon';
// @ts-ignore
import CodeSquareIcon from '@hugeicons/core-free-icons/CodeSquareIcon';
// @ts-ignore
import File01Icon from '@hugeicons/core-free-icons/File01Icon';
// @ts-ignore
import Alert01Icon from '@hugeicons/core-free-icons/Alert01Icon';
// @ts-ignore
import StructureCheckIcon from '@hugeicons/core-free-icons/StructureCheckIcon';
// @ts-ignore
import MathIcon from '@hugeicons/core-free-icons/MathIcon';
// @ts-ignore
import EqualSignIcon from '@hugeicons/core-free-icons/EqualSignIcon';
// @ts-ignore
import CubeIcon from '@hugeicons/core-free-icons/CubeIcon';

import NodePickerNode from '../../components/NodePickerNode';
import NodePickerOtherItem from '../../components/NodePickerOtherItem';
import { useNodePickerContext } from '../../NodePicker.context';
import { useDocs, useKeyboardCursor, useSearchBar } from '../../NodePicker.hooks';
import { getIsNodeCursorMatchingNode } from '../../NodePicker.selectors';
import { createNodeFunction, createNewComment } from '../../NodePicker.utils';
import css from './NodeLibrary.module.scss';

export interface NodeLibraryProps {
  model: NodeGraphModel;
  parentModel: NodeGraphNode;
  pos: TSFixme;
  attachToRoot: boolean;
  runtimeType: RuntimeType;
}

// ── Category metadata: icon (Hugeicon data), neon color ─────────────────
const CATEGORY_META: Record<string, { icon: any; color: string }> = {
  'UI Elements': { icon: DashboardSquare01Icon, color: '#EC5BE0' },
  'Game Engine': { icon: Joystick03Icon, color: '#67DE92' },
  'Game Logic': { icon: DiceFaces05Icon, color: '#FF6B6B' },
  'Logic & Events': { icon: FlowSquareIcon, color: '#45E5FF' },
  'Data & Cloud': { icon: Database01Icon, color: '#5B9AEC' },
  'Code & Custom': { icon: SourceCodeIcon, color: '#FFB547' },
  'Navigation': { icon: Route01Icon, color: '#9B59EC' },
  'AI & Planning': { icon: AiBrain01Icon, color: '#FF59F0' },
  // Fallback for custom/project groups
  'Project components': { icon: FolderOpenIcon, color: '#9B59EC' },
  'External libraries': { icon: PuzzleIcon, color: '#8B9AAF' },
};

const DEFAULT_META = { icon: CircleIcon, color: '#8B9AAF' };

function getCategoryMeta(categoryName: string) {
  return CATEGORY_META[categoryName] || DEFAULT_META;
}

// ── Subcategory icons ───────────────────────────────────────────────────
const SUBCATEGORY_ICONS: Record<string, any> = {
  // UI Elements
  'Basic Elements': LayoutTopIcon,
  'UI Controls': Settings01Icon,
  'Animation': PlayCircleIcon,
  'Charts & Visualizers': ChartLineData01Icon,
  // Game Engine
  'Core Game Nodes': Joystick03Icon,
  'Advanced Elements': TextFontIcon,
  'Debug': Bug01Icon,
  'Input': ComputerIcon,
  // Game Logic
  'Slot Engine': DiceFaces05Icon,
  'Slot Games': DiceFaces05Icon,
  'Slot Games (Legacy)': Archive01Icon,
  'Random Generators': Atom01Icon,
  'Stake Engine (RGS)': Shield01Icon,
  // Logic & Events
  'Logic': GitForkIcon,
  'Math Operations': MathIcon,
  'Math Functions': MathIcon,
  'Comparators': EqualSignIcon,
  'Events': FlashIcon,
  'General Utils': Wrench01Icon,
  'String Manipulation': TextIcon,
  'System': ComputerIcon,
  'Variables': VariableIcon,
  'Formula': MathIcon,
  // Data & Cloud
  'Objects & Models': CubeIcon,
  'Arrays': AlignBoxMiddleLeftIcon,
  'Array': AlignBoxMiddleLeftIcon,
  'Cloud Data': CloudIcon,
  'Cloud Functions': FlashIcon,
  'User Management': UserIcon,
  'User': UserIcon,
  'External Data': GlobeIcon,
  'MCP Integration': Link04Icon,
  // Code & Custom
  'Custom Code': CodeSquareIcon,
  'Component Utilities': PuzzleIcon,
  // Navigation
  'Pages & Routing': File01Icon,
  'Navigation': Route01Icon,
  'Popups': Alert01Icon,
  // AI & Planning
  'Hyve Mind': StructureCheckIcon,
  'AI Agents': AiBrain01Icon,
  'Machine Learning': ChartLineData01Icon,
  // Pixi pipe subcategories (when they appear as subcategory names)
  'Pixi|Animation': PlayCircleIcon,
  'Pixi|Asset Management': Archive01Icon,
  'Pixi|Assets': Archive01Icon,
  'Pixi|Camera': ComputerIcon,
  'Pixi|Debug': Bug01Icon,
  'Pixi|Effects': FlashIcon,
  'Pixi|Logic': GitForkIcon,
  'Pixi|Physics': Atom01Icon,
  'Pixi|Rendering': LayoutTopIcon,
  'Pixi|Text': TextFontIcon,
  'Pixi|UI': DashboardSquare01Icon,
  // Math subcategories as top-level subs
  'Algebra': MathIcon,
  'Arithmetic': MathIcon,
  'Trigonometry': MathIcon,
  'Statistics': ChartLineData01Icon,
  'Geometry': CubeIcon,
  'Probability': DiceFaces05Icon,
  // Misc
  'Data': Database01Icon,
  'MCP': Link04Icon,
  'Business Intelligence': ChartLineData01Icon,
  'Javascript': CodeSquareIcon,
  'Signal': FlashIcon,
  'Sensors': ComputerIcon,
  'Cloud Services': CloudIcon,
};

function getSubcategoryIcon(name: string): any | null {
  return SUBCATEGORY_ICONS[name] || null;
}

interface CollapsibleCategoryProps {
  category: INodeIndexCategory;
  isExpanded: boolean;
  onToggle: () => void;
  searchTerm: string;
  cursorState: TSFixme;
  nodeCursorMatcher: TSFixme;
  doCreateSelectedNode: boolean;
  onGetDocs: (type: TSFixme) => void;
  onMouseLeaveNode: () => void;
  onCreateNode: (type: TSFixme) => void;
}

function CollapsibleCategory({
  category,
  isExpanded,
  onToggle,
  searchTerm,
  cursorState,
  nodeCursorMatcher,
  doCreateSelectedNode,
  onGetDocs,
  onMouseLeaveNode,
  onCreateNode
}: CollapsibleCategoryProps) {
  const meta = getCategoryMeta(category.name);

  // Collect all items from category and subcategories
  const allItems = useMemo(() => {
    const items: TSFixme[] = [...(category.items || [])];
    category.subCategories?.forEach(sub => {
      items.push(...(sub.items || []));
    });
    return items;
  }, [category]);

  // Filter items based on search
  const filteredItems = useMemo(() => {
    if (!searchTerm) return allItems;
    const term = searchTerm.toLowerCase();
    return allItems.filter(item => {
      const name = (item.displayName || item.displayNodeName || item.name || '').toLowerCase();
      const searchTags = (item.searchTags || []).join(' ').toLowerCase();
      const desc = (item.shortDesc || '').toLowerCase();
      const cat = (item.category || '').toLowerCase();
      return name.includes(term) || searchTags.includes(term) || desc.includes(term) || cat.includes(term);
    });
  }, [allItems, searchTerm]);

  // Don't render if no items match search
  if (filteredItems.length === 0) return null;

  const itemCount = filteredItems.length;

  return (
    <div className={css['Category']}>
      <button
        className={classNames(css['CategoryHeader'], isExpanded && css['is-expanded'])}
        onClick={onToggle}
        style={{ '--category-color': meta.color } as React.CSSProperties}
      >
        <div className={css['CategoryIcon']}>
          <HugeiconsIcon icon={meta.icon} size={16} color={meta.color} />
        </div>
        <div className={css['CategoryInfo']}>
          <span className={css['CategoryName']}>{category.name}</span>
          <span className={css['CategoryCount']}>{itemCount}</span>
        </div>
        <div className={classNames(css['CategoryArrow'], isExpanded && css['is-rotated'])}>
          <Icon icon={IconName.CaretDown} size={IconSize.Tiny} />
        </div>
      </button>

      {isExpanded && (
        <div className={css['CategoryContent']}>
          {/* Group items by subcategory if present */}
          {category.subCategories?.map((sub, idx) => {
            const subItems = sub.items?.filter(item => {
              if (!searchTerm) return true;
              const term = searchTerm.toLowerCase();
              const name = (item.displayName || item.displayNodeName || item.name || '').toLowerCase();
              const searchTags = (item.searchTags || []).join(' ').toLowerCase();
              const desc = (item.shortDesc || '').toLowerCase();
              const cat = (item.category || '').toLowerCase();
              return name.includes(term) || searchTags.includes(term) || desc.includes(term) || cat.includes(term);
            }) || [];

            if (subItems.length === 0) return null;

            return (
              <div key={sub.name || idx} className={css['SubCategory']}>
                {sub.name && (
                  <div className={css['SubCategoryName']}>
                    {getSubcategoryIcon(sub.name) && (
                      <span className={css['SubCategoryIcon']}>
                        <HugeiconsIcon icon={getSubcategoryIcon(sub.name)} size={12} color="currentColor" />
                      </span>
                    )}
                    {sub.name}
                  </div>
                )}
                <div className={css['NodeList']}>
                  {subItems.map(item => (
                    <NodePickerNode
                      key={item.name}
                      item={item}
                      isKeyboardCursored={nodeCursorMatcher(cursorState, category.name, item.name)}
                      doCreateSelectedNode={doCreateSelectedNode}
                      onClick={onCreateNode}
                      onGetDocs={onGetDocs}
                      onMouseLeave={onMouseLeaveNode}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Direct items (not in subcategories) */}
          {category.items && category.items.length > 0 && (
            <div className={css['NodeList']}>
              {category.items
                .filter(item => {
                  if (!searchTerm) return true;
                  const term = searchTerm.toLowerCase();
                  const name = (item.displayName || item.displayNodeName || item.name || '').toLowerCase();
                  const searchTags = (item.searchTags || []).join(' ').toLowerCase();
                  const desc = (item.shortDesc || '').toLowerCase();
                  const cat = (item.category || '').toLowerCase();
                  return name.includes(term) || searchTags.includes(term) || desc.includes(term) || cat.includes(term);
                })
                .map(item => (
                  <NodePickerNode
                    key={item.name}
                    item={item}
                    isKeyboardCursored={nodeCursorMatcher(cursorState, category.name, item.name)}
                    doCreateSelectedNode={doCreateSelectedNode}
                    onClick={onCreateNode}
                    onGetDocs={onGetDocs}
                    onMouseLeave={onMouseLeaveNode}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function NodeLibrary({ model, parentModel, pos, attachToRoot, runtimeType }: NodeLibraryProps) {
  const { getDocs, cancelGetDocs } = useDocs();
  const [items] = useState(createNodeIndex(model, parentModel, runtimeType));
  const [renderedNodes, setRenderedNodes] = useState(items);
  const [searchTerm, setSearchTermState] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Project components', 'UI Elements', 'Logic', 'Data']));

  const {
    cursorState,
    openAllCategories,
    closeAllCategories,
    handleSearchUpdate,
    focusSearch,
    enableCollapseTransition,
    disableCollapseTransition
  } = useKeyboardCursor(renderedNodes);

  const createNode = createNodeFunction(model, parentModel, pos, attachToRoot);
  const searchInput = useRef<HTMLInputElement>(null);

  const setSearchTerm = useSearchBar(
    searchInput,
    setRenderedNodes,
    items,
    cursorState.cursorContext,
    openAllCategories,
    closeAllCategories,
    handleSearchUpdate
  );

  // All categories combined - prioritize custom/project components
  const allCategories = useMemo(() => {
    const customNodes = renderedNodes.customNodes || [];
    const coreNodes = renderedNodes.coreNodes || [];

    // Put project components first if they exist
    const projectComponents = customNodes.filter(cat => cat.name === 'Project components');
    const otherCustomNodes = customNodes.filter(cat => cat.name !== 'Project components');

    return [...projectComponents, ...otherCustomNodes, ...coreNodes];
  }, [renderedNodes]);

  // Expand all when searching
  useEffect(() => {
    if (searchTerm) {
      setExpandedCategories(new Set(allCategories.map(c => c.name)));
    }
  }, [searchTerm, allCategories]);

  // Toggle category expansion
  const toggleCategory = useCallback((categoryName: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryName)) {
        next.delete(categoryName);
      } else {
        next.add(categoryName);
      }
      return next;
    });
  }, []);

  // Expand/collapse all
  const expandAll = useCallback(() => {
    setExpandedCategories(new Set(allCategories.map(c => c.name)));
  }, [allCategories]);

  const collapseAll = useCallback(() => {
    setExpandedCategories(new Set());
  }, []);

  function handleSearchChanged(term: string) {
    setSearchTermState(term);
    setSearchTerm(term);
  }

  // Always show comment action unless searching for something specific
  const showCommentAction = !searchTerm.trim() || searchTerm.toLowerCase().includes('comment');

  // Count total visible nodes
  const totalNodeCount = useMemo(() => {
    let count = 0;
    allCategories.forEach(cat => {
      count += cat.items?.length || 0;
      cat.subCategories?.forEach(sub => {
        count += sub.items?.length || 0;
      });
    });
    return count;
  }, [allCategories]);

  return (
    <div className={css['Root']}>
      {/* Search bar */}
      <div className={css['SearchContainer']}>
        <SearchInput
          placeholder="Search nodes..."
          inputRef={searchInput}
          onChange={handleSearchChanged}
          onClick={() => focusSearch()}
        />
        <div className={css['SearchMeta']}>
          <span className={css['NodeCount']}>{totalNodeCount} nodes</span>
          <div className={css['ExpandControls']}>
            <button className={css['ExpandBtn']} onClick={expandAll} title="Expand all">
              <Icon icon={IconName.CaretDown} size={IconSize.Tiny} />
            </button>
            <button className={css['ExpandBtn']} onClick={collapseAll} title="Collapse all">
              <Icon icon={IconName.CaretUp} size={IconSize.Tiny} />
            </button>
          </div>
        </div>
      </div>

      {/* Categories list */}
      <div
        className={css['Content']}
        onMouseOver={enableCollapseTransition}
        onMouseLeave={disableCollapseTransition}
      >
        <div className={css['CategoriesList']}>
          {allCategories.map((category) => (
            <CollapsibleCategory
              key={category.name}
              category={category}
              isExpanded={expandedCategories.has(category.name)}
              onToggle={() => toggleCategory(category.name)}
              searchTerm={searchTerm}
              cursorState={cursorState}
              nodeCursorMatcher={getIsNodeCursorMatchingNode}
              doCreateSelectedNode={cursorState?.allowNodeCreation}
              onGetDocs={getDocs}
              onMouseLeaveNode={cancelGetDocs}
              onCreateNode={createNode}
            />
          ))}

          {/* Comment action */}
          {showCommentAction && (
            <div className={css['OtherActions']}>
              <NodePickerOtherItem
                title="Comment"
                description="Add a comment to the graph"
                onClick={(e) => {
                  createNewComment(model, pos);
                  e.stopPropagation();
                }}
                icon={<HugeiconsIcon icon={Comment01Icon} size={16} color="#8B9AAF" />}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
