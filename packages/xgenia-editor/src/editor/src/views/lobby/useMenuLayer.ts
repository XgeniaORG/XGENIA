/**
 * useMenuLayer — one lobby popup open at a time, dismissed by the next click anywhere.
 *
 * Every menu in the lobby used to dismiss itself with a `position: fixed; inset: 0` scrim, and
 * that could never work here. Both roots these menus hang off — the card and the bar — set
 * `backdrop-filter` (and a hovered card adds a `transform`), and either property makes the
 * element a containing block for `position: fixed`. The scrim's `inset: 0` therefore resolved to
 * its own card, not the viewport: it covered nothing but the thing it belonged to. Right-clicking
 * a second card left the first menu standing, and a click on empty floor never reached a scrim at
 * all, so menus piled up until something happened to re-render them away.
 *
 * Document listeners do not care about containing blocks, and a module-level registry supplies
 * the "only one" half — opening any menu closes whichever one was already open, across
 * components, which is what a single scrim was implicitly trying to guarantee.
 *
 * Dismissal runs on `click` in the capture phase and stops the event. That is deliberate, and it
 * is what the scrim used to give for free: the click that closes a menu is spent closing it and
 * does not also open the game underneath, or fire the button it landed on. A right-click is the
 * exception — it dismisses without stopping, so the card being right-clicked can open its own
 * menu in the same gesture.
 */

import { useCallback, useEffect, useRef } from 'react';

/** The dismisser for the menu that currently owns the layer, if any. */
let closeCurrent: (() => void) | null = null;

/**
 * @param open  whether the menu this hook belongs to is showing
 * @param close dismisser for that menu; may be a fresh closure on every render
 * @returns a ref to put on the popup element — clicks inside it are never dismissals
 */
export function useMenuLayer<T extends HTMLElement>(open: boolean, close: () => void) {
  const popupRef = useRef<T | null>(null);

  // `close` is usually an inline arrow, so the listeners read it through a ref and `dismiss`
  // stays stable — a stable identity is what lets the registry compare owners below.
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismiss = useCallback(() => closeRef.current(), []);

  useEffect(() => {
    if (!open) return undefined;

    // Claim the layer. This lands in the handler of the event that opened this menu, so the
    // losing menu's state update batches with this one's.
    if (closeCurrent && closeCurrent !== dismiss) closeCurrent();
    closeCurrent = dismiss;

    const isInside = (target: EventTarget | null) =>
      target instanceof Node && !!popupRef.current?.contains(target);

    const onClick = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      // Capture phase, so this runs before React's own root listener and before any handler
      // that would call stopPropagation on the way up.
      e.stopPropagation();
      e.preventDefault();
      dismiss();
    };

    const onContextMenu = (e: MouseEvent) => {
      if (isInside(e.target)) return;
      // Not stopped: the card under the pointer still gets to open its menu, which then takes
      // the layer off this one.
      dismiss();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // The lobby grid owns Escape too (it clears the selection); with a menu up the key
      // belongs to the menu.
      e.stopPropagation();
      dismiss();
    };

    document.addEventListener('click', onClick, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', dismiss);
    window.addEventListener('resize', dismiss);
    // Menus are positioned against their owner, so a scroll would tear one off it. Capture,
    // because the lobby scrolls in an inner element and scroll does not bubble.
    document.addEventListener('scroll', dismiss, true);

    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', dismiss);
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      if (closeCurrent === dismiss) closeCurrent = null;
    };
  }, [open, dismiss]);

  return popupRef;
}
