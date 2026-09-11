import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Safe as a static import: the module only reaches for `document`/`window` from
// inside its functions, never while it is loading.
import {
  closeDropdown,
  closeDropdownIfInside,
  isDropdownOpen,
  openDropdown,
  toggleDropdown
} from '../../src/editor/src/views/panels/propertyeditor/dropdownLayer';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.Node = dom.window.Node;

/** jsdom has no layout engine, so every box has to be told where it is. */
function layout(el: Element, left: number, top: number, width: number, height: number) {
  (el as any).getBoundingClientRect = () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => undefined
  });
}

/**
 * One property row as the templates build it: the list is a child of the field, and
 * a group body clips everything inside it.
 */
function buildRow() {
  const group = document.createElement('div');
  group.style.overflow = 'hidden';
  group.style.overflowX = 'hidden';
  group.style.overflowY = 'hidden';

  const field = document.createElement('div');
  const before = document.createElement('i');
  const list = document.createElement('div');
  list.className = 'property-input-dropdown';
  list.setAttribute('style', 'position:absolute; top:35px; left:0px; width:100%; display:none;');
  const option = document.createElement('div');
  list.appendChild(option);

  field.appendChild(before);
  field.appendChild(list);
  group.appendChild(field);
  document.body.appendChild(group);

  layout(group, 0, 0, 330, 400);
  layout(field, 130, 100, 200, 35);

  return { group, field, list, option, before };
}

test('open parks the list in the body layer, close puts it back where it was', () => {
  const { field, list, before } = buildRow();

  openDropdown(list);
  assert.ok(isDropdownOpen(list));
  assert.equal(list.parentElement && list.parentElement.className, 'property-dropdown-layer');
  assert.equal(list.parentElement && list.parentElement.parentElement, document.body);
  assert.equal(list.style.position, 'fixed');
  assert.equal(list.style.display, 'block');

  closeDropdown(list);
  assert.equal(isDropdownOpen(list), false);
  assert.equal(list.parentElement, field, 'back inside its own field');
  assert.equal(before.nextElementSibling, list, 'and back in its original slot');
  // Its own positioning is back and the layer's is gone -- compared declaration by
  // declaration, since setting `display` re-serializes the whole attribute.
  assert.equal(list.style.position, 'absolute');
  assert.equal(list.style.top, '35px');
  assert.equal(list.style.left, '0px');
  assert.equal(list.style.width, '100%');
  assert.equal(list.style.display, 'none');
  assert.equal(list.style.maxHeight, '', 'the measured cap does not survive the close');
});

/**
 * The property panel is `z-index: 10` with a backdrop-filter on it. A layer below
 * that opens the list BEHIND the panel it belongs to: it is there, it is positioned,
 * and nothing is on screen.
 */
test('the layer outranks the property panel it opens over', () => {
  const { list } = buildRow();

  openDropdown(list);
  const built = document.querySelector('.property-dropdown-layer') as HTMLElement;

  assert.ok(built);
  assert.ok(Number(built.style.zIndex) > 10, 'clears the panel');
  assert.equal(built.style.position, 'fixed');
  assert.equal(built.style.pointerEvents, 'none', 'the layer itself stays click-through');
  assert.equal(list.style.pointerEvents, 'auto', 'the list inside it does not');

  closeDropdown(list);
});

test('opening never closes itself over a clip box it cannot measure', () => {
  const { group, list } = buildRow();
  // A wrapper that reports nothing -- display:contents, or a box with no layout yet.
  layout(group, 0, 0, 0, 0);

  openDropdown(list);
  assert.ok(isDropdownOpen(list), 'unmeasurable is not the same as off screen');

  closeDropdown(list);
});

test('opening a list on a field scrolled out of view still shows it', () => {
  const { group, field, list } = buildRow();
  // The field sits well below its clipping group. On a later scroll this closes;
  // on the click that opened it, it must not.
  layout(group, 0, 0, 330, 100);
  layout(field, 130, 900, 200, 35);

  openDropdown(list);
  assert.ok(isDropdownOpen(list));

  closeDropdown(list);
});

test('only one is open at a time', () => {
  const first = buildRow();
  const second = buildRow();

  openDropdown(first.list);
  openDropdown(second.list);

  assert.equal(isDropdownOpen(first.list), false);
  assert.equal(first.list.parentElement, first.field);
  assert.ok(isDropdownOpen(second.list));

  closeDropdown();
});

test('close only fires for the list that is actually open', () => {
  const first = buildRow();
  const second = buildRow();

  openDropdown(first.list);
  closeDropdown(second.list);

  assert.ok(isDropdownOpen(first.list), 'someone else closing theirs leaves this one alone');
  closeDropdown(first.list);
});

test('toggle opens then closes', () => {
  const { list } = buildRow();

  toggleDropdown(list);
  assert.ok(isDropdownOpen(list));
  toggleDropdown(list);
  assert.equal(isDropdownOpen(list), false);
});

test('a click outside closes it, a click on the list or its field does not', () => {
  const { field, list, option } = buildRow();
  const elsewhere = document.body.appendChild(document.createElement('button'));

  const mousedown = (target: Element) =>
    target.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true }));

  openDropdown(list);
  mousedown(option);
  assert.ok(isDropdownOpen(list), 'picking an option is the option handler to deal with');
  mousedown(field);
  assert.ok(isDropdownOpen(list), 'the field toggles itself, closing here would re-open it');

  mousedown(elsewhere);
  assert.equal(isDropdownOpen(list), false);
});

/**
 * The regression this whole change is about. The field carries the toggle and the
 * list used to be its child, so an option click bubbled into that toggle -- which is
 * what closed the list. Parked in the layer the option no longer bubbles there, so
 * the editors close it themselves; if the move back on close were to re-route the
 * click, the toggle would re-open the list on the very click that picked a value.
 */
test('picking an option closes the list and does not bounce it back open', () => {
  const { field, list, option } = buildRow();
  let toggles = 0;

  field.addEventListener('click', () => {
    toggles++;
    toggleDropdown(list);
  });
  option.addEventListener('click', () => closeDropdown(list));

  openDropdown(list);
  option.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(toggles, 0, 'the click never reaches the field toggle');
  assert.equal(isDropdownOpen(list), false);
  assert.equal(list.parentElement, field);
});

test('Escape closes it', () => {
  const { list } = buildRow();

  openDropdown(list);
  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(isDropdownOpen(list), false);
});

test('a row torn out from under an open list takes the list with it', () => {
  const { group, list } = buildRow();

  openDropdown(list);
  closeDropdownIfInside(group);

  assert.equal(isDropdownOpen(list), false);
  assert.equal(document.querySelector('.property-dropdown-layer .property-input-dropdown'), null);
});
