import React from 'react';

import { Box } from '@xgenia-core-ui/components/layout/Box';
import { Icon, IconName } from '@xgenia-core-ui/components/common/Icon';

import styles from './AssetPanel.module.scss';

interface AssetBreadcrumbsProps {
  currentPath: string;
  onPathChange: (path: string) => void;
  assetCount?: number;
}

export function AssetBreadcrumbs({ currentPath, onPathChange, assetCount }: AssetBreadcrumbsProps) {
  const pathParts = currentPath === '/' ? [''] : currentPath.split('/').filter(Boolean);

  const handleBreadcrumbClick = (index: number) => {
    const newPath = index === 0 ? '/' : '/' + pathParts.slice(0, index + 1).join('/');
    onPathChange(newPath);
  };

  const canGoBack = pathParts.length > 0;
  const currentFolderName = pathParts.length > 0 ? pathParts[pathParts.length - 1] : 'Root';

  return (
    <Box UNSAFE_className="asset-breadcrumbs">
      <div className={styles['asset-breadcrumbs__container']}>
        {/* Back Button */}
        {canGoBack && (
          <div
            className={styles['asset-breadcrumbs__back-btn']}
            onClick={() => {
              const parentPath = pathParts.length === 1 ? '/' : '/' + pathParts.slice(0, -1).join('/');
              onPathChange(parentPath);
            }}
            title="Go to parent folder"
          >
            <Icon icon={IconName.ArrowLeft} UNSAFE_className="asset-breadcrumbs__back-icon" />
          </div>
        )}

        {/* Breadcrumbs */}
        {pathParts.length === 0 ? (
          <div className={`${styles['asset-breadcrumbs__item']} ${styles['asset-breadcrumbs__item--root']}`}>
            <Icon icon={IconName.FolderOpen} UNSAFE_className="asset-breadcrumbs__icon" />
            <span>Root</span>
            {assetCount !== undefined && (
              <span className={styles['asset-breadcrumbs__count']}>({assetCount})</span>
            )}
          </div>
        ) : (
          <>
            <div
              className={`${styles['asset-breadcrumbs__item']} ${styles['asset-breadcrumbs__item--clickable']}`}
              onClick={() => handleBreadcrumbClick(-1)}
            >
              <Icon icon={IconName.FolderOpen} UNSAFE_className="asset-breadcrumbs__icon" />
              <span>Root</span>
            </div>
            {pathParts.map((part, index) => (
              <React.Fragment key={index}>
                <Icon icon={IconName.CaretRight} UNSAFE_className="asset-breadcrumbs__separator" />
                <div
                  className={`${styles['asset-breadcrumbs__item']} ${index === pathParts.length - 1 ? styles['asset-breadcrumbs__item--current'] : styles['asset-breadcrumbs__item--clickable']}`}
                  onClick={() => index < pathParts.length - 1 && handleBreadcrumbClick(index)}
                >
                  {part}
                  {index === pathParts.length - 1 && assetCount !== undefined && (
                    <span className={styles['asset-breadcrumbs__count']}>({assetCount})</span>
                  )}
                </div>
              </React.Fragment>
            ))}
          </>
        )}
      </div>
    </Box>
  );
}
