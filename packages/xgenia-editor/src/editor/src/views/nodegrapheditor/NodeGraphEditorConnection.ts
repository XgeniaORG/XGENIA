import { NodeGraphColors } from '@xgenia-constants/NodeGraphColors';
import { Connection } from '@xgenia-models/nodegraphmodel';
import { NodeLibrary } from '@xgenia-models/nodelibrary';
import DebugInspector from '@xgenia-utils/debuginspector';

import { IVector2, NodeGraphEditor } from '../nodegrapheditor';
import PopupLayer from '../popuplayer';
import { NodeGraphEditorNode } from './NodeGraphEditorNode';

function getPortName(p) {
  return p ? p.editorName || p.displayName : undefined;
}

function getPortIndex(p) {
  return p ? p.index || 0 : undefined;
}

type ClipRect = { minX: number; maxX: number; minY: number; maxY: number };

// 2026-10-28 perf audit. A wire is one cubic from its source plug to its target
// plug, and in a big graph most wires are far longer than the view: on a 440
// node / 822 wire game the 521 wires crossing a 1670x602 view had a median
// height of ~9,750 world units and a max of ~34,000. Skia rasterizes the WHOLE
// stroke regardless of what is on screen, so the GPU process spent ~95% of its
// time in SkCanvas::drawPath (~210us per wire, up to 50ms for one) and input
// lagged 150-450ms — zooming over dense wiring felt frozen, and the 30 Hz
// debug pulse repaint kept it that way even with no input. Trimming each wire
// to the view with de Casteljau splits (below) took drawPath to ~27us a wire
// and input latency to ~10-25ms on the same graph.
//
// 14 splits deep is 1/16384 of the wire — ~2 world units on the longest one
// measured, finer than the stroke — so segments straddling the edge stop
// splitting there and are drawn whole.
const CLIP_MAX_DEPTH = 14;

function addCubicInRect(ctx: CanvasRenderingContext2D, x0, y0, x1, y1, x2, y2, x3, y3, rect: ClipRect, depth: number, pen: IVector2) {
  // The control points' bounding box contains the curve, so this culls safely.
  const minX = Math.min(x0, x1, x2, x3);
  const maxX = Math.max(x0, x1, x2, x3);
  const minY = Math.min(y0, y1, y2, y3);
  const maxY = Math.max(y0, y1, y2, y3);
  if (minX > rect.maxX || maxX < rect.minX || minY > rect.maxY || maxY < rect.minY) return;

  const inside = minX >= rect.minX && maxX <= rect.maxX && minY >= rect.minY && maxY <= rect.maxY;
  if (inside || depth >= CLIP_MAX_DEPTH) {
    // Continue the current subpath when this piece starts where the last one
    // ended, so the visible run strokes as one line with no seams at the splits.
    if (pen.x !== x0 || pen.y !== y0) ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
    pen.x = x3;
    pen.y = y3;
    return;
  }

  // Split at t = 0.5
  const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2;
  const bx = (x1 + x2) / 2, by = (y1 + y2) / 2;
  const cx = (x2 + x3) / 2, cy = (y2 + y3) / 2;
  const dx = (ax + bx) / 2, dy = (ay + by) / 2;
  const ex = (bx + cx) / 2, ey = (by + cy) / 2;
  const mx = (dx + ex) / 2, my = (dy + ey) / 2;

  addCubicInRect(ctx, x0, y0, ax, ay, dx, dy, mx, my, rect, depth + 1, pen);
  addCubicInRect(ctx, mx, my, ex, ey, cx, cy, x3, y3, rect, depth + 1, pen);
}

export class NodeGraphEditorConnection {
  ctx: CanvasRenderingContext2D;
  owner: NodeGraphEditor;

  fromNode: any;
  toNode: any;
  fromPort: any;
  toPort: any;

  fromPlug: any;
  toPlug: any;

  model: Connection;
  curve: any;
  color: any;
  lineWidth: number | undefined;

  fromProperty: string;
  toProperty: string;

  constructor(model: Connection, ctx) {
    this.model = model;
    for (const i in model) this[i] = model[i];
    this.ctx = ctx;
  }

