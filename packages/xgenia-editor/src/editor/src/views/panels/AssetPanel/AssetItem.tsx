import React, { useState, useRef, useCallback, useEffect } from 'react';

import { filesystem } from '@xgenia/platform';

import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';
import { TextInput, TextInputVariant } from '@xgenia-core-ui/components/inputs/TextInput';

import PopupLayer from '../../popuplayer';

import { ProjectModel } from '../../../models/projectmodel';
import { Asset, ViewMode } from './types';
import { getAssetIcon, formatFileSize, formatDate, getAssetVisualStyle } from './utils';
import { AssetContextMenu } from './AssetContextMenu';
import { toggleAssetFavorite } from './assetMeta';
import { ClickModifiers } from './useAssetSelection';

import styles from './AssetPanel.module.scss';

// Module-level thumbnail cache keyed by asset path. Survives refetches (which
// re-create Asset objects) and bounds work to one read per distinct image.
const thumbCache = new Map<string, string>();

function mimeFromExt(ext?: string): string {
  const e = (ext || '').toLowerCase();
  if (e === 'svg') return 'image/svg+xml';
  if (e === 'jpg') return 'image/jpeg';
  return `image/${e || 'png'}`;
}

interface AssetItemProps {
  asset: Asset;
  isSelected: boolean;
  onItemClick: (path: string, e: ClickModifiers) => void;
  onFolderClick?: (path: string) => void;
  /** Delete the current selection (the panel decides what is selected). */
  onRequestDelete?: () => void;
  isEditing?: boolean;
  onStartRename?: (path: string) => void;
  onCommitRename?: (path: string, newName: string) => void;
  onCancelRename?: () => void;
  /** Duplicate the current selection (panel decides what is selected). */
  onDuplicate?: () => void;
  /** Reveal this item in the OS file manager (Electron only; undefined hides it). */
  onReveal?: (path: string) => void;
  /** Open the move-to-folder picker for this item. */
  onRequestMove?: (path: string) => void;
  searchQuery?: string;
  viewMode: ViewMode;
}

