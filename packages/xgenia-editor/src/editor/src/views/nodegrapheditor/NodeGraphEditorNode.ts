import _ from 'underscore';
import debug from 'debug';
const log = debug('app:NodeGraphEditorNode');

import { ComponentModel } from '@xgenia-models/componentmodel';
import { NodeGraphNode } from '@xgenia-models/nodegraphmodel';

import { NodeLibrary } from '../../models/nodelibrary';
import { ProjectModel } from '../../models/projectmodel';
import { ViewerConnection } from '../../ViewerConnection';
import { NodeGraphEditor } from '../nodegrapheditor';
import PopupLayer from '../popuplayer';
import { NodeGraphEditorConnection } from './NodeGraphEditorConnection';

function _getColorForAnnotation(annotation) {
  if (annotation === 'Deleted') return '#F57569';
  else if (annotation === 'Changed') return '#83B8BA';
  else if (annotation === 'Created') return '#5BF59E';
}

// Cache canvas for text measurement to prevent excessive DOM creation
let textMeasurementCanvas: HTMLCanvasElement | null = null;
let textMeasurementContext: CanvasRenderingContext2D | null = null;

function getTextMeasurementCanvas() {
  if (!textMeasurementCanvas) {
    textMeasurementCanvas = document.createElement('canvas');
    textMeasurementContext = textMeasurementCanvas.getContext('2d');
  }
  return { canvas: textMeasurementCanvas, ctx: textMeasurementContext! };
}

function measureTextHeight(text, font, lineHeight, maxWidth) {
  // SAFETY: Ensure text is a string to prevent errors
  if (!text) return lineHeight; // Return minimum height for empty text

  const textStr = typeof text === 'string' ? text : String(text);
  if (!textStr || typeof textStr !== 'string') {
    console.warn('[NodeGraphEditorNode] Invalid text value for measureTextHeight:', text);
    return lineHeight;
  }

  // Fix: Reuse canvas instead of creating new one every time
  const { ctx } = getTextMeasurementCanvas();

  ctx.font = font;
  ctx.textBaseline = 'top';

  return textWordWrap(ctx, textStr, 0, 0, lineHeight, maxWidth);
}

function textWordWrap(context, text, x, y, lineHeight, maxWidth, cb?) {
  // SAFETY: Ensure text is a string to prevent "text.split is not a function" errors
  if (!text) return;

  // Convert to string if it's not already (handle numbers, objects, etc.)
  const textStr = typeof text === 'string' ? text : String(text);

  // Additional safety check
  if (!textStr || typeof textStr !== 'string') {
    console.warn('[NodeGraphEditorNode] Invalid text value for textWordWrap:', text);
    return lineHeight; // Return minimum height
  }

  let words = textStr.split(' ');
  let currentLine = 0;
  let idx = 1;
  while (words.length > 0 && idx <= words.length) {
    const str = words.slice(0, idx).join(' ');
    const w = context.measureText(str).width;
    if (w > maxWidth) {
      if (idx == 1) {
        idx = 2;
      }
      cb && cb(words.slice(0, idx - 1).join(' '), x, y + lineHeight * currentLine);
      currentLine++;
      words = words.splice(idx - 1);
      idx = 1;
    } else {
      idx++;
    }
  }
  if (idx > 0) {
    cb && cb(words.slice(0, idx - 1).join(' '), x, y + lineHeight * currentLine);
  }

  return lineHeight * currentLine + lineHeight;
}