  // 2026-06-03 (cost-noise audit): saved project state with corrupted
  // (undefined) sourceId/targetId causes this skip-warn to fire repeatedly
  // on every editor render and component switch — flooding the console
  // with identical warnings + 13-frame stack traces. Dedup per
  // (fromId, toId) pair so each ghost connection is reported once per
  // session, surfacing the project-level corruption signal without
  // drowning real bugs. Reset via static method on editor reinit.
  private static _loggedMissingConnections: Set<string> = new Set();
  static resetMissingConnectionLog(): void {
    NodeGraphEditorConnection._loggedMissingConnections.clear();
  }

  static createFromModel(model: Connection, owner: NodeGraphEditor, ctx?: CanvasRenderingContext2D) {
    const con = new NodeGraphEditorConnection(model, ctx);

    con.fromNode = owner.findNodeWithId(model.fromId);
    con.toNode = owner.findNodeWithId(model.toId);
    con.owner = owner;

    // Safety check: only create connection if both nodes exist
    if (!con.fromNode || !con.toNode) {
      const key = `${model.fromId || 'undef'}->${model.toId || 'undef'}`;
      if (!NodeGraphEditorConnection._loggedMissingConnections.has(key)) {
        NodeGraphEditorConnection._loggedMissingConnections.add(key);
        console.warn('[NodeGraphEditorConnection] Skipping connection creation - missing nodes:', {
          fromId: model.fromId,
          toId: model.toId,
          fromNodeFound: !!con.fromNode,
          toNodeFound: !!con.toNode,
          _note: 'Subsequent occurrences of this same (fromId,toId) pair will be silent this session. Reset via NodeGraphEditorConnection.resetMissingConnectionLog().'
        });
      }
      return null; // Return null instead of crashing
    }

    con.connect();

    return con;
  }

  resolvePorts(args?) {
    // Safety check: ensure nodes exist and have models before accessing ports
    if (!this.fromNode || !this.fromNode.model || !this.toNode || !this.toNode.model) {
      console.warn('[NodeGraphEditorConnection] Cannot resolve ports - missing nodes or models:', {
        fromNode: !!this.fromNode,
        fromNodeModel: !!(this.fromNode?.model),
        toNode: !!this.toNode,
        toNodeModel: !!(this.toNode?.model),
        connection: { fromId: this.model?.fromId, toId: this.model?.toId }
      });
      return;
    }

    this.fromPort = this.fromNode.model.getPort(this.fromProperty, 'output');
    this.toPort = this.toNode.model.getPort(this.toProperty, 'input');
  }

  connect(args?) {
    // If args provided, use them to set node references
    if (args) {
      this.fromNode = args.fromNode;
      this.toNode = args.toNode;
      this.fromProperty = args.fromProperty;
      this.toProperty = args.toProperty;
    }

    // Safety check: ensure we have valid nodes
    if (!this.fromNode || !this.toNode) {
      console.warn('[NodeGraphEditorConnection] Cannot connect - missing nodes');
      return;
    }

    this.resolvePorts();

    this.fromNode.connections.push(this);
    this.fromNode.sortConnections();

    this.toNode.connections.push(this);
    this.toNode.sortConnections();

    if (this.owner.connections.indexOf(this) === -1) this.owner.connections.push(this);
  }

  disconnect() {
    // Safely disconnect from nodes, handling cases where nodes might be undefined
    if (this.fromNode && this.fromNode.connections) {
      let idx = this.fromNode.connections.indexOf(this);
      if (idx !== -1) this.fromNode.connections.splice(idx, 1);
    }

    if (this.toNode && this.toNode.connections) {
      let idx = this.toNode.connections.indexOf(this);
      if (idx !== -1) this.toNode.connections.splice(idx, 1);
    }

    if (this.owner && this.owner.connections) {
      let idx = this.owner.connections.indexOf(this);
      if (idx !== -1) this.owner.connections.splice(idx, 1);
    }

    this.fromNode = this.toNode = undefined;
    this.fromProperty = this.toProperty = undefined;
  }