function AssetItemImpl({
  asset,
  isSelected,
  onItemClick,
  onFolderClick,
  onRequestDelete,
  isEditing = false,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDuplicate,
  onReveal,
  onRequestMove,
  searchQuery = '',
  viewMode
}: AssetItemProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [editValue, setEditValue] = useState(asset.name);
  const committedRef = useRef(false);
  const itemRef = useRef<HTMLDivElement>(null);

  // Reset the rename buffer each time editing begins.
  useEffect(() => {
    if (isEditing) {
      committedRef.current = false;
      setEditValue(asset.name);
    }
  }, [isEditing, asset.name]);

  const commitRename = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommitRename?.(asset.path, editValue);
  }, [onCommitRename, asset.path, editValue]);

  const cancelRename = useCallback(() => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancelRename?.();
  }, [onCancelRename]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    onItemClick(asset.path, e);
  }, [asset.path, onItemClick]);

  const handleDoubleClick = useCallback(() => {
    if (asset.type === 'folder' && onFolderClick) {
      onFolderClick(asset.path);
    }
  }, [asset.type, asset.path, onFolderClick]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelected) {
      onItemClick(asset.path, {});
    }
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  }, [isSelected, asset.path, onItemClick]);

  const handleContextMenuClose = useCallback(() => {
    setContextMenuPosition(null);
  }, []);

  const handleRename = useCallback(() => {
    onStartRename?.(asset.path);
    handleContextMenuClose();
  }, [onStartRename, asset.path, handleContextMenuClose]);

  const handleDelete = useCallback(() => {
    onRequestDelete?.();
    handleContextMenuClose();
  }, [onRequestDelete, handleContextMenuClose]);

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(asset.path);
    handleContextMenuClose();
  }, [asset.path, handleContextMenuClose]);

  const handleDuplicateClick = useCallback(() => {
    handleContextMenuClose();
    onDuplicate?.();
  }, [onDuplicate, handleContextMenuClose]);

  const handleRevealClick = useCallback(() => {
    handleContextMenuClose();
    onReveal?.(asset.path);
  }, [onReveal, asset.path, handleContextMenuClose]);

  const handleToggleFavorite = useCallback(() => {
    handleContextMenuClose();
    toggleAssetFavorite(asset.path);
  }, [asset.path, handleContextMenuClose]);

  const handleMoveClick = useCallback(() => {
    handleContextMenuClose();
    // Folder asset.path is a nav-path ('/sub'); move works in rel-space ('assets/sub').
    onRequestMove?.(asset.type === 'folder' ? `assets${asset.path}` : asset.path);
  }, [onRequestMove, asset.type, asset.path, handleContextMenuClose]);

  const visualStyle = getAssetVisualStyle(asset);

  // Lazily load image thumbnails: only when the item scrolls into view, read the
  // file's bytes via the platform FS and build a data URL. Per-item failure falls
  // back to the type icon and never affects the rest of the panel.
  useEffect(() => {
    if (asset.type !== 'image') return;

    if (asset.thumbnail) {
      setThumbnailUrl(asset.thumbnail);
      return;
    }

    const cached = thumbCache.get(asset.path);
    if (cached) {
      setThumbnailUrl(cached);
      return;
    }

    const el = itemRef.current;
    if (!el) return;

    let cancelled = false;

    const load = async () => {
      try {
        const root = ProjectModel.instance?._retainedProjectDirectory;
        if (!root) {
          if (!cancelled) setThumbnailError(true);
          return;
        }
        const abs = filesystem.join(root, asset.path);
        const buf = await filesystem.readBinaryFile(abs);
        if (cancelled) return;
        const url = `data:${mimeFromExt(asset.extension)};base64,${buf.toString('base64')}`;
        thumbCache.set(asset.path, url);
        setThumbnailUrl(url);
      } catch {
        if (!cancelled) setThumbnailError(true);
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            io.disconnect();
            load();
            break;
          }
        }
      },
      { rootMargin: '100px' }
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [asset.path, asset.type, asset.thumbnail, asset.extension]);

  // Drag an asset onto the node canvas via the internal PopupLayer pipeline (the
  // canvas ignores HTML5 dnd). Arm on mousedown; start the drag on the first move.
  const dragArmedRef = useRef(false);

  const handleItemMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isEditing || asset.type === 'folder') return;
    dragArmedRef.current = true;
  }, [isEditing, asset.type]);

  const handleItemMouseMove = useCallback(() => {
    if (!dragArmedRef.current) return;
    dragArmedRef.current = false;
    PopupLayer.instance.startDragging({
      type: 'asset',
      label: asset.name,
      assetPath: asset.path,
      assetType: asset.type
    });
  }, [asset.name, asset.path, asset.type]);

  const handleItemMouseUp = useCallback(() => {
    dragArmedRef.current = false;
  }, []);

  const renderNameField = (className: string) => {
    if (isEditing) {
      return (
        <div
          className={className}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <TextInput
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onEnter={commitRename}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                cancelRename();
              }
            }}
            isAutoFocus
            variant={TextInputVariant.Transparent}
            UNSAFE_textStyle={{ color: '#fff' }}
          />
        </div>
      );
    }
    return (
      <div className={className} title={asset.name}>
        {asset.name}
      </div>
    );
  };

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
          onMouseDown={handleItemMouseDown}
          onMouseMove={handleItemMouseMove}
          onMouseUp={handleItemMouseUp}
        >
          <div className={styles['asset-item__list-content']}>
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

            {renderNameField(styles['asset-item__list-name'])}

            <div className={styles['asset-item__list-size']}>
              {asset.size ? formatFileSize(asset.size) : '--'}
            </div>

            <div className={styles['asset-item__list-date']}>
              {asset.lastModified ? formatDate(asset.lastModified) : '--'}
            </div>

            <div className={styles['asset-item__list-type']}>
              {asset.type.toUpperCase()}
            </div>
          </div>
        </div>

        {contextMenuPosition && (
          <AssetContextMenu
            asset={asset}
            position={contextMenuPosition}
            onClose={handleContextMenuClose}
            onRename={handleRename}
            onDelete={handleDelete}
            onCopyPath={handleCopyPath}
            onDuplicate={handleDuplicateClick}
            onMove={onRequestMove ? handleMoveClick : undefined}
            isFavorite={asset.favorite}
            onToggleFavorite={asset.type !== 'folder' ? handleToggleFavorite : undefined}
            onReveal={onReveal ? handleRevealClick : undefined}
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
        style={{ position: 'relative' }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onMouseDown={handleItemMouseDown}
        onMouseMove={handleItemMouseMove}
        onMouseUp={handleItemMouseUp}
      >
        {asset.favorite && (
          <span
            style={{
              position: 'absolute',
              top: 4,
              right: 6,
              fontSize: 12,
              color: '#FFD54A',
              pointerEvents: 'none',
              textShadow: '0 1px 2px rgba(0,0,0,0.6)'
            }}
          >
            ★
          </span>
        )}
        <div className={styles['asset-item__content']}>
          <div className={styles['asset-item__thumbnail']}>
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

          {renderNameField(styles['asset-item__name'])}
        </div>
      </div>

      {contextMenuPosition && (
        <AssetContextMenu
          asset={asset}
          position={contextMenuPosition}
          onClose={handleContextMenuClose}
          onRename={handleRename}
          onDelete={handleDelete}
          onCopyPath={handleCopyPath}
          onDuplicate={handleDuplicateClick}
          onReveal={onReveal ? handleRevealClick : undefined}
        />
      )}
    </>
  );
}

// Controlled + memoized so a selection change only re-renders the tiles that changed.
export const AssetItem = React.memo(AssetItemImpl);