function nodeShouldAttach(root, mousePos, nodesToAttach) {
  const potentialAttachPoints = [];

  //Gather a list of potential positions to do the drop at
  //Start with the root and recurse down
  _nodeShouldAttachRecurse(mousePos, root, nodesToAttach, potentialAttachPoints);

  // window._debugNodeGraphAttachPoints = potentialAttachPoints;

  if (potentialAttachPoints.length === 0) {
    return;
  }

  function distSquared(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  //find closest attach point
  let index = 0;
  let minDist = distSquared(mousePos, potentialAttachPoints[0].anchorPoint);
  for (let i = 1; i < potentialAttachPoints.length; i++) {
    const d = distSquared(mousePos, potentialAttachPoints[i].anchorPoint);
    if (d < minDist) {
      minDist = d;
      index = i;
    }
  }

  return potentialAttachPoints[index].attachInfo;
}

//There are 4 different valid locations to drop a node in a hierarchy:
//1. Directly at the parent, node will be added as last child
//2. In the space directly above a node. Node will become a sibling
//3. In the space directly below a node. Node will become a sibling
//4. In the space directly below a node, but offset a bit to the right. Node will become first child
//5. In the space below a node subgraph, offset a bit to the right. Node will become last child
function _nodeShouldAttachRecurse(pos, node, nodesToAttach, result) {
  const hitPadding = 10;

  const { x, y } = node.global;

  const hierarchyHeight = node.measure().height;
  const { width, height } = node.nodeSize;

  const intersectX = pos.x >= x - hitPadding && pos.x <= x + width + hitPadding;
  const intersectY = pos.y >= y - hitPadding && pos.y <= y + height + hitPadding;

  const nodeCanAcceptChildNodes = canAcceptChildNodes(node, nodesToAttach);

  //1. Directly at the parent, node will be added as last child
  if (intersectX && intersectY && nodeCanAcceptChildNodes) {
    result.push(getAttachPointOnNode(node));
  }

  if (intersectX && node.parent && canAcceptChildNodes(node.parent, nodesToAttach)) {
    //2. In the space directly above a node. Node will become a sibling
    if (pos.y >= y - NodeGraphEditorNode.childSpacing + hitPadding && pos.y <= y + height / 2 + hitPadding) {
      result.push(getAttachPointAboveNode(node));
    }

    //3. In the space directly below a node. Node will become a sibling.
    //The hit areas are slightly different depending on if the node has children:
    // - No children: hit area starts at the middle of the node
    // - Children: hit area starts after last child
    const hasChildren = node.children.length > 0;
    if (
      hasChildren &&
      pos.y >= y + hierarchyHeight - hitPadding &&
      pos.y <= y + hierarchyHeight + NodeGraphEditorNode.childSpacing + hitPadding
    ) {
      result.push(getAttachPointBelowNode(node));
    } else if (
      !hasChildren &&
      pos.y >= y + height / 2 - hitPadding &&
      pos.y <= y + height + NodeGraphEditorNode.childSpacing + hitPadding
    ) {
      result.push(getAttachPointBelowNode(node));
    }
  }

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (pos.y >= child.global.y - hitPadding) {
      _nodeShouldAttachRecurse(pos, child, nodesToAttach, result);
    }
  }

  //4. In the space directly below a node, but offset a bit to the right. Node will become first child
  if (
    nodeCanAcceptChildNodes &&
    pos.x >= x - hitPadding &&
    pos.x <= x + node.nodeSize.width + NodeGraphEditorNode.childMargin + hitPadding &&
    pos.y >= y + node.nodeSize.height - hitPadding &&
    pos.y <= y + node.nodeSize.height + NodeGraphEditorNode.childSpacing + hitPadding
  ) {
    result.push(getAttachPointBelowRightNode(node));
  }

  //5. In the space below a node subgraph, offset a bit to the right. Node will become last child
  if (
    node.children.length &&
    nodeCanAcceptChildNodes &&
    pos.x >= x - hitPadding &&
    pos.x <= x + node.nodeSize.width + NodeGraphEditorNode.childMargin + hitPadding &&
    pos.y >= y + hierarchyHeight - hitPadding &&
    pos.y <= y + hierarchyHeight + NodeGraphEditorNode.childSpacing + hitPadding
  ) {
    result.push(getAttachPointBelowRightSubgraph(node));
  }
}

function canAcceptChildNodes(node, nodes) {
  return node.model.canAcceptChildren(_.pluck(nodes, 'model'));
}

function getAttachPointBelowRightNode(node) {
  const { x, y } = node.global;

  return {
    anchorPoint: {
      x: x + node.nodeSize.width / 2 + NodeGraphEditorNode.childMargin,
      y: y + node.nodeSize.height + NodeGraphEditorNode.childSpacing / 2
    },
    attachInfo: {
      parent: node,
      index: 0,
      pos: {
        x: x + NodeGraphEditorNode.childMargin,
        y: y + node.nodeSize.height
      }
    }
  };
}

function getAttachPointOnNode(node) {
  const { x, y } = node.global;

  const hierarchyHeight = node.measure().height;

  return {
    anchorPoint: {
      x: x + node.nodeSize.width / 2,
      y: y + node.nodeSize.height / 2
    },
    attachInfo: {
      parent: node,
      index: node.children.length,
      pos: {
        x: x + NodeGraphEditorNode.childMargin,
        y: y + hierarchyHeight
      }
    }
  };
}

function getAttachPointBelowRightSubgraph(node) {
  const { x, y } = node.global;

  const hierarchyHeight = node.measure().height;

  return {
    anchorPoint: {
      x: x + node.nodeSize.width / 2 + NodeGraphEditorNode.childMargin,
      y: y + hierarchyHeight + NodeGraphEditorNode.childSpacing / 2
    },
    attachInfo: {
      parent: node,
      index: node.children.length,
      pos: {
        x: x + NodeGraphEditorNode.childMargin,
        y: y + hierarchyHeight
      }
    }
  };
}

function getAttachPointAboveNode(node) {
  const { x, y } = node.global;

  const parent = node.parent;
  const index = parent.children.indexOf(node);

  return {
    anchorPoint: {
      x: x + node.nodeSize.width / 2,
      y: y - NodeGraphEditorNode.childSpacing / 2
    },
    attachInfo: {
      parent,
      index: index,
      pos: {
        x: x,
        y: y - NodeGraphEditorNode.childSpacing
      }
    }
  };
}