  getLocationRelativeTo(node) {
    const other = node === this.toNode ? this.fromNode : this.toNode;

    if (node.global.x < other.global.x - NodeGraphEditorNode.size.width * 1.1) {
      return 'left';
    } else if (other.global.x < node.global.x - NodeGraphEditorNode.size.width * 1.1) {
      return 'right';
    } else {
      return 'inline';
    }
  }

  getPropertyFor(node) {
    return node === this.fromNode ? this.fromProperty : this.toProperty;
  }

  getPortDisplayNameFor(node) {
    return node === this.fromNode ? getPortName(this.fromPort) : getPortName(this.toPort);
  }

  getPortIndexFor(node) {
    return node === this.fromNode ? getPortIndex(this.fromPort) : getPortIndex(this.toPort);
  }

  getPortGroupNameFor(node) {
    return node === this.fromNode
      ? this.fromPort
        ? this.fromPort.group
        : undefined
      : this.toPort
        ? this.toPort.group
        : undefined;
  }

  getDirectionFor(node) {
    return node === this.fromNode ? 'from' : 'to';
  }

  setPlugFor(node, plug) {
    if (node === this.fromNode) this.fromPlug = plug;
    else this.toPlug = plug;
  }

  isHighlighted() {
    return (
      (this.owner && this.owner.highlightedConnection === this) ||
      this.owner.isHighlighted(this.fromNode) ||
      this.owner.isHighlighted(this.toNode) ||
      this.owner.selector.isActive(this.fromNode) ||
      this.owner.selector.isActive(this.toNode)
    );
  }

  mouse(type, pos: IVector2, evt) {
    if (evt.button !== 0) return; //only interact with left mouse button

    const _this = this;
    // A disconnected connection keeps its last curve; don't let it be hovered
    if (!this.fromNode || !this.toNode) return;

    if (type === 'move') {
      if (this.ctx) {
        this.ctx.lineWidth = 10;
        // Only the piece of the wire near the cursor can be under it; hit-testing
        // the whole (often 10,000+ unit) curve on every mouse move is wasted work.
        const hit = 10;
        this.drawCurve({ minX: pos.x - hit, maxX: pos.x + hit, minY: pos.y - hit, maxY: pos.y + hit });
        if (this.ctx.isPointInStroke(pos.x, pos.y)) {
          evt.consumed = true;
          this.owner.setHighlightedConnection(this, pos);

          // Show tooltip if the connection is unhealthy or has annotations
          if (this.owner.deleteModeConnection !== this) {
            // annotations takes priority over health
            if (this.model.annotation) {
              PopupLayer.instance.showTooltip({
                x: evt.pageX,
                y: evt.pageY,
                position: 'bottom',
                content: this.model.annotation
              });
            } else {
              const health = this.getHealth();
              if (!health.healthy) {
                PopupLayer.instance.showTooltip({
                  x: evt.pageX,
                  y: evt.pageY,
                  position: 'bottom',
                  content: health.message
                });
              }
            }
          }
          this.owner.repaint();
        } else if (this.owner.highlightedConnection === this) {
          this.owner.setHighlightedConnection(undefined);
          PopupLayer.instance.hideTooltip();
          this.owner.repaint();
        }
      }
    } else if (type === 'down' && this.owner.highlightedConnection === this) {
      evt.consumed = true;
    } else if (type === 'up' && this.owner.highlightedConnection === this) {
      PopupLayer.instance.hideTooltip();
      evt.consumed = true;

      if (this.model && this.owner.readOnly !== true) {
        // Don't do delete connection if in read only mode
        if (this.owner.deleteModeConnection === this) {
          // Connection is clicked the second time
          // Delete the connection
          this.owner.deleteModeConnection = undefined;
          this.owner.setHighlightedConnection(undefined);
          this.owner.removeConnection(this.model);
        } else {
          // Connection is clicked, turn it into a delete connection
          this.owner.deleteModeConnection = this;
          this.owner.repaint();

          // If nothing has happened in 3 seconds clear delete mode
          this.owner.clearDeleteModeTimer && clearTimeout(this.owner.clearDeleteModeTimer);
          this.owner.clearDeleteModeTimer = setTimeout(function () {
            if ((_this.owner.deleteModeConnection = _this)) {
              _this.owner.deleteModeConnection = undefined;
              _this.owner.repaint();
            }
          }, 3000);
        }
      }
    }
  }

