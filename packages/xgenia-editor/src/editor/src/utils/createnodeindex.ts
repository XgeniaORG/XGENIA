import { NodeType } from '@xgenia-constants/NodeType';
import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeLibrary, NodeLibraryNodeType } from '@xgenia-models/nodelibrary';
import { RuntimeType } from '@xgenia-models/nodelibrary/NodeLibraryData';
import { getComponentModelRuntimeType } from '@xgenia-utils/NodeGraph';

export interface INodeIndex {
  coreNodes: INodeIndexCategory[];
  customNodes: INodeIndexCategory[];
}

export interface INodeIndexCategory {
  name: string;
  description: string;
  type: NodeType;
  subCategories?: INodeIndexSubCategory[];
  items?: TSFixme[];
}

export interface INodeIndexSubCategory {
  name: string;
  items: TSFixme[];
}

export function createNodeIndex(model: TSFixme, parentModel: TSFixme, runtimeType: RuntimeType): INodeIndex {
  console.log('[createNodeIndex] Starting node index creation with runtime type:', runtimeType);

  // For maths runtime, use browser as the effective type for node inclusion
  // (maths nodes are browser nodes, just with category restrictions)
  const effectiveRuntimeType = runtimeType === RuntimeType.Maths ? RuntimeType.Browser : runtimeType;

  function isNodeCreatable(nodeType: NodeLibraryNodeType | ComponentModel): boolean {
    // @ts-expect-error Wrong to be both NodeLibraryNodeType and ComponentModel
    if (effectiveRuntimeType && nodeType.runtimeTypes && !nodeType.runtimeTypes.includes(effectiveRuntimeType)) {
      return false;
    }
    const status = model.owner.getCreateStatus({
      parent: parentModel,
      type: nodeType
    });
    return status.creatable;
  }

  function getNodes(names: string[]) {
    return names
      .map((name) => {
        const nodeType = NodeLibrary.instance.getNodeTypeWithName(name);
        if (!nodeType) return undefined;
        if (isNodeCreatable(nodeType)) return nodeType;
      })
      .filter(Boolean);
  }

  // Use a fallback object in case library or nodeIndex is not defined.
  const nodeIndexData = NodeLibrary.instance.library?.nodeIndex || { coreNodes: [], moduleNodes: [] };

  // parse core nodes from static index
  const coreNodes = (nodeIndexData.coreNodes || [])
    .map((category) => {
      const subCategories = category?.subCategories
        ? category.subCategories.map((subCategory) => {
          return {
            name: subCategory.name,
            items: getNodes(subCategory.items)
          };
        })
        : [];
      const items = category?.items ? getNodes(category.items) : [];
      return {
        ...category,
        subCategories,
        items
      };
    })
    .filter((category: INodeIndexCategory) => {
      let shouldKeepCategory = false;
      category.subCategories.forEach((subCategory) => {
        if (subCategory.items.length) {
          shouldKeepCategory = true;
        }
      });
      if (category.items.length) {
        shouldKeepCategory = true;
      }
      return shouldKeepCategory;
    });

  // ── Category Consolidation ────────────────────────────────────────────
  // Remap old categories into 8 clean groups.
  // The deploy bundle defines categories by name; we consolidate them here
  // so the structure is maintainable even when the bundle is rebuilt.
  const CATEGORY_REMAP: Record<string, string> = {
    // ── Pixi / Game Engine ──
    'Pixi': 'Game Engine',
    'Pixi|Animation': 'Game Engine',
    'Pixi|Asset Management': 'Game Engine',
    'Pixi|Assets': 'Game Engine',
    'Pixi|Camera': 'Game Engine',
    'Pixi|Debug': 'Game Engine',
    'Pixi|Effects': 'Game Engine',
    'Pixi|Logic': 'Game Engine',
    'Pixi|Physics': 'Game Engine',
    'Pixi|Rendering': 'Game Engine',
    'Pixi|Text': 'Game Engine',
    'Pixi|UI': 'Game Engine',
    // ── Math → split ──
    'Math': '__SPLIT_MATH__',
    // ── Math subcategories that come as top-level categories → Logic & Events ──
    'Algebra': 'Logic & Events',
    'Arithmetic': 'Logic & Events',
    'Bitwise': 'Logic & Events',
    'Combinatorics': 'Logic & Events',
    'Complex': 'Logic & Events',
    'Constants': 'Logic & Events',
    'Construction': 'Logic & Events',
    'Expression': 'Logic & Events',
    'Geometry': 'Logic & Events',
    'Interpolation': 'Logic & Events',
    'Logical': 'Logic & Events',
    'Matrix': 'Logic & Events',
    'Numeric': 'Logic & Events',
    'Operators': 'Logic & Events',
    'Probability': 'Logic & Events',
    'Relational': 'Logic & Events',
    'Set': 'Logic & Events',
    'Special': 'Logic & Events',
    'Statistics': 'Logic & Events',
    'Trigonometry': 'Logic & Events',
    'Type': 'Logic & Events',
    'Units': 'Logic & Events',
    'Formula': 'Logic & Events',
    // ── Stake Engine / RGS → Game Logic ──
    'Stake Engine (RGS)': 'Game Logic',
    'Slot Games': 'Game Logic',
    // ── Logic, Events, Utilities → Logic & Events ──
    'Logic & Utilities': 'Logic & Events',
    'Logic': 'Logic & Events',
    'Logic|Input': 'Logic & Events',
    'Events': 'Logic & Events',
    'Utilities': 'Logic & Events',
    'Utils': 'Logic & Events',
    'String Manipulation': 'Logic & Events',
    'Variables': 'Logic & Events',
    'Signal': 'Logic & Events',
    'System': 'Logic & Events',
    'Sensors': 'Logic & Events',
    // ── Navigation ──
    'Navigation & Popups': 'Navigation',
    'Navigation': 'Navigation',
    // ── Code & Custom ──
    'Component Utilities': 'Code & Custom',
    'Custom Code': 'Code & Custom',
    'CustomCode': 'Code & Custom',
    'Javascript': 'Code & Custom',
    // ── Data & Cloud ──
    'Read & Write Data': 'Data & Cloud',
    'Cloud Functions': 'Data & Cloud',
    'Cloud Services': 'Data & Cloud',
    'Data': 'Data & Cloud',
    'MCP': 'Data & Cloud',
    // ── AI & Planning ──
    'Hyve Mind': 'AI & Planning',
    'AI Agents': 'AI & Planning',
    'Machine Learning': 'AI & Planning',
    // ── Visual → UI Elements ──
    'Visual': 'UI Elements',
    'Visuals': 'UI Elements',
    'Animation': 'UI Elements',
    // ── Business ──
    'Business Intelligence': 'Data & Cloud',
    // ── Misc / unknown ──
    'Core': 'Logic & Events',
    'Unknown': 'Logic & Events',
    'mismatch': 'Logic & Events',
    'technical': 'Logic & Events',
    'tooFewArgs': 'Logic & Events',
    'tooManyArgs': 'Logic & Events',
    'wrongType': 'Logic & Events',
  };

  // Category descriptions for newly created groups
  const CATEGORY_DESCRIPTIONS: Record<string, string> = {
    'UI Elements': 'Visual components, controls, and media',
    'Game Engine': 'Interactive 2D graphics with PixiJS',
    'Game Logic': 'Slot games, RNG, and RGS integration',
    'Logic & Events': 'Flow control, math, events, and utilities',
    'Data & Cloud': 'Data models, arrays, cloud storage, and APIs',
    'Code & Custom': 'Custom code, components, and scripting',
    'Navigation': 'Page routing, navigation, and popups',
    'AI & Planning': 'AI tools, agents, and project planning',
  };

  // Math subcategories that belong in "Game Logic"
  const MATH_GAME_SUBS = new Set(['Slot Games', 'Slot Games (Legacy)', 'Generator']);

  // Resolve a raw category name to one of the 8 consolidated groups
  function resolveCategory(rawName: string): string {
    // Check for pipe notation like "Pixi|Animation" — try full match first
    if (CATEGORY_REMAP[rawName]) {
      const mapped = CATEGORY_REMAP[rawName];
      return mapped === '__SPLIT_MATH__' ? rawName : mapped;
    }
    // For pipe categories not explicitly listed, use the prefix
    if (rawName.includes('|')) {
      const prefix = rawName.split('|')[0];
      if (CATEGORY_REMAP[prefix]) {
        const mapped = CATEGORY_REMAP[prefix];
        return mapped === '__SPLIT_MATH__' ? rawName : mapped;
      }
    }
    return rawName; // Keep as-is
  }

  function findOrCreateCategory(name: string, cats: INodeIndexCategory[]): INodeIndexCategory {
    let cat = cats.find(c => c.name === name);
    if (!cat) {
      cat = {
        name,
        description: CATEGORY_DESCRIPTIONS[name] || `${name} nodes`,
        type: NodeType.None,
        subCategories: [],
        items: []
      };
      cats.push(cat);
    }
    return cat;
  }

  // Consolidate categories
  const consolidated: INodeIndexCategory[] = [];

  coreNodes.forEach(category => {
    const remapped = CATEGORY_REMAP[category.name];

    if (remapped === '__SPLIT_MATH__') {
      // Special: split Math into Game Logic (slot/generator subs) and Logic & Events (basics)
      const gameSubs: INodeIndexSubCategory[] = [];
      const logicSubs: INodeIndexSubCategory[] = [];

      category.subCategories?.forEach(sub => {
        if (MATH_GAME_SUBS.has(sub.name)) {
          // Rename "Generator" to "Random Generators" for clarity
          gameSubs.push({
            name: sub.name === 'Generator' ? 'Random Generators' : sub.name,
            items: sub.items
          });
        } else {
          // Merge "Basic Operations", "Basic Functions", "Basic Comparators", "Formula"
          // into "Logic & Events" as "Math Operations", "Math Functions", "Comparators"
          const subName = sub.name
            .replace('Basic Operations', 'Math Operations')
            .replace('Basic Functions', 'Math Functions')
            .replace('Basic Comparators', 'Comparators');
          logicSubs.push({ name: subName, items: sub.items });
        }
      });

      if (gameSubs.length > 0) {
        const gameLogic = findOrCreateCategory('Game Logic', consolidated);
        gameLogic.subCategories = [...(gameLogic.subCategories || []), ...gameSubs];
      }
      if (logicSubs.length > 0) {
        const logicEvents = findOrCreateCategory('Logic & Events', consolidated);
        logicEvents.subCategories = [...(logicEvents.subCategories || []), ...logicSubs];
      }
    } else if (remapped) {
      // Merge into target category
      const target = findOrCreateCategory(remapped, consolidated);
      if (category.subCategories?.length) {
        target.subCategories = [...(target.subCategories || []), ...category.subCategories];
      }
      if (category.items?.length) {
        target.items = [...(target.items || []), ...category.items];
      }
    } else {
      // Keep as-is (UI Elements stays UI Elements, etc.)
      const target = findOrCreateCategory(category.name, consolidated);
      if (category.subCategories?.length) {
        target.subCategories = [...(target.subCategories || []), ...category.subCategories];
      }
      if (category.items?.length) {
        target.items = [...(target.items || []), ...category.items];
      }
    }
  });

  // Replace coreNodes with consolidated version
  coreNodes.length = 0;
  coreNodes.push(...consolidated);

  // NOTE: Maths category filtering is applied AFTER all node sources
  // (dynamic + module) are processed — see end of function

  // ENHANCEMENT: Add dynamically registered nodes that aren't in the static index
  console.log('[createNodeIndex] Checking for dynamically registered nodes...');

  // Get all registered node types from NodeLibrary
  const allRegisteredTypes = NodeLibrary.instance.types || [];
  console.log(`[createNodeIndex] Found ${allRegisteredTypes.length} registered node types`);

  // Find nodes that are registered but not in the static index
  const staticNodeNames = new Set();

  // Collect all node names from static index
  coreNodes.forEach(category => {
    category.items?.forEach(item => {
      if (item && item.name) staticNodeNames.add(item.name);
    });
    category.subCategories?.forEach(subCategory => {
      subCategory.items?.forEach(item => {
        if (item && item.name) staticNodeNames.add(item.name);
      });
    });
  });

  // Find unindexed nodes and group them by category
  const unindexedNodesByCategory = new Map();

  allRegisteredTypes.forEach(nodeType => {
    if (nodeType && nodeType.name && !staticNodeNames.has(nodeType.name)) {
      if (isNodeCreatable(nodeType)) {
        const category = resolveCategory(nodeType.category || 'Other');
        if (!unindexedNodesByCategory.has(category)) {
          unindexedNodesByCategory.set(category, []);
        }
        unindexedNodesByCategory.get(category).push(nodeType);
        console.log(`[createNodeIndex] Found unindexed node: ${nodeType.name} (category: ${category})`);
      }
    }
  });

  // Add unindexed nodes to existing categories or create new ones
  unindexedNodesByCategory.forEach((nodes, rawCategoryName) => {
    // Apply remap to unindexed node categories too
    const categoryName = resolveCategory(rawCategoryName);
    // Try to find existing category
    let existingCategory = coreNodes.find(cat => cat.name === categoryName);

    if (existingCategory) {
      // Add to existing category
      if (!existingCategory.items) existingCategory.items = [];
      existingCategory.items.push(...nodes);
      console.log(`[createNodeIndex] Added ${nodes.length} nodes to existing category: ${categoryName}`);
    } else {
      // Create new category
      const newCategory = {
        name: categoryName,
        description: `${categoryName} nodes`,
        type: NodeType.None,
        subCategories: [],
        items: nodes
      };
      coreNodes.push(newCategory);
      console.log(`[createNodeIndex] Created new category: ${categoryName} with ${nodes.length} nodes`);
    }
  });

  // build custom nodes
  const customNodes = [];
  const componentNodes = NodeLibrary.instance
    .getComponents()
    .filter(isNodeCreatable)
    .filter((nodeModel) => {
      const nodeModelRuntimeType = getComponentModelRuntimeType(nodeModel);
      // For maths runtime, show maths AND cloud components (both are server-side)
      if (runtimeType === RuntimeType.Maths) {
        return nodeModelRuntimeType === RuntimeType.Maths || nodeModelRuntimeType === RuntimeType.Cloud;
      }
      // For cloud runtime, show cloud AND maths components (both are server-side)
      if (runtimeType === RuntimeType.Cloud) {
        return nodeModelRuntimeType === RuntimeType.Cloud || nodeModelRuntimeType === RuntimeType.Maths;
      }
      // For browser runtime, show browser, maths, and cloud components
      // (maths/cloud are logic-only components usable as instances in UI pages)
      if (runtimeType === RuntimeType.Browser) {
        return true; // Show all component types
      }
      return runtimeType === nodeModelRuntimeType;
    });

  if (componentNodes?.length) {
    customNodes.push({
      name: 'Project components',
      description: 'Custom components in the project',
      type: NodeType.None,
      subCategories: [
        {
          name: '',
          items: componentNodes
        }
      ]
    });
  }

  // Process module nodes: redistribute into proper coreNode categories 
  // instead of dumping everything into "External libraries"
  const moduleNodes = (nodeIndexData.moduleNodes || []);
  if (moduleNodes?.length) {
    const uncategorizedItems: TSFixme[] = [];

    moduleNodes.forEach((subCategory) => {
      const resolvedNodes = getNodes(subCategory.items);

      resolvedNodes.forEach((node) => {
        if (!node) return;

        const rawCategory = (node as TSFixme).category;
        const nodeCategory = rawCategory ? resolveCategory(rawCategory) : null;

        if (nodeCategory) {
          // Try to find a matching coreNodes category
          const existingCategory = coreNodes.find(cat => cat.name === nodeCategory);

          if (existingCategory) {
            // Add to existing category's items
            if (!existingCategory.items) existingCategory.items = [];
            // Avoid duplicates
            if (!existingCategory.items.some((item: TSFixme) => item?.name === (node as TSFixme).name)) {
              existingCategory.items.push(node);
            }
          } else {
            // Create a new coreNodes category for this node's category
            const newCategory: INodeIndexCategory = {
              name: nodeCategory,
              description: `${nodeCategory} nodes`,
              type: NodeType.None,
              subCategories: [],
              items: [node]
            };
            coreNodes.push(newCategory);
          }
        } else {
          // No category — fall back to External libraries
          uncategorizedItems.push(node);
        }
      });
    });

    // Only create "External libraries" for truly uncategorized module nodes
    if (uncategorizedItems.length > 0) {
      customNodes.push({
        name: 'External libraries',
        description: 'Third party XGENIA integrations',
        type: NodeType.None,
        subCategories: [{
          name: '',
          items: uncategorizedItems
        }]
      });
    }
  }

  // For maths runtime, filter ALL categories (core + custom) to only maths-relevant ones.
  // This runs AFTER all node sources (static, dynamic, module) have been added.
  if (runtimeType === RuntimeType.Maths) {
    const MATHS_ALLOWED_CATEGORIES = new Set([
      'Logic & Events',
      'Game Logic',
      'Code & Custom',
      'Data & Cloud'
    ]);
    const filteredCore = coreNodes.filter(cat => MATHS_ALLOWED_CATEGORIES.has(cat.name));
    coreNodes.length = 0;
    coreNodes.push(...filteredCore);

    // Also filter customNodes — only keep 'Project components' (maths components)
    // and remove external libraries that aren't maths-relevant
    const filteredCustom = customNodes.filter(cat =>
      cat.name === 'Project components'
    );
    customNodes.length = 0;
    customNodes.push(...filteredCustom);
  }

  console.log(`[createNodeIndex] Final result: ${coreNodes.length} core categories, ${customNodes.length} custom categories`);

  return {
    coreNodes,
    customNodes
  };
}
