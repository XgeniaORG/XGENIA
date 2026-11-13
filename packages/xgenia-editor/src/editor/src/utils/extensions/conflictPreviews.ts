import type React from 'react';
import type { MergeConflictItem } from '@xgenia/git';

export type ConflictPreviewComponent = React.ComponentType<{ item: MergeConflictItem; repoDir: string }>;

const previews = new Map<string, ConflictPreviewComponent>();

/** Supply a preview for listed conflicts whose `preview` equals `kind`. */
export function registerConflictPreview(kind: string, component: ConflictPreviewComponent): void {
  previews.set(kind, component);
}

export function conflictPreviewFor(kind: string | undefined): ConflictPreviewComponent | undefined {
  return kind ? previews.get(kind) : undefined;
}