  /** Builds the wire's path. With `clipRect`, only the part inside it (see addCubicInRect). */
  drawCurve(clipRect?: ClipRect) {
    const c = this.curve;
    if (!c) return;
    const ctx = this.ctx;
    ctx.beginPath();
    if (clipRect) {
      const pen = { x: NaN, y: NaN };
      addCubicInRect(ctx, c[0].x, c[0].y, c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y, clipRect, 0, pen);
      return;
    }
    ctx.moveTo(c[0].x, c[0].y);
    ctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
  }

  midpoint(a: IVector2, b: IVector2) {
    return { x: a.x * 0.5 + b.x * 0.5, y: a.y * 0.5 + b.y * 0.5 };
  }

  _bezierInterpolation(t, a, b, c, d) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      a +
      (-a * 3 + t * (3 * a - a * t)) * t +
      (3 * b + t * (-6 * b + b * 3 * t)) * t +
      (c * 3 - c * 3 * t) * t2 +
      d * t3
    );
  }

  pointOnCurve(t) {
    const c = this.curve;
    if (!c) return;
    return {
      x: this._bezierInterpolation(t, c[0].x, c[1].x, c[2].x, c[3].x),
      y: this._bezierInterpolation(t, c[0].y, c[1].y, c[2].y, c[3].y)
    };
  }

  _findClosestPointOnCurve(p, t0, t1) {
    const thres = 0.05;
    const _t0 = t0 + (t1 - t0) * 0.25;
    const p0 = this.pointOnCurve(_t0);
    const pd0 = (p0.x - p.x) * (p0.x - p.x) + (p0.y - p.y) * (p0.y - p.y);

    const _t1 = t0 + (t1 - t0) * 0.75;
    const p1 = this.pointOnCurve(_t1);
    const pd1 = (p1.x - p.x) * (p1.x - p.x) + (p1.y - p.y) * (p1.y - p.y);

    if (Math.abs(t0 - t1) < thres) return t0 * 0.5 + t1 * 0.5;

    if (pd0 < pd1) return this._findClosestPointOnCurve(p, t0, t0 + (t1 - t0) * 0.5);
    else return this._findClosestPointOnCurve(p, t0 + (t1 - t0) * 0.5, t1);
  }

  findClosestPointOnCurve(p) {
    return this._findClosestPointOnCurve(p, 0, 1);
  }

  getHealth() {
    if (!this.owner) {
      return {
        healthy: true,
        message: undefined
      };
    }

    // Safety check for undefined nodes — return silently.
    // This is a known transient state: orphaned connections get cleaned up
    // by cleanupOrphanedConnections. No console.warn here because getHealth
    // is called on every paint frame and would spam the console.
    if (!this.fromNode || !this.toNode) {
      return {
        healthy: false,
        errors: ['Connection references undefined nodes'],
        message: 'Connection has undefined source or target nodes'
      };
    }

    return this.owner.model.getConnectionHealth({
      sourceNode: this.fromNode.model,
      sourcePort: this.fromProperty,
      targetNode: this.toNode.model,
      targetPort: this.toProperty
    });
  }

  isHealthy() {
    return this.getHealth().healthy;
  }

  paint(ctx, paintRect) {
    this.ctx = ctx;

    if (!this.fromPlug || !this.toPlug) return;

    // Safety check for undefined nodes - try to resolve them if possible
    if (!this.fromNode || !this.toNode) {
      // Try to resolve missing nodes from the owner
      if (this.owner && this.model) {
        if (!this.fromNode && this.model.fromId) {
          this.fromNode = this.owner.findNodeWithId(this.model.fromId);
        }
        if (!this.toNode && this.model.toId) {
          this.toNode = this.owner.findNodeWithId(this.model.toId);
        }
      }

      // If still undefined, skip painting silently
      // (The editor's cleanupOrphanedConnections will remove these)
      if (!this.fromNode || !this.toNode) {
        return;
      }
    }

    // Additional safety check for global property
    if (!this.fromNode.global || !this.toNode.global) {
      console.warn('[NodeGraphEditorConnection] Cannot paint connection - nodes missing global property', {
        fromNode: !!this.fromNode,
        toNode: !!this.toNode,
        fromGlobal: !!(this.fromNode?.global),
        toGlobal: !!(this.toNode?.global)
      });
      return;
    }

    const from = this.fromNode.global;
    const to = this.toNode.global;

    // This is a connection between two plugs, figure out the placement
    // of the connection
    const fy =
      from.y +
      this.fromNode.titlebarHeight() +
      this.fromPlug.index * NodeGraphEditorNode.propertyConnectionHeight +
      NodeGraphEditorNode.propertyConnectionHeight / 2 +
      NodeGraphEditorNode.verticalSpacing;
    const ty =
      to.y +
      this.toNode.titlebarHeight() +
      this.toPlug.index * NodeGraphEditorNode.propertyConnectionHeight +
      NodeGraphEditorNode.propertyConnectionHeight / 2 +
      NodeGraphEditorNode.verticalSpacing;

    const loc = this.getLocationRelativeTo(this.fromNode);
    if (loc === 'left') {
      var mid = to.x * 0.5 + (from.x + NodeGraphEditorNode.size.width) * 0.5;

      this.curve = [
        { x: from.x + this.fromNode.nodeSize.width, y: fy },
        { x: mid, y: fy },
        { x: mid, y: ty },
        { x: to.x, y: ty }
      ];
    } else if (loc === 'right') {
      var mid = (to.x + NodeGraphEditorNode.size.width) * 0.5 + from.x * 0.5;

      this.curve = [
        { x: from.x, y: fy },
        { x: mid, y: fy },
        { x: mid, y: ty },
        { x: to.x + this.toNode.nodeSize.width, y: ty }
      ];
    } else {
      const dx = Math.min(from.x, to.x) - (50 + Math.abs(to.y - from.y) * 0.2);

      this.curve = [
        { x: from.x, y: fy },
        { x: dx, y: fy },
        { x: dx, y: ty },
        { x: to.x, y: ty }
      ];
    }

    function aabbIntersectTest(connection, paintArea) {
      const minX = Math.min(connection[0].x, connection[1].x, connection[2].x, connection[3].x);
      const maxX = Math.max(connection[0].x, connection[1].x, connection[2].x, connection[3].x);
      const minY = Math.min(connection[0].y, connection[1].y, connection[2].y, connection[3].y);
      const maxY = Math.max(connection[0].y, connection[1].y, connection[2].y, connection[3].y);

      return !(minX > paintArea.maxX || maxX < paintArea.minX || minY > paintArea.maxY || maxY < paintArea.minY);
    }

    if (aabbIntersectTest(this.curve, paintRect) === false) {
      return;
    }

    const dashed = !this.getHealth().healthy;
    if (dashed) {
      ctx.setLineDash([5]);
    }

    const hoverConnection = this.isHighlighted();
    const type = NodeLibrary.nameForPortType(this.fromPort ? this.fromPort.type : undefined);
    const connectionColors = NodeLibrary.instance.colorSchemeForConnectionType(type);

    const color = hoverConnection ? connectionColors.highlighted : connectionColors.normal;
    ctx.strokeStyle = this.color ? this.color : color;

    if (this.model.annotation) {
      if (this.model.annotation === 'Deleted') ctx.strokeStyle = '#F57569';
      else if (this.model.annotation === 'Changed') ctx.strokeStyle = '#83B8BA';
      else if (this.model.annotation === 'Created') ctx.strokeStyle = '#5BF59E';
    }

    const isHover = hoverConnection;
    const lineWidth = isHover ? 2 : 1.75;
    ctx.lineWidth = this.lineWidth ? this.lineWidth : lineWidth;

    // When highlighted/selected, switch to purple
    if (isHover && !this.color && !this.model.annotation) {
      ctx.strokeStyle = 'rgba(236, 91, 224, 0.9)';
    }

    // Trimmed to the view, padded so the stroke never ends visibly at the edge.
    // A dashed wire is drawn whole: its dash pattern starts where the path does,
    // so trimming would make the dashes crawl as the view moves.
    const pad = 20;
    this.drawCurve(
      dashed
        ? undefined
        : {
            minX: paintRect.minX - pad,
            maxX: paintRect.maxX + pad,
            minY: paintRect.minY - pad,
            maxY: paintRect.maxY + pad
          }
    );
    ctx.stroke();

    // ═══════════════════════════════════════════════
    // DIRECTION ARROWHEAD — Small triangle at target end
    // ═══════════════════════════════════════════════
    if (this.curve) {
      const c = this.curve;
      const tip = c[3]; // target endpoint
      const prev = c[2]; // control point before target

      // Direction vector from control point to target
      const dx = tip.x - prev.x;
      const dy = tip.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        const ux = dx / len; // unit direction
        const uy = dy / len;
        const nx = uy;     // normal (perpendicular)
        const ny = -ux;
        const size = 4;

        ctx.fillStyle = ctx.strokeStyle; // match line color
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - ux * size * 2 - nx * size, tip.y - uy * size * 2 - ny * size);
        ctx.lineTo(tip.x - ux * size * 2 + nx * size, tip.y - uy * size * 2 + ny * size);
        ctx.closePath();
        ctx.fill();
      }
    }

    // ═══════════════════════════════════════════════
    // DATA FLOW PARTICLES — Glowing orbs along curve
    // ═══════════════════════════════════════════════
    if (DebugInspector.instance.isEnabled() && DebugInspector.instance.isConnectionPulsing(this)) {
      const t = DebugInspector.instance.getPulseAnimationState(this);
      const pulsingColor = connectionColors.pulsing ? connectionColors.pulsing : '#ffffff';

      // Draw pulsing line underneath
      ctx.save();
      ctx.strokeStyle = pulsingColor;
      ctx.lineWidth = 1;
      ctx.globalAlpha = t.opacity * 0.3;
      ctx.setLineDash([5, 15]);
      ctx.lineDashOffset = -t.offset;
      this.drawCurve();
      ctx.stroke();
      ctx.restore();

      // Travelling orbs
      const now = performance.now();
      const speed = 1500; // ms per full traversal
      const orbCount = 3;

      for (let i = 0; i < orbCount; i++) {
        const phase = ((now / speed) + (i / orbCount)) % 1;
        const pt = this.pointOnCurve(phase);
        if (!pt) continue;

        // Outer glow
        ctx.save();
        ctx.fillStyle = pulsingColor;
        ctx.globalAlpha = 0.15;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, 2 * Math.PI);
        ctx.fill();

        // Mid glow
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
        ctx.fill();

        // Core dot
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, 2 * Math.PI);
        ctx.fill();
        ctx.restore();
      }

      ctx.globalAlpha = 1;
    }

    ctx.lineDashOffset = 0;
    ctx.setLineDash([]); // Restore line dash if it has been previously set

    // Show the delete marker
    if (this.owner && this.owner.deleteModeConnection === this) {
      const a = this.midpoint(this.curve[0], this.curve[1]),
        b = this.midpoint(this.curve[1], this.curve[2]),
        c = this.midpoint(this.curve[2], this.curve[3]);

      const mp = this.midpoint(this.midpoint(a, b), this.midpoint(b, c));
      ctx.fillStyle = NodeGraphColors.red;
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, 6, 0, 2 * Math.PI, false);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = NodeGraphColors.base2;
      ctx.beginPath();
      const l = 2.5;
      ctx.moveTo(mp.x - l, mp.y - l);
      ctx.lineTo(mp.x + l, mp.y + l);
      ctx.moveTo(mp.x + l, mp.y - l);
      ctx.lineTo(mp.x - l, mp.y + l);
      ctx.stroke();
    }
  }
}
