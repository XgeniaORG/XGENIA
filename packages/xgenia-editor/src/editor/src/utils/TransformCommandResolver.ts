/**
 * TransformCommandResolver — adapts viewport gestures onto the ONE layout
 * authority, resolveLayoutIntent (layout-intent-resolver.ts). That module is
 * where "move this node" is answered for every caller — AI tools and gizmo
 * alike — and a tripwire test (gizmo-cannot-wake-up-guessing.test.ts) exists
 * precisely so the gizmo cannot grow a second, disagreeing answer. This file
 * adds only what a HUMAN drag needs on top:
 *
 *  - rotation (the authority has no rotate intent)
 *  - %-unit preservation using the parent box the preload measured (the
 *    authority deliberately owns no parent box and refuses % instead)
 *  - canonical {value, unit, isFixed} objects for the property panel (string
 *    writes render but desync the panel — the "800PX but % was the type" family)
 *  - sizeMode auto-flip: a human dragging a resize handle IS the explicit
 *    consent the authority's SIZE_MODE_GATED remedy asks a caller to give
 */

import { resolveLayoutIntent } from '../../../../../../private/xgenia-ai/src/ChatPanel/StreamlinedToolRegistry/utils/layout-intent-resolver';

// XGENIA dimension params may be '15px', '10%', bare numbers, or {value, unit}.
function parseUnitValue(v: any, defaultUnit: any) {
  if (v === undefined || v === null) return { value: 0, unit: defaultUnit };
  if (typeof v === 'number') return { value: v, unit: '' };
  if (typeof v === 'object' && typeof v.value === 'number') {
    return { value: v.value, unit: v.unit !== undefined ? v.unit : defaultUnit };
  }
  const m = String(v).trim().match(/^(-?[\d.]+)\s*(px|%)?$/);
  if (!m) return { value: 0, unit: defaultUnit };
  return { value: parseFloat(m[1]), unit: m[2] || '' };
}

/** Canonical dimension write for the property panel (see Dimension.ts). */
function dimensionParam(value: any, unit: any, source: any) {
  return {
    value: Math.round(value * 100) / 100,
    unit: unit || 'px',
    isFixed: !!(source && typeof source === 'object' && source.isFixed)
  };
}

/** In-flow positions, mirroring the authority's IN_FLOW_POSITIONS. */
const IN_FLOW = new Set(['relative', 'static', 'sticky']);

function isPixi(target: any) {
  return target.kind === 'pixi';
}

/** Map authority rejection codes onto the preload's badge vocabulary. */
const REJECTION_TO_BLOCKED = {
  IN_LAYOUT: 'in-flow',
  UNIT_MISMATCH: 'unit-mismatch',
  SIZE_MODE_GATED: 'size-mode-gated'
};

/**
 * The authority's SIZE_MODE_GATED remedy names the one mode that frees the
 * dragged axis without costing the other ('explicit' vs a content mode). A
 * human resize gesture is the explicit consent the remedy asks for, so the
 * gizmo applies that named mode in the same undo group rather than refusing.
 */
function suggestedSizeMode(rejection: any) {
  const m = /sizeMode:"([A-Za-z]+)"/.exec(rejection.remedy || '');
  return m ? m[1] : 'explicit';
}

/** Convert the authority's CSS-string/number writes into panel-canonical writes. */
function canonicalWrites(resolution: any, params: any, target: any) {
  const writes: any[] = [];
  for (const param of Object.keys(resolution.writes)) {
    const raw = resolution.writes[param];
    if (typeof raw === 'number') {
      // pixi ports are plain numbers — the half that was always correct.
      writes.push({ param, value: raw });
      continue;
    }
    const parsed = parseUnitValue(raw, 'px');
    // Preserve the author's % choice using the parent box the preload
    // measured: the committed value keeps the on-screen result of the drag.
    const existing = parseUnitValue(params[param], 'px');
    if (existing.unit === '%' && target.parentRect) {
      const span = (param === 'height' || param === 'transformY' || param === 'marginTop')
        ? target.parentRect.height : target.parentRect.width;
      if (span) {
        const finalPx = param === 'width' ? target.width
          : param === 'height' ? target.height
          : parsed.value;
        writes.push({ param, value: dimensionParam((finalPx / span) * 100, '%', params[param]) });
        continue;
      }
    }
    writes.push({ param, value: dimensionParam(parsed.value, parsed.unit || 'px', params[param]) });
  }
  return writes;
}

function toLayoutNode(target: any, nodeSnapshot: any) {
  return {
    id: target.nodeId,
    type: nodeSnapshot.typename || (isPixi(target) ? 'pixi.Sprite' : 'Group'),
    parameters: nodeSnapshot.parameters || {},
    defaultSizeMode: nodeSnapshot.defaultSizeMode,
    parentLayout: nodeSnapshot.parentLayout
  };
}

