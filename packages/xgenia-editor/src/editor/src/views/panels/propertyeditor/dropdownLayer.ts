/**
 * Property-editor dropdowns, lifted out of the inspector's clipping boxes.
 *
 * Every enum and unit dropdown is absolutely positioned inside the field it belongs
 * to, which was fine while the property editor was one flat list. It is not any more:
 * each group body carries `overflow: hidden` (the 0fr -> 1fr collapse animation needs
 * it to clip) and the panel itself scrolls, so a dropdown opened on one of the last
 * rows of a group was cut off at the group's edge -- the options past the cut could
 * not be reached, and the sliver that survived painted on top of the row below it.
 *
 * So while a dropdown is open it lives in a fixed-position layer on <body>, anchored
 * to its field, flipped above the field when there is no room under it, and capped to
 * a height that fits on screen. Closing puts the element back exactly where it came
 * from: the editors keep their own markup, children and `data-click` bindings, and
 * only the element's parent changes, only for as long as it is open.
 *
 * One dropdown is open at a time, which is also how "opening this one closes that one"
 * is enforced now -- the old `parent.$('.property-input-dropdown').hide()` sweep cannot
 * see an element that has been moved out of the panel.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  direction: 'down' | 'up';
}

export interface PlacementOptions {
  /** Height the list would take with every option laid out, unclamped. */
  contentHeight: number;
  /** Kept clear of the viewport edges. */
  margin?: number;
  /** Never open shorter than this -- overlap the field instead of showing a sliver. */
  minHeight?: number;
  /** A long enum list scrolls rather than running the full height of the screen. */
  maxHeight?: number;
}

const EDGE_MARGIN = 8;
const MIN_HEIGHT = 64;
const MAX_HEIGHT = 320;

/**
 * Where the list goes for a field at `anchor`. Pure, so the flip and clamp rules can
 * be tested without a DOM; `position()` below is the only caller that measures.
 */
export function computePlacement(anchor: Rect, viewport: Viewport, options: PlacementOptions): Placement {
  const margin = options.margin === undefined ? EDGE_MARGIN : options.margin;
  const minHeight = options.minHeight === undefined ? MIN_HEIGHT : options.minHeight;
  const ceiling = options.maxHeight === undefined ? MAX_HEIGHT : options.maxHeight;
  // A measurement of zero means the browser had nothing laid out to measure. Capping
  // to it would set `max-height: 0` and hide the list completely, so fall back to the
  // full allowance and let it size itself.
  const wanted = options.contentHeight > 0 ? Math.min(options.contentHeight, ceiling) : ceiling;

  const roomBelow = Math.max(0, viewport.height - (anchor.top + anchor.height) - margin);
  const roomAbove = Math.max(0, anchor.top - margin);

  // Below is the resting place. Flip only when the list genuinely does not fit there
  // and the other side is roomier -- flipping to gain a few pixels reads as a glitch.
  const direction: 'down' | 'up' = wanted > roomBelow && roomAbove > roomBelow ? 'up' : 'down';

  const room = direction === 'down' ? roomBelow : roomAbove;
  const maxHeight = Math.max(Math.min(wanted, room), Math.min(wanted, minHeight));

  let top = direction === 'down' ? anchor.top + anchor.height : anchor.top - maxHeight;
  // Only bites when neither side could hold `minHeight`, i.e. a very short window.
  // Overlapping the field beats hanging off the edge where options cannot be clicked.
  top = Math.max(margin, Math.min(top, viewport.height - margin - maxHeight));

  const width = anchor.width;
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - margin - width));

  return { left, top, width, maxHeight, direction };
}

interface OpenDropdown {
  element: HTMLElement;
  /** The field the list belongs to -- also the element it is positioned against. */
  anchor: HTMLElement;
  /** Marks the spot in the row's markup that the element goes back to. */
  placeholder: Comment;
  /** The element's own `style` attribute, restored verbatim on close. */
  style: string | null;
}

let current: OpenDropdown | null = null;
let layer: HTMLElement | null = null;

function getLayer(): HTMLElement {
  if (layer === null || !layer.isConnected) {
    layer = document.createElement('div');
    layer.className = 'property-dropdown-layer';
    // Set inline as well as in the stylesheet. These four are what make the layer a
    // layer at all -- in particular the z-index, which has to clear the property
    // panel's own `z-index: 10` or the list opens behind the panel and is invisible.
    // Not worth leaving to whether a stylesheet made it into the bundle.
    layer.style.position = 'fixed';
    layer.style.inset = '0';
    layer.style.zIndex = '30';
    layer.style.pointerEvents = 'none';
    document.body.appendChild(layer);
  }
  return layer;
}

/** With no argument: is any dropdown open. With one: is that one the open one. */
export function isDropdownOpen(element?: HTMLElement | null): boolean {
  if (current === null) return false;
  return element === undefined || element === null ? true : current.element === element;
}

