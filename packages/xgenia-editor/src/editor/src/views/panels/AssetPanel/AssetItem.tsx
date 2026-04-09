import React, { useState, useRef, useCallback, useEffect } from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';

import { Asset, ViewMode } from './types';
import { getAssetIcon, getAssetThumbnail, highlightMatch, formatFileSize, formatDate, getAssetVisualStyle } from './utils';
import { AssetContextMenu } from './AssetContextMenu';

import styles from './AssetPanel.module.scss';

interface AssetItemProps {
  asset: Asset;
  onFolderClick?: (path: string) => void;
  searchQuery?: string;
  viewMode: ViewMode;
  onDelete?: (asset: Asset) => void;
}

export function AssetItem({ asset, onFolderClick, searchQuery = '', viewMode, onDelete }: AssetItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isSelected, setIsSelected] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [thumbnailError, setThumbnailError] = useState(false);
  const itemRef = useRef<HTMLDivElement>(null);

  const handleClick = () => {
    if (asset.type === 'folder' && onFolderClick) {
      onFolderClick(asset.path);
    } else {
      setIsSelected(!isSelected);
    }
  };

  const handleDoubleClick = () => {
    if (asset.type === 'folder' && onFolderClick) {
      onFolderClick(asset.path);
    }
  };

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setContextMenuPosition({
      x: e.clientX,
      y: e.clientY
    });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenuPosition(null);
  }, []);

  const handleRename = useCallback(() => {
    // TODO: Implement rename functionality
    console.log('Rename asset:', asset.name);
    handleContextMenuClose();
  }, [asset.name, handleContextMenuClose]);

  const handleDelete = useCallback(() => {
    if (onDelete) {
      onDelete(asset);
    } else {
      // Fallback: try to delete from localStorage directly
      // This handles imported assets that are stored in localStorage
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('asset_')) {
          try {
            const storedAsset = JSON.parse(localStorage.getItem(key) || '{}');
            if (storedAsset.path === asset.path) {
              localStorage.removeItem(key);
              console.log('Deleted asset from localStorage:', asset.name);
              // Trigger re-render by calling a refresh function if available
              // For now, just close the menu
              handleContextMenuClose();
              return;
            }
          } catch (err: any) {
            console.warn('Error parsing stored asset for deletion:', err);
          }
        }
      }
      console.log('Could not find asset to delete:', asset.name);
    }
    handleContextMenuClose();
  }, [asset, onDelete, handleContextMenuClose]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(asset.path);
    console.log('Copied path to clipboard:', asset.path);
    handleContextMenuClose();
  }, [asset.path, handleContextMenuClose]);

  // Get visual styling for this asset type
  const visualStyle = getAssetVisualStyle(asset);

  // Load thumbnail for images
  useEffect(() => {
    if (asset.type === 'image') {
      // Use thumbnail from asset if available, otherwise try getAssetThumbnail
      const thumbnail = asset.thumbnail || getAssetThumbnail(asset);
      if (thumbnail) {
        // Test if the image can be loaded
        const img = new Image();
        img.onload = () => setThumbnailUrl(thumbnail);
        img.onerror = () => setThumbnailError(true);
        img.src = thumbnail;
      } else {
        setThumbnailError(true);
      }
    }
  }, [asset]);

  const handleDragStart = useCallback((e: React.DragEvent) => {
    // Set drag data for the asset
    e.dataTransfer.setData('application/x-xgenia-asset', JSON.stringify({
      type: 'asset',
      assetType: asset.type,
      name: asset.name,
      path: asset.path,
      mimeType: asset.extension ? `application/${asset.extension}` : 'application/octet-stream'
    }));

    // Set drag effect
    e.dataTransfer.effectAllowed = 'copy';

    // Add visual feedback
    if (itemRef.current) {
      itemRef.current.style.opacity = '0.5';
    }
  }, [asset]);

  const handleDragEnd = useCallback(() => {
    // Reset visual feedback
    if (itemRef.current) {
      itemRef.current.style.opacity = '1';
    }
  }, []);

  const iconName = getAssetIcon(asset);

  if (viewMode === 'list') {
    return (
      <>
        <div
          ref={itemRef}
          className={`${styles['asset-item']} ${styles['asset-item--list']} ${isSelected ? styles['asset-item--selected'] : ''} ${isHovered ? styles['asset-item--hovered'] : ''}`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          draggable={asset.type !== 'folder'}
        >
          <div className={styles['asset-item__list-content']}>
            {/* Icon/Thumbnail */}
            <div
              className={styles['asset-item__list-icon']}
              style={{
                backgroundColor: visualStyle.backgroundColor,
                border: visualStyle.borderColor ? `1px solid ${visualStyle.borderColor}` : undefined,
                borderRadius: '4px'
              }}
            >
              {asset.type === 'image' && thumbnailUrl && !thumbnailError ? (
                <img
                  src={thumbnailUrl}
                  alt={asset.name}
                  className={styles['asset-item__list-image']}
                  draggable={false}
                />
              ) : (
              <Icon
                icon={iconName}
                UNSAFE_className="asset-item__list-icon-svg"
                UNSAFE_style={{ color: visualStyle.iconColor }}
              />
              )}
            </div>

            {/* File Name */}
            <div className={styles['asset-item__list-name']} title={asset.name}>
              {asset.name}
            </div>

            {/* File Size */}
            <div className={styles['asset-item__list-size']}>
              {asset.size ? formatFileSize(asset.size) : '--'}
            </div>

            {/* Date Modified */}
            <div className={styles['asset-item__list-date']}>
              {asset.lastModified ? formatDate(asset.lastModified) : '--'}
            </div>

            {/* File Type */}
            <div className={styles['asset-item__list-type']}>
              {asset.type.toUpperCase()}
            </div>
          </div>
        </div>

        {/* Context Menu */}
        {contextMenuPosition && (
          <AssetContextMenu
            asset={asset}
            position={contextMenuPosition}
            onClose={handleContextMenuClose}
            onRename={handleRename}
            onDelete={handleDelete}
            onCopyPath={handleCopyPath}
          />
        )}
      </>
    );
  }

  // Grid view (default)
  return (
    <>
      <div
        ref={itemRef}
        className={`${styles['asset-item']} ${styles['asset-item--grid']} ${isSelected ? styles['asset-item--selected'] : ''} ${isHovered ? styles['asset-item--hovered'] : ''}`}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        draggable={asset.type !== 'folder'}
      >
        <Box UNSAFE_className="asset-item__content">
          {/* Thumbnail/Icon */}
          <div
            className={styles['asset-item__thumbnail']}
            style={{
              backgroundColor: visualStyle.backgroundColor,
              border: visualStyle.borderColor ? `1px solid ${visualStyle.borderColor}` : undefined,
              borderRadius: '6px'
            }}
          >
            {asset.type === 'image' && thumbnailUrl && !thumbnailError ? (
              <img
                src={thumbnailUrl}
                alt={asset.name}
                className={styles['asset-item__image']}
                draggable={false}
              />
            ) : (
              <Icon
                icon={iconName}
                UNSAFE_className="asset-item__icon"
                UNSAFE_style={{ color: visualStyle.iconColor }}
              />
            )}
          </div>

          {/* File Name */}
          <div className={styles['asset-item__name']} title={asset.name}>
            {asset.name}
          </div>

          {/* File Type Badge */}
          <div className={styles['asset-item__type']}>
            {asset.type.toUpperCase()}
          </div>
        </Box>
      </div>

      {/* Context Menu */}
      {contextMenuPosition && (
        <AssetContextMenu
          asset={asset}
          position={contextMenuPosition}
          onClose={handleContextMenuClose}
          onRename={handleRename}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
        />
      )}
    </>
  );
}
