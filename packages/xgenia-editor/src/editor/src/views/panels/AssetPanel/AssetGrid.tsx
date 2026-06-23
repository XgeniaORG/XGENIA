import React, { useRef } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { ActivityIndicator } from '@xgenia-core-ui/components/common/ActivityIndicator';

import { AssetItem } from './AssetItem';
import { Asset, ViewMode } from './types';
import { ClickModifiers } from './useAssetSelection';

import styles from './AssetPanel.module.scss';

interface AssetGridProps {
  /** Already in final canonical order (search/score THEN folders-first+sortBy). Rendered verbatim. */
  assets: Asset[];
  isLoading: boolean;
  error: string | null;
  onPathChange: (path: string) => void;
  searchQuery?: string;
  viewMode: ViewMode;
  isSelected: (path: string) => boolean;
  onItemClick: (path: string, e: ClickModifiers) => void;
  onClearSelection: () => void;
  onRequestDelete: () => void;
  onDuplicate: () => void;
  onReveal?: (path: string) => void;
  onRequestMove?: (path: string) => void;
  tileSize: number;
  editingPath: string | null;
  onStartRename: (path: string) => void;
  onCommitRename: (path: string, newName: string) => void;
  onCancelRename: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function AssetGrid({
  assets,
  isLoading,
  error,
  onPathChange,
  searchQuery = '',
  viewMode,
  isSelected,
  onItemClick,
  onClearSelection,
  onRequestDelete,
  onDuplicate,
  onReveal,
  onRequestMove,
  tileSize,
  editingPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onKeyDown
}: AssetGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Clicking empty space (the container itself, not a tile) clears the selection.
  const handleContainerClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClearSelection();
    }
  };

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
      <div
        ref={containerRef}
        tabIndex={0}
        className={`${styles['asset-grid__container']} ${styles[`asset-grid__container--${viewMode}`]}`}
        style={{ outline: 'none', ['--asset-tile' as any]: `${tileSize}px` }}
        onClick={handleContainerClick}
        onMouseDown={() => containerRef.current?.focus()}
        onKeyDown={onKeyDown}
      >
        {assets.map((asset) => (
          <AssetItem
            key={asset.path}
            asset={asset}
            isSelected={isSelected(asset.path)}
            onItemClick={onItemClick}
            onFolderClick={asset.type === 'folder' ? onPathChange : undefined}
            onRequestDelete={onRequestDelete}
            onDuplicate={onDuplicate}
            onReveal={onReveal}
            onRequestMove={onRequestMove}
            isEditing={editingPath === asset.path}
            onStartRename={onStartRename}
            onCommitRename={onCommitRename}
            onCancelRename={onCancelRename}
            searchQuery={searchQuery}
            viewMode={viewMode}
          />
        ))}
      </div>
    </Box>
  );
}
