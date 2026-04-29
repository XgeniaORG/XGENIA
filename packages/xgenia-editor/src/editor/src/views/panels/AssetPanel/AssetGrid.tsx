import React, { useMemo } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';

import { AssetItem } from './AssetItem';
import { Asset, ViewMode, SortBy } from './types';

import styles from './AssetPanel.module.scss';

interface AssetGridProps {
  assets: Asset[];
  isLoading: boolean;
  error: string | null;
  currentPath: string;
  onPathChange: (path: string) => void;
  searchQuery?: string;
  viewMode: ViewMode;
  sortBy: SortBy;
  sortAscending: boolean;
  onDelete?: (asset: Asset) => void;
}

export function AssetGrid({
  assets,
  isLoading,
  error,
  currentPath,
  onPathChange,
  searchQuery = '',
  viewMode,
  sortBy,
  sortAscending,
  onDelete
}: AssetGridProps) {
  // Sort and filter assets
  const sortedAssets = useMemo(() => {
    const sorted = [...assets].sort((a, b) => {
      let comparison = 0;

      // Always sort folders first
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date':
          const aDate = a.lastModified?.getTime() || 0;
          const bDate = b.lastModified?.getTime() || 0;
          comparison = aDate - bDate;
          break;
        case 'size':
          const aSize = a.size || 0;
          const bSize = b.size || 0;
          comparison = aSize - bSize;
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        default:
          comparison = 0;
      }

      return sortAscending ? comparison : -comparison;
    });

    return sorted;
  }, [assets, sortBy, sortAscending]);
  if (isLoading) {
    return (
      <Box UNSAFE_className="asset-grid__loading">
        <ActivityIndicator />
      </Box>
    );
  }

  if (error) {
    return (
      <Box UNSAFE_className="asset-grid__error">
        <div className={styles['asset-grid__error-message']}>
          {error}
        </div>
      </Box>
    );
  }

  if (assets.length === 0) {
    return (
      <Box UNSAFE_className="asset-grid__empty">
        <div className={styles['asset-grid__empty-message']}>
          No assets found in this folder.
        </div>
      </Box>
    );
  }

  return (
    <Box UNSAFE_className={`${styles['asset-grid']} ${styles[`asset-grid--${viewMode}`]}`}>
      {viewMode === 'list' && (
        <div className={styles['asset-grid__list-header']}>
          <div className={styles['asset-grid__list-header-icon']}></div>
          <div className={styles['asset-grid__list-header-name']}>Name</div>
          <div className={styles['asset-grid__list-header-size']}>Size</div>
          <div className={styles['asset-grid__list-header-date']}>Date Modified</div>
          <div className={styles['asset-grid__list-header-type']}>Type</div>
        </div>
      )}
      <div className={`${styles['asset-grid__container']} ${styles[`asset-grid__container--${viewMode}`]}`}>
        {sortedAssets.map((asset) => (
          <AssetItem
            key={asset.path}
            asset={asset}
            onFolderClick={asset.type === 'folder' ? onPathChange : undefined}
            searchQuery={searchQuery}
            viewMode={viewMode}
            onDelete={onDelete}
          />
        ))}
      </div>
    </Box>
  );
}