function resolveGesture(target: any, nodeSnapshot: any) {
  const params = (nodeSnapshot && nodeSnapshot.parameters) || {};
  if (nodeSnapshot && nodeSnapshot.ancestorTransformed) {
    return { writes: [], blocked: 'transformed-ancestor' };
  }

  const layoutNode = toLayoutNode(target, nodeSnapshot || {});

  switch (target.gesture) {
    case 'move': {
      const intent = isPixi(target)
        // pixi gizmo reports final coordinates; express them as a delta so
        // one authority code path serves both halves.
        ? { kind: 'place', x: target.x, y: target.y }
        : { kind: 'move', dx: target.deltaX, dy: target.deltaY };
      const res = resolveLayoutIntent(layoutNode, intent);
      if (res.rejections.length && Object.keys(res.writes).length === 0) {
        return { writes: [], blocked: REJECTION_TO_BLOCKED[res.rejections[0].code] || 'rejected', rejections: res.rejections };
      }
      return { writes: canonicalWrites(res, params, target), rejections: res.rejections };
    }

    case 'resize': {
      const rotated = parseUnitValue(isPixi(target) ? params.rotation : params.transformRotation, '').value;
      if (rotated !== 0) return { writes: [], blocked: 'rotated-target' };

      const intent = { kind: 'resize', width: target.width, height: target.height };
      if (isPixi(target)) {
        const res = resolveLayoutIntent(layoutNode, intent);
        const writes: any[] = [];
        // The pixi bridge resizes from any corner: x/y move with the box.
        if (target.x !== undefined) writes.push({ param: 'x', value: target.x });
        if (target.y !== undefined) writes.push({ param: 'y', value: target.y });
        writes.push(...canonicalWrites(res, params, target));
        return { writes, rejections: res.rejections };
      }

      let res = resolveLayoutIntent(layoutNode, intent);
      const gated = res.rejections.filter((r) => r.code === 'SIZE_MODE_GATED');
      let sizeModeWrite: any = null;
      if (gated.length) {
        const mode = suggestedSizeMode(gated[0]);
        sizeModeWrite = { param: 'sizeMode', value: mode };
        res = resolveLayoutIntent(
          { ...layoutNode, parameters: { ...params, sizeMode: mode } },
          intent
        );
      }
      const writes = canonicalWrites(res, params, target);
      if (sizeModeWrite && writes.length) writes.unshift(sizeModeWrite);
      if (!writes.length && res.rejections.length) {
        return { writes: [], blocked: REJECTION_TO_BLOCKED[res.rejections[0].code] || 'rejected', rejections: res.rejections };
      }
      return { writes, rejections: res.rejections };
    }

    case 'rotate': {
      if (isPixi(target)) {
        return { writes: [{ param: 'rotation', value: target.rotation }] };
      }
      // Rotation is a pure visual transform — legal for in-flow nodes too.
      const { value: cur } = parseUnitValue(params.transformRotation, '');
      let angle = cur + target.deltaDeg;
      angle = ((angle + 180) % 360 + 360) % 360 - 180;
      if (angle === -180) angle = 180;
      // Explicit 'deg': the viewer joins bare numbers with a 'px' fallback,
      // and rotate(45px) is invalid CSS that drops silently.
      return {
        writes: [{ param: 'transformRotation', value: { value: Math.round(angle * 10) / 10, unit: 'deg' } }]
      };
    }

    default:
      return { writes: [], blocked: 'unknown-gesture' };
  }
}

/**
 * What can this node do in the viewport right now? Drives which gizmo
 * affordances (arrows, handles, lollipop) are even shown.
 *
 * parentLayout outranks the child's own position: every child of a
 * flexDirection:"none" Group is absolutely positioned by the engine no matter
 * what its own param says (layout.js writes position:absolute over it) — the
 * free-placement mode must never be the one mode the gizmo refuses.
 */
function getCapabilities(kind: any, params: any, ancestorTransformed: any, parentLayout?: any) {
  params = params || {};
  if (ancestorTransformed) {
    return {
      movable: false, moveReason: 'transformed-ancestor',
      resizable: false, resizeReason: 'transformed-ancestor',
      rotatable: false, rotateReason: 'transformed-ancestor'
    };
  }
  const caps: any = { movable: true, resizable: true, rotatable: true };
  if (kind === 'dom') {
    const position = String(params.position || 'relative').toLowerCase();
    if (parentLayout !== 'none' && IN_FLOW.has(position)) {
      caps.movable = false;
      caps.moveReason = 'in-flow';
    }
    const { value: rot } = parseUnitValue(params.transformRotation, '');
    if (rot !== 0) {
      caps.resizable = false;
      caps.resizeReason = 'rotated-target';
    }
  } else if (kind === 'pixi') {
    const { value: rot } = parseUnitValue(params.rotation, '');
    if (rot !== 0) {
      caps.resizable = false;
      caps.resizeReason = 'rotated-target';
    }
  }
  return caps;
}

export { resolveGesture, parseUnitValue, getCapabilities };
