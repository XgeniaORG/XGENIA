/**
 * TransformCommandResolver — pure translation of viewport gestures into
 * node parameter writes. No model imports, no side effects; the applier in
 * editorapi.js owns undo grouping and actually touching the node.
 *
 * Hard rules (see 2026-08-27 design spec):
 *  - a value read in a unit is written back in that unit ('10%' stays %)
 *  - anything this module cannot translate safely is blocked, never guessed
 */

// XGENIA dimension params may be '15px', '10%', bare numbers, or {value, unit}.
function parseUnitValue(v, defaultUnit) {
  if (v === undefined || v === null) return { value: 0, unit: defaultUnit };
  if (typeof v === 'number') return { value: v, unit: '' };
  if (typeof v === 'object' && typeof v.value === 'number') {
    return { value: v.value, unit: v.unit !== undefined ? v.unit : defaultUnit };
  }
  const m = String(v).trim().match(/^(-?[\d.]+)\s*(px|%)?$/);
  if (!m) return { value: 0, unit: defaultUnit };
  return { value: parseFloat(m[1]), unit: m[2] || '' };
}

function formatUnitValue(value, unit) {
  const rounded = Math.round(value * 100) / 100;
  return unit === '' ? rounded : `${rounded}${unit}`;
}

// Convert a screen-px delta into the unit of an existing param value.
function deltaInUnit(deltaPx, unit, parentSpan) {
  if (unit === '%') {
    if (!parentSpan) return null; // can't compute % without a parent box
    return (deltaPx / parentSpan) * 100;
  }
  return deltaPx; // px and bare both move 1:1 with screen px at zoom 1
}

function blockedResult(reason) {
  return { writes: [], blocked: reason };
}

function resolveGesture(target, nodeSnapshot) {
  const params = (nodeSnapshot && nodeSnapshot.parameters) || {};
  if (nodeSnapshot && nodeSnapshot.ancestorTransformed) {
    return blockedResult('transformed-ancestor');
  }

  if (target.kind === 'pixi') return resolvePixi(target, params);
  if (target.kind === 'dom') return resolveDom(target, params);
  return blockedResult('unknown-kind');
}

function resolvePixi(target, params) {
  const writes = [];
  switch (target.gesture) {
    case 'move':
      writes.push({ param: 'x', value: target.x });
      writes.push({ param: 'y', value: target.y });
      return { writes };
    case 'resize': {
      const { value: rot } = parseUnitValue(params.rotation, '');
      if (rot !== 0) return blockedResult('rotated-target');
      writes.push({ param: 'x', value: target.x });
      writes.push({ param: 'y', value: target.y });
      writes.push({ param: 'width', value: target.width });
      writes.push({ param: 'height', value: target.height });
      return { writes };
    }
    case 'rotate':
      writes.push({ param: 'rotation', value: target.rotation });
      return { writes };
    default:
      return blockedResult('unknown-gesture');
  }
}

function resolveDom(target, params) {
  const parentRect = target.parentRect || {};
  switch (target.gesture) {
    case 'move': {
      // In-flow nodes are layout-managed; direct move means reorder, which is P2.
      if (params.position !== 'absolute') return blockedResult('in-flow');
      const ml = parseUnitValue(params.marginLeft, 'px');
      const mt = parseUnitValue(params.marginTop, 'px');
      const dxu = deltaInUnit(target.deltaX, ml.unit, parentRect.width);
      const dyu = deltaInUnit(target.deltaY, mt.unit, parentRect.height);
      if (dxu === null || dyu === null) return blockedResult('no-parent-box');
      return {
        writes: [
          { param: 'marginLeft', value: formatUnitValue(ml.value + dxu, ml.unit || 'px') },
          { param: 'marginTop', value: formatUnitValue(mt.value + dyu, mt.unit || 'px') }
        ]
      };
    }
    case 'resize': {
      const { value: rot } = parseUnitValue(params.transformRotation, '');
      if (rot !== 0) return blockedResult('rotated-target');
      const w = parseUnitValue(params.width, 'px');
      const h = parseUnitValue(params.height, 'px');
      const result = { writes: [] };
      // Dimensions only apply when sizeMode allows them (gated-port lesson):
      // flag it so the applier sets sizeMode inside the same undo group.
      if (params.sizeMode !== undefined && params.sizeMode !== 'explicit') {
        result.needsExplicitSizeMode = true;
      }
      if (w.unit === '%') {
        if (!parentRect.width) return blockedResult('no-parent-box');
        result.writes.push({
          param: 'width',
          value: formatUnitValue((target.width / parentRect.width) * 100, '%')
        });
      } else {
        result.writes.push({ param: 'width', value: formatUnitValue(target.width, w.unit || 'px') });
      }
      if (h.unit === '%') {
        if (!parentRect.height) return blockedResult('no-parent-box');
        result.writes.push({
          param: 'height',
          value: formatUnitValue((target.height / parentRect.height) * 100, '%')
        });
      } else {
        result.writes.push({ param: 'height', value: formatUnitValue(target.height, h.unit || 'px') });
      }
      return result;
    }
    case 'rotate': {
      // Rotation is a pure visual transform — legal for in-flow nodes too.
      const { value: cur } = parseUnitValue(params.transformRotation, '');
      let angle = cur + target.deltaDeg;
      // Normalize into (-180, 180] so params stay readable after many turns.
      angle = ((angle + 180) % 360 + 360) % 360 - 180;
      if (angle === -180) angle = 180;
      return {
        writes: [{ param: 'transformRotation', value: Math.round(angle * 10) / 10 }]
      };
    }
    default:
      return blockedResult('unknown-gesture');
  }
}

/**
 * What can this node do in the viewport right now? Drives which gizmo
 * affordances (arrows, handles, lollipop) are even shown — a professional
 * gizmo never offers a gesture the resolver would refuse.
 */
function getCapabilities(kind, params, ancestorTransformed) {
  params = params || {};
  if (ancestorTransformed) {
    return {
      movable: false, moveReason: 'transformed-ancestor',
      resizable: false, resizeReason: 'transformed-ancestor',
      rotatable: false, rotateReason: 'transformed-ancestor'
    };
  }
  const caps = { movable: true, resizable: true, rotatable: true };
  if (kind === 'dom') {
    if (params.position !== 'absolute') {
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

module.exports = { resolveGesture, parseUnitValue, getCapabilities };
