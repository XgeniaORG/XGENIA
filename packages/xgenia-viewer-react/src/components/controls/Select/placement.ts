// Where the Dropdown's option list goes. The list is drawn in a fixed layer on <body> so no
// parent's Clip Content or stacking order can hide it, which means it no longer lives in the
// field's coordinate space: the preview zooms the document (`zoom` on <html>) and games scale
// their stage with transforms, so a viewport rect cannot be used as CSS pixels directly. The
// caller measures how many viewport pixels one CSS pixel is at the field and in the layer, and
// this turns the field's rect into a layer position plus the scale that makes the list match.
//
// The native <select> popup this replaces worked out its own position and got it wrong under
// that zoom: it opened hundreds of pixels away from the field in the preview.

export interface DropdownPlacementInput {
  /** The field's border box in viewport pixels (getBoundingClientRect). */
  field: { left: number; top: number; right: number; bottom: number };
  /** Viewport pixels per CSS pixel at the field: every zoom and scale above it. */
  fieldScale: number;
  /** Viewport pixels per CSS pixel in the layer the list is drawn in. */
  layerScale: number;
  /** Where the layer's origin is, in viewport pixels. */
  layerLeft: number;
  layerTop: number;
  viewportHeight: number;
  /** The list's uncapped height, border included, in the field's CSS pixels. */
  contentHeight: number;
  /** The list's height cap, in the field's CSS pixels. */
  maxHeight: number;
  /** Gap between the field and the list, in the field's CSS pixels. */
  offset: number;
}

export interface DropdownPlacement {
  /** In layer CSS pixels. */
  left: number;
  top: number;
  /** In the field's CSS pixels: the list is laid out at the field's size, then scaled. */
  width: number;
  maxHeight: number;
  /** Scale (origin top left) that takes the list from the layer's size to the field's. */
  scale: number;
  above: boolean;
}

/** Viewport pixels kept clear between the list and the window edge. */
const EDGE = 8;
/** Never squeeze the list below this (field CSS pixels), even when neither side has room. */
const MIN_HEIGHT = 80;

export function placeDropdown(input: DropdownPlacementInput): DropdownPlacement {
  const fieldScale = input.fieldScale > 0 ? input.fieldScale : 1;
  const layerScale = input.layerScale > 0 ? input.layerScale : 1;
  const { field } = input;

  const gap = input.offset * fieldScale;
  const spaceBelow = input.viewportHeight - field.bottom - gap - EDGE;
  const spaceAbove = field.top - gap - EDGE;
  const wanted = Math.min(input.contentHeight, input.maxHeight) * fieldScale;
  // Open upwards only when the list does not fit below and there is more room above.
  const above = wanted > spaceBelow && spaceAbove > spaceBelow;

  const room = Math.max(above ? spaceAbove : spaceBelow, 0) / fieldScale;
  const maxHeight = Math.min(input.maxHeight, Math.max(room, Math.min(MIN_HEIGHT, input.contentHeight)));
  const height = Math.min(input.contentHeight, maxHeight) * fieldScale;
  const top = above ? field.top - gap - height : field.bottom + gap;

  return {
    left: (field.left - input.layerLeft) / layerScale,
    top: (top - input.layerTop) / layerScale,
    width: (field.right - field.left) / fieldScale,
    maxHeight,
    scale: fieldScale / layerScale,
    above
  };
}

export function samePlacement(a: DropdownPlacement, b: DropdownPlacement) {
  const close = (x: number, y: number) => Math.abs(x - y) < 0.25;
  return (
    a.above === b.above &&
    close(a.left, b.left) &&
    close(a.top, b.top) &&
    close(a.width, b.width) &&
    close(a.maxHeight, b.maxHeight) &&
    Math.abs(a.scale - b.scale) < 0.0005
  );
}
