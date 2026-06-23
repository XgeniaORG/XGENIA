export interface Asset {
  name: string;
  path: string;
  type: 'folder' | 'image' | 'audio' | 'video' | 'font' | 'document' | 'unknown';
  size?: number;
  lastModified?: Date;
  thumbnail?: string;
  extension?: string;
  /** Reserved seam for a future stable-id reference layer (drag-into-graph). */
  uuid?: string;
  /** Enriched from the asset metadata store (assetMeta.ts) for display/filtering. */
  tags?: string[];
  favorite?: boolean;
}

export interface AssetFolder {
  name: string;
  path: string;
  children: Asset[];
}

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'size' | 'type';









