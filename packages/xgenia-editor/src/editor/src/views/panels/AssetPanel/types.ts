export interface Asset {
  name: string;
  path: string;
  type: 'folder' | 'image' | 'audio' | 'video' | 'font' | 'document' | 'unknown';
  size?: number;
  lastModified?: Date;
  thumbnail?: string;
  extension?: string;
}

export interface AssetFolder {
  name: string;
  path: string;
  children: Asset[];
}

export type ViewMode = 'grid' | 'list';
export type SortBy = 'name' | 'date' | 'size' | 'type';









