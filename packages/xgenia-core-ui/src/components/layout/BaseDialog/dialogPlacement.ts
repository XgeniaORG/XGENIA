// dialogPlacement.ts — pure. No DOM, no React: rectangles in, a placement out.
//
// Split out of BaseDialog because the old inline version could put a dialog where nobody
// could reach it. It sized itself to its content and then flipped to whichever side of the
// trigger it did not fit on either, so a long list — a property panel select with more
// options than the space below it — was positioned at a negative Y with its first rows off
// the top of the screen. Nothing scrolled it back: the dialog layer is `position: fixed`
// with no overflow, so those rows were not scrolled out of view, they were simply gone.
//
// Two rules fix that for every dialog at once: a placement is always clamped inside the
// viewport, and it reports the height it is allowed to occupy so the dialog can scroll its
// own content instead of escaping the screen.

export type PlacementDirection = 'above' | 'below' | 'horizontal';

export interface PlacementRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PlacementInput {
  trigger: PlacementRect;
  /** The dialog's natural size, measured with no cap applied. */
  dialog: { width: number; height: number };
  viewport: { width: number; height: number };
  direction: PlacementDirection;
  /** Space left between trigger and dialog — room for the arrow, where there is one. */
  gap: number;
  /** Space kept between the dialog and the edge of the window. */
  edge: number;
}

export interface Placement {
  x: number;
  y: number;
  arrowX: number;
  arrowY: number;
  animationStartOffsetX: number;
  animationStartOffsetY: number;
  /**
   * The height the dialog may occupy, or null when its natural height already fits.
   *
   * Null rather than the natural height on purpose: applying a max-height equal to the
   * content's own height invites a sub-pixel rounding difference to produce a scrollbar on
   * a dialog that fits perfectly well.
   */
  maxHeight: number | null;
}

/** Clamps into [lo, hi], preferring lo when the range is inverted — a dialog wider or
 *  taller than the window pins to the top-left edge rather than jumping past it. */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  if (hi < lo) return lo;
  return Math.min(hi, Math.max(lo, value));
}

export function placeDialog(input: PlacementInput): Placement {
  const { trigger, dialog, viewport, direction, gap, edge } = input;

  if (direction === 'horizontal') return placeBeside(input);

  const spaceAbove = trigger.top - gap - edge;
  const spaceBelow = viewport.height - trigger.bottom - gap - edge;

  // Honour the requested side, and only overrule it when the dialog does not fit there
  // AND the other side is roomier. Previously this test subtracted the dialog's height a
  // second time from a Y that already had it subtracted, so "above" gave way to "below"
  // whenever there was less than TWICE the dialog's height overhead.
  let isAbove = direction === 'above';
  if (isAbove && dialog.height > spaceAbove && spaceBelow > spaceAbove) isAbove = false;
  else if (!isAbove && dialog.height > spaceBelow && spaceAbove > spaceBelow) isAbove = true;

  const room = Math.max(0, isAbove ? spaceAbove : spaceBelow);
  const height = Math.min(dialog.height, room);
  const maxHeight = height < dialog.height ? height : null;

  const x = centreOnTrigger(trigger, dialog, viewport, edge);
  const unclampedY = isAbove ? trigger.top - gap - height : trigger.bottom + gap;
  const y = clamp(unclampedY, edge, viewport.height - height - edge);

  return {
    x,
    y,
    arrowX: arrowAcross(trigger, dialog, x),
    // The arrow hangs off whichever edge of the dialog faces the trigger.
    arrowY: isAbove ? height : 0,
    animationStartOffsetX: 0,
    animationStartOffsetY: isAbove ? -10 : 10,
    maxHeight
  };
}

function placeBeside({ trigger, dialog, viewport, gap, edge }: PlacementInput): Placement {
  let x = trigger.right + gap;
  let isRight = true;
  if (x + dialog.width > viewport.width - edge) {
    x = trigger.left - dialog.width - gap;
    isRight = false;
  }
  x = clamp(x, edge, viewport.width - dialog.width - edge);

  // Beside the trigger there is no second side to fall back to, so the cap is simply the
  // window: a tall dialog scrolls rather than running off the top and bottom at once.
  const room = Math.max(0, viewport.height - edge * 2);
  const height = Math.min(dialog.height, room);
  const maxHeight = height < dialog.height ? height : null;

  const centreY = trigger.top + trigger.height / 2;
  const y = clamp(centreY - height / 2, edge, viewport.height - height - edge);

  return {
    x,
    y,
    arrowX: isRight ? 0 : dialog.width,
    arrowY: clamp(centreY - y, 0, height),
    animationStartOffsetX: isRight ? 10 : -10,
    animationStartOffsetY: 0,
    maxHeight
  };
}

function centreOnTrigger(
  trigger: PlacementRect,
  dialog: { width: number },
  viewport: { width: number },
  edge: number
): number {
  const centred = trigger.left + trigger.width / 2 - dialog.width / 2;
  return clamp(centred, edge, viewport.width - dialog.width - edge);
}

/** Keeps the arrow pointing at the trigger once the dialog has been pushed off centre,
 *  and inside the dialog's own width once the trigger is further off than that. */
function arrowAcross(trigger: PlacementRect, dialog: { width: number }, x: number): number {
  return clamp(trigger.left + trigger.width / 2 - x, 0, dialog.width);
}
