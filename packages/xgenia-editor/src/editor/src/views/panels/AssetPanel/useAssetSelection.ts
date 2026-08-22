import { useState, useRef, useCallback, useEffect } from 'react';
import { Asset } from './types';

/** Minimal modifier shape so callers can pass a real MouseEvent or a synthetic object. */
export interface ClickModifiers {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

export interface AssetSelection {
  selectedPaths: Set<string>;
  primaryPath: string | null;
  isSelected: (path: string) => boolean;
  /** Unity-style: plain = replace, Cmd/Ctrl = toggle, Shift = range over the ordered list. */
  onItemClick: (path: string, e: ClickModifiers) => void;
  selectAll: () => void;
  clear: () => void;
}

/**
 * Centralized, panel-level selection model keyed on asset.path.
 *
 * IMPORTANT: `orderedAssets` MUST be the exact array the grid renders (search/score
 * order THEN folders-first + sortBy), because Shift-range math indexes into it. The
 * Shift anchor is stored as a PATH and re-resolved to an index per op, since sort/
 * view changes reorder the same paths. The selection is pruned to still-present paths
 * whenever the list changes (folder navigation, refetch, sort/view).
 */
export function useAssetSelection(orderedAssets: Asset[]): AssetSelection {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [primaryPath, setPrimaryPath] = useState<string | null>(null);
  const anchorPathRef = useRef<string | null>(null);

  // Prune selection to paths still present in the current list.
  useEffect(() => {
    setSelectedPaths((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(orderedAssets.map((a) => a.path));
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (present.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [orderedAssets]);

  const isSelected = useCallback((path: string) => selectedPaths.has(path), [selectedPaths]);

  const onItemClick = useCallback(
    (path: string, e: ClickModifiers) => {
      const additive = !!(e.metaKey || e.ctrlKey);
      const range = !!e.shiftKey;

      setSelectedPaths((prev) => {
        if (range) {
          const anchor = anchorPathRef.current ?? path;
          const ai = orderedAssets.findIndex((a) => a.path === anchor);
          const bi = orderedAssets.findIndex((a) => a.path === path);
          if (ai === -1 || bi === -1) return new Set([path]);
          const [lo, hi] = ai <= bi ? [ai, bi] : [bi, ai];
          const next = additive ? new Set(prev) : new Set<string>();
          for (let i = lo; i <= hi; i++) next.add(orderedAssets[i].path);
          return next;
        }
        if (additive) {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        }
        return new Set([path]);
      });

      if (!range) {
        anchorPathRef.current = path;
        setPrimaryPath(path);
      }
    },
    [orderedAssets]
  );

  const selectAll = useCallback(() => {
    setSelectedPaths(new Set(orderedAssets.map((a) => a.path)));
  }, [orderedAssets]);

  const clear = useCallback(() => {
    setSelectedPaths(new Set());
    setPrimaryPath(null);
    anchorPathRef.current = null;
  }, []);

  return { selectedPaths, primaryPath, isSelected, onItemClick, selectAll, clear };
}