function getAttachPointBelowNode(node) {
  const { x, y } = node.global;

  const parent = node.parent;
  const index = parent.children.indexOf(node);

  const hierarchyHeight = node.measure().height;

  return {
    anchorPoint: {
      x: x + node.nodeSize.width / 2,
      y: y + hierarchyHeight + NodeGraphEditorNode.childSpacing / 2
    },
    attachInfo: {
      parent,
      index: index + 1,
      pos: {
        x: x,
        y: y + hierarchyHeight
      }
    }
  };
}

// Add hexToRgba helper function (can be placed outside the class or in a utility file)
// Make sure it's accessible within the paint method's scope
function hexToRgba(hex: string, alpha: number = 1): string {
  let r = 0, g = 0, b = 0;
  // 3 digits
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
    // 6 digits
  } else if (hex.length === 7) {
    r = parseInt(hex[1] + hex[2], 16);
    g = parseInt(hex[3] + hex[4], 16);
    b = parseInt(hex[5] + hex[6], 16);
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class NodeGraphEditorNode {
  public static readonly size = { width: 150, height: 36 };
  public static readonly childMargin = 20;
  public static readonly childSpacing = 10;
  public static readonly borderSize = 7;
  public static readonly attachedThreshold = 20;
  public static readonly propertyConnectionHeight = 20;
  public static readonly verticalSpacing = 8;

  model: NodeGraphNode;
  x: number;
  y: number;
  global: { x: number; y: number };
  id: string;
  children: NodeGraphEditorNode[];
  connections: NodeGraphEditorConnection[];
  nodeSize: { width: number; height: number };
  owner: NodeGraphEditor;
  parent: NodeGraphEditorNode;
  isTrackingMove: TSFixme;
  borderHighlighted: boolean;
  connectionDragAreaHighlighted: boolean;
  _cachedLabelHeightTextKey: string;
  _cachedLabelHeight: number;
  _cachedSublabelHeightText: string;
  _cachedSublabelHeight: number;
  selected: boolean;
  measuredSize: TSFixme;
  plugs: TSFixme[];

  icon: HTMLImageElement;
  rotatingIcon: HTMLImageElement;
  iconSize: number;
  iconRotation: number;

  constructor(model) {
    this.model = model;
    this.x = model.x || 0;
    this.y = model.y || 0;
    this.global = { x: 0, y: 0 };
    this.id = model.id;
    this.children = [];
    this.connections = [];
    this.nodeSize = NodeGraphEditorNode.size;
    this.iconRotation = 0;
    this.bindModel();

    return this;
  }



  static createFromModel(model, owner, parent?) {
    const node = new NodeGraphEditorNode(model);

    node.owner = owner;
    node.parent = parent;

    _.each(model.children, function (child) {
      node.children.push(NodeGraphEditorNode.createFromModel(child, owner, node));
    });

    return node;
  }

  updateIcon() {
    // log('Updating icon for node %s, model: %O', this.id, this.model);
    const health = this.model.getHealth();
    this.iconSize = 18;
    this.rotatingIcon = null;

    if (!health.healthy) {
      this.icon = this.owner?.warningIcon;
    } else if (this.model.type instanceof ComponentModel && this.owner?.componentIcon) {
      this.icon = this.owner?.componentIcon;
    } else if (this.id === ProjectModel.instance.getRootNode()?.id) {
      this.icon = this.owner?.homeIcon;

    } else {
      this.icon = undefined;
    }
  }

  bindModel() {
    const _this = this;
    this.model.on(
      'change',
      function (args) {
        _this.owner.relayout();
        _this.owner.repaint();
      },
      this
    );

    this.model.on(
      'instancePortsChanged',
      function () {
        _this.connections.forEach(function (c) {
          c.resolvePorts();
        });
        _this.owner.relayout();
        _this.owner.repaint();
      },
      this
    );
  }

  destruct() {
    this.model.off(this);

    for (const child of this.children) {
      child.destruct();
    }
  }

  updateModel() {
    log('Updating model for node %s, model: %O', this.id, this.model);
    this.model.set({ x: this.x, y: this.y });
  }

  forEach(callback: (child: NodeGraphEditorNode) => boolean) {
    if (callback(this)) {
      return true;
    }
    for (const i in this.children) {
      if (this.children[i].forEach(callback)) {
        return false;
      }
    }
  }

  pointInside(pos) {
    const bw = NodeGraphEditorNode.borderSize;
    const inside =
      pos.x >= this.x - bw &&
      pos.x <= this.x + this.nodeSize.width + bw &&
      pos.y >= this.y - bw &&
      pos.y <= this.y + this.nodeSize.height + bw;

    return inside;
  }

  propagateMouse(type, pos, evt) {
    // Propagate mouse event to children
    for (const child of this.children) {
      child.propagateMouse(type, { x: pos.x - this.x, y: pos.y - this.y }, evt);
    }

    // Enlarge the hit area with the border size
    if (this.pointInside(pos) && type !== 'out') {
      if (type === 'move' && !this.isTrackingMove) {
        // If this is a move event and this node is not tracking move events
        // generate a move in first
        this.mouse('move-in', { x: pos.x - this.x, y: pos.y - this.y }, evt);
        this.isTrackingMove = true;
      }
      this.mouse(type, { x: pos.x - this.x, y: pos.y - this.y }, evt);
    } else if (this.isTrackingMove) {
      // The mouse exited the node, if it was tracking generate a move out event
      this.isTrackingMove = false;
      this.mouse('move-out', { x: pos.x - this.x, y: pos.y - this.y }, evt);
    }
  }

  mouse(type, pos, evt) {
    if (evt.button !== 0) return; //only interact with left mouse button

    evt.consumed = true;

    switch (type) {
      case 'move':
      case 'move-in':
        // Is the mouse hovering the border or body of the node?
        var bw = NodeGraphEditorNode.borderSize;
        if (pos.x < bw || pos.x > this.nodeSize.width - bw || pos.y < bw || pos.y > this.nodeSize.height - bw) {
          this.borderHighlighted = true;
        } else {
          this.borderHighlighted = false;
        }

        // Send node highlighted to viewer if this node is being highligted
        if (!this.borderHighlighted) ViewerConnection.instance.sendNodeHighlighted(this.model, true);

        this.owner.setHighlightedNode(this, pos);

        // Show tooltop if this node is annotated
        if (this.model.annotation) {
          PopupLayer.instance.showTooltip({
            x: evt.pageX,
            y: evt.pageY,
            position: 'bottom',
            content: this.model.annotation
          });
        } else {
          // Show tooltip if the connection is unhealthy
          const health = this.model.getHealth();
          if (!health.healthy) {
            PopupLayer.instance.showTooltip({
              x: evt.pageX,
              y: evt.pageY,
              position: 'bottom',
              content: health.message
            });
          }
        }

        this.connectionDragAreaHighlighted = pos.x > this.nodeSize.width - 20 && pos.y < 20;

        const showCrosshairCursor = this.connectionDragAreaHighlighted || this.borderHighlighted;
        this.owner.el.css({
          cursor: showCrosshairCursor ? 'crosshair' : 'initial'
        });

        this.owner.repaint();
        break;
      case 'move-out':
        PopupLayer.instance.hideTooltip();

        this.owner.el.css({ cursor: 'initial' });

        // Clear highlight on move out
        if (this.owner.highlighted === this) {
          this.owner.setHighlightedNode(undefined);
        }

        this.connectionDragAreaHighlighted = false;
        this.borderHighlighted = false;
        this.owner.repaint();

        ViewerConnection.instance.sendNodeHighlighted(this.model, false);
        break;
      case 'down':
        PopupLayer.instance.hideTooltip();

        if (this.owner.highlighted === this) {
          if (this.borderHighlighted || this.connectionDragAreaHighlighted) {
            // User starts dragging from the border or connection area with circle icon
            this.owner.startDraggingConnection(this);
          } else {
            if (evt.shiftKey) {
              this.owner.addNodeToSelection(this);
            } else {
              this.owner.startDraggingNode(this);
            }
          }
        }
        break;
      case 'up':
        {
          const hasModifierKey = evt.metaKey || evt.ctrlKey || evt.shiftKey;
          if (!hasModifierKey) {
            this.owner.selectNode(this);
          }
        }
        break;
    }
  }

  isProjectRoot() {
    return ProjectModel.instance.getRootNode() === this.model;
  }

  isComponent() {
    return this.model.type instanceof ComponentModel;
  }

  titlebarLabelHeight() {
    // SAFETY: Ensure label is a string to prevent text processing errors
    const safeLabel = typeof this.model.label === 'string' ? this.model.label : String(this.model.label || 'Node');

    const cacheKey = safeLabel + (this.icon ? 'icon' : '');
    if (cacheKey !== this._cachedLabelHeightTextKey) {
      const connectionDragAreaWidth = 10;
      const horizontalSpacing = 10;

      const iconOffset = this.icon ? 12 : 0;

      const maxWidth = this.nodeSize.width - 2 * horizontalSpacing - connectionDragAreaWidth - iconOffset;

      this._cachedLabelHeight = measureTextHeight(safeLabel, '12px Inter-Regular', 14, maxWidth);
      this._cachedLabelHeightTextKey = cacheKey;
    }

    return this._cachedLabelHeight;
  }

  titlebarSublabelHeight() {
    if (this.typeDisplayName() !== this._cachedSublabelHeightText) {
      const connectionDragAreaWidth = 10;
      const horizontalSpacing = 10;
      const maxWidth = this.nodeSize.width - 2 * horizontalSpacing - connectionDragAreaWidth;

      this._cachedSublabelHeight = measureTextHeight(this.typeDisplayName(), '12px Inter-Regular', 14, maxWidth);
      this._cachedSublabelHeightText = this.typeDisplayName();
    }

    return this._cachedSublabelHeight;
  }

  titlebarHeight() {
    const labelExtraHeight = this.safeLabel !== this.typeDisplayName() ? this.titlebarSublabelHeight() : 0;
    return this.titlebarLabelHeight() + labelExtraHeight + 24;
  }

  typeDisplayName() {
    return this.model.metadata?.typeLabelOverride || this.model.type.displayName;
  }

  // SAFETY: Ensure node label is always a string
  get safeLabel(): string {
    return typeof this.model.label === 'string' ? this.model.label : String(this.model.label || 'Node');
  }

  // --- Helper: Draw Rounded Rectangle Path ---
  static roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();
  }

  paint(ctx: CanvasRenderingContext2D, paintRect, options?) {
    const _this = this;

    const { roundedRect } = NodeGraphEditorNode;

    const x = this.global.x;
    const y = this.global.y;

    const isOutsidePaintArea =
      x > paintRect.maxX ||
      y > paintRect.maxY ||
      x + this.nodeSize.width < paintRect.minX ||
      y + this.nodeSize.height < paintRect.minY;

    if (isOutsidePaintArea === false) {
      this.updateIcon();

      // --- Computed style helper (cached per paint cycle) ---
      const computedStyleCache = {};
      function getCssVar(varName: string, fallback: string = '#000000'): string {
        if (computedStyleCache[varName]) return computedStyleCache[varName];
        try {
          const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
          computedStyleCache[varName] = value || fallback;
          return computedStyleCache[varName];
        } catch (e: any) {
          computedStyleCache[varName] = fallback;
          return fallback;
        }
      }

      // --- Accent color resolution ---
      const textColor = getCssVar('--app-color-text', '#FFFFFF');
      const nodeColorCategory = this.model.type?.color || 'default';
      let accentColorVar = '--app-color-default-accent';

      switch (nodeColorCategory.toLowerCase()) {
        case 'visual': case 'green': accentColorVar = '--app-color-green'; break;
        case 'logic': case 'blue': accentColorVar = '--app-color-blue'; break;
        case 'data': case 'orange': accentColorVar = '--app-color-orange'; break;
        case 'purple': accentColorVar = '--app-color-purple'; break;
        case 'deprecated': case 'red': accentColorVar = '--app-color-red'; break;
      }

      if (this.model.metadata?.colorOverride) {
        const override = this.model.metadata.colorOverride.toLowerCase();
        if (['green', 'blue', 'red', 'orange', 'purple'].includes(override)) {
          accentColorVar = `--app-color-${override}`;
        }
      }

      const accentColor = getCssVar(accentColorVar, '#5FA8FF');

      // --- Parse accent color to RGB for alpha compositing ---
      const accentRgb = hexToRgba(accentColor, 1); // just for parsing
      let aR = 95, aG = 168, aB = 255; // defaults (blue)
      try {
        const m = accentColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (m) { aR = parseInt(m[1], 16); aG = parseInt(m[2], 16); aB = parseInt(m[3], 16); }
      } catch (_e) { /* use defaults */ }

      const isHighligthed = this.owner.isHighlighted(this);
      const { width, height } = this.nodeSize;
      const borderRadius = 12;

      // ═══════════════════════════════════════════════
      // 1. SHADOW — Single subtle elevation
      // ═══════════════════════════════════════════════
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 6;
      roundedRect(ctx, x, y, width, height, borderRadius);
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fill();
      ctx.restore();

      // ═══════════════════════════════════════════════
      // 2. BACKGROUND — Elevated surface (above canvas #151414)
      // ═══════════════════════════════════════════════
      const bgGradient = ctx.createLinearGradient(x, y, x, y + height);
      bgGradient.addColorStop(0, 'rgba(48, 48, 58, 0.98)');
      bgGradient.addColorStop(1, 'rgba(40, 40, 50, 0.98)');
      roundedRect(ctx, x, y, width, height, borderRadius);
      ctx.fillStyle = bgGradient;
      ctx.fill();

      // ═══════════════════════════════════════════════
      // 3. BORDER — Subtle accent border
      // ═══════════════════════════════════════════════
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 1;
      roundedRect(ctx, x, y, width, height, borderRadius);
      ctx.stroke();

      // ═══════════════════════════════════════════════
      // 4. CLIP for inner content
      // ═══════════════════════════════════════════════
      ctx.save();
      roundedRect(ctx, x, y, width, height, borderRadius);
      ctx.clip();

      // ═══════════════════════════════════════════════
      // 5. LEFT CATEGORY BAR — Apple-style persistent type indicator
      // (à la Logic Pro / Calendar / Xcode breadcrumbs)
      // ═══════════════════════════════════════════════
      const barWidth = 3;
      const barRadius = Math.min(barWidth / 2, borderRadius);
      // Fade in from top, solid through body, fade out toward bottom
      const leftBarGradient = ctx.createLinearGradient(x, y, x, y + height);
      leftBarGradient.addColorStop(0, `rgba(${aR}, ${aG}, ${aB}, 0.4)`);
      leftBarGradient.addColorStop(0.15, `rgba(${aR}, ${aG}, ${aB}, 0.85)`);
      leftBarGradient.addColorStop(0.85, `rgba(${aR}, ${aG}, ${aB}, 0.85)`);
      leftBarGradient.addColorStop(1, `rgba(${aR}, ${aG}, ${aB}, 0.4)`);
      ctx.fillStyle = leftBarGradient;
      ctx.fillRect(x, y, barWidth, height);

      // ═══════════════════════════════════════════════
      // 6. ICON (drawn inside clipped area)
      // ═══════════════════════════════════════════════
      if (this.icon) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const hSpacing = 10;
        const dragAreaW = 10;
        const offset = Math.abs(this.iconSize - 18);

        ctx.drawImage(
          this.icon,
          x + hSpacing + width - hSpacing - dragAreaW - 16 - offset,
          y + NodeGraphEditorNode.verticalSpacing + 1 - offset / 2,
          this.iconSize,
          this.iconSize
        );

        if (this.rotatingIcon) {
          ctx.save();
          ctx.translate(
            x + hSpacing + width - hSpacing - dragAreaW - 16 - offset + this.iconSize / 2,
            y + NodeGraphEditorNode.verticalSpacing + 1 - offset / 2 + this.iconSize / 2
          );
          ctx.rotate(this.iconRotation);
          ctx.drawImage(this.rotatingIcon, -this.iconSize / 2, -this.iconSize / 2, this.iconSize, this.iconSize);
          ctx.restore();
        }
      }

      // ═══════════════════════════════════════════════
      // 7. TITLE TEXT — Neutral colors, let content breathe
      // ═══════════════════════════════════════════════
      const hasUserLabel = this.typeDisplayName() && this.model.label !== this.typeDisplayName();
      const hSpacingText = 10;
      const dragAreaWText = 10;
      const iconAreaWidth = this.icon ? (this.iconSize + 4) : 0;
      const rightControlAreaWidth = hSpacingText + dragAreaWText;
      const textMaxWidth = this.nodeSize.width - hSpacingText - rightControlAreaWidth - iconAreaWidth;

      const tx = x + hSpacingText;
      const ty = y + NodeGraphEditorNode.verticalSpacing + 5;
      const lineHeight = 14;

      // Main label — clean white, medium weight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.font = '500 12px Urbanist';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';

      textWordWrap(
        ctx,
        this.safeLabel,
        tx,
        ty,
        lineHeight,
        textMaxWidth,
        (lineText, lineX, lineY) => ctx.fillText(lineText, lineX, lineY)
      );

      // Sublabel — tertiary, understated
      if (hasUserLabel) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.font = '400 10px Urbanist';
        ctx.textBaseline = 'top';

        const mainLabelHeight = measureTextHeight(this.safeLabel, '500 12px Urbanist', lineHeight, textMaxWidth);
        const subLabelTy = y + mainLabelHeight + NodeGraphEditorNode.verticalSpacing + 2;

        textWordWrap(
          ctx,
          this.typeDisplayName(),
          tx,
          subLabelTy,
          lineHeight - 2,
          textMaxWidth,
          (lineText, lineX, lineY) => ctx.fillText(lineText, lineX, lineY)
        );
        ctx.restore();
      }

      // ═══════════════════════════════════════════════
      // 8. SEPARATOR LINE — Below title, above ports
      // ═══════════════════════════════════════════════
      const separatorY = y + this.titlebarHeight() - 2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 8, separatorY);
      ctx.lineTo(x + width - 8, separatorY);
      ctx.stroke();

      // (Bottom status bar removed — Apple restraint: no unnecessary chrome)

      // 10. HIGHLIGHT PLATE (hover/selected overlay)
      // ═══════════════════════════════════════════════
      // Fixed neon purple for all selection states (#EC5BE0)
      const selR = 236, selG = 91, selB = 224;

      if (isHighligthed && !this.selected) {
        // Hover only — subtle purple tint
        const prevComp = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'hard-light';
        ctx.globalAlpha = 0.04;
        ctx.fillStyle = '#EC5BE0';
        ctx.fillRect(x, y, width, height);
        ctx.globalCompositeOperation = prevComp;
        ctx.globalAlpha = 1;
      }

      ctx.restore(); // Remove clipping

      // ═══════════════════════════════════════════════
      // 11. SELECTION — Neon purple glow
      // ═══════════════════════════════════════════════
      if (this.selected || this.borderHighlighted || this.connectionDragAreaHighlighted) {
        // Neon purple glow
        ctx.save();
        ctx.shadowColor = `rgba(${selR}, ${selG}, ${selB}, 0.25)`;
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = `rgba(${selR}, ${selG}, ${selB}, 0.8)`;
        ctx.lineWidth = 1.5;
        roundedRect(ctx, x, y, width, height, borderRadius);
        ctx.stroke();
        ctx.restore();
      } else if (isHighligthed) {
        // Hover — faint purple border
        ctx.strokeStyle = `rgba(${selR}, ${selG}, ${selB}, 0.15)`;
        ctx.lineWidth = 1;
        roundedRect(ctx, x, y, width, height, borderRadius);
        ctx.stroke();
      }

      if (this.model.annotation) {
        if (this.model.annotation === 'Deleted') ctx.strokeStyle = 'rgba(255, 71, 71, 0.7)';
        else if (this.model.annotation === 'Changed') ctx.strokeStyle = 'rgba(40, 96, 235, 0.7)';
        else if (this.model.annotation === 'Created') ctx.strokeStyle = 'rgba(102, 255, 76, 0.7)';
        else ctx.strokeStyle = accentColor;

        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 3]);
        roundedRect(ctx, x, y, width, height, borderRadius);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // ═══════════════════════════════════════════════
      // 12. PORT INDICATORS — Styled circles (ring + inner dot)
      // ═══════════════════════════════════════════════
      let plugTx, plugTy;
      const horizontalSpacingPlugs = 10;

      function portDot(side: string, color: string) {
        const cx = x + (side === 'left' ? 0 : _this.nodeSize.width);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, plugTy, 3, 0, 2 * Math.PI);
        ctx.fill();
      }

      function drawPlugs(plugs, offset) {
        ctx.font = '400 10px Urbanist';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = 1;

        for (const i in plugs) {
          const p = plugs[i];

          plugTy = p.index * NodeGraphEditorNode.propertyConnectionHeight + offset;

          if (p.loc === 'left' || p.loc === 'middle') plugTx = x + horizontalSpacingPlugs;
          else if (p.loc === 'right') plugTx = x + width - horizontalSpacingPlugs;
          else plugTx = x + width / 2;

          // Port label — tertiary
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.textAlign = p.loc === 'right' ? 'right' : 'left';
          ctx.fillText(p.displayName ? p.displayName : p.property, plugTx, plugTy);

          // Left port indicator
          if (p.leftCons.length) {
            let plugColor = accentColor;
            const highlightedCon = _.find(p.leftCons, c => c.isHighlighted());
            if (highlightedCon) plugColor = '#EC5BE0';

            const topCon = highlightedCon || p.leftCons[p.leftCons.length - 1];
            if (topCon.model.annotation) {
              if (topCon.model.annotation === 'Deleted') plugColor = '#FF4747';
              else if (topCon.model.annotation === 'Changed') plugColor = '#2860EB';
              else if (topCon.model.annotation === 'Created') plugColor = '#66FF4C';
            }
            portDot('left', plugColor);
          }

          // Right port indicator
          if (p.rightCons.length) {
            let plugColor = accentColor;
            const highlightedCon = _.find(p.rightCons, c => c.isHighlighted());
            if (highlightedCon) plugColor = '#EC5BE0';

            const topCon = highlightedCon || p.rightCons[p.rightCons.length - 1];
            if (topCon.model.annotation) {
              if (topCon.model.annotation === 'Deleted') plugColor = '#FF4747';
              else if (topCon.model.annotation === 'Changed') plugColor = '#2860EB';
              else if (topCon.model.annotation === 'Created') plugColor = '#66FF4C';
            }
            portDot('right', plugColor);
          }
        }
      }

      drawPlugs(this.plugs, y + this.titlebarHeight() + NodeGraphEditorNode.propertyConnectionHeight / 2 + NodeGraphEditorNode.verticalSpacing);

      ctx.textBaseline = 'middle';
    }

    // Paint children
    if (!(options && options.dontPaintChildren)) {
      for (const i in this.children) {
        this.children[i].paint(ctx, paintRect);
      }
    }
  }

  setPosition(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.global.x = x + (this.parent ? this.parent.global.x : 0);
    this.global.y = y + (this.parent ? this.parent.global.y : 0);
  }

  layout() {
    let y = this.nodeSize.height + NodeGraphEditorNode.childSpacing;
    _.each(this.children, function (child) {
      const size = child.measure();

      child.setPosition(NodeGraphEditorNode.childMargin, y);
      child.layout(); // Recurse to layout children

      y += size.height + NodeGraphEditorNode.childSpacing;
    });
  }

  sortConnections() {
    const _this = this;

    this.connections.sort(function (a, b) {
      return a.getPropertyFor(_this) < b.getPropertyFor(_this) ? -1 : 1;
    });
  }

  measure() {
    if (this.measuredSize) return this.measuredSize;

    if (!this.children) {
      this.measuredSize = NodeGraphEditorNode.size;
    } else {
      const size = {
        width: NodeGraphEditorNode.size.width,
        height: NodeGraphEditorNode.size.height
      };

      // Collect all connections into plugs and groups
      const plugs = (this.plugs = []);
      /*  var groups = this.plugGroups = {};
      function addPlugToGroup(p,group) {
        var name = group?group:'Other';
        if(!groups[name]) groups[name] = {name:name,leftCons:0,rightCons:0,plugs:[]};
        groups[name].plugs.push(p);
        return groups[name];
      }*/
      for (const i in this.connections) {
        const con = this.connections[i];
        const prop = con.getPropertyFor(this);
        const loc = con.getLocationRelativeTo(this) === 'left' ? 'right' : 'left';
        let p = plugs[plugs.length - 1];

        // Connections are sorted alphabetically, so if there are multiple connections
        // to this port they will be directly after each other in the array
        if (p && p.property === prop) {
          p.loc = p.loc === loc ? loc : 'middle'; // have connection on multiple side, center the plug
          con.setPlugFor(this, p);
        } else {
          plugs.push({
            property: prop,
            displayName: con.getPortDisplayNameFor(this),
            loc: loc,
            dir: con.getDirectionFor(this),
            leftCons: [],
            rightCons: [],
            index: con.getPortIndexFor(this)
          });
          p = plugs[plugs.length - 1];
          con.setPlugFor(this, p);
          //addPlugToGroup(p,con.getPortGroupNameFor(this));
        }

        // Store the connections based on where they are coming from
        if (loc === 'left') p.leftCons.push(con);
        else p.rightCons.push(con);

        // Set the icon for the left or right side of the plug
        p[loc + 'Icon'] =
          p[loc + 'Icon'] === undefined || p[loc + 'Icon'] === con.getDirectionFor(this)
            ? con.getDirectionFor(this)
            : 'both';
      }

      plugs.sort((a, b) => a.index - b.index);

      // Layout and measure connections
      const rowBreakPortNameLength = 10;
      let offset = 0;

      function layoutPlugs(plugs, g) {
        for (const p of plugs) {
          // Measure and place the plugs
          const label = p.displayName ? p.displayName : p.property;
          if (p.loc === 'middle' || label.length > rowBreakPortNameLength) {
            // p.col is 'middle' or string to long to share line
            p.index = Math.max(g.rightCons, g.leftCons) + offset;
            g.rightCons = g.leftCons = p.index + 1 - offset;
          } else if (p.loc === 'left') {
            p.index = g.leftCons + offset;
            g.leftCons++;
          } else if (p.loc === 'right') {
            p.index = g.rightCons + offset;
            g.rightCons++;
          }
        }
        return Math.max(g.rightCons, g.leftCons);
      }

      // Don't show group title if there is only and Other group
      offset = layoutPlugs(plugs, { leftCons: 0, rightCons: 0 });

      this.updateIcon(); //make sure we have the right icon when measuring

      if (offset === 0) {
        // No plugs
        size.height = Math.max(NodeGraphEditorNode.size.height, this.titlebarHeight());
      } else {
        size.height =
          offset * NodeGraphEditorNode.propertyConnectionHeight +
          this.titlebarHeight() +
          NodeGraphEditorNode.verticalSpacing * 2;
      }

      this.nodeSize = { width: size.width, height: size.height };

      _.each(this.children, function (child) {
        const childSize = child.measure();
        size.height += childSize.height + NodeGraphEditorNode.childSpacing;
        size.width = Math.max(NodeGraphEditorNode.childMargin + childSize.width, size.width);
      });

      this.measuredSize = size;
    }
    return this.measuredSize;
  }

  shouldConnect(pos, fromNode, origin?) {
    const x = (origin ? origin.x : 0) + this.x;
    const y = (origin ? origin.y : 0) + this.y;

    if (pos.x > x && pos.x < x + this.nodeSize.width && pos.y > y && pos.y < y + this.nodeSize.height) {
      return this;
    }

    // Recurse to children
    for (const i in this.children) {
      const node = this.children[i].shouldConnect(pos, fromNode, { x: x, y: y });
      if (node) return node;
    }
  }

  isVisual() {
    return this.model.type.visual;
  }

  canHaveVisualChildren() {
    return this.model.type.canHaveVisualChildren;
  }

  shouldAttach(pos, nodes) {
    return nodeShouldAttach(this, pos, nodes);
  }

  insertChild(child, index) {
    // Move child position into local coords
    const global = this.global;
    child.x -= global.x;
    child.y -= global.y;

    // Insert child in hierarchy
    child.parent = this;
    this.children.splice(index, 0, child);
  }

  addChild(child) {
    this.children.push(child);
    child.parent = this;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    idx !== -1 && this.children.splice(idx, 1);
  }

  detach() {
    if (this.parent) {
      // Find my position in global space
      const global = this.global;
      this.x = global.x;
      this.y = global.y;

      // Detatch
      const idx = this.parent.children.indexOf(this);
      this.parent.children.splice(idx, 1);
      this.parent = undefined;
    }
  }
}