export function openDropdown(element: HTMLElement | null | undefined): void {
  if (!element || !element.parentElement || isDropdownOpen(element)) return;
  closeDropdown();

  const anchor = element.parentElement;
  const placeholder = document.createComment('property-input-dropdown');
  anchor.insertBefore(placeholder, element);

  current = { element, anchor, placeholder, style: element.getAttribute('style') };

  getLayer().appendChild(element);
  element.style.display = 'block';
  // The layer itself is click-through; the list inside it must not be.
  element.style.pointerEvents = 'auto';
  // Not `closeWhenOffScreen`: the click that opened it is proof enough that the field
  // is on screen, and a clip box that measures as nothing must not swallow the list
  // before it has been seen.
  position(false);

  document.addEventListener('mousedown', onDocumentMouseDown, true);
  document.addEventListener('keydown', onDocumentKeyDown, true);
  document.addEventListener('scroll', onViewportChanged, true);
  window.addEventListener('resize', onViewportChanged);
}

/** With no argument: closes whatever is open. With one: closes it only if it is open. */
export function closeDropdown(element?: HTMLElement | null): void {
  if (current === null) return;
  if (element !== undefined && element !== null && current.element !== element) return;

  const { element: el, placeholder, style } = current;
  current = null;

  document.removeEventListener('mousedown', onDocumentMouseDown, true);
  document.removeEventListener('keydown', onDocumentKeyDown, true);
  document.removeEventListener('scroll', onViewportChanged, true);
  window.removeEventListener('resize', onViewportChanged);

  if (style === null) el.removeAttribute('style');
  else el.setAttribute('style', style);
  el.style.display = 'none';

  if (placeholder.parentNode !== null) placeholder.parentNode.replaceChild(el, placeholder);
  // The row was torn out from under the open list: drop the element with it.
  else if (el.parentNode !== null) el.parentNode.removeChild(el);
}

export function toggleDropdown(element: HTMLElement | null | undefined): void {
  if (isDropdownOpen(element)) closeDropdown(element);
  else openDropdown(element);
}

/**
 * Closes the open dropdown if its row lives under `root`. Called when the inspector
 * unmounts a row, so a rebuild (a different node selected, ports changed) cannot leave
 * a list floating in the layer with nothing behind it.
 */
export function closeDropdownIfInside(root: Node | null | undefined): void {
  if (current === null || !root) return;
  if (root.contains(current.placeholder) || root.contains(current.anchor)) closeDropdown();
}

function position(closeWhenOffScreen: boolean): void {
  if (current === null) return;
  const { element, anchor, placeholder } = current;

  if (!placeholder.isConnected || !anchor.isConnected) {
    closeDropdown();
    return;
  }

  const rect = anchor.getBoundingClientRect();
  if (closeWhenOffScreen && !isVisibleInScrollParents(anchor, rect)) {
    closeDropdown();
    return;
  }

  // Measure at the width it will actually render at, or a wrapping option would be
  // mismeasured: in the layer the untouched `width:100%` resolves to the whole viewport.
  element.style.position = 'fixed';
  element.style.left = rect.left + 'px';
  element.style.top = rect.top + rect.height + 'px';
  element.style.width = rect.width + 'px';
  element.style.maxHeight = 'none';

  const placement = computePlacement(
    { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    { width: window.innerWidth, height: window.innerHeight },
    { contentHeight: element.scrollHeight }
  );

  element.style.left = placement.left + 'px';
  element.style.top = placement.top + 'px';
  element.style.width = placement.width + 'px';
  element.style.maxHeight = placement.maxHeight + 'px';
}

/**
 * Whether the field is still on screen inside every scroll box it sits in. Scrolling
 * the panel far enough would otherwise leave the list anchored to a row that has gone
 * under the sticky group header.
 */
function isVisibleInScrollParents(anchor: HTMLElement, rect: DOMRect): boolean {
  let node = anchor.parentElement;
  while (node !== null && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
      const clip = node.getBoundingClientRect();
      // Nothing measurable to test against (a `display: contents` wrapper, say).
      // Unmeasurable is not the same as off screen -- do not close on it.
      if (clip.width === 0 && clip.height === 0) {
        node = node.parentElement;
        continue;
      }
      const intersects =
        rect.bottom > clip.top && rect.top < clip.bottom && rect.right > clip.left && rect.left < clip.right;
      if (!intersects) return false;
    }
    node = node.parentElement;
  }
  return true;
}

function onDocumentMouseDown(event: MouseEvent): void {
  if (current === null) return;
  const target = event.target as Node | null;
  if (target === null) return;
  // Inside the list: the option's own handler closes it. On the field: the view's
  // toggle closes it, and closing here first would make that click re-open it.
  if (current.element.contains(target) || current.anchor.contains(target)) return;
  closeDropdown();
}

function onDocumentKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeDropdown();
}

function onViewportChanged(event: Event): void {
  if (current === null) return;
  const target = event.target as Node | null;
  // The list scrolling inside itself is not the panel moving underneath it.
  if (event.type === 'scroll' && target !== null && current.element.contains(target)) return;
  position(true);
}
