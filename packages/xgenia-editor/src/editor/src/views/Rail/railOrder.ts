// Which rail item goes where. Pure; no editor imports.

export interface RailOrderItem {
  id: string;
  name: string;
  order?: number;
  placement?: 'top' | 'bottom';
}

export interface RailArrangement<T> {
  top: T[];
  bottom: T[];
  overflow: T[];
}

/** 28px item + 10px gap. */
export const RAIL_SLOT = 38;
const IDENTITY_BLOCK = 8 + 28 + 22; // margin-top + chip + gap to the first item
const BOTTOM_CHROME = 1 + 10 + 10; // border-top + padding-top + margin-bottom

function byOrderThenName<T extends RailOrderItem>(a: T, b: T): number {
  const ao = a.order ?? Number.POSITIVE_INFINITY;
  const bo = b.order ?? Number.POSITIVE_INFINITY;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name);
}

export function arrangeRail<T extends RailOrderItem>(
  items: readonly T[],
  userOrder: readonly string[],
  capacity: number
): RailArrangement<T> {
  const bottom = items.filter((i) => i.placement === 'bottom').sort(byOrderThenName);
  const topAll = items.filter((i) => i.placement !== 'bottom');

  const pinned: T[] = [];
  for (const id of userOrder) {
    const it = topAll.find((i) => i.id === id);
    if (it && !pinned.includes(it)) pinned.push(it);
  }
  const rest = topAll.filter((i) => !pinned.includes(i)).sort(byOrderThenName);
  const ordered = [...pinned, ...rest];

  const cap = Math.max(0, Math.floor(capacity));
  return { top: ordered.slice(0, cap), overflow: ordered.slice(cap), bottom };
}

/** How many top-cluster slots fit in a rail of `railHeight` px with `bottomCount` bottom items. */
export function railCapacity(railHeight: number, bottomCount: number): number {
  const bottomHeight = bottomCount * RAIL_SLOT + BOTTOM_CHROME;
  const available = railHeight - IDENTITY_BLOCK - bottomHeight + 10; // last item needs no trailing gap
  return Math.max(0, Math.floor(available / RAIL_SLOT));
}
